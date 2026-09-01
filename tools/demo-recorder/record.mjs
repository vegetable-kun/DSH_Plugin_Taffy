// 录屏：开 demo.html，按时间轴抓帧 → tools/demo-recorder/frames/
// 跑：node tools/demo-recorder/record.mjs
// 完成后跑：node tools/demo-recorder/optimize.mjs
import puppeteer from 'puppeteer'
import { mkdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRAMES_DIR = join(__dirname, 'frames')
const DEMO_URL = 'file://' + join(__dirname, 'demo.html')

const WIDTH = 800
const HEIGHT = 560
const FPS = 15
const DURATION_MS = 21000
const INTERVAL_MS = Math.round(1000 / FPS)

await rm(FRAMES_DIR, { recursive: true, force: true })
await mkdir(FRAMES_DIR, { recursive: true })

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 })
  // 静音 puppeteer 日志
  page.on('pageerror', function (err) { console.error('page error:', err.message) })
  page.on('console', function (msg) {
    if (msg.type() === 'error') console.error('console error:', msg.text())
  })
  console.log('open', DEMO_URL)
  await page.goto(DEMO_URL, { waitUntil: 'load' })
  // 等 React UMD + client.js 执行、tAFFY 出现
  await page.waitForSelector('img[alt]', { timeout: 10000 })
  // 留 200ms 让 greetUntil box 设上
  await new Promise(function (r) { setTimeout(r, 200) })
  const t0 = Date.now()
  let i = 0
  while (Date.now() - t0 < DURATION_MS) {
    const framePath = join(FRAMES_DIR, 'frame-' + String(i).padStart(5, '0') + '.png')
    await page.screenshot({ path: framePath, type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
    i += 1
    await new Promise(function (r) { setTimeout(r, INTERVAL_MS) })
  }
  console.log('captured', i, 'frames into', FRAMES_DIR)
} finally {
  await browser.close()
}
