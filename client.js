/**
 * dsh-sticker-bag —— 浏览器半端（「设置」里的一页）
 * ============================================================================
 * ⚠️ 这不是 ESM，是 DSH 的自注册脚本，约定：
 *
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => {...} })
 *
 * 进设置页靠 settings.section 这个槽位：
 *
 *     const slots = ctx.get('slots')
 *     slots.inject('settings.section', () => slots.register(
 *       { name: 'settings.section', id: 'dsh-sticker-bag', order: 40, label: '表情袋' },
 *       () => h(Panel),
 *     ))
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-sticker-bag',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const API = '/sticker-bag/api'

    const asJson = async (res) => {
      if (res.ok) return res.json()
      const why = res.status === 403 ? '（被拒了）' : res.status === 415 ? '（请求格式不对）' : ''
      throw new Error('HTTP ' + res.status + why)
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
[data-sb-page]{display:flex;flex-direction:column;gap:16px;max-width:640px;padding:2px 2px 8px;}
[data-sb-sec]{display:flex;flex-direction:column;gap:8px;}
[data-sb-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-sb-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-sb-label]{font-size:13px;}
[data-sb-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-sb-input]{flex:1;min-width:220px;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-1,transparent);
  color:inherit;font-family:inherit;}
[data-sb-btn]{padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-bg-layer-3,rgba(128,128,128,.25));
  background:transparent;color:inherit;font-size:12px;cursor:pointer;}
[data-sb-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-sb-btn][disabled]{opacity:.45;cursor:default;}
[data-sb-kv]{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px;}
[data-sb-kv] b{font-weight:600;}
[data-sb-kv] span{color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-sb-msg]{font-size:12px;line-height:18px;padding:6px 10px;border-radius:8px;
  background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));}
[data-sb-msg][data-err]{color:#ef4444;}
[data-sb-msg][data-ok]{color:#16a34a;}
[data-sb-tag]{font-size:10px;padding:1px 6px;border-radius:6px;border:1px solid var(--dsw-alias-bg-layer-3,rgba(128,128,128,.3));}
`

    const fmtBytes = (n) => {
      const v = Number(n) || 0
      if (v < 1024) return v + ' B'
      if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
      return (v / 1024 / 1024).toFixed(2) + ' MB'
    }

    function Panel() {
      const [state, setState] = useState(null)
      const [dirInput, setDirInput] = useState('')
      const [busy, setBusy] = useState('')
      const [msg, setMsg] = useState(null)

      const load = useCallback(async () => {
        try {
          const s = await jget('/state')
          setState(s)
          setDirInput(s.config?.storageDir || '')
        } catch (e) {
          setMsg({ err: true, text: '读状态失败：' + String(e?.message ?? e) })
        }
      }, [])

      useEffect(() => { load() }, [load])

      const save = async () => {
        setBusy('save'); setMsg(null)
        try {
          await jpost('/config', { storageDir: dirInput.trim() })
          setMsg({ ok: true, text: '已保存。新收的表情会放进这个地址。' })
          await load()
        } catch (e) {
          setMsg({ err: true, text: '保存失败：' + String(e?.message ?? e) })
        } finally { setBusy('') }
      }

      const migrate = async () => {
        setBusy('migrate'); setMsg(null)
        try {
          const r = await jpost('/migrate', { to: dirInput.trim() })
          setMsg({ ok: true, text: `搬完了 ${r.moved} 张 → ${r.to}。旧目录没删，确认新盘没问题再自己删。` })
          await load()
        } catch (e) {
          setMsg({ err: true, text: '搬家失败：' + String(e?.message ?? e) })
        } finally { setBusy('') }
      }

      const s = state
      return h('div', { 'data-sb-page': '' },

        h('div', { 'data-sb-sec': '' },
          h('div', { 'data-sb-h': '' }, '表情存放地址'),
          h('div', { 'data-sb-row': '' },
            h('input', {
              'data-sb-input': '',
              value: dirInput,
              placeholder: '留空 = <DSH_HOME>/stickers；也可以填 D:\\stickers 这种外接硬盘路径',
              onChange: (e) => setDirInput(e.target.value),
            }),
            h('button', { 'data-sb-btn': '', 'data-primary': '', disabled: !!busy, onClick: save },
              busy === 'save' ? '保存中…' : '保存'),
          ),
          h('div', { 'data-sb-note': '' }, '现在实际在用：', s ? s.dir : '…'),
          h('div', { 'data-sb-note': '' }, '换地址之后，老表情不会自己跟过去——点下面「搬到新地址」会复制一份过去，旧的那份留着当备份。'),
          h('div', { 'data-sb-row': '' },
            h('button', { 'data-sb-btn': '', disabled: !!busy || !dirInput.trim(), onClick: migrate },
              busy === 'migrate' ? '搬运中…' : '把现在的表情搬到新地址'),
          ),
        ),

        msg ? h('div', { 'data-sb-msg': '', 'data-err': msg.err ? '' : undefined, 'data-ok': msg.ok ? '' : undefined }, msg.text) : null,

        s ? h('div', { 'data-sb-sec': '' },
          h('div', { 'data-sb-h': '' }, '库里现在有什么'),
          h('div', { 'data-sb-kv': '' },
            h('b', null, '表情'), h('span', null, `${s.stats.count} 张`),
            h('b', null, '占用'), h('span', null, fmtBytes(s.stats.bytes)),
            h('b', null, '找不到原图'), h('span', null, `${s.stats.missing} 张`),
            h('b', null, '最近更新'), h('span', null, s.stats.updatedAt ? new Date(s.stats.updatedAt).toLocaleString() : '—'),
          ),
          Object.keys(s.stats.byEmotion || {}).length
            ? h('div', { 'data-sb-row': '' },
                Object.entries(s.stats.byEmotion).map(([k, v]) => h('span', { 'data-sb-tag': '', key: k }, `${k} ${v}`)))
            : null,
        ) : null,

        s ? h('div', { 'data-sb-sec': '' },
          h('div', { 'data-sb-h': '' }, 'QQ 网关'),
          h('div', { 'data-sb-kv': '' },
            h('b', null, '地址'), h('span', null, s.config.onebotUrl || '—'),
            h('b', null, '状态'), h('span', null, s.gateway?.ok ? `在线（${s.gateway.self?.nickname || s.gateway.self?.user_id || '已连上'}）` : `连不上：${s.gateway?.error || '未知'}`),
          ),
          h('div', { 'data-sb-note': '' }, '网关和 token 在 <DSH_HOME>/sticker-bag/config.json 里改（打开配置文件编辑即可），改完刷新这一页。'),
        ) : null,

        s ? h('div', { 'data-sb-sec': '' },
          h('div', { 'data-sb-h': '' }, '配置预览'),
          h('pre', { style: { fontSize: '11px', lineHeight: '16px', overflow: 'auto', margin: 0, opacity: .8 } },
            JSON.stringify(s.config, null, 2)),
        ) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-sticker-bag')
        style.textContent = CSS
        document.head.appendChild(style)
        if (typeof ctx.effect === 'function') ctx.effect(() => () => style.remove(), 'dsh-sticker-bag: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'dsh-sticker-bag', order: 40, label: '表情袋' },
          () => h(Panel),
        ))
      },
    }
  },
})
