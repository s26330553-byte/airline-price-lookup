/**
 * popup.js — 擴充功能主控邏輯
 * 流程：選擇 PDF 檔案 → 擷取文字 → 解析票價 → OAuth → 寫入 Sheets
 */

const SHEET_ID = '1FqMifvlE8RqFIKnGiufX7zZ7PR3XBcRE5V4C0myZarQ';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// ── DOM 元素 ──
const airlineBadge  = document.getElementById('airlineBadge');
const fareTypeText  = document.getElementById('fareTypeText');
const rowsPreview   = document.getElementById('rowsPreview');
const sheetIdEl     = document.getElementById('sheetId');
const btnImport     = document.getElementById('btnImport');
const statusEl      = document.getElementById('status');
const filePicker    = document.getElementById('filePicker');

// ── 全域暫存 ──
let parsedRows = [];

// ── 初始化 ──
sheetIdEl.textContent = `Sheet ID: ${SHEET_ID}`;
airlineBadge.textContent = '請選擇 PDF';
setStatus('請先選擇票價表 PDF 檔案');

// ── 選擇檔案後解析 ──
filePicker.addEventListener('change', async () => {
  const file = filePicker.files[0];
  if (!file) return;

  airlineBadge.className = 'badge badge-unknown';
  airlineBadge.textContent = '解析中...';
  fareTypeText.textContent = '';
  rowsPreview.textContent = '';
  btnImport.disabled = true;
  setStatus('正在讀取 PDF…');

  try {
    const pdfText = await extractPdfTextFromFile(file);
    const { airline, rows } = parseFareTable(pdfText, file.name);

    if (!airline) throw new Error('無法辨識航空（檔名需含 JX/CI/BR 或 星宇/中華/長榮）');
    if (rows.length === 0) throw new Error('未找到北海道（CTS/HKD）票價，請確認此 PDF 包含 CTS 或 HKD 航班');

    parsedRows = rows;

    // 更新 UI
    const badgeClass = { JX: 'badge-jx', CI: 'badge-ci', BR: 'badge-br' }[airline] || 'badge-unknown';
    airlineBadge.className = `badge ${badgeClass}`;
    airlineBadge.textContent = airline;
    fareTypeText.textContent = rows[0]?.fare_type || '';

    const ctsCnt = rows.filter(r => r.destination === 'CTS').length;
    const hkdCnt = rows.filter(r => r.destination === 'HKD').length;
    rowsPreview.textContent = `共 ${rows.length} 筆　${ctsCnt ? 'CTS: ' + ctsCnt : ''}　${hkdCnt ? 'HKD: ' + hkdCnt : ''}`;

    setStatus('');
    btnImport.disabled = false;
  } catch (e) {
    airlineBadge.textContent = '錯誤';
    setStatus(e.message, true);
  }
});

// ── 匯入按鈕 ──
btnImport.addEventListener('click', async () => {
  btnImport.disabled = true;
  setStatus('取得 Google 授權…');

  try {
    const token = await getAuthToken();
    setStatus('正在寫入 Google Sheets…');

    const now = new Date().toISOString();
    const values = parsedRows.map(r => [
      r.airline, r.fare_type, r.version, r.issue_date,
      r.ticket_issue_start, r.ticket_issue_end, r.destination,
      r.dep_date_start, r.dep_date_end, r.price, r.agent_discount,
      r.dep_flight, r.ret_flight, r.tour_code, r.currency,
      r.is_active, r.source_file, now,
    ]);

    const res = await fetch(
      `${SHEETS_API}/${SHEET_ID}/values/A:R:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      }
    );

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const updated = data.updates?.updatedRows || parsedRows.length;
    setStatus(`✅ 成功寫入 ${updated} 筆！`, false, true);
  } catch (e) {
    setStatus(`❌ ${e.message}`, true);
    btnImport.disabled = false;
  }
});

// ── PDF 文字擷取（直接從 File 物件，不需要 URL 或檔案權限）──
async function extractPdfTextFromFile(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // 保留換行：同一行的文字用空格連接，行與行之間用 \n
    let lastY = null;
    for (const item of content.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 3) {
        fullText += '\n';
      }
      fullText += item.str;
      lastY = item.transform[5];
    }
    fullText += '\n';
  }
  return fullText;
}

// ── Google OAuth ──
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['gToken', 'gTokenExp'], (stored) => {
      const { gToken, gTokenExp } = stored;
      if (gToken && gTokenExp && Date.now() < gTokenExp) return resolve(gToken);

      const redirectUri = chrome.identity.getRedirectURL();
      const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
      authUrl.searchParams.set('client_id', chrome.runtime.getManifest().oauth2?.client_id || '');
      authUrl.searchParams.set('response_type', 'token');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/spreadsheets');

      chrome.identity.launchWebAuthFlow(
        { url: authUrl.toString(), interactive: true },
        (redirectUrl) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!redirectUrl) return reject(new Error('授權被取消'));
          const params = new URLSearchParams(new URL(redirectUrl).hash.slice(1));
          const token = params.get('access_token');
          const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
          if (!token) return reject(new Error('未取得 access_token'));
          chrome.storage.local.set({ gToken: token, gTokenExp: Date.now() + (expiresIn - 60) * 1000 });
          resolve(token);
        }
      );
    });
  });
}

// ── UI 輔助 ──
function setStatus(msg, isError = false, isSuccess = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'error' : isSuccess ? 'success' : '';
}
