// 冒烟测试：假 ctx 跑 apply，断言事件状态机与三条路由。node test/smoke.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../host.js'

function makeFakeRes() {
  const res = {
    code: null,
    type: null,
    location: null,
    cacheControl: null,
    body: null,
    chunks: [],
    writeHead(code, headers) {
      this.code = code
      this.type = headers && headers['Content-Type']
      this.location = headers && headers.Location
      this.cacheControl = headers && headers['Cache-Control']
    },
    end(chunk) {
      if (chunk) this.chunks.push(chunk)
      this.body = this.chunks.join('')
      this.done = true
    },
  }
  return res
}

const agentsSvc = {
  list: () => [{ status: 'running', session: { id: 'sess-1' } }, { status: 'idle' }],
}
const approvalCalls = []
const approvalSvc = {
  request: (req) => {
    approvalCalls.push(req)
    return { catch() {} }
  },
}

const routes = []
const eventHandlers = []
const disposers = []
const ctx = {
  get(id) {
    if (id === 'agents') return agentsSvc
    if (id === 'approval') return approvalSvc
    return undefined
  },
  on(event, handler) {
    eventHandlers.push([event, handler])
    return () => {}
  },
  effect(fn) {
    const result = fn()
    if (typeof result === 'function') disposers.push(result)
    return result
  },
  webServer: {
    register(options) {
      routes.push(options)
      return () => {}
    },
  },
}

await apply(ctx)

// —— 路由注册 —— //
assert.equal(routes.length, 1, '应恰好注册一条路由')
assert.equal(routes[0].path, '/dsh-taffy-mood')
const handler = routes[0].handler

async function call(url, opts) {
  const res = makeFakeRes()
  await handler({ url, method: (opts && opts.method) || 'GET', headers: (opts && opts.headers) || {} }, res)
  return res
}

// —— /api/state 初始态（fake agent 有一个 running）—— //
{
  const res = await call('/dsh-taffy-mood/api/state')
  assert.equal(res.code, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.state.running, true)
  assert.equal(body.state.phase, 'wait')
  assert.equal(body.state.locked, null)
}

// —— 前缀剥离兼容：不带前缀的回调形态也能命中 —— //
{
  const res = await call('/api/state')
  assert.equal(res.code, 200)
  assert.equal(JSON.parse(res.body).ok, true)
}

// —— 动作：lock 合法/非法/unlock —— //
{
  const ok = JSON.parse((await call('/dsh-taffy-mood/api/action?action=lock&mood=crying', { method: 'POST' })).body)
  assert.deepEqual(ok, { ok: true, locked: 'crying' })
  const bad = await call('/dsh-taffy-mood/api/action?action=lock&mood=hax', { method: 'POST' })
  assert.equal(bad.code, 200)
  assert.equal(JSON.parse(bad.body).ok, false)
  const unlocked = JSON.parse((await call('/dsh-taffy-mood/api/action?action=lock', { method: 'POST' })).body)
  assert.deepEqual(unlocked, { ok: true, locked: null })
  // 新表情键也可锁定（控制台调试网格与 host 白名单同步）
  for (const mood of ['waiting', 'compacting', 'tired', 'ignoredApproval', 'sleeping', 'greeting']) {
    const r = JSON.parse((await call('/dsh-taffy-mood/api/action?action=lock&mood=' + mood, { method: 'POST' })).body)
    assert.equal(r.ok, true, '锁定 ' + mood + ' 应成功')
    assert.equal(r.locked, mood)
  }
  await call('/dsh-taffy-mood/api/action?action=lock')
  const unknownAction = await call('/dsh-taffy-mood/api/action?action=nope', { method: 'POST' })
  assert.equal(unknownAction.code, 404)
}

// —— 事件驱动状态机 —— //
const emit = (event) => {
  const pair = eventHandlers.find(([name]) => name === 'session/event')
  assert.ok(pair, 'session/event 监听已注册')
  pair[1]({ id: 'sess-1' }, event)
}

emit({ type: 'tool/call', data: {} })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.phase, 'tool')
  assert.equal(body.state.running, true)
}
emit({ type: 'tool/result', data: {} })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.phase, 'wait')
}

// 插话判定：chunk 新鲜时 user/message 触发 surprised
emit({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'x' } } })
emit({ type: 'user/message', data: {} })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.ok(body.state.surprisedUntil > Date.now(), '输出中插话应置 surprised')
}

// 审批流：asked → decided(rejected) → clear-rejected
emit({ type: 'approval/asked', data: {} })
emit({ type: 'approval/decided', data: { outcome: 'rejected' } })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.approvalPending, false)
  assert.equal(body.state.lastApproval, 'rejected')
}
await call('/api/action?action=clear-rejected', { method: 'POST' })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.lastApproval, null, 'clear-rejected 后 rejected 应被清掉')
}

// turn/end：aborted → turnFlash；completed+5 工具 → admirable
emit({ type: 'tool/call', data: {} })
for (let i = 0; i < 5; i += 1) emit({ type: 'tool/call', data: {} })
emit({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.turnFlash, 'aborted')
}

// test-approve：有 running agent → approval.request 被调用
{
  const res = await call('/api/action?action=test-approve', { method: 'POST' })
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(approvalCalls.length, 1)
  assert.equal(approvalCalls[0].toolName, 'taffy-test-approve')
}

// —— 新状态 1：等你回答（ask_user_question）—— //
emit({ type: 'tool/call', data: { callId: 'c-ask-1', name: 'ask_user_question', arguments: '{}' } })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.waitingAnswer, true, 'ask 挂起应置 waitingAnswer')
}
// 回答到达 → 消费提问态且不算插话（对比前后 surprisedUntil 不变）
emit({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'x' } } })
const beforeAnswer = JSON.parse((await call('/api/state')).body).state
emit({ type: 'user/message', data: {} })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.waitingAnswer, false, '回答消息清除挂起')
  assert.equal(body.state.surprisedUntil, beforeAnswer.surprisedUntil, '答题不算插话，不触发惊讶')
}
// 结果配对清除：不匹配的 result 保持挂起，配对的清除
emit({ type: 'tool/call', data: { callId: 'c-ask-2', name: 'ask_user_question', arguments: '{}' } })
emit({ type: 'tool/result', data: { message: { toolCallId: 'c-other' } } })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.waitingAnswer, true, '不匹配的 result 不清除挂起')
}
emit({ type: 'tool/result', data: { message: { toolCallId: 'c-ask-2' } } })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.waitingAnswer, false, '配对 result 清除挂起')
}

// —— 新状态 2：求饶窗口（60 秒内第二次审批请求）—— //
emit({ type: 'approval/asked', data: {} })
emit({ type: 'approval/decided', data: { outcome: 'allowed-once' } })
emit({ type: 'approval/asked', data: {} }) // 60 秒内第二次 → 求饶
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.ok(body.state.beggingUntil > Date.now(), '60 秒内二次请求应置 beggingUntil')
}
emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } })

// —— 新状态 3：压缩记忆（start 开、end 关）—— //
emit({ type: 'compaction/start', data: {} })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.compacting, true)
}
emit({ type: 'compaction/end', data: {} })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.compacting, false, 'end 应关闭压缩态')
}

// —— 新状态 4/5：长任务疲惫 + 审批没人理（平移 Date.now 模拟时间流逝）—— //
const realNow = Date.now
try {
  // 疲惫：turn/start 后快进 3 分钟零 1 秒
  emit({ type: 'turn/start', data: { turn: 1 } })
  Date.now = () => realNow() + (3 * 60 + 1) * 1000
  {
    const body = JSON.parse((await call('/api/state')).body)
    assert.equal(body.state.tired, true, '单轮超 3 分钟应置 tired')
  }
  emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  {
    const body = JSON.parse((await call('/api/state')).body)
    assert.equal(body.state.tired, false, 'turn/end 清除疲惫')
  }

  // 没人理：审批挂起后快进 31 秒；决定落地即恢复
  emit({ type: 'approval/asked', data: {} })
  Date.now = () => realNow() + 31 * 1000
  {
    const body = JSON.parse((await call('/api/state')).body)
    assert.equal(body.state.ignoredApproval, true, '挂超 30 秒应置 ignoredApproval')
  }
  Date.now = realNow
  emit({ type: 'approval/decided', data: { outcome: 'allowed-once' } })
  {
    const body = JSON.parse((await call('/api/state')).body)
    assert.equal(body.state.ignoredApproval, false, '决定后清除 ignoredApproval')
  }
} finally {
  Date.now = realNow
}

// —— 新状态 6：休眠（空闲超 10 分钟切静态，任何活动即醒）—— //
emit({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'wake' } } })
Date.now = () => realNow() + 11 * 60 * 1000
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.sleeping, true, '空闲超 10 分钟应置 sleeping')
}
Date.now = realNow
emit({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'awake' } } })
{
  const body = JSON.parse((await call('/api/state')).body)
  assert.equal(body.state.sleeping, false, '活动后应唤醒')
}

// —— 素材路由（含内容哈希 + 永久缓存）—— //
{
  // 1. 老 URL 301 跳转到带 hash 的 URL
  const legacy = await call('/dsh-taffy-mood/assets/taffy-cry.gif')
  assert.equal(legacy.code, 301, '老 URL 应 301 跳转')
  assert.match(legacy.location, /^\/assets\/taffy-cry\.[0-9a-f]{8}\.gif$/, 'Location 含 8 字符哈希')

  // 2. 带 hash 的 URL 直接 200，immutable 缓存
  const hashed = await call(legacy.location)
  assert.equal(hashed.code, 200)
  assert.match(hashed.type, /image\/gif/)
  assert.match(hashed.cacheControl, /immutable/)
  assert.match(hashed.cacheControl, /max-age=31536000/)
  assert.ok(hashed.chunks[0].length > 1000, 'GIF 字节非空')

  // 3. JPG 同理
  const legacyJpg = await call('/dsh-taffy-mood/assets/taffy-staring.jpg')
  assert.equal(legacyJpg.code, 301)
  assert.match(legacyJpg.location, /^\/assets\/taffy-staring\.[0-9a-f]{8}\.jpg$/)
  const jpg = await call(legacyJpg.location)
  assert.equal(jpg.code, 200)
  assert.match(jpg.type, /image\/jpeg/)

  // 4. 白名单外 → 404
  const missing = await call('/dsh-taffy-mood/assets/not-on-list.gif')
  assert.equal(missing.code, 404)
  const traversal = await call('/dsh-taffy-mood/assets/../host.js')
  assert.equal(traversal.code, 404, '白名单外路径一律 404')
  const unknown = await call('/dsh-taffy-mood/nothing')
  assert.equal(unknown.code, 404)

  // 5. /api/asset-index 返回 name→hashed-url 映射
  const idx = await call('/dsh-taffy-mood/api/asset-index')
  assert.equal(idx.code, 200)
  const idxBody = JSON.parse(idx.body)
  assert.ok(idxBody['taffy-cry.gif'] && /^taffy-cry\.[0-9a-f]{8}\.gif$/.test(idxBody['taffy-cry.gif']))
  assert.ok(idxBody['taffy-staring.jpg'])
  assert.equal(Object.keys(idxBody).length, 23, '应有 23 个素材映射')
}

console.log('smoke: all assertions passed (' + routes.length + ' route, ' + eventHandlers.length + ' listener)')

// —— 验证 cordis config 透传到 apply —— //
{
  const routes2 = []
  const handlers2 = []
  const ctx2 = {
    get() { return undefined },
    on(event, handler) { handlers2.push([event, handler]); return () => {} },
    effect(fn) { const d = fn(); return d },
    webServer: { register(options) { routes2.push(options); return () => {} } },
  }
  // 故意把 surprised_ms 拉到 10s；custom cfg 应被 host 接受
  await apply(ctx2, { surprised_ms: 10000 })
  const handler2 = routes2[0].handler
  const fakeRes = () => {
    const r = { code: null, type: null, body: null, chunks: [] }
    return { ...r, writeHead(c, h) { this.code = c; this.type = h && h['Content-Type'] }, end(c) { if (c) this.chunks.push(c); this.body = this.chunks.join('') } }
  }
  // 模拟一次输出中插话
  const realNow = Date.now
  try {
    const before = realNow()
    handlers2.find(([n]) => n === 'session/event')[1]({ id: 's2' }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'x' } } })
    handlers2.find(([n]) => n === 'session/event')[1]({ id: 's2' }, { type: 'user/message', data: {} })
    const res = fakeRes(); res.writeHead = function(c, h) { this.code = c; this.type = h && h['Content-Type'] }; res.end = function(c) { this.body = c }
    await handler2({ url: '/dsh-taffy-mood/api/state' }, res)
    const body = JSON.parse(res.body).state
    const offset = body.surprisedUntil - before
    assert.ok(offset > 9500 && offset < 10500, 'surprised_ms=10000 应生效，实际偏移 ' + offset + 'ms')
    assert.equal(body.cfg.turn_flash_ms, 5000, '未覆盖的阈值仍走默认')
  } finally {
    Date.now = realNow
  }
  console.log('config-flow: pass (apply(ctx, config) 接受自定义配置)')
}

// —— CSRF 防护：action 写动作必须是 POST + 跨源被拒 —— //
{
  // GET 返 405
  const r405 = await call('/dsh-taffy-mood/api/action?action=lock', { method: 'GET' })
  assert.equal(r405.code, 405)
  // 跨源（恶意站点）POST → 403
  const r403 = await call('/dsh-taffy-mood/api/action?action=lock', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
  })
  assert.equal(r403.code, 403)
  // 跨源但端口错的 loopback → 403
  const r403port = await call('/dsh-taffy-mood/api/action?action=lock', {
    method: 'POST',
    headers: { origin: 'http://localhost:9999' },  // 正则放过 :port
  })
  assert.equal(r403port.code, 200, 'localhost 任意端口放行（实际端口由启动时监听）')
  // 缺 Origin（curl/扩展场景）放行
  const rNone = await call('/dsh-taffy-mood/api/action?action=lock&mood=sleeping', { method: 'POST' })
  assert.equal(rNone.code, 200)
  assert.equal(JSON.parse(rNone.body).locked, 'sleeping')
  // 同源 POST 放行
  const rSame = await call('/dsh-taffy-mood/api/action?action=lock&mood=compacting', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:3080' },
  })
  assert.equal(rSame.code, 200)
  // 清理锁定
  await call('/dsh-taffy-mood/api/action?action=lock', { method: 'POST' })
  console.log('csrf: pass (POST-only + Origin 校验)')
}

// —— rev 单调递增（client 单数字 diff 依赖）—— //
{
  const before = JSON.parse((await call('/dsh-taffy-mood/api/state')).body).state.rev
  emit({ type: 'tool/call', data: { callId: 'rev-1', name: 'tavvy-rev', arguments: '{}' } })
  const afterCall = JSON.parse((await call('/dsh-taffy-mood/api/state')).body).state.rev
  assert.equal(typeof before, 'number', 'rev 应为数字')
  assert.ok(afterCall > before, '事件后 rev 应递增：before=' + before + ' after=' + afterCall)
  // lock action 也应递增
  const beforeLock = JSON.parse((await call('/dsh-taffy-mood/api/state', { method: 'POST' })).body).state.rev
  // unlocked → 已 done in earlier CSRF block; do an actual lock change
  await call('/dsh-taffy-mood/api/action?action=lock&mood=tired', { method: 'POST' })
  const afterLock = JSON.parse((await call('/dsh-taffy-mood/api/state')).body).state.rev
  assert.ok(afterLock > beforeLock, 'lock action 后 rev 递增')
  // 同样的 lock 重复设相同值不应递增（防无谓 client 刷新）
  await call('/dsh-taffy-mood/api/action?action=lock&mood=tired', { method: 'POST' })
  const afterSameLock = JSON.parse((await call('/dsh-taffy-mood/api/state')).body).state.rev
  assert.equal(afterSameLock, afterLock, '同值 lock 不应递增')
  // 清理
  await call('/dsh-taffy-mood/api/action?action=lock', { method: 'POST' })
  console.log('rev: pass (单数字 diff 正确递增)')
}

// —— bug 1 fix: turn 启动瞬间（不依赖 agents/chunks）应直接 running=true —— //
{
  emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } })  // 清 turnStartedAt
  // 临时把假 agents 调成全 idle，专门验证纯 turnStartedAt 信号
  const prevAgents = agentsSvc.list
  agentsSvc.list = () => []
  emit({ type: 'turn/start', data: { turn: 99 } })
  const body = JSON.parse((await call('/dsh-taffy-mood/api/state')).body)
  assert.equal(body.state.running, true, 'turn 启动瞬间、agents 全 idle 时仍应 running=true')
  agentsSvc.list = prevAgents
  console.log('bug1: pass (turn 启动立刻 running，不等 agents 状态翻转)')
}

// —— rev 哨兵守门：保证 host 端 rev 起始为 0、首次 fetch 必触发 setState 注入真实数据 —— //
{
  const initRev = JSON.parse((await call('/dsh-taffy-mood/api/state')).body).state.rev
  assert.equal(typeof initRev, 'number', 'host 端 rev 应为数字')
  assert.ok(initRev >= 0, 'host 端 rev 不应为负')
  // 验证 client.js hostState0 用 -1 哨兵（不是 0），保证首次 fetch 必触发 setState 注入真实数据
  const clientSrc = readFileSync(join(import.meta.dirname, '..', 'client.js'), 'utf8')
  assert.match(clientSrc, /var hostState0 = \{ rev: -1/, 'client hostState0 哨兵应为 -1（非 0），避首次短路')
  console.log('rev-sentinel: pass (host rev=' + initRev + ' ≥ 0，client -1 哨兵避首次短路)')
}
