from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://public_site:public_site@localhost/public_site"
    internal_service_token: str = ""
    public_base_url: str = "http://localhost:8070"
    enabled: bool = False


settings = Settings()

