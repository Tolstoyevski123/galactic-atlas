/**
 * End-to-end smoke test:  npm run build && npm run e2e
 *
 * Serves dist/ from this process, opens it in the Chrome or Edge already installed on the
 * machine (no browser download) and walks through the main flows with assertions.
 * Add  --screenshots <dir>  to also save a few pictures of the app (used for the README).
 */

import { createServer } from 'node:http'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
if (!existsSync(join(root, 'index.html'))) {
  console.error('dist/ bulunamadı. Önce "npm run build" çalıştırın.')
  process.exit(2)
}
const shotFlag = process.argv.indexOf('--screenshots')
const shotDir = shotFlag >= 0 ? resolve(process.argv[shotFlag + 1] ?? 'docs') : null
if (shotDir) mkdirSync(shotDir, { recursive: true })

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png',
}
const server = createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (path.endsWith('/')) path += 'index.html'
    const file = normalize(join(root, path))
    if (!file.startsWith(root)) throw new Error('outside root')
    const body = await readFile(file)
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
const origin = `http://127.0.0.1:${server.address().port}/`

let browser = null
for (const channel of ['chrome', 'msedge']) {
  try {
    browser = await chromium.launch({ channel, headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] })
    break
  } catch {
    /* try the next installed browser */
  }
}
if (!browser) {
  console.error('Chrome ya da Edge bulunamadı.')
  server.close()
  process.exit(2)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

async function open(hash, viewport = { width: 1600, height: 900 }, mobile = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Photographs come from outside services (sky survey, solar observatory); their being
  // unreachable is a state the app handles, not a defect, so those failures are not counted.
  const external = (message) => message.text().startsWith('Failed to load resource') && !message.location().url.startsWith(origin)
  page.on('console', (message) => message.type() === 'error' && !external(message) && errors.push(message.text()))
  await page.goto(origin + hash, { waitUntil: 'load' })
  await page.waitForSelector('.detail-panel', { timeout: 20000 })
  return { context, page, errors }
}

const text = (page, selector) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, selector)
const hash = (page) => page.evaluate(() => window.location.hash)
const firstRows = (page, count) =>
  page.evaluate(
    (n) =>
      [...document.querySelectorAll('[role=grid] [role=row][aria-rowindex]')]
        .sort((a, b) => Number(a.getAttribute('aria-rowindex')) - Number(b.getAttribute('aria-rowindex')))
        .slice(0, n)
        .map((row) => row.querySelectorAll('[role=gridcell]')[1]?.textContent),
    count,
  )
const shot = async (page, name) => shotDir && page.screenshot({ path: join(shotDir, `${name}.png`) })
/** Wait until the panel's photograph has settled: 'tiles' or 'scan' (shown), 'ready' (Sun) or 'failed' (service unreachable). */
const photo = async (page) => {
  for (let i = 0; i < 40; i++) {
    const status = await page.evaluate(() => document.querySelector('.detail-panel [data-photo]')?.getAttribute('data-photo') ?? null)
    if (status !== 'loading') return status
    await sleep(500)
  }
  return 'loading'
}

try {
  // ── Desktop, opened through a shared link.
  const { context, page, errors } = await open('#star-32349')
  await sleep(4500)
  check('paylaşılan bağlantı Sirius’u seçer', (await text(page, '.detail-panel h2')) === 'Sirius')
  check('seçili satır listede vurgulu', (await text(page, '[role=row][aria-selected=true] [role=gridcell]:nth-child(2)')) === 'Sirius')
  check('3B’de seçim halkası görünür', await page.evaluate(() => document.querySelector('.reticle--selected')?.style.opacity === '1'))
  const siriusPhoto = await photo(page)
  check(`yıldızın gökyüzü fotoğrafı sonuçlanır (${siriusPhoto})`, ['tiles', 'scan', 'failed'].includes(siriusPhoto))
  check('takımyıldız adları görünür', await page.evaluate(() => [...document.querySelectorAll('.con-label')].some((el) => Number(el.style.opacity) > 0)))
  await shot(page, 'yildiz')
  await page.click('button[aria-label="Takımyıldız çizgilerini gizle"]')
  await sleep(2000)
  check('takımyıldız katmanı kapatılabilir', await page.evaluate(() => [...document.querySelectorAll('.con-label')].every((el) => !(Number(el.style.opacity) > 0))))
  await page.click('button[aria-label="Takımyıldız çizgilerini göster"]')

  await page.click('[role=columnheader] button:has-text("Uzaklık")')
  await sleep(700)
  const ascending = await firstRows(page, 2)
  check('uzaklığa göre artan sıralama', ascending[0] === 'Güneş' && ascending[1] === 'Proxima Centauri', ascending.join(' | '))
  await page.click('[role=columnheader] button:has-text("Uzaklık")')
  await sleep(700)
  check('ikinci tık azalan sıralar', (await firstRows(page, 1))[0] !== 'Güneş')
  await page.click('[role=columnheader] button:has-text("Uzaklık")')
  await sleep(700)
  check('üçüncü tık varsayılan sıraya döner', (await firstRows(page, 2)).join('|') === 'Güneş|Sirius')

  await page.click('.detail-panel button[aria-label="Favorilere ekle"]')
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.detail-panel')
  await sleep(4000)
  check('favori yeniden yüklemeden sonra duruyor', (await page.$('.detail-panel button[aria-label="Favorilerden çıkar"]')) !== null)
  await page.click('button:has-text("Filtreler")')
  await page.click('[role=switch]:has-text("Yalnız favorilerim")')
  await sleep(700)
  check('"yalnız favoriler" filtresi', (await firstRows(page, 5)).join('|') === 'Sirius')
  await page.click('button:has-text("Temizle")')
  await page.click('button:has-text("Filtreler")')

  await page.fill('input[type=search]', 'zzzzqqq')
  await sleep(600)
  check('boş sonuç durumu', (await page.$('text=Eşleşen kayıt yok')) !== null)
  await page.fill('input[type=search]', 'ALPHA CENTAURI')
  await sleep(600)
  const centauri = await firstRows(page, 4)
  check('"ALPHA CENTAURI" araması α Cen A ve B’yi bulur', centauri.includes('Rigil Kentaurus') && centauri.includes('Toliman'), centauri.join(' | '))
  await page.fill('input[type=search]', '')

  await page.click('button:has-text("Gezegenli")')
  await sleep(900)
  check('filtre sayaca yansır', (await text(page, '[role=tab][aria-selected=true]'))?.includes('/ ') === true)
  await page.click('button:has-text("Gezegenli")')

  await page.click('[role=tab]:has-text("Gezegenler")')
  await page.fill('input[type=search]', 'kepler-22')
  await sleep(700)
  check('arama en iyi eşleşmeyi üste alır', (await firstRows(page, 1))[0]?.startsWith('Kepler-22 b') === true)
  await page.click('[role=grid] [role=row][aria-rowindex="1"]')
  await sleep(5200)
  check('gezegen satırı sisteme dalar', (await text(page, '.detail-panel h2')) === 'Kepler-22')
  check('adres çubuğu gezegeni gösterir', (await hash(page)) === '#planet-kepler-22-b', await hash(page))
  check('gezegen kartı açık', (await text(page, '.detail-panel h4')) === 'Kepler-22 b')
  await page.keyboard.press('Escape')
  await sleep(300)
  check('Esc önce gezegen seçimini kaldırır', (await hash(page)) === '#system-kepler-22')
  await page.keyboard.press('Escape')
  await sleep(2600)
  check('Esc sonra haritaya döner', (await page.$('button:has-text("Sisteme dal")')) !== null && (await hash(page)).startsWith('#star-'))

  await page.evaluate(() => (window.location.hash = '#planet-yok-boyle-bir-sey'))
  await sleep(500)
  check('bilinmeyen bağlantı uyarı gösterir', (await text(page, '[role=status]'))?.includes('bulunamadı') === true)
  check('konsolda hata yok', errors.length === 0, errors.slice(0, 2).join(' / '))

  if (shotDir) {
    await page.fill('input[type=search]', '')
    await page.click('[role=tab]:has-text("Yıldızlar")')
    await page.keyboard.press('h')
    await sleep(3600)
    await page.evaluate(() => {
      document.querySelector('[role=grid]')?.scrollTo(0, 0)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await sleep(300)
    await shot(page, 'harita')
    await page.evaluate(() => (window.location.hash = '#planet-trappist-1-e'))
    await sleep(6000)
    await shot(page, 'sistem')
    await page.evaluate(() => (window.location.hash = '#star-hyg0'))
    await sleep(3000)
    await photo(page)
    await sleep(600)
    await shot(page, 'gunes')
  }

  // ── The About dialog credits every source of imagery.
  await page.click('button[aria-label="Galaktik Atlas hakkında"]')
  await sleep(500)
  const about = (await text(page, '[role=dialog]')) ?? ''
  check('Hakkında penceresi görsel kaynaklarını anar', ['Digitized Sky Survey', 'Solar Dynamics Observatory', 'Stellarium'].every((name) => about.includes(name)))
  await page.evaluate(() => document.querySelector('[role=dialog] .overflow-y-auto')?.scrollTo(0, 150))
  await sleep(200)
  await shot(page, 'hakkinda')
  await page.keyboard.press('Escape')
  await sleep(300)

  // ── The Solar System is drawn with real maps.
  const maps = []
  page.on('response', (response) => response.url().includes('/textures/') && maps.push(response.status()))
  await page.evaluate(() => (window.location.hash = '#system-gunes-sistemi'))
  await sleep(6500)
  check('Güneş Sistemi açılır', (await text(page, '.detail-panel h2')) === 'Güneş Sistemi')
  check('gerçek yüzey haritaları yüklenir', maps.length >= 10 && maps.every((status) => status === 200), `${maps.length} doku`)
  check('Güneş Sistemi’nde konsol hatası yok', errors.length === 0, errors.slice(0, 2).join(' / '))
  if (shotDir) {
    await page.click('button[aria-label="Duraklat"]')
    await shot(page, 'gunes-sistemi')
  }
  await page.evaluate(() => window.localStorage.clear())
  await context.close()

  // ── Phone.
  const phone = await open('#system-trappist-1', { width: 390, height: 844 }, true)
  await sleep(4500)
  check('telefonda sistem görünümü açılır', (await text(phone.page, '.detail-panel h2')) === 'TRAPPIST-1')
  check('telefonda yatay taşma yok', await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  check('telefonda konsol hatası yok', phone.errors.length === 0, phone.errors.slice(0, 2).join(' / '))
  await shot(phone.page, 'mobil')
  await phone.context.close()
} catch (error) {
  check('senaryo tamamlandı', false, String(error).split('\n')[0])
}

await browser.close()
server.close()

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail && !r.ok ? `  →  ${r.detail}` : ''}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} kontrol geçti`)
process.exit(failed === 0 ? 0 : 1)
