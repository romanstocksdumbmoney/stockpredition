# TradeBot

TradeBot is an AI trading copilot (not an autonomous trader).  
It weighs both bull and bear cases, explains its reasoning, and returns a conservative confidence percentage with risk flags.

## Stack

- **Backend:** FastAPI + SQLite
- **Frontend:** React + Tailwind (Vite)
- **Market data:** yfinance
- **Options flow:** Unusual Whales API (optional, graceful fallback)
- **Reasoning:** Claude API (Anthropic)

---

## Environment Variables

Create a `.env` file in `backend/` or export these in your shell:

```bash
ANTHROPIC_API_KEY=
UW_API_KEY=
```

Optional:

```bash
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
UW_BASE_URL=https://api.unusualwhales.com
DATABASE_URL=sqlite:///./tradebot.db
```

If `UW_API_KEY` is missing, TradeBot still works and marks options flow as unavailable.

---

## Backend Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API endpoints:

- `POST /api/analyze` – run full analysis pipeline and save to history
- `GET /api/history` – list prior analyses
- `POST /api/history/{id}/outcome` – mark call outcome (`right`, `wrong`, `mixed`)
- `GET /api/ticker/{symbol}/chart` – raw OHLCV chart payload

---

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend defaults to `http://localhost:5173` and proxies `/api/*` to `http://localhost:8000`.

---

## Core App Behavior

For each analysis, TradeBot:

1. Pulls OHLCV + fundamentals from Yahoo Finance
2. Computes RSI, MACD, EMA(9/21/50/200), Bollinger Bands, ATR, and volume trend/profile
3. Runs explainable chart-pattern detection (support/resistance, breakout/breakdown, trend, consolidation)
4. Pulls options-flow context from Unusual Whales when available
5. Sends structured payload to Claude and enforces a strict JSON response contract
6. Stores the final result in SQLite for historical review

Every output includes a visible disclaimer:

> TradeBot weighs signals but doesn't predict the future. This is not financial advice.
