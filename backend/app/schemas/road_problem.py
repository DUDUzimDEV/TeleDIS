import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, validator

RoadProblemType = Literal[
    "BURACO",
    "LAMA",
    "ALAGAMENTO",
    "VIA_BLOQUEADA",
    "PONTE_PROBLEMA",
    "DESLIZAMENTO",
    "OUTRO",
]
RoadProblemSeverity = Literal["BAIXA", "MEDIA", "ALTA", "CRITICA"]
RoadProblemStatus = Literal["ABERTO", "EM_ANALISE", "RESOLVIDO", "INATIVO"]


class RoadProblemPoint(BaseModel):
    type: Literal["Point"]
    coordinates: tuple[float, float]

    @validator("coordinates")
    def validate_coordinates(cls, coordinates):
        longitude, latitude = coordinates
        if not math.isfinite(longitude) or not math.isfinite(latitude):
            raise ValueError("As coordenadas devem ser números finitos.")
        if not -180 <= longitude <= 180:
            raise ValueError("Longitude fora dos limites WGS84.")
        if not -90 <= latitude <= 90:
            raise ValueError("Latitude fora dos limites WGS84.")
        return coordinates

    class Config:
        extra = "forbid"


class RoadProblemCreate(BaseModel):
    road_id: int = Field(..., gt=0)
    tipo: RoadProblemType
    gravidade: RoadProblemSeverity
    descricao: str | None = Field(default=None, max_length=1000)
    geometry: RoadProblemPoint

    @validator("descricao")
    def normalize_description(cls, value):
        if value is None:
            return None
        value = value.strip()
        return value or None

    class Config:
        extra = "forbid"


class RoadProblemStatusUpdate(BaseModel):
    status: RoadProblemStatus

    class Config:
        extra = "forbid"


class RoadProblemRead(BaseModel):
    id: int
    road_id: int
    road_nome: str
    tipo: RoadProblemType
    gravidade: RoadProblemSeverity
    status: RoadProblemStatus
    descricao: str | None
    geometry: RoadProblemPoint
    created_at: datetime
    updated_at: datetime