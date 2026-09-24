import { Download } from 'lucide-react';

export const NEW_YORK_SCHEDULE_PDF_PATH = '/api/public/schedules/Monsey-Trails-New-York-Line-Tishrei-2026.pdf';
export const NEW_YORK_SCHEDULE_PDF_FILENAME = 'Monsey-Trails-New-York-Line-Tishrei-2026.pdf';

export function NewYorkSchedulePdf({ className = '' }: { className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-4 shadow-sm ${className}`}>
      <p className="text-sm font-black text-foreground">Tishrei 2026 New York Line schedule</p>
      <p className="mt-1 text-xs font-bold text-muted-foreground">September 11–October 8, 2026</p>
      <a
        href={NEW_YORK_SCHEDULE_PDF_PATH}
        download={NEW_YORK_SCHEDULE_PDF_FILENAME}
        className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-xs font-black text-secondary-foreground"
        data-testid="download-tishrei-schedule"
      >
        <Download className="h-4 w-4" />
        Download schedule PDF
      </a>
    </section>
  );
}