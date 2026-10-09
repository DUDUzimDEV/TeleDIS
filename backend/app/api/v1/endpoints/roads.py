from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.security import require_permission
from app.database import SessionLocal
from app.repositories.road_repository import InvalidRoadGeometry
from app.schemas.road import RoadCreate, RoadRead
from app.services.road_service import RoadService
from app.services.audit_service import record_audit
from app.services.spatial_validation_service import SpatialValidationError

router = APIRouter(tags=["roads"])
service = RoadService()


@router.post("", response_model=RoadRead, status_code=status.HTTP_201_CREATED)
def create_road(payload: RoadCreate, request: Request,
                context: dict = Depends(require_permission("roads.create"))):
    try:
        road = service.create_road(payload, context["farm_id"])
        with SessionLocal.begin() as db:
            record_audit(db, context=context, action="roads.create", resource="road",
                         resource_id=road["id"], request=request)
        return road
    except InvalidRoadGeometry as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except SpatialValidationError as exc:
        status_code = 409 if exc.code == "OPERATIONAL_AREA_NOT_CONFIGURED" else 422
        raise HTTPException(
            status_code=status_code,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc


@router.get("", response_model=list[RoadRead])
def list_roads(context: dict = Depends(require_permission("roads.view"))):
    return service.list_roads(context["farm_id"])


@router.get("/{road_id}", response_model=RoadRead)
def get_road(road_id: int, context: dict = Depends(require_permission("roads.view"))):
    road = service.get_road(road_id, context["farm_id"])
    if road is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Via não encontrada.")
    return road