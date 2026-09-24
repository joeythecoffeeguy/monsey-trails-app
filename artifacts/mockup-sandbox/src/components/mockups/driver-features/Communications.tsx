import { DriverCommunications } from './_DriverCommunications';
import './_group.css';

export function Communications() {
  return (
    <main className="operator-theme min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-2xl">
        <p className="mb-2 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Sample dispatch data</p>
        <DriverCommunications />
      </div>
    </main>
  );
}
