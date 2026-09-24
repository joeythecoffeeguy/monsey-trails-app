import { Router, type IRouter } from "express";
import { fetchTrafficAwareRoute, type TrafficAwareRoute } from "../lib/traffic-routing";

const router: IRouter = Router();
const routeCache = new Map<string, { expiresAt: number; value: Promise<TrafficAwareRoute> }>();

function parseCoordinate(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function calculateTrafficDelaySeconds(
  travelTimeSeconds: number,
  noTrafficTravelTimeSeconds: number,
  providerDelaySeconds?: number,
) {
  return Math.max(
    0,
    providerDelaySeconds ?? 0,
    travelTimeSeconds - noTrafficTravelTimeSeconds,
  );
}

router.get("/traffic/flow/:z/:x/:y.png", async (req, res): Promise<void> => {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Traffic service is not configured." });
    return;
  }
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0) {
    res.status(400).json({ error: "Invalid traffic tile coordinates." });
    return;
  }

  const url = `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png?key=${encodeURIComponent(apiKey)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      req.log.warn({ providerStatus: response.status }, "TomTom traffic tile request failed");
      res.status(502).json({ error: "Traffic tile provider rejected the request." });
      return;
    }
    res.setHeader("content-type", response.headers.get("content-type") ?? "image/png");
    res.setHeader("cache-control", "public, max-age=60, stale-while-revalidate=120");
    res.status(200).send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    req.log.warn({ error }, "TomTom traffic tile request failed");
    res.status(502).json({ error: "Traffic tile provider is temporarily unavailable." });
  }
});

router.get("/traffic/route", async (req, res): Promise<void> => {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Traffic service is not configured." });
    return;
  }
  const originLat = parseCoordinate(req.query.originLat, -90, 90);
  const originLng = parseCoordinate(req.query.originLng, -180, 180);
  const destinationLat = parseCoordinate(req.query.destinationLat, -90, 90);
  const destinationLng = parseCoordinate(req.query.destinationLng, -180, 180);
  if ([originLat, originLng, destinationLat, destinationLng].some((value) => value === null)) {
    res.status(400).json({ error: "Valid origin and destination coordinates are required." });
    return;
  }

  try {
    const cacheKey = [originLat, originLng, destinationLat, destinationLng]
      .map(value => value!.toFixed(3))
      .join(":");
    let cached = routeCache.get(cacheKey);
    if (!cached || cached.expiresAt <= Date.now()) {
      const value = fetchTrafficAwareRoute([
        { lat: originLat!, lng: originLng! },
        { lat: destinationLat!, lng: destinationLng! },
      ], apiKey);
      cached = { expiresAt: Date.now() + 30_000, value };
      routeCache.set(cacheKey, cached);
      void value.catch(() => {
        if (routeCache.get(cacheKey)?.value === value) routeCache.delete(cacheKey);
      });
      if (routeCache.size > 200) routeCache.delete(routeCache.keys().next().value!);
    }
    const route = await cached.value;
    res.setHeader("cache-control", "private, max-age=30");
    res.json({
      travelTimeSeconds: route.travelTimeSeconds,
      noTrafficTravelTimeSeconds: route.noTrafficTravelTimeSeconds,
      trafficDelaySeconds: route.trafficDelaySeconds,
      departureTime: route.departureTime,
      arrivalTime: route.arrivalTime,
      source: route.source,
    });
  } catch (error) {
    req.log.warn({ error }, "live traffic route estimate failed");
    res.status(502).json({ error: "Traffic route provider is temporarily unavailable." });
  }
});

export default router;