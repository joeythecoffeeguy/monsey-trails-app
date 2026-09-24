import type { ScheduledStopChangeRow } from "@workspace/db";

export const SCHEDULED_STOP_CHANGE_POLICY =
  "Queued stop changes are durable, but are not applied by a sleeping timer. An administrator must review and explicitly apply due changes.";

export function scheduledStopChangeIsDue(
  change: Pick<ScheduledStopChangeRow, "state" | "applyAt">,
  now = new Date(),
) {
  return change.state === "queued" && change.applyAt.getTime() <= now.getTime();
}

export function scheduledStopChangeCanBeQueued(applyAt: Date, now = new Date()) {
  return Number.isFinite(applyAt.getTime()) && applyAt.getTime() >= now.getTime() + 60_000;
}