import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { PassengerJourneyStop } from './usePassengerJourney';
import type { Coordinates } from '@/providers/api-interfaces';
import type { JourneyProgressItem } from '@/providers/live-trip';
import { visibleStopNote } from '@/components/passenger/StopNote';

const MAP_RASTER_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/map-tiles/{z}/{x}/{y}.png`;
const TRAFFIC_RASTER_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/traffic/flow/{z}/{x}/{y}.png`;
const SELECTED_STOP_ZOOM = 18;

interface PersonalJourneyMapProps {
  routeGeometry: { lat: number; lng: number }[];
  stops: PassengerJourneyStop[];
  liveCoach: Coordinates | null;
  selectedStopId: string | null;
  onSelectStop: (stopId: string) => void;
  onShowFullRoute: () => void;
  showLiveCoachLegend?: boolean;
  journeyProgress?: JourneyProgressItem[];
}

function coordinateKey(value: number) {
  return Number.isFinite(value) ? value.toFixed(5) : 'invalid';
}

export function journeyViewportKey(
  routeGeometry: { lat: number; lng: number }[],
  stops: PassengerJourneyStop[],
  selectedStopId: string | null,
) {
  if (selectedStopId) {
    const selected = stops.find((stop) => stop.id === selectedStopId);
    return selected
      ? `selected:${selected.id}:${coordinateKey(selected.lat)}:${coordinateKey(selected.lng)}`
      : `selected:${selectedStopId}:missing`;
  }
  const route = routeGeometry
    .map(({ lat, lng }) => `${coordinateKey(lat)},${coordinateKey(lng)}`)
    .join(';');
  const stopCoordinates = stops
    .map(({ id, lat, lng }) => `${id}:${coordinateKey(lat)},${coordinateKey(lng)}`)
    .join(';');
  return `full:${route}|${stopCoordinates}`;
}

export function PersonalJourneyMap({
  routeGeometry,
  stops,
  liveCoach,
  selectedStopId,
  onSelectStop,
  onShowFullRoute,
  showLiveCoachLegend = true,
  journeyProgress = [],
}: PersonalJourneyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const routeBoundsRef = useRef<L.LatLngBounds | null>(null);
  const lastAutoViewportKeyRef = useRef<string | null>(null);
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      attributionControl: true,
      zoomControl: false,
      zoomSnap: 0.1,
    });
    mapRef.current = map;
    
    map.attributionControl.setPrefix('© MapTiler © OpenStreetMap contributors');

    L.tileLayer(MAP_RASTER_URL, { maxZoom: 20, tileSize: 512, zoomOffset: -1 }).addTo(map);
    L.tileLayer(TRAFFIC_RASTER_URL, { maxZoom: 20, opacity: 0.8 }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;

    const invalidate = () => map.invalidateSize();
    const resizeObserver = new ResizeObserver(invalidate);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    const bounds = L.latLngBounds([]);

    const finiteCoords = routeGeometry.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
    if (finiteCoords.length > 1) {
      const latlngs = finiteCoords.map(c => [c.lat, c.lng] as [number, number]);
      L.polyline(latlngs, { color: 'hsl(222, 47%, 11%)', weight: 8, opacity: 0.8 }).addTo(group);
      L.polyline(latlngs, { color: 'hsl(70, 90%, 54%)', weight: 4 }).addTo(group);
      finiteCoords.forEach(c => bounds.extend([c.lat, c.lng]));
    }

    stops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng)).forEach((stop) => {
      const stopNumber = stops.findIndex(candidate => candidate.id === stop.id) + 1;
      const selected = stop.id === selectedStopId;
      const progressStatus = journeyProgress.find((item) => item.id === stop.id)?.status;
      const completed = progressStatus === 'completed';
      const current = progressStatus === 'current';
      const html = `<div aria-label="Stop ${stopNumber}: ${stop.label}" style="width:${selected ? 30 : 24}px;height:${selected ? 30 : 24}px;background:${completed ? '#16a34a' : selected || current ? 'hsl(222, 47%, 11%)' : 'white'};border:3px solid ${completed ? '#15803d' : 'hsl(222, 47%, 11%)'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:${completed || selected || current ? 'white' : 'hsl(222, 47%, 11%)'};box-shadow:0 2px 7px rgba(0,0,0,0.35)">${stopNumber}</div>`;
      const icon = L.divIcon({ html, className: '', iconSize: [24, 24], iconAnchor: [12, 12] });
      const marker = L.marker([stop.lat, stop.lng], {
        icon,
        keyboard: true,
        title: `Stop ${stopNumber}: ${stop.label}`,
        alt: `Stop ${stopNumber}: ${stop.label}`,
      }).addTo(group);
      const note = visibleStopNote(stop.note, stop.label);
      marker.bindTooltip(
        `<div style="max-width:240px;white-space:normal;overflow-wrap:anywhere"><strong>${escapeMapText(stop.label)}</strong>${note ? `<div style="margin-top:3px;color:#475569">${escapeMapText(note)}</div>` : ''}</div>`,
        { direction: 'top', offset: [0, -10] },
      );
      marker.on('click', () => onSelectStop(stop.id));
      bounds.extend([stop.lat, stop.lng]);
    });

    if (liveCoach && Number.isFinite(liveCoach.lat) && Number.isFinite(liveCoach.lng)) {
      const html = `
        <div aria-label="Current coach location" style="display:flex;width:48px;height:48px;align-items:center;justify-content:center;">
          <div style="position:absolute;width:40px;height:40px;background:radial-gradient(circle,rgba(209,242,36,.5),transparent 70%);border-radius:50%"></div>
          <div style="position:absolute;width:20px;height:20px;background:white;border-radius:50%;box-shadow:0 3px 9px rgba(0,0,0,.3)"></div>
          <svg viewBox="0 0 24 24" style="position:relative;width:24px;height:24px;fill:hsl(222, 47%, 11%);stroke:hsl(70, 90%, 54%);stroke-width:1.5"><path d="M12 3L4 20l8-4 8 4L12 3z"/></svg>
        </div>
      `;
      const icon = L.divIcon({ html, className: '', iconSize: [48, 48], iconAnchor: [24, 24] });
      L.marker([liveCoach.lat, liveCoach.lng], { icon, zIndexOffset: 1000 }).addTo(group);
      bounds.extend([liveCoach.lat, liveCoach.lng]);
    }

    routeBoundsRef.current = bounds.isValid() ? bounds : null;
    const viewportKey = journeyViewportKey(routeGeometry, stops, selectedStopId);
    if (lastAutoViewportKeyRef.current === viewportKey) return;
    lastAutoViewportKeyRef.current = viewportKey;
    if (selectedStopId) {
      const selected = stops.find(stop => stop.id === selectedStopId);
      if (selected && Number.isFinite(selected.lat) && Number.isFinite(selected.lng)) {
        map.setView(
          [selected.lat, selected.lng],
          Math.max(map.getZoom(), SELECTED_STOP_ZOOM),
          { animate: !reduceMotion() },
        );
        return;
      }
    }
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16, animate: !reduceMotion() });
    } else {
      map.setView([40.7128, -74.006], 10);
    }
  }, [routeGeometry, stops, liveCoach, selectedStopId, onSelectStop, journeyProgress]);

  function showFullRoute() {
    lastAutoViewportKeyRef.current = journeyViewportKey(routeGeometry, stops, null);
    onShowFullRoute();
    const map = mapRef.current;
    const bounds = routeBoundsRef.current;
    if (map && bounds?.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16, animate: !reduceMotion() });
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#e8f4ea]">
      <div ref={containerRef} className="absolute inset-0 z-10 overflow-hidden" />
      {selectedStopId && (
        <button
          type="button"
          onClick={showFullRoute}
          className="absolute right-2 top-2 z-20 rounded-full border border-border/50 bg-white/95 px-3 py-2 text-xs font-black text-secondary shadow-sm"
        >
          Show full route
        </button>
      )}
      <div className="absolute bottom-2 left-2 z-20 bg-white/90 backdrop-blur px-2 py-1 rounded text-[10px] font-medium shadow-sm flex flex-col gap-1 border border-border/50">
        <div className="flex items-center gap-1.5"><div className="w-3 h-1 bg-primary rounded-full" /> <span>Actual route</span></div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full border-2 border-secondary bg-white flex items-center justify-center text-[6px] font-black text-secondary">1</div> <span>Stops</span></div>
        {showLiveCoachLegend && <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-secondary flex items-center justify-center"><div className="w-1.5 h-1.5 bg-primary rounded-full" /></div> <span>Live bus</span></div>}
        <div className="flex items-center gap-1.5"><div className="w-3 h-1 bg-gradient-to-r from-orange-400 to-red-500 rounded-full" /> <span>Traffic conditions</span></div>
      </div>
    </div>
  );
}

function escapeMapText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
