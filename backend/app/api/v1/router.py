from fastapi import APIRouter

from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.maquinas import router as machines_router
from app.api.v1.endpoints.telemetria import router as telemetry_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router, prefix="/auth")
api_router.include_router(machines_router, prefix="/machines")
api_router.include_router(telemetry_router, prefix="/telemetry")
