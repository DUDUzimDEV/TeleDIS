from pydantic import BaseModel, Field, root_validator, validator


class MachineBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    code: str = Field(..., min_length=2, max_length=50)
    status: str = Field(default="active", min_length=2, max_length=30)
    tipo: str | None = Field(default=None, max_length=60)
    base_structure_id: int | None = Field(default=None, gt=0)

    @root_validator(pre=True)
    def accept_type_alias(cls, values):
        if isinstance(values, dict) and "tipo" not in values and "type" in values:
            values = {**values, "tipo": values["type"]}
        return values

    @validator("name", "code", "status", pre=True)
    def strip_required_text(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value

    @validator("tipo", pre=True)
    def strip_optional_tipo(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            cleaned = value.strip()
            return cleaned or None
        return value


class MachineCreate(MachineBase):
    pass


class MachineUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    code: str | None = Field(default=None, min_length=2, max_length=50)
    status: str | None = Field(default=None, min_length=2, max_length=30)
    tipo: str | None = Field(default=None, max_length=60)
    base_structure_id: int | None = Field(default=None, gt=0)

    @root_validator(pre=True)
    def accept_type_alias(cls, values):
        if isinstance(values, dict) and "tipo" not in values and "type" in values:
            values = {**values, "tipo": values["type"]}
        return values

    @validator("name", "code", "status", pre=True)
    def strip_update_text(cls, value):
        if value is None:
            raise ValueError("O campo não pode ser nulo.")
        if isinstance(value, str):
            return value.strip()
        return value

    @validator("tipo", pre=True)
    def strip_update_tipo(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            cleaned = value.strip()
            return cleaned or None
        return value

    @validator("base_structure_id", pre=True)
    def validate_base_structure_id(cls, value):
        if value is None:
            return value
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
            value = int(value)
        if value <= 0:
            raise ValueError("A estrutura-base deve ser um identificador válido.")
        return value


class MachineRead(MachineBase):
    id: int
