from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Read-only role — this service must never be able to write guest data,
    # even if a bug tried to. Grants are enforced at the Postgres level via
    # the dashboard_ro role, not just by convention in this codebase.
    database_url: str = "postgresql+asyncpg://dashboard_ro:dashboard_ro@db:5432/checkin"
    frontend_url: str = "http://localhost:5173"
    firebase_credentials: str = ""
    superadmin_emails: str = ""
    # Optional: Festio Live participation stat on the Operations tab. Same
    # shared secret engagement-service itself verifies (see that service's
    # app/config.py). Blank here (dev/older deploys) just means the stat is
    # omitted -- see festio_live_participation() in main.py.
    engagement_internal_token: str = ""
    engagement_url: str = "http://engagement-service:8060"


settings = Settings()
