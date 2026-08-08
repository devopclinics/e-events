from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://planner:planner@localhost/planner"
    # Shared-secret HS256 token minted by the main backend's
    # POST /api/auth/planner-token — same pattern as festiome_internal_token /
    # design_internal_token. Planner-service never calls the main backend or
    # its database; it only verifies this token's signature + claims
    # (event_id, org_id, role) on every request.
    internal_service_token: str = ""
    cors_origins: str = "https://festio.events,http://localhost:4000"
    upload_dir: str = "/data/planner-uploads"


settings = Settings()
