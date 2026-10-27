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
import { syncPool } from '../lib/pool.mjs'
import { injectPoolBase, resolveImgBase } from '../lib/embed.mjs'
import { validateSlug, parseArgs, loadConfig, paths } from '../lib/config.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tos-backpack-test-'))

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
  const r = spawnSync('node', [path.join(ROOT, 'bin/tos-update'), '--offline', '--no-images', '--publish'], { encoding: 'utf8', env: { ...process.env, TOS_SITE_DIR: site, TOS_POOL_BASE: 'https://pool.example/', TOS_DOCS_DIR: path.join(d, 'docs') } })
  assert.equal(r.status, 1)
  fs.rmSync(d, { recursive: true })
})

test('index.html 的 esc 會跳脫單引號與 data-v/種族/屬性', () => {
  const hf = path.join(ROOT, 'web/index.html')
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
  assert.equal(c.imgBase, null)
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ uid: '111111111', imgBase: 'https://file/' }))
  assert.equal(loadConfig({ flags: {}, env: {}, root: d }).imgBase, 'https://file/')
  assert.equal(loadConfig({ flags: {}, env: { TOS_IMG_BASE: 'https://env/' }, root: d }).imgBase, 'https://env/')
  assert.equal(loadConfig({ flags: { 'img-base': 'https://flag/' }, env: { TOS_IMG_BASE: 'https://env/' }, root: d }).imgBase, 'https://flag/')
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
    const r = spawnSync('node', [path.join(ROOT, 'bin/tos-update'), '--offline', '--slug', 't-amy', '--uid', '444444444', '--out', out, '--img-base', 'https://img.example/tos/'], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr + r.stdout)
    assert.deepEqual(fs.readdirSync(out), ['index.html'])
    const h = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
    assert.match(h, /window\.TOS_EMBED=/)
    assert.ok(h.includes('https://img.example/tos/'))
    for (const bad of ['444444444', '111222333', JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).uid, 'displayName', 'SECRET', '"acquiredAt"']) assert.ok(!h.includes(bad), bad)
    assert.equal(fs.readFileSync(path.join(ROOT, 'data/cards.json'), 'utf8'), cardsBefore) // 自己的資料不受影響
    // 內嵌資料可還原
    const m = h.match(/window\.TOS_EMBED=(.*)<\/script>/); const E = JSON.parse(m[1])
    assert.equal(E.cards.uniqueCards, E.cards.cards.length); assert.ok(E.monsters.length > 4000)
  } finally { fs.rmSync(path.join(prof, 't-amy.json'), { force: true }); fs.rmSync(path.join(ROOT, '.cache/users/t-amy'), { recursive: true, force: true }); fs.rmSync(d, { recursive: true }) }
})

test('朋友版必須明確 --uid;不可 --publish', () => {
  const bin = path.join(ROOT, 'bin/tos-update')
  // 卡圖網址無效時,在讀驗證碼/登入前就 exit 2(用無效值蓋過任何本機 config.json)
  const nb = spawnSync('node', [bin, '--slug', 'amy', '--uid', '444444444', '--img-base', 'http://no/'], { encoding: 'utf8', input: '' })
  assert.equal(nb.status, 2); assert.match(nb.stderr, /https/); assert.ok(!/驗證碼|login/.test(nb.stderr))
  assert.equal(spawnSync('node', [bin, '--slug', 'amy'], { encoding: 'utf8', input: 'x\n' }).status, 2)
  assert.equal(spawnSync('node', [bin, '--offline', '--slug', 'amy', '--publish'], { encoding: 'utf8' }).status, 2)
})

test('buildEmbedHtml:跳脫 </script>、拒絕不安全 imgBase', async () => {
  const { buildEmbedHtml } = await import('../lib/embed.mjs')
  const h = buildEmbedHtml('<html><script>x</script>', { cards: [{ id: 1, name: '</script><b>', unknown: true }] }, [[1, '</script>', '', '', 0]], 'https://img.example/')
  assert.throws(() => buildEmbedHtml('<script>', { cards: [] }, []), /卡圖網址/)
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
  const run = (...a) => spawnSync('node', [bin, '--offline', '--slug', 't-out', '--img-base', 'https://img.example/', ...a], { encoding: 'utf8' })
  const bad = r => { assert.equal(r.status, 2); assert.match(r.stderr, /--out/) }
  try {
    bad(run('--out', site, '--site', site))
    bad(run('--out', path.join(site, 'x'), '--site', site))
    bad(run('--out', path.join(ROOT, 'web')))
    bad(run('--out', path.join(ROOT, 'data')))
    const ok = run('--out', path.join(d, 'out'))
    assert.equal(ok.status, 0, ok.stderr + ok.stdout) // 不給 --uid 的離線朋友版可用
    assert.ok(fs.existsSync(path.join(d, 'out/index.html')))
  } finally { fs.rmSync(path.join(prof, 't-out.json'), { force: true }); fs.rmSync(path.join(ROOT, '.cache/users/t-out'), { recursive: true, force: true }); fs.rmSync(d, { recursive: true }) }
})

// ---- 公開「查詢我的背包」頁(web/lookup.*) ----
const lookup = await import('../web/lookup.js')

test('lookup.aggregate 與 lib/cards.mjs buildCards 的每卡欄位一致', () => {
  const built = buildCards(profile, parseMonsterData(monsterSrc))
  const agg = lookup.aggregate(profile)
  const pick = ({ id, count, maxLevel, maxSkillLevel, maxEnhanceLevel }) => ({ id, count, maxLevel, maxSkillLevel, maxEnhanceLevel })
  assert.deepEqual(agg.cards, built.cards.map(pick))
  assert.equal(agg.totalCards, built.totalCards)
  assert.equal(agg.uniqueCards, built.uniqueCards)
})

test('lookup.aggregate 格式不符時丟 shape 錯誤', () => {
  for (const bad of [null, {}, { userData: {} }, { userData: { cards: 'x' } }]) {
    assert.throws(() => lookup.aggregate(bad), e => e.kind === 'shape')
  }
})

test('lookup.login / getProfile 呼叫正確的 URL 與方法', async () => {
  const calls = []
  const f = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, json: async () => (url.includes('/login') ? { token: 'TKN/1' } : { userData: { cards: [] } }) } }
  const t = await lookup.login('123456', 'AB12 3', f)
  assert.equal(t, 'TKN/1')
  assert.equal(calls[0][0], 'https://website-api.tosgame.com/api/checkup/login?token=&uid=123456&auth=AB12%203')
  assert.equal(calls[0][1].method, 'POST')
  assert.ok(!calls[0][1].headers, '不加自訂 header(避免 CORS preflight)')
  const p = await lookup.getProfile('123456', t, f)
  assert.deepEqual(p, { userData: { cards: [] } })
  assert.equal(calls[1][0], 'https://website-api.tosgame.com/api/checkup/getUserProfile?targetUid=123456&token=TKN%2F1')
  assert.equal(calls[1][1].method, 'GET')
})

test('lookup 錯誤訊息不含驗證碼 / token / URL', async () => {
  const CODE = 'SECRETCODE987', TOKEN = 'SECRETTOKEN654'
  const leaks = e => [CODE, TOKEN, 'tosgame'].some(s => String(e.message).includes(s)) || /https?:\/\//.test(e.message)
  const cases = [
    () => lookup.login('123456', CODE, async () => ({ ok: false, status: 401 })),
    () => lookup.login('123456', CODE, async () => ({ ok: false, status: 500 })),
    () => lookup.login('123456', CODE, async url => { throw new TypeError('fetch failed ' + url) }),
    () => lookup.login('123456', CODE, async () => ({ ok: true, status: 200, json: async () => ({}) })),
    () => lookup.login('123456', CODE, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad ' + CODE) } })),
    () => lookup.getProfile('123456', TOKEN, async () => ({ ok: false, status: 403 })),
    () => lookup.getProfile('123456', TOKEN, async () => ({ ok: false, status: 502 })),
    () => lookup.getProfile('123456', TOKEN, async url => { throw new TypeError(url) }),
  ]
  const kinds = []
  for (const c of cases) {
    await assert.rejects(c(), e => { kinds.push(e.kind); assert.ok(!leaks(e), e.message); assert.equal(e.cause, undefined); return true })
  }
  assert.deepEqual(kinds, ['auth', 'http', 'network', 'shape', 'shape', 'auth', 'http', 'network'])
})

test('lookup.html 不引用 cards.json、不含擁有者絕對網址、有 CSP 與 noindex', () => {
  const html = fs.readFileSync(path.join(ROOT, 'web/lookup.html'), 'utf8')
  assert.ok(!html.includes('cards.json'))
  assert.ok(!/smallkill/i.test(html))
  assert.ok(!/https?:\/\/(?!website-api\.tosgame\.com)/.test(html), '只允許官方 API 的絕對網址')
  assert.match(html, /name="robots" content="noindex"/)
  assert.match(html, /Content-Security-Policy[^>]*connect-src 'self' https:\/\/website-api\.tosgame\.com/)
  const csp = html.match(/Content-Security-Policy" content="([^"]*)"/)[1]
  assert.match(csp, /script-src 'self';/)
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'script-src 不可有 unsafe-inline')
  assert.ok(!/<script(?![^>]*\ssrc=)/.test(html), '不可有行內 <script>')
  assert.ok(!/\son\w+\s*=/.test(html), '不可有行內事件屬性')
  assert.match(html, /<input id="code"[^>]*type="text"[^>]*autocomplete="one-time-code"[^>]*inputmode="numeric"|<input id="code"[^>]*autocomplete="one-time-code"/)
  assert.ok(!/type="password"/.test(html))
  assert.match(html, /-webkit-text-security:\s*disc/)
  for (const f of ['web/lookup.html', 'web/lookup.js', 'web/lookup-app.js']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8')
    assert.ok(!/console\./.test(t), f + ' 不可 log')
    assert.ok(!/localStorage\.setItem\([^)]*code/i.test(t), f + ' 不可存驗證碼')
    assert.ok(!/onerror\s*=/.test(t), f + ' 不可有行內 onerror')
  }
})

test('syncPool 只複製新增/變動的檔,並放 .nojekyll、查詢頁,不含 cards.json', () => {
  const d = tmp(), data = path.join(d, 'data'), docs = path.join(d, 'docs')
  fs.mkdirSync(path.join(data, 'img'), { recursive: true })
  fs.writeFileSync(path.join(data, 'monsters.json'), '[]'); fs.writeFileSync(path.join(data, 'cards.json'), '{"secret":1}')
  fs.writeFileSync(path.join(data, 'img/1.webp'), 'a'); fs.writeFileSync(path.join(data, 'img/x.txt'), 'n')
  const a = syncPool({ dataDir: data, webDir: path.join(ROOT, 'web'), docsDir: docs })
  assert.equal(a.copied, 5) // index.html、lookup.js、lookup-app.js、monsters.json、1.webp
  assert.ok(!fs.existsSync(path.join(docs, 'cards.json')) && !fs.existsSync(path.join(docs, 'img/x.txt')))
  fs.rmSync(d, { recursive: true })
})

test('syncPool 重跑無變動;改一張圖只更新那張', () => {
  const d = tmp(), data = path.join(d, 'data'), docs = path.join(d, 'docs')
  fs.mkdirSync(path.join(data, 'img'), { recursive: true })
  fs.writeFileSync(path.join(data, 'monsters.json'), '[]'); fs.writeFileSync(path.join(data, 'img/1.webp'), 'a'); fs.writeFileSync(path.join(data, 'img/2.webp'), 'b')
  const web = path.join(ROOT, 'web')
  syncPool({ dataDir: data, webDir: web, docsDir: docs })
  assert.ok(fs.existsSync(path.join(docs, '.nojekyll')))
  assert.deepEqual(fs.readdirSync(docs).sort(), ['.nojekyll', 'img', 'index.html', 'lookup-app.js', 'lookup.js', 'monsters.json'])
  assert.equal(syncPool({ dataDir: data, webDir: web, docsDir: docs }).copied, 0)
  fs.writeFileSync(path.join(data, 'img/2.webp'), 'bb')
  assert.equal(syncPool({ dataDir: data, webDir: web, docsDir: docs }).copied, 1)
  assert.equal(fs.readFileSync(path.join(docs, 'img/2.webp'), 'utf8'), 'bb')
  fs.rmSync(d, { recursive: true })
})

test('poolBase:旗標 > 環境變數 > config.json;injectPoolBase 驗證 https 與結尾斜線', () => {
  const d = tmp()
  assert.equal(loadConfig({ flags: {}, env: {}, root: d }).poolBase, null)
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ poolBase: 'https://file/' }))
  assert.equal(loadConfig({ flags: {}, env: {}, root: d }).poolBase, 'https://file/')
  assert.equal(loadConfig({ flags: {}, env: { TOS_POOL_BASE: 'https://env/' }, root: d }).poolBase, 'https://env/')
  assert.equal(loadConfig({ flags: { 'pool-base': 'https://flag/' }, env: { TOS_POOL_BASE: 'https://env/' }, root: d }).poolBase, 'https://flag/')
  const html = injectPoolBase('<head></head><script>x</script>', 'https://p.example/pool/')
  assert.match(html, /<script>window\.TOS_POOL_BASE="https:\/\/p\.example\/pool\/"<\/script>\n<script>x/)
  for (const bad of [null, '', 'http://x/', 'https://x', 'https://x/"<']) assert.throws(() => injectPoolBase('<script>', bad))
  fs.rmSync(d, { recursive: true })
})

test('web/index.html 的資料基底來自 TOS_POOL_BASE;--publish 缺 poolBase 退出碼 2', () => {
  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8')
  assert.match(html, /POOL\+'monsters\.json'/)
  assert.match(html, /POOL\+'img\/'/)
  assert.match(html, /fetch\('cards\.json'\)/)
  const d = tmp() // 空的設定目錄:與本機 config.json 無關
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ uid: '111111111', siteDir: path.join(d, 'site') }))
  const r = spawnSync('node', [path.join(ROOT, 'bin/tos-update'), '--offline', '--no-images', '--publish'], { encoding: 'utf8', env: { ...process.env, TOS_CONFIG_DIR: d, TOS_POOL_BASE: '', TOS_SITE_DIR: '', TOS_DOCS_DIR: path.join(d, 'docs') } })
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /poolBase/)
  fs.rmSync(d, { recursive: true, force: true })
})

test('resolveImgBase:imgBase 優先,否則 poolBase + img/,都沒有報錯;CLI 兩者皆缺退出碼 2', () => {
  assert.equal(resolveImgBase('https://i.example/x/', 'https://p.example/'), 'https://i.example/x/')
  assert.equal(resolveImgBase('', 'https://p.example/'), 'https://p.example/img/')
  assert.equal(resolveImgBase(null, 'https://p.example/pool/'), 'https://p.example/pool/img/')
  assert.throws(() => resolveImgBase(null, null))
  assert.throws(() => resolveImgBase(null, 'http://p.example/'))
  const d = tmp()
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ uid: '111111111' }))
  const run = (extra, env = {}) => spawnSync('node', [path.join(ROOT, 'bin/tos-update'), '--offline', '--slug', 't-pool', '--uid', '444444444', '--out', path.join(d, 'out'), ...extra], { encoding: 'utf8', env: { ...process.env, TOS_CONFIG_DIR: d, TOS_IMG_BASE: '', TOS_POOL_BASE: '', ...env } })
  assert.equal(run([]).status, 2) // 兩者皆未設:仍報錯
  fs.rmSync(d, { recursive: true, force: true })
})

test('docs/ 內查詢頁與 web/ 來源一致;docs/ 無 cards.json;git 追蹤檔不含 smallkill', () => {
  const docs = path.join(ROOT, 'docs')
  if (fs.existsSync(docs)) {
    assert.ok(!fs.existsSync(path.join(docs, 'cards.json')))
    assert.equal(fs.readFileSync(path.join(docs, 'index.html'), 'utf8'), fs.readFileSync(path.join(ROOT, 'web/lookup.html'), 'utf8'))
    for (const f of ['lookup.js', 'lookup-app.js']) assert.equal(fs.readFileSync(path.join(docs, f), 'utf8'), fs.readFileSync(path.join(ROOT, 'web', f), 'utf8'))
    const top = fs.readdirSync(docs).sort()
    assert.deepEqual(top, ['.nojekyll', 'img', 'index.html', 'lookup-app.js', 'lookup.js', 'monsters.json'])
    assert.ok(fs.readdirSync(path.join(docs, 'img')).every(f => /^\d+\.webp$/.test(f)), 'docs/img 只能有 <卡號>.webp')
  }
  // 追蹤檔中也不得出現 config.json 的 UID
  let ownUid = null
  try { ownUid = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).uid || '') || null } catch {}
  const files = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--', '.', ':!docs/img', ':!package-lock.json'], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
  for (const f of files) {
    if (f === 'test/tos.test.mjs' || !fs.existsSync(path.join(ROOT, f))) continue
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8')
    assert.ok(!/smallkill/i.test(t), f + ' 含 smallkill')
    if (ownUid) assert.ok(!t.includes(ownUid), f + ' 含 config.json 的 UID')
  }
})

// ---- 瀏覽器端記住背包 ----
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) } }

test('記住背包:存/讀 roundtrip,只含彙整結果 + UID + 時間', () => {
  const st = memStore(), agg = lookup.aggregate(profile), now = new Date('2026-10-26T01:02:03.000Z')
  assert.equal(lookup.saveBackpack(st, '123456789', agg, now), true)
  assert.deepEqual([...st.m.keys()], ['tos-backpack:v1'])
  const rec = lookup.loadBackpack(st)
  assert.deepEqual(rec, { uid: '123456789', savedAt: '2026-10-26T01:02:03.000Z', totalCards: agg.totalCards, uniqueCards: agg.uniqueCards, cards: agg.cards })
  const raw = st.m.get('tos-backpack:v1')
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['cards', 'savedAt', 'totalCards', 'uid', 'uniqueCards', 'v'])
  for (const secret of ['SECRET-NAME', 'SECRET-MSG', 'acquiredAt', 'token', 'auth', 'code']) assert.ok(!raw.includes(secret), secret)
  lookup.clearBackpack(st)
  assert.equal(lookup.loadBackpack(st), null)
  assert.equal(st.m.size, 0)
})

test('記住背包:無效/竄改資料一律忽略並刪除', () => {
  const good = { v: 1, uid: '123456789', savedAt: '2026-10-26T01:02:03.000Z', totalCards: 2, uniqueCards: 1, cards: [{ id: 1, count: 2, maxLevel: 5, maxSkillLevel: 1, maxEnhanceLevel: 0 }] }
  const mut = f => { const o = structuredClone(good); f(o); return o }
  const bads = [
    'not json', '[]', 'null', '{}',
    mut(o => { o.v = 2 }), mut(o => { o.uid = '12ab' }), mut(o => { o.extra = 1 }), mut(o => { o.token = 'T' }),
    mut(o => { o.savedAt = 'yesterday' }), mut(o => { o.uniqueCards = 5 }), mut(o => { o.totalCards = 1 }),
    mut(o => { o.cards[0].id = '1' }), mut(o => { o.cards[0].count = -1 }), mut(o => { o.cards[0].maxLevel = 1.5 }),
    mut(o => { o.cards[0].code = 'X' }), mut(o => { o.cards = [o.cards[0], o.cards[0]]; o.uniqueCards = 2; o.totalCards = 4 }),
  ]
  for (const b of bads) {
    const st = memStore({ 'tos-backpack:v1': typeof b === 'string' ? b : JSON.stringify(b), 'tos-lookup-uid': '123456789' })
    assert.equal(lookup.loadBackpack(st), null, JSON.stringify(b))
    assert.ok(!st.m.has('tos-backpack:v1'))
  }
  assert.ok(lookup.validateStored(good))
})

test('記住背包:storage 不可用時不丟例外', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') }, removeItem() { throw new Error('denied') } }
  assert.equal(lookup.saveBackpack(broken, '123456789', lookup.aggregate(profile)), false)
  assert.equal(lookup.loadBackpack(broken), null)
  assert.doesNotThrow(() => lookup.clearBackpack(broken))
  assert.equal(lookup.saveBackpack(null, '123456789', lookup.aggregate(profile)), false)
  assert.equal(lookup.loadBackpack(null), null)
})

test('lookup-app.js:儲存只經 saveBackpack,取消勾選會清除;不直接寫 localStorage', () => {
  const app = fs.readFileSync(path.join(ROOT, 'web/lookup-app.js'), 'utf8')
  assert.ok(!/localStorage\.setItem|sessionStorage|document\.cookie/.test(app))
  assert.match(app, /if\(\$\('#rem'\)\.checked\) saved=saveBackpack\(store,uid,agg\); else clearBackpack\(store\)/)
  assert.match(fs.readFileSync(path.join(ROOT, 'web/lookup.html'), 'utf8'), /id="rem" type="checkbox" checked/)
})

test('查詢頁防點擊劫持:先隱藏整頁,只在最上層視窗才顯示', () => {
  const html = fs.readFileSync(path.join(ROOT, 'web/lookup.html'), 'utf8')
  assert.match(html, /<style id="acj">body\{display:none!important\}<\/style>/)
  const js = fs.readFileSync(path.join(ROOT, 'web/lookup-app.js'), 'utf8')
  assert.match(js, /if\(window\.top===window\.self\)document\.getElementById\('acj'\)\?\.remove\(\)/)
})

test('自己的頁面與朋友版注入 CSP:圖片/資料只允許卡池或圖庫的 origin', async () => {
  const { buildEmbedHtml } = await import('../lib/embed.mjs')
  const tpl = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8')
  const cspOf = h => h.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)[1]
  const own = injectPoolBase(tpl, 'https://pool.example/tos/')
  assert.ok(own.indexOf('Content-Security-Policy') < own.indexOf('<script>'), 'CSP 要在第一個 script 之前')
  const c1 = cspOf(own)
  assert.match(c1, /default-src 'none'/)
  assert.match(c1, /img-src https:\/\/pool\.example;/)
  assert.match(c1, /connect-src 'self' https:\/\/pool\.example;/)
  assert.match(c1, /base-uri 'none'; form-action 'none'; object-src 'none'/)
  assert.match(own, /<meta name="referrer" content="no-referrer">/)
  const friend = buildEmbedHtml(tpl, { cards: [] }, [], 'https://img.example/x/')
  const c2 = cspOf(friend)
  assert.match(c2, /img-src https:\/\/img\.example;/)
  assert.match(c2, /connect-src 'none'/)
})

test('webp 轉檔只接受 PNG', () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
  assert.throws(() => pngToWebp(gif), /webp 轉檔失敗/)
})
