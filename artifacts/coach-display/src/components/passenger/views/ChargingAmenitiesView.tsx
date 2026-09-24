import { BatteryCharging, BookOpen, CircleAlert, Lightbulb, Plug, Usb } from 'lucide-react';
import { useLiveTrip } from '@/providers/live-trip';
import { getTranslation, isRTL } from '@/lib/translations';

function UsbPort({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex h-8 w-11 items-center justify-center rounded-md border border-cyan-300/70 bg-slate-950 shadow-[0_0_16px_rgba(34,211,238,0.35)]">
        <div className="h-2 w-6 rounded-sm bg-cyan-300/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)]" />
      </div>
      {label && <span className="text-[10px] font-black tracking-widest text-cyan-200">{label}</span>}
    </div>
  );
}

function OverheadConsole3D({ aboveSeat }: { aboveSeat: string }) {
  return (
    <div className="relative flex h-full items-center justify-center [perspective:1100px]">
      <div className="absolute h-52 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
      <div
        className="relative h-56 w-80 rounded-[2.5rem] border border-slate-500 bg-gradient-to-br from-slate-500 via-slate-700 to-slate-950 p-7 shadow-[20px_24px_45px_rgba(0,0,0,0.55),inset_3px_3px_8px_rgba(255,255,255,0.25)]"
        style={{ transform: 'rotateX(58deg) rotateZ(-8deg)', transformStyle: 'preserve-3d' }}
      >
        <div className="absolute inset-3 rounded-[2rem] border border-white/10" />
        <div className="grid h-full grid-cols-2 items-center gap-8">
          {[0, 1].map((seat) => (
            <div key={seat} className="flex flex-col items-center gap-5">
              <div className="relative h-16 w-16 rounded-full border-4 border-slate-800 bg-gradient-to-br from-amber-100 via-amber-300 to-amber-600 shadow-[0_0_28px_rgba(251,191,36,0.45),inset_0_0_12px_rgba(255,255,255,0.8)]">
                <Lightbulb className="absolute inset-0 m-auto h-7 w-7 text-amber-950" />
              </div>
              <UsbPort label="USB" />
            </div>
          ))}
        </div>
        <div className="absolute -bottom-5 left-1/2 h-6 w-64 -translate-x-1/2 rounded-b-3xl bg-slate-950 shadow-xl" style={{ transform: 'translateZ(-20px)' }} />
      </div>
      <div className="absolute bottom-4 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-5 py-2 text-sm font-black uppercase tracking-[0.18em] text-cyan-200 backdrop-blur">
         {aboveSeat}
      </div>
    </div>
  );
}

function SeatPowerPanel3D({ betweenSeats, seatPower }: { betweenSeats: string; seatPower: string }) {
  return (
    <div className="relative flex h-full items-center justify-center [perspective:1200px]">
      <div className="absolute h-60 w-80 rounded-full bg-amber-400/10 blur-3xl" />
      <div
        className="relative h-64 w-80 rounded-[2.2rem] border border-slate-500 bg-gradient-to-br from-slate-400 via-slate-700 to-slate-950 p-8 shadow-[22px_26px_50px_rgba(0,0,0,0.6),inset_3px_3px_9px_rgba(255,255,255,0.22)]"
        style={{ transform: 'rotateY(-18deg) rotateX(8deg)' }}
      >
        <div className="mb-5 flex items-center justify-center gap-3 text-xs font-black uppercase tracking-[0.2em] text-slate-300">
           <BatteryCharging className="h-5 w-5 text-amber-300" /> {seatPower}
        </div>
        <div className="flex items-center justify-center gap-5">
          {[0, 1].map((outlet) => (
            <div key={outlet} className="relative h-24 w-20 rounded-2xl border border-slate-500 bg-slate-900 shadow-[inset_3px_4px_10px_rgba(0,0,0,0.8)]">
              <div className="absolute left-5 top-6 h-7 w-2 rounded-full bg-black" />
              <div className="absolute right-5 top-6 h-7 w-2 rounded-full bg-black" />
              <div className="absolute bottom-4 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-black" />
            </div>
          ))}
        </div>
        <div className="absolute -bottom-5 left-1/2 flex -translate-x-1/2 gap-3 rounded-xl border border-cyan-300/40 bg-slate-950 px-5 py-3 shadow-[0_0_24px_rgba(34,211,238,0.25)]">
          <UsbPort />
          <UsbPort />
        </div>
      </div>
      <div className="absolute bottom-1 rounded-full border border-amber-300/30 bg-amber-400/10 px-5 py-2 text-sm font-black uppercase tracking-[0.18em] text-amber-200 backdrop-blur">
         {betweenSeats}
      </div>
    </div>
  );
}

export function ChargingAmenitiesView({ compact = false }: { compact?: boolean }) {
  const language = useLiveTrip().passengerLanguage;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(language, key);
  return (
    <div dir={isRTL(language) ? 'rtl' : 'ltr'} className={`flex flex-1 min-h-0 flex-col animate-in fade-in duration-700 ${compact ? 'p-4' : 'px-8 py-5'}`}>
      <div className={`flex justify-between ${compact ? 'flex-col items-start gap-3' : 'items-end gap-8'}`}>
        <div>
          <div className="flex items-center gap-3 text-primary">
            <Plug className={compact ? 'h-6 w-6' : 'h-9 w-9'} />
             <span className={`${compact ? 'text-xs' : 'text-lg'} font-bold uppercase tracking-[0.24em]`}>{t('amenities')}</span>
          </div>
           <h2 className={`mt-1 font-black tracking-tight ${compact ? 'text-3xl' : 'text-4xl'}`}>{t('powerWithinReach')}</h2>
        </div>
         <p className={`max-w-md leading-snug text-muted-foreground ${compact ? 'text-start text-base' : 'text-end text-lg'}`}>
           {t('chargeDescription')}
        </p>
      </div>

      <div className={`mt-4 grid min-h-0 flex-1 gap-5 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <section className={`relative overflow-hidden rounded-[2rem] border border-cyan-400/20 bg-slate-950/80 ${compact ? 'min-h-80' : ''}`}>
           <OverheadConsole3D aboveSeat={t('aboveSeat')} />
          <div className="absolute left-6 top-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400 text-cyan-950"><Usb className="h-7 w-7" /></div>
             <div><p className="text-sm font-black uppercase tracking-widest text-cyan-300">{t('option')} 1</p><h3 className="text-2xl font-bold text-white">{t('overheadUsb')}</h3></div>
          </div>
        </section>
        <section className={`relative overflow-hidden rounded-[2rem] border border-amber-400/20 bg-slate-950/80 ${compact ? 'min-h-80' : ''}`}>
           <SeatPowerPanel3D betweenSeats={t('betweenSeats')} seatPower={t('seatPower')} />
          <div className="absolute left-6 top-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400 text-amber-950"><Plug className="h-7 w-7" /></div>
             <div><p className="text-sm font-black uppercase tracking-widest text-amber-300">{t('option')} 2</p><h3 className="text-2xl font-bold text-white">{t('outletPanel')}</h3></div>
          </div>
        </section>
      </div>

      <div className={`mt-3 grid items-center gap-5 rounded-2xl border border-primary/25 bg-primary/10 px-6 py-3 ${compact ? 'grid-cols-1' : 'grid-cols-[1fr_auto]'}`}>
        <div className="flex items-center gap-3 text-lg font-semibold">
          <BookOpen className="h-6 w-6 shrink-0 text-primary" />
           {t('portsBesideLamps')}
        </div>
        <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
           <CircleAlert className="h-5 w-5 text-amber-400" /> {t('unplugBeforeLeaving')}
        </div>
      </div>
    </div>
  );
}