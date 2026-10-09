import math
from numbers import Real
from typing import Any

from pydantic import BaseModel, Field, conint, validator

from app.config import get_settings


def _validate_position(position: Any) -> tuple[float, float]:
    if not isinstance(position, (list, tuple)) or len(position) < 2:
        raise ValueError("Cada posição GeoJSON precisa conter longitude e latitude.")
    longitude, latitude = position[:2]
    if (
        isinstance(longitude, bool)
        or isinstance(latitude, bool)
        or not isinstance(longitude, Real)
        or not isinstance(latitude, Real)
        or not math.isfinite(longitude)
        or not math.isfinite(latitude)
        or not -180 <= longitude <= 180
        or not -90 <= latitude <= 90
    ):
        raise ValueError("As coordenadas devem ser finitas e estar dentro dos limites WGS84.")
    if any(
        isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value)
        for value in position[2:]
    ):
        raise ValueError("As dimensões adicionais da posição devem ser números finitos.")
    return float(longitude), float(latitude)


def _validate_geojson_geometry(geometry: dict[str, Any], allowed_types: set[str]) -> None:
    if not isinstance(geometry, dict) or geometry.get("type") not in allowed_types:
        raise ValueError(f"A geometria deve ser um dos tipos: {', '.join(sorted(allowed_types))}.")
    if set(geometry) != {"type", "coordinates"}:
        raise ValueError("A geometria deve conter apenas type e coordinates; o SRID esperado é WGS84 (4326).")

    geometry_type = geometry["type"]
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        raise ValueError("A geometria deve conter coordenadas GeoJSON.")

    if geometry_type == "Point":
        _validate_position(coordinates)
        return

    if geometry_type == "LineString":
        positions = [_validate_position(position) for position in coordinates]
        if len(positions) > 50000:
            raise ValueError("A geometria excede o limite de 50.000 posições.")
        if len(positions) < 2 or len(set(positions)) < 2:
            raise ValueError("A linha precisa conter pelo menos dois pontos distintos.")
        return

    polygons = [coordinates] if geometry_type == "Polygon" else coordinates
    if not polygons:
        raise ValueError("A geometria de área deve conter pelo menos um polígono.")
    point_count = 0
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            raise ValueError("Cada polígono deve conter ao menos um anel.")
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4:
                raise ValueError("Cada anel deve conter ao menos três vértices e ser fechado.")
            positions = [_validate_position(position) for position in ring]
            if positions[0] != positions[-1] or len(set(positions[:-1])) < 3:
                raise ValueError("Os anéis devem ser fechados e conter três vértices distintos.")
            point_count += len(positions)
            if point_count > 50000:
                raise ValueError("A geometria excede o limite de 50.000 posições.")


class OperationalAreaWrite(BaseModel):
    geometry: dict[str, Any]
    proximity_radius_m: conint(
        ge=0,
        le=get_settings().operational_proximity_max_m,
    ) = get_settings().operational_proximity_default_m

    @validator("geometry")
    def validate_geometry(cls, geometry):
        _validate_geojson_geometry(geometry, {"Polygon", "MultiPolygon"})
        return geometry


class SpatialResourceValidation(BaseModel):
    resource_type: str = Field(pattern="^(field|structure|road)$")
    geometry: dict[str, Any]

    @validator("geometry")
    def validate_geometry(cls, geometry, values):
        expected_type = {
            "field": {"Polygon"},
            "structure": {"Point"},
            "road": {"LineString"},
        }.get(values.get("resource_type"))
        if expected_type:
            _validate_geojson_geometry(geometry, expected_type)
        return geometry
