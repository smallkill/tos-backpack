// 公開卡池站(docs/,GitHub Pages):共用的 monsters.json、卡圖,加上「查詢我的背包」頁。
// 只含卡池公開資料,不含任何人的背包(cards.json 絕不進 docs/)。
import fs from 'node:fs'
import path from 'node:path'

const same = (a, b) => {
  try { const sa = fs.statSync(a), sb = fs.statSync(b); return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b)) } catch { return false }
}
function copyIfChanged(src, dst, stats) {
  if (same(src, dst)) { stats.unchanged++; return }
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  stats.copied++
}

// dataDir: data/(monsters.json、img/);webDir: web/(lookup.html、lookup.js);docsDir: 輸出
export function syncPool({ dataDir, webDir, docsDir }) {
  const stats = { copied: 0, unchanged: 0 }
  fs.mkdirSync(docsDir, { recursive: true })
  if (!fs.existsSync(path.join(docsDir, '.nojekyll'))) fs.writeFileSync(path.join(docsDir, '.nojekyll'), '')
  copyIfChanged(path.join(webDir, 'lookup.html'), path.join(docsDir, 'index.html'), stats)
  copyIfChanged(path.join(webDir, 'lookup.js'), path.join(docsDir, 'lookup.js'), stats)
  copyIfChanged(path.join(dataDir, 'monsters.json'), path.join(docsDir, 'monsters.json'), stats)
  const imgSrc = path.join(dataDir, 'img')
  if (fs.existsSync(imgSrc)) for (const f of fs.readdirSync(imgSrc)) if (f.endsWith('.webp')) copyIfChanged(path.join(imgSrc, f), path.join(docsDir, 'img', f), stats)
  return stats
}
