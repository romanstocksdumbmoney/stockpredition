import base64
import io
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import APIError, OpenAI, RateLimitError
from PIL import Image, UnidentifiedImageError

load_dotenv()

SCAN_PROMPT = """You are a receipt data extraction assistant. Extract all
information from this receipt image and return ONLY a JSON
object with no explanation, no markdown formatting, no
code blocks. Just raw JSON.

Return exactly this structure:
{
  merchant_name: string or null,
  merchant_address: string or null,
  transaction_date: date as YYYY-MM-DD string or null,
  transaction_time: time as HH:MM string or null,
  subtotal: number or null,
  tax_amount: number or null,
  tip_amount: number or null,
  total_amount: number or null,
  payment_method: string or null,
  currency: string default USD,
  suggested_category: string — must be exactly one of:
    Food and Dining, Travel, Lodging, Transportation,
    Software and Tools, Office Supplies, Marketing,
    Utilities, Entertainment, Healthcare, Equipment, Other,
  line_items: array of objects with description and amount,
  confidence_score: float between 0.0 and 1.0,
  raw_text: complete text you can read from the receipt,
  is_receipt: boolean — false if this is not a receipt image
}"""


def _open_and_prepare_image(image_path: str) -> str:
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError("Image file does not exist.")

    try:
        with Image.open(path) as img:
            img = img.convert("RGB")
            max_side = max(img.width, img.height)
            if max_side > 2000:
                ratio = 2000 / max_side
                new_size = (int(img.width * ratio), int(img.height * ratio))
                img = img.resize(new_size)

            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=90, optimize=True)
            return base64.b64encode(buffer.getvalue()).decode("utf-8")
    except UnidentifiedImageError as exc:
        raise ValueError("Image cannot be opened.") from exc


def _parse_response_json(raw_content: str) -> dict[str, Any]:
    text = raw_content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            sliced = text[start : end + 1]
            return json.loads(sliced)
        raise


def scan_receipt(image_path: str) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {"success": False, "error": "OPENAI_API_KEY is missing."}

    try:
        image_base64 = _open_and_prepare_image(image_path)
    except (ValueError, FileNotFoundError) as exc:
        return {"success": False, "error": str(exc)}
    except Exception:
        return {"success": False, "error": "Image cannot be opened."}

    client = OpenAI(api_key=api_key)

    def _run_request() -> dict[str, Any]:
        response = client.chat.completions.create(
            model="gpt-4o",
            temperature=0,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": SCAN_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                        },
                    ],
                }
            ],
        )
        content = response.choices[0].message.content or ""
        return _parse_response_json(content)

    for attempt in range(2):
        try:
            parsed = _run_request()
            if not parsed.get("is_receipt", False):
                return {"success": False, "error": "The uploaded file is not a receipt."}

            parsed["currency"] = parsed.get("currency") or "USD"
            return {"success": True, "data": parsed}
        except RateLimitError:
            if attempt == 0:
                time.sleep(5)
                continue
            return {"success": False, "error": "OpenAI rate limit reached. Try again shortly."}
        except json.JSONDecodeError:
            return {"success": False, "error": "Invalid JSON response from OpenAI."}
        except APIError as exc:
            return {"success": False, "error": f"OpenAI API error: {exc}"}
        except Exception as exc:
            return {"success": False, "error": f"Receipt scan failed: {exc}"}

    return {"success": False, "error": "Receipt scan failed unexpectedly."}
