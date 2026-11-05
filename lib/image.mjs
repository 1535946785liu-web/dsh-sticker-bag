// 只读图片尺寸：PNG / JPEG / GIF / WebP 的头几个字节就够，不引第三方库。
import { readFileSync } from 'node:fs'

/** @param {Buffer} buf */
export function imageSize(buf) {
  if (!buf || buf.length < 16) return null
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), kind: 'png' }
  }
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), kind: 'gif' }
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) { i++; continue }
      const m = buf[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), kind: 'jpeg' }
      }
      const len = buf.readUInt16BE(i + 2)
      i += 2 + len
    }
  }
  // WebP
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    const kind = buf.subarray(12, 16).toString('ascii')
    if (kind === 'VP8 ' && buf.length > 30) {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, kind: 'webp' }
    }
    if (kind === 'VP8L' && buf.length > 25) {
      const b = buf.readUInt32LE(21)
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, kind: 'webp' }
    }
    if (kind === 'VP8X' && buf.length > 30) {
      return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), kind: 'webp' }
    }
  }
  return null
}

/** 质量筛：太小、太大、尺寸异常都不要 */
export function qualityOk(buf, { minSide = 64 } = {}) {
  if (!buf || buf.length < 500) return { ok: false, why: '文件太小（不到 500 字节）' }
  if (buf.length > 2 * 1024 * 1024) return { ok: false, why: '文件太大（超过 2MB）' }
  const s = imageSize(buf)
  if (!s) return { ok: true, size: null }
  if (s.w < minSide || s.h < minSide) return { ok: false, why: `图太小（${s.w}×${s.h}）` }
  if (s.w > 2000 || s.h > 2000) return { ok: false, why: `图太大（${s.w}×${s.h}）` }
  return { ok: true, size: s }
}

/** 读本地文件并过质量筛 */
export function checkFile(file, opts) {
  const buf = readFileSync(file)
  return { buf, ...qualityOk(buf, opts) }
}
