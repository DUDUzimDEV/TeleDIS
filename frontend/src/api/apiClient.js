export async function apiFetch(endpoint, options = {}) {
  const {
    skipFarm = false,
    farmId,
    headers: suppliedHeaders,
    ...requestOptions
  } = options;
  const headers = new Headers(suppliedHeaders || {});
  const token = localStorage.getItem('teledis_token');
  const selectedFarmId = farmId ?? localStorage.getItem('teledis_farm_id');

  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!skipFarm && selectedFarmId) headers.set('X-Farm-Id', selectedFarmId);

  return fetch(endpoint, { ...requestOptions, headers });
}
