# 氧身部落 LINE 圖文選單管理

完整離開 Apps Script 的前後端版本。保留雙分頁、最多 18 個區塊、形狀編輯、草稿、圖片上傳與 LINE 發布。Google 登入只允許 OWNER_EMAIL 指定的擁有者。橢圓形沿用原本的視覺編輯功能，LINE 實際點擊區域仍為矩形。

## 狀態

本機實作已備妥；尚未建立 GitHub 儲存庫、部署後端、設定 Google OAuth 或連線測試正式 LINE 帳號。自動測試使用模擬 LINE API。

已通過 6 項本機自動測試及前端 JavaScript 語法檢查；尚未完成瀏覽器操作驗證和真實 Google／LINE 整合測試。

## 架構

- public/：GitHub Pages 前端。
- server/：Node.js 後端，驗證 Google ID token、保存資料、呼叫 LINE。
- data/state.json：草稿、圖片、發布紀錄，只在後端永久磁碟保存，原子寫入。
- apps-script/：使用者提供的原始碼及舊站資料匯出工具 Export.gs。
- render.yaml：Render Blueprint，單一付費服務與 1 GB 永久磁碟。建立前先確認平台顯示的費用。

只支援單一後端執行個體；操作會排隊執行，不可開多實例或改用臨時磁碟。

## 1. GitHub 儲存庫

建議建立 ysb-line-rich-menu，將「本資料夾內容」放在新儲存庫根目錄，package.json 和 render.yaml 都在根目錄。不要上傳父層工作目錄的其他專案。

使用 GitHub Pages 前，確認帳號方案支援選定儲存庫的可見性。公開儲存庫不得包含 .env、資料匯出檔、state.json 或 LINE token。Google Client ID 可以公開。

## 2. Google 登入

在 Google Cloud Console 設定 OAuth 同意畫面及「網頁應用程式」Client ID，不需要 Drive 或 Apps Script 授權範圍。

授權 JavaScript 來源填實際前端來源，例如 https://9334yang.github.io，不含儲存庫路徑。若同意畫面仍在測試階段，將擁有者加入測試使用者。本機可另外加入 http://localhost:3000。

後端使用 Google 官方程式庫驗證簽章、audience、issuer、到期、email_verified 和擁有者信箱。登入 token 只存瀏覽器記憶體，到期需重新整理登入。

## 3. Render 後端

在 Render 使用新儲存庫建立 Blueprint，檢查方案及磁碟費用後再建立服務。設定以下環境變數：

| 設定 | 值 |
| --- | --- |
| FRONTEND_ORIGIN | 例如 https://9334yang.github.io，不含路徑或結尾斜線 |
| GOOGLE_CLIENT_ID | Google 網頁應用程式 Client ID |
| OWNER_EMAIL | 實際管理員 Google 信箱，請自行確認，不自動沿用 GitHub 信箱 |
| LINE_CHANNEL_ACCESS_TOKEN | 只貼在 Render 秘密設定 |
| DATA_DIR | /var/data，Blueprint 已設定 |

檢查 https://你的服務.onrender.com/api/health。只有健康狀態和 Google Client ID 可未登入讀取；草稿、圖片、LINE 操作全部驗證登入。後端只允許指定前端來源。

## 4. GitHub Pages 前端

修改 public/config.js，將 window.YSB_API_BASE 設成 Render HTTPS 網址，不含 /api。提交後，在儲存庫 Settings → Pages 選 GitHub Actions；手動執行提供的 Pages workflow，之後推送 main 自動部署。

前端網址通常為 https://9334yang.github.io/ysb-line-rich-menu/。Google 和後端的來源設定仍是 https://9334yang.github.io。

## 5. 移轉舊站資料

1. 在舊 Apps Script 專案新增 Export.gs，貼入這裡同名檔內容。
2. 原擁有者手動執行 ysbExportMigrationFile，依執行記錄連結從自己的 Drive 下載 ysb-migration.json。匯出不包含 LINE token。
3. 新站使用管理員 Google 帳號登入，選擇「匯入舊站資料」。只更新草稿與圖片，不會發布。
4. 確認兩個分頁的圖片、點擊區域、網址後，手動按「發布／更新至 LINE」。

先停止在舊站發布，避免兩邊同時管理。新站不再依賴 Drive；舊站圖片保留原狀。舊 Apps Script 建立的選單不會自動刪除，新站只清理自己記錄的歷次發布版本。

圖片必須為 2500 × 1686 的 PNG/JPEG，且不超過 1 MB。匯入先完整驗證才寫入，會覆蓋草稿與圖片、保留現有發布紀錄。建議匯入前先匯出備份。

## 本機執行

使用 Node.js 22 或以上：

```sh
npm ci
# 將 .env.example 複製成 .env 並填入本機設定
npm test
npm start
```

本機 http://localhost:3000 同時提供前端與 API，public/config.js 保持空字串。正式發布才需要 LINE token，測試不需要。

## 發布及恢復限制

每次準備新的一對選單和 Alias，不改動正在使用的 Alias。切換預設選單後查詢 LINE 確認生效，再清理舊版。清理失敗不會誤報整次發布失敗。

LINE 和磁碟之間沒有跨系統交易。網路中斷或程序停止可能留下未使用的新選單或 Alias；staging/prepared 保存已知 ID，需管理員對照 LINE 後人工清理，不自動刪除不明版本。切換成功但確認或寫檔失敗時，先查詢 LINE 實際預設選單，再決定重新發布。

定期備份永久磁碟。前端匯出包含草稿及圖片，不含完整發布歷史；完整恢復需平台磁碟快照或 state.json 的私密備份。

參考：[Render 磁碟](https://render.com/docs/disks)、[Blueprint](https://render.com/docs/blueprint-spec)、[Google 驗證](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)。
