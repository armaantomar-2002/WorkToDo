// Original line-art illustrations in the muted vintage palette (drawn for WorkToDo; theme-aware via Tailwind fill/stroke utilities).
export function ClipboardScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 360" role="img" aria-label="A clipboard with a checked task list, a pen and a potted plant" className={className}>
      <ellipse cx="215" cy="190" rx="170" ry="150" className="fill-olive-soft" opacity="0.55" />
      <g transform="rotate(-4 215 180)">
        <rect x="120" y="50" width="190" height="250" rx="16" className="fill-surface stroke-ink" strokeWidth="3" />
        <rect x="170" y="36" width="90" height="34" rx="10" className="fill-surface-2 stroke-ink" strokeWidth="3" />
        <circle cx="215" cy="48" r="6" className="fill-ink" />
        {[100, 162, 224].map((y, i) => (
          <g key={y}>
            <rect x="142" y={y} width="30" height="30" rx="7" className="fill-olive" />
            <path d={`M149 ${y + 15} l7 7 l11 -13`} fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-primary-fg" />
            <rect x="188" y={y + 6} width={i === 1 ? 84 : 100} height="7" rx="3.5" className="fill-line" />
            <rect x="188" y={y + 19} width={i === 2 ? 56 : 70} height="7" rx="3.5" className="fill-line" />
          </g>
        ))}
      </g>
      <g transform="rotate(38 330 250)"><rect x="318" y="150" width="20" height="150" rx="8" className="fill-ink" /><path d="M318 300 l10 26 l10 -26z" className="fill-amber" /></g>
      <g className="stroke-ink" strokeWidth="2.5" strokeLinecap="round" fill="none"><path d="M338 80 l18 -12" /><path d="M346 104 l22 -2" /><path d="M334 58 l8 -18" /></g>
      <path d="M78 330 q-6 -60 18 -100 q30 40 6 100z" className="fill-olive" /><path d="M96 330 q40 -40 60 -88 q-52 8 -60 88z" className="fill-olive" opacity="0.75" />
      <path d="M70 330 q-30 -30 -34 -72 q40 14 40 72z" className="fill-olive" opacity="0.6" />
      <path d="M60 330 h60 l-8 24 h-44z" className="fill-amber" />
    </svg>
  );
}

export function PersonLaptop({ variant = 'a', className }: { variant?: 'a' | 'b'; className?: string }) {
  return (
    <svg viewBox="0 0 360 320" role="img" aria-label="A person working at a laptop" className={className}>
      <ellipse cx="180" cy="170" rx="150" ry="135" className="fill-olive-soft" opacity="0.5" />
      <path d="M96 318 q0 -96 84 -96 q84 0 84 96z" className={variant === 'a' ? 'fill-dusty' : 'fill-amber'} />
      <rect x="164" y="190" width="32" height="38" rx="12" className="fill-surface-2 stroke-ink" strokeWidth="3" />
      <circle cx="180" cy="150" r="46" className="fill-surface-2 stroke-ink" strokeWidth="3" />
      {variant === 'a'
        ? <path d="M134 146 q-4 -52 46 -50 q52 -2 46 50 q-14 -30 -46 -28 q-30 -2 -46 28z" className="fill-ink" />
        : <><path d="M132 150 q-8 -62 48 -58 q56 -4 48 58 q-12 -34 -48 -32 q-36 -2 -48 32z" className="fill-ink" /><circle cx="228" cy="102" r="20" className="fill-ink" /></>}
      <circle cx="166" cy="152" r="3.5" className="fill-ink" /><circle cx="194" cy="152" r="3.5" className="fill-ink" />
      <path d="M168 170 q12 9 24 0" fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-ink" />
      <path d="M88 282 l22 -34 h140 l22 34z" className="fill-surface stroke-ink" strokeWidth="3" strokeLinejoin="round" />
      <rect x="112" y="226" width="136" height="24" rx="3" className="fill-surface stroke-ink" strokeWidth="3" />
      <circle cx="180" cy="238" r="8" className="fill-olive" /><path d="M176 238 l3 3 l5 -6" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-primary-fg" />
      <g className="stroke-ink" strokeWidth="2.5" strokeLinecap="round" fill="none"><path d="M268 96 l16 -12" /><path d="M274 116 l20 -2" /></g>
    </svg>
  );
}
