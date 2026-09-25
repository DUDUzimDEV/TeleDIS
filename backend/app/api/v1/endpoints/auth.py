from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import create_access_token, get_current_user, get_password_hash, verify_password
from app.database import get_db

settings = get_settings()
router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(request: Request, db: Session = Depends(get_db)):
    del db

    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
        username = payload.get("username")
        password = payload.get("password")
    else:
        form_data = await request.form()
        username = form_data.get("username")
        password = form_data.get("password")

    if not username or not password:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Username e password são obrigatórios")

    if username != "admin":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais inválidas")

    default_admin_hash = get_password_hash(settings.default_admin_password)
    if not verify_password(password, default_admin_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais inválidas")

    token = create_access_token(subject=username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"username": username, "role": "admin"},
    }


@router.post("/logout")
def logout(current_user=Depends(get_current_user)):
    del current_user
    return {"success": True, "message": "Sessão encerrada com sucesso."}


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    return {"success": True, "user": current_user}
