from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import get_current_user, get_db, get_farm_context, require_permission
from app.database import SessionLocal
from app.models.user import Farm, Permission, Role, RolePermission, UserFarm, UserPermission
from app.schemas.farm import FarmCreate, FarmUpdate
from app.schemas.operational_area import OperationalAreaWrite, SpatialResourceValidation
from app.services.audit_service import record_audit
from app.services.spatial_validation_service import (
    OperationalAreaConflict,
    SpatialValidationError,
    spatial_validation_service,
)

router = APIRouter(tags=["farms"])


def _assert_active_farm(farm_id: int, context: dict) -> None:
    if context["farm_id"] != farm_id:
        raise HTTPException(status_code=404, detail="Fazenda não encontrada.")


def _area_error(exc: SpatialValidationError):
    status_code = 409 if exc.code == "OPERATIONAL_AREA_NOT_CONFIGURED" else 422
    raise HTTPException(
        status_code=status_code,
        detail={"code": exc.code, "message": str(exc)},
    ) from exc


def _area_conflict(exc: OperationalAreaConflict):
    raise HTTPException(
        status_code=409,
        detail={
            "code": "OPERATIONAL_AREA_CONFLICT",
            "message": str(exc),
            "resources": exc.resources,
        },
    ) from exc


@router.get("/{farm_id}/operational-area")
def get_operational_area(
    farm_id: int,
    context: dict = Depends(require_permission("farm.view")),
):
    _assert_active_farm(farm_id, context)
    return {"success": True, "data": spatial_validation_service.get_area(farm_id)}


@router.post("/{farm_id}/operational-area/preview")
def preview_operational_area(
    farm_id: int,
    payload: OperationalAreaWrite,
    context: dict = Depends(require_permission("farm.update")),
):
    _assert_active_farm(farm_id, context)
    try:
        data = spatial_validation_service.preview_area(
            farm_id,
            payload.geometry,
            payload.proximity_radius_m,
        )
    except SpatialValidationError as exc:
        _area_error(exc)
    return {"success": True, "data": data}


@router.post("/{farm_id}/operational-area/validate-resource")
def validate_spatial_resource(
    farm_id: int,
    payload: SpatialResourceValidation,
    context: dict = Depends(get_farm_context),
):
    _assert_active_farm(farm_id, context)
    permission = {
        "field": "fields.create",
        "structure": "structures.create",
        "road": "roads.create",
    }[payload.resource_type]
    if permission not in context["permissions"]:
        raise HTTPException(status_code=403, detail=f"Permissão necessária: {permission}")
    try:
        with SessionLocal() as db:
            result = spatial_validation_service.validate_resource(
                db,
                farm_id,
                payload.resource_type,
                payload.geometry,
            )
    except SpatialValidationError as exc:
        _area_error(exc)
    return {"success": True, "data": result}


@router.put("/{farm_id}/operational-area")
def save_operational_area(
    farm_id: int,
    payload: OperationalAreaWrite,
    request: Request,
    context: dict = Depends(require_permission("farm.update")),
):
    _assert_active_farm(farm_id, context)
    try:
        data = spatial_validation_service.save_area(
            farm_id,
            payload.geometry,
            payload.proximity_radius_m,
        )
    except SpatialValidationError as exc:
        _area_error(exc)
    except OperationalAreaConflict as exc:
        _area_conflict(exc)
    with SessionLocal.begin() as db:
        record_audit(
            db,
            context=context,
            action="farm.operational_area.update",
            resource="farm",
            resource_id=farm_id,
            request=request,
            details={"proximity_radius_m": payload.proximity_radius_m},
        )
    return {"success": True, "data": data}


@router.delete("/{farm_id}/operational-area")
def delete_operational_area(
    farm_id: int,
    request: Request,
    context: dict = Depends(require_permission("farm.update")),
):
    _assert_active_farm(farm_id, context)
    try:
        data = spatial_validation_service.delete_area(farm_id)
    except OperationalAreaConflict as exc:
        _area_conflict(exc)
    with SessionLocal.begin() as db:
        record_audit(
            db,
            context=context,
            action="farm.operational_area.delete",
            resource="farm",
            resource_id=farm_id,
            request=request,
        )
    return {"success": True, "data": data}


@router.get("")
def list_farms(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    memberships = (
        db.query(UserFarm, Farm, Role)
        .join(Farm, Farm.id == UserFarm.farm_id)
        .join(Role, Role.id == UserFarm.role_id)
        .filter(
            UserFarm.user_id == current_user["id"],
            UserFarm.status == "active",
            Farm.status == "active",
        )
        .order_by(Farm.name)
        .all()
    )
    result = []
    for membership, farm, role in memberships:
        permissions = {
            row.code for row in db.query(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .filter(RolePermission.role_id == role.id)
        }
        if role.name == "OWNER":
            permissions = {row.code for row in db.query(Permission.code)}
        else:
            overrides = (
                db.query(Permission.code, UserPermission.allowed)
                .join(UserPermission, UserPermission.permission_id == Permission.id)
                .filter(UserPermission.user_id == current_user["id"], UserPermission.farm_id == farm.id)
            )
            for code, allowed in overrides:
                if allowed:
                    permissions.add(code)
                else:
                    permissions.discard(code)
        result.append({
            "id": farm.id,
            "name": farm.name,
            "code": farm.code,
            "tax_identifier": farm.tax_identifier,
            "municipality": farm.municipality,
            "state": farm.state,
            "area_ha": farm.area_ha,
            "status": farm.status,
            "owner_user_id": farm.owner_user_id,
            "created_at": farm.created_at,
            "role": role.name,
            "permissions": sorted(permissions),
            "last_access_at": membership.last_access_at,
            "operational_area_configured": db.execute(
                text("SELECT operational_area IS NOT NULL FROM farms WHERE id = :farm_id"),
                {"farm_id": farm.id},
            ).scalar_one(),
        })
    return {"success": True, "data": result}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_farm(
    payload: FarmCreate,
    request: Request,
    context: dict = Depends(require_permission("farm.create")),
):
    with SessionLocal.begin() as db:
        owner_role = db.query(Role).filter(Role.name == "OWNER").one()
        farm = Farm(**payload.dict(exclude={"operational_area"}), status="active", owner_user_id=context["user"]["id"],
                    created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc))
        db.add(farm)
        try:
            db.flush()
        except IntegrityError as exc:
            raise HTTPException(status_code=409, detail="O código da fazenda já está cadastrado.") from exc
        db.add(UserFarm(
            user_id=context["user"]["id"],
            farm_id=farm.id,
            role_id=owner_role.id,
            status="active",
            created_at=datetime.now(timezone.utc),
        ))
        record_audit(
            db, context=context, action="farm.create", resource="farm",
            resource_id=farm.id, request=request,
        )
        if payload.operational_area is not None:
            try:
                spatial_validation_service.save_area_in_session(
                    db,
                    farm.id,
                    payload.operational_area.geometry,
                    payload.operational_area.proximity_radius_m,
                )
            except SpatialValidationError as exc:
                _area_error(exc)
            except OperationalAreaConflict as exc:
                _area_conflict(exc)
            record_audit(
                db,
                context=context,
                action="farm.operational_area.update",
                resource="farm",
                resource_id=farm.id,
                request=request,
                details={"proximity_radius_m": payload.operational_area.proximity_radius_m},
            )
        db.flush()
        return {
            "success": True,
            "data": {
                "id": farm.id,
                "name": farm.name,
                "code": farm.code,
                "tax_identifier": farm.tax_identifier,
                "municipality": farm.municipality,
                "state": farm.state,
                "area_ha": farm.area_ha,
                "status": farm.status,
                "owner_user_id": farm.owner_user_id,
                "created_at": farm.created_at,
                "operational_area_configured": payload.operational_area is not None,
                "proximity_radius_m": (
                    payload.operational_area.proximity_radius_m
                    if payload.operational_area is not None
                    else None
                ),
            },
        }


@router.get("/{farm_id}")
def get_farm(
    farm_id: int,
    context: dict = Depends(require_permission("farm.view")),
    db: Session = Depends(get_db),
):
    if context["farm_id"] != farm_id:
        raise HTTPException(status_code=404, detail="Fazenda não encontrada.")
    farm = db.get(Farm, farm_id)
    if farm is None:
        raise HTTPException(status_code=404, detail="Fazenda não encontrada.")
    return {"success": True, "data": farm}


@router.patch("/{farm_id}")
def update_farm(
    farm_id: int,
    payload: FarmUpdate,
    request: Request,
    context: dict = Depends(get_farm_context),
):
    if context["farm_id"] != farm_id:
        raise HTTPException(status_code=404, detail="Fazenda não encontrada.")
    changes = payload.dict(exclude_unset=True)
    needed_permission = "farm.delete" if changes.get("status") == "inactive" else "farm.update"
    if needed_permission not in context["permissions"]:
        raise HTTPException(status_code=403, detail=f"Permissão necessária: {needed_permission}")
    area_was_submitted = "operational_area" in changes
    area_payload = changes.pop("operational_area", None)

    with SessionLocal.begin() as db:
        farm = db.get(Farm, farm_id)
        if farm is None:
            raise HTTPException(status_code=404, detail="Fazenda não encontrada.")
        for key, value in changes.items():
            setattr(farm, key, value)
        if area_was_submitted:
            try:
                if area_payload is None:
                    spatial_validation_service.delete_area_in_session(db, farm_id)
                    area_action = "farm.operational_area.delete"
                    area_details = {}
                else:
                    spatial_validation_service.save_area_in_session(
                        db,
                        farm_id,
                        area_payload["geometry"],
                        area_payload["proximity_radius_m"],
                    )
                    area_action = "farm.operational_area.update"
                    area_details = {"proximity_radius_m": area_payload["proximity_radius_m"]}
            except SpatialValidationError as exc:
                _area_error(exc)
            except OperationalAreaConflict as exc:
                _area_conflict(exc)
            record_audit(
                db,
                context=context,
                action=area_action,
                resource="farm",
                resource_id=farm_id,
                request=request,
                details=area_details,
            )
        farm.updated_at = datetime.now(timezone.utc)
        record_audit(
            db, context=context, action="farm.update", resource="farm",
            resource_id=farm_id, request=request,
            details={"fields": sorted([*changes, *({"operational_area"} if area_was_submitted else set())])},
        )
        db.flush()
        return {"success": True, "data": farm}
