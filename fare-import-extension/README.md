# 票價表匯入工具 — Chrome Extension

從 CI/BR/JX 票價 PDF 直接點一下匯入 Google Sheets，不經過 n8n 和 Gemini。

---

## 安裝步驟（只需做一次）

### Step 1：下載 PDF.js 函式庫

到下面兩個連結，右鍵「另存新檔」，存到 `lib/` 資料夾：

- `lib/pdf.min.js`  
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js

- `lib/pdf.worker.min.js`  
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js

完成後資料夾結構：
```
fare-import-extension/
  lib/
    pdf.min.js          ← 剛下載的
    pdf.worker.min.js   ← 剛下載的
  manifest.json
  popup.html
  popup.js
  fareparser.js
```

---

### Step 2：在 GCP 建立 OAuth 憑證

1. 開啟 https://console.cloud.google.com/
2. 選擇你之前建 n8n 憑證的專案
3. 左側 → **APIs & Services** → **憑證**
4. 點「**＋ 建立憑證**」→「OAuth 用戶端 ID」
5. 應用程式類型選「**Chrome 應用程式**」
6. 應用程式 ID 先隨便填（等 Step 4 取得後再回來改）
7. 按「建立」→ 複製「用戶端 ID」

---

### Step 3：填入 Client ID

打開 `manifest.json`，把 `REPLACE_WITH_YOUR_CLIENT_ID` 換成你的 Client ID：

```json
"oauth2": {
  "client_id": "123456789-abcdefg.apps.googleusercontent.com",
  ...
}
```

---

### Step 4：載入擴充功能

1. Chrome 網址列輸入 `chrome://extensions/`
2. 右上角開啟「**開發人員模式**」
3. 點「**載入未封裝項目**」→ 選 `fare-import-extension` 資料夾
4. 複製顯示的「擴充功能 ID」（格式：32 個小寫字母）
5. 回到 GCP 憑證頁面，把 Step 2 填的 ID 換成這個值，儲存

---

## 使用方式

1. 在 Chrome 開啟 JX/CI/BR 票價表 PDF（本機或雲端直連 PDF）
2. 點工具列右上角的「✈️ 票價表匯入工具」圖示
3. 確認偵測到的航空公司和筆數
4. 點「📥 匯入到 Google Sheets」
5. 第一次會跳出 Google 授權視窗，點允許
6. 看到「✅ 成功寫入 N 筆！」即完成

---

## 支援的航班

| 航空 | 目的地 | 班號 |
|------|--------|------|
| JX 星宇 | CTS 新千歲 | JX850 |
| JX 星宇 | HKD 函館 | JX860 |
| CI 中華 | CTS 新千歲 | CI130 / CI131 |
| BR 長榮 | CTS 新千歲 | BR116(BR166) / BR165(BR115) |

---

## 注意事項

- 本機 PDF（`file://`）：需在 `chrome://extensions/` → 詳細資料 → 開啟「允許存取檔案網址」
- Google Drive 的 PDF 需先下載到本機，或取得直接的 PDF 下載連結
- 每次匯入會在 Sheet 末尾「新增」資料列（不會刪除舊資料）
