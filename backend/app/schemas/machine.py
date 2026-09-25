from pydantic import BaseModel, Field


class MachineBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    code: str = Field(..., min_length=2, max_length=50)
    status: str = Field(default="active", max_length=30)


class MachineCreate(MachineBase):
    pass


class MachineRead(MachineBase):
    id: int
