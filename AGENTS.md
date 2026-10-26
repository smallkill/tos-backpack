# AGENTS.md — 給 AI 助手的交接文件

這份文件寫給接手的 AI(Claude Code、Codex 等能執行指令的代理)。人類使用說明看 `README.md`。

## 這是什麼
神魔之塔(Tower of Saviors)個人卡片圖鑑產生器:用遊戲官方「互助檢視」API 抓某位玩家的背包,
產出可搜尋的靜態網頁(擁有的卡彩色、沒有的灰階)。兩種輸出:
- **自己的版本**:`data/cards.json` + `monsters.json` + `img/` + `web/index.html` → 複製到靜態網站目錄並 git commit。
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
- UID、網站路徑不寫死在程式碼;設定優先序:命令列旗標 > 環境變數(`TOS_UID`/`TOS_SITE_DIR`/`TOS_IMG_BASE`)> `config.json`(gitignore)。
- 朋友版:必須明確給 `--uid` 且不可等於自己的 UID;`--slug` 只允許 `[a-z0-9-]`、≤32 字、不可含 UID 或 5 碼以上數字;
  不可碰自己的 `data/` 與網站目錄。卡圖網址 `imgBase`(config.json / `TOS_IMG_BASE` / `--img-base`)必須 https 且以 `/` 結尾,**程式不內建預設圖庫**(不可寫死任何人的網站或拿第三方 repo 當圖床),未設定就報錯。
- `--publish` 只 `git add/commit` 自己複製的那幾個檔案,**不 push**(push 由人決定)。

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
| `lib/embed.mjs` | 朋友版單檔 HTML(JSON 放進 `<script>` 前跳脫 `</script>` 與行分隔字元) |
| `lib/update.mjs` | 串起以上:profile + monsterData → data/*.json + 圖片 |
| `web/index.html` | 前端模板(搜尋、篩選、格狀小圖、hover/tap 詳細) |
| `test/` | `npm test`(node:test),fixtures 全為假資料 |

## 已知未驗證
- `login` 尚未用真實驗證碼實測過;第一次跑若失敗,先對照 tos-tools 最新 `src/utils.tsx` 的 login 流程。

## 版權
卡名資料與卡圖來自 tinghan33704/tos-tools,圖片版權屬 Madhead。本 repo 不附圖檔與 monsterData,執行時自行下載。
