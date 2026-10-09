const EARTH_RADIUS_METERS = 6371008.8;

function projectToLocalMeters([latitude, longitude], originLatitude, originLongitude) {
  const latitudeRadians = (latitude * Math.PI) / 180;
  const originLatitudeRadians = (originLatitude * Math.PI) / 180;
  const longitudeRadians = (longitude * Math.PI) / 180;
  const originLongitudeRadians = (originLongitude * Math.PI) / 180;

  return [
    (longitudeRadians - originLongitudeRadians) * Math.cos(originLatitudeRadians) * EARTH_RADIUS_METERS,
    (latitudeRadians - originLatitudeRadians) * EARTH_RADIUS_METERS,
  ];
}

export function snapPointToRoad(clickPoint, roadPoints, toleranceMeters = 30) {
  if (!Array.isArray(roadPoints) || roadPoints.length < 2) {
    return null;
  }

  const [clickLatitude, clickLongitude] = clickPoint;
  let nearestPoint = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < roadPoints.length; index += 1) {
    const start = projectToLocalMeters(roadPoints[index - 1], clickLatitude, clickLongitude);
    const end = projectToLocalMeters(roadPoints[index], clickLatitude, clickLongitude);
    const segmentX = end[0] - start[0];
    const segmentY = end[1] - start[1];
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    if (segmentLengthSquared === 0) {
      continue;
    }

    const fraction = Math.max(0, Math.min(1, -(start[0] * segmentX + start[1] * segmentY) / segmentLengthSquared));
    const projectedX = start[0] + fraction * segmentX;
    const projectedY = start[1] + fraction * segmentY;
    const distance = Math.hypot(projectedX, projectedY);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPoint = [
        clickLatitude + (projectedY / EARTH_RADIUS_METERS) * (180 / Math.PI),
        clickLongitude + (projectedX / (EARTH_RADIUS_METERS * Math.cos((clickLatitude * Math.PI) / 180))) * (180 / Math.PI),
      ];
    }
  }

  if (!nearestPoint || nearestDistance > toleranceMeters) {
    return null;
  }

  return { coordinates: nearestPoint, distanceMeters: nearestDistance };
}