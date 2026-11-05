// 把 dsh-sticker-bag 发布到 GitHub —— 不需要本机装 git，走 GitHub REST API。
//
// 用法：
//   node publish.mjs --token ghp_xxxxxxxx --owner 1535946785liu-web
//   （token 只在这个进程里用，不落盘）
//
// 做的事：建仓库（如果还没建）→ 逐个文件上传 → 打印仓库地址。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, dflt = '') => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const token = getArg('token') || process.env.GITHUB_TOKEN || '';
const owner = getArg('owner') || '1535946785liu-web';
const repo = getArg('repo') || 'dsh-sticker-bag';
const dir = path.resolve(getArg('dir') || '.');

if (!token) {
  console.error('缺 token：node publish.mjs --token ghp_xxx --owner ' + owner);
  process.exit(1);
}

const H = {
  authorization: 'Bearer ' + token,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'content-type': 'application/json',
  'user-agent': 'dsh-sticker-bag-publisher',
};

const api = async (method, p, body) => {
  const res = await fetch('https://api.github.com' + p, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text) } catch { /* 非 JSON */ }
  if (!res.ok) {
    const msg = json?.message || text.slice(0, 200);
    throw new Error(`${method} ${p} -> ${res.status} ${msg}`);
  }
  return json;
};

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const me = await api('GET', '/user');
console.log('登录身份：', me.login);

let repoInfo = null;
try {
  repoInfo = await api('GET', `/repos/${owner}/${repo}`);
  console.log('仓库已存在：', repoInfo.html_url);
} catch (e) {
  if (!String(e.message).includes('404')) throw e;
  repoInfo = await api('POST', '/user/repos', {
    name: repo,
    description: '给 DSH 的表情袋：收表情、打标签、按情绪挑、一句话发出去。',
    homepage: '',
    private: false,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    license_template: 'mit',
  });
  console.log('仓库已创建：', repoInfo.html_url);
}

const files = walk(dir);
let ok = 0;
for (const f of files) {
  const rel = path.relative(dir, f).replace(/\\/g, '/');
  const content = fs.readFileSync(f).toString('base64');
  let sha = null;
  try {
    const cur = await api('GET', `/repos/${owner}/${repo}/contents/${encodeURIComponent(rel)}?ref=main`);
    sha = cur.sha;
  } catch { /* 新文件 */ }
  await api('PUT', `/repos/${owner}/${repo}/contents/${encodeURIComponent(rel)}`, {
    message: (sha ? 'update: ' : 'add: ') + rel,
    content,
    branch: 'main',
    ...(sha ? { sha } : {}),
  });
  ok++;
  console.log('  ↑', rel);
}

console.log(`\n完成：${ok} 个文件 → ${repoInfo.html_url}`);
console.log(`安装：dsh plugin --profile web add dsh-sticker-bag`);
