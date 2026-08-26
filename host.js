// dsh-taffy-mood —— Host 半边：表情状态机（session/event 审计 + 包内素材路由 + JSON API）
// 状态机逻辑与动态插件版一致；素材随包分发，经 /dsh-taffy-mood/assets/ 提供；
// 浏览器半边通过 /dsh-taffy-mood/api/* 轮询状态、提交动作（whale-musume 模式）。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

export async function apply(ctx) {
  const cache = new Map()
  const state = {
    approvalPending: 0,
    lastApproval: null,
    lastApprovalAt: 0,
    approvalSessionId: null,
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
    // 等你回答：ask_user_question 挂起期间为 true；回答消息/结果配对/轮次结束三路清除
    askPending: false,
    askCallId: null,
    // 求饶窗口：60 秒内第二次审批请求时置 5 秒时间盒，过期自动回落到 fork
    lastAskedAt: 0,
    beggingUntil: 0,
    // 压缩记忆：compaction/start 置时间戳（含 90 秒兜底），end/summary/prune 归零
    compactingUntil: 0,
    // 长任务疲惫：本轮起点，超阈值后运行态改显疲惫（turn/end 清零）
    turnStartedAt: 0,
    // 审批没人理：首个审批挂起的时刻（pending 归零即清），超阈值改显 cry_denying
    approvalFirstAskedAt: 0,
    // 休眠：最近一次会话活动时刻，超阈值且无更高状态时切静态图省解码
    lastActivityAt: Date.now(),
  }
  const TIRED_AFTER_MS = 3 * 60 * 1000
  const IGNORED_AFTER_MS = 30 * 1000
  const SLEEP_AFTER_MS = 10 * 60 * 1000
  const lockable = new Set(['idle', 'thinking', 'tool', 'hacker', 'celebrate', 'rejected', 'angry', 'suicide', 'surprised', 'crying', 'begging', 'admirable', 'fake_crying', 'waiting', 'compacting', 'tired', 'ignoredApproval', 'sleeping', 'greeting'])

  const sessionIdOf = (session) => {
    try { return session && session.id ? String(session.id) : null } catch { return null }
  }

  // 运行检测直接扫注册表：事件计数会漏掉插件激活前已 running 的 agent。
  const computeRunning = () => {
    try {
      const agents = ctx.get('agents')
      if (!agents || typeof agents.list !== 'function') return 0
      return agents.list().filter((a) => {
        try { return a.status === 'running' } catch { return false }
      }).length
    } catch {
      return 0
    }
  }

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (!event || typeof event.type !== 'string') return
    // 任何会话活动都算"醒着"（chunk 高频但只是一次赋值，代价可忽略）
    state.lastActivityAt = Date.now()
    const sid = sessionIdOf(session)
    if (event.type === 'assistant/chunk') {
      state.lastChunkAt = Date.now()
      return
    }
    if (event.type === 'tool/call') {
      state.toolActive += 1
      state.turnToolCalls += 1
      // 插件中途激活会漏掉 turn/start：首个工具调用兜底补记本轮起点
      if (state.turnStartedAt === 0) state.turnStartedAt = Date.now()
      // 等你回答：ask_user_question 发出即挂起，直到回答消息/结果配对/轮次结束清除
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
      // 回答到达：消费提问态，不算插话（否则每次答题都误报惊讶）。
      if (state.askPending) {
        state.askPending = false
        state.askCallId = null
        return
      }
      // 插话判定：模型真的在输出/干活才算；新轮次刚启动两者皆为否，
      // 普通发消息不会误报。
      const busy = state.toolActive > 0 || Date.now() - state.lastChunkAt < 2500
      if (busy) state.surprisedUntil = Date.now() + 4000
      return
    }
    if (event.type === 'approval/asked') {
      state.approvalPending += 1
      if (state.approvalPending === 1) state.approvalFirstAskedAt = Date.now()
      if (sid) state.approvalSessionId = sid
      const t = Date.now()
      // 60 秒内第二次请求 → 5 秒求饶窗口；时间盒过期自动回落 fork，不会卡死。
      if (t - state.lastAskedAt < 60000) state.beggingUntil = t + 5000
      state.lastAskedAt = t
      return
    }
    if (event.type === 'compaction/start') {
      // 时间戳含 90 秒兜底：end 丢失也不会永久卡在压缩表情上。
      state.compactingUntil = Date.now() + 90000
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
      // 轮次结束兜底：提问挂起与压缩态一并清除，避免跨轮阻塞。
      state.askPending = false
      state.askCallId = null
      state.compactingUntil = 0
      // 批准后的 hacker 在对话完成时结束；rejected 跨轮存活、只被打字消费。
      if (sid && state.approvalSessionId === sid && state.lastApproval === 'allowed-once') {
        state.lastApproval = null
        state.approvalSessionId = null
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
        state.cryingUntil = Date.now() + 6000
      } else if (kind === 'completed' && state.turnToolCalls >= 5) {
        state.admirableUntil = Date.now() + 4000
      }
      state.turnToolCalls = 0
      return
    }
  }))

  const readAsset = async (name) => {
    if (!ASSET_TYPES.has(name)) return null
    if (!cache.has(name)) cache.set(name, await readFile(join(ASSETS_DIR, name)))
    return cache.get(name)
  }

  const snapshot = () => {
    let phase = 'wait'
    if (state.toolActive > 0) phase = 'tool'
    else if (Date.now() - state.lastChunkAt < 2000) phase = 'stream'
    return {
      running: computeRunning() > 0 || phase !== 'wait',
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
    }
  }

  const runAction = async (action, moodValue) => {
    switch (action) {
      case 'lock':
        if (moodValue === null || moodValue === undefined || moodValue === '') {
          state.locked = null
          return { ok: true, locked: null }
        }
        if (typeof moodValue === 'string' && lockable.has(moodValue)) {
          state.locked = moodValue
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
          approval.request({
            agent: pick,
            toolName: 'taffy-test-approve',
            reason: 'Taffy 测试审批：点同意看 fork→spread_heart→hacker，拒绝看 embarrassing',
          }).catch(() => {})
          return { ok: true, message: '测试审批卡片已弹出，请到对话里处理' }
        } catch (error) {
          return { ok: false, message: String(error?.message ?? error) }
        }
      }
      default:
        return null
    }
  }

  const sendJson = (res, value) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_BASE,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        // 兼容 prefix 路由是否带前缀两种回调形态。
        let path = url.pathname
        if (path.startsWith(ROUTE_BASE)) path = path.slice(ROUTE_BASE.length) || '/'
        if (path === '/api/state') {
          sendJson(res, { ok: true, state: snapshot() })
          return
        }
        if (path === '/api/action') {
          const result = await runAction(url.searchParams.get('action'), url.searchParams.get('mood'))
          if (result === null) {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('unknown action')
            return
          }
          sendJson(res, result)
          return
        }
        const assetPrefix = '/assets/'
        if (path.startsWith(assetPrefix)) {
          const assetName = decodeURIComponent(path.slice(assetPrefix.length).split('?')[0])
          const bytes = await readAsset(assetName)
          if (bytes === null) {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('not found')
            return
          }
          res.writeHead(200, { 'Content-Type': ASSET_TYPES.get(assetName), 'Cache-Control': 'no-store' })
          res.end(bytes)
          return
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(String(error?.message ?? error))
      }
    },
  })
  ctx.effect(() => () => disposeRoute())
}
