from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Read-only role — this service must never be able to write guest data,
    # even if a bug tried to. Grants are enforced at the Postgres level via
    # the dashboard_ro role, not just by convention in this codebase.
    database_url: str = "postgresql+asyncpg://dashboard_ro:dashboard_ro@db:5432/checkin"
    frontend_url: str = "http://localhost:5173"
    firebase_credentials: str = ""
    superadmin_emails: str = ""


settings = Settings()
