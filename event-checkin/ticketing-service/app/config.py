from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://ticketing:ticketing@ticketing-db:5432/ticketing"
    service_enabled: bool = False
    environment: str = "staging"
    public_base_url: str = "https://staging.festio.events"
    cors_origins: str = "https://staging.festio.events,http://localhost:4000"
    internal_service_token: str = ""
    core_backend_url: str = "http://backend:8000"
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    paystack_secret_key: str = ""
    paystack_webhook_secret: str = ""
    platform_fee_bps: int = 500
    inventory_hold_minutes: int = 10
    waitlist_offer_minutes: int = 30
    waitlist_reminder_minutes: int = 10
    operations_interval_seconds: int = 60

    def assert_safe_environment(self) -> None:
        environment = self.environment.lower()
        if environment not in {"staging", "production"}:
            raise RuntimeError("ticketing environment must be staging or production")
        if not self.internal_service_token:
            raise RuntimeError("ticketing internal service token is required")
        if environment == "production":
            if self.public_base_url.rstrip("/") != "https://festio.events":
                raise RuntimeError("production ticketing URL must be https://festio.events")
            if self.service_enabled and self.stripe_secret_key and not self.stripe_secret_key.startswith("sk_live_"):
                raise RuntimeError("production Stripe credential must be a live key")
            if self.service_enabled and self.paystack_secret_key and not self.paystack_secret_key.startswith("sk_live_"):
                raise RuntimeError("production Paystack credential must be a live key")
        else:
            if "staging" not in self.public_base_url and "localhost" not in self.public_base_url:
                raise RuntimeError("staging ticketing URL must be staging or localhost")
            if self.stripe_secret_key.startswith("sk_live_"):
                raise RuntimeError("Stripe live keys are forbidden in staging")
            if self.paystack_secret_key.startswith("sk_live_"):
                raise RuntimeError("Paystack live keys are forbidden in staging")


settings = Settings()
