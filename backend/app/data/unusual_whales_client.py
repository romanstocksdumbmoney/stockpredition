from __future__ import annotations

from typing import Any

import requests


class UnusualWhalesClient:
    """
    Fetches options-flow context from Unusual Whales when configured.
    Falls back gracefully when key/endpoints are unavailable.
    """

    def __init__(self, api_key: str | None, base_url: str = "https://api.unusualwhales.com", timeout: int = 8):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            # Different UW plans/apps may expect one of these header formats.
            headers["Authorization"] = f"Bearer {self.api_key}"
            headers["X-Api-Key"] = self.api_key
        return headers

    def _get(self, path: str, params: dict[str, Any]) -> requests.Response:
        return requests.get(
            f"{self.base_url}{path}",
            params=params,
            headers=self._headers(),
            timeout=self.timeout,
        )

    @staticmethod
    def _extract_alerts(payload: Any) -> list[dict[str, Any]]:
        rows: list[Any]
        if isinstance(payload, dict):
            rows = payload.get("data") or payload.get("results") or payload.get("alerts") or []
        elif isinstance(payload, list):
            rows = payload
        else:
            rows = []

        alerts: list[dict[str, Any]] = []
        for row in rows[:30]:
            if not isinstance(row, dict):
                continue
            alerts.append(
                {
                    "time": row.get("executed_at") or row.get("timestamp") or row.get("time"),
                    "side": row.get("side") or row.get("option_type"),
                    "strike": row.get("strike"),
                    "expiration": row.get("expiration") or row.get("expiry"),
                    "premium": row.get("premium") or row.get("notional"),
                    "size": row.get("size") or row.get("volume"),
                    "is_unusual": row.get("is_unusual") or row.get("unusual"),
                }
            )
        return alerts

    @staticmethod
    def _safe_number(value: Any) -> float | None:
        try:
            if value is None:
                return None
            return float(value)
        except Exception:
            return None

    def fetch_symbol_flow(self, symbol: str) -> dict[str, Any]:
        if not self.api_key:
            return {
                "available": False,
                "status": "missing_api_key",
                "message": "UW_API_KEY is not set; options flow data is unavailable in this environment.",
                "flow_alerts": [],
                "unusual_volume_count": 0,
                "call_put_ratio": None,
                "net_premium": None,
                "dark_pool_notional": None,
                "gamma_exposure": None,
            }

        symbol = symbol.upper()
        failures: list[str] = []

        flow_payload: Any = None
        for path, params in [
            ("/api/flow", {"ticker": symbol, "limit": 50}),
            ("/api/options/flow", {"symbol": symbol, "limit": 50}),
            ("/api/option-trades/flow-alerts", {"ticker": symbol, "limit": 50}),
        ]:
            try:
                response = self._get(path, params)
            except requests.RequestException as exc:
                failures.append(f"{path}: request failed ({exc})")
                continue

            if response.status_code in (401, 403):
                return {
                    "available": False,
                    "status": "auth_error",
                    "message": "Unusual Whales API key was rejected (401/403).",
                    "flow_alerts": [],
                    "unusual_volume_count": 0,
                    "call_put_ratio": None,
                    "net_premium": None,
                    "dark_pool_notional": None,
                    "gamma_exposure": None,
                }

            if response.ok:
                try:
                    flow_payload = response.json()
                    break
                except ValueError:
                    failures.append(f"{path}: response was not valid JSON")
            else:
                failures.append(f"{path}: HTTP {response.status_code}")

        if flow_payload is None:
            return {
                "available": False,
                "status": "unavailable",
                "message": "Options flow endpoints were unreachable or unsupported for this key/ticker.",
                "debug": failures[:3],
                "flow_alerts": [],
                "unusual_volume_count": 0,
                "call_put_ratio": None,
                "net_premium": None,
                "dark_pool_notional": None,
                "gamma_exposure": None,
            }

        alerts = self._extract_alerts(flow_payload)
        unusual_count = sum(1 for a in alerts if a.get("is_unusual"))

        call_premium = 0.0
        put_premium = 0.0
        net_premium = 0.0
        for alert in alerts:
            premium = self._safe_number(alert.get("premium")) or 0.0
            side = str(alert.get("side") or "").lower()
            if "call" in side or side == "c":
                call_premium += premium
                net_premium += premium
            elif "put" in side or side == "p":
                put_premium += premium
                net_premium -= premium

        ratio = None
        if put_premium > 0:
            ratio = call_premium / put_premium
        elif call_premium > 0:
            ratio = 9.99

        return {
            "available": True,
            "status": "ok",
            "message": "Flow context loaded from Unusual Whales.",
            "flow_alerts": alerts[:15],
            "unusual_volume_count": unusual_count,
            "call_put_ratio": round(ratio, 3) if ratio is not None else None,
            "net_premium": round(net_premium, 2),
            "dark_pool_notional": None,
            "gamma_exposure": None,
        }
