// Taffy 表情包状态机 — Client 半边（DeepSeek Harness 动态 Cordis Plugin）
// 用法：将本文件除本注释外的全部内容，粘贴到 cordis_define 的 code.client 字段。

const mood = {
  typing: false,
  rejected: false,
  enabled: true,
  size: 150,
  opacity: 0.8,
  passThrough: false,
  x: null,
  y: null,
}
const listeners = new Set()
function publish() {
  for (const fn of listeners) fn()
}
const GIFS = {
  approval: '/taffy-gif/taffy-fork.gif',
  rejected: '/taffy-gif/taffy-embarrassing.gif',
  celebrate: '/taffy-gif/taffy-spread_heart.gif',
  hacker: '/taffy-gif/taffy-hacker.gif',
  running: '/taffy-gif/taffy-tang-laughing.gif',
  thinking: '/taffy-gif/taffy-dumb.gif',
  typing: '/taffy-gif/taffy-se_xy.gif',
  angry: '/taffy-gif/taffy-angry.gif',
  suicide: '/taffy-gif/taffy-suicide.gif',
  idle: '/taffy-gif/taffy2-idling.gif',
  surprised: '/taffy-gif/taffy-suprised.gif',
  cry: '/taffy-gif/taffy-cry.gif',
  begging: '/taffy-gif/taffy-begging.gif',
  admirable: '/taffy-gif/taffy-admirable.gif',
  fakeCrying: '/taffy-gif/taffy-fake_crying.gif',
}
const LOCKMOODS = {
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
return {
  inject: ['timer'],
  async apply(ctx) {
    try {
      const saved = await host.call('taffy-get-config')
      if (saved && saved.ok && saved.config && typeof saved.config === 'object') {
        const c = saved.config
        if (typeof c.enabled === 'boolean') mood.enabled = c.enabled
        if (typeof c.size === 'number' && c.size >= 50 && c.size <= 1000) mood.size = c.size
        if (typeof c.opacity === 'number' && c.opacity >= 0.1 && c.opacity <= 1) mood.opacity = c.opacity
        if (typeof c.passThrough === 'boolean') mood.passThrough = c.passThrough
        if ((c.x === null || typeof c.x === 'number') && (c.y === null || typeof c.y === 'number')) {
          mood.x = c.x
          mood.y = c.y
        }
      }
    } catch (eLoad) {}
    let saveTimer = null
    const scheduleSave = () => {
      if (saveTimer !== null) return
      saveTimer = ctx.timeout(() => {
        saveTimer = null
        host.call('taffy-save-config', {
          enabled: mood.enabled,
          size: mood.size,
          opacity: mood.opacity,
          passThrough: mood.passThrough,
          x: mood.x,
          y: mood.y,
        }).catch(() => {})
      }, 900)
    }
    const slots = ctx.get('slots')
    if (slots === undefined) return
    ctx.effect(() => styles.insert('.taffy-pulse{animation:taffyPulse 1.1s ease-in-out infinite}@keyframes taffyPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}.taffy-preload{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none}.taffy-set-row{display:flex;align-items:center;justify-content:space-between;margin:14px 0;gap:16px}.taffy-set-label{font-size:13px;font-weight:600}.taffy-set-hint{font-size:11px;opacity:.6;margin-top:2px}.taffy-set-input{width:180px}.taffy-drag-shield{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;cursor:grabbing}.taffy-close-shield{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100001}.taffy-panel{display:flex;flex-direction:column;gap:10px;padding:12px;border-top:1px solid rgba(128,128,128,.25);font-size:12px}.taffy-panel-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.taffy-panel-badge{display:inline-block;padding:2px 10px;border-radius:10px;background:#4f7cff;color:#fff;font-weight:600}.taffy-panel-badge.locked{background:#e67e22}.taffy-panel button{padding:4px 12px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;cursor:pointer;font-size:12px}.taffy-panel button.on{background:#4f7cff;color:#fff;border-color:#4f7cff}.taffy-panel-msg{opacity:.75;font-size:11px;min-height:14px}.taffy-menu{position:fixed;z-index:100002;background:rgba(30,30,36,.98);color:#eee;border:1px solid rgba(128,128,128,.35);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);min-width:250px;max-width:320px}.taffy-menu .taffy-panel{border-top:none;padding:10px}'), 'base-css')
    slots.inject('conversation.composer.dock', () => slots.register(
      { name: 'conversation.composer.dock', id: 'taffy-typing-observer', order: 900 },
      (props) => {
        React.useEffect(() => {
          const typing = typeof props.input.draft === 'string' && props.input.draft.length > 0
          if (typing !== mood.typing) {
            const wasTyping = mood.typing
            mood.typing = typing
            if (typing && !wasTyping && mood.rejected) {
              mood.rejected = false
              host.call('taffy-clear-approval').catch(() => {})
            }
            publish()
          }
        })
        return null
      }
    ))
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'taffy-gif' },
      () => {
        const [hostState, setHostState] = React.useState({ running: false, phase: 'wait', approvalPending: false, lastApproval: null, lastApprovalAt: 0, turnFlash: null, turnFlashAt: 0, locked: null, surprisedUntil: 0, cryingUntil: 0, admirableUntil: 0 })
        const [, bump] = React.useState(0)
        const [menu, setMenu] = React.useState(null)
        const [menuMsg, setMenuMsg] = React.useState('')
        const dragRef = React.useRef(null)
        const imgRef = React.useRef(null)
        React.useEffect(() => {
          let alive = true
          const notify = () => bump((n) => n + 1)
          listeners.add(notify)
          const loop = async () => {
            while (alive) {
              try {
                const s = await host.call('taffy-state')
                if (!alive) return
                if (s) {
                  setHostState((prev) => {
                    if (prev.running === !!s.running && prev.phase === (s.phase || 'wait') && prev.approvalPending === !!s.approvalPending && prev.lastApproval === s.lastApproval && prev.lastApprovalAt === s.lastApprovalAt && prev.turnFlash === s.turnFlash && prev.turnFlashAt === s.turnFlashAt && prev.locked === (s.locked || null) && prev.surprisedUntil === (s.surprisedUntil || 0) && prev.cryingUntil === (s.cryingUntil || 0) && prev.admirableUntil === (s.admirableUntil || 0)) return prev
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
                    }
                  })
                }
              } catch (e) {}
              notify()
              await ctx.timeout(500)
            }
          }
          loop()
          return () => {
            alive = false
            listeners.delete(notify)
          }
        }, [])
        mood.rejected = hostState.lastApproval === 'rejected'
        const preloadImgs = () => Object.keys(GIFS).map((k) => React.createElement('img', { key: k, className: 'taffy-preload', src: GIFS[k], alt: '' }))
        if (!mood.enabled) {
          return React.createElement('div', null, preloadImgs())
        }
        try {
          if (mood.x !== null && typeof window !== 'undefined' && window.innerWidth) {
            const maxX = Math.max(0, window.innerWidth - 48)
            const maxY = Math.max(0, window.innerHeight - 48)
            if (mood.x > maxX) {
              mood.x = maxX
              scheduleSave()
            }
            if (mood.y > maxY) {
              mood.y = maxY
              scheduleSave()
            }
          }
        } catch (eClamp) {}
        const now = Date.now()
        let src = GIFS.idle
        let alt = '闲置'
        let pulsing = false
        if (hostState.locked && LOCKMOODS[hostState.locked]) {
          src = hostState.locked === 'tool' ? GIFS.running : hostState.locked === 'thinking' ? GIFS.thinking : hostState.locked === 'crying' ? GIFS.cry : hostState.locked === 'fake_crying' ? GIFS.fakeCrying : GIFS[hostState.locked] || GIFS.idle
          alt = '已锁定：' + LOCKMOODS[hostState.locked].label
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
        const dragging = dragRef.current !== null
        const posStyle = {}
        if (mood.x !== null && mood.y !== null) {
          posStyle.left = mood.x + 'px'
          posStyle.top = mood.y + 'px'
        } else {
          posStyle.right = '12px'
          posStyle.bottom = '12px'
        }
        const startDrag = (e) => {
          if (e.button !== 0) return
          let lx = e.clientX - mood.size / 2
          let ly = Math.max(0, e.clientY - 20)
          let off = { dx: mood.size / 2, dy: 20 }
          try {
            const rect = imgRef.current.getBoundingClientRect()
            lx = rect.left
            ly = rect.top
            off = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
          } catch (err) {
            off = { dx: mood.size / 2, dy: 20 }
          }
          dragRef.current = off
          mood.x = lx
          mood.y = ly
          bump((n) => n + 1)
        }
        const moveDrag = (e) => {
          if (!dragRef.current) return
          mood.x = Math.max(0, e.clientX - dragRef.current.dx)
          mood.y = Math.max(0, e.clientY - dragRef.current.dy)
          bump((n) => n + 1)
        }
        const endDrag = () => {
          dragRef.current = null
          bump((n) => n + 1)
          scheduleSave()
        }
        const openMenu = (e) => {
          let x = e.clientX
          let y = e.clientY
          try {
            x = Math.min(x, window.innerWidth - 290)
            y = Math.min(y, window.innerHeight - 340)
          } catch (err) {}
          setMenu({ x: Math.max(0, x), y: Math.max(0, y) })
          setMenuMsg('')
        }
        const handleAuxClick = (e) => {
          if (e.button !== 1) return
          e.preventDefault()
          e.stopPropagation()
          openMenu(e)
        }
        const doLock = (key) => {
          host.call('taffy-lock', { mood: key }).catch(() => {})
        }
        const doUnlock = () => {
          host.call('taffy-lock', { mood: null }).catch(() => {})
        }
        const doTest = async () => {
          setMenuMsg('正在发起测试审批…')
          try {
            const r = await host.call('taffy-test-approve')
            setMenuMsg(r && r.ok ? r.message : '失败：' + ((r && r.message) || '未知错误'))
          } catch (e) {
            setMenuMsg('失败：' + String(e && e.message ? e.message : e))
          }
        }
        const doResetPos = () => {
          mood.x = null
          mood.y = null
          publish()
          scheduleSave()
          setMenuMsg('表情位置已重置到右下角')
        }
        const statusText = hostState.locked
          ? '已锁定：' + (LOCKMOODS[hostState.locked] ? LOCKMOODS[hostState.locked].label : hostState.locked)
          : alt
        const moodButtons = Object.keys(LOCKMOODS).map((k) =>
          React.createElement('button', {
            key: k,
            className: hostState.locked === k ? 'on' : '',
            onClick: () => doLock(k),
          }, LOCKMOODS[k].label))
        const menuEl = menu === null ? null : React.createElement('div', null,
          React.createElement('div', {
            className: 'taffy-close-shield',
            onClick: () => setMenu(null),
            onContextMenu: (e) => { e.preventDefault(); setMenu(null) },
          }),
          React.createElement('div', { className: 'taffy-menu', style: { left: menu.x + 'px', top: menu.y + 'px' } },
            React.createElement('div', { className: 'taffy-panel' },
              React.createElement('div', { className: 'taffy-panel-row' },
                React.createElement('span', { className: 'taffy-panel-badge' + (hostState.locked ? ' locked' : '') }, statusText)),
              React.createElement('div', { className: 'taffy-panel-row' },
                moodButtons,
                React.createElement('button', { className: hostState.locked ? '' : 'on', onClick: doUnlock }, '自动')),
              React.createElement('div', { className: 'taffy-panel-row' },
                React.createElement('button', { onClick: doTest }, '测试审批'),
                React.createElement('button', { onClick: doResetPos }, '重置位置')),
              React.createElement('div', { className: 'taffy-panel-msg' }, menuMsg))))
        const imgEl = React.createElement('img', {
          ref: imgRef,
          className: pulsing ? 'taffy-pulse' : '',
          key: src,
          src,
          alt,
          title: alt + '（中键打开控制台，左键拖动）',
          draggable: false,
          onMouseDown: startDrag,
          onAuxClick: handleAuxClick,
          onContextMenu: (e) => { e.preventDefault(); openMenu(e) },
          style: {
            position: 'fixed',
            zIndex: 99999,
            height: 'auto',
            cursor: dragging ? 'grabbing' : 'grab',
            boxShadow: '0 4px 16px rgba(0,0,0,.3)',
            width: mood.size + 'px',
            opacity: mood.opacity,
            pointerEvents: dragging || mood.passThrough ? 'none' : 'auto',
            userSelect: 'none',
            ...posStyle,
          },
        })
        const children = [imgEl]
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
    ))
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'taffy-settings', order: 50, label: 'Taffy 表情' },
      () => {
        const [, force] = React.useState(0)
        const rerender = () => force((n) => n + 1)
        const row = (labelText, hint, control) => React.createElement('div', { className: 'taffy-set-row' },
          React.createElement('div', null,
            React.createElement('div', { className: 'taffy-set-label' }, labelText),
            hint ? React.createElement('div', { className: 'taffy-set-hint' }, hint) : null),
          control)
        return React.createElement('div', { style: { maxWidth: 480 } },
          row('启用表情', '关闭后不再显示 taffy',
            React.createElement('input', { type: 'checkbox', checked: mood.enabled, onChange: (e) => { mood.enabled = e.target.checked; publish(); scheduleSave(); rerender() } })),
          row('大小', mood.size + ' px（已自动保存）',
            React.createElement('input', { className: 'taffy-set-input', type: 'range', min: 50, max: 1000, step: 10, value: mood.size, onChange: (e) => { mood.size = Number(e.target.value); scheduleSave(); rerender() } })),
          row('不透明度', String(mood.opacity),
            React.createElement('input', { className: 'taffy-set-input', type: 'range', min: 30, max: 100, step: 5, value: Math.round(mood.opacity * 100), onChange: (e) => { mood.opacity = Number(e.target.value) / 100; scheduleSave(); rerender() } })),
          row('鼠标穿透', '开启后点击会穿过表情（拖动和中键需先关闭）',
            React.createElement('input', { type: 'checkbox', checked: mood.passThrough, onChange: (e) => { mood.passThrough = e.target.checked; publish(); scheduleSave(); rerender() } }))
        )
      }
    ))
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => {
        const [st, setSt] = React.useState({ running: false, phase: 'wait', approvalPending: false, locked: null })
        const [msg, setMsg] = React.useState('')
        React.useEffect(() => {
          let alive = true
          const loop = async () => {
            while (alive) {
              try {
                const s = await host.call('taffy-state')
                if (!alive) return
                if (s) setSt({ running: !!s.running, phase: s.phase || 'wait', approvalPending: !!s.approvalPending, locked: s.locked || null })
              } catch (e) {}
              await ctx.timeout(500)
            }
          }
          loop()
          return () => { alive = false }
        }, [])
        let statusText = '闲置'
        if (st.locked) statusText = '已锁定：' + (LOCKMOODS[st.locked] ? LOCKMOODS[st.locked].label : st.locked)
        else if (st.approvalPending) statusText = '等待审批'
        else if (st.running) statusText = st.phase === 'stream' ? '模型思考中' : '工具执行中'
        const doLock = (key) => {
          host.call('taffy-lock', { mood: key }).catch(() => {})
        }
        const doUnlock = () => {
          host.call('taffy-lock', { mood: null }).catch(() => {})
        }
        const doTest = async () => {
          setMsg('正在发起测试审批…')
          try {
            const r = await host.call('taffy-test-approve')
            setMsg(r && r.ok ? r.message : '失败：' + ((r && r.message) || '未知错误'))
          } catch (e) {
            setMsg('失败：' + String(e && e.message ? e.message : e))
          }
        }
        const doResetPos = () => {
          mood.x = null
          mood.y = null
          publish()
          scheduleSave()
          setMsg('表情位置已重置到右下角')
        }
        const moodButtons = Object.keys(LOCKMOODS).map((k) =>
          React.createElement('button', {
            key: k,
            className: st.locked === k ? 'on' : '',
            onClick: () => doLock(k),
          }, LOCKMOODS[k].label))
        return React.createElement('div', { className: 'taffy-panel' },
          React.createElement('div', { className: 'taffy-panel-row' },
            React.createElement('span', null, 'Taffy 控制台'),
            React.createElement('span', { className: 'taffy-panel-badge' + (st.locked ? ' locked' : '') }, statusText)),
          React.createElement('div', { className: 'taffy-panel-row' },
            React.createElement('span', null, '锁定：'),
            moodButtons,
            React.createElement('button', { className: st.locked ? '' : 'on', onClick: doUnlock }, '自动')),
          React.createElement('div', { className: 'taffy-panel-row' },
            React.createElement('button', { onClick: doTest }, '测试审批'),
            React.createElement('button', { onClick: doResetPos }, '重置位置')),
          React.createElement('div', { className: 'taffy-panel-msg' }, msg)
        )
      }
    ))
  },
}
