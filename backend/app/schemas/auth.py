from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(
        ...,
        min_length=3,
        max_length=80,
        description="Nome de usuário para autenticação.",
        example="admin",
    )
    password: str = Field(
        ...,
        min_length=6,
        description="Senha do usuário para autenticação.",
        example="Admin@123",
    )


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
