import math
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, validator


class RouteCoordinate(BaseModel):
    latitude: float
    longitude: float

    @validator("latitude", "longitude")
    def validate_finite(cls, value):
        if not math.isfinite(value):
            raise ValueError("As coordenadas devem ser números finitos.")
        return value

    @validator("latitude")
    def validate_latitude(cls, value):
        if not -90 <= value <= 90:
            raise ValueError("Latitude fora dos limites WGS84.")
        return value

    @validator("longitude")
    def validate_longitude(cls, value):
        if not -180 <= value <= 180:
            raise ValueError("Longitude fora dos limites WGS84.")
        return value

    class Config:
        extra = "forbid"


class RouteCalculateRequest(BaseModel):
    origin: RouteCoordinate
    destination: RouteCoordinate

    class Config:
        extra = "forbid"


class RouteNodeRead(BaseModel):
    id: int
    geometry: dict[str, Any]
    created_at: datetime


class RouteSegmentRead(BaseModel):
    id: int
    road_id: int
    from_node_id: int
    to_node_id: int
    geometry: dict[str, Any]
    length_m: float
    base_cost: float
    cost: float
    is_blocked: bool
    problems: list[dict[str, Any]]
    created_at: datetime
    updated_at: datetime


class RouteProblemRead(BaseModel):
    id: int
    segment_id: int
    tipo: str
    gravidade: str
    status: str
    descricao: str | None = None


class RouteFeatureGeometry(BaseModel):
    type: Literal["LineString"]
    coordinates: list[tuple[float, float]]


class RouteFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    properties: dict[str, Any]
    geometry: RouteFeatureGeometry


class RouteResult(BaseModel):
    found: bool
    distance_m: float
    total_cost: float
    nodes: list[int]
    segments: list[int]
    affected_segments: list[int]
    blocked_segments: list[int]
    problems: list[RouteProblemRead]
    origin: RouteCoordinate
    destination: RouteCoordinate
    route: RouteFeature


class NetworkRebuildResult(BaseModel):
    nodes_created: int
    segments_created: int
