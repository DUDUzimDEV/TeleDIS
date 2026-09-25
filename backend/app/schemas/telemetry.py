from datetime import datetime

from pydantic import BaseModel, Field


class TelemetryPayload(BaseModel):
    maquina_id: int = Field(..., gt=0)
    timestamp: datetime
    valor: float
    unidade: str = "C"


class TelemetryRead(BaseModel):
    id: int
    maquina_id: int
    value: float
    recorded_at: datetime
