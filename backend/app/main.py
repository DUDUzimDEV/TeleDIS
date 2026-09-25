from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="TeleDis API",
    version="0.1.0",
    description="API base para sistema de telemetria agrícola.",
    docs_url="/docs",
    redoc_url="/redoc",
)

origins = [origin.strip() for origin in settings.cors_origins.split(',') if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
def health_check():
    return {"status": "ok", "service": settings.app_name}


@app.get("/health/database")
def database_health():
    return {"status": "ok", "database": "pending_configuration"}


@app.get("/health/mqtt")
def mqtt_health():
    return {"status": "ok", "mqtt": "pending_configuration"}
