# Segurança

## Princípios adotados

- nenhum segredo em código;
- uso de variáveis de ambiente;
- senhas em hash;
- JWT para sessões;
- validação de entrada;
- CORS controlado;
- JWT obrigatório nas APIs operacionais e administrativas, exceto login e health checks;
- autorização no backend por usuário, fazenda, perfil e permissões;
- validação do cabeçalho `X-Farm-Id` contra os vínculos ativos do usuário;
- filtro por fazenda nas consultas e gravações de recursos operacionais;
- restrição adicional para operador à máquina atribuída;
- registro de ações administrativas e operacionais em `audit_logs`.
- logs sem exposição de dados sensíveis.

## Medidas e autorização

- Rate limiting ainda não está implementado. Não exponha a API à Internet sem uma proteção de abuso adequada.
- O Nginx do Docker Compose de desenvolvimento atende somente HTTP; TLS/HTTPS precisa ser configurado antes de uma implantação pública.
- O Compose de desenvolvimento publica as portas do PostgreSQL, MQTT, backend e frontend no host. Restrinja essas portas por firewall ou remova os mapeamentos antes de implantar em uma rede não confiável.
- Use firewalls restritivos e exponha externamente somente os serviços necessários.

Os valores padrão de `SECRET_KEY`, `JWT_SECRET` e `DEFAULT_ADMIN_PASSWORD` servem apenas para desenvolvimento. Quando `API_ENV=production`, a API rejeita os valores padrão, exige chaves com pelo menos 32 bytes e exige que a senha de bootstrap seja alterada.

## Regras

- não armazenar senhas em texto puro;
- não expor stack traces para usuários;
- validar dados recebidos do frontend e MQTT;
- separar logs por componente.

## RBAC e fazenda ativa

Os perfis seedados são `OWNER`, `FARM_ADMIN`, `COORDINATOR`, `SUPERVISOR`, `OPERATOR`, `TECHNICIAN` e `ANALYST`. As rotas verificam códigos de permissão como `machines.view`, `routes.create` e `users.permissions`; o nome do perfil não substitui a checagem no backend. Exceções individuais de permissão são armazenadas por usuário e fazenda.

O cliente envia `Authorization: Bearer <JWT>` e `X-Farm-Id: <id>` nas chamadas autenticadas. A API verifica o vínculo ativo antes de usar o contexto selecionado. IDs de recursos são consultados dentro da fazenda ativa; para operador, consultas de máquinas, localização e telemetria são limitadas à máquina atribuída. A interface filtra menus e ações para melhorar a experiência, mas não é considerada uma fronteira de segurança.

O proprietário não pode ser removido ou rebaixado pela API comum de edição de usuário. A transferência de propriedade exige fluxo administrativo próprio. Logs de auditoria têm escopo de fazenda e não armazenam senhas.

## Limitações atuais

- O protocolo MQTT legado não contém um identificador confiável de fazenda em cada mensagem; novas máquinas recebidas sem cadastro são associadas à fazenda inicial. Não use esse fluxo para provisionar máquinas de outras fazendas sem um mecanismo de associação autenticado.
- O broker MQTT exige credenciais para publicação; proteja credenciais e tráfego de rede, pois o Compose local não configura TLS no broker.
- Ainda não há API persistente para atribuição/execução de rotas, comunicação com coordenação, paradas ou manutenção iniciada pelo operador. A interface não simula essas operações.
- A migration multi-tenant precisa ser aplicada explicitamente em volumes já existentes. Seu backfill atribui os registros legados à fazenda padrão e não consegue determinar a fazenda real a partir do schema anterior; confirme a associação e faça backup antes de aplicá-la. Veja [database.md](./database.md).
