export function formatJourneyTime(isoString: string, serviceDate: string) {
  const normalized = isoString.trim().replace(/\.(\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/, '.$1');
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  const newYorkDate = date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (newYorkDate === serviceDate) return time;
  const shortDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
  }).format(date);
  return `${time} (${shortDate})`;
}