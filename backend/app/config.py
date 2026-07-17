import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    app_name: str = "TradeBot"
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./tradebot.db")
    anthropic_api_key: str | None = os.getenv("ANTHROPIC_API_KEY")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
    uw_api_key: str | None = os.getenv("UW_API_KEY")
    uw_base_url: str = os.getenv("UW_BASE_URL", "https://api.unusualwhales.com")
    cors_origins: list[str] = field(
        default_factory=lambda: [
            origin.strip()
            for origin in os.getenv(
                "CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if origin.strip()
        ]
    )


settings = Settings()
