from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.security import require_permission
from app.repositories.field_repository import InvalidFieldGeometry
from app.schemas.field import FieldCreate, FieldRead
from app.services.field_service import FieldService
from app.database import SessionLocal
from app.services.audit_service import record_audit
from app.services.spatial_validation_service import SpatialValidationError

router = APIRouter(tags=["fields"])
service = FieldService()


@router.post("", response_model=FieldRead, status_code=status.HTTP_201_CREATED)
def create_field(payload: FieldCreate, request: Request, context: dict = Depends(require_permission("fields.create"))):
    try:
        field = service.create_field(payload, context["farm_id"])
        with SessionLocal.begin() as db:
            record_audit(db, context=context, action="fields.create", resource="field",
                         resource_id=field["id"], request=request)
        return field
    except InvalidFieldGeometry as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except SpatialValidationError as exc:
        status_code = 409 if exc.code == "OPERATIONAL_AREA_NOT_CONFIGURED" else 422
        raise HTTPException(
            status_code=status_code,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc


@router.get("", response_model=list[FieldRead])
def list_fields(context: dict = Depends(require_permission("fields.view"))):
    return service.list_fields(context["farm_id"])


@router.get("/{field_id}", response_model=FieldRead)
def get_field(field_id: int, context: dict = Depends(require_permission("fields.view"))):
    field = service.get_field(field_id, context["farm_id"])
    if field is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Talhão não encontrado.")
    return field