# AGENTS.md

## Repository overview

- This repository contains the full **TradeBot** application on `main`.
- `backend/` is a FastAPI service that fetches market data, computes indicators/patterns, calls Claude for reasoning, and persists analysis history in SQLite.
- `frontend/` is a React + Vite client that calls backend APIs and renders analysis/history views.

## Runtime expectations

- `ANTHROPIC_API_KEY` enables Claude reasoning in the backend.
- `UW_API_KEY` is optional; when missing, API responses set flow data as unavailable and the frontend shows a visible flow-unavailable notice.

## How to run locally

- Backend:
  - `cd backend`
  - `pip3 install -r requirements.txt`
  - `python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Frontend:
  - `cd frontend`
  - `npm install`
  - `npm run dev`

## Useful verification commands

- Run backend indicator sanity tests:
  - `cd backend && python3 -m unittest tests.test_indicator_sanity -v`
- Run a live analysis:
  - `curl -sS -X POST http://127.0.0.1:8000/api/analyze -H 'Content-Type: application/json' -d '{"ticker":"AAPL"}'`

## Data integrity rules

- yfinance news payloads can be nested and can also be empty/unreliable by symbol/time. Parse what is present, and if no valid entries are returned, keep `recent_news` empty/null so the headlines UI stays hidden.
- Price-series consistency rule: use unadjusted OHLCV (`auto_adjust=False`) for chart candles, indicators, and support/resistance detection so all displayed levels are in the same traded-price basis.
- Never inject fake, sample, or placeholder data to make a feature appear to work. Missing data hides the feature. This is a financial analysis app — fabricated data is worse than no data.
- Morning scan cost guardrail: explicit watchlist is capped at 10 symbols to keep the pre-market scan to roughly 11 Claude calls max (10 ticker analyses + 1 briefing synthesis).
