from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, root_validator


TeamRole = Literal["SUPERVISOR", "OPERATOR", "TECHNICIAN"]
OperationType = Literal[
    "PLANTIO", "COLHEITA", "APLICACAO", "PULVERIZACAO", "ADUBACAO",
    "PREPARO_SOLO", "TRANSPORTE", "MANUTENCAO", "DESLOCAMENTO", "OUTRA",
]
OperationPriority = Literal["BAIXA", "NORMAL", "ALTA", "URGENTE"]
OccurrenceType = Literal["PROBLEMA_VIA", "MAQUINA", "PARADA", "DESVIO", "OUTRO"]


class StrictModel(BaseModel):
    class Config:
        extra = "forbid"


class TeamCreate(StrictModel):
    name: str = Field(..., min_length=2, max_length=120)
    code: str = Field(..., min_length=2, max_length=40)
    description: str | None = None
    supervisor_id: int | None = None


class TeamUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = None
    supervisor_id: int | None = None
    is_active: bool | None = None


class TeamMemberCreate(StrictModel):
    user_id: int
    team_role: TeamRole


class MachineAssignmentCreate(StrictModel):
    operator_id: int | None = None
    team_id: int | None = None


class OperationCreate(StrictModel):
    operation_type: OperationType
    name: str = Field(..., min_length=2, max_length=160)
    description: str | None = None
    field_id: int
    priority: OperationPriority = "NORMAL"
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None

    @root_validator
    def validate_schedule(cls, values):
        start, end = values.get("scheduled_start"), values.get("scheduled_end")
        if start and end and end < start:
            raise ValueError("O término previsto deve ser posterior ao início.")
        return values


class OperationUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = None
    field_id: int | None = None
    priority: OperationPriority | None = None
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None


class OperationAssign(StrictModel):
    machine_id: int
    operator_id: int
    team_id: int
    supervisor_id: int | None = None


class OperationAction(StrictModel):
    reason: str | None = Field(default=None, max_length=1000)


class OccurrenceCreate(StrictModel):
    occurrence_type: OccurrenceType
    description: str = Field(..., min_length=2, max_length=4000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @root_validator
    def validate_coordinate_pair(cls, values):
        if (values.get("latitude") is None) != (values.get("longitude") is None):
            raise ValueError("Latitude e longitude devem ser informadas juntas.")
        return values


class OperationRead(StrictModel):
    id: int
    farm_id: int
    code: str
    operation_type: str
    name: str
    description: str | None
    field_id: int
    field_name: str
    machine_id: int | None
    machine_name: str | None
    operator_id: int | None
    operator_name: str | None
    supervisor_id: int | None
    supervisor_name: str | None
    team_id: int | None
    team_name: str | None
    route_plan_id: int | None
    status: str
    priority: str
    scheduled_start: datetime | None
    scheduled_end: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TeamRead(StrictModel):
    id: int
    farm_id: int
    name: str
    code: str
    description: str | None
    supervisor_id: int | None
    supervisor_name: str | None
    is_active: bool
    member_count: int
    created_at: datetime
    updated_at: datetime
