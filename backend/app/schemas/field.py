import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, validator


class PolygonGeometry(BaseModel):
    type: Literal["Polygon"]
    coordinates: list[list[tuple[float, float]]]

    @validator("coordinates")
    def validate_polygon_rings(cls, rings):
        if not rings:
            raise ValueError("A geometria deve conter ao menos um anel.")

        for ring in rings:
            if len(ring) < 4:
                raise ValueError("Cada anel deve conter ao menos 3 vértices e ser fechado.")
            if ring[0] != ring[-1]:
                raise ValueError("O anel do polígono deve estar fechado.")
            if len(set(ring[:-1])) < 3:
                raise ValueError("O polígono deve conter ao menos 3 vértices distintos.")

            for longitude, latitude in ring:
                if not math.isfinite(longitude) or not math.isfinite(latitude):
                    raise ValueError("As coordenadas devem ser números finitos.")
                if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
                    raise ValueError("Coordenadas fora dos limites geográficos WGS84.")

        return rings

    class Config:
        extra = "forbid"


class FieldCreate(BaseModel):
    nome: str = Field(..., min_length=1, max_length=120)
    cultura: str = Field(..., min_length=1, max_length=80)
    safra: str = Field(..., min_length=1, max_length=20)
    geometry: PolygonGeometry

    @validator("nome", "cultura", "safra")
    def validate_nonblank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Este campo não pode ficar vazio.")
        return value

    class Config:
        extra = "forbid"


class FieldRead(BaseModel):
    id: int
    nome: str
    cultura: str
    safra: str
    area_ha: float
    geometry: dict
    created_at: datetime
    updated_at: datetime