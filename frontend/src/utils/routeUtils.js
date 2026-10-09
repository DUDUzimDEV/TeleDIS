const knownRouteErrors = new Set([
  'Não existem estradas disponíveis.',
  'A origem está muito distante da rede viária.',
  'O destino está muito distante da rede viária.',
  'Não existe rota disponível entre origem e destino.',
  'A máquina ainda não possui uma localização GPS registrada.',
  'Máquina não encontrada.',
  'Estrutura não encontrada.',
]);

export function geoJsonLineStringToLeaflet(geometry) {
  if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
    throw new Error('A rota recebida não contém uma LineString GeoJSON válida.');
  }

  return geometry.coordinates.map((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      throw new Error('A rota recebida contém coordenadas inválidas.');
    }
    const [longitude, latitude] = coordinate;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      throw new Error('A rota recebida contém coordenadas inválidas.');
    }
    return [latitude, longitude];
  });
}

export function routeResponseToMap(response) {
  if (!response || response.found !== true || !response.route?.geometry) {
    throw new Error('Não existe rota disponível entre origem e destino.');
  }

  const routePoints = geoJsonLineStringToLeaflet(response.route.geometry);
  if (routePoints.length < 2) {
    throw new Error('A rota recebida não contém pontos suficientes para exibição.');
  }

  return {
    routePoints,
    origin: [response.origin.latitude, response.origin.longitude],
    destination: [response.destination.latitude, response.destination.longitude],
    distanceMeters: response.distance_m,
    totalCost: response.total_cost,
    nodes: response.nodes || [],
    segments: response.segments || [],
    affectedSegments: response.affected_segments || [],
    blockedSegments: response.blocked_segments || [],
    problems: response.problems || [],
  };
}

export async function routeErrorMessage(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  const detail = typeof payload.detail === 'string'
    ? payload.detail
    : Array.isArray(payload.detail)
      ? payload.detail.map((issue) => issue.msg).join(' ')
      : '';

  if (knownRouteErrors.has(detail)) {
    return detail;
  }
  return detail || `Não foi possível calcular a rota (HTTP ${response.status}).`;
}
