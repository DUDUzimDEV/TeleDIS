from functools import lru_cache

from pydantic import BaseSettings, Field


class Settings(BaseSettings):
    app_name: str = "TeleDis"
    api_env: str = Field(default="development", alias="API_ENV")
    secret_key: str = Field(default="change-me", alias="SECRET_KEY")
    jwt_secret: str = Field(default="change-me", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expire_minutes: int = Field(default=60, alias="JWT_EXPIRE_MINUTES")
    default_admin_password: str = Field(default="Admin@123", alias="DEFAULT_ADMIN_PASSWORD")
    database_url: str = Field(default="postgresql+psycopg://teledis:teledis_password@localhost:5432/teledis", alias="DATABASE_URL")
    mqtt_host: str = Field(default="localhost", alias="MQTT_HOST")
    mqtt_port: int = Field(default=1883, alias="MQTT_PORT")
    mqtt_client_id: str = Field(default="teledis-api", alias="MQTT_CLIENT_ID")
    mqtt_username: str = Field(default=None, alias="MQTT_USERNAME")
    mqtt_password: str = Field(default=None, alias="MQTT_PASSWORD")
    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
