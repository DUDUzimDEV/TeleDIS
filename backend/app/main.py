import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi

from app.api.v1.router import api_router
from app.config import get_settings
from app.services.mqtt_service import MqttService

settings = get_settings()
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stdout,
    force=True,
)
mqtt_service = MqttService()

app = FastAPI(
    title="TeleDis API",
    version="0.1.0",
    description="API base para sistema de telemetria agrícola.",
    docs_url="/docs",
    redoc_url="/redoc",
)


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )

    openapi_schema.setdefault("components", {})
    openapi_schema["components"]["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Informe o token JWT gerado no login. Exemplo: Bearer <token>",
        }
    }

    protected_paths = {"/api/v1/auth/me", "/api/v1/auth/logout"}
    for path, operations in openapi_schema.get("paths", {}).items():
        if path in {"/api/v1/auth/login"}:
            continue
        for operation in operations.values():
            if isinstance(operation, dict):
                if path in protected_paths:
                    operation["security"] = [{"BearerAuth": []}]
                else:
                    operation.pop("security", None)

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi

origins = [origin.strip() for origin in settings.cors_origins.split(',') if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.on_event("startup")
def startup_event():
    mqtt_service.start()


@app.on_event("shutdown")
def shutdown_event():
    mqtt_service.stop()


@app.get("/health")
def health_check():
    return {"status": "ok", "service": settings.app_name}


@app.get("/health/database")
def database_health():
    return {"status": "ok", "database": "pending_configuration"}


@app.get("/health/mqtt")
def mqtt_health():
    return {"status": "ok", "mqtt": "pending_configuration"}
