import ipaddress
import re
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_file=None,
        hide_input_in_errors=True,
    )

    # Dedicated read-only connection only. Never consume Backend's DATABASE_URL
    # or provide credential/endpoint defaults here. The explicit user is pinned
    # to the provisioned read-only role; Postgres grants enforce its permissions.
    dashboard_db_host: str
    dashboard_db_port: int = Field(ge=1, le=65535)
    dashboard_db_name: str
    dashboard_db_user: Literal["dashboard_ro"]
    dashboard_ro_db_password: SecretStr = Field(repr=False)

    frontend_url: str = "http://localhost:5173"
    firebase_credentials: str = ""
    organization_entitlements_v2: bool = False
    superadmin_emails: str = ""
    # Optional: Festio Live participation stat on the Operations tab. Same
    # shared secret engagement-service itself verifies (see that service's
    # app/config.py). Blank here (dev/older deploys) just means the stat is
    # omitted -- see festio_live_participation() in main.py.
    engagement_internal_token: str = ""
    engagement_url: str = "http://engagement-service:8060"

    @field_validator("dashboard_db_name", "dashboard_db_user")
    @classmethod
    def validate_database_identifier(cls, value: str) -> str:
        if (
            not value
            or value != value.strip()
            or any(ord(char) < 32 or ord(char) == 127 for char in value)
        ):
            raise ValueError("must be nonempty without surrounding whitespace or control characters")
        return value

    @field_validator("dashboard_db_host")
    @classmethod
    def validate_database_host(cls, value: str) -> str:
        error = "must be a host name or IP address without a URL, path, or port"
        if any(char.isspace() or char in "/\\@?#%" for char in value):
            raise ValueError(error)
        try:
            ipaddress.ip_address(value)
            return value
        except ValueError:
            pass
        # A host is not a connection URL, socket path, or host:port pair.
        labels = value.removesuffix(".").split(".")
        if (
            len(value) > 253
            or not all(
                re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
                for label in labels
            )
            or all(label.isdecimal() for label in labels)
        ):
            raise ValueError(error)
        return value

    @field_validator("dashboard_db_port", mode="before")
    @classmethod
    def validate_database_port(cls, value: object) -> object:
        if isinstance(value, bool) or not (
            isinstance(value, int)
            or (isinstance(value, str) and re.fullmatch(r"[0-9]+", value))
        ):
            raise ValueError("must be an integer from 1 to 65535")
        return value

    @field_validator("dashboard_ro_db_password")
    @classmethod
    def validate_database_password(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("must not be blank")
        # Whitespace and reserved URL characters in a real password are literal.
        return value


settings = Settings()
