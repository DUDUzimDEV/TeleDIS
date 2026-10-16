export const LIVE_DATA_STALE_AFTER_MS = 30_000;

export function getCommunicationStatus(timestamp, now = Date.now()) {
  if (!timestamp) return 'NO_DATA';
  const recordedAt = new Date(timestamp).getTime();
  if (!Number.isFinite(recordedAt)) return 'NO_DATA';

  const age = now - recordedAt;
  return age >= 0 && age <= LIVE_DATA_STALE_AFTER_MS ? 'ONLINE' : 'STALE';
}

export function getLatestTimestamp(...timestamps) {
  return timestamps
    .filter(Boolean)
    .map((timestamp) => new Date(timestamp).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0] || null;
}
