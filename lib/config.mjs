// 配置：插件自己的家目录 + 可以改的几项。
//
// 优先级：设置页改的（<DSH_HOME>/sticker-bag/config.json） > cordis 配置 > 默认值。
// 表情存放地址（storageDir）就是在这里被设成外接硬盘的，比如 D:\stickers。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULTS = {
  /** 表情存放地址。空 = <DSH_HOME>/stickers。可以填外接硬盘，比如 D:\stickers */
  storageDir: '',
  /** OneBot 网关地址（SnowLuma / NapCat / LLOneBot 都行） */
  onebotUrl: 'http://127.0.0.1:3000',
  /** 网关的 access token，留空表示不需要 */
  onebotToken: '',
  /** B站凭证文件（用来拉 B站表情池做候选）。空 = <DSH_HOME>/bili-duty/bili_credential.json */
  biliCredPath: '',
  /** 收表情时要求的最小边长，太小的糊图不要 */
  minSide: 64,
}

/** @param {string} p */
const isAbs = (p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export class Config {
  /** @param {any} raw cordis 传进来的配置 */
  constructor(raw = {}) {
    this.home = join(dshHome(), 'sticker-bag')
    this.file = join(this.home, 'config.json')
    /** @type {Record<string, any>} */
    this.values = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
    this.load()
  }

  load() {
    try {
      if (!existsSync(this.file)) return
      const disk = JSON.parse(readFileSync(this.file, 'utf8'))
      for (const k of Object.keys(DEFAULTS)) {
        if (disk[k] !== undefined && disk[k] !== null) this.values[k] = disk[k]
      }
    } catch {
      /* 配置坏了就用默认值，不影响插件启动 */
    }
  }

  save() {
    mkdirSync(this.home, { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.values, null, 2), 'utf8')
  }

  get(key) {
    return this.values[key]
  }

  /** 一次改几项，返回改完之后的值 */
  set(patch = {}) {
    for (const k of Object.keys(DEFAULTS)) {
      if (patch[k] !== undefined) this.values[k] = patch[k]
    }
    this.save()
    return this.values
  }

  /** 生效的表情目录（绝对路径） */
  get stickerDir() {
    const raw = String(this.values.storageDir || '').trim()
    if (!raw) return join(dshHome(), 'stickers')
    return isAbs(raw) ? raw : join(dshHome(), raw)
  }

  get biliCredFile() {
    const raw = String(this.values.biliCredPath || '').trim()
    if (!raw) return join(dshHome(), 'bili-duty', 'bili_credential.json')
    return isAbs(raw) ? raw : join(dshHome(), raw)
  }
}
