# Desenvolvimento

## Requisitos

- Docker
- Docker Compose
- Git
- VS Code ou editor equivalente

## Execução local

```bash
cp .env.example .env

docker compose up --build -d
```

## Testes

```bash
pytest
```

## Estrutura de pastas

- `backend/`: API e serviços
- `frontend/`: interface inicial
- `database/`: migrações e seeds
- `infrastructure/`: configurações de rede e proxy
- `docs/`: documentação técnica
- `tests/`: testes automatizados

## Fluxo recomendado

1. criar branch de feature;
2. implementar funcionalidade;
3. executar testes;
4. revisar logs e health endpoints;
5. fazer merge na branch principal após validação.
