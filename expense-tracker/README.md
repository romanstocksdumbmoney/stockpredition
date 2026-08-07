# Expense Tracker

A standalone expense reporting web app with:

- FastAPI backend (`backend/`)
- Next.js frontend (`frontend/`)
- SQLite database auto-created on startup
- AI-powered receipt scanning with OpenAI Vision
- Weekly/monthly/custom reports
- PDF and CSV export

## Quick Start

```bash
cd expense-tracker
bash start.sh
```

Then open:

- App: http://localhost:3000
- API: http://localhost:8000
- API docs: http://localhost:8000/docs

## Key Paths

- `backend/main.py` — FastAPI app entrypoint
- `backend/routes/` — API endpoints
- `backend/services/` — scanner + exports
- `frontend/app/` — Next.js pages
- `SETUP.md` — full setup guide
