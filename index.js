// dsh-sticker-bag —— host 半端。
//
// 给模型四个工具：看库里有什么、收一张、删一张、发一张；外加一个拉候选的。
// 给使用者一个设置页：改表情存放地址（可以指到外接硬盘）、填 OneBot 地址和 token、搬家。
//
// 插件不往系统提示词里塞东西，也不拦消息——它只在被调用时干活。
import { existsSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { Config, dshHome } from './lib/config.mjs'
import { OneBot } from './lib/onebot.mjs'
import { StickerStore } from './lib/store.mjs'
import { biliPanels, downloadEmote } from './lib/source.mjs'

export const name = 'dsh-sticker-bag'
/** 没有工具服务的宿主上不激活（比如纯 headless 里没注册工具服务） */
export const inject = ['tools']

const API_PREFIX = '/sticker-bag/api'

/** @param {any} req */
const isLoopback = (req) => {
  const a = String(req?.socket?.remoteAddress ?? '')
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}

/** @param {any} req */
const sameOrigin = (req) => {
  const origin = req?.headers?.origin
  if (!origin) return true
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

/** @param {any} res @param {number} code @param {any} body */
function json(res, code, body) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/** @param {any} req @param {number} [max] */
function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    /** @type {Buffer[]} */
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > max) { reject(new Error('请求太大')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * @param {any} ctx
 * @param {any} rawConfig
 */
export function apply(ctx, rawConfig) {
  const cfg = new Config(rawConfig)
  const store = new StickerStore(cfg)
  const bot = new OneBot(cfg)
  const effect = (fn, label) => (typeof ctx.effect === 'function' ? ctx.effect(fn, label) : fn())

  // ---- 工具 ----
  const output = {
    schema: { type: 'object', properties: {}, additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
  }
  const def = (spec) => ({
    output,
    timeoutMs: 30000,
    ...spec,
    async execute(args) {
      try {
        return JSON.parse(JSON.stringify(await spec.run(args ?? {}) ?? null))
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
      }
    },
  })

  const tools = [
    def({
      name: 'sticker_list',
      description: '看表情库里有什么。可按情绪或关键词筛。返回每张的 emoji_id、名字、情绪、标签、用过几次。',
      parameters: {
        type: 'object',
        properties: {
          emotion: { type: 'string', description: '按情绪筛，比如 搞笑/嘲讽/卖萌/委屈' },
          q: { type: 'string', description: '关键词，会搜名字、标签、说明' },
          withPaths: { type: 'boolean', description: '是否返回本地文件路径（默认不返回，仿真实例会脱敏）' },
        },
        additionalProperties: false,
      },
      run({ emotion, q, withPaths }) {
        const items = store.list({ emotion: emotion || '', q: q || '' })
        const out = withPaths ? items : items.map(({ file, ...rest }) => rest)
        return { ok: true, count: out.length, dir: withPaths ? store.dir : undefined, items: out }
      },
    }),
    def({
      name: 'sticker_add',
      description: '收一张表情进 QQ 收藏和本地库。给 http(s) 图片地址，或表情袋目录里已下好的图（比如 sticker_candidates 拉下来的）。会自动质检（太小/太大/糊的拒收），并按名字写备注。',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: '本地图片路径，或 http(s) 图片地址' },
          name: { type: 'string', description: '表情名字（会成为 QQ 收藏里的备注）' },
          emotion: { type: 'string', description: '情绪：开心/搞笑/得意/嘲讽/傲娇/害羞/卖萌/委屈/难过/生气/无语/摆烂/安慰/赞同/惊讶/告别/馋饿/害怕/平淡' },
          content: { type: 'string', description: '一句话说清图里是什么、什么时候用' },
          tags: { type: 'array', items: { type: 'string' }, description: '触发关键词，最多 8 个' },
          source: { type: 'string', description: '从哪来的：bili / qq / manual / web' },
          dryRun: { type: 'boolean', description: '只质检不真收（试一下这张行不行）' },
        },
        required: ['file'],
        additionalProperties: false,
      },
      async run({ file, name, emotion, content, tags, source, dryRun }) {
        let local = String(file || '')
        const remote = /^https?:\/\//i.test(local)
        // 本地路径只收"表情袋目录里已经下好的图"：这样 QQ 那边可以自己拉候选、自己收，
        // 但拿不到"读任意本地路径"的口子。网页侧要收别处的图，先拷进 inbox 再收。
        if (!remote) {
          // 允许两处：表情库目录（storageDir）和插件自己的工作目录（candidates/ 与 downloads/）。
          // 别的本地路径一律不给，防止仿真会话借这个口子探本机文件。
          const roots = [resolve(store.dir), resolve(join(dshHome(), 'sticker-bag'))]
          const abs = resolve(local)
          const inside = roots.some((root) => {
            const rel = relative(root, abs)
            return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
          })
          if (!inside) {
            throw new Error('只能收表情袋目录里的图（候选图在 sticker-bag/candidates），或者直接给 http(s) 图片地址')
          }
        }
        if (remote) {
          const r = await downloadEmote(local, join(dshHome(), 'sticker-bag', 'downloads'), name || 'emote')
          local = r.file
        }
        if (!existsSync(local)) throw new Error(`找不到文件：${local}`)
        return store.add(bot, {
          file: local,
          name: name || '',
          emotion: emotion || '平淡',
          content: content || '',
          tags: Array.isArray(tags) ? tags.slice(0, 8) : [],
          source: source || 'manual',
          dryRun: Boolean(dryRun),
        })
      },
    }),
    def({
      name: 'sticker_remove',
      description: '从 QQ 收藏和本地库删掉一张表情。要 emoji_id。',
      parameters: {
        type: 'object',
        properties: { emoji_id: { type: 'string', description: '收藏表情 id（sticker_list 里能看到）' } },
        required: ['emoji_id'],
        additionalProperties: false,
      },
      run({ emoji_id }) {
        return store.remove(bot, String(emoji_id))
      },
    }),
    def({
      name: 'sticker_candidates',
      description: '从 B站表情池拉一批候选图到 inbox，返回清单（名字/本地路径/尺寸/质量是否合格）。拉完再挑着用 sticker_add 收。',
      parameters: {
        type: 'object',
        properties: {
          pkg: { type: 'string', description: '表情包名字的一部分，比如 小黄脸 / 热词 / 小电视；不填用第一个包' },
          n: { type: 'number', description: '拉几张，默认 20，最多 60' },
        },
        additionalProperties: false,
      },
      async run({ pkg, n }) {
        const panels = await biliPanels(cfg.biliCredFile)
        const want = String(pkg || '')
        const panel = panels.find((p) => p.text.includes(want)) || panels[0]
        if (!panel) throw new Error('B站没返回表情包')
        const have = new Set(store.list().map((x) => x.name))
        const picked = panel.emote.filter((e) => !have.has(e.text)).slice(0, Math.min(60, Number(n) || 20))
        const inbox = join(dshHome(), 'sticker-bag', 'candidates')
        const out = []
        for (const e of picked) {
          try {
            const r = await downloadEmote(e.url, inbox, e.text)
            out.push({ text: e.text, file: r.file, bytes: r.bytes })
          } catch (err) {
            out.push({ text: e.text, error: String(err?.message ?? err) })
          }
        }
        return { ok: true, pkg: panel.text, total: panel.emote.length, fetched: out.length, items: out }
      },
    }),
    def({
      name: 'sticker_send',
      description: '把一张收藏表情发出去（QQ）。userId 和 groupId 二选一。',
      parameters: {
        type: 'object',
        properties: {
          emoji_id: { type: 'string' },
          user_id: { type: 'string', description: '私聊发给谁（QQ 号）' },
          group_id: { type: 'string', description: '发到哪个群（群号）' },
        },
        required: ['emoji_id'],
        additionalProperties: false,
      },
      async run({ emoji_id, user_id, group_id }) {
        const d = await bot.sendSticker({ emojiId: String(emoji_id), userId: user_id, groupId: group_id })
        store.touch(String(emoji_id))
        return { ok: true, data: d }
      },
    }),
  ]

  for (const t of tools) effect(() => ctx.tools.register(t), `dsh-sticker-bag: tool ${t.name}`)

  // ---- 设置页接口 ----
  /** @type {any} */
  const state = async () => {
    cfg.load() // 每次打开设置页都重读配置文件：手改 config.json 不用重启
    const stats = store.stats()
    let gateway = { ok: false, error: '没配 OneBot 地址' }
    try { gateway = await bot.ping() } catch (e) { gateway = { ok: false, error: String(e?.message ?? e) } }
    return {
      ok: true,
      dir: store.dir,
      config: cfg.values,
      stats,
      gateway,
    }
  }

  const handle = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const path = url.pathname.replace(API_PREFIX, '') || '/'
    if (req.method === 'GET' && path === '/state') return json(res, 200, await state())
    if (req.method === 'POST' && path === '/config') {
      const body = JSON.parse((await readBody(req)) || '{}')
      cfg.set(body)
      return json(res, 200, { ok: true, dir: store.dir, config: cfg.values })
    }
    if (req.method === 'POST' && path === '/migrate') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const to = String(body.to || '').trim()
      if (!to) return json(res, 400, { ok: false, error: '要给个新地址' })
      const r = store.migrate(to)
      cfg.set({ storageDir: to })
      return json(res, 200, { ok: true, ...r, dir: store.dir })
    }
    return json(res, 404, { ok: false, error: '没有这个接口' })
  }

  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (c) => {
        const reg = () => c.webServer.register({
          kind: 'prefix',
          path: API_PREFIX,
          handler: async (req, res) => {
            if (!isLoopback(req)) return json(res, 403, { ok: false, error: '只接受本机访问' })
            if (req.method !== 'GET') {
              if (!sameOrigin(req)) return json(res, 403, { ok: false, error: '跨站请求被拒绝' })
              if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
                return json(res, 415, { ok: false, error: '写操作必须是 application/json' })
              }
            }
            try {
              const conn = c.get?.('connection')
              if (conn && typeof conn.requestRejection === 'function') {
                const code = conn.requestRejection(req)
                if (code !== undefined && code !== null && code !== false) {
                  res.statusCode = typeof code === 'number' ? code : 403
                  res.end()
                  return
                }
              }
              await handle(req, res)
            } catch (e) {
              json(res, 400, { ok: false, error: String(e?.message ?? e).slice(0, 200) })
            }
          },
        })
        return typeof c.effect === 'function' ? c.effect(reg, 'dsh-sticker-bag: settings api') : reg()
      })
    } catch {
      /* 没有网页服务就算了，工具还能用 */
    }
  }
}
