import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperatorMap } from './OperatorMap';

const mapState = vi.hoisted(() => ({
  sources: new Map<string, unknown>(),
  layers: new Map<string, unknown>(),
  handlers: new Map<string, Set<() => void>>(),
  removeLayer: vi.fn(),
  removeSource: vi.fn(),
  off: vi.fn(),
  webglAvailable: true,
}));

const leafletState = vi.hoisted(() => ({
  alternativeLayers: [] as Array<{ remove: ReturnType<typeof vi.fn> }>,
}));

vi.mock('maplibre-gl', () => {
  class Map {
    on(event: string, layerOrHandler: string | (() => void), handler?: () => void) {
      if (typeof layerOrHandler === 'string' && handler) {
        const key = `${event}:${layerOrHandler}`;
        const handlers = mapState.handlers.get(key) ?? new Set();
        handlers.add(handler);
        mapState.handlers.set(key, handlers);
      }
      return this;
    }
    once(_event: string, handler: () => void) { handler(); return this; }
    off(event: string, layerOrHandler: string | (() => void), handler?: () => void) {
      mapState.off(event, layerOrHandler, handler);
      if (typeof layerOrHandler === 'string' && handler) {
        mapState.handlers.get(`${event}:${layerOrHandler}`)?.delete(handler);
      }
      return this;
    }
    isStyleLoaded() { return true; }
    getStyle() { return { layers: [] }; }
    addSource(id: string, source: unknown) { mapState.sources.set(id, { source, setData: vi.fn() }); }
    getSource(id: string) { return mapState.sources.get(id); }
    removeSource(id: string) { mapState.removeSource(id); mapState.sources.delete(id); }
    addLayer(layer: { id: string }) { mapState.layers.set(layer.id, layer); }
    getLayer(id: string) { return mapState.layers.get(id); }
    removeLayer(id: string) { mapState.removeLayer(id); mapState.layers.delete(id); }
    getCanvas() {
      return {
        style: { cursor: '' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    }
    resize() {}
    remove() {}
    easeTo() {}
    fitBounds() {}
  }
  class Marker {
    setLngLat() { return this; }
    addTo() { return this; }
    remove() {}
  }
  class LngLatBounds {
    extend() { return this; }
  }
  return { Map, Marker, LngLatBounds };
});

vi.mock('leaflet', () => {
  const map = {
    setView() { return this; },
    remove() {},
    flyToBounds() {},
    flyTo() {},
  };
  const makeLayer = (isAlternative = false) => {
    const layer = {
      addTo() { return layer; },
      remove: vi.fn(),
      on: vi.fn(),
      setLatLng() { return layer; },
      setIcon() { return layer; },
    };
    if (isAlternative) leafletState.alternativeLayers.push(layer);
    return layer;
  };
  const leaflet = {
    map: () => map,
    tileLayer: () => ({ addTo: vi.fn() }),
    polyline: (_points: unknown, options: { dashArray?: string }) => makeLayer(Boolean(options.dashArray)),
    marker: () => makeLayer(),
    divIcon: (options: unknown) => options,
    latLngBounds: () => ({ extend: vi.fn() }),
  };
  return { default: leaflet };
});

beforeEach(() => {
  mapState.sources.clear();
  mapState.layers.clear();
  mapState.handlers.clear();
  mapState.removeLayer.mockClear();
  mapState.removeSource.mockClear();
  mapState.off.mockClear();
  mapState.webglAvailable = true;
  leafletState.alternativeLayers = [];
  vi.stubEnv('VITE_MAPTILER_API_KEY', 'test-key');
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    mapState.webglAvailable ? {} as RenderingContext : null
  ));
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('OperatorMap alternative cleanup', () => {
  it('removes stale MapLibre lines, sources, and handlers when alternatives disappear', () => {
    const alternative = {
      id: 'alternative-fast',
      routeGeometry: [{ lat: 40.7, lng: -74 }, { lat: 40.8, lng: -73.9 }],
      timeDifferenceSeconds: -180,
    };
    const { rerender } = render(
      <OperatorMap
        coach={{ lat: 40.7, lng: -74 }}
        route={alternative.routeGeometry}
        nextStop={null}
        overviewMode={false}
        alternatives={[alternative]}
        onSelectAlternative={vi.fn()}
      />,
    );

    const sourceId = 'coach-route-alternative-fast';
    const layerId = `${sourceId}-line`;
    expect(mapState.sources.has(sourceId)).toBe(true);
    expect(mapState.layers.has(layerId)).toBe(true);
    expect(mapState.handlers.get(`click:${layerId}`)?.size).toBe(1);

    rerender(
      <OperatorMap
        coach={{ lat: 40.7, lng: -74 }}
        route={alternative.routeGeometry}
        nextStop={null}
        overviewMode={false}
        alternatives={[]}
        onSelectAlternative={vi.fn()}
      />,
    );

    expect(mapState.sources.has(sourceId)).toBe(false);
    expect(mapState.layers.has(layerId)).toBe(false);
    expect(mapState.handlers.get(`click:${layerId}`)?.size ?? 0).toBe(0);
    expect(mapState.removeLayer).toHaveBeenCalledWith(layerId);
    expect(mapState.removeSource).toHaveBeenCalledWith(sourceId);
  });

  it('removes stale Leaflet alternative lines when alternatives disappear', () => {
    mapState.webglAvailable = false;
    const alternative = {
      id: 'alternative-fallback',
      routeGeometry: [{ lat: 40.7, lng: -74 }, { lat: 40.8, lng: -73.9 }],
      timeDifferenceSeconds: 120,
    };
    const props = {
      coach: { lat: 40.7, lng: -74 },
      route: alternative.routeGeometry,
      nextStop: null,
      overviewMode: false,
      onSelectAlternative: vi.fn(),
    };
    const { rerender } = render(<OperatorMap {...props} alternatives={[alternative]} />);
    expect(leafletState.alternativeLayers).toHaveLength(1);
    const staleLine = leafletState.alternativeLayers[0];

    rerender(<OperatorMap {...props} alternatives={[]} />);

    expect(staleLine.remove).toHaveBeenCalled();
  });
});