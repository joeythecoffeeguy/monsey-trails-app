import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DRIVING_ZOOM,
  LiveCoachMap,
  NEIGHBORHOOD_DRIVING_ZOOM,
  getSpeedResponsiveZoom,
  calculateBearing,
  getTargetBearing,
  isValidMapCoordinate,
  runWhenMapReady,
  fitOverview,
} from './LiveCoachMap';

afterEach(() => {
  cleanup();
});

describe('LiveCoachMap', () => {
  it('does not lose the initial marker sync while MapLibre is loading its style', () => {
    let loadHandler: (() => void) | undefined;
    const map = {
      isStyleLoaded: () => false,
      once: (_event: string, handler: () => void) => { loadHandler = handler; },
      off: vi.fn(),
    } as unknown as import('maplibre-gl').Map;
    const sync = vi.fn();

    const cleanupReady = runWhenMapReady(map, sync);
    expect(sync).not.toHaveBeenCalled();
    loadHandler?.();
    expect(sync).toHaveBeenCalledOnce();
    cleanupReady();
    expect(map.off).toHaveBeenCalledWith('load', loadHandler);
  });

  it('fits a Brooklyn coach and Monsey stops instead of following at close zoom', () => {
    const map = {
      fitBounds: vi.fn(),
    } as unknown as import('maplibre-gl').Map;
    fitOverview(map, [
      { lat: 40.676, lng: -73.975 }, // Brooklyn coach
      { lat: 41.117, lng: -74.044 }, // Monsey stop
      { lat: 41.141, lng: -74.035 }, // New Square destination
    ]);

    expect(map.fitBounds).toHaveBeenCalledWith(
      [[-74.044, 40.676], [-73.975, 41.141]],
      expect.objectContaining({ maxZoom: 12, duration: 0 }),
    );
    expect(map).not.toHaveProperty('easeTo');
  });

  it('stays fully zoomed on local streets and widens only at highway speeds', () => {
    expect(getSpeedResponsiveZoom(0)).toBe(NEIGHBORHOOD_DRIVING_ZOOM);
    expect(getSpeedResponsiveZoom(20)).toBe(NEIGHBORHOOD_DRIVING_ZOOM);
    expect(getSpeedResponsiveZoom(35)).toBe(NEIGHBORHOOD_DRIVING_ZOOM);
    expect(getSpeedResponsiveZoom(50)).toBe(NEIGHBORHOOD_DRIVING_ZOOM);
    expect(getSpeedResponsiveZoom(60)).toBe(16);
    expect(getSpeedResponsiveZoom(70)).toBe(DEFAULT_DRIVING_ZOOM);
    expect(getSpeedResponsiveZoom(null)).toBe(DEFAULT_DRIVING_ZOOM);
  });

  it('uses the MapTiler raster map instead of a schematic when WebGL2 is unavailable', () => {
    render(
      <LiveCoachMap
        coach={{ lat: 40.7128, lng: -74.006 }}
        route={[
          { lat: 40.7128, lng: -74.006 },
          { lat: 40.72, lng: -74.01 },
        ]}
        nextStop={{ lat: 40.72, lng: -74.01 }}
      />,
    );

    expect(screen.getByTestId('raster-live-coach-map')).toBeTruthy();
    expect(screen.queryByTestId('map-fallback')).toBeNull();
  });

  it('renders a pitched heading-up map that follows the coach', () => {
    const { container } = render(
      <LiveCoachMap
        coach={{ lat: 40.7128, lng: -74.006 }}
        route={[
          { lat: 40.7128, lng: -74.006 },
          { lat: 40.72, lng: -74.01 },
        ]}
        nextStop={{ lat: 40.72, lng: -74.01 }}
      />,
    );

    const rootDiv = container.firstChild as HTMLElement;
    expect(rootDiv.dataset.mapCamera).toBe('3d-follow');

    const transformDiv = rootDiv.firstChild as HTMLElement;
    expect(transformDiv.style.transform).toBe('');
  });

  it('rejects invalid GPS coordinates before they reach either map renderer', () => {
    expect(isValidMapCoordinate({ lat: 40.7128, lng: -74.006 })).toBe(true);
    expect(isValidMapCoordinate({ lat: Number.NaN, lng: -74.006 })).toBe(false);
    expect(isValidMapCoordinate({ lat: 91, lng: -74.006 })).toBe(false);
    expect(isValidMapCoordinate({ lat: 40.7128, lng: -181 })).toBe(false);
    expect(isValidMapCoordinate(null)).toBe(false);
  });
});

describe('calculateBearing', () => {
  it('calculates true north correctly', () => {
    expect(calculateBearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0);
  });

  it('calculates east correctly', () => {
    expect(calculateBearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90);
  });

  it('calculates south correctly', () => {
    expect(calculateBearing({ lat: 1, lng: 0 }, { lat: -1, lng: 0 })).toBeCloseTo(180);
  });

  it('calculates west correctly', () => {
    expect(calculateBearing({ lat: 0, lng: 1 }, { lat: 0, lng: 0 })).toBeCloseTo(270);
  });
});

describe('getTargetBearing', () => {
  it('returns 0 when coach is null or route is too short', () => {
    expect(getTargetBearing(null, [])).toBe(0);
    expect(getTargetBearing({ lat: 0, lng: 0 }, [{ lat: 0, lng: 0 }])).toBe(0);
  });

  it('finds the closest segment and returns its bearing', () => {
    const route = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 }, // North
      { lat: 1, lng: 1 }, // East
    ];
    // Near first segment
    expect(getTargetBearing({ lat: 0.5, lng: 0 }, route)).toBeCloseTo(0);
    // Near second segment
    expect(getTargetBearing({ lat: 1, lng: 0.5 }, route)).toBeCloseTo(90, 0); // relaxed tolerance due to great circle curve
  });
});
