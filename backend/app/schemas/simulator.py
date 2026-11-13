from typing import Literal

from pydantic import BaseModel, Field


class SimulatedLocationValidation(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)


class SimulatorOperationTransition(BaseModel):
    action: Literal["accept", "start", "complete"]
    reason: str | None = Field(default=None, max_length=500)
