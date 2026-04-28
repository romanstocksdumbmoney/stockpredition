"""HTML template content used by the FastAPI app."""

from __future__ import annotations

from pathlib import Path

from expense_reporting.settings import AppSettings

BASE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{ title or "Expense Reporting Tool" }}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f5f7fa; color: #17212f; }
    header { background: #1f2937; color: #fff; padding: 14px 20px; }
    header h1 { margin: 0; font-size: 20px; }
    nav { margin-top: 8px; display: flex; gap: 14px; flex-wrap: wrap; }
    nav a { color: #d1d5db; text-decoration: none; font-size: 14px; }
    nav a:hover { color: #fff; text-decoration: underline; }
    main { padding: 20px; max-width: 1100px; margin: 0 auto; }
    .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .card { background: #fff; border-radius: 8px; padding: 14px; border: 1px solid #d9e0ea; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { border: 1px solid #d9e0ea; padding: 8px; text-align: left; font-size: 13px; vertical-align: top; }
    th { background: #eef2f7; font-weight: 600; }
    .tag { padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #e2e8f0; }
    .warn { color: #b45309; font-weight: 600; }
    .error { color: #b91c1c; font-weight: 600; }
    .mono { font-family: Menlo, Consolas, monospace; font-size: 12px; }
    input, select, textarea, button { font: inherit; padding: 8px; border: 1px solid #b7c2d0; border-radius: 6px; width: 100%; box-sizing: border-box; }
    textarea { min-height: 80px; }
    button { width: auto; cursor: pointer; background: #1d4ed8; color: white; border: none; }
    button.secondary { background: #475569; }
    .inline { display: flex; gap: 8px; align-items: center; }
    .inline > * { width: auto; }
    .section-title { margin-top: 28px; margin-bottom: 10px; }
    .small { font-size: 12px; color: #4b5563; }
  </style>
</head>
<body>
  <header>
    <h1>Expense Reporting Tool</h1>
    <nav>
      <a href="/">Dashboard</a>
      <a href="/upload">Upload Receipt</a>
      <a href="/review-queue">Receipt Review Queue</a>
      <a href="/approved">Approved Receipts</a>
      <a href="/reports">Monthly Reports</a>
      <a href="/settings">Settings</a>
    </nav>
  </header>
  <main>
    {% block content %}{% endblock %}
  </main>
</body>
</html>
"""

DASHBOARD_HTML = """{% extends "base.html" %}
{% block content %}
<h2>Dashboard - {{ dashboard.month }}</h2>
<div class="grid">
  <div class="card"><strong>Receipts needing review</strong><div>{{ dashboard.receipts_needing_review }}</div></div>
  <div class="card"><strong>Approved receipts this month</strong><div>{{ dashboard.approved_receipts }}</div></div>
  <div class="card"><strong>Monthly spending</strong><div>{{ dashboard.monthly_spending_cents }} cents</div></div>
</div>

<h3 class="section-title">Spending by Department</h3>
<table>
  <tr><th>Department</th><th>Total (cents)</th></tr>
  {% for key, value in dashboard.spending_by_department.items() %}
    <tr><td>{{ key }}</td><td>{{ value }}</td></tr>
  {% endfor %}
</table>

<h3 class="section-title">Spending by Location</h3>
<table>
  <tr><th>Location</th><th>Total (cents)</th></tr>
  {% for key, value in dashboard.spending_by_location.items() %}
    <tr><td>{{ key }}</td><td>{{ value }}</td></tr>
  {% endfor %}
</table>

<h3 class="section-title">Spending by Category</h3>
<table>
  <tr><th>Category</th><th>Total (cents)</th></tr>
  {% for key, value in dashboard.spending_by_category.items() %}
    <tr><td>{{ key }}</td><td>{{ value }}</td></tr>
  {% endfor %}
</table>
{% endblock %}
"""

UPLOAD_HTML = """{% extends "base.html" %}
{% block content %}
<h2>Upload Receipt</h2>
<p class="small">Supported formats: JPG, PNG, PDF</p>
<div class="card">
  <form id="uploadForm" enctype="multipart/form-data">
    <input type="file" name="file" accept=".jpg,.jpeg,.png,.pdf" required />
    <div style="margin-top:10px;" class="inline">
      <label><input type="checkbox" name="allow_duplicate" value="true" /> Allow duplicate upload</label>
      <button type="submit">Upload</button>
    </div>
  </form>
  <p id="result" class="small"></p>
  <img id="previewImage" style="margin-top:10px;max-width:420px;display:none;" alt="receipt preview" />
  <embed id="previewPdf" type="application/pdf" style="margin-top:10px;width:100%;height:420px;display:none;" />
</div>
<script>
const form = document.getElementById("uploadForm");
const result = document.getElementById("result");
const previewImage = document.getElementById("previewImage");
const previewPdf = document.getElementById("previewPdf");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const allowDuplicate = form.querySelector('input[name="allow_duplicate"]').checked;
  const query = allowDuplicate ? "?allow_duplicate=true" : "";
  const resp = await fetch(`/api/receipts/upload${query}`, { method: "POST", body: formData });
  const payload = await resp.json();
  if (!resp.ok) {
    result.textContent = payload.error || "Upload failed";
    result.className = "error";
    return;
  }
  result.className = "small";
  result.textContent = `Uploaded receipt ${payload.receipt_id}. Running OCR...`;
  const ocrResp = await fetch(`/api/receipts/${payload.receipt_id}/ocr`, { method: "POST" });
  const ocrPayload = await ocrResp.json();
  if (!ocrResp.ok) {
    result.textContent = ocrPayload.error || "OCR failed";
    result.className = "error";
    return;
  }
  result.textContent = `OCR complete. Status: ${ocrPayload.status}. Open review queue to verify fields.`;
  const file = form.querySelector('input[name="file"]').files[0];
  if (file) {
    const url = URL.createObjectURL(file);
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      previewPdf.style.display = "block";
      previewImage.style.display = "none";
      previewPdf.src = url;
    } else {
      previewImage.style.display = "block";
      previewPdf.style.display = "none";
      previewImage.src = url;
    }
  }
});
</script>
{% endblock %}
"""

REVIEW_QUEUE_HTML = """{% extends "base.html" %}
{% block content %}
<h2>Receipt Review Queue</h2>
{% if not receipts %}
  <p>No receipts currently need review.</p>
{% endif %}

{% for receipt in receipts %}
  <div class="card" style="margin-bottom:16px;">
    <div class="inline">
      <strong>Receipt {{ receipt.receipt_id }}</strong>
      <span class="tag">{{ receipt.status }}</span>
      <a href="/receipts/{{ receipt.receipt_id }}/file" target="_blank">View Original</a>
    </div>
    {% if receipt.verification_error %}
      <p class="warn">{{ receipt.verification_error }}</p>
    {% endif %}
    {% if receipt.duplicate_warning %}
      <p class="warn">{{ receipt.duplicate_warning }}</p>
    {% endif %}
    {% if receipt.ocr.low_confidence_fields %}
      <p class="warn">This receipt has low-confidence fields. Please review before approving.</p>
      <p class="small">Low-confidence fields: {{ receipt.ocr.low_confidence_fields|join(", ") }}</p>
    {% endif %}
    <details>
      <summary>Raw OCR text</summary>
      <pre class="mono">{{ receipt.ocr.raw_text }}</pre>
    </details>
    <form method="post" action="/api/receipts/{{ receipt.receipt_id }}/review-form" class="grid" style="margin-top:10px;">
      <label>Merchant<input name="merchant" value="{{ receipt.approved.merchant or '' }}" /></label>
      <label>Date<input type="date" name="receipt_date" value="{{ receipt.approved.receipt_date or '' }}" /></label>
      <label>Department<input name="department" value="{{ receipt.approved.department or '' }}" /></label>
      <label>Location<input name="location" value="{{ receipt.approved.location or '' }}" /></label>
      <label>Category<input name="category" value="{{ receipt.approved.category or '' }}" /></label>
      <label>Subtotal (cents)<input type="number" name="subtotal_cents" value="{{ receipt.approved.subtotal_cents if receipt.approved.subtotal_cents is not none else '' }}" /></label>
      <label>Tax (cents)<input type="number" name="tax_cents" value="{{ receipt.approved.tax_cents if receipt.approved.tax_cents is not none else '' }}" /></label>
      <label>Tip (cents)<input type="number" name="tip_cents" value="{{ receipt.approved.tip_cents if receipt.approved.tip_cents is not none else '' }}" /></label>
      <label>Total (cents)<input type="number" name="total_cents" value="{{ receipt.approved.total_cents if receipt.approved.total_cents is not none else '' }}" required /></label>
      <label>Payment method<input name="payment_method" value="{{ receipt.approved.payment_method or '' }}" /></label>
      <label>Receipt number<input name="receipt_number" value="{{ receipt.approved.receipt_number or '' }}" /></label>
      <label style="grid-column: 1 / -1;">Line items<textarea name="line_items">{{ receipt.approved.line_items or '' }}</textarea></label>
      <label style="grid-column: 1 / -1;">Notes<textarea name="notes">{{ receipt.approved.notes or '' }}</textarea></label>
      <label style="grid-column: 1 / -1;" class="inline"><input type="checkbox" name="confirm_low_confidence_review" value="true" /> Confirm manual review of uncertain fields</label>
      <div class="inline" style="grid-column: 1 / -1;">
        <button type="submit" name="mark_needs_review" value="true" class="secondary">Save as Needs Review</button>
        <button type="submit" name="approve" value="true">Approve</button>
        <button type="submit" name="reject" value="true" class="secondary">Reject</button>
      </div>
      <p class="small" style="grid-column: 1 / -1;">Required before approval: Date, Merchant, Department or Location, Category, Total</p>
    </form>
  </div>
{% endfor %}
{% endblock %}
"""

APPROVED_RECEIPTS_HTML = """{% extends "base.html" %}
{% block content %}
<h2>Approved Receipts</h2>
<table>
  <tr>
    <th>Date</th><th>Merchant</th><th>Department</th><th>Location</th><th>Category</th>
    <th>Subtotal</th><th>Tax</th><th>Tip</th><th>Total</th><th>Status</th><th>Original</th>
  </tr>
  {% for receipt in receipts %}
    <tr>
      <td>{{ receipt.approved.receipt_date or '' }}</td>
      <td>{{ receipt.approved.merchant or '' }}</td>
      <td>{{ receipt.approved.department or '' }}</td>
      <td>{{ receipt.approved.location or '' }}</td>
      <td>{{ receipt.approved.category or '' }}</td>
      <td>{{ receipt.approved.subtotal_cents if receipt.approved.subtotal_cents is not none else '' }}</td>
      <td>{{ receipt.approved.tax_cents if receipt.approved.tax_cents is not none else '' }}</td>
      <td>{{ receipt.approved.tip_cents if receipt.approved.tip_cents is not none else '' }}</td>
      <td>{{ receipt.approved.total_cents if receipt.approved.total_cents is not none else '' }}</td>
      <td>{{ receipt.status }}</td>
      <td><a href="/receipts/{{ receipt.receipt_id }}/file" target="_blank">View</a></td>
    </tr>
  {% endfor %}
</table>
{% endblock %}
"""

REPORTS_HTML = """{% extends "base.html" %}
{% block content %}
<h2>Monthly Reports</h2>
<div class="card">
  <form id="reportForm" class="inline">
    <label>Report month (YYYY-MM)<input name="report_month" placeholder="2026-04" required /></label>
    <button type="submit">Generate Verified Report</button>
  </form>
  <p id="reportResult" class="small"></p>
</div>

<h3 class="section-title">Saved Reports</h3>
<table>
  <tr><th>Month</th><th>Total (cents)</th><th>Tax (cents)</th><th>Count</th><th>Verified</th><th>Exports</th></tr>
  {% for report in reports %}
    <tr>
      <td>{{ report.report_month }}</td>
      <td>{{ report.total_expense_cents }}</td>
      <td>{{ report.tax_total_cents }}</td>
      <td>{{ report.receipt_count }}</td>
      <td>{{ report.verification_message or "" }}</td>
      <td>
        <a href="/api/reports/{{ report.report_month }}/export/csv">CSV</a> |
        <a href="/api/reports/{{ report.report_month }}/export/pdf">PDF</a> |
        <a href="/api/reports/{{ report.report_month }}/export/xlsx">Excel</a>
      </td>
    </tr>
  {% endfor %}
</table>

<script>
document.getElementById("reportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const month = event.target.report_month.value.trim();
  const out = document.getElementById("reportResult");
  const resp = await fetch(`/api/reports/${month}`, { method: "POST" });
  const payload = await resp.json();
  if (!resp.ok) {
    out.className = "error";
    out.textContent = payload.error || "Report generation failed.";
    return;
  }
  out.className = "small";
  out.textContent = payload.verification_message || "Report generated.";
  window.location.reload();
});
</script>
{% endblock %}
"""

SETTINGS_HTML = """{% extends "base.html" %}
{% block content %}
<h2>Settings</h2>
<p class="small">Default lists plus custom values saved via reviewed receipts.</p>
<div class="grid">
  <div class="card">
    <h3>Departments</h3>
    <ul>{% for item in taxonomy.departments %}<li>{{ item }}</li>{% endfor %}</ul>
  </div>
  <div class="card">
    <h3>Locations</h3>
    <ul>{% for item in taxonomy.locations %}<li>{{ item }}</li>{% endfor %}</ul>
  </div>
  <div class="card">
    <h3>Categories</h3>
    <ul>{% for item in taxonomy.categories %}<li>{{ item }}</li>{% endfor %}</ul>
  </div>
</div>
{% endblock %}
"""


def ensure_templates(settings: AppSettings) -> None:
    settings.templates_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "base.html": BASE_HTML,
        "dashboard.html": DASHBOARD_HTML,
        "upload.html": UPLOAD_HTML,
        "review_queue.html": REVIEW_QUEUE_HTML,
        "approved_receipts.html": APPROVED_RECEIPTS_HTML,
        "reports.html": REPORTS_HTML,
        "settings.html": SETTINGS_HTML,
    }
    for filename, content in files.items():
        path = settings.templates_dir / filename
        if not path.exists():
            path.write_text(content, encoding="utf-8")
