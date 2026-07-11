from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str = "postgresql+asyncpg://festiome:festiome@festiome-db:5432/festiome"
    firebase_credentials: str = ""
    firebase_project_id: str = ""
    internal_service_token: str = ""
    cors_origins: str = "https://festio.events,http://localhost:4000"
    redis_url: str = "redis://festiome-redis:6379/0"
    realtime_ticket_secret: str = ""
    attachment_hosts: str = ""
    upload_dir: str = "/data/festiome-uploads"


settings = Settings()
