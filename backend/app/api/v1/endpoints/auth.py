from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import get_current_user
from app.database import get_db
from app.schemas.auth import LoginRequest
from app.services.auth_service import AuthService

settings = get_settings()
router = APIRouter(tags=["auth"])


@router.post("/login")
def login(payload: LoginRequest = Body(...), db: Session = Depends(get_db)):
    del db

    try:
        token = AuthService().authenticate(payload.username, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"username": payload.username, "role": "admin"},
    }


@router.post("/logout")
def logout(current_user=Depends(get_current_user)):
    del current_user
    return {"success": True, "message": "Sessão encerrada com sucesso."}


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    return {"success": True, "user": current_user}
