import { pool } from "@workspace/db";
import { processDueDepartureReminders } from "../lib/departure-reminders";

const TICK_TIMEOUT_MS = 90_000;
const TICK_BATCH_LIMIT = 25;

// This is intentionally one bounded pass for a future external scheduled job.
// It does not create a resident worker or change the deployment's hosting mode.
const hardTimeout = setTimeout(() => {
  console.error(`Departure reminder tick exceeded ${TICK_TIMEOUT_MS}ms and was terminated.`);
  process.exit(1);
}, TICK_TIMEOUT_MS);

try {
  const processed = await processDueDepartureReminders(new Date(), console, {
    limit: TICK_BATCH_LIMIT,
  });
  console.log(`Departure reminder tick checked ${processed} due reminder(s).`);
} catch (error) {
  console.error("Departure reminder tick failed.", error);
  process.exitCode = 1;
} finally {
  clearTimeout(hardTimeout);
  await pool.end();
}