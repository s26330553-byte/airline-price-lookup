/**
 * 票價表解析核心 — CI / BR / JX
 * 只擷取北海道相關航班（CTS / HKD）
 */

// ─── 共用工具 ─────────────────────────────────────────────────

function detectAirline(fileName) {
  if (/星宇|JX/i.test(fileName)) return 'JX';
  if (/中華|CI/i.test(fileName)) return 'CI';
  if (/長榮|BR/i.test(fileName)) return 'BR';
  return null;
}

function detectFareType(fileName) {
  if (/押票/.test(fileName)) return 'Deposit';
  if (/指定日期/.test(fileName)) return 'SpecialDate';
  if (/促銷|優惠(?!.*早鳥)/.test(fileName)) return 'Promotion';
  if (/早鳥/.test(fileName)) return 'EarlyBird';
  return 'Standard';
}

function toISO(mdStr, year) {
  const clean = mdStr.replace(/\s/g, '');
  const [m, d] = clean.split('/').map(Number);
  return `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function extractDollarPrices(text) {
  return (text.match(/\$[\d,]+/g) || []).map(p => parseInt(p.replace(/[$,]/g,''), 10));
}

function extractNumPrices(text) {
  return (text.match(/\b\d{1,2},\d{3}\b/g) || []).map(p => parseInt(p.replace(/,/g,''), 10));
}


// ═══════════════════════════════════════════════════════════════
// JX 解析
// ═══════════════════════════════════════════════════════════════

function parseJX(fullText, fileName) {
  const versionMatch = fullText.match(/版本\s*(\d+)/);
  const version = versionMatch ? `第${versionMatch[1]}版` : '';
  const issueDateMatch = fullText.match(/(\d{4}-\d{2}-\d{2})/);
  const issueDate = issueDateMatch ? issueDateMatch[0] : '';
  const tourCodeMatch = fullText.match(/Tour\s*Code\s+([A-Z0-9]+)/);
  const tourCode = tourCodeMatch ? tourCodeMatch[1] : '';
  const yearMatch = fullText.match(/適用出發區間\s*(\d{4})\//);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  const meta = {
    airline:'JX', fare_type:'Standard', version,
    issue_date:issueDate, ticket_issue_start:issueDate, ticket_issue_end:'2099-12-31',
    tour_code:tourCode, currency:'TWD', is_active:'TRUE', source_file:fileName,
    agent_discount:'0',
  };
  const lines = fullText.split('\n');
  const all = [];
  const push = (dest, dep, ret, rows) => {
    for (const r of rows) all.push({ ...meta, destination:dest, dep_date_start:r.start, dep_date_end:r.end, price:String(r.price), dep_flight:dep, ret_flight:ret });
  };

  // Simple sections: single fare row starting with dest label
  const simpleMap = [
    { label:'OKA',       dest:'OKA', dep:'JX870',  ret:'' },
    { label:'SHI',       dest:'SHI', dep:'JX886',  ret:'JX890' },
    { label:'UKB',       dest:'UKB', dep:'JX834',  ret:'JX1834' },
    { label:'NGO',       dest:'NGO', dep:'JX838',  ret:'' },
    { label:'FUK X KMJ', dest:'FUK', dep:'JX840',  ret:'JX847' },
    { label:'FUK',       dest:'FUK', dep:'JX840',  ret:'' },
    { label:'KMJ',       dest:'KMJ', dep:'JX847',  ret:'' },
    { label:'CTS',       dest:'CTS', dep:'JX850',  ret:'' },
    { label:'HKD',       dest:'HKD', dep:'JX850',  ret:'' },
    { label:'SDJ',       dest:'SDJ', dep:'JX860',  ret:'' },
  ];
  for (const { label, dest, dep, ret } of simpleMap) {
    push(dest, dep, ret, extractJxSimpleRows(lines, label, year));
  }

  // TYO: 3 consecutive price-only rows (no dest label), dep = JX800/802/804
  for (const r of extractJxTYORows(lines, year)) {
    all.push({ ...meta, destination:'TYO', dep_date_start:r.start, dep_date_end:r.end, price:String(r.price), dep_flight:r.dep, ret_flight:'' });
  }

  // KIX: rows with explicit dep+ret in the line
  for (const r of extractJxKIXRows(lines, year)) {
    all.push({ ...meta, destination:'KIX', dep_date_start:r.start, dep_date_end:r.end, price:String(r.price), dep_flight:r.dep, ret_flight:r.ret });
  }

  // PUS: 4 rows starting with JX901/JX903 (ret), dep = JX900/JX902
  for (const r of extractJxPUSRows(lines, year)) {
    all.push({ ...meta, destination:'PUS', dep_date_start:r.start, dep_date_end:r.end, price:String(r.price), dep_flight:r.dep, ret_flight:r.ret });
  }

  return all;
}

function _jxRouteHeader(lines, fareIdx) {
  let routeIdx = -1;
  for (let j = fareIdx - 1; j >= Math.max(0, fareIdx - 22); j--) {
    if (/^\s*Route\b/i.test(lines[j])) { routeIdx = j; break; }
  }
  if (routeIdx < 0) return null;
  return lines.slice(routeIdx, fareIdx).join(' ')
    .replace(/^\s*Route\s+/i, '').replace(/\([^)]*\)/g, ' ')
    .replace(/[一-鿿]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function _jxFareRows(headerText, priceLines, year) {
  const groups = parseJxDateHeader(headerText, year);
  const result = [];
  for (const priceLine of priceLines) {
    const prices = extractDollarPrices(priceLine);
    const count = Math.min(groups.length, prices.length);
    for (let i = 0; i < count; i++) {
      for (const d of groups[i]) result.push({ start:d.start, end:d.end, price:prices[i] });
    }
  }
  return result;
}

function extractJxSimpleRows(lines, label, year) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^\\s*' + esc + '(\\s|$)');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!re.test(l) || !/\$\d/.test(l)) continue;
    const headerText = _jxRouteHeader(lines, i);
    if (!headerText) continue;
    return _jxFareRows(headerText, [l], year);
  }
  return [];
}

function extractJxTYORows(lines, year) {
  // TYO rows: lines starting with '$' (no label, no flight prefix)
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\$[\d,]/.test(lines[i])) continue;
    // Collect consecutive price-only lines
    let end = i;
    while (end < lines.length && /^\s*\$[\d,]/.test(lines[end])) end++;
    const runLen = end - i;
    if (runLen < 2) { i = end; continue; }
    const headerText = _jxRouteHeader(lines, i);
    if (!headerText) { i = end; continue; }
    const depFlights = ['JX800', 'JX802', 'JX804'];
    const result = [];
    for (let k = 0; k < Math.min(runLen, depFlights.length); k++) {
      const prices = extractDollarPrices(lines[i + k]);
      const groups = parseJxDateHeader(headerText, year);
      const count = Math.min(groups.length, prices.length);
      for (let m = 0; m < count; m++) {
        for (const d of groups[m]) result.push({ start:d.start, end:d.end, price:prices[m], dep:depFlights[k] });
      }
    }
    return result;
  }
  return [];
}

function extractJxKIXRows(lines, year) {
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(JX8\d{2})\s+(JX8\d{2})\s+\$/);
    if (!m) continue;
    const dep = m[1], ret = m[2];
    const headerText = _jxRouteHeader(lines, i);
    if (!headerText) continue;
    const prices = extractDollarPrices(lines[i]);
    const groups = parseJxDateHeader(headerText, year);
    const count = Math.min(groups.length, prices.length);
    for (let k = 0; k < count; k++) {
      for (const d of groups[k]) result.push({ start:d.start, end:d.end, price:prices[k], dep, ret });
    }
  }
  return result;
}

function extractJxPUSRows(lines, year) {
  const pusFlights = [
    { dep:'JX900', ret:'JX901' }, { dep:'JX900', ret:'JX903' },
    { dep:'JX902', ret:'JX901' }, { dep:'JX902', ret:'JX903' },
  ];
  const idxs = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*JX9\d{2}\s+\$/.test(lines[i])) idxs.push(i);
  }
  if (idxs.length < 4) return [];
  const headerText = _jxRouteHeader(lines, idxs[0]);
  if (!headerText) return [];
  const groups = parseJxDateHeader(headerText, year);
  const result = [];
  for (let k = 0; k < Math.min(idxs.length, pusFlights.length); k++) {
    const prices = extractDollarPrices(lines[idxs[k]]);
    const count = Math.min(groups.length, prices.length);
    const { dep, ret } = pusFlights[k];
    for (let m = 0; m < count; m++) {
      for (const d of groups[m]) result.push({ start:d.start, end:d.end, price:prices[m], dep, ret });
    }
  }
  return result;
}

/**
 * JX 日期表頭解析 — 回傳 column groups
 * groups[i] = [{ start, end }, ...] 同一 price column 可包含多個日期（&連接）
 */
function parseJxDateHeader(text, year) {
  const cleaned = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ').filter(t => t.length > 0);
  const groups = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    let dateItem = null;
    if (/^\d+\/\d+-\d+\/\d+$/.test(t)) {
      const [s, e] = t.split('-');
      dateItem = { start: toISO(s, year), end: toISO(e, year) };
    } else if (/^\d+\/\d+$/.test(t)) {
      dateItem = { start: toISO(t, year), end: toISO(t, year) };
    }
    if (dateItem) {
      if (i > 0 && tokens[i - 1] === '&' && groups.length > 0) {
        groups[groups.length - 1].push(dateItem);
      } else {
        groups.push([dateItem]);
      }
    }
    i++;
  }
  return groups;
}


// ═══════════════════════════════════════════════════════════════
// CI 解析
// ═══════════════════════════════════════════════════════════════

// CI 航班號 → 目的地對照表
const CI_DEST_MAP = {
  // NRT 東京成田
  '100':'NRT','101':'NRT','104':'NRT','105':'NRT',
  '106':'NRT','107':'NRT','108':'NRT','109':'NRT',
  '110':'NRT','111':'NRT','116':'NRT','117':'NRT',
  '128':'NRT','129':'NRT','194':'NRT','195':'NRT',
  '394':'NRT','395':'NRT',
  // NGO 名古屋
  '150':'NGO','151':'NGO','154':'NGO','155':'NGO',
  // CTS 札幌
  '130':'CTS','131':'CTS',
  // FUK 福岡
  '152':'FUK','153':'FUK','156':'FUK','157':'FUK','172':'FUK','173':'FUK',
  // OKA 沖繩
  '178':'OKA','179':'OKA','278':'OKA','279':'OKA',
  // KIX 大阪關西
  '112':'KIX','113':'KIX','120':'KIX','121':'KIX','122':'KIX','123':'KIX',
  // KOJ 鹿兒島
  '118':'KOJ','119':'KOJ',
  // HIJ 廣島
  '140':'HIJ','141':'HIJ',
  // TAK 高松
  '134':'TAK','135':'TAK',
  // KMJ 熊本
  '160':'KMJ','161':'KMJ',
};

/**
 * 從字串中提取 CI 航班號陣列，例如：
 * "CI 156、CI 152" → ["CI156","CI152"]
 * "118" → ["CI118"]
 * "117/129" → ["CI117","CI129"]
 */
function extractCIFlightCodes(groupStr) {
  const codes = [];
  const ciRe = /CI\s*(\d{2,3})/g;
  let m;
  while ((m = ciRe.exec(groupStr)) !== null) codes.push('CI' + m[1]);
  if (codes.length === 0) {
    // 無 CI 前綴（例如 KOJ 段落）
    const numRe = /\b(\d{3})\b/g;
    while ((m = numRe.exec(groupStr)) !== null) codes.push('CI' + m[1]);
  }
  return [...new Set(codes)];
}

/**
 * 從文件尾端的路線索引解析 NRT 出發航班分組
 * CI2026 範例：TPE-NRT-TPE 之後有 CI100 / CI104 / CI108、CI106
 * 回傳 ["CI100", "CI104", "CI108、CI106"]
 */
function parseCIRouteIndex(lines) {
  let nrtIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/TPE-NRT-TPE/i.test(lines[i])) { nrtIdx = i; break; }
  }
  if (nrtIdx < 0) return [];

  const groups = [];
  for (let i = nrtIdx + 1; i < Math.min(nrtIdx + 10, lines.length); i++) {
    const l = lines[i].trim();
    if (/^TPE-[A-Z]/i.test(l) || l.length === 0) break;
    const flights = extractCIFlightCodes(l);
    const nrtFlights = flights.filter(f => {
      const num = f.match(/\d{3}/)?.[0];
      return num && CI_DEST_MAP[num] === 'NRT';
    });
    if (nrtFlights.length > 0) groups.push(nrtFlights.join('、'));
  }
  return groups;
}

/**
 * 解析單一 CI 票價列，回傳 {depFlights, retFlights, tuanXing, prices} 或 null
 * 支援：
 *  - dep + ret 兩組航班（一般情況）
 *  - 只有 ret（NRT 合併格情況）
 *  - 含 団型 欄（4D / 5D-8D / ALL / 鹿鹿 等）
 */
function parseCIFareRow(line) {
  // 移除路線標籤，例如 TPE-CTS-TPE
  const clean = line.trim().replace(/TPE-[A-Z]{3}(?:[xX×][A-Z]{3})?-TPE/gi, '').trim();
  if (!/\b\d{1,2},\d{3}\b/.test(clean)) return null;

  const pm = clean.match(/\d{1,2},\d{3}/);
  if (!pm) return null;
  const pStart = clean.indexOf(pm[0]);

  const beforePrices = clean.substring(0, pStart).trim();
  const prices = extractNumPrices(clean.substring(pStart));
  if (prices.length === 0) return null;

  // 按 2 個以上空白拆分為群組
  const rawGroups = beforePrices.split(/\s{2,}/).map(g => g.trim()).filter(Boolean);

  const flightGroups = [];
  let tuanXing = '';

  for (const g of rawGroups) {
    if (/CI\s*\d{2,3}/.test(g) ||       // "CI 156", "CI 156、CI 152"
        /^\d{3}(、\d{3})*$/.test(g) ||  // "118", "118、119"
        /^\d{3}\/\d{3}$/.test(g)) {     // "117/129"
      flightGroups.push(g);
    } else if (g) {
      tuanXing = tuanXing || g;          // 団型（4D / 5D-8D / ALL / 鹿鹿 …）
    }
  }

  let depFlights = [];
  let retFlights = [];

  if (flightGroups.length >= 2) {
    depFlights = extractCIFlightCodes(flightGroups[0]);
    retFlights = extractCIFlightCodes(flightGroups[1]);
  } else if (flightGroups.length === 1) {
    retFlights = extractCIFlightCodes(flightGroups[0]);
    // depFlights 留空 → NRT 合併格，之後由 nrtDepGroups 填入
  }

  if (depFlights.length + retFlights.length === 0) return null;
  return { depFlights, retFlights, tuanXing, prices };
}

/**
 * 處理單一區段（從一個「票價 出發班次 回程班次」標題開始）
 * 回傳 [{destination, start, end, price, depFlight, retFlight, tuanXing}, ...]
 */
function processCISection(sectionLines, year, nrtDepGroups) {
  // 跳過 CTS 區段（由 extractCIRows 處理，避免重複）
  if (sectionLines.some(l => /TPE-CTS-TPE/.test(l))) return [];

  // 找出第一個票價列的位置
  const firstFareIdx = sectionLines.findIndex((l, i) => i > 0 && /\b\d{1,2},\d{3}\b/.test(l));
  if (firstFareIdx < 0) return [];

  const headerLines = sectionLines.slice(1, firstFareIdx);

  // 解析所有票價列
  const parsedRows = [];
  for (let i = firstFareIdx; i < sectionLines.length; i++) {
    const row = parseCIFareRow(sectionLines[i]);
    if (row) parsedRows.push(row);
  }
  if (parsedRows.length === 0) return [];

  // NRT 合併格：補入出發航班
  const noDep = parsedRows.filter(r => r.depFlights.length === 0);
  if (noDep.length > 0 && nrtDepGroups.length > 0) {
    const firstRet = noDep[0].retFlights[0];
    const firstRetNum = firstRet && firstRet.match(/\d{3}/)?.[0];
    if (CI_DEST_MAP[firstRetNum] === 'NRT') {
      const perGroup = Math.ceil(noDep.length / nrtDepGroups.length);
      let gIdx = 0, cnt = 0;
      for (const row of parsedRows) {
        if (row.depFlights.length === 0) {
          row.depFlights = extractCIFlightCodes(nrtDepGroups[gIdx] || '');
          cnt++;
          if (cnt >= perGroup && gIdx < nrtDepGroups.length - 1) { gIdx++; cnt = 0; }
        }
      }
    }
  }

  // 解析日期表頭（以第一列的價格數量為基準）
  const P0 = parsedRows[0].prices.length;
  const baseColumns = parseCIDateColumnsFromLines(headerLines, year, P0);

  const results = [];
  for (const row of parsedRows) {
    const depStr = row.depFlights.join('、');
    const retStr = row.retFlights.join('、');

    // 從出發或回程第一個航班號判斷目的地
    const keyFlight = row.depFlights[0] || row.retFlights[0];
    const flightNum = keyFlight && keyFlight.match(/\d{3}/)?.[0];
    const destination = flightNum ? (CI_DEST_MAP[flightNum] || null) : null;
    if (!destination) continue;

    const P = row.prices.length;
    const columns = P === P0 ? baseColumns : parseCIDateColumnsFromLines(headerLines, year, P);

    for (let i = 0; i < Math.min(columns.length, P); i++) {
      for (const dr of columns[i]) {
        results.push({
          destination,
          start: dr.start, end: dr.end,
          price: row.prices[i],
          depFlight: depStr,
          retFlight: retStr,
          tuanXing: row.tuanXing || '',
        });
      }
    }
  }
  return results;
}

/**
 * 提取 CI PDF 中所有非 CTS 航點的票價列
 */
function extractCIAllOtherRows(fullText, year) {
  const lines = fullText.split('\n').map(l => l.trim());
  const nrtDepGroups = parseCIRouteIndex(lines);

  // 找所有區段起始點（含「票價」及「出發班次」的行）
  const sectionStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (/票價/.test(lines[i]) && /出發班次/.test(lines[i])) sectionStarts.push(i);
  }

  const allRows = [];
  for (let s = 0; s < sectionStarts.length; s++) {
    const start = sectionStarts[s];
    const end = s + 1 < sectionStarts.length ? sectionStarts[s + 1] : lines.length;
    const rows = processCISection(lines.slice(start, end), year, nrtDepGroups);
    allRows.push(...rows);
  }
  return allRows;
}

function parseCI(fullText, fileName) {
  const results = [];
  const fareType = detectFareType(fileName);
  const discount = fareType !== 'Promotion' ? -500 : 0;

  const versionMatch = fullText.match(/第[（(]?(\d+)[）)]?版/);
  const version = versionMatch ? `第${versionMatch[1]}版` : '';

  const issueDateMatch = fullText.match(/(\d{2})([A-Z]{3})(\d{2,4})/i);
  let issueDate = '';
  if (issueDateMatch) {
    const months = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
    const y = issueDateMatch[3].length === 2 ? 2000 + parseInt(issueDateMatch[3]) : parseInt(issueDateMatch[3]);
    const mo = months[issueDateMatch[2].toUpperCase()] || 1;
    issueDate = `${y}-${String(mo).padStart(2,'0')}-${String(parseInt(issueDateMatch[1])).padStart(2,'0')}`;
  }

  const yearMatch = fullText.match(/20(\d{2})\s*(上半年|下半年|H[12])/i)
    || fullText.match(/開票日[^0-9]*(\d{4})/);
  let year = '';
  if (yearMatch) {
    year = yearMatch[1].length === 2 ? '20' + yearMatch[1] : yearMatch[1];
  }
  if (!year) year = String(new Date().getFullYear() + 1);

  const ticketStartMatch = fullText.match(/開票日[：:]?\s*(\d{2})([A-Z]{3})(\d{2,4})/i);
  let ticketStart = issueDate;
  if (ticketStartMatch) {
    const months = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
    const y2 = ticketStartMatch[3].length === 2 ? 2000 + parseInt(ticketStartMatch[3]) : parseInt(ticketStartMatch[3]);
    const mo2 = months[ticketStartMatch[2].toUpperCase()] || 1;
    ticketStart = `${y2}-${String(mo2).padStart(2,'0')}-${String(parseInt(ticketStartMatch[1])).padStart(2,'0')}`;
  }

  // 1. CTS（沿用原有邏輯，已驗證正確）
  const ctsRows = extractCIRows(fullText, year);
  for (const row of ctsRows) {
    results.push({
      airline:'CI', fare_type: fareType, version,
      issue_date: issueDate, ticket_issue_start: ticketStart, ticket_issue_end:'2099-12-31',
      destination:'CTS',
      dep_date_start: row.start, dep_date_end: row.end,
      price: String(row.price + discount), agent_discount: String(discount),
      dep_flight:'CI130', ret_flight:'CI131',
      tour_code:'', currency:'TWD', is_active:'TRUE',
      source_file: fileName,
    });
  }

  // 2. 其他航點（新邏輯）
  const otherRows = extractCIAllOtherRows(fullText, year);
  for (const row of otherRows) {
    if (row.destination === 'CTS') continue;
    results.push({
      airline:'CI', fare_type: fareType, version,
      issue_date: issueDate, ticket_issue_start: ticketStart, ticket_issue_end:'2099-12-31',
      destination: row.destination,
      dep_date_start: row.start, dep_date_end: row.end,
      price: String(row.price + discount), agent_discount: String(discount),
      dep_flight: row.depFlight, ret_flight: row.retFlight,
      tour_code: row.tuanXing || '', currency:'TWD', is_active:'TRUE',
      source_file: fileName,
    });
  }

  return results;
}

/**
 * 從 CI PDF 全文找 CTS 票價列（TPE/CTS/TPE 或 TPE-CTS-TPE + CI 130/131）
 * 往上找到「適用航線/出發班次/票價」表頭列（最多搜尋 25 行）
 * 收集表頭到票價列之間的所有行，用行隔離度演算法識別合併儲存格
 */
function extractCIRows(fullText, year) {
  const lines = fullText.split('\n').map(l => l.trim());
  const result = [];

  for (let fareIdx = 0; fareIdx < lines.length; fareIdx++) {
    const fareLine = lines[fareIdx];
    // 找含 CTS 且含 CI 130/131 的票價行
    if (!/CTS/.test(fareLine)) continue;
    if (!/CI[\s]?13[01]/.test(fareLine) && !/TPE[/\-]CTS/.test(fareLine)) continue;

    const prices = extractNumPrices(fareLine);
    if (prices.length < 2) continue;

    // 最後一個小值（≤2000）視為週末加價，移除
    const surcharge = prices[prices.length - 1] <= 2000 ? prices[prices.length - 1] : 0;
    const farePrices = surcharge > 0 ? prices.slice(0, -1) : prices;
    const P = farePrices.length;

    // 往上搜尋表頭行（最多 25 行）
    let headerIdx = -1;
    for (let j = fareIdx - 1; j >= Math.max(0, fareIdx - 25); j--) {
      if (/適用航線|出發班次|票價.*回程/.test(lines[j])) {
        headerIdx = j;
        break;
      }
    }
    if (headerIdx < 0) continue;

    // 收集表頭到票價列之間的所有行
    const headerLines = lines.slice(headerIdx, fareIdx);

    // 解析日期欄位（傳入期望欄位數 P 供校驗）
    const columns = parseCIDateColumnsFromLines(headerLines, year, P);

    for (let i = 0; i < Math.min(columns.length, P); i++) {
      const price = farePrices[i];
      for (const dr of columns[i]) {
        result.push({ start: dr.start, end: dr.end, price });
      }
    }
  }
  return result;
}

/**
 * 從多行表頭文字中解析 CI 日期欄位
 * 演算法：
 *  1. 對每行提取日期 token
 *  2. 只含 1 個 token 的行標記為「孤立行」，可能是合併儲存格的子範圍
 *  3. 連續孤立行 → 合併為一個欄位（共享同一票價）
 *  4. 若欄位數 > targetCount，把相鄰合併欄位的前一個欄位也併入
 *
 * columns[i] = [{ start, end }, ...]  — 該欄位內所有日期段共用同一票價
 */
function parseCIDateColumnsFromLines(headerLines, year, targetCount) {
  // 步驟 1：每行提取 token，token = [{ start, end }, ...]（一個欄位的所有日期段）
  const lineData = [];
  for (const line of headerLines) {
    const tokens = extractCILineTokens(line, year);
    if (tokens.length === 0) continue;
    lineData.push({ tokens, isolated: tokens.length === 1 });
  }

  // 步驟 2：依隔離度分組
  const columns = [];
  let i = 0;
  while (i < lineData.length) {
    if (lineData[i].isolated) {
      // 連續孤立行 → 合併為一個欄位
      const group = [...lineData[i].tokens[0]];
      let j = i + 1;
      while (j < lineData.length && lineData[j].isolated) {
        group.push(...lineData[j].tokens[0]);
        j++;
      }
      columns.push(group);
      i = j;
    } else {
      // 多 token 行：每個 token 為一個獨立欄位
      for (const tok of lineData[i].tokens) {
        columns.push(tok);
      }
      i++;
    }
  }

  // 步驟 3：若欄位數仍多於目標，找到最先出現的合併欄（length>1）
  // 並把它前一個欄位的內容併入該合併欄（解決 5/5-5/31 + 6/1-6/4... 的問題）
  while (columns.length > targetCount) {
    let absorbed = false;
    for (let k = 1; k < columns.length; k++) {
      if (columns[k].length > 1) {
        const prev = columns.splice(k - 1, 1)[0];
        columns[k - 1] = [...prev, ...columns[k - 1]];
        absorbed = true;
        break;
      }
    }
    if (!absorbed) break;
  }

  return columns;
}

/**
 * 從單行文字提取 CI 日期 token 陣列
 * 回傳 token[][]: 每個 token 是 [{ start, end }, ...]（一個欄位可含多個日期段）
 * 處理規則：
 *  - 「M/D、M/D」→ 一個 token，兩個單日（共享同一票價）
 *  - 「M/D,」末尾逗號 → 獨立 token（半形逗號只是分隔符，不代表同欄）
 *  - 「M/D-M/D」→ 一個 token，日期範圍
 *  - 「M/D」→ 一個 token，單日
 */
function extractCILineTokens(line, year) {
  let s = line
    .replace(/適用航線.*?回程班次/g, '')
    .replace(/出發班次.*?回程班次/g, '')
    .replace(/票價.*?回程班次/g, '')
    .replace(/行程含[\s\S]*/g, '')
    .replace(/\([A-Za-z]\)/g, '')        // (P) (H) (OB) 等標籤
    .replace(/（[^）]*）/g, '')
    .replace(/[一-鿿]+/g, ' ')            // 移除中文
    .replace(/CONTRACT.*$/i, '')
    .replace(/，/g, '、')                 // 全形逗號→、
    .trim();

  // 修復「1/1- 1/4」或「8/8 -8/16」→「1/1-1/4」
  s = s.replace(/(\d+\/\d+)\s*-\s*(\d+\/\d+)/g, '$1-$2');

  // 半形逗號視為空白（不轉成 、，保持各自獨立）
  s = s.replace(/,/g, ' ');

  const parts = s.split(/\s+/).filter(t => /\d/.test(t));
  const tokens = [];

  for (const t of parts) {
    if (t.includes('、')) {
      // 「M/D、M/D」或「M/D-M/D、M/D」→ 同一欄位多個日期段
      const subParts = t.split('、');
      const col = [];
      for (const sp of subParts) {
        const clean = sp.trim();
        if (/^\d+\/\d+-\d+\/\d+$/.test(clean)) {
          const [s2, e2] = clean.split('-');
          col.push({ start: toISO(s2, year), end: toISO(e2, year) });
        } else if (/^\d+\/\d+$/.test(clean)) {
          col.push({ start: toISO(clean, year), end: toISO(clean, year) });
        }
      }
      if (col.length > 0) tokens.push(col);
    } else if (/^\d+\/\d+-\d+\/\d+$/.test(t)) {
      const [s2, e2] = t.split('-');
      tokens.push([{ start: toISO(s2, year), end: toISO(e2, year) }]);
    } else if (/^\d+\/\d+$/.test(t)) {
      tokens.push([{ start: toISO(t, year), end: toISO(t, year) }]);
    }
  }

  return tokens;
}


// ═══════════════════════════════════════════════════════════════
// BR 解析
// ═══════════════════════════════════════════════════════════════

function parseBRDateHeader(text, year) {
  const cleaned = text
    .replace(/航線|出發班次|回程班次/g, '')
    .replace(/[一-鿿]+/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .trim();

  const ranges = [];
  const tokens = cleaned.split(/\s+/).filter(t => /\d+\/\d+/.test(t));

  for (const t of tokens) {
    // 6/27-7/31 (cross-month range)
    const fullRange = t.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})$/);
    if (fullRange) {
      ranges.push({
        start: `${year}-${fullRange[1].padStart(2,'0')}-${fullRange[2].padStart(2,'0')}`,
        end:   `${year}-${fullRange[3].padStart(2,'0')}-${fullRange[4].padStart(2,'0')}`,
      });
      continue;
    }
    // 8/8-16 (same-month range)
    const shortRange = t.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})$/);
    if (shortRange) {
      ranges.push({
        start: `${year}-${shortRange[1].padStart(2,'0')}-${shortRange[2].padStart(2,'0')}`,
        end:   `${year}-${shortRange[1].padStart(2,'0')}-${shortRange[3].padStart(2,'0')}`,
      });
      continue;
    }
    // 12/24.25 (dot-separated two dates, same month)
    const dotRange = t.match(/^(\d{1,2})\/(\d{1,2})\.(\d{1,2})$/);
    if (dotRange) {
      ranges.push({
        start: `${year}-${dotRange[1].padStart(2,'0')}-${dotRange[2].padStart(2,'0')}`,
        end:   `${year}-${dotRange[1].padStart(2,'0')}-${dotRange[3].padStart(2,'0')}`,
      });
      continue;
    }
    // 9/23 (single date)
    const single = t.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (single) {
      const d = `${year}-${single[1].padStart(2,'0')}-${single[2].padStart(2,'0')}`;
      ranges.push({ start: d, end: d });
    }
  }
  return ranges;
}

function parseBR(fullText, fileName) {
  const versionMatch = fullText.match(/第\s*(\d+)\s*版/);
  const version = versionMatch ? `第${versionMatch[1]}版` : '';

  const issueDateMatch = fullText.match(/(\d{2})([A-Z]{3})[''']?(\d{2})/i);
  let issueDate = '';
  if (issueDateMatch) {
    const months = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
    const y = 2000 + parseInt(issueDateMatch[3]);
    const mo = months[issueDateMatch[2].toUpperCase()] || 1;
    issueDate = `${y}-${String(mo).padStart(2,'0')}-${String(parseInt(issueDateMatch[1])).padStart(2,'0')}`;
  }

  const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const ymFull = fullText.match(/(\d{4})年/);
  const tableYear = ymFull ? ymFull[1] : (issueDate ? issueDate.slice(0,4) : String(new Date().getFullYear()));
  const fareType = detectFareType(fileName);

  const meta = {
    airline:'BR', fare_type:fareType, version,
    issue_date:issueDate, ticket_issue_start:issueDate, ticket_issue_end:'2099-12-31',
    agent_discount:'0', tour_code:'', currency:'TWD', is_active:'TRUE', source_file:fileName,
  };

  // Collect all section header indices (lines with 出發班次 + dates)
  const hdrIdxs = [];
  for (let i = 0; i < lines.length; i++) {
    if (/出發班次/.test(lines[i]) && /\d+\/\d+/.test(lines[i])) hdrIdxs.push(i);
  }

  const all = [];

  // Extract prices from a fare row; treats "-" as 0 (no service); skips flight codes (<1000)
  function brPrices(line) {
    const result = [];
    for (const tok of line.split(/\s+/)) {
      if (tok === '-') { result.push(0); continue; }
      const n = parseInt(tok.replace(/,/g,''));
      if (!isNaN(n) && n >= 1000 && n <= 99999) result.push(n);
    }
    return result;
  }

  // Get fare rows (≥3 prices) between startIdx and endIdx
  function getFareRows(startIdx, endIdx) {
    const rows = [];
    for (let i = startIdx; i < endIdx; i++) {
      if (brPrices(lines[i]).length >= 3) rows.push(lines[i]);
    }
    return rows;
  }

  // Push rows for dest/dep/ret with given dates and prices; skips 0 (no-service)
  function push(dest, dates, prices, dep, ret) {
    const count = Math.min(dates.length, prices.length);
    for (let k = 0; k < count; k++) {
      if (!prices[k]) continue;
      all.push({ ...meta, destination:dest,
        dep_date_start:dates[k].start, dep_date_end:dates[k].end,
        price:String(prices[k]), dep_flight:dep, ret_flight:ret });
    }
  }

  // ── Full V4 parsing (10 section headers: CTS/SDJ+AOJ/KMQ/MYJ/NRT/KIX/UKB main/UKB sub/FUK/OKA) ──
  if (hdrIdxs.length >= 10) {

    // Section 0: CTS — dep=BR116/BR166, ret=BR165 or BR115
    {
      const dates = parseBRDateHeader(lines[hdrIdxs[0]], tableYear);
      const rows = getFareRows(hdrIdxs[0]+1, hdrIdxs[1]);
      const specs = [
        { dep:'BR116', rets:['BR165','BR115'] },
        { dep:'BR166', rets:['BR165','BR115'] },
      ];
      for (let ri = 0; ri < Math.min(specs.length, rows.length); ri++) {
        const prices = brPrices(rows[ri]);
        for (const ret of specs[ri].rets) push('CTS', dates, prices, specs[ri].dep, ret);
      }
    }

    // Section 1: SDJ (rows 0-1) + AOJ (rows 2-3)
    {
      const dates = parseBRDateHeader(lines[hdrIdxs[1]], tableYear);
      const rows = getFareRows(hdrIdxs[1]+1, hdrIdxs[2]);
      const specs = [
        { dest:'SDJ', dep:'BR118', ret:'BR117' },
        { dest:'SDJ', dep:'BR118', ret:'BR121' },
        { dest:'AOJ', dep:'BR122', ret:'BR117' },
        { dest:'AOJ', dep:'BR122', ret:'BR121' },
      ];
      for (let ri = 0; ri < Math.min(specs.length, rows.length); ri++) {
        push(specs[ri].dest, dates, brPrices(rows[ri]), specs[ri].dep, specs[ri].ret);
      }
    }

    // Section 2: KMQ
    {
      const dates = parseBRDateHeader(lines[hdrIdxs[2]], tableYear);
      const rows = getFareRows(hdrIdxs[2]+1, hdrIdxs[3]);
      if (rows.length >= 1) push('KMQ', dates, brPrices(rows[0]), 'BR158', 'BR157');
    }

    // Section 3: MYJ
    {
      const dates = parseBRDateHeader(lines[hdrIdxs[3]], tableYear);
      const rows = getFareRows(hdrIdxs[3]+1, hdrIdxs[4]);
      if (rows.length >= 1) push('MYJ', dates, brPrices(rows[0]), 'BR110', 'BR109');
    }

    // Section 4: NRT — row 1 has split prices: 12,000(184) / 13,000(198) for one date column
    {
      const dates = parseBRDateHeader(lines[hdrIdxs[4]], tableYear);
      let scanFrom = hdrIdxs[4] + 1;

      // Row 1: "198/184   197/183   prices..."
      if (scanFrom < hdrIdxs[5] && /\d{3}\/\d{3}/.test(lines[scanFrom])) {
        const pricesHead = brPrices(lines[scanFrom]);
        let p184 = 0, p198 = 0, tail = [];
        for (let j = scanFrom + 1; j < Math.min(scanFrom + 6, hdrIdxs[5]); j++) {
          const m184 = lines[j].match(/^([\d,]+)\(184\)/);
          const m198 = lines[j].match(/^([\d,]+)\(198\)/);
          if (m184) { p184 = parseInt(m184[1].replace(/,/g,'')); continue; }
          if (m198) { p198 = parseInt(m198[1].replace(/,/g,'')); continue; }
          if (!lines[j].includes('(') && brPrices(lines[j]).length >= 5) {
            tail = brPrices(lines[j]);
            scanFrom = j + 1;
            break;
          }
        }
        const p198full = [...pricesHead, p198, ...tail];
        const p184full = [...pricesHead, p184, ...tail];
        for (const [dep, prices] of [['BR198', p198full], ['BR184', p184full]]) {
          for (const ret of ['BR197','BR183']) push('NRT', dates, prices, dep, ret);
        }
      }

      // Rows 2-3: standard
      const nrtRows = getFareRows(scanFrom, hdrIdxs[5]);
      if (nrtRows.length >= 1) push('NRT', dates, brPrices(nrtRows[0]), 'BR196', 'BR195');
      if (nrtRows.length >= 2) {
        const prices = brPrices(nrtRows[1]);
        for (const ret of ['BR197','BR183']) push('NRT', dates, prices, 'BR196', ret);
      }
    }

    // Section 5: KIX — rows 3-4 have dep=BR130 implied (not shown in text)
    {
      const dates = parseBRDateHeader(lines[hdrIdxs[5]], tableYear);
      const rows = getFareRows(hdrIdxs[5]+1, hdrIdxs[6]);
      const specs = [
        { dep:'BR178', rets:['BR177','BR131'] },
        { dep:'BR132', rets:['BR177','BR131'] },
        { dep:'BR130', rets:['BR177','BR131'] },  // dep implied
        { dep:'BR130', rets:['BR129'] },            // dep implied
      ];
      for (let ri = 0; ri < Math.min(specs.length, rows.length); ri++) {
        const prices = brPrices(rows[ri]);
        for (const ret of specs[ri].rets) push('KIX', dates, prices, specs[ri].dep, ret);
      }
    }

    // Section 6+7b: UKB — two headers, three rows total
    {
      // Row 1 from main UKB header
      const dates1 = parseBRDateHeader(lines[hdrIdxs[6]], tableYear);
      const rows1 = getFareRows(hdrIdxs[6]+1, hdrIdxs[7]);
      if (rows1.length >= 1) push('UKB', dates1, brPrices(rows1[0]), 'BR134', 'BR133');

      // Rows 2-3 from sub-header; dep=BR176 implied
      const dates2 = parseBRDateHeader(lines[hdrIdxs[7]], tableYear);
      const rows2 = getFareRows(hdrIdxs[7]+1, hdrIdxs[8]);
      const ukbSpecs = [
        { dep:'BR176', ret:'BR175' },
        { dep:'BR176', ret:'BR133' },
      ];
      for (let ri = 0; ri < Math.min(ukbSpecs.length, rows2.length); ri++) {
        push('UKB', dates2, brPrices(rows2[ri]), ukbSpecs[ri].dep, ukbSpecs[ri].ret);
      }
    }

    // Section 8: FUK — text shows ret flight only; dep assigned by row order
    {
      const dates = parseBRDateHeader(lines[hdrIdxs[8]], tableYear);
      const rows = getFareRows(hdrIdxs[8]+1, hdrIdxs[9]);
      const specs = [
        { dep:'BR106', ret:'BR105' },
        { dep:'BR106', ret:'BR101' },
        { dep:'BR102', ret:'BR105' },
        { dep:'BR102', ret:'BR101' },
      ];
      for (let ri = 0; ri < Math.min(specs.length, rows.length); ri++) {
        push('FUK', dates, brPrices(rows[ri]), specs[ri].dep, specs[ri].ret);
      }
    }

    // Section 9: OKA — text shows ret flight only; dep assigned by row order
    {
      const dates = parseBRDateHeader(lines[hdrIdxs[9]], tableYear);
      const rows = getFareRows(hdrIdxs[9]+1, lines.length);
      const specs = [
        { dep:'BR112', ret:'BR113' },
        { dep:'BR112', ret:'BR185' },
        { dep:'BR186', ret:'BR113' },
        { dep:'BR186', ret:'BR185' },
      ];
      for (let ri = 0; ri < Math.min(specs.length, rows.length); ri++) {
        push('OKA', dates, brPrices(rows[ri]), specs[ri].dep, specs[ri].ret);
      }
    }

    return all;
  }

  // ── Fallback: CTS-only (V1/V2/V3 without all sections) ──
  let headerLineIdx = -1;
  let headerDates = [];
  for (const hi of hdrIdxs) {
    let hasCTS = false;
    for (let j = hi + 1; j < Math.min(hi + 8, lines.length); j++) {
      if (/\b116\b/.test(lines[j]) || /\b166\b/.test(lines[j])) { hasCTS = true; break; }
    }
    if (hasCTS) { headerLineIdx = hi; headerDates = parseBRDateHeader(lines[hi], tableYear); break; }
  }
  if (headerLineIdx === -1) return all;

  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/出發班次/.test(l) && /\d+\/\d+/.test(l)) break;
    const m = l.match(/^(\d{3})\s+([\d/]+)/);
    if (!m || (m[1] !== '116' && m[1] !== '166')) continue;
    const prices = brPrices(l);
    if (!prices.length) continue;
    const dep = 'BR' + m[1];
    const retRaw = m[2];
    const ret = 'BR' + (retRaw.includes('165') ? '165' : retRaw.includes('115') ? '115' : retRaw);
    push('CTS', headerDates, prices, dep, ret);
  }
  return all;
}


// ═══════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════

function parseFareTable(fullText, fileName) {
  const airline = detectAirline(fileName);
  if (airline === 'JX') return { airline, rows: parseJX(fullText, fileName) };
  if (airline === 'CI') return { airline, rows: parseCI(fullText, fileName) };
  if (airline === 'BR') return { airline, rows: parseBR(fullText, fileName) };
  return { airline: null, rows: [] };
}
