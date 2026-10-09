from datetime import datetime, timezone
from ipaddress import ip_address

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user, get_farm_context
from app.database import get_db, SessionLocal
from app.models.user import AuditLog, User
from app.schemas.auth import LoginRequest
from app.services.auth_service import AuthService

router = APIRouter(tags=["auth"])


@router.post("/login")
def login(payload: LoginRequest = Body(...), db: Session = Depends(get_db)):
    del db

    try:
        return AuthService().authenticate_session(payload.username, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/logout")
def logout(request: Request, current_user=Depends(get_current_user)):
    client_host = request.client.host if request.client else None
    try:
        client_ip = str(ip_address(client_host)) if client_host else None
    except ValueError:
        client_ip = None
    with SessionLocal.begin() as db:
        user = db.query(User).filter(User.id == current_user["id"]).with_for_update().one()
        user.auth_version += 1
        db.add(AuditLog(
            user_id=current_user["id"],
            action="auth.logout",
            resource="session",
            result="success",
            ip_address=client_ip,
            details={},
            created_at=datetime.now(timezone.utc),
        ))
    return {"success": True, "message": "Sessão encerrada com sucesso."}


@router.get("/me")
def me(context: dict = Depends(get_farm_context)):
    return {
        "success": True,
        "user": {**context["user"], "role": context["role"],
                 "assigned_machine_id": context["assigned_machine_id"]},
        "farm": context["farm"],
        "permissions": sorted(context["permissions"]),
    }
