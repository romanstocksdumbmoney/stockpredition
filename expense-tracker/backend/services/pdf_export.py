import io
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


def _draw_cover(c: canvas.Canvas, user_name: str, period_label: str) -> None:
    width, height = LETTER
    c.setFont("Helvetica-Bold", 36)
    c.drawCentredString(width / 2, height - 180, "Expense Tracker")

    c.setFont("Helvetica", 18)
    c.drawCentredString(width / 2, height - 230, user_name or "Account Owner")
    c.setFont("Helvetica", 16)
    c.drawCentredString(width / 2, height - 265, period_label)

    c.setFont("Helvetica", 10)
    c.drawRightString(width - 40, 36, f"Generated {datetime.utcnow():%Y-%m-%d %H:%M UTC}")


def _draw_summary(c: canvas.Canvas, report_data: dict[str, Any]) -> None:
    width, height = LETTER
    c.setFont("Helvetica-Bold", 22)
    c.drawString(40, height - 50, "Summary")

    cards = [
        ("Total", f"${report_data.get('total_amount', 0):,.2f}"),
        ("Receipts", str(report_data.get("receipt_count", 0))),
        ("Daily Average", f"${report_data.get('daily_average', 0):,.2f}"),
        ("Top Category", (report_data.get("by_category") or [{}])[0].get("category", "None")),
    ]
    card_width = (width - 100) / 2
    card_height = 75
    for idx, (label, value) in enumerate(cards):
        row = idx // 2
        col = idx % 2
        x = 40 + col * (card_width + 20)
        y = height - 100 - row * (card_height + 20)
        c.setFillColor(colors.HexColor("#f8f9fc"))
        c.roundRect(x, y - card_height, card_width, card_height, 10, stroke=0, fill=1)
        c.setFillColor(colors.HexColor("#1e293b"))
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 14, y - 24, label)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(x + 14, y - 48, value)

    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, height - 300, "Category Breakdown")
    headers = ["Category", "Amount", "Count", "% of Total"]
    columns = [40, 260, 370, 460]
    y = height - 325
    c.setFillColor(colors.HexColor("#334155"))
    c.setFont("Helvetica-Bold", 11)
    for x, header in zip(columns, headers):
        c.drawString(x, y, header)
    y -= 18

    c.setFont("Helvetica", 10)
    for row in sorted(report_data.get("by_category", []), key=lambda r: r.get("amount", 0), reverse=True):
        c.setFillColor(colors.HexColor("#0f172a"))
        c.drawString(columns[0], y, str(row.get("category", "Other"))[:30])
        c.drawRightString(columns[1] + 78, y, f"${row.get('amount', 0):,.2f}")
        c.drawRightString(columns[2] + 32, y, str(row.get("count", 0)))
        c.drawRightString(columns[3] + 44, y, f"{row.get('percentage', 0):.1f}%")
        y -= 16
        if y < 70:
            c.showPage()
            y = LETTER[1] - 70


def _draw_receipts(c: canvas.Canvas, receipts: list[dict[str, Any]]) -> None:
    width, height = LETTER
    rows_per_page = 25
    styles = getSampleStyleSheet()
    running_total = 0.0

    for offset in range(0, len(receipts), rows_per_page):
        chunk = receipts[offset : offset + rows_per_page]
        c.showPage()
        c.setFont("Helvetica-Bold", 16)
        c.drawString(40, height - 46, "Receipt List")

        headers = ["Date", "Merchant", "Category", "Total", "Tax", "Payment"]
        columns = [40, 105, 250, 360, 430, 490]
        c.setFont("Helvetica-Bold", 10)
        y = height - 72
        for x, header in zip(columns, headers):
            c.drawString(x, y, header)

        y -= 14
        c.setFont("Helvetica", 9)
        for index, receipt in enumerate(chunk):
            if index % 2 == 0:
                c.setFillColor(colors.HexColor("#f8fafc"))
                c.rect(36, y - 3, width - 72, 14, stroke=0, fill=1)
            c.setFillColor(colors.black)
            amount = float(receipt.get("total_amount") or 0)
            tax = float(receipt.get("tax_amount") or 0)
            running_total += amount

            c.drawString(columns[0], y, str(receipt.get("transaction_date") or "-"))
            merchant = str(receipt.get("merchant_name") or "Unknown")
            paragraph = Paragraph(merchant, styles["Normal"])
            paragraph.wrapOn(c, 130, 14)
            paragraph.drawOn(c, columns[1], y - 3)
            c.drawString(columns[2], y, str(receipt.get("category") or "Other")[:18])
            c.drawRightString(columns[3] + 48, y, f"${amount:,.2f}")
            c.drawRightString(columns[4] + 38, y, f"${tax:,.2f}")
            c.drawString(columns[5], y, str(receipt.get("payment_method") or "-")[:14])
            y -= 14

    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(width - 40, 40, f"Running Total: ${running_total:,.2f}")


def generate_report_pdf(report_data: dict[str, Any], user_name: str, period_label: str) -> bytes:
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)
    _draw_cover(c, user_name, period_label)
    c.showPage()
    _draw_summary(c, report_data)
    _draw_receipts(c, report_data.get("receipts", []))
    c.save()
    return buffer.getvalue()
