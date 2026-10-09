from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

from app.database import Base


class NetworkPointGeometry(UserDefinedType):
    cache_ok = True

    def get_col_spec(self, **kwargs):
        return "geometry(POINT,4326)"


class NetworkLineStringGeometry(UserDefinedType):
    cache_ok = True

    def get_col_spec(self, **kwargs):
        return "geometry(LINESTRING,4326)"


class NetworkNode(Base):
    __tablename__ = "network_nodes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    geometry: Mapped[Any] = mapped_column(NetworkPointGeometry(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NetworkSegment(Base):
    __tablename__ = "network_segments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    road_id: Mapped[int] = mapped_column(ForeignKey("roads.id", ondelete="CASCADE"), nullable=False, index=True)
    from_node_id: Mapped[int] = mapped_column(
        ForeignKey("network_nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    to_node_id: Mapped[int] = mapped_column(
        ForeignKey("network_nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    geometry: Mapped[Any] = mapped_column(NetworkLineStringGeometry(), nullable=False)
    length_m: Mapped[float] = mapped_column(Float, nullable=False)
    base_cost: Mapped[float] = mapped_column(Float, nullable=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
