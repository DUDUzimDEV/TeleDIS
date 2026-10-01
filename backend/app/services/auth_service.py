from app.config import get_settings
from app.core.security import create_access_token, get_password_hash, verify_password

settings = get_settings()


class AuthService:
    def authenticate(self, username: str, password: str) -> str:
        username = (username or "").strip()
        password = password or ""

        if username != "admin":
            raise ValueError("Credenciais inválidas")

        if not verify_password(password, get_password_hash(settings.default_admin_password)):
            raise ValueError("Credenciais inválidas")

        return create_access_token(username)
