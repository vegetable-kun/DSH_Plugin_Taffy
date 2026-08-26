// 冒烟测试：假 ctx 跑 apply，断言事件状态机与三条路由。node test/smoke.mjs
import assert from 'node:assert/strict'
import { apply } from '../host.js'

function makeFakeRes() {
  const res = {
    code: null,
    type: null,
    body: null,
    chunks: [],
    writeHead(code, headers) {
      this.code = code
      this.type = headers && headers['Content-Type']
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

async function call(url) {
  const res = makeFakeRes()
  await handler({ url }, res)
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
  const ok = JSON.parse((await call('/dsh-taffy-mood/api/action?action=lock&mood=crying')).body)
  assert.deepEqual(ok, { ok: true, locked: 'crying' })
  const bad = await call('/dsh-taffy-mood/api/action?action=lock&mood=hax')
  assert.equal(bad.code, 200)
  assert.equal(JSON.parse(bad.body).ok, false)
  const unlocked = JSON.parse((await call('/dsh-taffy-mood/api/action?action=lock')).body)
  assert.deepEqual(unlocked, { ok: true, locked: null })
  const unknownAction = await call('/dsh-taffy-mood/api/action?action=nope')
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
await call('/api/action?action=clear-rejected')
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
  const res = await call('/api/action?action=test-approve')
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

// —— 素材路由 —— //
{
  const res = await call('/dsh-taffy-mood/assets/taffy-cry.gif')
  assert.equal(res.code, 200)
  assert.match(res.type, /image\/gif/)
  assert.ok(res.chunks[0].length > 1000, 'GIF 字节非空')
  const jpg = await call('/dsh-taffy-mood/assets/taffy-staring.jpg')
  assert.equal(jpg.code, 200)
  assert.match(jpg.type, /image\/jpeg/)
  const missing = await call('/dsh-taffy-mood/assets/not-on-list.gif')
  assert.equal(missing.code, 404)
  const traversal = await call('/dsh-taffy-mood/assets/../host.js')
  assert.equal(traversal.code, 404, '白名单外路径一律 404')
  const unknown = await call('/dsh-taffy-mood/nothing')
  assert.equal(unknown.code, 404)
}

console.log('smoke: all assertions passed (' + routes.length + ' route, ' + eventHandlers.length + ' listener)')
