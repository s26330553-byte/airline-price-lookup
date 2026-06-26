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
  const results = [];

  const versionMatch = fullText.match(/版本\s*(\d+)/);
  const version = versionMatch ? `第${versionMatch[1]}版` : '';
  const issueDateMatch = fullText.match(/(\d{4}-\d{2}-\d{2})/);
  const issueDate = issueDateMatch ? issueDateMatch[0] : '';
  const tourCodeMatch = fullText.match(/Tour\s*Code\s+([A-Z0-9]+)/);
  const tourCode = tourCodeMatch ? tourCodeMatch[1] : '';
  const yearMatch = fullText.match(/適用出發區間\s*(\d{4})\//);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  for (const { label, flight } of [{ label:'CTS', flight:'JX850' }, { label:'HKD', flight:'JX860' }]) {
    const rows = extractJxRows(fullText, label, year);
    for (const row of rows) {
      results.push({
        airline:'JX', fare_type:'Standard', version,
        issue_date: issueDate, ticket_issue_start: issueDate, ticket_issue_end:'2099-12-31',
        destination: label,
        dep_date_start: row.start, dep_date_end: row.end,
        price: String(row.price), agent_discount:'0',
        dep_flight: flight, ret_flight:'',
        tour_code: tourCode, currency:'TWD', is_active:'TRUE',
        source_file: fileName,
      });
    }
  }
  return results;
}

function extractJxRows(fullText, label, year) {
  const lines = fullText.split('\n');

  // Find the fare row: line starting with label followed by $ prices
  let fareIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith(label) && /\$\d/.test(l)) {
      fareIdx = i;
      break;
    }
  }
  if (fareIdx < 0) return [];

  const prices = extractDollarPrices(lines[fareIdx]);
  if (prices.length === 0) return [];

  // Search backward for the Route header (max 20 lines)
  let routeIdx = -1;
  for (let j = fareIdx - 1; j >= Math.max(0, fareIdx - 20); j--) {
    if (/^\s*Route\b/.test(lines[j])) {
      routeIdx = j;
      break;
    }
  }
  if (routeIdx < 0) return [];

  // Collect header lines from routeIdx to fareIdx (exclusive), concatenate
  const headerText = lines.slice(routeIdx, fareIdx)
    .join(' ')
    .replace(/^\s*Route\s+/, '')      // strip "Route" prefix
    .replace(/\([^)]*\)/g, ' ')       // remove (PP) (P) (OB) (中秋) etc.
    .replace(/[一-鿿]+/g, ' ')        // remove Chinese chars
    .replace(/\s+/g, ' ')
    .trim();

  const groups = parseJxDateHeader(headerText, year);
  const count = Math.min(groups.length, prices.length);
  const result = [];
  for (let i = 0; i < count; i++) {
    const price = prices[i];
    for (const dateItem of groups[i]) {
      result.push({ start: dateItem.start, end: dateItem.end, price });
    }
  }
  return result;
}

/**
 * JX 日期表頭解析 — 回傳 column groups
 * groups[i] = [{ start, end }, ...] 所有日期共用 prices[i]
 * 「M/D & M/D」表示同一個 price column，兩個日期都用相同票價
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
      // Check if previous token was '&' → add to current group (same price)
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

function parseCI(fullText, fileName) {
  const results = [];
  const fareType = detectFareType(fileName);

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

  const ctsRows = extractCIRows(fullText, year);
  for (const row of ctsRows) {
    const discount = fareType !== 'Promotion' ? -500 : 0;
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

function parseBR(fullText, fileName) {
  const results = [];
  const fareType = detectFareType(fileName);

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

  let headerLineIdx = -1;
  let headerDates = [];
  let tableYear = issueDate ? issueDate.substring(0, 4) : String(new Date().getFullYear());

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const ymFull = l.match(/(\d{4})年/);
    if (ymFull) tableYear = ymFull[1];

    if (/出發班次/.test(l) && /\d+\/\d+/.test(l)) {
      let isCTS = false;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        if (/\b116\b/.test(lines[j]) || /\b166\b/.test(lines[j])) {
          isCTS = true; break;
        }
      }
      if (isCTS) {
        headerLineIdx = i;
        headerDates = parseBRDateHeader(l, tableYear);
        break;
      }
    }
  }

  if (headerLineIdx === -1 || headerDates.length === 0) return results;

  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/出發班次/.test(l) && /\d+\/\d+/.test(l)) break;

    const depMatch = l.match(/^\s*(\d{3})\s+([\d/]+)\s+/);
    if (!depMatch) continue;
    const depNum = depMatch[1];
    if (depNum !== '116' && depNum !== '166') continue;

    const retRaw = depMatch[2];
    const prices = extractNumPrices(l);
    if (prices.length === 0) continue;

    const retNum = retRaw.includes('165') ? '165' : retRaw.includes('115') ? '115' : retRaw;
    const dep = 'BR' + depNum;
    const ret = 'BR' + retNum;

    const count = Math.min(headerDates.length, prices.length);
    for (let k = 0; k < count; k++) {
      results.push({
        airline:'BR', fare_type: fareType, version,
        issue_date: issueDate, ticket_issue_start: issueDate, ticket_issue_end:'2099-12-31',
        destination:'CTS',
        dep_date_start: headerDates[k].start, dep_date_end: headerDates[k].end,
        price: String(prices[k]), agent_discount:'0',
        dep_flight: dep, ret_flight: ret,
        tour_code:'', currency:'TWD', is_active:'TRUE',
        source_file: fileName,
      });
    }
  }
  return results;
}

function parseBRDateHeader(text, year) {
  const cleaned = text
    .replace(/航線|出發班次|回程班次/g, '')
    .replace(/[一-鿿]+/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .trim();

  const ranges = [];
  const tokens = cleaned.split(/\s+/).filter(t => /\d+\/\d+/.test(t));

  for (const t of tokens) {
    const fullRange = t.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})$/);
    if (fullRange) {
      ranges.push({
        start: `${year}-${fullRange[1].padStart(2,'0')}-${fullRange[2].padStart(2,'0')}`,
        end:   `${year}-${fullRange[3].padStart(2,'0')}-${fullRange[4].padStart(2,'0')}`,
      });
      continue;
    }
    const shortRange = t.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})$/);
    if (shortRange) {
      ranges.push({
        start: `${year}-${shortRange[1].padStart(2,'0')}-${shortRange[2].padStart(2,'0')}`,
        end:   `${year}-${shortRange[1].padStart(2,'0')}-${shortRange[3].padStart(2,'0')}`,
      });
      continue;
    }
    const single = t.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (single) {
      const d = `${year}-${single[1].padStart(2,'0')}-${single[2].padStart(2,'0')}`;
      ranges.push({ start: d, end: d });
    }
  }
  return ranges;
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
