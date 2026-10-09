from datetime import datetime

from pydantic import BaseModel, Field, constr

from app.schemas.operational_area import OperationalAreaWrite


class FarmCreate(BaseModel):
    name: constr(strip_whitespace=True, min_length=2, max_length=160)
    code: constr(strip_whitespace=True, min_length=2, max_length=40)
    tax_identifier: str | None = Field(default=None, max_length=32)
    municipality: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, min_length=2, max_length=2)
    area_ha: float | None = Field(default=None, gt=0)
    operational_area: OperationalAreaWrite | None = None


class FarmUpdate(BaseModel):
    name: constr(strip_whitespace=True, min_length=2, max_length=160) | None = None
    tax_identifier: str | None = Field(default=None, max_length=32)
    municipality: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, min_length=2, max_length=2)
    area_ha: float | None = Field(default=None, gt=0)
    status: str | None = Field(default=None, pattern="^(active|inactive)$")
    operational_area: OperationalAreaWrite | None = None


class FarmRead(BaseModel):
    id: int
    name: str
    code: str
    tax_identifier: str | None = None
    municipality: str | None = None
    state: str | None = None
    area_ha: float | None = None
    status: str
    owner_user_id: int | None = None
    created_at: datetime


class FarmMembershipRead(FarmRead):
    role: str
    permissions: list[str]
