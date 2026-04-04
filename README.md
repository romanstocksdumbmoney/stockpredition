# Shopify Product Import (Easy Mode)

This repository now includes a **ready-to-run Shopify product importer** so you can bulk import products from CSV with minimal setup.

## What this gives you

- Import products + variants from one CSV file
- Safe by default: **dry-run mode** (no Shopify changes unless you enable live mode)
- Skip duplicates by default (existing handles are skipped)
- Optional update mode (`--update-existing`) to upsert variants by SKU

---

## 1) Requirements

- Python 3.10+ (usually preinstalled)
- Shopify Admin API access token with product write permissions

---

## 2) Setup

1. Copy `.env.example` values into your shell environment:

```bash
export SHOPIFY_STORE="your-store.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export SHOPIFY_API_VERSION="2025-10"
```

2. Start from the sample template:

```bash
cp sample_products.csv my_products.csv
```

Edit `my_products.csv` with your products.

---

## 3) CSV format

Use these columns (same order as template):

`handle,title,body_html,vendor,product_type,tags,status,published,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,variant_sku,variant_price,variant_compare_at_price,variant_barcode,variant_inventory_qty,variant_weight,variant_weight_unit,image_src,image_alt_text`

### Required columns

- `handle` (unique product handle, used to detect existing products)
- `title`

### Variant behavior

- Multiple rows with the same `handle` become multiple variants of one product.
- `variant_sku` is used for matching existing variants in update mode.

---

## 4) Run importer safely (dry-run first)

This only previews what would happen:

```bash
python3 shopify_importer.py --csv my_products.csv
```

---

## 5) Live import

Actually write changes to Shopify:

```bash
python3 shopify_importer.py --csv my_products.csv --live
```

If you want to update products that already exist by handle:

```bash
python3 shopify_importer.py --csv my_products.csv --live --update-existing
```

If you want the script to continue after errors:

```bash
python3 shopify_importer.py --csv my_products.csv --live --continue-on-error
```

---

## 6) Script reference

```bash
python3 shopify_importer.py --help
```

Main flags:

- `--csv` path to CSV file (required)
- `--live` enable live writes (otherwise dry-run)
- `--update-existing` update products that already exist
- `--continue-on-error` keep importing remaining products after a failure
- `--store`, `--token`, `--api-version` override env vars

---

## Notes

- Shopify API limits are handled with retry/backoff for transient errors.
- For first-time use, test with a tiny CSV (1-2 products), validate in Shopify Admin, then run full import.
