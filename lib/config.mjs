// 設定:優先序 命令列旗標 > 環境變數 > config.json(gitignore)。程式碼內不寫死 UID 與路徑。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SLUG_RE = /^[a-z0-9-]{1,32}$/

export function validateSlug(slug, uid) {
  if (!SLUG_RE.test(slug)) throw new Error('slug 只允許小寫英數與連字號(1~32 字元)')
  if (uid && slug.includes(String(uid))) throw new Error('slug 不可包含 UID')
  if (/\d{5,}/.test(slug)) throw new Error('slug 不可含 5 位以上連續數字(避免洩漏 UID)')
  return slug
}

// 旗標解析:支援 --key value 與 --key=value;布林旗標列在 bool
export function parseArgs(argv, bool = [], valued = []) {
  const flags = {}, positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { positional.push(a); continue }
    const [k, v] = a.slice(2).split(/=(.*)/s, 2)
    if (!bool.includes(k) && !valued.includes(k)) throw new Error(`未知旗標 --${k}`)
    if (bool.includes(k)) { if (v !== undefined) throw new Error(`--${k} 不接受值`); flags[k] = true }
    else if (v !== undefined) flags[k] = v
    else { flags[k] = argv[++i]; if (flags[k] === undefined || flags[k].startsWith('--')) throw new Error(`--${k} 需要值`) }
  }
  return { flags, positional }
}

export function loadConfig({ flags = {}, env = process.env, root }) {
  let file = {}
  try { file = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')) } catch {}
  const expand = p => p && p.replace(/^~(?=\/|$)/, os.homedir())
  const uid = flags.uid ?? env.TOS_UID ?? file.uid
  const siteDir = expand(flags.site ?? env.TOS_SITE_DIR ?? file.siteDir)
  const imgBase = flags['img-base'] || env.TOS_IMG_BASE || file.imgBase // 空字串視為未設定
  const poolBase = flags['pool-base'] || env.TOS_POOL_BASE || file.poolBase
  const slug = flags.slug !== undefined ? validateSlug(flags.slug, uid) : null
  if (uid != null && !/^\d{5,12}$/.test(String(uid))) throw new Error('UID 格式不正確(應為數字)')
  return { uid: uid != null ? String(uid) : null, siteDir: siteDir || null, slug, imgBase: imgBase || null, poolBase: poolBase || null }
}

// 各人檔案路徑
export function paths(root, slug) {
  return {
    profile: slug ? path.join(root, '.cache/profiles', `${slug}.json`) : path.join(root, '.cache/profile.json'),
    cardsDir: path.join(root, 'data'),
    friendDir: slug ? path.join(root, '.cache/users', slug) : null,
  }
}
