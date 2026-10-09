from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.security import require_permission
from app.database import SessionLocal
from app.repositories.structure_repository import InvalidStructureGeometry
from app.schemas.structure import StructureCreate, StructureRead
from app.services.structure_service import StructureService
from app.services.audit_service import record_audit
from app.services.spatial_validation_service import SpatialValidationError

router = APIRouter(tags=["structures"])
service = StructureService()


@router.post("", response_model=StructureRead, status_code=status.HTTP_201_CREATED)
def create_structure(payload: StructureCreate, request: Request,
                     context: dict = Depends(require_permission("structures.create"))):
    try:
        structure = service.create_structure(payload, context["farm_id"])
        with SessionLocal.begin() as db:
            record_audit(db, context=context, action="structures.create", resource="structure",
                         resource_id=structure["id"], request=request)
        return structure
    except InvalidStructureGeometry as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except SpatialValidationError as exc:
        status_code = 409 if exc.code == "OPERATIONAL_AREA_NOT_CONFIGURED" else 422
        raise HTTPException(
            status_code=status_code,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc


@router.get("", response_model=list[StructureRead])
def list_structures(context: dict = Depends(require_permission("structures.view"))):
    return service.list_structures(context["farm_id"])


@router.get("/{structure_id}", response_model=StructureRead)
def get_structure(structure_id: int, context: dict = Depends(require_permission("structures.view"))):
    structure = service.get_structure(structure_id, context["farm_id"])
    if structure is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Estrutura não encontrada.")
    return structure