import type { Coordinates } from '@/providers/api-interfaces';
import L, { type Map as LeafletMap, type Marker as LeafletMarker, type Polyline } from 'leaflet';
import { Map as MapLibreMap, Marker as MapLibreMarker, type GeoJSONSource, LngLatBounds } from 'maplibre-gl';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSpeedResponsiveZoom, getTargetBearing, isValidMapCoordinate } from '../passenger/views/LiveCoachMap';

const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY as string;
const MAP_STYLE_URL = `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(MAPTILER_API_KEY)}`;
const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const MAP_RASTER_URL = `${APP_BASE_PATH}/api/map-tiles/{z}/{x}/{y}.png`;
const TRAFFIC_RASTER_URL = `${APP_BASE_PATH}/api/traffic/flow/{z}/{x}/{y}.png`;
const MAP_LOAD_TIMEOUT_MS = 8_000;

function supportsWebGL2() {
  try { return Boolean(document.createElement('canvas').getContext('webgl2')); }
  catch { return false; }
}

interface OperatorMapProps {
  coach: Coordinates | null;
  route: Coordinates[];
  nextStop: Coordinates | null;
  speedMph?: number | null;
  overviewMode: boolean;
  onInteract?: () => void;
  alternatives?: Array<{ id: string; routeGeometry: Coordinates[]; timeDifferenceSeconds: number }>;
  selectedRouteId?: string | null;
  onSelectAlternative?: (id: string) => void;
}

function delayLabel(seconds: number) {
  const minutes = Math.max(1, Math.round(Math.abs(seconds) / 60));
  return seconds < 0 ? `${minutes} min faster` : `+${minutes} min`;
}
function RasterFallbackMap({ coach, route, nextStop, speedMph, bearing, overviewMode, onInteract, alternatives = [], selectedRouteId, onSelectAlternative }: OperatorMapProps & { bearing: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const coachMarkerRef = useRef<LeafletMarker | null>(null);
  const stopMarkerRef = useRef<LeafletMarker | null>(null);
  const routeLinesRef = useRef<Polyline[]>([]);
  const alternativeLayersRef = useRef<L.Layer[]>([]);
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      attributionControl: false,
      zoomControl: true,
    }).setView([coach?.lat ?? 40.7, coach?.lng ?? -74.0], getSpeedResponsiveZoom(speedMph));
    mapRef.current = map;
    L.tileLayer(MAP_RASTER_URL, { maxZoom: 20, tileSize: 512, zoomOffset: -1 }).addTo(map);
    L.tileLayer(TRAFFIC_RASTER_URL, { maxZoom: 20, opacity: 0.8 }).addTo(map);

    const recordUserInteraction = () => onInteractRef.current?.();
    containerRef.current.addEventListener('pointerdown', recordUserInteraction);
    containerRef.current.addEventListener('wheel', recordUserInteraction, { passive: true });
    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      containerRef.current?.removeEventListener('pointerdown', recordUserInteraction);
      containerRef.current?.removeEventListener('wheel', recordUserInteraction);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    routeLinesRef.current.forEach(line => line.remove());
    if (route.length < 2) return;
    const points = route.map(p => [p.lat, p.lng] as [number, number]);
    routeLinesRef.current = [
      L.polyline(points, { color: '#1e40af', weight: 10, opacity: 0.75 }).addTo(map),
      L.polyline(points, { color: '#3b82f6', weight: 6 }).addTo(map),
    ];
  }, [route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    alternativeLayersRef.current.forEach(layer => layer.remove());
    alternativeLayersRef.current = [];
    alternatives.forEach((alternative) => {
      const points = alternative.routeGeometry.filter(isValidMapCoordinate).map(point => [point.lat, point.lng] as [number, number]);
      if (points.length < 2) return;
      const selected = selectedRouteId === alternative.id;
      const line = L.polyline(points, {
        color: selected ? '#0f766e' : '#64748b',
        weight: selected ? 8 : 6,
        opacity: selected ? 0.9 : 0.7,
        dashArray: selected ? undefined : '10 8',
      }).addTo(map);
      line.on('click', () => onSelectAlternative?.(alternative.id));
      const midpoint = points[Math.floor(points.length / 2)];
      const bubble = L.marker(midpoint, {
        icon: L.divIcon({
          className: '',
          html: `<button type="button" aria-label="Select route ${delayLabel(alternative.timeDifferenceSeconds)}" style="white-space:nowrap;border:2px solid white;border-radius:9999px;background:${selected ? '#0f766e' : '#334155'};color:white;padding:6px 10px;font-weight:800;box-shadow:0 3px 10px rgba(0,0,0,.28)">${delayLabel(alternative.timeDifferenceSeconds)}</button>`,
          iconAnchor: [42, 16],
        }),
      }).addTo(map);
      bubble.on('click', () => onSelectAlternative?.(alternative.id));
      alternativeLayersRef.current.push(line, bubble);
    });
  }, [alternatives, selectedRouteId, onSelectAlternative]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coach) return;
    
    const coachIcon = L.divIcon({
      className: '',
      html: `<div style="display:flex;width:72px;height:72px;align-items:center;justify-content:center;transform:rotate(${bearing}deg)">
        <div style="position:absolute;width:60px;height:60px;background:radial-gradient(circle,rgba(59,130,246,.28),transparent 68%);border-radius:50%"></div>
        <div style="position:absolute;width:28px;height:28px;background:white;border-radius:50%;box-shadow:0 3px 9px rgba(0,0,0,.22)"></div>
        <svg viewBox="0 0 24 24" style="position:relative;width:32px;height:32px;fill:#2563eb;stroke:white;stroke-width:1.5"><path d="M12 3L4 20l8-4 8 4L12 3z"/></svg>
      </div>`,
      iconSize: [72, 72], iconAnchor: [36, 36]
    });
    
    if (!coachMarkerRef.current) {
      coachMarkerRef.current = L.marker([coach.lat, coach.lng], { icon: coachIcon, zIndexOffset: 1000 }).addTo(map);
    } else {
      coachMarkerRef.current.setLatLng([coach.lat, coach.lng]).setIcon(coachIcon);
    }

    if (overviewMode && route.length > 0) {
       const bounds = L.latLngBounds(route.map(r => [r.lat, r.lng]));
       bounds.extend([coach.lat, coach.lng]);
       map.flyToBounds(bounds, { paddingBottomRight: [0, 160], paddingTopLeft: [0, 80], duration: 0.75 });
    } else if (!overviewMode) {
       map.flyTo([coach.lat, coach.lng], getSpeedResponsiveZoom(speedMph), { duration: 0.75 });
    }
  }, [coach, route, speedMph, bearing, overviewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !nextStop) {
       stopMarkerRef.current?.remove();
       stopMarkerRef.current = null;
       return;
    }
    const icon = L.divIcon({
      className: '',
      html: '<div style="width:24px;height:24px;border:4px solid #1d4ed8;border-radius:50%;background:white;box-shadow:0 2px 8px rgba(0,0,0,.2)"></div>',
      iconSize: [24, 24], iconAnchor: [12, 12],
    });
    if (!stopMarkerRef.current) {
      stopMarkerRef.current = L.marker([nextStop.lat, nextStop.lng], { icon }).addTo(map);
    } else {
      stopMarkerRef.current.setLatLng([nextStop.lat, nextStop.lng]);
    }
  }, [nextStop]);

  return <div ref={containerRef} className="absolute inset-0 z-10 bg-[#e8f4ea]" />;
}

function createCoachMarkerElement() {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;width:120px;height:120px;align-items:center;justify-content:center;';
  el.innerHTML = `
    <div style="position:absolute;width:90px;height:90px;background:radial-gradient(circle,rgba(59,130,246,.3) 0%,rgba(59,130,246,.05) 60%,transparent 100%);border-radius:50%"></div>
    <div style="position:absolute;width:32px;height:32px;background:white;border-radius:50%;box-shadow:0 4px 10px rgba(0,0,0,.15)"></div>
    <svg viewBox="0 0 24 24" style="position:relative;z-index:10;width:36px;height:36px;fill:#3b82f6;stroke:white;stroke-width:1.5px;stroke-linejoin:round;stroke-linecap:round"><path d="M12 3L4 20l8-4 8 4L12 3z"/></svg>`;
  return el;
}

function createStopMarkerElement() {
  const el = document.createElement('div');
  el.style.cssText = 'width:24px;height:24px;border:4px solid #1d4ed8;border-radius:9999px;background:white;box-shadow:0 2px 8px rgba(0,0,0,.2)';
  return el;
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

function syncDetailedMapLayers(map: MapLibreMap, route: Coordinates[]) {
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

  if (map.getLayer('Building 3D')) {
    map.setPaintProperty('Building 3D', 'fill-extrusion-color', '#d8d6d1');
    map.setPaintProperty('Building 3D', 'fill-extrusion-height', [
      'min',
      ['coalesce', ['get', 'render_height'], ['get', 'height'], 4],
      25,
    ]);
    map.setPaintProperty('Building 3D', 'fill-extrusion-base', [
      'coalesce',
      ['get', 'render_min_height'],
      ['get', 'min_height'],
      0,
    ]);
    map.setPaintProperty('Building 3D', 'fill-extrusion-opacity', 0.48);
  }

  const source = map.getSource('coach-route') as GeoJSONSource | undefined;
  if (source) {
    source.setData(routeGeoJson(route));
    return;
  }

  const firstLabelId = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
  map.addSource('coach-route', { type: 'geojson', data: routeGeoJson(route) });
  map.addLayer({
    id: 'coach-route-casing',
    type: 'line',
    source: 'coach-route',
    paint: { 'line-color': '#172554', 'line-width': 13, 'line-opacity': 0.82 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  }, firstLabelId);
  map.addLayer({
    id: 'coach-route-line',
    type: 'line',
    source: 'coach-route',
    paint: { 'line-color': '#2563eb', 'line-width': 8 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  }, firstLabelId);
}

export function OperatorMap({ coach: rawCoach, route: rawRoute, nextStop: rawNextStop, speedMph, overviewMode, onInteract, alternatives = [], selectedRouteId, onSelectAlternative }: OperatorMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const coachMarkerRef = useRef<MapLibreMarker | null>(null);
  const stopMarkerRef = useRef<MapLibreMarker | null>(null);
  const alternativeMarkersRef = useRef<MapLibreMarker[]>([]);
  const alternativeRoutesRef = useRef<Array<{
    sourceId: string;
    layerId: string;
    onClick: () => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  }>>([]);
  const [mapUnavailable, setMapUnavailable] = useState(!supportsWebGL2());
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  
  const coach = isValidMapCoordinate(rawCoach) ? rawCoach : null;
  const route = useMemo(() => rawRoute.filter(isValidMapCoordinate), [rawRoute]);
  const nextStop = isValidMapCoordinate(rawNextStop) ? rawNextStop : null;

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
    if (!containerRef.current || mapRef.current || mapUnavailable) return;
    if (!MAPTILER_API_KEY) {
      console.error('MapTiler API key is required for detailed driver navigation.');
      setMapUnavailable(true);
      return;
    }
    try {
      const center = coach ?? route[0] ?? nextStop ?? { lat: 40.7128, lng: -74.006 };
      const map = new MapLibreMap({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: [center.lng, center.lat],
        zoom: getSpeedResponsiveZoom(speedMph),
        pitch: overviewMode ? 0 : 48,
        bearing: overviewMode ? 0 : continuousBearing,
        attributionControl: false,
        interactive: true,
      });
      mapRef.current = map;

      map.on('dragstart', () => onInteractRef.current?.());
      map.on('zoomstart', (e) => {
         if (e.originalEvent) onInteractRef.current?.();
      });

      let mapLoaded = false;
      const loadTimeout = window.setTimeout(() => {
        if (mapLoaded || mapRef.current !== map) return;
        console.error('Driver navigation map style timed out; switching to raster tiles.');
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
        console.error('Driver navigation map failed to load a resource.', event.error);
      });
      map.getCanvas().addEventListener('webglcontextlost', () => {
        window.clearTimeout(loadTimeout);
        if (mapRef.current !== map) return;
        map.remove();
        mapRef.current = null;
        setMapUnavailable(true);
      }, { once: true });
    } catch (error) {
      console.error('Driver navigation map could not initialize.', error);
      setMapUnavailable(true);
    }
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, [mapUnavailable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => syncDetailedMapLayers(map, route);
    if (map.isStyleLoaded()) update();
    else map.once('load', update);
    return () => {
      map.off('load', update);
    };
  }, [route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const removeAlternatives = () => {
      alternativeMarkersRef.current.forEach(marker => marker.remove());
      alternativeMarkersRef.current = [];
      alternativeRoutesRef.current.forEach(({ sourceId, layerId, onClick, onMouseEnter, onMouseLeave }) => {
        map.off('click', layerId, onClick);
        map.off('mouseenter', layerId, onMouseEnter);
        map.off('mouseleave', layerId, onMouseLeave);
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      });
      alternativeRoutesRef.current = [];
    };
    const update = () => {
      removeAlternatives();
      alternatives.forEach((alternative) => {
        const geometry = alternative.routeGeometry.filter(isValidMapCoordinate);
        if (geometry.length < 2) return;
        const sourceId = `coach-route-${alternative.id}`;
        const layerId = `${sourceId}-line`;
        const data = {
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'LineString' as const, coordinates: geometry.map(point => [point.lng, point.lat]) },
        };
        map.addSource(sourceId, { type: 'geojson', data });
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': selectedRouteId === alternative.id ? '#0f766e' : '#64748b',
            'line-width': selectedRouteId === alternative.id ? 8 : 6,
            'line-opacity': selectedRouteId === alternative.id ? 0.9 : 0.7,
            'line-dasharray': selectedRouteId === alternative.id ? [1, 0] : [2, 1.5],
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        const onClick = () => onSelectAlternative?.(alternative.id);
        const onMouseEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
        const onMouseLeave = () => { map.getCanvas().style.cursor = ''; };
        map.on('click', layerId, onClick);
        map.on('mouseenter', layerId, onMouseEnter);
        map.on('mouseleave', layerId, onMouseLeave);
        alternativeRoutesRef.current.push({ sourceId, layerId, onClick, onMouseEnter, onMouseLeave });
        const midpoint = geometry[Math.floor(geometry.length / 2)];
        if (!midpoint) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = delayLabel(alternative.timeDifferenceSeconds);
        button.setAttribute('aria-label', `Select route ${delayLabel(alternative.timeDifferenceSeconds)}`);
        button.style.cssText = `white-space:nowrap;border:2px solid white;border-radius:9999px;background:${selectedRouteId === alternative.id ? '#0f766e' : '#334155'};color:white;padding:6px 10px;font-weight:800;box-shadow:0 3px 10px rgba(0,0,0,.28);cursor:pointer`;
        button.addEventListener('click', () => onSelectAlternative?.(alternative.id));
        alternativeMarkersRef.current.push(new MapLibreMarker({ element: button }).setLngLat([midpoint.lng, midpoint.lat]).addTo(map));
      });
    };
    if (map.isStyleLoaded()) update();
    else map.once('load', update);
    return () => {
      map.off('load', update);
      removeAlternatives();
    };
  }, [alternatives, selectedRouteId, onSelectAlternative]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coach) return;
    
    if (!coachMarkerRef.current) {
      coachMarkerRef.current = new MapLibreMarker({ element: createCoachMarkerElement(), anchor: 'center', rotationAlignment: 'viewport' })
        .setLngLat([coach.lng, coach.lat])
        .addTo(map);
    } else {
      coachMarkerRef.current.setLngLat([coach.lng, coach.lat]);
    }

    if (overviewMode && route.length > 0) {
       const bounds = new LngLatBounds();
       bounds.extend([coach.lng, coach.lat]);
       route.forEach(c => bounds.extend([c.lng, c.lat]));
       map.fitBounds(bounds, { padding: { top: 80, bottom: 160, left: 64, right: 64 }, duration: 1000, pitch: 0, bearing: 0 });
    } else if (!overviewMode) {
       map.easeTo({
         center: [coach.lng, coach.lat],
         zoom: getSpeedResponsiveZoom(speedMph),
         pitch: 48,
         bearing: continuousBearing,
         padding: { top: 220, bottom: 150, left: 0, right: 0 },
         duration: 1000,
         essential: true
       });
    }
  }, [coach, route, speedMph, continuousBearing, overviewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!nextStop) {
      stopMarkerRef.current?.remove();
      stopMarkerRef.current = null;
      return;
    }
    if (!stopMarkerRef.current) {
      stopMarkerRef.current = new MapLibreMarker({ element: createStopMarkerElement(), anchor: 'center' })
        .setLngLat([nextStop.lng, nextStop.lat])
        .addTo(map);
    } else {
      stopMarkerRef.current.setLngLat([nextStop.lng, nextStop.lat]);
    }
  }, [nextStop]);

  return (
    <div className="absolute inset-0 bg-[#e8f4ea] overflow-hidden">
      {mapUnavailable ? (
        <RasterFallbackMap coach={coach} route={route} nextStop={nextStop} speedMph={speedMph} bearing={continuousBearing} overviewMode={overviewMode} onInteract={onInteract} alternatives={alternatives} selectedRouteId={selectedRouteId} onSelectAlternative={onSelectAlternative} />
      ) : (
        <div ref={containerRef} className="absolute inset-0 z-10" />
      )}
    </div>
  );
}
