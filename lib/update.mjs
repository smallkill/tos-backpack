import fs from 'node:fs'
import path from 'node:path'
import { parseMonsterData } from './monster.mjs'
import { buildCards, buildMonsterList } from './cards.mjs'
import { syncImages } from './images.mjs'
import pin from './pin.json' with { type: 'json' }

// 由 profile + monsterData 原文產出 data/*.json 並同步圖片。profile 的個資不會進任何輸出。
export async function updateFromProfile({ profile, monsterSrc, dataDir, cardsDir = dataDir, imgOpts = {}, now = new Date(), skipImages = false }) {
  const monsters = parseMonsterData(monsterSrc)
  const out = buildCards(profile, monsters, now)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(cardsDir, { recursive: true })
  fs.writeFileSync(path.join(cardsDir, 'cards.json'), JSON.stringify(out))
  fs.writeFileSync(path.join(dataDir, 'monsters.json'), JSON.stringify(buildMonsterList(monsters)))
  let images = null
  if (!skipImages) {
    // 全卡池(含沒擁有的)都要圖;repo 沒圖的 id 記在 img-missing.json(綁 SHA),下次不重試
    const missFile = path.join(dataDir, 'img-missing.json')
    let known = []
    try { const j = JSON.parse(fs.readFileSync(missFile, 'utf8')); if (j.sha === pin.sha && Array.isArray(j.ids)) known = j.ids } catch {}
    const knownSet = new Set(known)
    const ids = [...new Set([...monsters.values()].filter(m => m.id > 0 && m.name).map(m => m.id))].filter(id => !knownSet.has(id))
    images = await syncImages(ids, path.join(dataDir, 'img'), imgOpts)
    fs.writeFileSync(missFile, JSON.stringify({ sha: pin.sha, ids: [...new Set([...known, ...images.notFound])].sort((a, b) => a - b) }))
  }
  return { out, images }
}
