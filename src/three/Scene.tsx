import { useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import type { Atlas } from '../data/atlas'
import { useAtlas } from '../store/useAtlas'
import { CameraRig } from './CameraRig'
import { Constellations } from './Constellations'
import { HostMarkers } from './HostMarkers'
import { MilkyWay } from './MilkyWay'
import { Overlay } from './Overlay'
import { Picker } from './Picker'
import { StarField } from './StarField'
import { SystemView } from './SystemView'
import { useFilterMask } from './useFilterMask'

function NoWebGL() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <p className="font-display text-lg text-white">3B görünüm başlatılamadı</p>
        <p className="mt-2 text-sm text-muted">
          Tarayıcınız WebGL’i desteklemiyor ya da donanım hızlandırma kapalı. Sağdaki veri tarayıcısını
          kullanmaya devam edebilirsiniz.
        </p>
      </div>
    </div>
  )
}

/** The WebGL canvas plus the HTML layer (labels, reticles) drawn on top of it. */
export function Scene({ atlas }: { atlas: Atlas }) {
  const mode = useAtlas((s) => s.mode)
  const systemIndex = useAtlas((s) => s.systemIndex)
  const showMilkyWay = useAtlas((s) => s.showMilkyWay)
  const filter = useFilterMask()
  const overlay = useRef<HTMLDivElement>(null)
  const constellationNames = useRef<HTMLDivElement>(null)

  // Resolution is the cheapest quality dial there is: render at the display's own density but
  // never above 1.5 — a field of points gains nothing beyond that, and it is 44% fewer pixels
  // than 2. (Fixed rather than adaptive: changing it mid-session reallocates the canvas, which
  // is itself a visible hitch.)
  const [dpr] = useState(() => Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 1.5))

  return (
    <div className="absolute inset-0">
      <Canvas
        flat
        dpr={dpr}
        camera={{ fov: 50, near: 0.01, far: 200000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        fallback={<NoWebGL />}
      >
        <color attach="background" args={['#04050a']} />
        <MilkyWay visible={showMilkyWay} />
        <Constellations atlas={atlas} container={constellationNames} />
        <StarField atlas={atlas} filter={filter} />
        <HostMarkers atlas={atlas} filter={filter} visible={mode === 'map'} />
        {mode === 'system' && systemIndex !== null && <SystemView atlas={atlas} systemIndex={systemIndex} />}
        <CameraRig atlas={atlas} />
        <Picker atlas={atlas} filter={filter} />
        <Overlay atlas={atlas} filter={filter} container={overlay} />
      </Canvas>
      <div ref={constellationNames} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" />
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" />
    </div>
  )
}
