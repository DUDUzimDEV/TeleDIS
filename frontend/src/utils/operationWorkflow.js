export function getOperationActions(operation, role, permissions) {
  if (!operation) return [];
  const actions = [];
  const canExecute = permissions.has('operations.execute');
  const canAssign = permissions.has('operations.assign');

  if (role === 'OPERATOR' && canExecute && operation.status === 'ATRIBUIDA') {
    actions.push({ action: 'accept', label: 'Aceitar operação' });
  }
  if (role === 'OPERATOR' && canExecute && operation.status === 'ACEITA') {
    actions.push({ action: 'start', label: 'Iniciar operação', primary: true });
  }
  if (role === 'OPERATOR' && canExecute && operation.status === 'EM_EXECUCAO') {
    actions.push({ action: 'interrupt', label: 'Informar parada', body: { reason: 'Parada informada pelo operador.' } });
    actions.push({ action: 'complete', label: 'Finalizar operação', primary: true });
  }
  if (role === 'OPERATOR' && canExecute && operation.status === 'INTERROMPIDA') {
    actions.push({ action: 'resume', label: 'Retomar operação', primary: true });
  }
  if (
    (canAssign || (role === 'OPERATOR' && canExecute))
    && ['PLANEJADA', 'ATRIBUIDA', 'ACEITA', 'INTERROMPIDA'].includes(operation.status)
  ) {
    actions.push({
      action: 'cancel',
      label: 'Cancelar operação',
      body: { reason: 'Cancelada pelo usuário autorizado.' },
    });
  }
  return actions;
}
