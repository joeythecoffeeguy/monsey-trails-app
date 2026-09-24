import type { Coordinates } from '@/providers/api-interfaces';
import L, { type Map as LeafletMap, type Marker as LeafletMarker, type Polyline } from 'leaflet';
import { Map as MapLibreMap, Marker as MapLibreMarker, type GeoJSONSource } from 'maplibre-gl';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';

export const DEFAULT_DRIVING_ZOOM = 15;
export const NEIGHBORHOOD_DRIVING_ZOOM = 17;
export const HIGHWAY_DRIVING_MPH = 50;
export const FULL_HIGHWAY_ZOOM_MPH = 70;

function interpolateZoom(
  speedMph: number,
  startMph: number,
  endMph: number,
  startZoom: number,
  endZoom: number,
) {
  const progress = (speedMph - startMph) / (endMph - startMph);
  return Math.round((startZoom + (endZoom - startZoom) * progress) * 4) / 4;
}

export function getSpeedResponsiveZoom(speedMph: number | null | undefined) {
  if (speedMph === null || speedMph === undefined || !Number.isFinite(speedMph)) {
    return DEFAULT_DRIVING_ZOOM;
  }
  if (speedMph <= HIGHWAY_DRIVING_MPH) return NEIGHBORHOOD_DRIVING_ZOOM;
  if (speedMph >= FULL_HIGHWAY_ZOOM_MPH) return DEFAULT_DRIVING_ZOOM;
  return interpolateZoom(
    speedMph,
    HIGHWAY_DRIVING_MPH,
    FULL_HIGHWAY_ZOOM_MPH,
    NEIGHBORHOOD_DRIVING_ZOOM,
    DEFAULT_DRIVING_ZOOM,
  );
}

export function calculateBearing(start: Coordinates, end: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const lat1 = toRad(start.lat);
  const lat2 = toRad(end.lat);
  const dLng = toRad(end.lng - start.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function getTargetBearing(coach: Coordinates | null, route: Coordinates[]): number {
  if (!coach || route.length < 2) return 0;

  let closestIndex = 0;
  let minDistance = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const dist = Math.pow(route[i].lat - coach.lat, 2) + Math.pow(route[i].lng - coach.lng, 2);
    if (dist < minDistance) {
      minDistance = dist;
      closestIndex = i;
    }
  }

  const nextIndex = closestIndex + 1 < route.length ? closestIndex + 1 : closestIndex;
  if (closestIndex === nextIndex) {
    if (closestIndex > 0) return calculateBearing(route[closestIndex - 1], route[closestIndex]);
    return 0;
  }

  return calculateBearing(route[closestIndex], route[nextIndex]);
}

interface LiveCoachMapProps {
  coach: Coordinates | null;
  route: Coordinates[];
  nextStop: Coordinates | null;
  stops?: Array<{
    id: string;
    location: Coordinates;
    status: 'on-time' | 'delayed' | 'departed';
    isDestination: boolean;
  }>;
  speedMph?: number | null;
  cameraMode?: 'follow' | 'overview';
}

const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY as string;
const MAP_STYLE_URL = `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(MAPTILER_API_KEY)}`;
const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const MAP_RASTER_URL = `${APP_BASE_PATH}/api/map-tiles/{z}/{x}/{y}.png`;
const TRAFFIC_RASTER_URL = `${APP_BASE_PATH}/api/traffic/flow/{z}/{x}/{y}.png`;
const MAP_LOAD_TIMEOUT_MS = 8_000;

export function isValidMapCoordinate(value: Coordinates | null | undefined): value is Coordinates {
  return Boolean(
    value
    && Number.isFinite(value.lat)
    && Number.isFinite(value.lng)
    && value.lat >= -90
    && value.lat <= 90
    && value.lng >= -180
    && value.lng <= 180,
  );
}

function supportsWebGL2() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

function RasterFallbackMap({ coach, route, nextStop, stops = [], speedMph, bearing, cameraMode = 'follow' }: LiveCoachMapProps & { bearing: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const coachMarkerRef = useRef<LeafletMarker | null>(null);
  const stopMarkerRef = useRef<Map<string, LeafletMarker>>(new Map());
  const routeLinesRef = useRef<Polyline[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    const center = coach ?? route[0] ?? nextStop ?? { lat: 40.7128, lng: -74.006 };
     const map = L.map(container, {
      attributionControl: false,
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomSnap: 0.25,
     }).setView([center.lat, center.lng], getSpeedResponsiveZoom(speedMph));
     if (cameraMode === 'overview') {
       const points = [coach, ...route, ...stops.map((stop) => stop.location), nextStop]
         .filter(isValidMapCoordinate)
         .map((point) => [point.lat, point.lng] as [number, number]);
       if (points.length > 1) map.fitBounds(points, { padding: [48, 48], maxZoom: 12, animate: false });
     }
    mapRef.current = map;
    L.tileLayer(MAP_RASTER_URL, { maxZoom: 20, tileSize: 512, zoomOffset: -1 }).addTo(map);
    L.tileLayer(TRAFFIC_RASTER_URL, { maxZoom: 20, opacity: 0.8 }).addTo(map);
    const invalidate = () => map.invalidateSize({ animate: false, pan: false });
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(invalidate);
    resizeObserver?.observe(container);
    const delayedInvalidations = [
      window.setTimeout(invalidate, 0),
      window.setTimeout(invalidate, 250),
      window.setTimeout(invalidate, 800),
    ];
    return () => {
      resizeObserver?.disconnect();
      delayedInvalidations.forEach(window.clearTimeout);
      map.remove();
      mapRef.current = null;
    };
   }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    routeLinesRef.current.forEach((line) => line.remove());
    routeLinesRef.current = [];
    if (route.length < 2) return;
    const points = route.map(({ lat, lng }) => [lat, lng] as [number, number]);
    routeLinesRef.current = [
      L.polyline(points, { color: '#1e40af', weight: 10, opacity: 0.75 }).addTo(map),
      L.polyline(points, { color: '#3b82f6', weight: 6 }).addTo(map),
    ];
  }, [route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coach) return;
    const coachIcon = L.divIcon({
      className: '',
      html: `<div aria-label="Current coach location" style="display:flex;width:72px;height:72px;align-items:center;justify-content:center;transform:rotate(${bearing}deg)">
        <div style="position:absolute;width:60px;height:60px;background:radial-gradient(circle,rgba(59,130,246,.28),transparent 68%);border-radius:50%"></div>
        <div style="position:absolute;width:28px;height:28px;background:white;border-radius:50%;box-shadow:0 3px 9px rgba(0,0,0,.22)"></div>
        <svg viewBox="0 0 24 24" style="position:relative;width:32px;height:32px;fill:#2563eb;stroke:white;stroke-width:1.5"><path d="M12 3L4 20l8-4 8 4L12 3z"/></svg>
      </div>`,
      iconSize: [72, 72],
      iconAnchor: [36, 36],
    });
    if (!coachMarkerRef.current) {
      coachMarkerRef.current = L.marker([coach.lat, coach.lng], { icon: coachIcon, zIndexOffset: 1000 }).addTo(map);
    } else {
      coachMarkerRef.current.setLatLng([coach.lat, coach.lng]).setIcon(coachIcon);
    }
     if (cameraMode === 'follow') {
       map.flyTo([coach.lat, coach.lng], getSpeedResponsiveZoom(speedMph), { animate: true, duration: 0.75 });
     }
   }, [coach?.lat, coach?.lng, speedMph, bearing, cameraMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const activeStopId = stops.find((stop) => stop.status !== 'departed')?.id;
    const nextStops = stops.length > 0
      ? stops
      : nextStop ? [{ id: 'next-stop', location: nextStop, status: 'on-time' as const, isDestination: true }] : [];
    const ids = new Set(nextStops.map((stop) => stop.id));
    stopMarkerRef.current.forEach((marker, id) => {
      if (!ids.has(id)) {
        marker.remove();
        stopMarkerRef.current.delete(id);
      }
    });
    nextStops.forEach((stop) => {
      const isCurrent = stop.id === activeStopId;
      const color = stop.isDestination ? '#1d4ed8' : isCurrent ? '#0f766e' : stop.status === 'departed' ? '#64748b' : '#2563eb';
      const icon = L.divIcon({
        className: '',
        html: `<div aria-label="${isCurrent ? 'Current stop' : stop.isDestination ? 'Final destination' : stop.status === 'departed' ? 'Passed stop' : 'Upcoming stop'}" style="width:${isCurrent ? 28 : 20}px;height:${isCurrent ? 28 : 20}px;border:4px solid ${color};border-radius:50%;background:${stop.status === 'departed' ? '#e2e8f0' : 'white'};box-shadow:0 2px 8px rgba(0,0,0,.2)"></div>`,
        iconSize: [isCurrent ? 28 : 20, isCurrent ? 28 : 20],
        iconAnchor: [isCurrent ? 14 : 10, isCurrent ? 14 : 10],
      });
      const marker = stopMarkerRef.current.get(stop.id);
      if (marker) marker.setLatLng([stop.location.lat, stop.location.lng]).setIcon(icon);
      else stopMarkerRef.current.set(stop.id, L.marker([stop.location.lat, stop.location.lng], { icon }).addTo(map));
    });
  }, [nextStop?.lat, nextStop?.lng, stops]);

  return <div ref={containerRef} className="absolute inset-0 z-10 bg-[#e8f4ea]" data-testid="raster-live-coach-map" />;
}

function createCoachMarkerElement() {
  const element = document.createElement('div');
  element.setAttribute('aria-label', 'Current coach location');
  element.style.cssText = 'display:flex;width:120px;height:120px;align-items:center;justify-content:center;';
  element.innerHTML = `
    <div style="position:absolute;width:90px;height:90px;background:radial-gradient(circle,rgba(59,130,246,.3) 0%,rgba(59,130,246,.05) 60%,transparent 100%);border-radius:50%"></div>
    <div style="position:absolute;width:32px;height:32px;background:white;border-radius:50%;box-shadow:0 4px 10px rgba(0,0,0,.15)"></div>
    <svg viewBox="0 0 24 24" style="position:relative;z-index:10;width:36px;height:36px;fill:#3b82f6;stroke:white;stroke-width:1.5px;stroke-linejoin:round;stroke-linecap:round"><path d="M12 3L4 20l8-4 8 4L12 3z"/></svg>`;
  return element;
}

function createStopMarkerElement(
  kind: 'current' | 'upcoming' | 'passed' | 'final' = 'current',
) {
  const element = document.createElement('div');
  const labels = {
    current: 'Current stop location',
    upcoming: 'Upcoming stop location',
    passed: 'Passed stop location',
    final: 'Final destination location',
  };
  const colors = { current: '#0f766e', upcoming: '#2563eb', passed: '#64748b', final: '#1d4ed8' };
  const size = kind === 'current' ? 28 : 20;
  element.setAttribute('aria-label', labels[kind]);
  element.style.cssText = `width:${size}px;height:${size}px;border:4px solid ${colors[kind]};border-radius:9999px;background:${kind === 'passed' ? '#e2e8f0' : 'white'};box-shadow:0 2px 8px rgba(0,0,0,.2)`;
  return element;
}

function routeGeoJson(route: Coordinates[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: route.map(({ lng, lat }) => [lng, lat]),
    },
  };
}

function syncRoute(map: MapLibreMap, route: Coordinates[]) {
  if (!map.getSource('maptiler-raster-safety-base')) {
    map.addSource('maptiler-raster-safety-base', {
      type: 'raster',
      tiles: [MAP_RASTER_URL],
      tileSize: 512,
      maxzoom: 20,
    });
    const firstNonBackgroundId = map.getStyle().layers?.find((layer) => layer.type !== 'background')?.id;
    map.addLayer({
      id: 'maptiler-raster-safety-base',
      type: 'raster',
      source: 'maptiler-raster-safety-base',
      paint: { 'raster-fade-duration': 100 },
    }, firstNonBackgroundId);
  }
  if (!map.getSource('tomtom-traffic')) {
    map.addSource('tomtom-traffic', {
      type: 'raster',
      tiles: [TRAFFIC_RASTER_URL],
      tileSize: 256,
      maxzoom: 20,
    });
    const firstLabelId = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
    map.addLayer({
      id: 'tomtom-traffic',
      type: 'raster',
      source: 'tomtom-traffic',
      paint: { 'raster-opacity': 0.8, 'raster-fade-duration': 200 },
    }, firstLabelId);
  }
  const source = map.getSource('coach-route') as GeoJSONSource | undefined;
  if (source) {
    source.setData(routeGeoJson(route));
    return;
  }
  const firstLabelId = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
  if (map.getLayer('Building 3D')) {
    map.setPaintProperty('Building 3D', 'fill-extrusion-color', '#d8d6d1');
    map.setPaintProperty('Building 3D', 'fill-extrusion-height', [
      'min',
      ['coalesce', ['get', 'render_height'], ['get', 'height'], 4],
      25,
    ]);
    map.setPaintProperty('Building 3D', 'fill-extrusion-base', 0);
    map.setPaintProperty('Building 3D', 'fill-extrusion-opacity', 0.38);
  }
  map.addSource('coach-route', { type: 'geojson', data: routeGeoJson(route) });
  map.addLayer({
    id: 'coach-route-casing',
    type: 'line',
    source: 'coach-route',
    paint: { 'line-color': '#1e40af', 'line-width': 12, 'line-opacity': 0.8 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  }, firstLabelId);
  map.addLayer({
    id: 'coach-route-line',
    type: 'line',
    source: 'coach-route',
    paint: { 'line-color': '#3b82f6', 'line-width': 7 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  }, firstLabelId);
}

/**
 * MapLibre creates its style asynchronously. Effects that add DOM markers
 * must defer their first sync until that style is ready, otherwise the
 * initial sync can be lost forever.
 */
export function runWhenMapReady(map: MapLibreMap, callback: () => void) {
  if (map.isStyleLoaded()) {
    callback();
    return () => undefined;
  }
  map.once('load', callback);
  return () => {
    map.off('load', callback);
  };
}

export function fitOverview(map: MapLibreMap, points: Coordinates[]) {
  if (points.length < 2) return;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  map.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 64, maxZoom: 12, duration: 0, essential: true },
  );
}

export function LiveCoachMap({ coach: rawCoach, route: rawRoute, nextStop: rawNextStop, stops: rawStops, speedMph, cameraMode = 'follow' }: LiveCoachMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const coachMarkerRef = useRef<MapLibreMarker | null>(null);
  const stopMarkerRef = useRef<Map<string, MapLibreMarker>>(new Map());
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const coach = isValidMapCoordinate(rawCoach) ? rawCoach : null;
  const route = useMemo(() => rawRoute.filter(isValidMapCoordinate), [rawRoute]);
  const nextStop = isValidMapCoordinate(rawNextStop) ? rawNextStop : null;
  const stops = useMemo(
    () => rawStops?.filter((stop) => isValidMapCoordinate(stop.location)) ?? [],
    [rawStops],
  );
  const overviewPoints = useMemo(
    () => [coach, ...route, ...stops.map((stop) => stop.location), nextStop].filter(isValidMapCoordinate),
    [coach, route, stops, nextStop],
  );
  const overviewSignature = cameraMode === 'overview'
    ? overviewPoints.map((point) => `${point.lat},${point.lng}`).join('|')
    : '';

  const targetBearing = useMemo(() => getTargetBearing(coach, route), [coach, route]);
  const [continuousBearing, setContinuousBearing] = useState(targetBearing);
  const prevTargetRef = useRef(targetBearing);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      setContinuousBearing(targetBearing);
      prevTargetRef.current = targetBearing;
      initializedRef.current = true;
      return;
    }
    let diff = targetBearing - (prevTargetRef.current % 360);
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    const nextContinuous = prevTargetRef.current + diff;
    setContinuousBearing(nextContinuous);
    prevTargetRef.current = nextContinuous;
  }, [targetBearing]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!supportsWebGL2()) {
      setMapUnavailable(true);
      return;
    }
    try {
      const center = coach ?? route[0] ?? nextStop ?? { lat: 40.7128, lng: -74.006 };
      if (!MAPTILER_API_KEY) {
        throw new Error('MAPTILER_API_KEY is required for the live coach map.');
      }
      const map = new MapLibreMap({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: [center.lng, center.lat],
        zoom: getSpeedResponsiveZoom(speedMph),
        pitch: 48,
        bearing: targetBearing,
        attributionControl: false,
        interactive: false,
      });
      mapRef.current = map;
      let mapLoaded = false;
      const loadTimeout = window.setTimeout(() => {
        if (mapLoaded || mapRef.current !== map) return;
        console.error('Live coach map style timed out; switching to raster tiles.');
        map.remove();
        mapRef.current = null;
        setMapUnavailable(true);
      }, MAP_LOAD_TIMEOUT_MS);
      map.once('load', () => {
        mapLoaded = true;
        window.clearTimeout(loadTimeout);
        map.resize();
      });
      map.on('error', (event) => {
        console.error('Live coach map failed to load a resource.', event.error);
      });
      map.getCanvas().addEventListener('webglcontextlost', () => {
        window.clearTimeout(loadTimeout);
        if (mapRef.current !== map) return;
        map.remove();
        mapRef.current = null;
        setMapUnavailable(true);
      }, { once: true });
    } catch (error) {
      console.error('Live coach map could not initialize.', error);
      setMapUnavailable(true);
    }
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => syncRoute(map, route);
    if (map.isStyleLoaded()) update();
    else map.once('load', update);
    return () => {
      map.off('load', update);
    };
  }, [route, coach]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coach) return;
    if (!coachMarkerRef.current) {
      coachMarkerRef.current = new MapLibreMarker({
        element: createCoachMarkerElement(),
        anchor: 'center',
        rotationAlignment: 'viewport',
      })
        .setLngLat([coach.lng, coach.lat])
        .addTo(map);
    } else {
      coachMarkerRef.current.setLngLat([coach.lng, coach.lat]);
    }
    if (cameraMode === 'follow') {
      map.easeTo({
        center: [coach.lng, coach.lat],
        zoom: getSpeedResponsiveZoom(speedMph),
        pitch: 48,
        bearing: continuousBearing,
        offset: [0, Math.round(map.getContainer().clientHeight * 0.18)],
        duration: 750,
        essential: true,
      });
    }
  }, [coach?.lat, coach?.lng, speedMph, continuousBearing, cameraMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // The stops effect can run before the asynchronously loaded MapLibre style.
    // In that case mapRef exists but addTo(map) cannot attach markers yet, and
    // the effect would previously never run again (the props do not change when
    // the style finishes loading). Always sync once the map emits `load`.
    const syncStopMarkers = () => {
      const activeStopId = stops.find((stop) => stop.status !== 'departed')?.id;
      const mapStops = stops.length > 0
        ? stops
        : nextStop ? [{ id: 'next-stop', location: nextStop, status: 'on-time' as const, isDestination: true }] : [];
      const ids = new Set(mapStops.map((stop) => stop.id));
      stopMarkerRef.current.forEach((marker, id) => {
        if (!ids.has(id)) {
          marker.remove();
          stopMarkerRef.current.delete(id);
        }
      });
      mapStops.forEach((stop) => {
        const kind = stop.isDestination
          ? 'final'
          : stop.id === activeStopId
            ? 'current'
            : stop.status === 'departed' ? 'passed' : 'upcoming';
        const marker = stopMarkerRef.current.get(stop.id);
        if (marker) {
          marker.remove();
          stopMarkerRef.current.set(stop.id, new MapLibreMarker({
            element: createStopMarkerElement(kind),
            anchor: 'center',
          }).setLngLat([stop.location.lng, stop.location.lat]).addTo(map));
        } else {
          stopMarkerRef.current.set(stop.id, new MapLibreMarker({
            element: createStopMarkerElement(kind),
            anchor: 'center',
          }).setLngLat([stop.location.lng, stop.location.lat]).addTo(map));
        }
      });
    };
    return runWhenMapReady(map, syncStopMarkers);
  }, [nextStop?.lat, nextStop?.lng, stops]);

  useEffect(() => {
    if (cameraMode !== 'overview') return;
    const map = mapRef.current;
    if (!map) return;
    const fit = () => fitOverview(map, overviewPoints);
    return runWhenMapReady(map, fit);
  }, [cameraMode, overviewSignature]);

  return (
    <div className="absolute inset-0 bg-[#e8f4ea] overflow-hidden" data-map-camera="3d-follow">
      <div className="absolute inset-0">
        {mapUnavailable ? (
          <RasterFallbackMap
            coach={coach}
            route={route}
            nextStop={nextStop}
            stops={stops}
            speedMph={speedMph}
            bearing={continuousBearing}
            cameraMode={cameraMode}
          />
        ) : (
          <div
            ref={containerRef}
            className="absolute inset-0 z-10 bg-transparent"
            role="img"
            aria-label="Live coach route map"
            data-testid="live-coach-map"
          />
        )}
      </div>

      <div className="absolute bottom-2 right-2 z-30 text-[10px] text-muted-foreground/80 bg-white/70 dark:bg-black/70 px-2 py-1 rounded backdrop-blur-sm">
        © MapTiler © OpenStreetMap contributors · Traffic © TomTom
      </div>
    </div>
  );
}
