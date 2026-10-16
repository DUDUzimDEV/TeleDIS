from datetime import datetime

from sqlalchemy import BigInteger, String, DateTime, Float, ForeignKey, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MeasurementType(Base):
    __tablename__ = "measurement_types"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    type_name: Mapped[str] = mapped_column(String(50), nullable=False)


class TelemetryReading(Base):
    __tablename__ = "telemetry_readings"
    __table_args__ = (
        Index(
            "uq_simulated_telemetry_event",
            "machine_id",
            "farm_id",
            "measurement_type_id",
            "recorded_at",
            unique=True,
            postgresql_where=text("source = 'SIMULATED'"),
            sqlite_where=text("source = 'SIMULATED'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), nullable=False, index=True)
    measurement_type_id: Mapped[int] = mapped_column(ForeignKey("measurement_types.id"), nullable=False, index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="REAL", server_default=text("'REAL'")
    )


class MachineLocation(Base):
    __tablename__ = "machine_locations"
    __table_args__ = (
        Index(
            "uq_simulated_location_event",
            "machine_id",
            "farm_id",
            "recorded_at",
            unique=True,
            postgresql_where=text("source = 'SIMULATED'"),
            sqlite_where=text("source = 'SIMULATED'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), nullable=False, index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="REAL", server_default=text("'REAL'")
    )


class RoutePlan(Base):
    __tablename__ = "route_plans"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    distance_m: Mapped[float | None] = mapped_column(Float)
    total_cost: Mapped[float | None] = mapped_column(Float)
    route_geometry: Mapped[dict | None] = mapped_column(JSONB)
    calculated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RouteLocation(Base):
    __tablename__ = "route_locations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("route_plans.id"), nullable=False, index=True)
    farm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    latitude: Mapped[float] = mapped_column(nullable=False)
    longitude: Mapped[float] = mapped_column(nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
