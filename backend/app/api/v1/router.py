from fastapi import APIRouter

from app.api.v1.endpoints.audit import router as audit_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.farms import router as farms_router
from app.api.v1.endpoints.fields import router as fields_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.locations import router as locations_router
from app.api.v1.endpoints.maquinas import router as machines_router
from app.api.v1.endpoints.roads import router as roads_router
from app.api.v1.endpoints.road_problems import router as road_problems_router
from app.api.v1.endpoints.routes import router as routes_router
from app.api.v1.endpoints.roles import router as roles_router
from app.api.v1.endpoints.structures import router as structures_router
from app.api.v1.endpoints.telemetria import router as telemetry_router
from app.api.v1.endpoints.teams import router as teams_router
from app.api.v1.endpoints.operations import router as operations_router
from app.api.v1.endpoints.simulator import router as simulator_router
from app.api.v1.endpoints.users import router as users_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router, prefix="/auth")
api_router.include_router(farms_router, prefix="/farms")
api_router.include_router(users_router, prefix="/users")
api_router.include_router(roles_router, prefix="/roles")
api_router.include_router(audit_router, prefix="/audit-logs")
api_router.include_router(fields_router, prefix="/fields")
api_router.include_router(machines_router, prefix="/machines")
api_router.include_router(telemetry_router, prefix="/telemetry")
api_router.include_router(locations_router, prefix="/locations")
api_router.include_router(roads_router, prefix="/roads")
api_router.include_router(road_problems_router, prefix="/road-problems")
api_router.include_router(routes_router, prefix="/routes")
api_router.include_router(structures_router, prefix="/structures")
api_router.include_router(teams_router, prefix="/teams")
api_router.include_router(operations_router, prefix="/operations")
api_router.include_router(simulator_router, prefix="/simulator")
