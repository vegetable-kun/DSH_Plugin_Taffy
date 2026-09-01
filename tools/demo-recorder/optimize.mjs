// 拼 GIF：用 palettegen + paletteuse 压缩到 600px、15fps、128 色。
// 跑：node tools/demo-recorder/optimize.mjs
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, unlink, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const FRAMES_DIR = join(__dirname, 'frames')
const PALETTE = join(__dirname, 'palette.png')
const OUTPUT = join(__dirname, '..', '..', 'assets', 'demo.gif')
const WIDTH = 600
const HEIGHT = 420
const FPS = 15

const frames = (await readdir(FRAMES_DIR)).filter(function (f) { return f.endsWith('.png') }).sort()
if (frames.length === 0) {
  console.error('no frames in', FRAMES_DIR, '— run record.mjs first')
  process.exit(1)
}
console.log('frames:', frames.length)

const pattern = join(FRAMES_DIR, 'frame-%05d.png')

// 1) 生成调色板
await exec('ffmpeg', ['-y', '-framerate', String(FPS), '-i', pattern, '-vf', 'scale=' + WIDTH + ':' + HEIGHT + ':flags=lanczos,palettegen=stats_mode=full', PALETTE], { stdio: 'inherit' })

// 2) 用调色板编码 GIF
await exec('ffmpeg', ['-y', '-framerate', String(FPS), '-i', pattern, '-i', PALETTE, '-lavfi', 'scale=' + WIDTH + ':' + HEIGHT + ':flags=lanczos [x]; [x][1:v] paletteuse=dither=sierra2_4a', '-loop', '0', OUTPUT], { stdio: 'inherit' })

// 清理 palette + frames（保留 frames 目录方便重录）
await unlink(PALETTE).catch(function () {})

const s = await stat(OUTPUT)
console.log('output:', OUTPUT, '·', (s.size / 1024).toFixed(1) + ' KB')
