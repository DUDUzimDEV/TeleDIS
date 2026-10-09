from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import Farm, Permission, Role, RolePermission, User, UserFarm, UserPermission

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(
    subject: str,
    expires_delta: timedelta | None = None,
    *,
    username: str | None = None,
    token_version: int = 0,
) -> str:
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.jwt_expire_minutes)

    expire = datetime.now(timezone.utc) + expires_delta
    payload = {"sub": subject, "exp": expire, "ver": token_version}
    if username:
        payload["username"] = username
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido") from exc


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not token:
        raise credentials_exception

    try:
        payload = decode_token(token)
        subject = payload.get("sub")
        if not isinstance(subject, str) or not subject:
            raise credentials_exception
    except HTTPException:
        raise
    except (KeyError, TypeError, ValueError) as exc:
        raise credentials_exception from exc

    if subject.isdecimal():
        user = db.query(User).filter(User.id == int(subject)).one_or_none()
    else:
        user = db.query(User).filter(User.username == subject).one_or_none()
    token_version = payload.get("ver", 0)
    if (
        user is None
        or not user.is_active
        or type(token_version) is not int
        or token_version != user.auth_version
    ):
        raise credentials_exception

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "is_active": user.is_active,
    }


async def get_farm_context(
    request: Request,
    current_user: dict = Depends(get_current_user),
    selected_farm_id: int | None = Header(default=None, alias="X-Farm-Id"),
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
        .all()
    )
    if not memberships:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuário não possui fazendas ativas.")
    if selected_farm_id is None:
        if len(memberships) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selecione uma fazenda usando o cabeçalho X-Farm-Id.",
            )
        membership, farm, role = memberships[0]
    else:
        selected = next((item for item in memberships if item[1].id == selected_farm_id), None)
        if selected is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso à fazenda não autorizado.")
        membership, farm, role = selected

    permission_rows = (
        db.query(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role.id)
        .all()
    )
    permissions = {row.code for row in permission_rows}
    overrides = (
        db.query(Permission.code, UserPermission.allowed)
        .join(UserPermission, UserPermission.permission_id == Permission.id)
        .filter(
            UserPermission.user_id == current_user["id"],
            UserPermission.farm_id == farm.id,
        )
        .all()
    )
    if role.name == "OWNER":
        permissions.update(row.code for row in db.query(Permission.code).all())
    else:
        for code, allowed in overrides:
            if allowed:
                permissions.add(code)
            else:
                permissions.discard(code)

    context = {
        "user": current_user,
        "farm_id": farm.id,
        "farm": {
            "id": farm.id,
            "name": farm.name,
            "code": farm.code,
            "municipality": farm.municipality,
            "state": farm.state,
            "status": farm.status,
        },
        "role": role.name,
        "permissions": permissions,
        "membership": membership,
        "assigned_machine_id": membership.assigned_machine_id,
    }
    request.state.farm_context = context
    return context


def require_permission(permission_code: str):
    async def dependency(context: dict = Depends(get_farm_context)):
        if permission_code not in context["permissions"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permissão necessária: {permission_code}",
            )
        return context

    return dependency


def ensure_machine_access(context: dict, machine_id: int) -> None:
    if context["role"] == "OPERATOR" and context["assigned_machine_id"] != machine_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Máquina não encontrada.")
