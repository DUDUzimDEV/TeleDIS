const unauthorizedHandlers = new Set();

export function onUnauthorized(handler) {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

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

  const response = await fetch(endpoint, { ...requestOptions, headers });
  if (
    response.status === 401
    && token
    && !String(endpoint).includes('/auth/login')
    && localStorage.getItem('teledis_token') === token
  ) {
    unauthorizedHandlers.forEach((handler) => handler());
  }
  return response;
}

export class ApiResponseError extends Error {
  constructor(message, { status, statusText, responseBody, payload = null }) {
    super(message);
    this.name = 'ApiResponseError';
    this.status = status;
    this.statusText = statusText;
    this.responseBody = responseBody;
    this.payload = payload;
  }
}

function isJsonContentType(contentType) {
  return /^application\/(?:[a-z0-9.-]+\+)?json\b/i.test(contentType || '');
}

function getApiErrorMessage(payload) {
  const detail = payload?.detail;
  if (typeof detail === 'string') return detail;
  if (typeof detail?.message === 'string') {
    const resources = Array.isArray(detail.resources) && detail.resources.length
      ? ` Recursos afetados: ${detail.resources.map(
        (resource) => `${resource.resource_type} #${resource.id}`,
      ).join(', ')}.`
      : '';
    return `${detail.message}${resources}`;
  }
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg).filter(Boolean).join(' ');
  }
  return '';
}

export async function readApiResponse(response) {
  const responseBody = await response.text();
  const contentType = response.headers.get('content-type') || '';
  let payload = null;

  if (isJsonContentType(contentType) && responseBody.trim()) {
    try {
      payload = JSON.parse(responseBody);
    } catch {
      if (response.ok) {
        throw new ApiResponseError(
          `O servidor retornou uma resposta JSON inválida (HTTP ${response.status}).`,
          {
            status: response.status,
            statusText: response.statusText,
            responseBody,
          },
        );
      }
    }
  }

  if (!response.ok) {
    const detail = getApiErrorMessage(payload);
    const message = detail
      ? `HTTP ${response.status}: ${detail}`
      : `HTTP ${response.status}: ${response.statusText || responseBody || 'A solicitação falhou.'}`;
    throw new ApiResponseError(message, {
      status: response.status,
      statusText: response.statusText,
      responseBody,
      payload,
    });
  }

  if (!isJsonContentType(contentType) && responseBody.trim()) {
    throw new ApiResponseError(
      `O servidor retornou uma resposta não JSON (HTTP ${response.status}).`,
      {
        status: response.status,
        statusText: response.statusText,
        responseBody,
      },
    );
  }

  return payload;
}
