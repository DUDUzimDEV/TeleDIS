from datetime import datetime, timezone

from sqlalchemy import func, or_

from app.config import get_settings
from app.core.security import create_access_token, get_password_hash, verify_password
from app.database import SessionLocal
from app.models.user import AuditLog, Farm, Role, User, UserFarm


class AuthService:
    def authenticate(self, username: str, password: str) -> str:
        return self.authenticate_session(username, password)["access_token"]

    def authenticate_session(self, identifier: str, password: str) -> dict:
        identifier = (identifier or "").strip()
        password = password or ""
        with SessionLocal.begin() as db:
            user = (
                db.query(User)
                .filter(or_(func.lower(User.username) == identifier.lower(), func.lower(User.email) == identifier.lower()))
                .first()
            )
            if user is None or not user.is_active or not verify_password(password, user.password_hash):
                raise ValueError("Credenciais inválidas")

            now = datetime.now(timezone.utc)
            user.last_login_at = now
            memberships = (
                db.query(UserFarm, Farm, Role)
                .join(Farm, Farm.id == UserFarm.farm_id)
                .join(Role, Role.id == UserFarm.role_id)
                .filter(UserFarm.user_id == user.id, UserFarm.status == "active", Farm.status == "active")
                .all()
            )
            if not memberships:
                raise ValueError("Usuário não possui fazendas ativas.")

            db.add(AuditLog(
                user_id=user.id,
                farm_id=None,
                action="auth.login",
                resource="session",
                result="success",
                details={},
                created_at=now,
            ))
            farms = [
                {
                    "id": farm.id,
                    "name": farm.name,
                    "code": farm.code,
                    "municipality": farm.municipality,
                    "state": farm.state,
                    "role": role.name,
                }
                for _, farm, role in memberships
            ]
            return {
                "access_token": create_access_token(
                    str(user.id),
                    username=user.username,
                    token_version=user.auth_version,
                ),
                "token_type": "bearer",
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "full_name": user.full_name,
                    "role": memberships[0][2].name if len(memberships) == 1 else None,
                },
                "farms": farms,
            }


def ensure_initial_owner() -> None:
    settings = get_settings()
    with SessionLocal.begin() as db:
        farm = db.query(Farm).filter(Farm.code == settings.initial_farm_code).one_or_none()
        if farm is None:
            raise RuntimeError(
                "A fazenda inicial não existe. Aplique a migration 009_farms_rbac.sql antes de iniciar a API."
            )
        owner_role = db.query(Role).filter(Role.name == "OWNER").one_or_none()
        if owner_role is None:
            raise RuntimeError("O perfil OWNER não existe. Aplique a migration 009_farms_rbac.sql.")

        owner = db.query(User).filter(User.username == "admin").one_or_none()
        if owner is None:
            conflicting_email = db.query(User).filter(User.email == settings.initial_admin_email).one_or_none()
            if conflicting_email is not None:
                raise RuntimeError("INITIAL_ADMIN_EMAIL já pertence a outro usuário.")
            owner = User(
                username="admin",
                email=settings.initial_admin_email,
                password_hash=get_password_hash(settings.default_admin_password),
                is_active=True,
                full_name="Administrador inicial",
                role_id=owner_role.id,
            )
            db.add(owner)
            db.flush()
        elif owner.role_id is None:
            owner.role_id = owner_role.id

        membership = db.get(UserFarm, (owner.id, farm.id))
        if membership is None:
            db.add(UserFarm(
                user_id=owner.id,
                farm_id=farm.id,
                role_id=owner_role.id,
                status="active",
                created_at=datetime.now(timezone.utc),
            ))
        farm.owner_user_id = owner.id
