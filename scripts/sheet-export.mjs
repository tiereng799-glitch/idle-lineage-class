// sheet-export.mjs — 把遊戲目前的數值匯出成 Excel(第一次建立試算表、或之後加新分頁時用)
//
//   node scripts/sheet-export.mjs [輸出路徑]      預設輸出到 repo 外層的 ../遊戲數值表.xlsx
//
// 匯出的是「原始值＋目前已套用的修改」(有 js/00y-my-tweaks-data.js 就疊上去),
// 所以拿它重建試算表不會把已經改過的數字洗回原樣。
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ROOT, DATA_OUT, loadDB, ITEM_SHEETS, HOME_ROWS, HOME_DEFAULTS, reqToZh } from './sheet-lib.mjs';

const out = path.resolve(process.argv[2] || path.join(ROOT, '..', '遊戲數值表.xlsx'));
const DB = loadDB();

// 疊上目前已套用的修改
let current = { home: {}, items: {} };
if (fs.existsSync(DATA_OUT)) {
  const ctx = {};
  new Function('window', fs.readFileSync(DATA_OUT, 'utf8'))(ctx);
  current = Object.assign(current, ctx.MY_TWEAKS || {});
}

const wb = new ExcelJS.Workbook();
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F3F46' } };
const LOCK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
const white = { color: { argb: 'FFFFFFFF' }, bold: true };

// ── 使用說明 ─────────────────────────────────────────────
const help = wb.addWorksheet('使用說明');
help.columns = [{ width: 100 }];
[
  '怎麼改:',
  '1. 到下方分頁(首頁、武器…)直接改數字或文字。',
  '2. 灰底的欄位不要改(ID 是遊戲用來認東西的,改了會對不上)。',
  '3. 格子留空白 = 維持原本的數值。想設成 0 就填 0。',
  '4. 改完到 GitHub → Actions → 「更新遊戲」→ Run workflow,約 5 分鐘後上線。',
  '5. 填錯(例如數字欄填了文字)不會上線,GitHub 上會顯示是哪一格要改。',
  '',
  '可用職業的寫法:用「、」分隔,例如:騎士、妖精。全部職業可用就填:全職業',
].forEach(t => help.addRow([t]));
help.getRow(1).font = { bold: true };

// ── 首頁 ────────────────────────────────────────────────
const home = wb.addWorksheet('首頁');
home.columns = [{ header: '項目', width: 12 }, { header: '內容', width: 60 }, { header: '說明', width: 60 }];
home.getRow(1).eachCell(c => { c.fill = HEAD; c.font = white; });
for (const r of HOME_ROWS) {
  const v = current.home?.[r.key] ?? HOME_DEFAULTS[r.key] ?? '';
  const row = home.addRow([r.zh, Array.isArray(v) ? v.join(' | ') : v, r.note]);
  row.getCell(1).fill = LOCK;
  row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  row.getCell(3).font = { color: { argb: 'FF6B7280' } };
}

// ── 物品類分頁 ───────────────────────────────────────────
for (const def of ITEM_SHEETS) {
  const ws = wb.addWorksheet(def.sheet);
  ws.columns = [{ header: 'ID(不要改)', width: 22 }, ...def.cols.map(c => ({ header: c.zh, width: c.width || 11 }))];
  ws.getRow(1).eachCell((c, i) => {
    c.fill = HEAD; c.font = white; c.alignment = { wrapText: true, vertical: 'middle' };
    const col = def.cols[i - 2];
    if (col?.note) c.note = col.note;
  });
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: def.cols.length + 1 } };
  for (const [id, d0] of Object.entries(DB.items)) {
    if (!def.filter(d0)) continue;
    const d = { ...d0, ...(current.items?.[id] || {}) };
    const row = ws.addRow([id, ...def.cols.map(c => {
      const v = d[c.key];
      if (c.type === 'req') return reqToZh(v);
      if (c.type === 'flag') return v ? '是' : '';
      return v ?? '';
    })]);
    row.getCell(1).fill = LOCK;
    def.cols.forEach((c, i) => { if (c.readonly) row.getCell(i + 2).fill = LOCK; });
  }
}

await wb.xlsx.writeFile(out);
console.log('已輸出:' + out);
