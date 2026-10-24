// 官方互助檢視 API(流程取自 tinghan33704/tos-tools 的 src/utils.tsx)。
//   1) POST /api/checkup/login?token=&uid=<UID>&auth=<驗證碼>  -> { token }
//   2) GET  /api/checkup/getUserProfile?targetUid=<UID>&token=<token>
// 注意:login 部分尚未用真實驗證碼實測。驗證碼只在記憶體,絕不寫檔/不印出。
const BASE = 'https://website-api.tosgame.com/api/checkup'
const UA = { 'User-Agent': 'tos-backpack-personal/1.0' }

export async function login(uid, auth, f = fetch) {
  const url = `${BASE}/login?token=&uid=${encodeURIComponent(uid)}&auth=${encodeURIComponent(auth)}`
  const res = await f(url, { method: 'POST', headers: UA })
  if (!res.ok) throw new Error(`login 失敗 (HTTP ${res.status}),驗證碼可能錯誤或過期`) // 不把 url 放進訊息
  const j = await res.json()
  if (!j?.token) throw new Error('login 回應沒有 token')
  return j.token
}

export async function getProfile(uid, token, f = fetch) {
  const res = await f(`${BASE}/getUserProfile?targetUid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`, { headers: UA })
  if (!res.ok) throw new Error(`getUserProfile 失敗 (HTTP ${res.status})`)
  return res.json()
}
