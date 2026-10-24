// 圖片增量同步:只抓「擁有、但本地還沒有」的卡片圖,轉 webp。有快取不重抓。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
import pin from './pin.json' with { type: 'json' }
export const rawBase = (sha = pin.sha) => `https://raw.githubusercontent.com/${pin.repo}/${sha}/`
export const IMG_BASE = rawBase() + 'src/img/monster/'

const okFile = f => { try { return fs.statSync(f).size > 0 } catch { return false } }

export function missingImages(ids, imgDir) {
  return ids.filter(id => !okFile(path.join(imgDir, `${id}.webp`)))
}

// PNG bytes -> webp bytes (96px, 用 Pillow)
export function pngToWebp(buf, size = 96) {
  const r = spawnSync('python3', ['-I', path.join(HERE, 'to_webp.py'), String(size)], { input: buf, maxBuffer: 1 << 24 })
  if (r.status !== 0) throw new Error('webp 轉檔失敗: ' + r.stderr?.toString().slice(0, 200))
  return r.stdout
}

export async function httpFetchPng(id) {
  const res = await fetch(`${IMG_BASE}${id}.png`, { headers: { 'User-Agent': 'tos-backpack-personal/1.0' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${id}`)
  return Buffer.from(await res.arrayBuffer())
}

// fetchPng/convert/sleep 可注入(測試用)
export async function syncImages(ids, imgDir, { fetchPng = httpFetchPng, convert = pngToWebp, delayMs = 250, sleep = ms => new Promise(r => setTimeout(r, ms)), log = () => {} } = {}) {
  fs.mkdirSync(imgDir, { recursive: true })
  const todo = missingImages(ids, imgDir)
  const res = { requested: ids.length, cached: ids.length - todo.length, downloaded: 0, notFound: [], failed: [] }
  let i = 0
  for (const id of todo) {
    if (i++ > 0) await sleep(delayMs)
    try {
      const png = await fetchPng(id)
      if (!png) { res.notFound.push(id); continue }
      const dest = path.join(imgDir, `${id}.webp`), tmp = dest + '.tmp'
      fs.writeFileSync(tmp, convert(png))
      fs.renameSync(tmp, dest)
      res.downloaded++
      if (res.downloaded % 100 === 0) log(`  圖片 ${res.downloaded}/${todo.length}`)
    } catch (e) {
      res.failed.push(id)
      log(`  圖片 ${id} 失敗: ${e.message}`)
    }
  }
  return res
}
