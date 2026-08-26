// dsh-taffy-mood —— Client 半边：右下角表情 overlay + 浮动控制台 + 设置页
// 由 packages/client/modules 的 ClientModuleLoader 加载：
// 脚本执行只注册 factory；所有副作用（样式注入、slots、DOM）都在
// factory(require) 物化时发生，apply 返回的函数负责完整回收。
window.__ModuleLoader__.load({
  id: 'dsh-taffy-mood',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var SETTINGS_KEY = 'dsh-taffy-mood/settings'
    var API_BASE = '/dsh-taffy-mood/api'
    var ASSET_BASE = '/dsh-taffy-mood/assets/'

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
    function publish() {
      listeners.forEach(function (fn) { fn() })
    }

    var GIFS = {
      approval: ASSET_BASE + 'taffy-fork.gif',
      rejected: ASSET_BASE + 'taffy-embarrassing.gif',
      celebrate: ASSET_BASE + 'taffy-spread_heart.gif',
      hacker: ASSET_BASE + 'taffy-hacker.gif',
      running: ASSET_BASE + 'taffy-tang-laughing.gif',
      thinking: ASSET_BASE + 'taffy-dumb.gif',
      typing: ASSET_BASE + 'taffy-se_xy.gif',
      angry: ASSET_BASE + 'taffy-angry.gif',
      suicide: ASSET_BASE + 'taffy-suicide.gif',
      idle: ASSET_BASE + 'taffy2-idling.gif',
      surprised: ASSET_BASE + 'taffy-suprised.gif',
      cry: ASSET_BASE + 'taffy-cry.gif',
      begging: ASSET_BASE + 'taffy-begging.gif',
      admirable: ASSET_BASE + 'taffy-admirable.gif',
      fakeCrying: ASSET_BASE + 'taffy-fake_crying.gif',
      waiting: ASSET_BASE + 'taffy-staring.jpg',
      compacting: ASSET_BASE + 'taffy-pressure.jpg',
    }

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

    var saveTimer = null
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

    function delay(ms) {
      return new Promise(function (resolveDelay) { setTimeout(resolveDelay, ms) })
    }
    async function api(path) {
      const res = await fetch(API_BASE + path)
      return res.json()
    }
    function act(action, query) {
      var qs = '?action=' + encodeURIComponent(action) + (query ? '&' + query : '')
      return api('/action' + qs)
    }

    var CSS_TEXT = '.taffy-pulse{animation:taffyPulse 1.1s ease-in-out infinite}@keyframes taffyPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}.taffy-preload{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none}.taffy-set-row{display:flex;align-items:center;justify-content:space-between;margin:14px 0;gap:16px}.taffy-set-label{font-size:13px;font-weight:600}.taffy-set-hint{font-size:11px;opacity:.6;margin-top:2px}.taffy-set-input{width:180px}.taffy-drag-shield{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;cursor:grabbing}.taffy-close-shield{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100001}.taffy-panel{display:flex;flex-direction:column;gap:10px;padding:12px;border-top:1px solid rgba(128,128,128,.25);font-size:12px}.taffy-panel-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.taffy-panel-badge{display:inline-block;padding:2px 10px;border-radius:10px;background:#4f7cff;color:#fff;font-weight:600}.taffy-panel-badge.locked{background:#e67e22}.taffy-panel button{padding:4px 12px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;cursor:pointer;font-size:12px}.taffy-panel button.on{background:#4f7cff;color:#fff;border-color:#4f7cff}.taffy-panel-msg{opacity:.75;font-size:11px;min-height:14px}.taffy-menu{position:fixed;z-index:100002;background:rgba(30,30,36,.98);color:#eee;border:1px solid rgba(128,128,128,.35);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);min-width:250px;max-width:320px}.taffy-menu .taffy-panel{border-top:none;padding:10px}'

    function preloadImgs() {
      return Object.keys(GIFS).map(function (k) {
        return React.createElement('img', { key: k, className: 'taffy-preload', src: GIFS[k], alt: '' })
      })
    }

    function apply(ctx) {
      loadSettings()
      var slots = ctx.get('slots')
      if (slots === undefined) return

      var styleEl = document.createElement('style')
      styleEl.setAttribute('data-dsh-taffy-mood', 'css')
      styleEl.textContent = CSS_TEXT
      document.head.appendChild(styleEl)

      // 打字观察：输入框草稿非空即 typing；打字上升沿消费跨轮的 rejected。
      slots.inject('conversation.composer.dock', function () {
        return slots.register(
          { name: 'conversation.composer.dock', id: 'taffy-typing-observer', order: 900 },
          function (props) {
            React.useEffect(function () {
              var typing = typeof props.input.draft === 'string' && props.input.draft.length > 0
              if (typing !== mood.typing) {
                var wasTyping = mood.typing
                mood.typing = typing
                if (typing && !wasTyping && mood.rejected) {
                  mood.rejected = false
                  fetch(API_BASE + '/action?action=clear-rejected').catch(function () {})
                }
                publish()
              }
            })
            return null
          }
        )
      })

      slots.inject('shell.overlay', function () {
        return slots.register(
          { name: 'shell.overlay', id: 'taffy-gif' },
          function () {
            var hostState0 = { running: false, phase: 'wait', approvalPending: false, lastApproval: null, lastApprovalAt: 0, turnFlash: null, turnFlashAt: 0, locked: null, surprisedUntil: 0, cryingUntil: 0, admirableUntil: 0, waitingAnswer: false, beggingUntil: 0, compacting: false }
            var hostStateTuple = React.useState(hostState0)
            var hostState = hostStateTuple[0]
            var setHostState = hostStateTuple[1]
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

            React.useEffect(function () {
              var alive = true
              var notify = function () { bump(function (n) { return n + 1 }) }
              listeners.add(notify)
              var loop = async function () {
                while (alive) {
                  try {
                    var r = await api('/state')
                    if (!alive) return
                    if (r && r.state) {
                      var s = r.state
                      setHostState(function (prev) {
                        if (prev.running === !!s.running && prev.phase === (s.phase || 'wait') && prev.approvalPending === !!s.approvalPending && prev.lastApproval === s.lastApproval && prev.lastApprovalAt === s.lastApprovalAt && prev.turnFlash === s.turnFlash && prev.turnFlashAt === s.turnFlashAt && prev.locked === (s.locked || null) && prev.surprisedUntil === (s.surprisedUntil || 0) && prev.cryingUntil === (s.cryingUntil || 0) && prev.admirableUntil === (s.admirableUntil || 0) && prev.waitingAnswer === !!s.waitingAnswer && prev.beggingUntil === (s.beggingUntil || 0) && prev.compacting === !!s.compacting) return prev
                        return {
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
                        }
                      })
                    }
                  } catch (eApiPoll) { /* Host 未就绪时下一轮重试 */ }
                  notify()
                  await delay(500)
                }
              }
              loop()
              return function () {
                alive = false
                listeners.delete(notify)
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
                if (mood.x > maxX) {
                  mood.x = maxX
                  scheduleSave()
                }
                if (mood.y > maxY) {
                  mood.y = maxY
                  scheduleSave()
                }
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
              // 求饶：5 秒时间盒，过期自动落回下方 fork，不会永久盖住审批
              src = GIFS.begging
              alt = '再问一次，求求你了…'
            } else if (hostState.waitingAnswer && mood.typing) {
              // 等你回答 + 用户已在打字 → 显示输入中，答题体验更连贯
              src = GIFS.typing
              alt = '回答中'
            } else if (hostState.waitingAnswer) {
              src = GIFS.waiting
              alt = '在等你回答…'
            } else if (hostState.compacting) {
              // 压缩记忆：host 端 end 归零 + 90 秒兜底，双保险防卡死
              src = GIFS.compacting
              alt = '记忆压缩中…'
            } else if (hostState.approvalPending) {
              src = GIFS.approval
              alt = '需要审批'
              pulsing = true
            } else if (hostState.lastApproval === 'allowed-once' && now - hostState.lastApprovalAt < 3000) {
              src = GIFS.celebrate
              alt = '已批准！'
            } else if (hostState.surprisedUntil > now) {
              src = GIFS.surprised
              alt = '插话收到！'
            } else if (hostState.cryingUntil > now) {
              src = GIFS.cry
              alt = '被阻塞了…'
            } else if (hostState.turnFlash !== null && now - hostState.turnFlashAt < 5000) {
              if (hostState.turnFlash === 'aborted') {
                src = GIFS.angry
                alt = '用户中止'
              } else if (hostState.turnFlash === 'error' || hostState.turnFlash === 'max-tokens') {
                src = GIFS.suicide
                alt = '出错或截断'
              } else if (hostState.turnFlash === 'fake-crying') {
                src = GIFS.fakeCrying
                alt = '又拒绝我…'
              }
            } else if (hostState.admirableUntil > now) {
              src = GIFS.admirable
              alt = '大任务完成！'
            } else if (hostState.running) {
              if (hostState.lastApproval === 'allowed-once') {
                src = GIFS.hacker
                alt = '执行已批准任务'
              } else if (hostState.phase === 'stream') {
                src = GIFS.thinking
                alt = '模型思考中'
              } else {
                src = GIFS.running
                alt = '工具执行中'
              }
            } else if (mood.typing) {
              src = GIFS.typing
              alt = '输入中'
            }

            var dragging = dragRef.current !== null
            var posStyle = {}
            if (mood.x !== null && mood.y !== null) {
              posStyle.left = mood.x + 'px'
              posStyle.top = mood.y + 'px'
            } else {
              posStyle.right = '12px'
              posStyle.bottom = '12px'
            }
            var startDrag = function (e) {
              if (e.button !== 0) return
              var off = { dx: mood.size / 2, dy: 20 }
              try {
                var rect = imgRef.current.getBoundingClientRect()
                off = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
                mood.x = rect.left
                mood.y = rect.top
              } catch (eRect) {
                mood.x = e.clientX - mood.size / 2
                mood.y = Math.max(0, e.clientY - 20)
              }
              dragRef.current = off
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
              var x = e.clientX
              var y = e.clientY
              try {
                x = Math.min(x, window.innerWidth - 290)
                y = Math.min(y, window.innerHeight - 340)
              } catch (eMenuPos) { /* 保持原始坐标 */ }
              setMenu({ x: Math.max(0, x), y: Math.max(0, y) })
              setMenuMsg('')
            }
            var handleAuxClick = function (e) {
              if (e.button !== 1) return
              e.preventDefault()
              e.stopPropagation()
              openMenu(e)
            }
            var doLock = function (key) {
              act('lock', 'mood=' + encodeURIComponent(key)).catch(function () {})
            }
            var doUnlock = function () {
              act('lock').catch(function () {})
            }
            var doTest = async function () {
              setMenuMsg('正在发起测试审批…')
              try {
                var r = await act('test-approve')
                setMenuMsg(r && r.ok ? r.message : '失败：' + ((r && r.message) || '未知错误'))
              } catch (eTest) {
                setMenuMsg('失败：' + String(eTest && eTest.message ? eTest.message : eTest))
              }
            }
            var doResetPos = function () {
              mood.x = null
              mood.y = null
              publish()
              scheduleSave()
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
              position: 'fixed',
              zIndex: 99999,
              height: 'auto',
              cursor: dragging ? 'grabbing' : 'grab',
              boxShadow: '0 4px 16px rgba(0,0,0,.3)',
              width: mood.size + 'px',
              opacity: mood.opacity,
              pointerEvents: dragging || mood.passThrough ? 'none' : 'auto',
              userSelect: 'none',
            }
            Object.assign(imgStyle, posStyle)
            var imgEl = React.createElement('img', {
              ref: imgRef,
              className: pulsing ? 'taffy-pulse' : '',
              key: src,
              src: src,
              alt: alt,
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
        )
      })

      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'taffy-settings', order: 50, label: 'Taffy 表情' },
          function () {
            var forceTuple = React.useState(0)
            var rerender = function () { forceTuple[1](function (n) { return n + 1 }) }
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
                React.createElement('input', { type: 'checkbox', checked: mood.passThrough, onChange: function (e) { mood.passThrough = e.target.checked; publish(); scheduleSave(); rerender() } }))
            )
          }
        )
      })

      // 工具卡片控制台：与浮动菜单同功能，独立轮询。
      slots.inject('tool.view.cordis', function () {
        return slots.register(
          { name: 'tool.view.cordis', key: 'self' },
          function () {
            var stTuple = React.useState({ running: false, phase: 'wait', approvalPending: false, locked: null, waitingAnswer: false, compacting: false })
            var st = stTuple[0]
            var setSt = stTuple[1]
            var msgTuple = React.useState('')
            var msg = msgTuple[0]
            var setMsg = msgTuple[1]
            React.useEffect(function () {
              var alive = true
              var loop = async function () {
                while (alive) {
                  try {
                    var r = await api('/state')
                    if (!alive) return
                    if (r && r.state) {
                      var s = r.state
                      setSt({ running: !!s.running, phase: s.phase || 'wait', approvalPending: !!s.approvalPending, locked: s.locked || null, waitingAnswer: !!s.waitingAnswer, compacting: !!s.compacting })
                    }
                  } catch (eConsolePoll) { /* Host 未就绪时下一轮重试 */ }
                  await delay(500)
                }
              }
              loop()
              return function () { alive = false }
            }, [])
            var statusText = '闲置'
            if (st.locked) statusText = '已锁定：' + (LOCKMOODS[st.locked] ? LOCKMOODS[st.locked].label : st.locked)
            else if (st.waitingAnswer) statusText = '等你回答'
            else if (st.compacting) statusText = '记忆压缩中'
            else if (st.approvalPending) statusText = '等待审批'
            else if (st.running) statusText = st.phase === 'stream' ? '模型思考中' : '工具执行中'
            var moodButtons = Object.keys(LOCKMOODS).map(function (k) {
              return React.createElement('button', {
                key: k,
                className: st.locked === k ? 'on' : '',
                onClick: function () { act('lock', 'mood=' + encodeURIComponent(k)).catch(function () {}) },
              }, LOCKMOODS[k].label)
            })
            return React.createElement('div', { className: 'taffy-panel' },
              React.createElement('div', { className: 'taffy-panel-row' },
                React.createElement('span', null, 'Taffy 控制台'),
                React.createElement('span', { className: 'taffy-panel-badge' + (st.locked ? ' locked' : '') }, statusText)),
              React.createElement('div', { className: 'taffy-panel-row' },
                React.createElement('span', null, '锁定：'),
                moodButtons,
                React.createElement('button', { className: st.locked ? '' : 'on', onClick: function () { act('lock').catch(function () {}) } }, '自动')),
              React.createElement('div', { className: 'taffy-panel-row' },
                React.createElement('button', { onClick: function () {
                  setMsg('正在发起测试审批…')
                  act('test-approve').then(function (r) {
                    setMsg(r && r.ok ? r.message : '失败：' + ((r && r.message) || '未知错误'))
                  }).catch(function (eTest) {
                    setMsg('失败：' + String(eTest && eTest.message ? eTest.message : eTest))
                  })
                } }, '测试审批'),
                React.createElement('button', { onClick: function () {
                  mood.x = null
                  mood.y = null
                  publish()
                  scheduleSave()
                  setMsg('表情位置已重置到右下角')
                } }, '重置位置')),
              React.createElement('div', { className: 'taffy-panel-msg' }, msg)
            )
          }
        )
      })

      return function dispose() {
        styleEl.remove()
        if (saveTimer !== null) {
          clearTimeout(saveTimer)
          saveNow()
        }
        listeners.clear()
      }
    }

    exports.name = 'dsh-taffy-mood'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
