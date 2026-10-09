from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Float, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

from app.database import Base


class PointGeometry(UserDefinedType):
    cache_ok = True

    def get_col_spec(self, **kwargs):
        return "geometry(POINT,4326)"


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (UniqueConstraint("id", "farm_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    supervisor_id: Mapped[int | None]
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TeamMember(Base):
    __tablename__ = "team_members"

    team_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(primary_key=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    team_role: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MachineAssignment(Base):
    __tablename__ = "machine_assignments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    machine_id: Mapped[int] = mapped_column(nullable=False)
    user_id: Mapped[int | None]
    team_id: Mapped[int | None] = mapped_column(BigInteger)
    assigned_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    assigned_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Operation(Base):
    __tablename__ = "operations"
    __table_args__ = (UniqueConstraint("id", "farm_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    operation_type: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    field_id: Mapped[int] = mapped_column(nullable=False)
    machine_id: Mapped[int | None]
    operator_id: Mapped[int | None]
    supervisor_id: Mapped[int | None]
    team_id: Mapped[int | None] = mapped_column(BigInteger)
    route_plan_id: Mapped[int | None]
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PLANEJADA")
    priority: Mapped[str] = mapped_column(String(10), nullable=False, default="NORMAL")
    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scheduled_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completion_summary: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OperationStatusHistory(Base):
    __tablename__ = "operation_status_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    operation_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    old_status: Mapped[str | None] = mapped_column(String(20))
    new_status: Mapped[str] = mapped_column(String(20), nullable=False)
    changed_by: Mapped[int] = mapped_column(nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OperationRouteHistory(Base):
    __tablename__ = "operation_route_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    operation_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    route_plan_id: Mapped[int] = mapped_column(nullable=False)
    version: Mapped[int] = mapped_column(nullable=False)
    route_geometry: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    distance_m: Mapped[float] = mapped_column(Float, nullable=False)
    total_cost: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OperationOccurrence(Base):
    __tablename__ = "operation_occurrences"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    operation_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    occurrence_type: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    geometry: Mapped[Any | None] = mapped_column(PointGeometry())
    created_by: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
