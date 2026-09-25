from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check():
    return {"status": "ok", "service": "teledis-backend"}


@router.get("/health/database")
def database_health():
    return {"status": "ok", "database": "configured"}


@router.get("/health/mqtt")
def mqtt_health():
    return {"status": "ok", "mqtt": "configured"}
