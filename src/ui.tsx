import type { ReactNode } from 'react'

const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  doc: <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />,
  gauge: <><path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4-5M4 17h2M18 17h2" /></>,
  gear: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  chev: <path d="M6 9l6 6 6-6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  check: <path d="M5 12l5 5 9-10" />,
  alert: <path d="M12 4l9 16H3zM12 10v4M12 17h.01" />,
  clip: <path d="M20 11l-8 8a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></>,
  cal: <path d="M5 6h14v14H5zM5 10h14M9 3v4M15 3v4" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

const CAR_BODY =
  'M84 320V282Q84 266 102 262L152 252L192 206Q198 198 210 198H304Q318 198 326 208L362 252L412 262Q430 266 430 284V320H386A44 44 0 0 0 298 320H214A44 44 0 0 0 126 320Z'
export const ZIG = 'M66 380' + 'l15.5 12l15.5 -12'.repeat(12)

/** The Reimbo mark: outline car on a torn-receipt edge. Uses currentColor. */
export function CarGlyph({ size, road }: { size: number; road?: boolean }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id="roadclip"><rect x="66" y="360" width="372" height="60" /></clipPath>
      </defs>
      <g transform="translate(0,-26)" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <g strokeWidth="16">
          <path d={CAR_BODY} />
          <path strokeWidth="12" d="M184 250L212 222H298L330 250ZM254 222V250" />
          <circle cx="342" cy="320" r="22" />
          <circle cx="170" cy="320" r="22" />
          <circle cx="342" cy="320" r="4" fill="currentColor" stroke="none" />
          <circle cx="170" cy="320" r="4" fill="currentColor" stroke="none" />
        </g>
        {road ? (
          <g clipPath="url(#roadclip)">
            <g className="road"><path strokeWidth="12" d={'M-60 380' + 'l15.5 12l15.5 -12'.repeat(22)} /></g>
          </g>
        ) : (
          <path strokeWidth="12" d={ZIG} />
        )}
      </g>
    </svg>
  )
}

export function LogoTile({ size = 32 }: { size?: number }) {
  return (
    <div className="logo-tile" style={{ width: size, height: size, borderRadius: Math.round(size * 0.225) }}>
      <CarGlyph size={size} />
    </div>
  )
}

export function Word({ size = 24 }: { size?: number }) {
  return (
    <span className="disp word" style={{ fontSize: size }}>
      reimb<span className="o">o</span>
    </span>
  )
}

/** Receipts always stay paper-coloured, in both themes. */
export function Receipt({ w = 44, h = 58, total = true, className }: { w?: number; h?: number; total?: boolean; className?: string }) {
  let d = 'M2 2H42V52'
  for (let i = 0; i < 8; i++) d += `L${42 - 5 * (i + 1)} ${i % 2 === 0 ? 56 : 52}`
  d += 'Z'
  return (
    <svg viewBox="0 0 44 58" width={w} height={h} className={className} aria-hidden="true">
      <path d={d} fill="#efece1" stroke="#bdb8a8" strokeWidth="1" />
      {[[9, 22], [15, 28], [21, 18], [27, 26]].map(([y, wd]) => (
        <rect key={y} x="7" y={y} width={wd} height="2" rx="1" fill="#bdb8a8" />
      ))}
      {total && <rect x="7" y="38" width="30" height="3.5" rx="1" fill="#2b2b28" opacity=".75" />}
    </svg>
  )
}

export function ClaimStatusTag({ status }: { status: string }) {
  const cls = status === 'reimbursed' ? 'ok' : status === 'submitted' ? 'co' : 'warn'
  const label = status === 'reimbursed' ? 'Reimbursed' : status === 'submitted' ? 'Submitted' : 'Draft'
  return <span className={`tag ${cls}`}>{label}</span>
}
