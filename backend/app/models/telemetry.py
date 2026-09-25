from datetime import datetime

from sqlalchemy import String, DateTime, Float, ForeignKey
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

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), nullable=False, index=True)
    measurement_type_id: Mapped[int] = mapped_column(ForeignKey("measurement_types.id"), nullable=False, index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    value: Mapped[float] = mapped_column(Float, nullable=False)


class RoutePlan(Base):
    __tablename__ = "route_plans"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)


class RouteLocation(Base):
    __tablename__ = "route_locations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("route_plans.id"), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(nullable=False)
    longitude: Mapped[float] = mapped_column(nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
