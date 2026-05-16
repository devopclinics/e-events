from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://checkin:checkin@localhost/checkin"
    secret_key: str = "changeme-in-production"

    # JWT
    jwt_secret: str = "changeme-jwt-secret"
    jwt_expire_minutes: int = 1440  # 24 hours

    # Google OAuth (optional — leave blank to disable)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/auth/google/callback"
    frontend_url: str = "http://localhost:5173"

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_tls: bool = True
    email_from: str = "noreply@event.com"

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
