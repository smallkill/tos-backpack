# tos-backpack

把自己的神魔之塔背包做成可搜尋的卡片圖鑑網頁(有的彩色、沒有的灰階)。資料來自遊戲官方互助檢視 API。

## 需求
Node 20+(實測 24)、Python 3 + Pillow(轉 webp)、`npm install`(只有 acorn 一個依賴)。

## 設定
複製 `config.example.json` 為 `config.json`(已 gitignore),填入 UID 與網站輸出目錄(你的靜態網站內放 `index.html` 的資料夾)。
也可用旗標 `--uid` / `--site` 或環境變數 `TOS_UID` / `TOS_SITE_DIR`(優先序:旗標 > 環境變數 > config.json)。
網頁模板在 `web/index.html`(`--publish` 會把它連同 `cards.json`、`monsters.json`、`img/` 複製到網站目錄)。

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
- 朋友版產出單一自含 `out/<slug>/index.html`(約 400KB,資料內嵌,可離線開)。卡圖預設載入自 `https://smallkill.github.io/guide/tos-cards/img/`,可用 `--img-base` 改成自己的圖庫(需 https、結尾 `/`,檔名 `<卡號>.webp`)。
- 自己的版本 `--publish`:複製到網站目錄並只 `git add/commit` 那幾個檔案(**不 push**)。
- `--offline`:不登入,用 `.cache/profile.json`(朋友版 `.cache/profiles/<slug>.json`,權限 600)重建。
- `--no-images`、`--refresh-monsters`、`--bump-sha`(把 tos-tools 的固定 commit 升到最新,見 `lib/pin.json`)。

### 朋友版怎麼給
1. **直接傳檔**:把 `out/<slug>/index.html` 用 Telegram / LINE 傳給朋友,手機用瀏覽器開即可(需連網載卡圖)。
2. **放靜態主機**:把 `out/<slug>/` 資料夾丟到 Cloudflare Pages / GitHub Pages 等,取得網址分享。網址不要公開張貼(內容是對方的持有清單)。

## 隱私
- 輸出只有卡號、數量、最高等級、卡名、屬性、種族、星數與更新日期;**不含 UID、暱稱、互助訊息等任何個人欄位**。
- 原始 profile 只存在 `.cache/`(gitignore、0600)。不要做朋友清單頁;朋友版輸出在 `out/`(gitignore),不會進 guide。
- 驗證碼不寫入任何檔案或 log。`login` 流程依 tos-tools 原始碼實作,請自行以真實驗證碼驗證。

## 版權與來源
卡名資料(`monsterData.tsx`)與卡圖來自 [tinghan33704/tos-tools](https://github.com/tinghan33704/tos-tools),圖片版權屬 Madhead。本 repo **不附圖檔與 monsterData**,程式執行時從 tos-tools 的固定 commit 自行下載(間隔 250ms、有快取不重抓)。

## 測試
`npm test`
