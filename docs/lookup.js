// 瀏覽器端查詢邏輯(無依賴 ES module)。流程與 lib/api.mjs、lib/cards.mjs 對應。
// 驗證碼與 token 只在函式參數/記憶體中,絕不放進錯誤訊息、log 或 URL 以外的地方。
// 不加自訂 header:POST 維持「簡單請求」,不觸發 CORS preflight。
export const API_BASE = 'https://website-api.tosgame.com/api/checkup'

// kind: 'auth'(驗證碼錯誤/過期)| 'network'(連線失敗)| 'shape'(回應格式不符)| 'http'
export class LookupError extends Error {
  constructor(kind, message) { super(message); this.name = 'LookupError'; this.kind = kind }
}

async function call(f, url, init, what) {
  let res
  try { res = await f(url, init) }
  catch { throw new LookupError('network', `無法連線到遊戲伺服器(${what}),請檢查網路後再試`) } // 不帶原始錯誤(可能含 URL)
  return res
}

async function readJson(res, what) {
  try { return await res.json() }
  catch { throw new LookupError('shape', `${what}回應不是預期的格式,官方 API 可能已變動`) }
}

export async function login(uid, code, f = globalThis.fetch) {
  const url = `${API_BASE}/login?token=&uid=${encodeURIComponent(uid)}&auth=${encodeURIComponent(code)}`
  const res = await call(f, url, { method: 'POST' }, '登入')
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) throw new LookupError('auth', '登入失敗:UID 或驗證碼錯誤,或驗證碼已過期(請回遊戲重新取得)')
    throw new LookupError('http', `遊戲伺服器暫時異常(HTTP ${res.status}),請稍後再試`)
  }
  const j = await readJson(res, '登入')
  if (!j || typeof j.token !== 'string' || !j.token) throw new LookupError('shape', '登入回應沒有 token,官方 API 可能已變動')
  return j.token
}

export async function getProfile(uid, token, f = globalThis.fetch) {
  const url = `${API_BASE}/getUserProfile?targetUid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`
  const res = await call(f, url, { method: 'GET' }, '取得背包')
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new LookupError('auth', '取得背包被拒絕:驗證碼可能已過期,請重新取得')
    throw new LookupError('http', `取得背包失敗(HTTP ${res.status}),請稍後再試`)
  }
  return readJson(res, '背包')
}

// 與 lib/cards.mjs buildCards 相同的彙整(每卡號:count / 最高等級 / 最高技能 / 最高強化),
// 不含卡名(由頁面用 monsters.json 補)。
export function aggregate(profile) {
  const raw = profile?.userData?.cards
  if (!Array.isArray(raw)) throw new LookupError('shape', '背包資料格式不符(缺少卡片清單),官方 API 可能已變動')
  const byId = new Map()
  for (const c of raw) {
    if (!c || typeof c.id !== 'number') continue
    const e = byId.get(c.id)
    if (!e) {
      byId.set(c.id, { id: c.id, count: 1, maxLevel: c.level ?? 0, maxSkillLevel: c.skillLevel ?? 0, maxEnhanceLevel: c.enhanceLevel ?? 0 })
    } else {
      e.count++
      e.maxLevel = Math.max(e.maxLevel, c.level ?? 0)
      e.maxSkillLevel = Math.max(e.maxSkillLevel, c.skillLevel ?? 0)
      e.maxEnhanceLevel = Math.max(e.maxEnhanceLevel, c.enhanceLevel ?? 0)
    }
  }
  const cards = [...byId.values()].sort((a, b) => a.id - b.id)
  return { totalCards: raw.length, uniqueCards: cards.length, cards }
}
