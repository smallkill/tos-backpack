# AGENTS.md — 給 AI 助手的交接文件

這份文件寫給接手的 AI(Claude Code、Codex 等能執行指令的代理)。人類使用說明看 `README.md`。

## 這是什麼
神魔之塔(Tower of Saviors)個人卡片圖鑑產生器:用遊戲官方「互助檢視」API 抓某位玩家的背包,
產出可搜尋的靜態網頁(擁有的卡彩色、沒有的灰階)。兩種輸出:
- **自己的版本**:`data/cards.json` + `web/index.html` → 複製到靜態網站目錄並 git commit(只有 index.html、cards.json;`monsters.json`/卡圖改由 `poolBase` 指向的共用卡池站載入)。
- **公開卡池站 `docs/`**(GitHub Pages,由 `tos-update` 非朋友版每次執行時同步):`monsters.json`、`img/`、`.nojekyll`,以及「查詢我的背包」頁(`web/lookup.html`→`docs/index.html`、`web/lookup.js`、`web/lookup-app.js`)。`docs/` 是已追蹤的部署檔,`data/` 仍 gitignore。
- **朋友版**:單一自含 `out/<slug>/index.html`(資料內嵌,卡圖讀外部圖庫)。

## 兩種接手方式
1. **照現有程式跑(建議)**:`npm install` → `cp config.example.json config.json` 填 UID 與網站目錄 → 見 README「用法」。
2. **從零重寫**:照下方「規格」實作,行為以 `test/tos.test.mjs` 為準(先讓測試能跑,再改)。

## 規格(重寫時必須遵守)
### 資料來源
- 官方 API(流程取自 tinghan33704/tos-tools `src/utils.tsx`):
  1. `POST https://website-api.tosgame.com/api/checkup/login?token=&uid=<UID>&auth=<驗證碼>` → `{ token }`
  2. `GET  https://website-api.tosgame.com/api/checkup/getUserProfile?targetUid=<UID>&token=<token>` → `{ userData: { cards: [...] , ... } }`
  - 驗證碼:玩家在遊戲內「互助檢視」取得的 6 碼,有時效。
- 卡名/屬性/種族/星數:tos-tools repo 的 `monsterData.tsx`;卡圖:同 repo `src/img/monster/<id>.png`。
  - 一律從 `lib/pin.json` 釘住的 commit SHA 下載(`raw.githubusercontent.com/<repo>/<sha>/...`),升級要明確執行 `--bump-sha`。
  - 下載間隔 250ms、已存在就不重抓;PNG 轉 96px webp(Python Pillow,`lib/to_webp.py`)。

### 安全鐵則(不可放寬)
- **絕不執行上游程式碼**:`monsterData.tsx` 是 TypeScript 原始碼,只能用 acorn 解析成 AST、只讀純字面值節點
  (字串/數字/陣列/物件),遇到函式、呼叫、識別字、模板插值等任何其他節點就丟錯(見 `lib/monster.mjs`)。
  不可用 `eval`、`vm`、`import()`、`ts-node` 等方式載入。
- **驗證碼**:只從環境變數 `TOS_AUTH` 或 stdin 讀(TTY 時不回顯);不接受命令列參數(會進 shell 歷史與 ps);
  不寫入任何檔案、log、錯誤訊息。
- **個資不外流**:原始 profile(含 UID、暱稱、互助訊息)只存在 `.cache/`(gitignore、權限 0600)。
  公開輸出只能有:卡號、數量、最高等級(等級/技能/強化)、卡名、屬性、種族、星數、更新日期。
- UID、網站路徑不寫死在程式碼;設定優先序:命令列旗標 > 環境變數(`TOS_UID`/`TOS_SITE_DIR`/`TOS_IMG_BASE`/`TOS_POOL_BASE`)> `config.json`(gitignore)。
- 朋友版:必須明確給 `--uid` 且不可等於自己的 UID;`--slug` 只允許 `[a-z0-9-]`、≤32 字、不可含 UID 或 5 碼以上數字;
  不可碰自己的 `data/` 與網站目錄。卡圖網址 `imgBase`(config.json / `TOS_IMG_BASE` / `--img-base`)必須 https 且以 `/` 結尾,**程式不內建預設圖庫**(不可寫死任何人的網站或拿第三方 repo 當圖床)。`imgBase` 未設時退回 `poolBase` + `img/`(`resolveImgBase`),兩者都沒有就報錯。
- `--publish` 只 `git add/commit` 自己複製的 `index.html`、`cards.json`,**不 push**(push 由人決定)。`poolBase`(config.json / `TOS_POOL_BASE` / `--pool-base`)必須 https 且以 `/` 結尾,程式不內建任何擁有者網址;`--publish` 會把它以 `window.TOS_POOL_BASE` 注入 index.html。
- **公開查詢頁(`web/lookup.*` → `docs/`)**:
  - 純前端:瀏覽器直連官方 API(CORS 已驗證),本站不經手驗證碼與背包。
  - 驗證碼只在記憶體用於 login 一次,用完立刻清空欄位;不存 localStorage/sessionStorage(欄位為 `type=text` + `autocomplete=one-time-code` + CSS 遮罩,避免瀏覽器詢問是否儲存密碼)、不進網址、不 log(頁面不使用 `console.*`);錯誤訊息不得含驗證碼/token/URL(`lookup.js` 的 `LookupError` 只給固定中文訊息、不帶 `cause`)。
  - **瀏覽器端記住背包**(預設勾選、可取消):只以單一 key `tos-backpack:v1` 存 `{v, uid, savedAt, totalCards, uniqueCards, cards:[{id,count,maxLevel,maxSkillLevel,maxEnhanceLevel}]}`,即 `aggregate()` 輸出 + UID + 匯入時間,別無其他;絕不存驗證碼、token、原始 profile、暱稱。讀取一律經 `loadBackpack` 嚴格驗證(欄位集合、型別、範圍、卡號不重複),無效就刪除並忽略;所有 storage 存取包 try/catch(`lookup.js` 的 `saveBackpack`/`loadBackpack`/`clearBackpack`,`lookup-app.js` 不得直接 `localStorage.setItem`),storage 不可用時頁面照常運作。取消勾選會刪除既有紀錄;「清除資料」刪除紀錄並重置頁面。隱私說明(頁面 notice)必須同步寫明資料只存在本瀏覽器。
  - 不得載入或發佈任何人的 `cards.json`;`docs/` 內不可有 cards.json。頁面與 tracked 檔案不得出現擁有者網址或帳號(測試會檢查擁有者帳號字串不得出現在追蹤檔);資料路徑只用同資料夾相對路徑 `./monsters.json`、`./img/`。
  - 必須保留 `noindex` 與 CSP meta(`connect-src 'self' https://website-api.tosgame.com`、`form-action 'none'`、`base-uri 'none'`);`script-src` 只能是 `'self'`:頁面不可有行內 `<script>` 或 `on*=` 屬性(UI 在 `lookup-app.js`,圖片失敗用 capture 的 error 監聽);`style-src 'unsafe-inline'` 因為頁面有內嵌 `<style>`。
  - POST 不加自訂 header(避免 CORS preflight)。
  - 修改 `web/lookup.*` 後須跑 `bin/tos-update`(或 `syncPool`)同步到 `docs/`;測試會比對兩者一致。

### 模組地圖
| 檔案 | 職責 |
|---|---|
| `bin/tos-update` | CLI 入口:解析旗標、讀驗證碼、login→getProfile、呼叫 update、publish/朋友版輸出 |
| `lib/api.mjs` | 兩支 API;錯誤訊息不含 URL(URL 內有驗證碼/token) |
| `lib/auth.mjs` | 讀驗證碼(env → stdin) |
| `lib/config.mjs` | 旗標解析、設定合併、slug 驗證、各人檔案路徑 |
| `lib/monster.mjs` | acorn 安全解析 monsterData |
| `lib/cards.mjs` | profile → 公開 cards.json(同卡號合併計數、取最高等級);全卡池精簡清單 |
| `lib/images.mjs` | 卡圖增量同步 + webp 轉檔 |
| `lib/embed.mjs` | 朋友版單檔 HTML(JSON 放進 `<script>` 前跳脫 `</script>` 與行分隔字元);`checkPoolBase`/`injectPoolBase` |
| `lib/pool.mjs` | `syncPool`:`data/monsters.json`、`data/img/`、查詢頁 → `docs/`(只複製新增/變動檔) |
| `lib/update.mjs` | 串起以上:profile + monsterData → data/*.json + 圖片 |
| `web/index.html` | 前端模板(搜尋、篩選、格狀小圖、hover/tap 詳細);卡池基底 `window.TOS_POOL_BASE` |
| `web/lookup.html`、`web/lookup.js`、`web/lookup-app.js` | 公開「查詢我的背包」頁;`lookup.js` 無依賴 ES module(`login`/`getProfile`/`aggregate`),`lookup-app.js` 是 UI;部署副本在 `docs/` |
| `test/` | `npm test`(node:test),fixtures 全為假資料 |

## 已知未驗證
- `login` 尚未用真實驗證碼實測過(含瀏覽器版 `web/lookup.js`:只用 Playwright 攔截模擬回應驗過 UI 流程);第一次跑若失敗,先對照 tos-tools 最新 `src/utils.tsx` 的 login 流程。

## 版權
卡名資料與卡圖來自 tinghan33704/tos-tools,圖片版權屬 Madhead。monsterData 原始碼不附;卡圖(webp 縮圖)為公開卡池站 `docs/img/` 所需而隨 repo 追蹤,版權仍屬原權利人。
