// 表情候选源：B站的表情面板（要浏览器 cookie）。
// 用 B站是因为它的表情干净、成套、96×96，适合当「库存」慢慢挑。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

/** 从 B站凭证文件拼 cookie 头；没有就抛错，让人去设置页填 */
export function biliCookie(credFile) {
  if (!existsSync(credFile)) throw new Error(`找不到 B站凭证：${credFile}（设置页里可以改路径）`)
  const c = JSON.parse(readFileSync(credFile, 'utf8'))
  const need = ['sessdata', 'bili_jct', 'buvid3', 'dedeuserid']
  const missing = need.filter((k) => !c[k])
  if (missing.length) throw new Error(`B站凭证缺字段：${missing.join(', ')}`)
  return `SESSDATA=${c.sessdata}; bili_jct=${c.bili_jct}; buvid3=${c.buvid3}; dedeuserid=${c.dedeuserid}`
}

/** 拉表情面板，返回 [{text, emote:[{text,url}]}] */
export async function biliPanels(credFile) {
  const res = await fetch('https://api.bilibili.com/x/emote/user/panel/web?business=reply', {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: biliCookie(credFile) },
    signal: AbortSignal.timeout(15000),
  })
  const j = await res.json()
  if (j.code !== 0) throw new Error(`B站接口返回 ${j.code}：${j.message || ''}`)
  return (j.data?.packages || []).map((p) => ({
    text: p.text,
    emote: (p.emote || []).map((e) => ({ text: e.text, url: e.url })),
  }))
}

/** 下载一张到 inbox，返回本地路径 + 字节数 */
export async function downloadEmote(url, inboxDir, name) {
  mkdirSync(inboxDir, { recursive: true })
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const safe = String(name || 'emote').replace(/[\\/:*?"<>|[\]]/g, '').slice(0, 30) || 'emote'
  const file = join(inboxDir, `${safe}.png`)
  writeFileSync(file, buf)
  return { file, bytes: buf.length }
}
