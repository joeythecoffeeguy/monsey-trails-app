export function formatTripDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return 'Duration unavailable';
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const remainingMinutes = total % 60;
  if (hours === 0) return `${total} min`;
  return `${hours} hr${remainingMinutes ? `, ${remainingMinutes} min` : ''}`;
}