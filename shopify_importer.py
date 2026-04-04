#!/usr/bin/env python3
"""Import products into Shopify from a CSV file.

This script is designed for small-to-medium bulk imports where ease-of-use and
safe defaults matter:
  - Dry run by default to preview actions
  - Skips existing products unless --update-existing is provided
  - Supports multi-variant products by grouping rows by handle
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from collections import defaultdict
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ALLOWED_STATUS = {"active", "draft", "archived"}
DEFAULT_API_VERSION = "2025-10"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import Shopify products from CSV (safe by default)."
    )
    parser.add_argument("--csv", required=True, help="Path to input CSV file")
    parser.add_argument(
        "--store",
        default=os.getenv("SHOPIFY_STORE", ""),
        help="Shopify store domain, e.g. your-store.myshopify.com "
        "(or set SHOPIFY_STORE)",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("SHOPIFY_ACCESS_TOKEN", ""),
        help="Shopify Admin API access token (or set SHOPIFY_ACCESS_TOKEN)",
    )
    parser.add_argument(
        "--api-version",
        default=os.getenv("SHOPIFY_API_VERSION", DEFAULT_API_VERSION),
        help=f"Shopify Admin API version (default: {DEFAULT_API_VERSION})",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Actually write to Shopify. Without this flag, script runs dry-run.",
    )
    parser.add_argument(
        "--update-existing",
        action="store_true",
        help="If handle exists, update product and upsert variants by SKU.",
    )
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Continue processing next product if one product fails.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print API-level details while processing.",
    )
    return parser.parse_args()


def normalize_store_domain(store: str) -> str:
    store = store.strip().replace("https://", "").replace("http://", "")
    return store.strip("/")


def as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_int(value: str) -> int | None:
    text = as_text(value)
    if not text:
        return None
    return int(float(text))


def parse_float(value: str) -> float | None:
    text = as_text(value)
    if not text:
        return None
    return float(text)


def parse_bool(value: str, default: bool = False) -> bool:
    text = as_text(value).lower()
    if not text:
        return default
    return text in {"1", "true", "yes", "y", "on"}


class ShopifyClient:
    def __init__(self, store: str, token: str, api_version: str, verbose: bool = False):
        self.store = normalize_store_domain(store)
        self.token = token.strip()
        self.api_version = api_version.strip()
        self.verbose = verbose

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        retries: int = 5,
    ) -> dict[str, Any]:
        query = f"?{urlencode(params)}" if params else ""
        url = f"https://{self.store}/admin/api/{self.api_version}{path}{query}"
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        req = Request(url=url, data=body, headers=headers, method=method)

        attempt = 0
        while True:
            attempt += 1
            try:
                if self.verbose:
                    print(f"[HTTP] {method} {url}")
                with urlopen(req, timeout=60) as resp:
                    raw = resp.read().decode("utf-8")
                    if not raw:
                        return {}
                    return json.loads(raw)
            except HTTPError as err:
                status = err.code
                error_body = err.read().decode("utf-8", errors="replace")
                retriable = status == 429 or status >= 500
                if retriable and attempt < retries:
                    retry_after_header = err.headers.get("Retry-After", "").strip()
                    wait_seconds = int(retry_after_header) if retry_after_header.isdigit() else attempt * 2
                    if self.verbose:
                        print(f"[WARN] HTTP {status}. Retrying in {wait_seconds}s...")
                    time.sleep(wait_seconds)
                    continue
                raise RuntimeError(f"Shopify API error {status}: {error_body}") from err
            except URLError as err:
                if attempt < retries:
                    wait_seconds = attempt * 2
                    if self.verbose:
                        print(f"[WARN] Network error. Retrying in {wait_seconds}s...")
                    time.sleep(wait_seconds)
                    continue
                raise RuntimeError(f"Network error contacting Shopify: {err}") from err

    def get_product_by_handle(self, handle: str) -> dict[str, Any] | None:
        data = self._request(
            "GET",
            "/products.json",
            params={
                "handle": handle,
                "limit": 1,
                "fields": (
                    "id,handle,title,body_html,vendor,product_type,tags,status,"
                    "variants,images"
                ),
            },
        )
        products = data.get("products", [])
        if not products:
            return None
        product = products[0]
        if as_text(product.get("handle")) != handle:
            return None
        return product

    def create_product(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/products.json", payload=payload)

    def update_product(self, product_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("PUT", f"/products/{product_id}.json", payload=payload)

    def create_variant(self, product_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/products/{product_id}/variants.json", payload=payload)

    def update_variant(self, variant_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("PUT", f"/variants/{variant_id}.json", payload=payload)

    def create_image(self, product_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/products/{product_id}/images.json", payload=payload)


def load_rows(csv_path: str) -> tuple[dict[str, list[dict[str, str]]], list[str]]:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("CSV appears to be missing a header row.")

        headers = [as_text(h) for h in reader.fieldnames if as_text(h)]
        required = {"handle", "title"}
        missing = [col for col in required if col not in headers]
        if missing:
            raise ValueError(f"CSV missing required columns: {', '.join(missing)}")

        grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
        for line_num, raw_row in enumerate(reader, start=2):
            row = {as_text(k): as_text(v) for k, v in raw_row.items()}
            handle = as_text(row.get("handle"))
            title = as_text(row.get("title"))
            if not handle:
                raise ValueError(f"Row {line_num}: handle is required.")
            if not title:
                raise ValueError(f"Row {line_num}: title is required.")
            grouped[handle].append(row)
    return grouped, headers


def option_names(rows: list[dict[str, str]]) -> list[str]:
    names: list[str] = []
    for idx in range(1, 4):
        key = f"option{idx}_name"
        name = ""
        for row in rows:
            candidate = as_text(row.get(key))
            if candidate:
                name = candidate
                break
        if name:
            names.append(name)
    return names


def build_variant_payload(row: dict[str, str], names: list[str]) -> dict[str, Any]:
    variant: dict[str, Any] = {}

    for source, target in [
        ("variant_sku", "sku"),
        ("variant_price", "price"),
        ("variant_compare_at_price", "compare_at_price"),
        ("variant_barcode", "barcode"),
    ]:
        value = as_text(row.get(source))
        if value:
            variant[target] = value

    inv_qty = parse_int(as_text(row.get("variant_inventory_qty")))
    if inv_qty is not None:
        variant["inventory_management"] = "shopify"
        variant["inventory_quantity"] = inv_qty

    weight = parse_float(as_text(row.get("variant_weight")))
    if weight is not None:
        variant["weight"] = weight
        weight_unit = as_text(row.get("variant_weight_unit")).lower() or "kg"
        variant["weight_unit"] = weight_unit

    if names:
        for idx, _ in enumerate(names, start=1):
            value = as_text(row.get(f"option{idx}_value"))
            if value:
                variant[f"option{idx}"] = value
        if len(names) == 1 and "option1" not in variant:
            variant["option1"] = "Default Title"
    else:
        # Shopify requires a value for a single-variant product.
        variant["option1"] = "Default Title"

    return variant


def build_product_payload(handle: str, rows: list[dict[str, str]]) -> dict[str, Any]:
    first = rows[0]
    product: dict[str, Any] = {
        "handle": handle,
        "title": as_text(first.get("title")) or handle,
    }

    for source, target in [
        ("body_html", "body_html"),
        ("vendor", "vendor"),
        ("product_type", "product_type"),
        ("tags", "tags"),
    ]:
        value = as_text(first.get(source))
        if value:
            product[target] = value

    status = as_text(first.get("status")).lower()
    if status:
        if status not in ALLOWED_STATUS:
            raise ValueError(
                f"Invalid status '{status}' for handle '{handle}'. "
                f"Allowed: {', '.join(sorted(ALLOWED_STATUS))}"
            )
        product["status"] = status

    names = option_names(rows)
    if names:
        product["options"] = [{"name": name} for name in names]

    variants = [build_variant_payload(row, names) for row in rows]
    product["variants"] = variants

    published_value = as_text(first.get("published"))
    if published_value:
        product["published"] = parse_bool(published_value, default=True)

    seen_image_src: set[str] = set()
    images: list[dict[str, str]] = []
    for row in rows:
        src = as_text(row.get("image_src"))
        if not src or src in seen_image_src:
            continue
        image: dict[str, str] = {"src": src}
        alt = as_text(row.get("image_alt_text"))
        if alt:
            image["alt"] = alt
        images.append(image)
        seen_image_src.add(src)
    if images:
        product["images"] = images

    return {"product": product}


def update_existing_product(
    client: ShopifyClient,
    existing: dict[str, Any],
    payload: dict[str, Any],
    dry_run: bool,
) -> None:
    product_id = int(existing["id"])
    incoming_product = payload["product"]

    product_update_fields = {
        k: v
        for k, v in incoming_product.items()
        if k
        not in {
            "variants",
            "images",
        }
    }
    product_update_fields["id"] = product_id

    if dry_run:
        print(f"[DRY-RUN] Would update product #{product_id} ({incoming_product['handle']})")
    else:
        client.update_product(product_id, {"product": product_update_fields})

    existing_variants_by_sku = {
        as_text(v.get("sku")): v for v in existing.get("variants", []) if as_text(v.get("sku"))
    }
    for variant in incoming_product.get("variants", []):
        sku = as_text(variant.get("sku"))
        if sku and sku in existing_variants_by_sku:
            variant_id = int(existing_variants_by_sku[sku]["id"])
            if dry_run:
                print(f"[DRY-RUN] Would update variant sku={sku} (id={variant_id})")
            else:
                body = {"variant": {"id": variant_id, **variant}}
                client.update_variant(variant_id, body)
        else:
            if dry_run:
                label = f"sku={sku}" if sku else "without SKU"
                print(f"[DRY-RUN] Would create new variant {label}")
            else:
                client.create_variant(product_id, {"variant": variant})

    existing_image_src = {as_text(img.get("src")) for img in existing.get("images", [])}
    for image in incoming_product.get("images", []):
        src = as_text(image.get("src"))
        if not src or src in existing_image_src:
            continue
        if dry_run:
            print(f"[DRY-RUN] Would add image: {src}")
        else:
            client.create_image(product_id, {"image": image})


def main() -> int:
    args = parse_args()
    dry_run = not args.live

    if not os.path.exists(args.csv):
        print(f"CSV file not found: {args.csv}", file=sys.stderr)
        return 1

    store = normalize_store_domain(args.store)
    if not store:
        print("Missing --store (or SHOPIFY_STORE env var).", file=sys.stderr)
        return 1
    if not args.token:
        print("Missing --token (or SHOPIFY_ACCESS_TOKEN env var).", file=sys.stderr)
        return 1

    try:
        grouped, headers = load_rows(args.csv)
    except Exception as err:  # noqa: BLE001 - user input validation
        print(f"Failed to read CSV: {err}", file=sys.stderr)
        return 1

    print(f"Loaded {sum(len(rows) for rows in grouped.values())} rows from {args.csv}")
    print(f"Detected headers: {', '.join(headers)}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'LIVE IMPORT'}")
    if not dry_run:
        print("Live mode enabled: changes will be written to Shopify.")

    client = ShopifyClient(
        store=store,
        token=args.token,
        api_version=args.api_version,
        verbose=args.verbose,
    )

    created = 0
    updated = 0
    skipped = 0
    failed = 0

    for idx, (handle, rows) in enumerate(grouped.items(), start=1):
        print(f"\n[{idx}/{len(grouped)}] Processing handle '{handle}'...")
        try:
            payload = build_product_payload(handle, rows)
            existing = client.get_product_by_handle(handle)
            if existing is None:
                if dry_run:
                    print(f"[DRY-RUN] Would create product '{handle}' with {len(rows)} variant row(s)")
                else:
                    client.create_product(payload)
                created += 1
                continue

            if not args.update_existing:
                print(f"Skipping existing product '{handle}' (use --update-existing to modify).")
                skipped += 1
                continue

            update_existing_product(client, existing, payload, dry_run=dry_run)
            updated += 1
        except Exception as err:  # noqa: BLE001 - continue-on-error control path
            failed += 1
            print(f"[ERROR] '{handle}' failed: {err}", file=sys.stderr)
            if not args.continue_on_error:
                print("Stopping because --continue-on-error is not set.", file=sys.stderr)
                break

    print("\n=== Import Summary ===")
    print(f"Created: {created}")
    print(f"Updated: {updated}")
    print(f"Skipped: {skipped}")
    print(f"Failed : {failed}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
