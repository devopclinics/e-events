"""Environment configuration for the Festio design-service.

Decoupled from the core event backend — this service holds only design/template
data and never imports core event logic. All values come from env (see the
DESIGN_* vars in docker-compose), with safe defaults for local runs.
"""
import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


class Settings:
    port: int = _int("DESIGN_SERVICE_PORT", 8010)
    upload_max_mb: int = _int("DESIGN_UPLOAD_MAX_MB", 10)
    allowed_file_types: list[str] = [
        t.strip().lower()
        for t in os.getenv("DESIGN_ALLOWED_FILE_TYPES", "jpg,jpeg,png,webp").split(",")
        if t.strip()
    ]
    public_asset_base_url: str = os.getenv("DESIGN_PUBLIC_ASSET_BASE_URL", "https://festio.events").rstrip("/")
    storage_path: str = os.getenv("DESIGN_STORAGE_PATH", "/app/data/design-assets")
    template_packs_path: str = os.getenv(
        "DESIGN_TEMPLATE_PACKS_PATH",
        os.path.join(storage_path, "packs"),
    )
    enable_svg_upload: bool = os.getenv("DESIGN_ENABLE_SVG_UPLOAD", "false").lower() == "true"
    render_timeout_seconds: int = _int("DESIGN_RENDER_TIMEOUT_SECONDS", 30)
    # Shared secret the core backend/proxy sends on write + internal-theme calls.
    # Ownership of the event is enforced UPSTREAM (the admin backend checks the
    # user owns the event, then calls us). Public-theme needs no token.
    internal_token: str = os.getenv("DESIGN_INTERNAL_TOKEN", "")
    # Comma-separated CORS origins; "*" allows any (default for phase 1).
    cors_origins: list[str] = [
        o.strip() for o in os.getenv("DESIGN_CORS_ORIGINS", "*").split(",") if o.strip()
    ]


settings = Settings()
