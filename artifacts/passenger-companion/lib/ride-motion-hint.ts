export type MotionSample = {
  x: number;
  y: number;
  z: number;
  timestampMs: number;
};

export type RideMotionAssessment = {
  movementDetected: boolean;
  confidence: number;
  confidenceLabel: 'insufficient' | 'low' | 'moderate';
  durationMs: number;
  sampleCount: number;
};

const OBSERVATION_WINDOW_MS = 20_000;
const MINIMUM_DURATION_MS = 18_000;
const MINIMUM_SAMPLES = 28;
const BUCKET_MS = 4_000;
const MINIMUM_ACTIVE_BUCKETS = 4;
const MOVEMENT_RMS_THRESHOLD_G = 0.045;

/**
 * Looks for sustained acceleration changes, not coach identity or boarding.
 * Values are deliberately capped below a high-confidence result: walking,
 * handling the phone, and other vehicles can produce similar readings.
 */
export function assessRideMotion(samples: readonly MotionSample[], nowMs: number): RideMotionAssessment {
  const recent = samples.filter(sample =>
    Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.z)
    && sample.timestampMs <= nowMs
    && nowMs - sample.timestampMs <= OBSERVATION_WINDOW_MS,
  );
  const durationMs = recent.length > 1
    ? recent[recent.length - 1].timestampMs - recent[0].timestampMs
    : 0;
  const insufficient: RideMotionAssessment = {
    movementDetected: false,
    confidence: 0,
    confidenceLabel: 'insufficient',
    durationMs: Math.max(0, durationMs),
    sampleCount: recent.length,
  };

  if (recent.length < MINIMUM_SAMPLES || durationMs < MINIMUM_DURATION_MS) return insufficient;

  const bucketEnergy = new Map<number, number[]>();
  let totalSquaredDeviation = 0;
  for (const sample of recent) {
    // Expo accelerometer readings are expressed in g. A magnitude near 1g is
    // gravity; sustained magnitude changes are a cautious proxy for motion.
    const deviation = Math.abs(Math.hypot(sample.x, sample.y, sample.z) - 1);
    totalSquaredDeviation += deviation * deviation;
    const bucket = Math.floor((sample.timestampMs - recent[0].timestampMs) / BUCKET_MS);
    const values = bucketEnergy.get(bucket) ?? [];
    values.push(deviation);
    bucketEnergy.set(bucket, values);
  }

  const rmsDeviation = Math.sqrt(totalSquaredDeviation / recent.length);
  const activeBuckets = [...bucketEnergy.values()].filter(values => {
    const bucketRms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
    return bucketRms >= MOVEMENT_RMS_THRESHOLD_G * 0.55;
  }).length;
  if (rmsDeviation < MOVEMENT_RMS_THRESHOLD_G || activeBuckets < MINIMUM_ACTIVE_BUCKETS) {
    return insufficient;
  }

  const confidence = Math.min(
    0.65,
    0.35 + Math.min(0.2, (rmsDeviation - MOVEMENT_RMS_THRESHOLD_G) * 2)
      + Math.min(0.1, (activeBuckets - MINIMUM_ACTIVE_BUCKETS) * 0.025),
  );
  return {
    movementDetected: true,
    confidence,
    confidenceLabel: confidence >= 0.55 ? 'moderate' : 'low',
    durationMs,
    sampleCount: recent.length,
  };
}