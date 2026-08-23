from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://engagement:engagement@localhost/engagement"
    # Shared-secret HS256 token minted by the main backend's
    # POST /api/auth/live-token (staff) or POST /api/events/{id}/live/guest-token
    # (guest) — same pattern as planner_internal_token / festiome_internal_token.
    # engagement-service never calls the main backend or its database; it only
    # verifies this token's signature + claims on every request.
    internal_service_token: str = ""
    cors_origins: str = "https://festio.events,http://localhost:4000"
    redis_url: str = "redis://engagement-redis:6379/0"
    local_ai_url: str = "http://local-ai:8080"


settings = Settings()
