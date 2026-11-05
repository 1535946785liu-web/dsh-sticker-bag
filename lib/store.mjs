// 表情库：<storageDir>/index.json 记清单，<storageDir>/inbox/ 放原图。
//
// 清单里的 file 存的是**相对 storageDir 的路径**——这样整个目录搬到外接硬盘，
// 只要改一下设置里的地址，清单不用动。
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { checkFile, imageSize } from './image.mjs'

export class StickerStore {
  /** @param {import('./config.mjs').Config} cfg */
  constructor(cfg) {
    this.cfg = cfg
  }

  get dir() {
    return this.cfg.stickerDir
  }

  get indexFile() {
    return join(this.dir, 'index.json')
  }

  get inboxDir() {
    return join(this.dir, 'inbox')
  }

  ensure() {
    mkdirSync(this.inboxDir, { recursive: true })
  }

  /** @returns {{version:number, owner?:string, items:any[], updatedAt?:string}} */
  load() {
    try {
      if (existsSync(this.indexFile)) {
        const idx = JSON.parse(readFileSync(this.indexFile, 'utf8'))
        if (!Array.isArray(idx.items)) idx.items = []
        return idx
      }
    } catch {
      /* 清单坏了就当空的，别让插件起不来 */
    }
    return { version: 1, items: [] }
  }

  save(idx) {
    this.ensure()
    idx.updatedAt = new Date().toISOString()
    writeFileSync(this.indexFile, JSON.stringify(idx, null, 2), 'utf8')
  }

  /** 清单里的相对路径 → 绝对路径 */
  abs(file) {
    return isAbsolute(file) ? file : resolve(this.dir, file)
  }

  /** 清单里存相对路径（老的绝对路径顺手纠正） */
  rel(file) {
    const a = this.abs(file)
    const r = relative(this.dir, a)
    return r.startsWith('..') ? a : r
  }

  list({ emotion = '', q = '' } = {}) {
    const idx = this.load()
    const key = String(q || '').trim().toLowerCase()
    return idx.items
      .filter((x) => !emotion || String(x.emotion || '') === emotion)
      .filter((x) => {
        if (!key) return true
        const hay = [x.name, x.content, x.emotion, ...(x.tags || [])].join(' ').toLowerCase()
        return hay.includes(key)
      })
      .map((x) => ({ ...x, file: this.abs(x.file), exists: existsSync(this.abs(x.file)) }))
  }

  /** 收一张：先过质量筛，再进 QQ 收藏，再落本地 + 清单 */
  async add(onebot, { file, name, emotion = '平淡', content = '', tags = [], source = 'manual', dryRun = false }) {
    const abs = resolve(file)
    if (!existsSync(abs)) throw new Error(`找不到文件：${abs}`)
    const q = checkFile(abs, { minSide: Number(this.cfg.get('minSide')) || 64 })
    if (!q.ok) throw new Error(`这张没收：${q.why}`)
    const idx = this.load()
    const dup = idx.items.find((x) => x.file && this.abs(x.file) === abs)
    if (dup) return { ok: true, duplicated: true, emoji_id: dup.emoji_id, name: dup.name }

    const text = String(name || basename(abs).replace(/\.[^.]+$/, '')).slice(0, 20)
    if (!dryRun) {
      this.ensure()
      // 统一挪进 inbox，文件名用名字，方便人翻目录时认得
      const safe = text.replace(/[\\/:*?"<>|]/g, '')
      const dest = join(this.inboxDir, `${safe}_${Date.now().toString(36)}${suffixOf(abs)}`)
      if (abs !== dest) copyFileSync(abs, dest)
      const emojiId = await onebot.addCustomFace(dest)
      await onebot.describe(emojiId, text)
      idx.items.push({
        emoji_id: emojiId,
        name: text,
        emotion,
        content,
        tags,
        file: this.rel(dest),
        source,
        addedAt: new Date().toISOString(),
        usedCount: 0,
        size: imageSize(readFileSync(dest)),
      })
      this.save(idx)
      return { ok: true, emoji_id: emojiId, name: text, file: dest, bytes: q.buf?.length ?? 0 }
    }
    return { ok: true, dryRun: true, name: text, size: q.size }
  }

  async remove(onebot, emojiId) {
    await onebot.removeCustomFace(emojiId)
    const idx = this.load()
    idx.items = idx.items.filter((x) => x.emoji_id !== emojiId)
    this.save(idx)
    return { ok: true }
  }

  /** 标记用过一次（给「哪张最常用」用） */
  touch(emojiId) {
    const idx = this.load()
    const it = idx.items.find((x) => x.emoji_id === emojiId)
    if (it) { it.usedCount = (it.usedCount || 0) + 1; this.save(idx) }
  }

  stats() {
    const idx = this.load()
    let bytes = 0
    let missing = 0
    for (const it of idx.items) {
      const f = this.abs(it.file)
      if (existsSync(f)) bytes += statSync(f).size
      else missing++
    }
    const byEmotion = {}
    for (const it of idx.items) byEmotion[it.emotion || '未分类'] = (byEmotion[it.emotion || '未分类'] || 0) + 1
    return {
      dir: this.dir,
      count: idx.items.length,
      bytes,
      missing,
      byEmotion,
      updatedAt: idx.updatedAt || null,
    }
  }

  /**
   * 搬家：把整个目录拷到新地址，返回搬了多少。
   * 不删旧目录（万一新盘没插好呢），只在新地址建 index.json 并返回备份路径。
   */
  migrate(toDir) {
    const to = resolve(toDir)
    if (to === resolve(this.dir)) return { ok: true, moved: 0, note: '地址没变' }
    if (existsSync(to) && readdirSync(to).length > 0) throw new Error(`新地址不是空的：${to}`)
    mkdirSync(to, { recursive: true })
    const idx = this.load()
    let moved = 0
    for (const it of idx.items) {
      const src = this.abs(it.file)
      if (!existsSync(src)) continue
      const dest = join(to, 'inbox', basename(src))
      mkdirSync(join(to, 'inbox'), { recursive: true })
      copyFileSync(src, dest)
      it.file = relative(to, dest)
      moved++
    }
    writeFileSync(join(to, 'index.json'), JSON.stringify(idx, null, 2), 'utf8')
    return { ok: true, moved, from: this.dir, to, note: '旧目录没删；确认新地址没问题再自己删' }
  }
}

/** @param {string} p */
function suffixOf(p) {
  const m = /\.[a-z0-9]{2,5}$/i.exec(p)
  return m ? m[0].toLowerCase() : '.png'
}
