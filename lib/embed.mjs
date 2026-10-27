// 朋友版:把 cards + 卡池欄位內嵌進單一自含 index.html(可離線開、可直接傳給朋友)。

export function checkImgBase(u) {
  if (!u) throw new Error('朋友版需要卡圖網址:config.json 的 imgBase、環境變數 TOS_IMG_BASE 或 --img-base(你自己網站 img/ 的公開網址)')
  if (!/^https:\/\/[^\s"'<>]+\/$/.test(u)) throw new Error('imgBase 需為 https 網址且以 / 結尾')
  return u
}

// JSON 放進 <script> 前要跳脫,避免 </script> 與行分隔字元
const safeJson = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

// 在 <meta charset> 後加 CSP:圖片/資料只允許來自指定網址的 origin,擋外送與 <base>/表單/外掛。
// script-src 需 'unsafe-inline':資料以行內 <script> 注入(朋友版要單檔可離線)且圖片失敗用行內 onerror。
const CHARSET = '<meta charset="utf-8">'
function addCsp(html, { img, connect }) {
  const csp = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src ${img}; connect-src ${connect}; base-uri 'none'; form-action 'none'; object-src 'none'`
  const i = html.indexOf(CHARSET)
  if (i < 0) return html // 測試用的極簡模板沒有 <head>
  const at = i + CHARSET.length
  return html.slice(0, at) + `\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n<meta name="referrer" content="no-referrer">` + html.slice(at)
}
const origin = u => new URL(u).origin

export function buildEmbedHtml(template, cardsOut, monsterList, imgBase) {
  checkImgBase(imgBase)
  // 已知卡的名稱/屬性等可由卡池還原,內嵌時省略以縮小體積;未知卡號保留名稱
  const cards = { ...cardsOut, cards: cardsOut.cards.map(c => c.unknown ? c : { id: c.id, count: c.count, maxLevel: c.maxLevel, maxSkillLevel: c.maxSkillLevel, maxEnhanceLevel: c.maxEnhanceLevel }) }
  const tag = `<script>window.TOS_EMBED=${safeJson({ cards, monsters: monsterList, imgBase })}</script>\n`
  const i = template.indexOf('<script>')
  if (i < 0) throw new Error('模板缺少 <script>')
  return addCsp(template.slice(0, i) + tag + template.slice(i), { img: origin(imgBase), connect: "'none'" })
}

export function checkPoolBase(u) {
  if (!u) throw new Error('--publish 需要卡池網址:config.json 的 poolBase、環境變數 TOS_POOL_BASE 或 --pool-base(共用 monsters.json 與 img/ 的公開網址)')
  if (!/^https:\/\/[^\s"'<>]+\/$/.test(u)) throw new Error('poolBase 需為 https 網址且以 / 結尾')
  return u
}

// 自己的版本:在第一個 <script> 前注入共用卡池網址(monsters.json 與 img/ 由此載入)
export function injectPoolBase(template, poolBase) {
  checkPoolBase(poolBase)
  const i = template.indexOf('<script>')
  if (i < 0) throw new Error('模板缺少 <script>')
  const html = template.slice(0, i) + `<script>window.TOS_POOL_BASE=${safeJson(poolBase)}</script>\n` + template.slice(i)
  return addCsp(html, { img: origin(poolBase), connect: `'self' ${origin(poolBase)}` })
}

// 朋友版卡圖網址:明確的 imgBase 優先,否則退回共用卡池站的 poolBase + 'img/',都沒有就報錯
export function resolveImgBase(imgBase, poolBase) {
  return checkImgBase(imgBase || (poolBase ? checkPoolBase(poolBase) + 'img/' : null))
}
