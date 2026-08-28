// 客户端 unit：postAction/act 必须把 action 拼到 URL。
// v1.7.0 重构时漏过——所有控制台按钮调用全部 404 unknown action。本测试守门。
// node test/client-act.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '..', 'client.js'), 'utf8')

const m = clientSrc.match(/async function postAction\([^)]*\)\s*\{[\s\S]*?\}\s*\n\s*function act\([^)]*\)\s*\{[\s\S]*?\n\s*\}/)
if (!m) throw new Error('postAction/act 提取失败，client.js 结构已变')
const snippet = m[0]

// 通过 globalThis 暴露 calls 收集器，sandbox 内 fetch 直接读它
globalThis.__taffyCalls = []
globalThis.fetch = async function (url, opts) {
  globalThis.__taffyCalls.push({ url: String(url), method: opts && opts.method })
  return { ok: true, json: async () => ({ ok: true, locked: null }) }
}

const sandbox = `
  const API_BASE = '/dsh-taffy-mood/api'
  ${snippet}
  return { postAction, act }
`
const { act } = new Function(sandbox)()

await act('lock', 'mood=' + encodeURIComponent('tired'))
await act('test-approve')
await act('lock')

const calls = globalThis.__taffyCalls
assert.equal(calls.length, 3, '应发起 3 次 fetch')
for (const c of calls) {
  assert.equal(c.method, 'POST', '所有 action 必须 POST')
  assert.match(c.url, /\/dsh-taffy-mood\/api\/action\?/, 'URL 必须命中 action 端点')
  assert.match(c.url, /action=lock|action=test-approve/, 'URL 必须带 action 参数（v1.7.0 重构 bug 守门）')
}
const u0 = new URL(calls[0].url, 'http://x')
assert.equal(u0.searchParams.get('action'), 'lock')
assert.equal(u0.searchParams.get('mood'), 'tired')
const u1 = new URL(calls[1].url, 'http://x')
assert.equal(u1.searchParams.get('action'), 'test-approve')
assert.equal(u1.searchParams.get('mood'), null)
const u2 = new URL(calls[2].url, 'http://x')
assert.equal(u2.searchParams.get('action'), 'lock')
assert.equal(u2.searchParams.get('mood'), null, 'lock 无 mood 参数')

console.log('client-act: pass (postAction/act URL shape 正确，action 参数不再丢)')
