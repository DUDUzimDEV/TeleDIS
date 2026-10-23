import React, { useEffect, useRef } from 'react';
import { CircleMarker } from 'react-leaflet';

export default function AnimatedMachineMarker({ center, durationMs = 900, ...props }) {
  const markerRef = useRef(null);
  const frameRef = useRef(null);

  useEffect(() => {
    const marker = markerRef.current;
    const targetLatitude = Number(center?.[0]);
    const targetLongitude = Number(center?.[1]);
    if (!marker || !Number.isFinite(targetLatitude) || !Number.isFinite(targetLongitude)) return undefined;

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    const origin = marker.getLatLng();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || durationMs <= 0) {
      marker.setLatLng([targetLatitude, targetLongitude]);
      return undefined;
    }

    const startedAt = performance.now();
    const animate = (now) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - ((1 - progress) ** 3);
      marker.setLatLng([
        origin.lat + (targetLatitude - origin.lat) * eased,
        origin.lng + (targetLongitude - origin.lng) * eased,
      ]);
      if (progress < 1) frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [center?.[0], center?.[1], durationMs]);

  return <CircleMarker ref={markerRef} center={center} {...props} />;
}
