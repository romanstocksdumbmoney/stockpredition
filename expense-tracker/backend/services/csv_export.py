import io
from typing import Any

import pandas as pd


def generate_receipts_csv(receipts: list[dict[str, Any]]) -> bytes:
    rows = []
    for receipt in receipts:
        rows.append(
            {
                "Date": receipt.get("transaction_date") or "",
                "Merchant": receipt.get("merchant_name") or "",
                "Category": receipt.get("category") or "Other",
                "Amount": receipt.get("total_amount") or 0,
                "Subtotal": receipt.get("subtotal") or 0,
                "Tax": receipt.get("tax_amount") or 0,
                "Tip": receipt.get("tip_amount") or 0,
                "Payment Method": receipt.get("payment_method") or "",
                "Currency": receipt.get("currency") or "USD",
                "Filename": receipt.get("image_filename") or "",
            }
        )

    frame = pd.DataFrame(rows)
    output = io.StringIO()
    frame.to_csv(output, index=False)
    return output.getvalue().encode("utf-8")
