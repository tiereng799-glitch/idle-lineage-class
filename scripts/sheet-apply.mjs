// sheet-apply.mjs — 讀試算表 → 檢查 → 產生 js/00y-my-tweaks-data.js
//
//   node scripts/sheet-apply.mjs                 從 sheet-config.json 的 Google 試算表下載
//   node scripts/sheet-apply.mjs <檔案.xlsx>      用本機的 xlsx(測試用)
//
// 只把「跟 js/00-data.js 原始值不一樣」的寫進輸出檔;有任何一格填錯就整批不寫(exit 1),
// 錯誤用白話列出「哪個分頁、哪一列、哪一欄、該怎麼改」(GitHub Actions 上也寫進執行摘要)。
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { DATA_OUT, CONFIG, loadDB, ITEM_SHEETS, HOME_ROWS, HOME_DEFAULTS, zhToReq } from './sheet-lib.mjs';

const errors = [];
const err = (msg) => errors.push(msg);

// ── 取得試算表 ───────────────────────────────────────────
const wb = new ExcelJS.Workbook();
const arg = process.argv[2];
if (arg) {
  await wb.xlsx.readFile(arg);
} else {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const m = String(cfg.googleSheet || '').match(/\/d\/([\w-]{20,})/) || String(cfg.googleSheet || '').match(/^([\w-]{20,})$/);
  if (!m) fail('sheet-config.json 裡還沒填 Google 試算表的網址。');
  const url = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
  const res = await fetch(url, { redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  // 沒開「知道連結的人可以檢視」時 Google 會回登入頁(HTML),不是 xlsx(zip 開頭 PK)
  if (!res.ok || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    fail('讀不到 Google 試算表:請到試算表右上角「共用」,把一般存取權改成「知道連結的任何人」可以「檢視」。');
  }
  await wb.xlsx.load(buf);
}

// 儲存格 → 純值(公式取結果、RichText 接起來、超連結取文字)
function val(cell) {
  let v = cell.value;
  if (v && typeof v === 'object') {
    if ('result' in v) v = v.result;
    else if (v.richText) v = v.richText.map(t => t.text).join('');
    else if ('text' in v) v = v.text;
  }
  if (typeof v === 'string') v = v.trim();
  return v === '' ? null : v;
}

const DB = loadDB();
const out = { home: {}, items: {} };

// ── 首頁 ────────────────────────────────────────────────
const home = wb.getWorksheet('首頁');
if (!home) err('找不到「首頁」分頁(分頁名稱不要改)。');
else {
  const byZh = {};
  home.eachRow((row, i) => { if (i > 1) byZh[val(row.getCell(1))] = { v: val(row.getCell(2)), i }; });
  for (const r of HOME_ROWS) {
    const cell = byZh[r.zh];
    if (!cell || cell.v == null) continue;
    const v = String(cell.v);
    if (/^link\d$/.test(r.key)) {
      const [text, url] = v.split('|').map(s => s && s.trim());
      if (!text || !/^https?:\/\/\S+$/.test(url || '')) { err(`首頁 第 ${cell.i} 列「${r.zh}」:格式要是「顯示文字 | 網址」,網址要以 https:// 開頭。`); continue; }
      out.home[r.key] = [text, url];
    } else if (v !== HOME_DEFAULTS[r.key]) {
      out.home[r.key] = v;
    }
  }
}

// ── 物品類分頁 ───────────────────────────────────────────
for (const def of ITEM_SHEETS) {
  const ws = wb.getWorksheet(def.sheet);
  if (!ws) { err(`找不到「${def.sheet}」分頁(分頁名稱不要改)。`); continue; }
  // 依表頭文字找欄位,欄位順序被拖動也沒關係
  const colOf = {};
  ws.getRow(1).eachCell((c, i) => { colOf[String(val(c) || '')] = i; });
  const idCol = colOf['ID(不要改)'];
  if (!idCol) { err(`「${def.sheet}」分頁第 1 列的「ID(不要改)」欄不見了。`); continue; }
  for (const c of def.cols) if (!c.readonly && !colOf[c.zh]) err(`「${def.sheet}」分頁找不到「${c.zh}」欄(第 1 列的欄名不要改)。`);

  ws.eachRow((row, i) => {
    if (i === 1) return;
    const id = val(row.getCell(idCol));
    if (id == null) return;
    const orig = DB.items[id];
    if (!orig || !def.filter(orig)) { err(`${def.sheet} 第 ${i} 列:ID「${id}」不是遊戲裡的${def.sheet},ID 欄不能改。`); return; }
    const where = `${def.sheet} 第 ${i} 列(${orig.n})`;
    for (const c of def.cols) {
      if (c.readonly || !colOf[c.zh]) continue;
      const raw = val(row.getCell(colOf[c.zh]));
      if (raw == null) continue;                       // 空白 = 維持原值
      let v;
      if (c.type === 'int' || c.type === 'num') {
        v = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
        if (!Number.isFinite(v)) { err(`${where}「${c.zh}」:要填數字,現在是「${raw}」。`); continue; }
        if (c.type === 'int' && !Number.isInteger(v)) { err(`${where}「${c.zh}」:要填整數,現在是「${raw}」。`); continue; }
        if (c.key === 'spd' && v <= 0) { err(`${where}「${c.zh}」:要大於 0。`); continue; }
      } else if (c.type === 'req') {
        try { v = zhToReq(raw); } catch (e) { err(`${where}「${c.zh}」:${e.message}`); continue; }
      } else {
        v = String(raw);
      }
      const o = orig[c.key];
      const same = c.type === 'req'
        ? String(o || '').split(',').sort().join() === v.split(',').sort().join()
        : (o ?? null) === v;
      if (!same) (out.items[id] ||= {})[c.key] = v;
    }
  });
}

if (errors.length) fail(`試算表有 ${errors.length} 個地方要修正,這次沒有更新遊戲:\n\n` + errors.map(e => '• ' + e).join('\n'));

// ── 寫檔 ────────────────────────────────────────────────
const body = '// 由 scripts/sheet-apply.mjs 從試算表自動產生。不要手改這個檔案:改試算表後到 GitHub 按「更新遊戲」。\n'
  + 'window.MY_TWEAKS = ' + JSON.stringify(out, null, 1) + ';\n';
const changed = !fs.existsSync(DATA_OUT) || fs.readFileSync(DATA_OUT, 'utf8').replace(/\r\n/g, '\n') !== body;
if (changed) fs.writeFileSync(DATA_OUT, body);
const n = Object.keys(out.items).length;
const msg = changed
  ? `✅ 已套用:首頁 ${Object.keys(out.home).length} 項、物品 ${n} 件有修改。`
  : '試算表跟目前遊戲一樣,沒有需要更新的。';
console.log(msg);
summary(msg);

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
}
function fail(text) {
  console.error(text);
  summary('## ❌ 沒有更新\n\n' + text.replace(/\n/g, '\n\n'));
  process.exit(1);
}
