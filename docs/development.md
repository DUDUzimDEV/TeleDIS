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

O serviço `frontend` monta `./frontend` em `/app`, então alterações salvas no workspace são servidas pelo Vite em `http://localhost:5173` sem rebuild. O diretório `/app/node_modules` fica em um volume separado para não ser substituído por dependências do host. O Vite verifica alterações via polling a cada 500 ms, pois eventos de filesystem em mounts Windows/WSL2 no Docker Desktop podem não chegar ao container; o HMR segue habilitado.

Para recriar somente o frontend após mudar a configuração do Compose:

```bash
docker compose up -d --no-deps frontend
```

Rebuild é necessário quando mudar `frontend/Dockerfile` ou as dependências (`frontend/package.json`/`frontend/package-lock.json`). Para instalar a nova árvore de dependências no volume do container:

```bash
docker compose build frontend
docker compose up -d --no-deps --force-recreate --renew-anon-volumes frontend
```

## Testes

```bash
pytest
```

Testes e build do frontend:

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

## Monitoramento operacional

Dashboard, mapa, frota, operações, rotas e telemetria atualizam os recursos operacionais a cada 5 segundos, sem remover os dados já exibidos durante a consulta. A comunicação é classificada como online somente quando há uma localização ou leitura recente (até 30 segundos), desatualizada para dados mais antigos e sem dados quando não há timestamp válido. A origem `REAL` ou `SIMULATED` é apresentada conforme o registro persistido; uma base cadastrada não é tratada como ponto GPS. Trilhas e histórico continuam sujeitos às permissões de fazenda e às permissões `operations.history`/`telemetry.history`.

O Docker Compose é voltado ao desenvolvimento local. Consulte [security.md](./security.md) antes de expor qualquer serviço fora de uma rede confiável.

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
