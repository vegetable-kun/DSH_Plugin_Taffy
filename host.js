// dsh-taffy-mood —— Host 半边：表情状态机（session/event 审计 + 包内素材路由 + JSON API + SSE）
// 状态机逻辑与动态插件版一致；素材随包分发，经 /dsh-taffy-mood/assets/ 提供；
// 浏览器半边通过 /dsh-taffy-mood/api/* 订阅 SSE + 提交动作（whale-musume 模式）。
//
// 文件分区（P2.8）：
//   A. 常量与白名单
//   B. buildCfg — 配置合并
//   C. buildAssetHashes — 素材哈希 + LRU 缓存
//   D. SSE 总线工厂
//   E. 路由 handler 拆分（state / action / asset / asset-index / events）
//   F. apply(ctx, config) — 组合所有模块

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ════════════════════════════════════════════════════════════════════
// A. 常量与白名单
// ════════════════════════════════════════════════════════════════════
export const name = 'dsh-taffy-mood'
export const inject = ['webServer']

const ASSETS_DIR = fileURLToPath(new URL('./assets/', import.meta.url))
const ROUTE_BASE = '/dsh-taffy-mood'

const ASSET_TYPES = new Map([
  ['taffy-fork.gif', 'image/gif'],
  ['taffy-embarrassing.gif', 'image/gif'],
  ['taffy-spread_heart.gif', 'image/gif'],
  ['taffy-hacker.gif', 'image/gif'],
  ['taffy-tang-laughing.gif', 'image/gif'],
  ['taffy-dumb.gif', 'image/gif'],
  ['taffy-se_xy.gif', 'image/gif'],
  ['taffy-angry.gif', 'image/gif'],
  ['taffy-suicide.gif', 'image/gif'],
  ['taffy2-idling.gif', 'image/gif'],
  ['taffy-suprised.gif', 'image/gif'],
  ['taffy-cry.gif', 'image/gif'],
  ['taffy-begging.gif', 'image/gif'],
  ['taffy-admirable.gif', 'image/gif'],
  ['taffy-fake_crying.gif', 'image/gif'],
  ['taffy-cry_denying.gif', 'image/gif'],
  ['tafei.jpg', 'image/jpeg'],
  ['tafei3.jpg', 'image/jpeg'],
  ['taffy4.jpg', 'image/jpeg'],
  ['taffy-angry_staring.jpg', 'image/jpeg'],
  ['taffy-pressure.jpg', 'image/jpeg'],
  ['taffy-staring.jpg', 'image/jpeg'],
  ['taffy-underwear.jpg', 'image/jpeg'],
])

// ════════════════════════════════════════════════════════════════════
// B. buildCfg — 配置合并
// ════════════════════════════════════════════════════════════════════
// 阈值可由 cordis.patch.yml 的 config 字段覆盖（snake_case + 默认兜底）
// 字段对应见 README；未传保持原默认值不变
function buildCfg(config) {
  const cfg = {
    surprised_ms: 4000,
    turn_flash_ms: 5000,
    crying_ms: 6000,
    admirable_ms: 4000,
    begging_window_ms: 60000,
    begging_show_ms: 5000,
    compacting_failsafe_ms: 90000,
    tired_after_ms: 3 * 60 * 1000,
    ignored_after_ms: 30 * 1000,
    sleep_after_ms: 10 * 60 * 1000,
    // P1.5：用户按回车到 first chunk 之间也算工作中，cordis.patch.yml 可覆盖
    user_message_run_ms: 6 * 1000,
  }
  if (config && typeof config === 'object') {
    for (const k of Object.keys(cfg)) {
      const v = config[k]
      if (typeof v === 'number' && v > 0) cfg[k] = v
    }
  }
  return cfg
}

// ════════════════════════════════════════════════════════════════════
// C. buildAssetHashes — 启动期算 SHA256,响应期按需 readFile + LRU
// ════════════════════════════════════════════════════════════════════
async function buildAssetHashes() {
  // 内容哈希：启动时为每个允许分发的素材算 SHA256 截 8 hex
  // URL 形如 /assets/<basename>.<hash>.<ext>，命中走 1 年强缓存
  const assetHashes = new Map()  // name -> 8 hex
  const hashedUrl = (name) => {
    const h = assetHashes.get(name)
    if (!h) return null
    const dot = name.lastIndexOf('.')
    if (dot <= 0) return null
    return '/assets/' + name.slice(0, dot) + '.' + h + name.slice(dot)
  }
  // P1.6：不再一次性把所有素材 bytes 驻留内存（17MB+ 全部常驻）
  // 启动只算 hash 需要的 bytes 即用即丢；响应时按需 readFile，
  // 命中本进程 LRU 缓存（容量受 MAX_BYTES_CACHE 控制）。
  const MAX_BYTES_CACHE = 6 * 1024 * 1024  // 6MB 上限；典型一次请求 1-2 张图
  const bytesByHash = new Map()  // h -> { bytes: Uint8Array, size: number }
  let bytesCacheBytes = 0
  const cachedRead = async (hash, file) => {
    const hit = bytesByHash.get(hash)
    if (hit !== undefined) {
      bytesByHash.delete(hash)
      bytesByHash.set(hash, hit)
      return hit.bytes
    }
    const bytes = await readFile(file)
    const entry = { bytes, size: bytes.length }
    bytesByHash.set(hash, entry)
    bytesCacheBytes += entry.size
    while (bytesCacheBytes > MAX_BYTES_CACHE) {
      const oldestKey = bytesByHash.keys().next().value
      const oldest = bytesByHash.get(oldestKey)
      bytesByHash.delete(oldestKey)
      bytesCacheBytes -= oldest.size
    }
    return bytes
  }
  await Promise.all(Array.from(ASSET_TYPES.keys()).map(async (name) => {
    try {
      const bytes = await readFile(join(ASSETS_DIR, name))
      const h = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
      assetHashes.set(name, h)
    } catch (err) {
      // 缺失素材：跳过即可，路由返 404
    }
  }))
  return { assetHashes, hashedUrl, cachedRead }
}

// ════════════════════════════════════════════════════════════════════
// D. SSE 总线工厂
// ════════════════════════════════════════════════════════════════════
// 用 Set 持有 res,断开时由 close handler 移除；heartbeat 防止代理/浏览器 idle timeout
function buildSSEBus(snapshot) {
  const clients = new Set()
  const SSE_HEARTBEAT_MS = 25 * 1000
  let heartbeatTimer = null

  const writeEvent = (res, payload) => {
    try { res.write('data: ' + JSON.stringify(payload) + '\n\n') } catch { /* 写失败:下次心跳清理 */ }
  }
  const sendFirstFrame = (res, snap) => writeEvent(res, { type: 'state', state: snap })
  const broadcast = () => {
    const snap = snapshot()
    for (const res of Array.from(clients)) writeEvent(res, { type: 'state', state: snap })
  }
  const ensureHeartbeat = () => {
    if (heartbeatTimer !== null || clients.size === 0) return
    heartbeatTimer = setInterval(() => {
      for (const res of Array.from(clients)) {
        try { res.write(': keepalive\n\n') } catch { clients.delete(res) }
      }
    }, SSE_HEARTBEAT_MS)
  }
  const maybeStopHeartbeat = () => {
    if (clients.size === 0 && heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }
  const addClient = (res) => {
    clients.add(res)
    ensureHeartbeat()
  }
  const removeClient = (res) => {
    if (!clients.has(res)) return
    clients.delete(res)
    maybeStopHeartbeat()
    try { res.end() } catch { /* 已关闭 */ }
  }
  const isEmpty = () => clients.size === 0

  return { broadcast, addClient, removeClient, isEmpty, sendFirstFrame }
}

// ════════════════════════════════════════════════════════════════════
// E. 路由 handler 拆分
// ════════════════════════════════════════════════════════════════════
// 共享辅助
const isLoopbackOrigin = (origin) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)

function sendJson(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}
function sendText(res, code, text, extraHeaders) {
  res.writeHead(code, { 'Content-Type': 'text/plain', ...(extraHeaders || {}) })
  res.end(text)
}

// handleState: GET /api/state
function handleState(res, snapshot) {
  sendJson(res, { ok: true, state: snapshot() })
}

// handleSSE: GET /api/events (P1.7)
function handleSSE(req, res, sseBus, snapshot) {
  // 同源 EventSource 自动带 cookie/Origin,通过 CORS 校验等同 loopback origin
  const origin = req.headers && req.headers.origin
  if (origin !== undefined && origin !== null && !isLoopbackOrigin(origin)) {
    return sendText(res, 403, 'origin not allowed')
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    'Connection': 'keep-alive',
    // 防止 nginx 等代理缓冲
    'X-Accel-Buffering': 'no',
  })
  // 立即推送 snapshot 作为首帧（新连接必须拿到一份初始状态）
  sseBus.sendFirstFrame(res, snapshot())
  sseBus.addClient(res)
  const onClose = () => sseBus.removeClient(res)
  req.on('close', onClose)
  req.on('aborted', onClose)
}

// handleAction: POST /api/action (CSRF 保护)
async function handleAction(req, url, runAction) {
  // 写动作严格 POST-only + Origin 校验
  const method = String(req.method || 'GET').toUpperCase()
  if (method !== 'POST') return { status: 405, text: 'method not allowed', allow: 'POST' }
  const origin = req.headers && req.headers.origin
  // Origin 缺省（curl/扩展）放行；非缺省时必须匹配 loopback
  if (origin !== undefined && origin !== null && !isLoopbackOrigin(origin)) {
    return { status: 403, text: 'origin not allowed' }
  }
  const result = await runAction(url.searchParams.get('action'), url.searchParams.get('mood'))
  if (result === null) return { status: 404, text: 'unknown action' }
  return { status: 200, json: result }
}

// handleAsset: GET /assets/<name>[.<hash>.<ext>]
// path 应是已剥离 ROUTE_BASE 的局部路径,如 /assets/<name>
async function handleAsset(path, assetHashes, hashedUrl, cachedRead) {
  const requestName = decodeURIComponent(path.slice('/assets/'.length).split('?')[0])
  // 形式 1：带哈希的 URL /assets/<base>.<hash>.<ext>
  //   base 含 .jpg/.gif 前的全部点也算进去（用 lastIndexOf 切第二段为 hash）
  const dotExt = requestName.lastIndexOf('.')
  if (dotExt > 0) {
    const beforeExt = requestName.slice(0, dotExt)
    const ext = requestName.slice(dotExt)
    const dotHash = beforeExt.lastIndexOf('.')
    if (dotHash > 0) {
      const baseName = beforeExt.slice(0, dotHash) + ext
      const hash = beforeExt.slice(dotHash + 1)
      if (ASSET_TYPES.has(baseName) && /^[0-9a-f]{8}$/.test(hash)) {
        // P1.6：按需 readFile + LRU 缓存（命中重复请求不再读盘）
        const file = join(ASSETS_DIR, baseName)
        const bytes = await cachedRead(hash, file)
        if (bytes) {
          return {
            status: 200,
            headers: {
              'Content-Type': ASSET_TYPES.get(baseName),
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Content-Length': String(bytes.length),
            },
            body: bytes,
          }
        }
      }
    }
  }
  // 形式 2：老的无哈希 URL → 301 跳转到带哈希 URL（永久）
  if (ASSET_TYPES.has(requestName)) {
    const target = hashedUrl(requestName)
    if (target) return { status: 301, location: target, cacheControl: 'public, max-age=300' }
  }
  return { status: 404, text: 'not found' }
}

// handleAssetIndex: GET /api/asset-index
function handleAssetIndex(res, assetHashes) {
  // 启动时算好的 {name: hash} 映射表；client 拉一次拼 GIFS url
  const idx = {}
  for (const [name, h] of assetHashes) {
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    idx[name] = base + '.' + h + ext
  }
  sendJson(res, idx)
}

// ════════════════════════════════════════════════════════════════════
// F. apply(ctx, config) — 组合所有模块
// ════════════════════════════════════════════════════════════════════
export async function apply(ctx, config) {
  const cfg = buildCfg(config)
  const { assetHashes, hashedUrl, cachedRead } = await buildAssetHashes()

  // ── F.1 状态机 ──
  const state = {
    approvalPending: 0,
    lastApproval: null,
    lastApprovalAt: 0,
    approvalSessionId: null,
    // 正在跟踪的 session：每个 tool/call / user/message / approval/asked 出现时锁定；
    // turn/end 时清零。'running' / 'consecutiveRejects' 只对当前 session 计数，
    // 跨 session 不再串味（P0.1+P0.3）。
    activeSessionId: null,
    turnFlash: null,
    turnFlashAt: 0,
    toolActive: 0,
    lastChunkAt: 0,
    locked: null,
    surprisedUntil: 0,
    cryingUntil: 0,
    admirableUntil: 0,
    consecutiveRejects: 0,
    turnToolCalls: 0,
    askPending: false,
    askCallId: null,
    lastAskedAt: 0,
    beggingUntil: 0,
    compactingUntil: 0,
    turnStartedAt: 0,
    approvalFirstAskedAt: 0,
    lastActivityAt: Date.now(),
    userMessageAt: 0,
    rev: 0,
  }

  // 关键阈值：从 cfg 读取（P1.5：cordis.patch.yml 可覆盖）
  const USER_MESSAGE_RUN_MS = cfg.user_message_run_ms
  const TIRED_AFTER_MS = cfg.tired_after_ms
  const IGNORED_AFTER_MS = cfg.ignored_after_ms
  const SLEEP_AFTER_MS = cfg.sleep_after_ms
  const lockable = new Set([
    'idle', 'thinking', 'tool', 'hacker', 'celebrate', 'rejected', 'angry', 'suicide',
    'surprised', 'crying', 'begging', 'admirable', 'fake_crying', 'waiting',
    'compacting', 'tired', 'ignoredApproval', 'sleeping', 'greeting',
  ])

  // ── F.2 session 事件处理 + adoptSession ──
  const sessionIdOf = (session) => {
    try { return session && session.id ? String(session.id) : null } catch { return null }
  }
  const adoptSession = (sid) => {
    if (!sid) return
    if (state.activeSessionId === sid) return
    state.activeSessionId = sid
    state.consecutiveRejects = 0
    state.rev += 1
  }
  // 启动时一次性基线：扫 agents 列表，把任何 running 的 agent 的 sessionId
  // 锁定为 activeSessionId。后续 'running' 信号完全走 session/event 派生的本地状态
  // (P0.2：移除 computeRunning 后的兜底)。
  try {
    const agents = ctx.get('agents')
    if (agents && typeof agents.list === 'function') {
      const running = agents.list().find((a) => {
        try { return a && a.status === 'running' } catch { return false }
      })
      const sid = running && running.session ? sessionIdOf(running.session) : null
      if (sid) {
        state.activeSessionId = sid
        if (state.turnStartedAt === 0) state.turnStartedAt = Date.now()
        state.lastActivityAt = Date.now()
      }
    }
  } catch { /* agents 不可用时降级为纯事件驱动 */ }

  // ── F.3 snapshot ──
  const snapshot = () => {
    let phase = 'wait'
    if (state.toolActive > 0) phase = 'tool'
    else if (Date.now() - state.lastChunkAt < 2000) phase = 'stream'
    const running = state.toolActive > 0
      || state.turnStartedAt > 0
      || (state.userMessageAt > 0 && Date.now() - state.userMessageAt < USER_MESSAGE_RUN_MS)
      || phase === 'stream'
    return {
      running,
      phase,
      approvalPending: state.approvalPending > 0,
      lastApproval: state.lastApproval,
      lastApprovalAt: state.lastApprovalAt,
      turnFlash: state.turnFlash,
      turnFlashAt: state.turnFlashAt,
      locked: state.locked,
      surprisedUntil: state.surprisedUntil,
      cryingUntil: state.cryingUntil,
      admirableUntil: state.admirableUntil,
      waitingAnswer: state.askPending,
      beggingUntil: state.beggingUntil,
      compacting: state.compactingUntil > Date.now(),
      tired: state.turnStartedAt > 0 && Date.now() - state.turnStartedAt > TIRED_AFTER_MS,
      ignoredApproval: state.approvalPending > 0 && state.approvalFirstAskedAt > 0 && Date.now() - state.approvalFirstAskedAt > IGNORED_AFTER_MS,
      sleeping: Date.now() - state.lastActivityAt > SLEEP_AFTER_MS,
      cfg: {
        turn_flash_ms: cfg.turn_flash_ms,
        user_message_run_ms: cfg.user_message_run_ms,
      },
      rev: state.rev,
    }
  }

  // SSE 总线:rev++ 时广播,writeEvent 在 broadcast 内调用
  const sseBus = buildSSEBus(snapshot)

  // ── F.4 session/event 包装层 ──
  ctx.effect(() => {
    const inner = (session, event) => {
      if (!event || typeof event.type !== 'string') return
      state.lastActivityAt = Date.now()
      const sid = sessionIdOf(session)
      if (sid && state.activeSessionId === null) state.activeSessionId = sid

      if (event.type === 'assistant/chunk') {
        state.lastChunkAt = Date.now()
        return
      }
      if (event.type === 'tool/call') {
        if (sid) adoptSession(sid)
        state.toolActive += 1
        state.turnToolCalls += 1
        if (state.turnStartedAt === 0) state.turnStartedAt = Date.now()
        if (event.data && event.data.name === 'ask_user_question') {
          state.askCallId = event.data.callId || null
          state.askPending = true
        }
        return
      }
      if (event.type === 'tool/result') {
        state.toolActive = Math.max(0, state.toolActive - 1)
        const tid = event.data && event.data.message && event.data.message.toolCallId
        if (state.askPending && tid && state.askCallId === tid) {
          state.askPending = false
          state.askCallId = null
        }
        return
      }
      if (event.type === 'user/message') {
        if (sid) adoptSession(sid)
        state.userMessageAt = Date.now()
        if (state.askPending) {
          state.askPending = false
          state.askCallId = null
          return
        }
        const busy = state.toolActive > 0 || Date.now() - state.lastChunkAt < 2500
        if (busy) state.surprisedUntil = Date.now() + cfg.surprised_ms
        return
      }
      if (event.type === 'approval/asked') {
        if (sid) adoptSession(sid)
        state.approvalPending += 1
        if (state.approvalPending === 1) state.approvalFirstAskedAt = Date.now()
        if (sid) state.approvalSessionId = sid
        const t = Date.now()
        if (t - state.lastAskedAt < cfg.begging_window_ms) state.beggingUntil = t + cfg.begging_show_ms
        state.lastAskedAt = t
        return
      }
      if (event.type === 'compaction/start') {
        state.compactingUntil = Date.now() + cfg.compacting_failsafe_ms
        return
      }
      if (event.type === 'compaction/end' || event.type === 'compaction/summary' || event.type === 'compaction/prune') {
        state.compactingUntil = 0
        return
      }
      if (event.type === 'approval/decided') {
        state.approvalPending = Math.max(0, state.approvalPending - 1)
        if (state.approvalPending === 0) state.approvalFirstAskedAt = 0
        const outcome = event.data && event.data.outcome
        if (outcome === 'allowed-once' || outcome === 'rejected') {
          state.lastApproval = outcome
          state.lastApprovalAt = Date.now()
          if (sid) state.approvalSessionId = sid
        }
        if (outcome === 'rejected') {
          state.consecutiveRejects += 1
          if (state.consecutiveRejects >= 2) {
            state.turnFlash = 'fake-crying'
            state.turnFlashAt = Date.now()
            state.consecutiveRejects = 0
          }
        } else if (outcome === 'allowed-once') {
          state.consecutiveRejects = 0
        }
        return
      }
      if (event.type === 'turn/start') {
        state.turnStartedAt = Date.now()
        return
      }
      if (event.type === 'turn/end') {
        state.toolActive = 0
        state.turnStartedAt = 0
        state.askPending = false
        state.askCallId = null
        state.compactingUntil = 0
        if (sid && state.approvalSessionId === sid && state.lastApproval === 'allowed-once') {
          state.lastApproval = null
          state.approvalSessionId = null
        }
        if (sid && state.activeSessionId === sid) {
          if (state.consecutiveRejects >= 2) {
            state.turnFlash = 'fake-crying'
            state.turnFlashAt = Date.now()
          }
          state.activeSessionId = null
          state.consecutiveRejects = 0
        }
        const reason = event.data && event.data.reason
        const kind = reason && reason.kind
        if (kind === 'aborted') {
          state.turnFlash = 'aborted'
          state.turnFlashAt = Date.now()
        } else if (kind === 'error' || kind === 'max-tokens') {
          state.turnFlash = kind
          state.turnFlashAt = Date.now()
        } else if (kind === 'blocked') {
          state.cryingUntil = Date.now() + cfg.crying_ms
        } else if (kind === 'completed' && state.turnToolCalls >= 5) {
          state.admirableUntil = Date.now() + cfg.admirable_ms
        }
        state.turnToolCalls = 0
        return
      }
    }
    // 包装层：每次事件后 rev++,P1.7 向 SSE 客户端广播
    return ctx.on('session/event', (session, event) => {
      inner(session, event)
      state.rev += 1
      if (!sseBus.isEmpty()) sseBus.broadcast()
    })
  })

  // ── F.5 action 处理 ──
  const runAction = async (action, moodValue) => {
    switch (action) {
      case 'lock':
        if (moodValue === null || moodValue === undefined || moodValue === '') {
          if (state.locked !== null) state.rev += 1
          state.locked = null
          if (!sseBus.isEmpty()) sseBus.broadcast()
          return { ok: true, locked: null }
        }
        if (typeof moodValue === 'string' && lockable.has(moodValue)) {
          if (state.locked !== moodValue) state.rev += 1
          state.locked = moodValue
          if (!sseBus.isEmpty()) sseBus.broadcast()
          return { ok: true, locked: state.locked }
        }
        return { ok: false, message: 'unknown mood: ' + String(moodValue) }
      case 'clear-rejected':
        if (state.lastApproval === 'rejected') {
          state.lastApproval = null
          state.approvalSessionId = null
        }
        return { ok: true }
      case 'test-approve': {
        try {
          const agents = ctx.get('agents')
          const approval = ctx.get('approval')
          if (!agents || !approval || typeof agents.list !== 'function') return { ok: false, message: 'agents 或 approval 服务不可用' }
          const pick = agents.list().find((a) => {
            try { return a.status === 'running' && a.session } catch { return false }
          })
          if (!pick) return { ok: false, message: '没有运行中的 agent——请在对话进行时点击' }
          // DSH approval.request() 现在要求 open turn 前置（user-approval@latest），
          // 拒绝发生在函数体头部，被包装成 rejected Promise：必须 await 才能拿到 message。
          const outcome = await approval.request({
            agent: pick,
            toolName: 'taffy-test-approve',
            reason: 'Taffy 测试审批：点同意看 fork→spread_heart→hacker，拒绝看 embarrassing',
          })
          return { ok: true, message: '测试审批卡片已弹出（outcome=' + String(outcome) + '），请到对话里处理' }
        } catch (error) {
          return { ok: false, message: String(error?.message ?? error) }
        }
      }
      default:
        return null
    }
  }

  // ── F.6 路由注册 ──
  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_BASE,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        // 兼容 prefix 路由是否带前缀两种回调形态
        let path = url.pathname
        if (path.startsWith(ROUTE_BASE)) path = path.slice(ROUTE_BASE.length) || '/'

        if (path === '/api/state') return handleState(res, snapshot)
        if (path === '/api/events') return handleSSE(req, res, sseBus, snapshot)
        if (path === '/api/action') {
          const result = await handleAction(req, url, runAction)
          if (result.json !== undefined) sendJson(res, result.json)
          else sendText(res, result.status, result.text, result.allow ? { Allow: result.allow } : {})
          return
        }
        if (path === '/api/asset-index') return handleAssetIndex(res, assetHashes)

        const assetPrefix = '/assets/'
        if (path.startsWith(assetPrefix)) {
          const result = await handleAsset(path, assetHashes, hashedUrl, cachedRead)
          if (result.body !== undefined) {
            res.writeHead(result.status, result.headers)
            res.end(result.body)
          } else if (result.location !== undefined) {
            res.writeHead(result.status, { Location: result.location, 'Cache-Control': result.cacheControl })
            res.end()
          } else {
            sendText(res, result.status, result.text)
          }
          return
        }

        sendText(res, 404, 'not found')
      } catch (error) {
        sendText(res, 500, String(error?.message ?? error))
      }
    },
  })
  ctx.effect(() => () => disposeRoute())
}