import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, validator

RoadType = Literal["PRINCIPAL", "SECUNDARIA", "ACESSO", "SERVICO", "OUTRA"]


class LineStringGeometry(BaseModel):
    type: Literal["LineString"]
    coordinates: list[tuple[float, float]]

    @validator("coordinates")
    def validate_coordinates(cls, coordinates):
        if len(coordinates) < 2:
            raise ValueError("Uma via precisa possuir pelo menos dois pontos.")
        if len(set(coordinates)) < 2:
            raise ValueError("A via precisa possuir pelo menos dois pontos distintos.")

        for longitude, latitude in coordinates:
            if not math.isfinite(longitude) or not math.isfinite(latitude):
                raise ValueError("As coordenadas devem ser números finitos.")
            if not -180 <= longitude <= 180:
                raise ValueError("Longitude fora dos limites WGS84.")
            if not -90 <= latitude <= 90:
                raise ValueError("Latitude fora dos limites WGS84.")

        return coordinates

    class Config:
        extra = "forbid"


class RoadCreate(BaseModel):
    nome: str = Field(..., min_length=1, max_length=120)
    tipo: RoadType
    descricao: str | None = Field(default=None, max_length=1000)
    geometry: LineStringGeometry

    @validator("nome")
    def validate_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("O nome não pode ficar vazio.")
        return value

    @validator("descricao")
    def normalize_description(cls, value):
        if value is None:
            return None
        value = value.strip()
        return value or None

    class Config:
        extra = "forbid"


class RoadRead(BaseModel):
    id: int
    nome: str
    tipo: RoadType
    descricao: str | None
    geometry: LineStringGeometry
    comprimento_m: float
    created_at: datetime
    updated_at: datetime