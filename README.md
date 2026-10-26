# tos-backpack

> 給 AI 助手的交接/重寫規格見 [AGENTS.md](AGENTS.md)。

把自己的神魔之塔背包做成可搜尋的卡片圖鑑網頁(有的彩色、沒有的灰階)。資料來自遊戲官方互助檢視 API。

## 需求
Node 20+(實測 24)、Python 3 + Pillow(轉 webp)、`npm install`(只有 acorn 一個依賴)。

## 設定
複製 `config.example.json` 為 `config.json`(已 gitignore),填入 UID 與網站輸出目錄(你的靜態網站內放 `index.html` 的資料夾)。
朋友版需要卡圖公開網址:`imgBase`;未設時自動用 `poolBase` + `img/`(兩者都沒有就報錯)。也可用旗標 `--uid` / `--site` / `--img-base` 或環境變數 `TOS_UID` / `TOS_SITE_DIR` / `TOS_IMG_BASE`(優先序:旗標 > 環境變數 > config.json)。
自己的頁面模板在 `web/index.html`:`--publish` 只把它(注入卡池網址)與 `cards.json` 複製到網站目錄並 commit;`monsters.json` 與卡圖從共用卡池站載入,網址設在 `poolBase`(config.json / 環境變數 `TOS_POOL_BASE` / 旗標 `--pool-base`,需 https 且以 `/` 結尾)。

## 公開卡池站與「查詢我的背包」頁(`docs/`)
`bin/tos-update`(非朋友版)每次執行會把 `data/monsters.json`、`data/img/`(只複製新增/變動檔)與查詢頁(`web/lookup.html` → `docs/index.html`、`web/lookup.js`、`web/lookup-app.js` → `docs/`)同步到 `docs/`,並放 `.nojekyll`。`docs/` 以 GitHub Pages 發佈(Settings → Pages → main /docs),commit/push 由人決定。
查詢頁是純前端:任何玩家輸入自己的 UID 與互助檢視驗證碼,瀏覽器直連官方 API,在記憶體彙整後顯示全卡池(有的彩色、沒有的灰階)。驗證碼只用於登入一次,不儲存、不 log、不進網址;本站不會收到任何背包資料。匯入結果(卡號/數量/最高等級)與 UID 預設存在使用者自己瀏覽器的 localStorage(`tos-backpack:v1`),下次開啟免重新匯入;可取消勾選,或按「清除資料」刪除。非官方,遊戲改 API 可能失效。
本機預覽:`python3 -m http.server -d docs`。

## 取得驗證碼
在遊戲內「互助檢視」功能取得 6 碼驗證碼(有時效)。

## 用法
自己的版本(UID 取自 config.json / TOS_UID):
```
bin/tos-update [--publish]
```
朋友版(必須明確給朋友的 `--uid`,且不可與你自己的相同;不會碰網站目錄):
```
echo <朋友的驗證碼> | bin/tos-update --uid <朋友UID> --slug amy [--out <資料夾>] [--img-base <URL>]
```
- 驗證碼從 stdin 讀(終端機下不回顯),或環境變數 `TOS_AUTH`;**不接受命令列參數**(避免進 shell 歷史與 ps),未知旗標一律報錯。
- `--slug`:只允許 `[a-z0-9-]`,最長 32,不可含 UID 或 5 碼以上數字。
- 朋友版產出單一自含 `out/<slug>/index.html`(約 400KB,資料內嵌,可離線開)。卡圖從 `imgBase` 載入:在 `config.json` 設 `imgBase`(或環境變數 `TOS_IMG_BASE`、旗標 `--img-base`;需 https、結尾 `/`,檔名 `<卡號>.webp`);沒設 `imgBase` 時退回 `poolBase` + `img/`;兩者都沒設定會報錯,程式不內建任何人的圖庫。
- 自己的版本 `--publish`:複製到網站目錄並只 `git add/commit` 那幾個檔案(**不 push**)。
- `--offline`:不登入,用 `.cache/profile.json`(朋友版 `.cache/profiles/<slug>.json`,權限 600)重建。
- `--no-images`、`--refresh-monsters`、`--bump-sha`(把 tos-tools 的固定 commit 升到最新,見 `lib/pin.json`)。

### 朋友版怎麼給
1. **直接傳檔**:把 `out/<slug>/index.html` 用 Telegram / LINE 傳給朋友,手機用瀏覽器開即可(需連網載卡圖)。
2. **放靜態主機**:把 `out/<slug>/` 資料夾丟到 Cloudflare Pages / GitHub Pages 等,取得網址分享。網址不要公開張貼(內容是對方的持有清單)。

## 隱私
- 公開卡池站 `docs/` 只含卡池(`monsters.json`、卡圖縮圖)與查詢頁,不含任何人的背包。
- 輸出只有卡號、數量、最高等級、卡名、屬性、種族、星數與更新日期;**不含 UID、暱稱、互助訊息等任何個人欄位**。
- 原始 profile 只存在 `.cache/`(gitignore、0600)。不要做朋友清單頁;朋友版輸出在 `out/`(gitignore),不會進 guide。
- 驗證碼不寫入任何檔案或 log。`login` 流程依 tos-tools 原始碼實作,請自行以真實驗證碼驗證。

## 版權與來源
卡名資料(`monsterData.tsx`)與卡圖來自 [tinghan33704/tos-tools](https://github.com/tinghan33704/tos-tools),圖片版權屬 Madhead。本 repo 不附 monsterData 原始碼;卡圖與卡名由程式執行時從 tos-tools 的固定 commit 下載(間隔 250ms、有快取不重抓),轉成的縮圖與卡池清單放在 `docs/` 供公開卡池站使用。

## 測試
`npm test`
