from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Validated env. Fails fast on boot if any required var is missing."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Runtime DB connection as the restricted taskflow_app role. RLS applies.
    DATABASE_URL_APP: str

    # Shared secret for core-api → analytics calls. Both services carry the same value.
    INTERNAL_SERVICE_SECRET: str = Field(min_length=16)

    PORT: int = 3002
    LOG_LEVEL: str = "info"


settings = Settings()  # type: ignore[call-arg]
