export type JourneyStopKind = "pickup" | "dropoff" | "destination";

/** Completion copy is driven only by the official stop semantic. */
export function journeyCompletionLabel(
  status: string,
  kind?: JourneyStopKind,
) {
  if (status !== "completed") return null;
  if (kind === "pickup") return "Departed";
  if (kind === "dropoff" || kind === "destination") return "Arrived";
  return "Arrived";
}