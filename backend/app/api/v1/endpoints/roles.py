from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_db, require_permission
from app.models.user import Permission, Role, RolePermission

router = APIRouter(tags=["roles"])


@router.get("")
def list_roles(
    context: dict = Depends(require_permission("users.view")),
    db: Session = Depends(get_db),
):
    roles = db.query(Role).order_by(Role.id).all()
    result = []
    for role in roles:
        codes = [
            row.code for row in db.query(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .filter(RolePermission.role_id == role.id)
            .order_by(Permission.code)
        ]
        result.append({"id": role.id, "name": role.name, "description": role.description, "permissions": codes})
    return {"success": True, "data": result, "farm_id": context["farm_id"]}


@router.get("/permissions")
def list_permissions(
    context: dict = Depends(require_permission("users.permissions")),
    db: Session = Depends(get_db),
):
    rows = db.query(Permission).order_by(Permission.code).all()
    return {
        "success": True,
        "data": [{"code": row.code, "description": row.description} for row in rows],
        "farm_id": context["farm_id"],
    }
