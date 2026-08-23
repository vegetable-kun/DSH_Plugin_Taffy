// Taffy 表情包状态机 — Host 半边（DeepSeek Harness 动态 Cordis Plugin）
// 用法：将本文件除本注释外的全部内容，粘贴到 cordis_define 的 code.host 字段。
// 依赖素材目录：/home/ecs-assist-user/taffy-gif/（见仓库 assets/，按 README 放置）

return {
  apply(ctx) {
    const fs = ctx.get('fs')
    const webServer = ctx.get('webServer')
    if (fs === undefined || webServer === undefined) {
      console.error('[taffy] missing fs or webServer service')
      return
    }
    const allowed = new Set(['taffy-fork.gif', 'taffy-embarrassing.gif', 'taffy-spread_heart.gif', 'taffy-hacker.gif', 'taffy-tang-laughing.gif', 'taffy-dumb.gif', 'taffy-se_xy.gif', 'taffy-angry.gif', 'taffy-suicide.gif', 'taffy2-idling.gif', 'taffy-suprised.gif', 'taffy-cry.gif', 'taffy-begging.gif', 'taffy-admirable.gif', 'taffy-fake_crying.gif'])
    const cache = {}
    const dir = '/home/ecs-assist-user/taffy-gif/'
    const cfgPath = dir + 'taffy-config.json'
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/taffy-gif',
      handler: async (req, res) => {
        try {
          const raw = String(req.url || '')
          const q = raw.indexOf('?')
          const path = q === -1 ? raw : raw.slice(0, q)
          const name = decodeURIComponent(path.slice('/taffy-gif/'.length))
          if (!allowed.has(name)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('not found')
            return
          }
          if (cache[name] === undefined) {
            const target = await fs.resolve(dir + name)
            cache[name] = await fs.readBytes(target, undefined, 10 * 1024 * 1024)
          }
          res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' })
          res.end(cache[name])
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end(String(e && e.message ? e.message : e))
        }
      },
    }), 'taffy-gif-route')
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
      beggingUntil: 0,
      lastAskedAt: 0,
      consecutiveRejects: 0,
      turnToolCalls: 0,
    }
    const lockable = new Set(['idle', 'thinking', 'tool', 'hacker', 'celebrate', 'rejected', 'angry', 'suicide', 'surprised', 'crying', 'begging', 'admirable', 'fake_crying'])
    const sessionIdOf = (session) => {
      try { return session && session.id ? String(session.id) : null } catch (e) { return null }
    }
    const computeRunning = () => {
      try {
        const agents = ctx.get('agents')
        if (!agents || typeof agents.list !== 'function') return 0
        return agents.list().filter((a) => {
          try { return a.status === 'running' } catch (e) { return false }
        }).length
      } catch (e) {
        return 0
      }
    }
    ctx.effect(() => ctx.on('session/event', (session, event) => {
      if (!event || typeof event.type !== 'string') return
      const sid = sessionIdOf(session)
      if (event.type === 'assistant/chunk') {
        state.lastChunkAt = Date.now()
        return
      }
      if (event.type === 'tool/call') {
        state.toolActive += 1
        state.turnToolCalls += 1
        return
      }
      if (event.type === 'tool/result') {
        state.toolActive = Math.max(0, state.toolActive - 1)
        return
      }
      if (event.type === 'user/message') {
        // 插话判定：只有模型真的在输出/干活时才算；新轮次启动瞬间两者皆为否，
        // 因此普通发消息不会误报。
        const busy = state.toolActive > 0 || Date.now() - state.lastChunkAt < 2500
        if (busy) {
          state.surprisedUntil = Date.now() + 4000
        }
        return
      }
      if (event.type === 'approval/asked') {
        state.approvalPending += 1
        if (sid) state.approvalSessionId = sid
        const t = Date.now()
        if (t - state.lastAskedAt < 60000) {
          state.beggingUntil = t + 5000
        }
        state.lastAskedAt = t
        return
      }
      if (event.type === 'approval/decided') {
        state.approvalPending = Math.max(0, state.approvalPending - 1)
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
      if (event.type === 'turn/end') {
        state.toolActive = 0
        // 批准后的 hacker 状态在对话完成时结束；rejected 跨轮次存活、只被打字消费。
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
    }), 'taffy-session-log-listener')
    harness.handle('taffy-get-config', async () => {
      try {
        const target = await fs.resolve(cfgPath)
        const text = await fs.readText(target)
        const config = JSON.parse(text)
        return { ok: true, config }
      } catch (e) {
        return { ok: false }
      }
    })
    harness.handle('taffy-save-config', async (args) => {
      try {
        const clean = {
          enabled: !!(args && args.enabled),
          size: Math.min(1000, Math.max(50, Number(args && args.size) || 150)),
          opacity: Math.min(1, Math.max(0.1, Number(args && args.opacity) || 0.8)),
          passThrough: !!(args && args.passThrough),
          x: args && args.x === null ? null : Math.max(0, Number(args && args.x) || 0),
          y: args && args.y === null ? null : Math.max(0, Number(args && args.y) || 0),
        }
        const target = await fs.resolve(cfgPath)
        await fs.writeText(target, JSON.stringify(clean))
        return { ok: true }
      } catch (e) {
        return { ok: false, message: String(e && e.message ? e.message : e) }
      }
    })
    harness.handle('taffy-clear-approval', async () => {
      if (state.lastApproval === 'rejected') {
        state.lastApproval = null
        state.approvalSessionId = null
      }
      return null
    })
    harness.handle('taffy-lock', async (args) => {
      const v = args && args.mood
      if (v === null || v === undefined) state.locked = null
      else if (typeof v === 'string' && lockable.has(v)) state.locked = v
      return { locked: state.locked }
    })
    harness.handle('taffy-test-approve', async () => {
      try {
        const agents = ctx.get('agents')
        const approval = ctx.get('approval')
        if (!agents || !approval || typeof agents.list !== 'function') return { ok: false, message: 'agents 或 approval 服务不可用' }
        const list = agents.list()
        const pick = list.find((a) => {
          try { return a.status === 'running' && a.session } catch (e) { return false }
        })
        if (!pick) return { ok: false, message: '没有运行中的 agent——请在对话进行时点击' }
        approval.request({
          agent: pick,
          toolName: 'taffy-test-approve',
          reason: 'Taffy 测试审批：点同意看 fork→spread_heart→hacker，拒绝看 embarrassing',
        }).catch(() => {})
        return { ok: true, message: '测试审批卡片已弹出，请到对话里处理' }
      } catch (e) {
        return { ok: false, message: String(e && e.message ? e.message : e) }
      }
    })
    harness.handle('taffy-state', async () => {
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
      }
    })
  },
}
