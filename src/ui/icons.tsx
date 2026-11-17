import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  className?: string
}

/** 24-unit grid, 1.8 stroke, round joins — one consistent line-icon family. */
function icon(children: ReactNode, fill = false) {
  return function Icon({ size = 16, className }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
        focusable="false"
      >
        {children}
      </svg>
    )
  }
}

export const SearchIcon = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></>)
export const CloseIcon = icon(<path d="M6 6l12 12M18 6 6 18" />)
export const StarIcon = icon(<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />)
export const StarFilledIcon = icon(<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />, true)
export const SlidersIcon = icon(<><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>)
export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />)
export const ChevronLeftIcon = icon(<path d="m15 6-6 6 6 6" />)
export const ChevronRightIcon = icon(<path d="m9 6 6 6-6 6" />)
export const ArrowLeftIcon = icon(<path d="M19 12H5m6-6-6 6 6 6" />)
export const ArrowRightIcon = icon(<path d="M5 12h14m-6-6 6 6-6 6" />)
export const ArrowUpIcon = icon(<path d="M12 19V5m-5 5 5-5 5 5" />)
export const ArrowDownIcon = icon(<path d="M12 5v14m-5-5 5 5 5-5" />)
export const HomeIcon = icon(<><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10v9h11v-9" /></>)
export const LinkIcon = icon(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>)
export const TagIcon = icon(<><path d="M4 5v6l8.5 8.5a1.5 1.5 0 0 0 2.1 0l4.9-4.9a1.5 1.5 0 0 0 0-2.1L11 4H5a1 1 0 0 0-1 1z" /><circle cx="8.5" cy="8.5" r="1.2" /></>)
export const GalaxyIcon = icon(<><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-22 12 12)" /><circle cx="12" cy="12" r="1.6" /></>)
export const ConstellationIcon = icon(<><path d="m5.6 16.4 3.6-6.2 5.2 3.2 3.8-6.6" /><circle cx="4.8" cy="17.8" r="1.5" /><circle cx="9.9" cy="8.9" r="1.5" /><circle cx="15.2" cy="14.4" r="1.5" /><circle cx="19" cy="5.5" r="1.5" /></>)
export const ZoomInIcon = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6M11 8v6M8 11h6" /></>)
export const ZoomOutIcon = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6M8 11h6" /></>)
export const EyeIcon = icon(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></>)
export const PlayIcon = icon(<path d="M8 5.5v13l10-6.5z" />, true)
export const PauseIcon = icon(<path d="M8 5.5v13M16 5.5v13" />)
export const OrbitIcon = icon(<><circle cx="12" cy="12" r="2.4" /><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-28 12 12)" /><circle cx="19.2" cy="7.2" r="1.3" fill="currentColor" /></>)
export const InfoIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.2" /></>)
export const ExpandIcon = icon(<path d="M14 6l-6 6 6 6M20 6l-6 6 6 6" />)
export const CollapseIcon = icon(<path d="M10 6l6 6-6 6M4 6l6 6-6 6" />)
export const CrosshairIcon = icon(<><circle cx="12" cy="12" r="7" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /></>)
export const TableIcon = icon(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M3.5 14.7h17M9.5 10v9.5" /></>)
export const ResetIcon = icon(<><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4.5v4.2h4.2" /></>)
export const CheckIcon = icon(<path d="m5 12.5 4.5 4.5L19 7.5" />)
export const SunIcon = icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>)
/** An hourglass: the time machine. */
export const HourglassIcon = icon(<><path d="M6.5 3.5h11M6.5 20.5h11" /><path d="M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5" /></>)
/** A telescope: the discovery timeline. */
export const TelescopeIcon = icon(<><path d="m4 13.5 13-6.5 1.8 3.6-13 6.5z" /><path d="m17 7 2.6-1.3 1.8 3.6-2.6 1.3" /><path d="M11 14.5 8.5 21M12.4 13.8 15 21" /></>)
/** Looking up from a horizon: the sky seen from a star. */
export const SkyIcon = icon(<><path d="M3 18.5h18" /><path d="M5.5 18.5a6.5 6.5 0 0 1 13 0" /><path d="M8 7.5l.6 1.4 1.4.6-1.4.6L8 11.5l-.6-1.4L6 9.5l1.4-.6zM16.5 4l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" /></>)
export const BackwardIcon = icon(<path d="M11 6.5v11L3.5 12zM20 6.5v11L12.5 12z" />, true)
export const ForwardIcon = icon(<path d="M13 6.5v11l7.5-5.5zM4 6.5v11l7.5-5.5z" />, true)
export const LeafIcon =icon(<><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14" /><path d="M5 19c2-4 5-7 9-9" /></>)

/** The app mark: a star, an orbit, and one green world. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="logo-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff7dc" />
          <stop offset="0.45" stopColor="#f6c453" />
          <stop offset="1" stopColor="#f6c453" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="32" rx="27" ry="11" fill="none" stroke="#7cc7ff" strokeOpacity="0.8" strokeWidth="2.4" transform="rotate(-24 32 32)" />
      <circle cx="32" cy="32" r="15" fill="url(#logo-glow)" />
      <circle cx="32" cy="32" r="5.5" fill="#fff7dc" />
      <circle cx="55" cy="21.5" r="3.6" fill="#4ade80" />
    </svg>
  )
}
