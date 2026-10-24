import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { monsterSrc, profile } from './fixtures.mjs'
import { parseMonsterData } from '../lib/monster.mjs'
import { buildCards, buildMonsterList } from '../lib/cards.mjs'
import { syncImages, missingImages, pngToWebp } from '../lib/images.mjs'
import { updateFromProfile } from '../lib/update.mjs'
import { login } from '../lib/api.mjs'
import { readAuth } from '../lib/auth.mjs'
import { Readable } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { validateSlug, parseArgs, loadConfig, paths } from '../lib/config.mjs'

const tmp = () => fs.mkdtempSync(path.join(process.env.HOME, 'projects/tos-backpack/.cache/test-'))

test('parseMonsterData 正規解析 TS 檔', () => {
  const m = parseMonsterData(monsterSrc)
  assert.equal(m.get(1).name, '莫莉')
  assert.equal(m.get(5).race, '獸類')
  assert.equal(m.size, 4)
})

test('buildCards 合併同卡號:count/最高值/最早取得;未知卡號標記', () => {
  const o = buildCards(profile, parseMonsterData(monsterSrc), new Date('2026-10-24T00:00:00Z'))
  assert.equal(o.totalCards, 5)
  assert.equal(o.uniqueCards, 4)
  const c1 = o.cards.find(c => c.id === 1)
  assert.deepEqual([c1.count, c1.maxLevel, c1.maxSkillLevel, c1.maxEnhanceLevel], [2, 99, 3, 4])
  assert.ok(!('firstAcquiredAt' in c1))
  assert.equal(c1.name, '莫莉')
  assert.deepEqual(o.cards.filter(c => c.unknown).map(c => c.id), [7, 9999])
  assert.equal(o.unknownCount, 2)
  assert.equal(o.updatedAt, '2026-10-24')
})

test('輸出不含個資', () => {
  const o = JSON.stringify(buildCards(profile, parseMonsterData(monsterSrc)))
  for (const s of ['999000111', 'SECRET-NAME', 'SECRET-MSG', 'displayName', 'uid', 'firstAcquiredAt', 'acquiredAt']) assert.ok(!o.includes(s), s)
})

test('buildMonsterList 略過 id 0 與無名', () => {
  assert.deepEqual(buildMonsterList(parseMonsterData(monsterSrc)).map(r => r[0]), [1, 5])
})

test('圖片增量:只抓缺的、有快取不重抓、404 記錄、失敗不中斷、有間隔', async () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, '1.webp'), 'x')
  const asked = [], sleeps = []
  const fetchPng = async id => { asked.push(id); if (id === 5) return null; if (id === 6) throw new Error('boom'); return Buffer.from('png') }
  const convert = b => Buffer.from('webp:' + b)
  const r = await syncImages([1, 2, 5, 6, 3], d, { fetchPng, convert, sleep: async ms => sleeps.push(ms), delayMs: 200 })
  assert.deepEqual(asked, [2, 5, 6, 3])
  assert.deepEqual(r, { requested: 5, cached: 1, downloaded: 2, notFound: [5], failed: [6] })
  assert.equal(sleeps.length, 3)
  assert.deepEqual(missingImages([1, 2, 3], d), [])
  const r2 = await syncImages([1, 2, 3], d, { fetchPng, convert, sleep: async () => {} })
  assert.equal(r2.downloaded, 0) // 第二次全走快取
  fs.rmSync(d, { recursive: true })
})

test('pngToWebp 真轉檔(Pillow)', async () => {
  const { execFileSync } = await import('node:child_process')
  const png = execFileSync('python3', ['-I', '-c', "import io,sys;from PIL import Image;b=io.BytesIO();Image.new('RGBA',(100,100),(255,0,0,255)).save(b,'PNG');sys.stdout.buffer.write(b.getvalue())"])
  const w = pngToWebp(png)
  assert.equal(w.subarray(0, 4).toString(), 'RIFF')
  assert.equal(w.subarray(8, 12).toString(), 'WEBP')
})

test('updateFromProfile 端到端(fixture)寫出 cards/monsters/img', async () => {
  const d = tmp()
  const { out, images } = await updateFromProfile({ profile, monsterSrc, dataDir: d, imgOpts: { fetchPng: async () => Buffer.from('p'), convert: b => b, sleep: async () => {} } })
  assert.equal(out.uniqueCards, 4)
  assert.equal(images.downloaded, 2) // 全卡池有名稱者(1,5);未知卡號 9999 不抓
  const c = JSON.parse(fs.readFileSync(path.join(d, 'cards.json'), 'utf8'))
  assert.equal(c.cards.length, 4)
  assert.ok(fs.existsSync(path.join(d, 'monsters.json')))
  assert.deepEqual(fs.readdirSync(path.join(d, 'img')).sort(), ['1.webp', '5.webp'])
  fs.rmSync(d, { recursive: true })
})

test('login 解析 token、錯誤訊息不洩漏驗證碼(mock)', async () => {
  let seen
  const ok = async (url, o) => { seen = { url, method: o.method }; return { ok: true, json: async () => ({ token: 'T' }) } }
  assert.equal(await login('123', 'ABC123', ok), 'T')
  assert.equal(seen.method, 'POST')
  assert.match(seen.url, /login\?token=&uid=123&auth=ABC123$/)
  await assert.rejects(login('123', 'ABC123', async () => ({ ok: false, status: 401 })), e => !e.message.includes('ABC123'))
  await assert.rejects(login('123', 'x', async () => ({ ok: true, json: async () => ({}) })), /token/)
})

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

test('parseMonsterData 不執行程式碼:呼叫/識別字/插值一律拒絕,且無副作用', () => {
  globalThis.__pwned = 0
  const bad = [
    "export const monsterData: IObject[] = [{ 'id': 1, 'name': (globalThis.__pwned = 1, 'x') }]",
    "export const monsterData: IObject[] = [{ 'id': 1, 'name': `a${globalThis.__pwned = 1}` }]",
    "export const monsterData: IObject[] = [{ 'id': 1, 'name': foo() }]",
    "export const monsterData: IObject[] = [{ 'id': 1, 'name': process.exit(9) }]",
  ]
  for (const b of bad) assert.throws(() => parseMonsterData(b))
  assert.equal(globalThis.__pwned, 0)
  assert.throws(() => parseMonsterData("globalThis.__pwned=1; export const monsterData: IObject[] = []"))
  assert.equal(globalThis.__pwned, 0)
  const ok = parseMonsterData("export const monsterData: IObject[] = [{ 'id': 3, 'name': 'a', 'vrPair': -1, 'skill': [{ 'd': `x` }] }]")
  assert.equal(ok.get(3).name, 'a')
})

test('真實 monsterData(若有快取)全部對得到名稱', () => {
  const f = path.join(ROOT, '.cache/monsterData.tsx')
  if (!fs.existsSync(f)) return
  const m = parseMonsterData(fs.readFileSync(f, 'utf8'))
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache/profile.json'), 'utf8'))
  const o = buildCards(p, m)
  assert.equal(m.size, 4548)
  assert.equal(o.unknownCount, 0)
})

test('圖片:0 byte 檔視為缺、寫入用 .tmp 後 rename、無殘留 .tmp', async () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, '1.webp'), '')
  fs.writeFileSync(path.join(d, '2.webp'), 'ok')
  assert.deepEqual(missingImages([1, 2], d), [1])
  await syncImages([1], d, { fetchPng: async () => Buffer.from('p'), convert: b => b, sleep: async () => {} })
  assert.equal(fs.readFileSync(path.join(d, '1.webp'), 'utf8'), 'p')
  assert.ok(!fs.readdirSync(d).some(f => f.endsWith('.tmp')))
  fs.rmSync(d, { recursive: true })
})

test('readAuth:env 優先;非 TTY 讀 stdin 第一行', async () => {
  assert.equal(await readAuth({ env: { TOS_AUTH: ' ABC123 ' } }), 'ABC123')
  const input = Readable.from(['XYZ789\nignored\n']); input.isTTY = false
  assert.equal(await readAuth({ env: {}, input }), 'XYZ789')
})

test('tos-update 拒絕命令列參數(驗證碼不走 argv)', () => {
  const r = spawnSync('node', [path.join(ROOT, 'bin/tos-update'), 'ABC123'], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.ok(!(r.stdout + r.stderr).includes('ABC123'))
})

test('tos-update --publish 遇到 git 失敗時退出碼非 0', () => {
  const d = tmp(); const site = path.join(d, 'tos-cards')
  const r = spawnSync('node', [path.join(ROOT, 'bin/tos-update'), '--offline', '--no-images', '--publish'], { encoding: 'utf8', env: { ...process.env, TOS_SITE_DIR: site } })
  assert.equal(r.status, 1)
  fs.rmSync(d, { recursive: true })
})

test('index.html 的 esc 會跳脫單引號與 data-v/種族/屬性', () => {
  const hf = path.join(process.env.HOME, 'projects/guide/tos-cards/index.html')
  if (!fs.existsSync(hf)) return
  const html = fs.readFileSync(hf, 'utf8')
  const m = html.match(/const esc=(.*);\n/)
  const esc = new Function('return ' + m[1])()
  assert.equal(esc(`<a href='x' b="y">&`), '&lt;a href=&#39;x&#39; b=&quot;y&quot;&gt;&amp;')
  assert.match(html, /data-v="\$\{esc\(v\)\}"/)
  assert.match(html, /\$\{esc\(x\.att\)\}/)
  assert.match(html, /esc\(x\.race\)/)
})

test('全卡池抓圖:沒擁有的卡也抓;404 記入 img-missing.json,下次不重試', async () => {
  const d = tmp(); const asked = []
  const opts = { fetchPng: async id => { asked.push(id); return id === 5 ? null : Buffer.from('p') }, convert: b => b, sleep: async () => {} }
  const prof = { userData: { cards: [{ id: 1, level: 1, skillLevel: 1, enhanceLevel: 0 }] } } // 只擁有 1
  await updateFromProfile({ profile: prof, monsterSrc, dataDir: d, imgOpts: opts })
  assert.deepEqual(asked.sort(), [1, 5])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'img-missing.json'), 'utf8')).ids, [5])
  asked.length = 0
  await updateFromProfile({ profile: prof, monsterSrc, dataDir: d, imgOpts: opts })
  assert.deepEqual(asked, [])
  fs.rmSync(d, { recursive: true })
})

test('slug 驗證:合法/非法/含 UID/長數字', () => {
  assert.equal(validateSlug('amy-2', '111222333'), 'amy-2')
  for (const bad of ['', 'Amy', 'a_b', 'a b', '../x', 'a/b', 'x'.repeat(33), 'u111222333', 'a12345']) assert.throws(() => validateSlug(bad, '111222333'), bad)
})

test('parseArgs / loadConfig 優先序:旗標 > env > config.json', () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ uid: '111111111', siteDir: '~/fromfile' }))
  const f = parseArgs(['--uid', '222222222', '--slug=amy', '--offline'], ['offline'], ['uid', 'slug']).flags
  assert.deepEqual(f, { uid: '222222222', slug: 'amy', offline: true })
  assert.equal(loadConfig({ flags: {}, env: {}, root: d }).uid, '111111111')
  assert.equal(loadConfig({ flags: {}, env: { TOS_UID: '333333333' }, root: d }).uid, '333333333')
  const c = loadConfig({ flags: f, env: { TOS_UID: '333333333' }, root: d })
  assert.equal(c.uid, '222222222'); assert.equal(c.slug, 'amy'); assert.ok(c.siteDir.endsWith('/fromfile') && !c.siteDir.includes('~'))
  assert.throws(() => loadConfig({ flags: { uid: 'abc' }, env: {}, root: d }))
  assert.throws(() => loadConfig({ flags: { uid: '222222222', slug: 'a222222222b' }, env: {}, root: d }))
  assert.throws(() => parseArgs(['--uid'], [], ['uid']))
  assert.throws(() => parseArgs(['--slugg', 'amy'], [], ['slug']), /未知旗標/)
  assert.throws(() => parseArgs(['--nologo', '123456'], ['offline'], ['uid']), /未知旗標/)
  assert.throws(() => parseArgs(['--offline=false'], ['offline']), /不接受值/)
  assert.throws(() => loadConfig({ flags: { slug: '' }, env: {}, root: d }))
  assert.deepEqual(paths('/r', 'amy'), { profile: '/r/.cache/profiles/amy.json', cardsDir: '/r/data', friendDir: '/r/.cache/users/amy' })
  assert.equal(paths('/r', null).profile, '/r/.cache/profile.json')
  fs.rmSync(d, { recursive: true })
})

test('朋友版:自含 index.html,不碰 data/ 與網站目錄、不含 uid/暱稱、卡圖指向 imgBase', () => {
  const real = path.join(ROOT, '.cache/profile.json')
  if (!fs.existsSync(real)) return
  const d = tmp(), out = path.join(d, 'out'), prof = path.join(ROOT, '.cache/profiles'); fs.mkdirSync(prof, { recursive: true })
  fs.copyFileSync(real, path.join(prof, 't-amy.json'))
  const cardsBefore = fs.readFileSync(path.join(ROOT, 'data/cards.json'), 'utf8')
  try {
    const r = spawnSync('node', [path.join(ROOT, 'bin/tos-update'), '--offline', '--slug', 't-amy', '--uid', '444444444', '--out', out], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr + r.stdout)
    assert.deepEqual(fs.readdirSync(out), ['index.html'])
    const h = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
    assert.match(h, /window\.TOS_EMBED=/)
    assert.ok(h.includes('https://smallkill.github.io/guide/tos-cards/img/'))
    for (const bad of ['444444444', '111222333', JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).uid, 'displayName', 'SECRET', '"acquiredAt"']) assert.ok(!h.includes(bad), bad)
    assert.equal(fs.readFileSync(path.join(ROOT, 'data/cards.json'), 'utf8'), cardsBefore) // Derek 資料不受影響
    // 內嵌資料可還原
    const m = h.match(/window\.TOS_EMBED=(.*)<\/script>/); const E = JSON.parse(m[1])
    assert.equal(E.cards.uniqueCards, E.cards.cards.length); assert.ok(E.monsters.length > 4000)
  } finally { fs.rmSync(path.join(prof, 't-amy.json'), { force: true }); fs.rmSync(path.join(ROOT, '.cache/users/t-amy'), { recursive: true, force: true }); fs.rmSync(d, { recursive: true }) }
})

test('朋友版必須明確 --uid;不可 --publish', () => {
  const bin = path.join(ROOT, 'bin/tos-update')
  assert.equal(spawnSync('node', [bin, '--slug', 'amy'], { encoding: 'utf8', input: 'x\n' }).status, 2)
  assert.equal(spawnSync('node', [bin, '--offline', '--slug', 'amy', '--publish'], { encoding: 'utf8' }).status, 2)
})

test('buildEmbedHtml:跳脫 </script>、拒絕不安全 imgBase', async () => {
  const { buildEmbedHtml } = await import('../lib/embed.mjs')
  const h = buildEmbedHtml('<html><script>x</script>', { cards: [{ id: 1, name: '</script><b>', unknown: true }] }, [[1, '</script>', '', '', 0]])
  assert.equal((h.match(/<\/script>/g) || []).length, 2) // 只有注入的結尾 + 模板自己的
  assert.throws(() => buildEmbedHtml('<script>', { cards: [] }, [], 'javascript:alert(1)'))
  assert.throws(() => buildEmbedHtml('<script>', { cards: [] }, [], 'https://x.com/"onerror='))
})

test('非法 slug 被拒(exit 2)', () => {
  const r = spawnSync('node', [path.join(ROOT, 'bin/tos-update'), '--offline', '--slug', '../evil'], { encoding: 'utf8' })
  assert.equal(r.status, 2)
})

test('git 追蹤檔不含 data/img、.cache、profile、config.json', () => {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' })
  if (r.status !== 0) return
  for (const f of r.stdout.split('\n').filter(Boolean)) assert.ok(!/^(data\/|\.cache\/|config\.json)/.test(f) && !/profile/.test(f), f)
})

test('身分防呆:主頁不可用別人的 --uid;朋友版不可用自己的 UID', () => {
  const bin = path.join(ROOT, 'bin/tos-update')
  if (!fs.existsSync(path.join(ROOT, 'config.json'))) return
  const cfgUid = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).uid
  assert.equal(spawnSync('node', [bin, '--offline', '--uid', '999888777'], { encoding: 'utf8' }).status, 2)
  assert.equal(spawnSync('node', [bin, '--offline', '--slug', 'amy', '--uid', cfgUid], { encoding: 'utf8' }).status, 2)
  assert.equal(spawnSync('node', [bin, '--offline', '--slug', '', '--uid', '999888777'], { encoding: 'utf8' }).status, 2)
})

test('朋友版 --out 不可指到網站目錄/專案內 data、web;離線朋友版不需 --uid', () => {
  const bin = path.join(ROOT, 'bin/tos-update')
  const real = path.join(ROOT, '.cache/profile.json'); if (!fs.existsSync(real)) return
  const prof = path.join(ROOT, '.cache/profiles'); fs.mkdirSync(prof, { recursive: true })
  fs.copyFileSync(real, path.join(prof, 't-out.json'))
  const d = tmp(), site = path.join(d, 'site'); fs.mkdirSync(site)
  const run = (...a) => spawnSync('node', [bin, '--offline', '--slug', 't-out', ...a], { encoding: 'utf8' })
  try {
    assert.equal(run('--out', site, '--site', site).status, 2)
    assert.equal(run('--out', path.join(site, 'x'), '--site', site).status, 2)
    assert.equal(run('--out', path.join(ROOT, 'web')).status, 2)
    assert.equal(run('--out', path.join(ROOT, 'data')).status, 2)
    const ok = run('--out', path.join(d, 'out'))
    assert.equal(ok.status, 0, ok.stderr + ok.stdout) // 不給 --uid 的離線朋友版可用
    assert.ok(fs.existsSync(path.join(d, 'out/index.html')))
  } finally { fs.rmSync(path.join(prof, 't-out.json'), { force: true }); fs.rmSync(path.join(ROOT, '.cache/users/t-out'), { recursive: true, force: true }); fs.rmSync(d, { recursive: true }) }
})
