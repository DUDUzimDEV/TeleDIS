# Documentação da API

## Base

- Prefixo: `/api/v1`
- Base URL: `http://localhost:8000`

## Endpoints iniciais

### Health

- `GET /health`
- `GET /health/database`
- `GET /health/mqtt`

### Autenticação

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

### Máquinas

- `GET /api/v1/machines`
- `GET /api/v1/machines/{machine_id}`

### Telemetria

- `GET /api/v1/telemetry`
- `GET /api/v1/telemetry/{machine_id}`

## Exemplo de login

```json
{
  "username": "admin",
  "password": "Admin@123"
}
```

## Exemplo de resposta

```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "user": {
    "username": "admin",
    "role": "admin"
  }
}
```

## Padrão de erros

```json
{
  "detail": "Credenciais inválidas"
}
```
