from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, constr


class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=80)
    email: EmailStr


class UserCreate(UserBase):
    password: constr(min_length=10, max_length=128)
    full_name: constr(strip_whitespace=True, min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    role: constr(strip_whitespace=True, min_length=2, max_length=50)
    assigned_machine_id: int | None = Field(default=None, gt=0)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: constr(strip_whitespace=True, min_length=2, max_length=160) | None = None
    phone: str | None = Field(default=None, max_length=40)
    role: constr(strip_whitespace=True, min_length=2, max_length=50) | None = None
    status: str | None = Field(default=None, pattern="^(active|inactive)$")
    assigned_machine_id: int | None = Field(default=None, gt=0)


class PermissionOverride(BaseModel):
    code: constr(strip_whitespace=True, min_length=1, max_length=100)
    allowed: bool


class UserRead(UserBase):
    id: int
    full_name: str | None = None
    phone: str | None = None
    role: str
    status: str
    assigned_machine_id: int | None = None
    last_login_at: datetime | None = None
