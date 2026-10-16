const SESSION_STORAGE_KEYS = [
  'teledis_token',
  'teledis_user',
  'teledis_farms',
  'teledis_farm_id',
];

export function clearStoredSession(storage = localStorage) {
  SESSION_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
}
