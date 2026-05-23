from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://checkin:checkin@localhost/checkin"
    frontend_url: str = "http://localhost:5173"

    # Firebase — paste the service account JSON as a single-line string
    firebase_credentials: str = ""

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
