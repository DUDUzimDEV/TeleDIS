from collections.abc import Callable
from functools import wraps

from fastapi import Depends, HTTPException, status

from app.core.security import get_current_user


def require_roles(*allowed_roles: str):
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            user = await get_current_user()
            if user.get("role") not in allowed_roles:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Usuário não possui permissão para essa operação.",
                )
            return await func(*args, **kwargs)

        return wrapper

    return decorator
