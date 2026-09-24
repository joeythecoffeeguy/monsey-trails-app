import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/map-tiles/:z/:x/:y.png", async (req, res): Promise<void> => {
  const apiKey = process.env.MAPTILER_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Map service is not configured." });
    return;
  }

  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 20 || x < 0 || y < 0) {
    res.status(400).json({ error: "Invalid map tile coordinates." });
    return;
  }

  const tileUrl = `https://api.maptiler.com/maps/streets-v2/${z}/${x}/${y}.png?key=${encodeURIComponent(apiKey)}`;
  try {
    const tileResponse = await fetch(tileUrl, { signal: AbortSignal.timeout(10_000) });
    if (!tileResponse.ok) {
      res.status(502).json({ error: "Map tile provider rejected the request." });
      return;
    }
    const tile = Buffer.from(await tileResponse.arrayBuffer());
    res.setHeader("content-type", tileResponse.headers.get("content-type") ?? "image/png");
    res.setHeader("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
    res.status(200).send(tile);
  } catch {
    res.status(502).json({ error: "Map tile provider is temporarily unavailable." });
  }
});

export default router;