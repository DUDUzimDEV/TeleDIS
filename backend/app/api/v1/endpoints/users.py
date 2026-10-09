from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import get_db, require_permission
from app.core.security import get_password_hash
from app.database import SessionLocal
from app.models.user import (
    Permission,
    Role,
    RolePermission,
    User,
    UserFarm,
    UserPermission,
)
from app.schemas.user import PermissionOverride, UserCreate, UserUpdate
from app.services.audit_service import record_audit

router = APIRouter(tags=["users"])


def _role_permissions(db: Session, role_id: int) -> set[str]:
    return {
        row.code for row in db.query(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role_id)
    }


def _assert_role_grantable(db: Session, context: dict, role: Role) -> None:
    if role.name == "OWNER":
        raise HTTPException(status_code=403, detail="A propriedade não pode ser atribuída por esta operação.")
    actor_permissions = context["permissions"]
    if context["role"] != "OWNER" and not _role_permissions(db, role.id).issubset(actor_permissions):
        raise HTTPException(status_code=403, detail="Não é permitido atribuir um perfil com permissões superiores às suas.")


def _user_data(user: User, membership: UserFarm, role: Role) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "phone": user.phone,
        "role": role.name,
        "status": membership.status,
        "assigned_machine_id": membership.assigned_machine_id,
        "last_login_at": user.last_login_at,
    }


def _membership(db: Session, context: dict, user_id: int):
    row = (
        db.query(User, UserFarm, Role)
        .join(UserFarm, UserFarm.user_id == User.id)
        .join(Role, Role.id == UserFarm.role_id)
        .filter(User.id == user_id, UserFarm.farm_id == context["farm_id"])
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado nesta fazenda.")
    return row


@router.get("")
def list_users(
    context: dict = Depends(require_permission("users.view")),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(User, UserFarm, Role)
        .join(UserFarm, UserFarm.user_id == User.id)
        .join(Role, Role.id == UserFarm.role_id)
        .filter(UserFarm.farm_id == context["farm_id"])
        .order_by(User.full_name, User.username)
        .all()
    )
    return {"success": True, "data": [_user_data(*row) for row in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    context: dict = Depends(require_permission("users.create")),
):
    with SessionLocal.begin() as db:
        role = db.query(Role).filter(Role.name == payload.role).one_or_none()
        if role is None:
            raise HTTPException(status_code=422, detail="Perfil não encontrado.")
        _assert_role_grantable(db, context, role)
        if payload.assigned_machine_id is not None:
            machine_exists = db.execute(
                text("SELECT 1 FROM machines WHERE id = :id AND farm_id = :farm_id"),
                {"id": payload.assigned_machine_id, "farm_id": context["farm_id"]},
            ).first()
            if machine_exists is None:
                raise HTTPException(status_code=404, detail="Máquina não encontrada nesta fazenda.")

        user = User(
            username=payload.username.strip(),
            email=str(payload.email).lower(),
            password_hash=get_password_hash(payload.password),
            full_name=payload.full_name.strip(),
            phone=payload.phone,
            is_active=True,
            role_id=role.id,
        )
        db.add(user)
        try:
            db.flush()
        except IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Usuário ou e-mail já cadastrado.") from exc
        membership = UserFarm(
            user_id=user.id,
            farm_id=context["farm_id"],
            role_id=role.id,
            status="active",
            assigned_machine_id=payload.assigned_machine_id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(membership)
        record_audit(
            db, context=context, action="users.create", resource="user",
            resource_id=user.id, request=request, details={"role": role.name},
        )
        db.flush()
        return {"success": True, "data": _user_data(user, membership, role)}


@router.get("/{user_id}")
def get_user(
    user_id: int,
    context: dict = Depends(require_permission("users.view")),
    db: Session = Depends(get_db),
):
    return {"success": True, "data": _user_data(*_membership(db, context, user_id))}


@router.patch("/{user_id}")
def update_user(
    user_id: int,
    payload: UserUpdate,
    request: Request,
    context: dict = Depends(require_permission("users.update")),
):
    changes = payload.dict(exclude_unset=True)
    if changes.get("status") == "inactive" and "users.delete" not in context["permissions"]:
        raise HTTPException(status_code=403, detail="Permissão necessária: users.delete")

    with SessionLocal.begin() as db:
        user, membership, current_role = _membership(db, context, user_id)
        if current_role.name == "OWNER" and context["user"]["id"] != user_id:
            raise HTTPException(status_code=403, detail="O proprietário não pode ser alterado por esta operação.")
        if current_role.name == "OWNER" and (
            changes.get("status") == "inactive"
            or changes.get("role") not in (None, "OWNER")
        ):
            raise HTTPException(status_code=403, detail="A propriedade não pode ser removida por esta operação.")
        if "role" in changes:
            role = db.query(Role).filter(Role.name == changes.pop("role")).one_or_none()
            if role is None:
                raise HTTPException(status_code=422, detail="Perfil não encontrado.")
            _assert_role_grantable(db, context, role)
            membership.role_id = role.id
            if user.role_id is None:
                user.role_id = role.id
        if "status" in changes:
            membership.status = changes.pop("status")
        if "assigned_machine_id" in changes:
            assigned_machine_id = changes.pop("assigned_machine_id")
            if assigned_machine_id is not None:
                exists = db.execute(
                    text("SELECT 1 FROM machines WHERE id = :id AND farm_id = :farm_id"),
                    {"id": assigned_machine_id, "farm_id": context["farm_id"]},
                ).first()
                if exists is None:
                    raise HTTPException(status_code=404, detail="Máquina não encontrada nesta fazenda.")
            membership.assigned_machine_id = assigned_machine_id
        for key, value in changes.items():
            setattr(user, key, value)
        record_audit(
            db, context=context, action="users.update", resource="user",
            resource_id=user_id, request=request, details={"fields": sorted(payload.dict(exclude_unset=True))},
        )
        db.flush()
        role = db.get(Role, membership.role_id)
        return {"success": True, "data": _user_data(user, membership, role)}


@router.put("/{user_id}/permissions")
def set_user_permission(
    user_id: int,
    payload: PermissionOverride,
    request: Request,
    context: dict = Depends(require_permission("users.permissions")),
):
    with SessionLocal.begin() as db:
        user, membership, role = _membership(db, context, user_id)
        if role.name == "OWNER":
            raise HTTPException(status_code=403, detail="As permissões do proprietário não podem ser restringidas.")
        permission = db.query(Permission).filter(Permission.code == payload.code).one_or_none()
        if permission is None:
            raise HTTPException(status_code=404, detail="Permissão não encontrada.")
        if context["role"] != "OWNER" and payload.code not in context["permissions"]:
            raise HTTPException(status_code=403, detail="Não é permitido conceder uma permissão que você não possui.")
        override = db.get(UserPermission, (user.id, context["farm_id"], permission.id))
        if override is None:
            override = UserPermission(
                user_id=user.id,
                farm_id=context["farm_id"],
                permission_id=permission.id,
                allowed=payload.allowed,
            )
            db.add(override)
        else:
            override.allowed = payload.allowed
        record_audit(
            db, context=context, action="users.permissions.update", resource="user",
            resource_id=user_id, request=request, details={"permission": payload.code, "allowed": payload.allowed},
        )
        db.flush()
        return {"success": True, "user_id": user_id, "permission": payload.code, "allowed": payload.allowed}


@router.get("/{user_id}/permissions")
def get_user_permissions(
    user_id: int,
    context: dict = Depends(require_permission("users.permissions")),
    db: Session = Depends(get_db),
):
    user, membership, role = _membership(db, context, user_id)
    role_codes = _role_permissions(db, role.id)
    overrides = {
        code: allowed for code, allowed in (
            db.query(Permission.code, UserPermission.allowed)
            .join(UserPermission, UserPermission.permission_id == Permission.id)
            .filter(UserPermission.user_id == user.id, UserPermission.farm_id == context["farm_id"])
        )
    }
    rows = db.query(Permission).order_by(Permission.code).all()
    return {
        "success": True,
        "data": [
            {
                "code": permission.code,
                "description": permission.description,
                "effective": overrides.get(permission.code, permission.code in role_codes),
                "source": (
                    "permissão adicional" if overrides.get(permission.code) is True and permission.code not in role_codes
                    else "permissão removida" if overrides.get(permission.code) is False and permission.code in role_codes
                    else "perfil" if permission.code in role_codes
                    else "não concedida"
                ),
            }
            for permission in rows
        ],
    }
