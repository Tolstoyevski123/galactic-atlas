import { useEffect } from 'react'
import { Browser } from './browser/Browser'
import { About, BrowserToggle, Loading, Toast, TopBar, Veil } from './panels/Chrome'
import { DetailPanel } from './panels/DetailPanel'
import { Hud } from './panels/Hud'
import { startAtlas } from './store/bootstrap'
import { useAtlas } from './store/useAtlas'
import { Scene } from './three/Scene'
import { view } from './three/view'

/** Panels float over the map on wide screens; the camera then centres on the space between them. */
function useViewInsets(): void {
  const browserOpen = useAtlas((s) => s.browserOpen)
  const browserWide = useAtlas((s) => s.browserWide)
  const ready = useAtlas((s) => s.atlas !== null) // the panels only exist once the catalogue is in
  useEffect(() => {
    const panel = document.querySelector('.detail-panel')
    const update = () => {
      const width = window.innerWidth
      view.insetLeft = 0
      view.insetRight = 0
      view.insetBottom = 0
      if (width >= 1100) {
        view.insetLeft = 376
        view.insetRight = browserOpen ? Math.min(browserWide ? 880 : 468, width - 24) + 12 : 0
      } else if (width <= 640 && panel) {
        // Phones: the detail panel is a bottom sheet; keep the subject above it.
        view.insetBottom = Math.max(0, window.innerHeight - panel.getBoundingClientRect().top)
      }
    }
    update()
    window.addEventListener('resize', update)
    const observer = panel && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (panel) observer?.observe(panel)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [browserOpen, browserWide, ready])
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target !== null && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const s = useAtlas.getState()
      if (event.key === 'Escape') {
        if (s.aboutOpen) s.setUi({ aboutOpen: false })
        else if (typing) return
        else if (s.mode === 'sky') s.exitSky()
        else if (s.mode === 'system') {
          if (s.selectedPlanet !== null) s.selectPlanet(null)
          else s.exitSystem()
        } else if (s.selectedStar !== null) s.selectStar(null)
      } else if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'h' || event.key === 'H')) {
        s.goHome()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App() {
  useEffect(() => startAtlas(), [])
  useViewInsets()
  useShortcuts()
  const atlas = useAtlas((s) => s.atlas)
  const browserOpen = useAtlas((s) => s.browserOpen)

  return (
    <div className="relative h-full w-full overflow-hidden bg-space">
      {atlas && (
        <>
          <Scene atlas={atlas} />
          <Veil />
          <TopBar atlas={atlas} />
          <DetailPanel atlas={atlas} />
          <Hud atlas={atlas} />
          {browserOpen ? <Browser atlas={atlas} /> : <BrowserToggle />}
          <About atlas={atlas} />
          <Toast />
        </>
      )}
      <Loading />
    </div>
  )
}
