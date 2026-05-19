# 航司票價查詢工具

雄獅旅行社 RC 專用。輸入航班代碼 + 出發日期，自動查出含週末加價的團體票價。

---

## 如何更新票價資料

票價存在 `data/prices.json`，你直接在 **GitHub 網頁**編輯即可：

1. 開啟 GitHub 此專案頁面
2. 點 `data/prices.json`
3. 點右上角鉛筆 ✏️ 圖示
4. 修改內容（新增票價區間、修改金額、加入促銷票）
5. 點 **Commit changes**

GitHub Pages 約 1 分鐘內自動更新，同事刷新頁面即可看到。

---

## 加入促銷票

在對應 route 的 `priceSets` 陣列新增一筆，系統自動取最低價：

```json
{
  "label": "2026暑假促銷票",
  "publishDate": "2026-06-01",
  "prices": [
    { "start": "2026-07-01", "end": "2026-07-31", "price": 19500 }
  ]
}
```

---

## 加入新航司（BR 長榮 / JX 星宇）

**Step 1** — 在 `airlines` 加入新航司設定：

```json
"BR": {
  "name": "長榮航空",
  "defaultTripDays": 5,
  "weekendSurcharge": {
    "CTS": 1000,
    "default": 500
  },
  "weekendExemptions": {
    "CTS": [
      { "start": "2026-09-23", "end": "2026-09-26", "name": "中秋連假" }
    ]
  }
}
```

**Step 2** — 在 `routes` 加入航班資料：

```json
{
  "id": "BR116/166-CTS",
  "airline": "BR",
  "destination": "CTS",
  "outbound": ["BR116"],
  "inbound": ["BR166"],
  "label": "台北 ✈ 札幌（新千歲）",
  "priceSets": [
    {
      "label": "2026下半年票價",
      "publishDate": "2026-XX-XX",
      "prices": [
        { "start": "2026-07-01", "end": "2026-07-31", "price": 21000 }
      ]
    }
  ]
}
```

---

## 部署到 GitHub Pages

1. 建立 GitHub 帳號（如尚未有）
2. 建立新 Repository（建議命名：`airline-price-lookup`，設為 Public）
3. 上傳所有檔案：`index.html`、`data/prices.json`、`README.md`
4. 設定 → Pages → Source 選 `main` branch / `root`
5. 取得網址：`https://你的帳號.github.io/airline-price-lookup`
6. 分享給同事

---

## 本機測試方式

需要透過 HTTP 伺服器開啟（不能直接雙擊 HTML 檔案）：

```bash
# 如果有 Node.js：
npx http-server -p 8765
# 然後開啟 http://localhost:8765
```
