// 录屏：起 http server 提供 demo.html + 仓库 assets + client.js；puppeteer 抓帧
// 跑：node tools/demo-recorder/record.mjs
// 完成后跑：node tools/demo-recorder/optimize.mjs
import puppeteer from 'puppeteer'
import http from 'node:http'
import { mkdir, rm, stat } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { join, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const FRAMES_DIR = join(__dirname, 'frames')
const DEMO_PATH = join(__dirname, 'demo.html')
const ASSETS_DIR = join(ROOT, 'assets')
const CLIENT_PATH = join(ROOT, 'client.js')
const PORT = 18790

const WIDTH = 800
const HEIGHT = 560
const FPS = 15
const DURATION_MS = 21000
const INTERVAL_MS = Math.round(1000 / FPS)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' }

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0])
    if (p === '/') p = '/demo.html'
    if (p.startsWith('/dsh-taffy-mood/')) p = p.replace(/^\/dsh-taffy-mood\//, '/')
    let fullPath
    if (p === '/client.js') {
      fullPath = join(ROOT, 'client.js')
    } else if (p.startsWith('/assets/')) {
      fullPath = join(ROOT, p.replace(/^\/+/, ''))
    } else {
      fullPath = join(__dirname, p.replace(/^\/+/, ''))
    }
    // 安全：必须落在 __dirname 或 ROOT
    const ok = (fullPath.startsWith(__dirname) || fullPath.startsWith(ROOT)) && !fullPath.includes('..')
    if (!ok) { res.writeHead(403); res.end('forbidden'); return }
    const data = await readFile(fullPath)
    res.writeHead(200, { 'Content-Type': MIME[extname(fullPath).toLowerCase()] || 'application/octet-stream' })
    res.end(data)
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found: ' + e.message)
  }
})
await new Promise(function (r) { server.listen(PORT, r) })
console.log('demo server http://127.0.0.1:' + PORT)

await rm(FRAMES_DIR, { recursive: true, force: true })
await mkdir(FRAMES_DIR, { recursive: true })

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 })
  page.on('pageerror', function (err) { console.error('page error:', err.message) })
  page.on('console', function (msg) { if (msg.type() === 'error') console.error('console error:', msg.text()) })
  page.on('requestfailed', function (r) { console.error('REQ FAIL:', r.url(), r.failure() && r.failure().errorText) })
  page.on('response', function (r) { if (r.status() >= 400) console.error('HTTP', r.status(), r.url()) })
  console.log('open demo')
  await page.goto('http://127.0.0.1:' + PORT + '/demo.html', { waitUntil: 'load' })
  await page.waitForSelector('img[alt]', { timeout: 10000 })
  await new Promise(function (r) { setTimeout(r, 200) })
  const t0 = Date.now()
  let i = 0
  while (Date.now() - t0 < DURATION_MS) {
    const framePath = join(FRAMES_DIR, 'frame-' + String(i).padStart(5, '0') + '.png')
    await page.screenshot({ path: framePath, type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
    i += 1
    await new Promise(function (r) { setTimeout(r, INTERVAL_MS) })
  }
  console.log('captured', i, 'frames')
} finally {
  await browser.close()
  server.close()
}
