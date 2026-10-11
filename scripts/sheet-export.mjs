// sheet-export.mjs — 把遊戲目前的數值匯出成 Excel(第一次建立試算表、或之後加新分頁時用)
//
//   node scripts/sheet-export.mjs [輸出路徑]      預設輸出到 repo 外層的 ../遊戲數值表.xlsx
//
// 匯出的是「原始值＋目前已套用的修改」(有 js/00y-my-tweaks-data.js 就疊上去),
// 所以拿它重建試算表不會把已經改過的數字洗回原樣。
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  ROOT, DATA_OUT, ID_HEAD, loadGame, getPath, setPath, RECORD_SHEETS, HOME_ROWS, HOME_DEFAULTS,
  reqToZh, dropHidden, mobNamer,
} from './sheet-lib.mjs';

const out = path.resolve(process.argv[2] || path.join(ROOT, '..', '遊戲數值表.xlsx'));
const G = loadGame();

// 疊上目前已套用的修改
let T = {};
if (fs.existsSync(DATA_OUT)) {
  const ctx = {};
  new Function('window', fs.readFileSync(DATA_OUT, 'utf8'))(ctx);
  T = ctx.MY_TWEAKS || {};
}
for (const store of ['items', 'mobs', 'skills']) {
  const base = { items: G.DB.items, mobs: G.DB.mobs, skills: G.DB.skills }[store];
  for (const [id, kv] of Object.entries(T[store] || {})) for (const [p, v] of Object.entries(kv)) if (base[id]) setPath(base[id], p, v);
}
for (const [id, list] of Object.entries(T.maps || {})) G.DB.maps[id] = list;
for (const [mob, list] of Object.entries(T.drops || {})) G.MOB_DROPS[mob] = list;

const wb = new ExcelJS.Workbook();
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F3F46' } };
const LOCK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
const white = { color: { argb: 'FFFFFFFF' }, bold: true };
function header(ws, cols, frozenCols) {
  ws.columns = cols.map(c => ({ header: c.zh, width: c.width || 11 }));
  ws.getRow(1).eachCell((cell, i) => {
    cell.fill = HEAD; cell.font = white; cell.alignment = { wrapText: true, vertical: 'middle' };
    if (cols[i - 1].note) cell.note = cols[i - 1].note;
  });
  ws.views = [{ state: 'frozen', xSplit: frozenCols, ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}

// ── 使用說明 ─────────────────────────────────────────────
const help = wb.addWorksheet('使用說明');
help.columns = [{ width: 100 }];
[
  '怎麼改:',
  '1. 到下方分頁直接改數字或文字。',
  '2. 灰底的欄位不要改(ID 是遊戲用來認東西的;其他灰底欄只是給你參考,改了也不會套用)。',
  '3. 格子留空白 = 維持原本的數值。想設成 0 就填 0。',
  '4. 改完到 GitHub → Actions → 「更新遊戲」→ Run workflow,約 5 分鐘後上線。',
  '5. 填錯(例如數字欄填了文字)不會上線,GitHub 上會顯示是哪一格要改。',
  '',
  '可用職業:用「、」分隔,例如:騎士、妖精。全部職業可用就填:全職業',
  '地圖:「出現怪物」欄填怪物名稱,用「、」分隔。同名的怪會寫成「名稱(ID)」,照抄即可。',
  '掉落:一列 = 一隻怪掉一樣東西。要新增掉落就加一列(填怪物名稱、物品ID、機率);整列刪掉 = 不再掉。',
  '      機率是百分比:填 1 代表 1%,填 0.01 代表 0.01%。物品 ID 可以到武器/防具/飾品/道具分頁查。',
].forEach(t => help.addRow([t]));
help.getRow(1).font = { bold: true };

// ── 首頁 ────────────────────────────────────────────────
const home = wb.addWorksheet('首頁');
home.columns = [{ header: '項目', width: 12 }, { header: '內容', width: 60 }, { header: '說明', width: 60 }];
home.getRow(1).eachCell(c => { c.fill = HEAD; c.font = white; });
for (const r of HOME_ROWS) {
  const v = T.home?.[r.key] ?? HOME_DEFAULTS[r.key] ?? '';
  const row = home.addRow([r.zh, Array.isArray(v) ? v.join(' | ') : v, r.note]);
  row.getCell(1).fill = LOCK;
  row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  row.getCell(3).font = { color: { argb: 'FF6B7280' } };
}

// ── 一般分頁 ─────────────────────────────────────────────
for (const def of RECORD_SHEETS) {
  const ws = wb.addWorksheet(def.sheet);
  const cols = [{ zh: ID_HEAD, width: 22 }, ...def.cols];
  header(ws, cols, 2);
  const base = { items: G.DB.items, mobs: G.DB.mobs, skills: G.DB.skills }[def.store];
  for (const [rowKey, recId, prefix] of def.rows(G)) {
    const rec = base[recId];
    const sub = prefix ? getPath(rec, prefix.slice(0, -1)) : rec;
    const row = ws.addRow([rowKey, ...def.cols.map(c => {
      if (c.type === 'show') return c.show(rec, sub) ?? '';
      const v = getPath(rec, prefix + c.key);
      if (v == null) return '';
      if (c.type === 'req') return reqToZh(v);
      if (c.type === 'pct') return Math.round(v * 1e6) / 1e4;
      return typeof v === 'object' ? '' : v;
    })]);
    row.getCell(1).fill = LOCK;
    def.cols.forEach((c, i) => { if (c.type === 'show') row.getCell(i + 2).fill = LOCK; });
  }
}

// ── 地圖 ────────────────────────────────────────────────
{
  const ws = wb.addWorksheet('地圖');
  const cols = [{ zh: ID_HEAD, width: 20 }, { zh: '地圖名稱', width: 18 }, { zh: '出現怪物', width: 100, note: '用「、」分隔' }];
  header(ws, cols, 2);
  const { toText } = mobNamer(G);
  for (const [id, list] of Object.entries(G.DB.maps)) {
    if (!Array.isArray(list)) continue;
    const row = ws.addRow([id, G.MAP_NAMES[id] || '', list.map(toText).join('、')]);
    row.getCell(1).fill = LOCK; row.getCell(2).fill = LOCK;
    row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
  }
}

// ── 掉落 ────────────────────────────────────────────────
{
  const ws = wb.addWorksheet('掉落');
  const cols = [{ zh: '怪物名稱', width: 22 }, { zh: '物品ID', width: 24 }, { zh: '物品名稱', width: 20 }, { zh: '機率(%)', width: 10, note: '填 1 = 1%' }];
  header(ws, cols, 1);
  for (const [mob, list] of Object.entries(G.MOB_DROPS)) {
    for (const [itemId, p] of list) {
      if (dropHidden(G, itemId)) continue;
      const row = ws.addRow([mob, itemId, G.DB.items[itemId]?.n || '', p]);
      row.getCell(3).fill = LOCK;
    }
  }
}

await wb.xlsx.writeFile(out);
console.log('已輸出:' + out);
