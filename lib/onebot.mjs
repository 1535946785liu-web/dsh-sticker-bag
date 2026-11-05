// OneBot v11 网关：发收藏表情、加/改/删收藏表情。
// 地址和 token 由用户填（设置页），默认 http://127.0.0.1:3000 —— SnowLuma / NapCat 都是这个形状。
export class OneBot {
  /** @param {import('./config.mjs').Config} cfg */
  constructor(cfg) {
    this.cfg = cfg
  }

  get base() {
    const u = String(this.cfg.get('onebotUrl') || 'http://127.0.0.1:3000').trim()
    return u.replace(/\/+$/, '') + '/'
  }

  /** @param {string} action @param {Record<string, any>} params */
  async call(action, params = {}) {
    const token = String(this.cfg.get('onebotToken') || '')
    const headers = { 'content-type': 'application/json' }
    if (token) headers.authorization = `Bearer ${token}`
    const res = await fetch(this.base, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, params, echo: Date.now() }),
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 401) {
      throw new Error('网关要 token（HTTP 401）：在 <DSH_HOME>/sticker-bag/config.json 里填 onebotToken 再刷新')
    }
    if (res.status === 403) throw new Error('网关拒绝访问（HTTP 403）：检查 onebotUrl 对不对、token 有没有过期')
    /** @type {any} */
    const j = await res.json().catch(() => null)
    if (!j) throw new Error(`网关没回 JSON（HTTP ${res.status}）`)
    if (j.retcode !== 0 && j.status !== 'ok') {
      throw new Error(`${action} 失败：${j.retcode ?? j.status} ${j.message ?? j.wording ?? ''}`.trim())
    }
    return j.data
  }

  /** 把本地图片加进 QQ 收藏，返回 emoji_id */
  async addCustomFace(file) {
    const uri = 'file:///' + String(file).replace(/\\/g, '/').replace(/^\/+/, '')
      .replace(/[^\x00-\x7F]/g, (ch) => encodeURIComponent(ch))
    const d = await this.call('add_custom_face', { file: uri })
    if (!d?.emoji_id) throw new Error('网关没返回 emoji_id（这个 OneBot 实现可能不支持 add_custom_face）')
    return d.emoji_id
  }

  /** 给收藏表情写备注 —— 备注就是它在 QQ 面板里的名字 */
  async describe(emojiId, desc) {
    try { await this.call('modify_custom_face', { emoji_id: emojiId, desc: String(desc || '').slice(0, 16) }) } catch { /* 有的实现不支持，忽略 */ }
  }

  async removeCustomFace(emojiId) {
    await this.call('delete_custom_face', { emoji_id: emojiId })
  }

  /** 发一张收藏表情。userId 和 groupId 二选一 */
  async sendSticker({ userId, groupId, emojiId }) {
    const p = { emoji_id: emojiId }
    if (groupId) p.group_id = String(groupId)
    else p.user_id = String(userId)
    return this.call('send_custom_face', p)
  }

  /** 网关通不通 */
  async ping() {
    try {
      const me = await this.call('get_login_info')
      return { ok: true, self: me }
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  }
}
