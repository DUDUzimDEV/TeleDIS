# Banco de dados

## Banco escolhido

PostgreSQL foi escolhido por oferecer:
- suporte a dados relacionais;
- conformidade com regras de integridade;
- bons índices para queries de telemetria;
- maturidade para produção.

## Estrutura conceitual

- `roles`: perfis de acesso
- `users`: usuários do sistema
- `brands`: marcas de máquinas
- `models`: modelos de máquinas
- `machines`: máquinas agrícolas
- `measurement_types`: tipos de medição e unidade
- `telemetry_readings`: leituras de telemetria
- `route_plans`: rotas ideais
- `route_locations`: localizações de rota

## Importante

A separação entre cadastro e leitura é essencial para permitir diferentes tipos de sensores. A tabela de medição representa a definição, e a leitura armazena o valor em um momento específico.

## Migrações

As migrações iniciais estão em:
- `database/migrations/001_init.sql`

## Índices sugeridos

- usuários por username/email
- máquinas por código
- telemetria por máquina e hora
- localizações por rota
