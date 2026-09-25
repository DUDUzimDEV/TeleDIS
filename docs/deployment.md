# Deployment

## Visão geral

A infraestrutura atual está pronta para ser executada em ambiente Docker e preparada para implantação em VM Linux ou nuvem.

## Requisitos da VM

- Linux estável (Ubuntu ou Debian);
- Docker;
- Docker Compose;
- Nginx;
- Git;
- Firewall;
- monitoramento básico.

## Ports esperados

- 22: SSH
- 80: HTTP/Nginx
- 443: HTTPS
- 5432: PostgreSQL (interno)
- 1883: MQTT (interno)

## Estrutura de rede

- serviços internos em redes privadas;
- Nginx no ponto de entrada público;
- backend e banco em rede interna.

## Deploy sugerido

```bash
cp .env.example .env
# ajustar variáveis sensíveis

docker compose up --build -d
```
