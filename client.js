// dsh-taffy-mood —— Client 半边：右下角表情 overlay + 浮动控制台 + 设置页
// 由 packages/client/modules 的 ClientModuleLoader 加载：
// 脚本执行只注册 factory；所有副作用（样式注入、slots、DOM）都在
// factory(require) 物化时发生，apply 返回的函数负责完整回收。
//
// 文件分区（P2.8）：
//   A. 常量与原语 (CSS / API / MOOD_ASSET / LOCKMOODS)
//   B. 状态机工厂 (buildMoodState, buildStatsState, buildSSEBus)
//   C. 工具 (loadAssetIndex, preloadImgs, api, postAction, act, delay)
//   D. 组件工厂 (buildTypingObserver, buildGifOverlay, buildSettingsPanel, buildToolConsole)
//   E. apply(ctx) 主流程 + dispose

window.__ModuleLoader__.load({
  id: 'dsh-taffy-mood',
  factory: (require) => {
    var React = require('react')

    // ════════════════════════════════════════════════════════════════════
    // A. 常量与原语
    // ════════════════════════════════════════════════════════════════════
    var SETTINGS_KEY = 'dsh-taffy-mood/settings'
    var API_BASE = '/dsh-taffy-mood/api'
    var ASSET_BASE = '/dsh-taffy-mood/assets/'
    // turn_flash 窗口时长：默认 5 秒；首次拿到 host snapshot.cfg 后被覆盖
    var TURN_FLASH_MS = 5000
    // 轮询节奏常量,工具卡片控制台 fallback 路径使用
    var POLL_ACTIVE_MS = 300
    var POLL_IDLE_MS = 2000

    // mood → asset 原始文件名；启动时拉 /api/asset-index 把 url 改成带哈希的版本（永久缓存）
    var MOOD_ASSET = {
      approval: 'taffy-fork.gif',
      rejected: 'taffy-embarrassing.gif',
      celebrate: 'taffy-spread_heart.gif',
      hacker: 'taffy-hacker.gif',
      running: 'taffy-tang-laughing.gif',
      thinking: 'taffy-dumb.gif',
      typing: 'taffy-se_xy.gif',
      angry: 'taffy-angry.gif',
      suicide: 'taffy-suicide.gif',
      idle: 'taffy2-idling.gif',
      surprised: 'taffy-suprised.gif',
      cry: 'taffy-cry.gif',
      begging: 'taffy-begging.gif',
      admirable: 'taffy-admirable.gif',
      fakeCrying: 'taffy-fake_crying.gif',
      waiting: 'taffy-staring.jpg',
      compacting: 'taffy-pressure.jpg',
      tired: 'taffy-angry_staring.jpg',
      ignoredApproval: 'taffy-cry_denying.gif',
      sleeping: 'taffy4.jpg',
      greeting: 'tafei.jpg',
    }
    var GIFS = {}
    for (var mk in MOOD_ASSET) GIFS[mk] = ASSET_BASE + MOOD_ASSET[mk]

    var LOCKMOODS = {
      idle: { label: '闲置' },
      thinking: { label: '思考中' },
      tool: { label: '工具执行中' },
      hacker: { label: '黑客' },
      celebrate: { label: '庆祝' },
      rejected: { label: '尴尬' },
      angry: { label: '生气' },
      suicide: { label: '自尽' },
      surprised: { label: '惊讶' },
      crying: { label: '哭' },
      begging: { label: '求饶' },
      admirable: { label: '得意' },
      fake_crying: { label: '假哭' },
      waiting: { label: '等你回答' },
      compacting: { label: '压缩记忆' },
      tired: { label: '长任务疲惫' },
      ignoredApproval: { label: '没人理' },
      sleeping: { label: '休眠' },
      greeting: { label: '打招呼' },
    }

    var CSS_TEXT = '.taffy-pulse{animation:taffyPulse 1.1s ease-in-out infinite}@keyframes taffyPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}.taffy-preload{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none}.taffy-set-row{display:flex;align-items:center;justify-content:space-between;margin:14px 0;gap:16px}.taffy-set-label{font-size:13px;font-weight:600}.taffy-set-hint{font-size:11px;opacity:.6;margin-top:2px}.taffy-set-input{width:180px}.taffy-drag-shield{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;cursor:grabbing}.taffy-close-shield{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100001}.taffy-panel{display:flex;flex-direction:column;gap:10px;padding:12px;border-top:1px solid rgba(128,128,128,.25);font-size:12px}.taffy-panel-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.taffy-panel-badge{display:inline-block;padding:2px 10px;border-radius:10px;background:#4f7cff;color:#fff;font-weight:600}.taffy-panel-badge.locked{background:#e67e22}.taffy-panel button{padding:4px 12px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;cursor:pointer;font-size:12px}.taffy-panel button.on{background:#4f7cff;color:#fff;border-color:#4f7cff}.taffy-panel-msg{opacity:.75;font-size:11px;min-height:14px}.taffy-menu{position:fixed;z-index:100002;background:rgba(30,30,36,.98);color:#eee;border:1px solid rgba(128,128,128,.35);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);min-width:250px;max-width:320px}.taffy-menu .taffy-panel{border-top:none;padding:10px}'

    // ════════════════════════════════════════════════════════════════════
    // B. 状态机工厂
    // ════════════════════════════════════════════════════════════════════

    // buildMoodState: 返回 mood 对象 + settings 持久化 + publish 订阅机制
    var buildMoodState = function () {
      var mood = {
        typing: false,
        rejected: false,
        enabled: true,
        size: 150,
        opacity: 0.8,
        passThrough: false,
        x: null,
        y: null,
      }
      var listeners = new Set()
      var saveTimer = null

      function publish() {
        listeners.forEach(function (fn) { fn() })
      }
      function loadSettings() {
        try {
          var raw = window.localStorage.getItem(SETTINGS_KEY)
          if (!raw) return
          var c = JSON.parse(raw)
          if (!c || typeof c !== 'object') return
          if (typeof c.enabled === 'boolean') mood.enabled = c.enabled
          if (typeof c.size === 'number' && c.size >= 50 && c.size <= 1000) mood.size = c.size
          if (typeof c.opacity === 'number' && c.opacity >= 0.1 && c.opacity <= 1) mood.opacity = c.opacity
          if (typeof c.passThrough === 'boolean') mood.passThrough = c.passThrough
          if ((c.x === null || typeof c.x === 'number') && (c.y === null || typeof c.y === 'number')) {
            mood.x = c.x
            mood.y = c.y
          }
        } catch (eSettingsLoad) { /* 损坏的本地设置按默认值处理 */ }
      }
      function saveNow() {
        saveTimer = null
        try {
          window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
            enabled: mood.enabled,
            size: mood.size,
            opacity: mood.opacity,
            passThrough: mood.passThrough,
            x: mood.x,
            y: mood.y,
          }))
        } catch (eSettingsSave) { /* 隐私模式等写不进就放弃，不影响运行 */ }
      }
      function scheduleSave() {
        if (saveTimer !== null) return
        saveTimer = setTimeout(saveNow, 900)
      }
      function flushSave() {
        if (saveTimer !== null) {
          clearTimeout(saveTimer)
          saveNow()
        }
      }
      function subscribe(fn) {
        listeners.add(fn)
        return function unsubscribe() { listeners.delete(fn) }
      }

      return { mood, publish, loadSettings, scheduleSave, flushSave, subscribe }
    }

    // buildStatsState: 返回 stats 状态机 + classify/tickStats/liveBuckets
    // 5 个分类:工作中 / 审批 / 顺利 / 卡顿 / 意外
    var buildStatsState = function () {
      var STATS_KEY = 'dsh-taffy-mood/stats'
      var STATS_BUCKETS = [
        { key: 'surprised', label: '意外',  emoji: '😮', match: function (s) { return s.surprisedUntil > Date.now() } },
        { key: 'blocked',   label: '卡顿',  emoji: '😣', match: function (s) { return s.ignoredApproval || s.cryingUntil > Date.now() || (s.turnFlash && (s.turnFlash === 'aborted' || s.turnFlash === 'error' || s.turnFlash === 'max-tokens') && Date.now() - s.turnFlashAt < 5000) || s.locked === 'angry' || s.locked === 'suicide' || s.locked === 'fake_crying' } },
        { key: 'proud',     label: '顺利',  emoji: '✨', match: function (s) { return s.admirableUntil > Date.now() || s.locked === 'admirable' } },
        { key: 'approval',  label: '审批',  emoji: '🍴', match: function (s) { return s.approvalPending || s.beggingUntil > Date.now() || s.ignoredApproval || s.locked === 'begging' } },
        { key: 'working',   label: '工作中', emoji: '🛠', match: function (s) { return s.running || s.locked === 'hacker' || s.locked === 'thinking' || s.locked === 'tool' } },
      ]
      var statsListeners = new Set()
      var saveStatsTimer = null
      var stats = null  // 惰性 init 在 apply 内

      function notifyStats() { statsListeners.forEach(function (fn) { fn() }) }
      function todayIso() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() }
      function loadStats() {
        var buckets = { working: 0, approval: 0, proud: 0, blocked: 0, surprised: 0 }
        try {
          var raw = window.localStorage.getItem(STATS_KEY)
          if (raw) {
            var c = JSON.parse(raw)
            if (c && c.date === todayIso() && c.buckets) {
              for (var k in buckets) if (typeof c.buckets[k] === 'number' && c.buckets[k] > 0) buckets[k] = c.buckets[k]
              return { date: c.date, segStart: Date.now(), current: c.current || null, buckets: buckets, currentTotal: c.currentTotal || 0 }
            }
          }
        } catch (eStatsLoad) { /* 损坏的本地统计按今日默认值处理 */ }
        return { date: todayIso(), segStart: Date.now(), current: null, buckets: buckets, currentTotal: 0 }
      }
      function saveStatsNow() {
        saveStatsTimer = null
        try { window.localStorage.setItem(STATS_KEY, JSON.stringify(stats)) } catch (eStatsSave) { /* 隐私模式等写不进就放弃 */ }
      }
      function scheduleSaveStats() {
        if (saveStatsTimer !== null) return
        saveStatsTimer = setTimeout(saveStatsNow, 5000)
      }
      function classify(s) {
        if (!s) return null
        for (var i = 0; i < STATS_BUCKETS.length; i += 1) {
          if (STATS_BUCKETS[i].match(s)) return STATS_BUCKETS[i].key
        }
        return null
      }
      function tickStats(s) {
        if (!stats) return
        var now = Date.now()
        var b = classify(s)
        if (stats.current && b === stats.current) return
        if (stats.current && stats.currentTotal > 0) {
          var seg = now - stats.segStart
          if (seg > 0 && seg < 24 * 60 * 60 * 1000) {
            if (typeof stats.buckets[stats.current] !== 'number') stats.buckets[stats.current] = 0
            stats.buckets[stats.current] += seg
          }
        }
        stats.segStart = now
        stats.current = b
        stats.currentTotal = 0
        scheduleSaveStats()
      }
      function formatDuration(ms) {
        if (!ms || ms < 0) return '0s'
        var s = Math.floor(ms / 1000)
        var h = Math.floor(s / 3600)
        var m = Math.floor((s % 3600) / 60)
        var sec = s % 60
        if (h > 0) return h + 'h ' + m + 'm'
        if (m > 0) return m + 'm ' + sec + 's'
        return sec + 's'
      }
      function liveBuckets() {
        if (!stats) return { working: 0, approval: 0, proud: 0, blocked: 0, surprised: 0 }
        var out = {}
        var now = Date.now()
        for (var k in stats.buckets) out[k] = stats.buckets[k] || 0
        if (stats.current && now - stats.segStart > 0 && now - stats.segStart < 24 * 60 * 60 * 1000) {
          if (typeof out[stats.current] !== 'number') out[stats.current] = 0
          out[stats.current] += now - stats.segStart
        }
        return out
      }
      function getStats() { return stats }
      function setStats(s) { stats = s; saveStatsNow(); notifyStats() }
      function flushSaveStats() {
        if (saveStatsTimer !== null) {
          clearTimeout(saveStatsTimer)
          saveStatsNow()
        }
      }
      function subscribeStats(fn) {
        statsListeners.add(fn)
        return function unsubscribe() { statsListeners.delete(fn) }
      }
      function resetToday() {
        stats = { date: todayIso(), segStart: Date.now(), current: stats && stats.current, buckets: { working: 0, approval: 0, proud: 0, blocked: 0, surprised: 0 }, currentTotal: 0 }
        saveStatsNow()
        notifyStats()
      }

      return {
        STATS_BUCKETS,
        loadStats, getStats, setStats, tickStats, liveBuckets,
        formatDuration, todayIso,
        saveStatsNow, flushSaveStats, subscribeStats, resetToday,
      }
    }

    // buildSSEBus: P1.7 — host state 推送总线,EventSource + 2s polling fallback
    // 多个组件共享同一 EventSource 实例;新订阅者立即拿到最新 snapshot
    var buildSSEBus = function (delay, api) {
      var listeners = new Set()
      var currentState = null
      var started = false
      var fallbackLoops = 0

      function notify(snapshot) {
        currentState = snapshot
        for (var i = 0; i < listeners.size; i += 1) {
          var fn = Array.from(listeners)[i]
          try { fn(snapshot) } catch (eNotify) { console.warn('[taffy] sse notify failed', eNotify) }
        }
      }
      function subscribe(callback) {
        listeners.add(callback)
        if (currentState !== null) {
          try { callback(currentState) } catch { /* ignore */ }
        }
        ensureStarted()
        return function unsubscribe() {
          listeners.delete(callback)
          if (listeners.size === 0 && fallbackLoops === 0) stopFallbacks()
        }
      }
      function ensureStarted() {
        if (started || typeof window.EventSource === 'undefined') return
        started = true
        var es = null
        try { es = new window.EventSource(API_BASE + '/events') } catch (eEs) { return }
        es.onmessage = function (ev) {
          if (!ev || typeof ev.data !== 'string') return
          try {
            var msg = JSON.parse(ev.data)
            if (msg && msg.type === 'state' && msg.state) notify(msg.state)
          } catch (eParse) { /* ignore malformed frames */ }
        }
        es.onerror = function () {
          if (es && es.readyState === window.EventSource.CLOSED) startFallbacks()
        }
      }
      function startFallbacks() {
        if (fallbackLoops > 0) return
        fallbackLoops = 1
        var alive = true
        var loop = async function () {
          while (alive) {
            try {
              var r = await api('/state')
              if (r && r.state) notify(r.state)
            } catch (eFb) { /* host 未就绪 */ }
            await delay(2000)
          }
        }
        loop()
      }
      function stopFallbacks() {
        // fire-and-forget promise 自动 GC,无法真正取消;仅标记"用户已退出 SSE"
        fallbackLoops = 0
      }
      function getCurrent() { return currentState }

      return { subscribe, getCurrent }
    }

    // ════════════════════════════════════════════════════════════════════
    // C. 工具 (asset 索引 + 网络)
    // ════════════════════════════════════════════════════════════════════
    async function loadAssetIndex() {
      try {
        var r = await fetch(API_BASE + '/asset-index')
        if (!r.ok) return
        var idx = await r.json()
        for (var mk in MOOD_ASSET) {
          var name = MOOD_ASSET[mk]
          if (idx && typeof idx[name] === 'string') {
            GIFS[mk] = ASSET_BASE + idx[name]
          }
        }
      } catch (eAssetIdx) { /* host 未就绪时走老 URL，路由自动 301 兜底 */ }
    }

    function preloadImgs() {
      return Object.keys(GIFS).map(function (k) {
        return React.createElement('img', { key: k, className: 'taffy-preload', src: GIFS[k], alt: '' })
      })
    }

    function delay(ms) {
      return new Promise(function (resolveDelay) { setTimeout(resolveDelay, ms) })
    }
    async function api(path) {
      const res = await fetch(API_BASE + path)
      return res.json()
    }
    // 写动作走 POST；POST + text/plain 走简单请求路径，跨源会被浏览器预检拦掉
    // 同源 POST 携带 Origin: <同源>，被 host 的 Origin 校验放过
    async function postAction(action, extraQuery) {
      var qs = 'action=' + encodeURIComponent(action) + (extraQuery ? '&' + extraQuery : '')
      const res = await fetch(API_BASE + '/action?' + qs, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      })
      return res.json()
    }
    function act(action, extraQuery) {
      return postAction(action, extraQuery)
    }

    // ════════════════════════════════════════════════════════════════════
    // D. 组件工厂
    // ════════════════════════════════════════════════════════════════════

    // buildTypingObserver: 监听 composer.dock 的 input.draft,消费 rejected
    var buildTypingObserver = function (mood, publish) {
      return function (props) {
        React.useEffect(function () {
          var typing = typeof props.input.draft === 'string' && props.input.draft.length > 0
          if (typing !== mood.typing) {
            var wasTyping = mood.typing
            mood.typing = typing
            if (typing && !wasTyping && mood.rejected) {
              mood.rejected = false
              postAction('clear-rejected').catch(function () {})
            }
            publish()
          }
        })
        return null
      }
    }

    // buildGifOverlay: shell.overlay — 浮动 GIF + 拖拽 + 中键菜单 + time-driven wakeup
    var buildGifOverlay = function (sseBus) {
      return function (props) {
        var hostState0 = { rev: -1, running: false, phase: 'wait', approvalPending: false, lastApproval: null, lastApprovalAt: 0, turnFlash: null, turnFlashAt: 0, locked: null, surprisedUntil: 0, cryingUntil: 0, admirableUntil: 0, waitingAnswer: false, beggingUntil: 0, compacting: false, tired: false, ignoredApproval: false, sleeping: false }
        var hostStateTuple = React.useState(hostState0)
        var hostState = hostStateTuple[0]
        var setHostState = hostStateTuple[1]
        var greetUntilTuple = React.useState(Date.now() + 2000)
        var greetUntil = greetUntilTuple[0]
        var bumpTuple = React.useState(0)
        var bump = bumpTuple[1]
        var menuTuple = React.useState(null)
        var menu = menuTuple[0]
        var setMenu = menuTuple[1]
        var menuMsgTuple = React.useState('')
        var menuMsg = menuMsgTuple[0]
        var setMenuMsg = menuMsgTuple[1]
        var dragRef = React.useRef(null)
        var imgRef = React.useRef(null)

        // 订阅 host state 同步（SSE + time-driven wakeup 保留以等过期）
        var subscribers = moodSubscribersRef()
        React.useEffect(function () {
          var alive = true
          var applySnapshot = function (s) {
            if (!s) return
            if (s.cfg && typeof s.cfg.turn_flash_ms === 'number') TURN_FLASH_MS = s.cfg.turn_flash_ms
            tickStatsRef.current && tickStatsRef.current(s)
            var applied = false
            var nextRev = s.rev || 0
            setHostState(function (prev) {
              if (prev.rev === nextRev) return prev
              applied = true
              return {
                rev: nextRev,
                running: !!s.running,
                phase: s.phase || 'wait',
                approvalPending: !!s.approvalPending,
                lastApproval: s.lastApproval || null,
                lastApprovalAt: s.lastApprovalAt || 0,
                turnFlash: s.turnFlash || null,
                turnFlashAt: s.turnFlashAt || 0,
                locked: s.locked || null,
                surprisedUntil: s.surprisedUntil || 0,
                cryingUntil: s.cryingUntil || 0,
                admirableUntil: s.admirableUntil || 0,
                waitingAnswer: !!s.waitingAnswer,
                beggingUntil: s.beggingUntil || 0,
                compacting: !!s.compacting,
                tired: !!s.tired,
                ignoredApproval: !!s.ignoredApproval,
                sleeping: !!s.sleeping,
              }
            })
          }
          var computeNextDueAt = function (s, t) {
            if (!s) return t + POLL_IDLE_MS
            if (s.running || s.approvalPending || s.waitingAnswer || s.compacting) return t + POLL_ACTIVE_MS
            var due = t + POLL_IDLE_MS
            if (s.surprisedUntil > t && s.surprisedUntil < due) due = s.surprisedUntil
            if (s.cryingUntil > t && s.cryingUntil < due) due = s.cryingUntil
            if (s.admirableUntil > t && s.admirableUntil < due) due = s.admirableUntil
            if (s.beggingUntil > t && s.beggingUntil < due) due = s.beggingUntil
            var flashEnd = s.turnFlashAt + TURN_FLASH_MS
            if (s.turnFlash !== null && s.turnFlashAt > 0 && flashEnd > t && flashEnd < due) due = flashEnd
            var greetEnd = greetUntil
            if (greetEnd > t && greetEnd < due) due = greetEnd
            return due
          }
          var tickTimer = null
          var scheduleNextTick = function () {
            if (tickTimer !== null) clearTimeout(tickTimer)
            var s = sseBus.getCurrent()
            var delayMs = Math.max(50, computeNextDueAt(s, Date.now()) - Date.now())
            tickTimer = setTimeout(function () {
              if (!alive) return
              bump(function (n) { return n + 1 })
              scheduleNextTick()
            }, delayMs)
          }
          var unsubscribe = sseBus.subscribe(function (s) {
            if (!alive) return
            applySnapshot(s)
            scheduleNextTick()
          })
          return function () {
            alive = false
            if (tickTimer !== null) clearTimeout(tickTimer)
            unsubscribe()
          }
        }, [])

        mood.rejected = hostState.lastApproval === 'rejected'

        if (!mood.enabled) {
          return React.createElement('div', null, preloadImgs())
        }

        try {
          if (mood.x !== null && window.innerWidth) {
            var maxX = Math.max(0, window.innerWidth - 48)
            var maxY = Math.max(0, window.innerHeight - 48)
            if (mood.x > maxX) { mood.x = maxX; scheduleSave() }
            if (mood.y > maxY) { mood.y = maxY; scheduleSave() }
          }
        } catch (eClamp) { /* 无视口信息的宿主环境跳过夹取 */ }

        var now = Date.now()
        var src = GIFS.idle
        var alt = '闲置'
        var pulsing = false
        if (hostState.locked && LOCKMOODS[hostState.locked]) {
          src = hostState.locked === 'tool' ? GIFS.running : hostState.locked === 'thinking' ? GIFS.thinking : hostState.locked === 'crying' ? GIFS.cry : hostState.locked === 'fake_crying' ? GIFS.fakeCrying : GIFS[hostState.locked] || GIFS.idle
          alt = '已锁定：' + LOCKMOODS[hostState.locked].label
        } else if (hostState.beggingUntil > now) {
          src = GIFS.begging; alt = '再问一次，求求你了…'
        } else if (hostState.waitingAnswer && mood.typing) {
          src = GIFS.typing; alt = '回答中'
        } else if (hostState.waitingAnswer) {
          src = GIFS.waiting; alt = '在等你回答…'
        } else if (hostState.compacting) {
          src = GIFS.compacting; alt = '记忆压缩中…'
        } else if (hostState.ignoredApproval) {
          src = GIFS.ignoredApproval; alt = '审批没人理，呜哇…'; pulsing = true
        } else if (hostState.approvalPending) {
          src = GIFS.approval; alt = '需要审批'; pulsing = true
        } else if (hostState.lastApproval === 'allowed-once' && now - hostState.lastApprovalAt < 3000) {
          src = GIFS.celebrate; alt = '已批准！'
        } else if (hostState.surprisedUntil > now) {
          src = GIFS.surprised; alt = '插话收到！'
        } else if (hostState.cryingUntil > now) {
          src = GIFS.cry; alt = '被阻塞了…'
        } else if (hostState.turnFlash !== null && now - hostState.turnFlashAt < TURN_FLASH_MS) {
          if (hostState.turnFlash === 'aborted') { src = GIFS.angry; alt = '用户中止' }
          else if (hostState.turnFlash === 'error' || hostState.turnFlash === 'max-tokens') { src = GIFS.suicide; alt = '出错或截断' }
          else if (hostState.turnFlash === 'fake-crying') { src = GIFS.fakeCrying; alt = '又拒绝我…' }
        } else if (hostState.admirableUntil > now) {
          src = GIFS.admirable; alt = '大任务完成！'
        } else if (hostState.tired) {
          src = GIFS.tired; alt = '干了这么久，好累啊…'
        } else if (hostState.running) {
          if (hostState.lastApproval === 'allowed-once') { src = GIFS.hacker; alt = '执行已批准任务' }
          else if (hostState.phase === 'stream') { src = GIFS.thinking; alt = '模型思考中' }
          else { src = GIFS.running; alt = '工具执行中' }
        } else if (mood.typing) {
          src = GIFS.typing; alt = '输入中'
        } else if (now < greetUntil) {
          src = GIFS.greeting; alt = '嗨，我在这儿！'
        } else if (hostState.sleeping) {
          src = GIFS.sleeping; alt = 'zzZ… 休眠中'
        }

        var dragging = dragRef.current !== null
        var posStyle = {}
        if (mood.x !== null && mood.y !== null) {
          posStyle.left = mood.x + 'px'; posStyle.top = mood.y + 'px'
        } else {
          posStyle.right = '12px'; posStyle.bottom = '12px'
        }
        var startDrag = function (e) {
          if (e.button !== 0) return
          try {
            var rect = imgRef.current.getBoundingClientRect()
            dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
            mood.x = rect.left; mood.y = rect.top
          } catch (eRect) {
            dragRef.current = { dx: mood.size / 2, dy: 20 }
            mood.x = e.clientX - mood.size / 2
            mood.y = Math.max(0, e.clientY - 20)
          }
          bump(function (n) { return n + 1 })
        }
        var moveDrag = function (e) {
          if (!dragRef.current) return
          mood.x = Math.max(0, e.clientX - dragRef.current.dx)
          mood.y = Math.max(0, e.clientY - dragRef.current.dy)
          bump(function (n) { return n + 1 })
        }
        var endDrag = function () {
          dragRef.current = null
          bump(function (n) { return n + 1 })
          scheduleSave()
        }
        var openMenu = function (e) {
          var x = e.clientX, y = e.clientY
          try { x = Math.min(x, window.innerWidth - 290); y = Math.min(y, window.innerHeight - 340) } catch (eMenuPos) { /* 保持原始坐标 */ }
          setMenu({ x: Math.max(0, x), y: Math.max(0, y) })
          setMenuMsg('')
        }
        var handleAuxClick = function (e) {
          if (e.button !== 1) return
          e.preventDefault(); e.stopPropagation()
          openMenu(e)
        }
        var doLock = function (key) {
          setMenuMsg('锁定 ' + key + '…')
          act('lock', 'mood=' + encodeURI(key))
            .then(function (r) { setMenuMsg(r && r.ok ? '已锁定：' + key : '锁定失败：' + (r && r.message || '未知错误')) })
            .catch(function (eLock) { setMenuMsg('锁定失败：' + (eLock && eLock.message || eLock)); console.warn('[taffy] lock failed', eLock) })
        }
        var doUnlock = function () {
          setMenuMsg('解除锁定…')
          act('lock')
            .then(function () { setMenuMsg('已解除锁定') })
            .catch(function (eUnlock) { setMenuMsg('解除失败：' + (eUnlock && eUnlock.message || eUnlock)); console.warn('[taffy] unlock failed', eUnlock) })
        }
        var doTest = async function () {
          setMenuMsg('正在发起测试审批…')
          try {
            var r = await act('test-approve')
            setMenuMsg(r && r.ok ? r.message : '失败：' + ((r && r.message) || '未知错误'))
          } catch (eTest) {
            setMenuMsg('失败：' + String(eTest && eTest.message ? eTest.message : eTest))
            console.warn('[taffy] test-approve failed', eTest)
          }
        }
        var doResetPos = function () {
          mood.x = null; mood.y = null
          publish(); scheduleSave()
          setMenuMsg('表情位置已重置到右下角')
        }

        var statusText = hostState.locked
          ? '已锁定：' + (LOCKMOODS[hostState.locked] ? LOCKMOODS[hostState.locked].label : hostState.locked)
          : alt
        var moodButtons = Object.keys(LOCKMOODS).map(function (k) {
          return React.createElement('button', {
            key: k,
            className: hostState.locked === k ? 'on' : '',
            onClick: function () { doLock(k) },
          }, LOCKMOODS[k].label)
        })

        var menuEl = menu === null ? null : React.createElement('div', null,
          React.createElement('div', {
            className: 'taffy-close-shield',
            onClick: function () { setMenu(null) },
            onContextMenu: function (e) { e.preventDefault(); setMenu(null) },
          }),
          React.createElement('div', { className: 'taffy-menu', style: { left: menu.x + 'px', top: menu.y + 'px' } },
            React.createElement('div', { className: 'taffy-panel' },
              React.createElement('div', { className: 'taffy-panel-row' },
                React.createElement('span', { className: 'taffy-panel-badge' + (hostState.locked ? ' locked' : '') }, statusText)),
              React.createElement('div', { className: 'taffy-panel-row' },
                moodButtons,
                React.createElement('button', { className: hostState.locked ? '' : 'on', onClick: doUnlock }, '自动')),
              React.createElement('div', { className: 'taffy-panel-row' },
                React.createElement('button', { onClick: function () { doTest() } }, '测试审批'),
                React.createElement('button', { onClick: doResetPos }, '重置位置')),
              React.createElement('div', { className: 'taffy-panel-msg' }, menuMsg))))

        var imgStyle = {
          position: 'fixed', zIndex: 99999, height: 'auto',
          cursor: dragging ? 'grabbing' : 'grab',
          boxShadow: '0 4px 16px rgba(0,0,0,.3)',
          width: mood.size + 'px', opacity: mood.opacity,
          pointerEvents: dragging || mood.passThrough ? 'none' : 'auto',
          userSelect: 'none',
        }
        Object.assign(imgStyle, posStyle)
        var imgEl = React.createElement('img', {
          ref: imgRef,
          className: pulsing ? 'taffy-pulse' : '',
          key: src, src: src, alt: alt,
          title: alt + '（中键打开控制台，左键拖动）',
          draggable: false,
          onMouseDown: startDrag,
          onAuxClick: handleAuxClick,
          onContextMenu: function (e) { e.preventDefault(); openMenu(e) },
          style: imgStyle,
        })

        var children = [imgEl]
        if (dragging) {
          children.push(React.createElement('div', {
            className: 'taffy-drag-shield',
            onMouseMove: moveDrag,
            onMouseUp: endDrag,
          }))
        }
        if (menuEl !== null) children.push(menuEl)
        children.push(React.createElement('div', null, preloadImgs()))
        return React.createElement('div', null, children)
      }
    }

    // buildSettingsPanel: settings.section — 启停/尺寸/透明度/穿透 + 今日统计
    var buildSettingsPanel = function (mood, publish, scheduleSave, todayIso, liveBuckets, formatDuration, STATS_BUCKETS, resetToday, saveStatsNow, notifyStats, subscribeStats, getStats) {
      return function () {
        var forceTuple = React.useState(0)
        var rerender = function () { forceTuple[1](function (n) { return n + 1 }) }
        var statsTickTuple = React.useState(0)
        var statsTick = statsTickTuple[0]
        var bumpStats = statsTickTuple[1]
        React.useEffect(function () {
          var unsubscribe = subscribeStats(function () { bumpStats(function (n) { return n + 1 }) })
          return unsubscribe
        }, [])
        var row = function (labelText, hint, control) {
          return React.createElement('div', { className: 'taffy-set-row' },
            React.createElement('div', null,
              React.createElement('div', { className: 'taffy-set-label' }, labelText),
              hint ? React.createElement('div', { className: 'taffy-set-hint' }, hint) : null),
            control)
        }
        return React.createElement('div', { style: { maxWidth: 480 } },
          row('启用表情', '关闭后不再显示 taffy',
            React.createElement('input', { type: 'checkbox', checked: mood.enabled, onChange: function (e) { mood.enabled = e.target.checked; publish(); scheduleSave(); rerender() } })),
          row('大小', mood.size + ' px（自动保存在浏览器本地）',
            React.createElement('input', { className: 'taffy-set-input', type: 'range', min: 50, max: 1000, step: 10, value: mood.size, onChange: function (e) { mood.size = Number(e.target.value); scheduleSave(); rerender() } })),
          row('不透明度', String(mood.opacity),
            React.createElement('input', { className: 'taffy-set-input', type: 'range', min: 30, max: 100, step: 5, value: Math.round(mood.opacity * 100), onChange: function (e) { mood.opacity = Number(e.target.value) / 100; scheduleSave(); rerender() } })),
          row('鼠标穿透', '开启后点击会穿过表情（拖动和中键需先关闭）',
            React.createElement('input', { type: 'checkbox', checked: mood.passThrough, onChange: function (e) { mood.passThrough = e.target.checked; publish(); scheduleSave(); rerender() } })),
          (function () {
            var stats = getStats()
            return React.createElement('div', { style: { marginTop: 24, paddingTop: 16, borderTop: '1px solid rgba(128,128,128,.25)' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
                React.createElement('div', { className: 'taffy-set-label' }, '今日统计 · ' + (stats ? stats.date : todayIso())),
                React.createElement('button', {
                  onClick: function () {
                    if (window.confirm('清空今日统计？')) resetToday()
                  },
                  style: { fontSize: 11, padding: '2px 8px', border: '1px solid rgba(128,128,128,.3)', borderRadius: 4, background: 'transparent', color: 'inherit', cursor: 'pointer' },
                }, '重置')),
              (function () {
                var live = liveBuckets()
                return React.createElement('div', { key: statsTick },
                  React.createElement('div', { style: { fontSize: 11, opacity: 0.65, marginBottom: 8 } }, '本地累计 · 跨零点自动归零'),
                  STATS_BUCKETS.map(function (b) {
                    return React.createElement('div', { key: b.key, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 } },
                      React.createElement('span', null, b.emoji + ' ' + b.label),
                      React.createElement('span', { style: { fontVariantNumeric: 'tabular-nums' } }, formatDuration(live[b.key] || 0))
                    )
                  })
                )
              })()
            )
          })()
        )
      }
    }

    // buildToolConsole: tool.view.cordis — 工具卡片控制台,与浮动菜单共用 SSE 流
    var buildToolConsole = function (sseBus) {
      return function () {
        var stTuple = React.useState({ running: false, phase: 'wait', approvalPending: false, locked: null, waitingAnswer: false, compacting: false, tired: false, ignoredApproval: false, sleeping: false })
        var st = stTuple[0]
        var setSt = stTuple[1]
        var msgTuple = React.useState('')
        var msg = msgTuple[0]
        var setMsg = msgTuple[1]
        React.useEffect(function () {
          var alive = true
          var unsubscribe = sseBus.subscribe(function (s) {
            if (!alive || !s) return
            setSt({ running: !!s.running, phase: s.phase || 'wait', approvalPending: !!s.approvalPending, locked: s.locked || null, waitingAnswer: !!s.waitingAnswer, compacting: !!s.compacting, tired: !!s.tired, ignoredApproval: !!s.ignoredApproval, sleeping: !!s.sleeping })
          })
          return function () { alive = false; unsubscribe() }
        }, [])
        var statusText = '闲置'
        if (st.locked) statusText = '已锁定：' + (LOCKMOODS[st.locked] ? LOCKMOODS[st.locked].label : st.locked)
        else if (st.waitingAnswer) statusText = '等你回答'
        else if (st.compacting) statusText = '记忆压缩中'
        else if (st.tired) statusText = '长任务疲惫'
        else if (st.ignoredApproval) statusText = '审批没人理'
        else if (st.sleeping) statusText = '休眠中'
        else if (st.approvalPending) statusText = '等待审批'
        else if (st.running) statusText = st.phase === 'stream' ? '模型思考中' : '工具执行中'
        var moodButtons = Object.keys(LOCKMOODS).map(function (k) {
          return React.createElement('button', {
            key: k,
            className: st.locked === k ? 'on' : '',
            onClick: function () {
              setMsg('锁定 ' + k + '…')
              act('lock', 'mood=' + encodeURI(k))
                .then(function (r) { setMsg(r && r.ok ? '已锁定：' + k : '失败：' + (r && r.message || '未知错误')) })
                .catch(function (eLock) { setMsg('失败：' + (eLock && eLock.message || eLock)); console.warn('[taffy] lock failed', eLock) })
            },
          }, LOCKMOODS[k].label)
        })
        return React.createElement('div', { className: 'taffy-panel' },
          React.createElement('div', { className: 'taffy-panel-row' },
            React.createElement('span', null, 'Taffy 控制台'),
            React.createElement('span', { className: 'taffy-panel-badge' + (st.locked ? ' locked' : '') }, statusText)),
          React.createElement('div', { className: 'taffy-panel-row' },
            React.createElement('span', null, '锁定：'),
            moodButtons,
            React.createElement('button', { className: st.locked ? '' : 'on', onClick: function () {
              setMsg('解除锁定…')
              act('lock')
                .then(function () { setMsg('已解除锁定') })
                .catch(function (eUnlock) { setMsg('失败：' + (eUnlock && eUnlock.message || eUnlock)); console.warn('[taffy] unlock failed', eUnlock) })
            } }, '自动')),
          React.createElement('div', { className: 'taffy-panel-row' },
            React.createElement('button', { onClick: function () {
              setMsg('正在发起测试审批…')
              act('test-approve').then(function (r) {
                setMsg(r && r.ok ? r.message : '失败：' + ((r && r.message) || '未知错误'))
              }).catch(function (eTest) {
                setMsg('失败：' + String(eTest && eTest.message ? eTest.message : eTest))
                console.warn('[taffy] test-approve failed', eTest)
              })
            } }, '测试审批'),
            React.createElement('button', { onClick: function () {
              mood.x = null; mood.y = null
              publish(); scheduleSave()
              setMsg('表情位置已重置到右下角')
            } }, '重置位置')),
          React.createElement('div', { className: 'taffy-panel-msg' }, msg)
        )
      }
    }

    // helpers
    function moodSubscribersRef() { return new Set() }  // 占位,future 扩展
    function tickStatsRef() { return { current: null } }  // 占位

    // ════════════════════════════════════════════════════════════════════
    // E. apply(ctx) 主流程 + dispose
    // ════════════════════════════════════════════════════════════════════
    var apply = async function (ctx) {
      var moodState = buildMoodState()
      var statsState = buildStatsState()
      moodState.loadSettings()
      statsState.setStats(statsState.loadStats())
      var sseBus = buildSSEBus(delay, api)
      await loadAssetIndex()
      var slots = ctx.get('slots')
      if (slots === undefined) return

      var styleEl = document.createElement('style')
      styleEl.setAttribute('data-dsh-taffy-mood', 'css')
      styleEl.textContent = CSS_TEXT
      document.head.appendChild(styleEl)

      // 把 stats tick 通过 SSE 总线接入（每帧 host state 到来时更新分类桶）
      var tickStatsRefVar = { current: statsState.tickStats }
      var prevTickFn = tickStatsRefVar.current
      sseBus.subscribe(function (s) {
        if (prevTickFn) prevTickFn(s)
        // 跨零点检测：日切换时把 buckets 重置
        var cur = statsState.getStats()
        if (cur && cur.date !== statsState.todayIso()) {
          statsState.setStats({ date: statsState.todayIso(), segStart: Date.now(), current: null, buckets: { working: 0, approval: 0, proud: 0, blocked: 0, surprised: 0 }, currentTotal: 0 })
        }
      })

      // 1. typing observer (composer.dock)
      slots.inject('conversation.composer.dock', function () {
        return slots.register(
          { name: 'conversation.composer.dock', id: 'taffy-typing-observer', order: 900 },
          buildTypingObserver(moodState.mood, moodState.publish)
        )
      })

      // 2. shell.overlay: 浮动 GIF
      slots.inject('shell.overlay', function () {
        return slots.register(
          { name: 'shell.overlay', id: 'taffy-gif' },
          buildGifOverlay(sseBus)
        )
      })

      // 3. settings.section: 设置页
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'taffy-settings', order: 50, label: 'Taffy 表情' },
          buildSettingsPanel(
            moodState.mood, moodState.publish, moodState.scheduleSave,
            statsState.todayIso, statsState.liveBuckets, statsState.formatDuration,
            statsState.STATS_BUCKETS, statsState.resetToday, statsState.saveStatsNow,
            null /* notifyStats 已在 setStats 内部触发 */, statsState.subscribeStats, statsState.getStats
          )
        )
      })

      // 4. tool.view.cordis: 工具卡片控制台
      slots.inject('tool.view.cordis', function () {
        return slots.register(
          { name: 'tool.view.cordis', key: 'self' },
          buildToolConsole(sseBus)
        )
      })

      return function dispose() {
        styleEl.remove()
        moodState.flushSave()
        // 关闭时把当前在累的段并入桶并立即落盘
        var cur = statsState.getStats()
        if (cur && cur.current) {
          var seg = Date.now() - cur.segStart
          if (seg > 0 && seg < 24 * 60 * 60 * 1000) {
            if (typeof cur.buckets[cur.current] !== 'number') cur.buckets[cur.current] = 0
            cur.buckets[cur.current] += seg
            cur.segStart = Date.now()
            cur.currentTotal = 0
          }
        }
        statsState.flushSaveStats()
      }
    }

    // ── exports ──
    var module = { exports: {} }
    module.exports.name = 'dsh-taffy-mood'
    module.exports.inject = ['slots']
    module.exports.apply = apply
    return module.exports
  },
})