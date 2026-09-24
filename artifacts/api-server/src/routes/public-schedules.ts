import { fileURLToPath } from "node:url";
import { Router, type IRouter } from "express";

const router: IRouter = Router();
const filename = "Monsey-Trails-New-York-Line-Tishrei-2026.pdf";
const schedulePath = fileURLToPath(new URL(`./assets/schedules/${filename}`, import.meta.url));

router.get(`/public/schedules/${filename}`, (_req, res, next): void => {
  res.set({
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Digest": "sha-256=:uwPOOfZTDwPtieinhHiTc/YbyEqnOY4zCqKMGSpNosU=:",
    "Content-Type": "application/pdf",
    "X-Checksum-SHA256": "bb03ce39f6530f03ed89e8a784789373f61bc84aa7398e330aa28c192a4da2c5",
  });
  res.attachment(filename);
  res.sendFile(schedulePath, (error) => {
    if (error) next(error);
  });
});

export default router;