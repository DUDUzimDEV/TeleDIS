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
    initial_admin_email: str = Field(default="admin@fazendaoperacional.invalid", alias="INITIAL_ADMIN_EMAIL")
    initial_farm_name: str = Field(default="Fazenda Dev/Teste TeleDis", alias="INITIAL_FARM_NAME")
    initial_farm_code: str = Field(default="DEV-TEST-001", alias="INITIAL_FARM_CODE")
    database_url: str = Field(default="postgresql+psycopg://teledis:teledis_password@localhost:5432/teledis", alias="DATABASE_URL")
    mqtt_host: str = Field(default="localhost", alias="MQTT_HOST")
    mqtt_port: int = Field(default=1883, alias="MQTT_PORT")
    mqtt_client_id: str = Field(default="teledis-api", alias="MQTT_CLIENT_ID")
    mqtt_username: str = Field(default=None, alias="MQTT_USERNAME")
    mqtt_password: str = Field(default=None, alias="MQTT_PASSWORD")
    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    route_snap_max_distance_m: float = Field(default=100.0, gt=0, alias="ROUTE_SNAP_MAX_DISTANCE_M")
    route_deviation_tolerance_m: float = Field(
        default=25.0,
        gt=0,
        alias="ROUTE_DEVIATION_TOLERANCE_METERS",
    )
    operational_proximity_default_m: int = Field(
        default=500,
        ge=0,
        le=10000,
        alias="OPERATIONAL_PROXIMITY_DEFAULT_METERS",
    )
    operational_proximity_max_m: int = Field(
        default=10000,
        gt=0,
        le=10000,
        alias="OPERATIONAL_PROXIMITY_MAX_METERS",
    )
    route_problem_segment_tolerance_m: float = Field(
        default=1.0,
        gt=0,
        alias="ROUTE_PROBLEM_SEGMENT_TOLERANCE_M",
    )
    route_penalty_low: float = Field(default=1.10, ge=1, alias="ROUTE_PENALTY_LOW")
    route_penalty_medium: float = Field(default=1.30, ge=1, alias="ROUTE_PENALTY_MEDIUM")
    route_penalty_high: float = Field(default=1.70, ge=1, alias="ROUTE_PENALTY_HIGH")
    route_penalty_critical: float = Field(default=3.00, ge=1, alias="ROUTE_PENALTY_CRITICAL")

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
