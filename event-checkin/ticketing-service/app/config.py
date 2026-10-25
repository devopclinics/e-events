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
    checkout_ip_per_minute: int = 120
    checkout_email_per_hour: int = 10
    checkout_pending_per_email: int = 3
    trusted_proxy_cidrs: str = "127.0.0.1/32,::1/128,192.168.0.0/16"
    # Cloudflare's published edge networks; only use its client header when the
    # nearest non-cluster forwarded hop is an actual Cloudflare edge.
    cloudflare_proxy_cidrs: str = "173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32"
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
