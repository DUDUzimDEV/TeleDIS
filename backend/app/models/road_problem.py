from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

from app.database import Base


class RoadProblemPoint(UserDefinedType):
    cache_ok = True

    def get_col_spec(self, **kwargs):
        return "geometry(POINT,4326)"


class RoadProblem(Base):
    __tablename__ = "road_problems"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    road_id: Mapped[int] = mapped_column(ForeignKey("roads.id", ondelete="RESTRICT"), nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(40), nullable=False)
    gravidade: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ABERTO")
    descricao: Mapped[str | None] = mapped_column(Text, nullable=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    geometry: Mapped[Any] = mapped_column(RoadProblemPoint(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())