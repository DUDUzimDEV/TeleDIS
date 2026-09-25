# Segurança

## Princípios adotados

- nenhum segredo em código;
- uso de variáveis de ambiente;
- senhas em hash;
- JWT para sessões;
- validação de entrada;
- CORS controlado;
- proteção de rotas por autenticação e autorização;
- logs sem exposição de dados sensíveis.

## Medidas previstas

- rate limiting em produção;
- TLS/HTTPS via Nginx;
- acesso interno do banco e do MQTT sem exposição pública;
- no mínimo, portas 22, 80 e 443 abertas externamente;
- firewalls restritivos.

## Regras

- não armazenar senhas em texto puro;
- não expor stack traces para usuários;
- validar dados recebidos do frontend e MQTT;
- separar logs por componente.
