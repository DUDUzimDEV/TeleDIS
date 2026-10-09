from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Float, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

from app.database import Base


class PolygonGeometry(UserDefinedType):
    cache_ok = True

    def get_col_spec(self, **kwargs):
        return "geometry(POLYGON,4326)"


class Field(Base):
    __tablename__ = "fields"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nome: Mapped[str] = mapped_column(String(120), nullable=False)
    cultura: Mapped[str] = mapped_column(String(80), nullable=False)
    safra: Mapped[str] = mapped_column(String(20), nullable=False)
    area_ha: Mapped[float] = mapped_column(Float, nullable=False)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    geometry: Mapped[Any] = mapped_column(PolygonGeometry(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())