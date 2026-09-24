import React from 'react';
import { DoorOpen, MoveUpRight, PanelTopOpen, ShieldCheck } from 'lucide-react';
import { useLiveTrip } from '@/providers/live-trip';
import { getTranslation, isRTL } from '@/lib/translations';

const exitSteps = [
  {
    icon: MoveUpRight,
    title: 'Side windows',
    detail: 'Lift the release bar at the sill. Push the bottom of the window outward.',
    theme: {
      bg: 'bg-sky-500',
      text: 'text-sky-950',
      label: 'text-sky-400',
      border: 'border-sky-500/30',
      glow: 'bg-sky-500/20'
    }
  },
  {
    icon: PanelTopOpen,
    title: 'Roof hatch',
    detail: 'Push up. Turn the knob ¼ turn toward “TO EXIT.” Push the knob, then push the hatch outward.',
    theme: {
      bg: 'bg-amber-500',
      text: 'text-amber-950',
      label: 'text-amber-400',
      border: 'border-amber-500/30',
      glow: 'bg-amber-500/20'
    }
  },
  {
    icon: DoorOpen,
    title: 'Front entrance',
    detail: 'Turn the marked interior unlatch air valve in the arrow direction, then push the door open.',
    theme: {
      bg: 'bg-emerald-500',
      text: 'text-emerald-950',
      label: 'text-emerald-400',
      border: 'border-emerald-500/30',
      glow: 'bg-emerald-500/20'
    }
  },
];

const Bus3D = () => {
  const rotateX = 55;
  const rotateZ = -38;
  const faceCamera = { transform: `rotateZ(${-rotateZ}deg) rotateX(${-rotateX}deg)` };

  return (
    <div className="absolute inset-0 flex items-center justify-center mt-2 pointer-events-none" style={{ perspective: '2000px' }}>
      {/* 3D Scene Container */}
      <div 
        className="relative w-[200px] h-[560px]" 
        style={{ 
          transformStyle: 'preserve-3d', 
          transform: `rotateX(${rotateX}deg) rotateZ(${rotateZ}deg) translateZ(-40px)` 
        }}
      >
        {/* Shadow under the bus */}
        <div className="absolute inset-[-30px] bg-black/60 blur-2xl rounded-[4rem]" style={{ transform: 'translateZ(-30px)' }} />

        {/* Bus Floor Base */}
        <div className="absolute inset-0 rounded-[2.5rem] bg-slate-800 border-[4px] border-slate-600 overflow-hidden shadow-inner" style={{ transformStyle: 'preserve-3d' }}>
          {/* Blueprint Grid */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:20px_20px] opacity-60" />
          
          {/* Dashboard area */}
          <div className="absolute top-0 w-full h-[50px] bg-slate-700/80 border-b border-slate-600 flex items-end justify-center pb-2">
             <div className="w-[80px] h-[10px] bg-slate-900/40 rounded-full" />
          </div>
          
          {/* Aisle */}
          <div className="absolute top-[50px] bottom-10 left-1/2 w-[30px] -translate-x-1/2 bg-slate-900/40" />
        </div>

        {/* Floating Outline / Walls (Glass shell) */}
        <div className="absolute inset-0 rounded-[2.5rem] border-2 border-white/10 bg-white/[0.02] shadow-[inset_0_0_30px_rgba(255,255,255,0.02)]" style={{ transform: 'translateZ(50px)', pointerEvents: 'none' }}>
           {/* Front windshield glow */}
           <div className="absolute top-0 left-[30px] right-[30px] h-[15px] bg-sky-400/10 blur-md rounded-t-full" />
        </div>

        {/* Seats */}
        {Array.from({ length: 13 }).map((_, i) => {
          const isDoorRow = i === 0 || i === 1;
          return (
            <React.Fragment key={i}>
              {/* Left Seat */}
              <div className="absolute w-[44px] h-[24px] bg-slate-700/80 border border-slate-600 rounded-[4px] shadow-[0_5px_10px_rgba(0,0,0,0.3)]" style={{ left: '20px', top: `${70 + i * 35}px`, transform: 'translateZ(12px)', transformStyle: 'preserve-3d' }}>
                <div className="absolute top-0 w-full h-[16px] bg-slate-600 rounded-t-[4px]" style={{ transformOrigin: 'top', transform: 'rotateX(-60deg)' }} />
              </div>
              
              {/* Right Seat */}
              {!isDoorRow && (
                <div className="absolute w-[44px] h-[24px] bg-slate-700/80 border border-slate-600 rounded-[4px] shadow-[0_5px_10px_rgba(0,0,0,0.3)]" style={{ right: '20px', top: `${70 + i * 35}px`, transform: 'translateZ(12px)', transformStyle: 'preserve-3d' }}>
                  <div className="absolute top-0 w-full h-[16px] bg-slate-600 rounded-t-[4px]" style={{ transformOrigin: 'top', transform: 'rotateX(-60deg)' }} />
                </div>
              )}
            </React.Fragment>
          );
        })}

        {/* --- EXITS --- */}

        {/* Front Entrance (Exit 3 - Emerald) */}
        <div className="absolute right-0 top-[60px] w-[30px] h-[48px]" style={{ transformStyle: 'preserve-3d' }}>
          {/* Floor footprint */}
          <div className="absolute inset-0 bg-emerald-500/20 border-2 border-dashed border-emerald-500/50 rounded-sm" />
          {/* Drop lines */}
          <div className="absolute right-0 top-0 w-px h-[60px] bg-emerald-500/40" style={{ transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />
          <div className="absolute right-0 bottom-0 w-px h-[60px] bg-emerald-500/40" style={{ transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />
          
          {/* Floating Marker */}
          <div className="absolute right-[-24px] top-1/2 w-[56px] h-[56px] -translate-y-1/2 bg-emerald-500/20 border-2 border-emerald-400 rounded-full shadow-[0_0_25px_rgba(52,211,153,0.5)] backdrop-blur-md flex items-center justify-center" style={{ transform: 'translateZ(60px)' }}>
            <div style={faceCamera} className="flex flex-col items-center justify-center">
              <DoorOpen className="w-6 h-6 text-emerald-300" />
            </div>
          </div>
        </div>

        {/* Roof Hatch (Exit 2 - Amber) */}
        <div className="absolute left-1/2 top-[45%] w-[64px] h-[64px] -translate-x-1/2 -translate-y-1/2" style={{ transformStyle: 'preserve-3d' }}>
          {/* Floor footprint */}
          <div className="absolute inset-0 bg-amber-500/10 border-2 border-dashed border-amber-500/40 rounded-xl" />
          
          {/* Corner connect lines */}
          <div className="absolute left-0 top-0 w-px h-[120px] bg-gradient-to-t from-transparent to-amber-500/40" style={{ transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />
          <div className="absolute right-0 top-0 w-px h-[120px] bg-gradient-to-t from-transparent to-amber-500/40" style={{ transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />
          <div className="absolute left-0 bottom-0 w-px h-[120px] bg-gradient-to-t from-transparent to-amber-500/40" style={{ transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />
          <div className="absolute right-0 bottom-0 w-px h-[120px] bg-gradient-to-t from-transparent to-amber-500/40" style={{ transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />

          {/* Floating Marker */}
          <div className="absolute inset-0 bg-amber-500/20 border-2 border-amber-400 rounded-xl shadow-[0_0_35px_rgba(251,191,36,0.4)] backdrop-blur-md flex items-center justify-center" style={{ transform: 'translateZ(120px)' }}>
            <div style={faceCamera}>
              <PanelTopOpen className="w-8 h-8 text-amber-300" />
            </div>
          </div>
        </div>

        {/* Side Windows (Exit 1 - Sky) */}
        {[
          { side: 'left', top: '30%' },
          { side: 'left', top: '70%' },
          { side: 'right', top: '30%' },
          { side: 'right', top: '70%' },
        ].map((win, i) => (
          <div key={i} className="absolute w-[16px] h-[54px] -translate-y-1/2" style={{ [win.side]: 0, top: win.top, transformStyle: 'preserve-3d' }}>
            {/* Floor footprint */}
            <div className={`absolute inset-0 bg-sky-500/20 border-y-2 ${win.side === 'left' ? 'border-r-2' : 'border-l-2'} border-dashed border-sky-500/50`} />
            
            {/* Drop line */}
            <div className={`absolute ${win.side === 'left' ? 'left-[-40px]' : 'right-[-40px]'} top-1/2 w-px h-[50px] bg-sky-500/40`} style={{ transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />
            
            {/* Floating Marker */}
            <div className={`absolute ${win.side === 'left' ? 'left-[-40px]' : 'right-[-40px]'} top-1/2 w-[48px] h-[48px] -translate-y-1/2 bg-sky-500/20 border-2 border-sky-400 rounded-full shadow-[0_0_20px_rgba(56,189,248,0.5)] backdrop-blur-md flex items-center justify-center`} style={{ transform: 'translateZ(50px)' }}>
              <div style={faceCamera}>
                <MoveUpRight className={`w-5 h-5 text-sky-300 ${win.side === 'left' ? '-scale-x-100' : ''}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export function SafetyBriefingView({ compact = false }: { compact?: boolean }) {
  const language = useLiveTrip().passengerLanguage;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(language, key);
  const localizedSteps = [
    { title: t('sideWindows'), detail: t('sideWindowsDetail') },
    { title: t('roofHatch'), detail: t('roofHatchDetail') },
    { title: t('frontEntrance'), detail: t('frontEntranceDetail') },
  ];
  return (
    <div dir={isRTL(language) ? 'rtl' : 'ltr'} className={`flex flex-1 min-h-0 flex-col animate-in fade-in duration-700 ${compact ? 'p-4' : 'px-8 py-5'}`}>
      <div className={`flex justify-between ${compact ? 'flex-col items-start gap-3' : 'items-end gap-6'}`}>
        <div>
          <div className="flex items-center gap-3 text-primary">
            <ShieldCheck className={compact ? 'h-6 w-6' : 'h-9 w-9'} />
             <span className={`${compact ? 'text-xs' : 'text-lg'} font-bold uppercase tracking-[0.24em]`}>{t('safetyBriefing')}</span>
          </div>
           <h2 className={`mt-1 font-bold tracking-tight ${compact ? 'text-3xl' : 'text-4xl'}`}>{t('emergencyExits')}</h2>
        </div>
         <p className={`max-w-sm leading-snug text-muted-foreground ${compact ? 'text-start text-base' : 'text-end text-lg'}`}>
           {t('locateExit')}
        </p>
      </div>

      <div className={`mt-4 grid min-h-0 flex-1 gap-6 ${compact ? 'grid-cols-1' : 'grid-cols-[0.85fr_1.15fr]'}`}>
        <section className={`relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/60 shadow-2xl p-5 flex-col items-center justify-center ${compact ? 'hidden' : 'flex'}`}>
          {/* Subtle radial glow in background */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03)_0%,transparent_70%)] pointer-events-none" />

          <div className="absolute top-6 left-0 w-full text-center z-10">
            <p className="text-sm font-black uppercase tracking-[0.25em] text-slate-400 drop-shadow-md">
               2014 Prevost H3-45 · {t('exitLocations')}
            </p>
          </div>
          
          <Bus3D />

          <div className="absolute bottom-6 left-0 w-full flex justify-center z-10 pointer-events-none">
            <p className="text-sm font-bold text-slate-200 bg-slate-900/80 px-5 py-2.5 rounded-full backdrop-blur-md border border-white/10 shadow-lg tracking-wide">
               {t('locateMarkedExits')}
            </p>
          </div>
        </section>

        <section className={`grid min-h-0 gap-3 ${compact ? 'grid-cols-1' : 'grid-rows-3'}`}>
           {exitSteps.map(({ icon: Icon, theme }, index) => (
             <article key={localizedSteps[index].title} className={`flex min-w-0 items-center rounded-[2rem] border ${theme.border} bg-slate-950/40 relative overflow-hidden shadow-lg backdrop-blur-sm ${compact ? 'gap-3 px-4 py-4' : 'gap-5 px-6 py-4'}`}>
              {/* Subtle background glow from the side */}
              <div className={`absolute -left-12 top-1/2 -translate-y-1/2 w-32 h-32 rounded-full blur-[40px] ${theme.glow} pointer-events-none`} />
              
               <div className={`flex shrink-0 items-center justify-center rounded-[1.25rem] ${theme.bg} ${theme.text} shadow-xl z-10 ring-1 ring-white/20 ${compact ? 'h-11 w-11' : 'h-16 w-16'}`}>
                 <Icon className={compact ? 'h-6 w-6' : 'h-8 w-8'} />
              </div>
              <div className="min-w-0 z-10 flex-1">
               <p className={`text-sm font-black uppercase tracking-[0.25em] ${theme.label}`}>{t('exitLabel')} {index + 1}</p>
                 <h3 className={`${compact ? 'text-xl' : 'text-[1.7rem]'} font-bold leading-tight text-white mt-0.5`}>{localizedSteps[index].title}</h3>
                  <p className={`mt-1 leading-snug text-white/85 ${compact ? 'text-base' : 'text-lg'}`}>{localizedSteps[index].detail}</p>
              </div>
            </article>
          ))}
        </section>
      </div>

      <div className={`mt-2 flex gap-4 rounded-2xl border border-primary/25 bg-primary/10 px-6 py-2 ${compact ? 'flex-col items-start' : 'items-center justify-between'}`}>
         <p className="text-base font-bold min-w-0">{t('inEmergency')}</p>
        <p className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
           {t('manualSource')}
        </p>
      </div>
    </div>
  );
}
