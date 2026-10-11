// sheet-apply.mjs — 讀試算表 → 檢查 → 產生 js/00y-my-tweaks-data.js
//
//   node scripts/sheet-apply.mjs                 從 sheet-config.json 的 Google 試算表下載
//   node scripts/sheet-apply.mjs <檔案.xlsx>      用本機的 xlsx(測試用)
//
// 只把「跟原始值不一樣」的寫進輸出檔;有任何一格填錯就整批不寫(exit 1),
// 錯誤用白話列出「哪個分頁、哪一列、哪一欄、該怎麼改」(GitHub Actions 上也寫進執行摘要)。
// 分頁整個不見 = 那一類維持原樣(不是清空),方便之後才補分頁。
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import {
  DATA_OUT, CONFIG, ID_HEAD, loadGame, getPath, RECORD_SHEETS, HOME_ROWS, HOME_DEFAULTS,
  zhToReq, dropHidden, mobNamer,
} from './sheet-lib.mjs';

const errors = [];
const err = (msg) => errors.push(msg);
const MAX_ERR = 50;

// ── 取得試算表 ───────────────────────────────────────────
const wb = new ExcelJS.Workbook();
const arg = process.argv[2];
if (arg) {
  await wb.xlsx.readFile(arg);
} else {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const s = String(cfg.googleSheet || '');
  const m = s.match(/\/d\/([\w-]{20,})/) || s.match(/^([\w-]{20,})$/);
  if (!m) fail('sheet-config.json 裡還沒填 Google 試算表的網址。');
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`, { redirect: 'follow' });
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
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if (v.richText) v = v.richText.map(t => t.text).join('');
    else if ('text' in v) v = v.text;
  }
  if (typeof v === 'string') v = v.trim();
  return v === '' || v === undefined ? null : v;
}
function columnsOf(ws, name, need) {
  const colOf = {};
  ws.getRow(1).eachCell((c, i) => { colOf[String(val(c) || '')] = i; });
  for (const h of need) if (!colOf[h]) err(`「${name}」分頁找不到「${h}」欄(第 1 列的欄名不要改)。`);
  return colOf;
}
function toNumber(raw) {
  return typeof raw === 'number' ? raw : Number(String(raw).replace(/[,%％]/g, ''));
}

const G = loadGame();
const out = { home: {}, items: {}, mobs: {}, skills: {}, maps: {}, drops: {} };

// ── 首頁 ────────────────────────────────────────────────
const home = wb.getWorksheet('首頁');
if (home) {
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

// ── 一般分頁 ─────────────────────────────────────────────
for (const def of RECORD_SHEETS) {
  const ws = wb.getWorksheet(def.sheet);
  if (!ws) continue;
  const edit = def.cols.filter(c => c.type !== 'show');
  const colOf = columnsOf(ws, def.sheet, [ID_HEAD, ...edit.map(c => c.zh)]);
  if (!colOf[ID_HEAD]) continue;
  const valid = new Map(def.rows(G).map(([rowKey, recId, prefix]) => [rowKey, [recId, prefix]]));
  const base = { items: G.DB.items, mobs: G.DB.mobs, skills: G.DB.skills }[def.store];

  ws.eachRow((row, i) => {
    if (i === 1) return;
    const rowKey = val(row.getCell(colOf[ID_HEAD]));
    if (rowKey == null) return;
    const hit = valid.get(String(rowKey));
    if (!hit) { err(`${def.sheet} 第 ${i} 列:ID「${rowKey}」對不到遊戲裡的東西,ID 欄不能改。`); return; }
    const [recId, prefix] = hit;
    const rec = base[recId];
    const where = `${def.sheet} 第 ${i} 列(${rec.n || recId})`;
    for (const c of edit) {
      if (!colOf[c.zh]) continue;
      const raw = val(row.getCell(colOf[c.zh]));
      if (raw == null) continue;                       // 空白 = 維持原值
      const p = prefix + c.key;
      const o = getPath(rec, p);
      if (o === undefined && p.includes('.')) {          // 陣列/子物件本來就不存在(例:這招沒有治療骰)→ 無處可放
        const parent = getPath(rec, p.slice(0, p.lastIndexOf('.')));
        if (parent == null) { err(`${where}「${c.zh}」:這一筆沒有這個項目,請把這格清空。`); continue; }
      }
      let v;
      if (c.type === 'int' || c.type === 'num' || c.type === 'pct') {
        v = toNumber(raw);
        if (!Number.isFinite(v)) { err(`${where}「${c.zh}」:要填數字,現在是「${raw}」。`); continue; }
        if (c.type === 'int' && !Number.isInteger(v)) { err(`${where}「${c.zh}」:要填整數,現在是「${raw}」。`); continue; }
        if (c.type === 'pct') {
          if (v < 0 || v > 100) { err(`${where}「${c.zh}」:要在 0 到 100 之間。`); continue; }
          v = Math.round(v * 1e4) / 1e6;
        }
        if ((c.key === 'spd' || c.key === 'atkSpd') && v <= 0) { err(`${where}「${c.zh}」:要大於 0。`); continue; }
      } else if (c.type === 'req') {
        try { v = zhToReq(raw); } catch (e) { err(`${where}「${c.zh}」:${e.message}`); continue; }
      } else {
        v = String(raw);
      }
      const same = c.type === 'req'
        ? String(o || '').split(',').sort().join() === v.split(',').sort().join()
        : c.type === 'pct' ? Math.abs((o ?? NaN) - v) < 1e-9
        : (o ?? null) === v;
      if (!same) (out[def.store][recId] ||= {})[p] = v;
    }
  });
}

// ── 地圖 ────────────────────────────────────────────────
const mapWs = wb.getWorksheet('地圖');
if (mapWs) {
  const colOf = columnsOf(mapWs, '地圖', [ID_HEAD, '出現怪物']);
  const { toId } = mobNamer(G);
  if (colOf[ID_HEAD] && colOf['出現怪物']) mapWs.eachRow((row, i) => {
    if (i === 1) return;
    const id = val(row.getCell(colOf[ID_HEAD]));
    if (id == null) return;
    const orig = G.DB.maps[id];
    if (!Array.isArray(orig)) { err(`地圖 第 ${i} 列:ID「${id}」不是遊戲裡的地圖,ID 欄不能改。`); return; }
    const text = val(row.getCell(colOf['出現怪物']));
    if (text == null) return;                          // 空白 = 維持原樣(地圖不能沒有怪)
    const names = String(text).split(/[、,，\n]+/).map(s => s.trim()).filter(Boolean);
    const ids = []; let bad = false;
    for (const nm of names) {
      const mid = toId(nm);
      if (!mid) { err(`地圖 第 ${i} 列(${G.MAP_NAMES[id] || id})「出現怪物」:找不到怪物「${nm}」。同名的怪要寫成「名稱(ID)」。`); bad = true; }
      else ids.push(mid);
    }
    if (!bad && ids.join() !== orig.join()) out.maps[id] = ids;
  });
}

// ── 掉落 ────────────────────────────────────────────────
const dropWs = wb.getWorksheet('掉落');
if (dropWs) {
  const H = ['怪物名稱', '物品ID', '機率(%)'];
  const colOf = columnsOf(dropWs, '掉落', H);
  const knownMobs = new Set([...Object.keys(G.MOB_DROPS), ...Object.values(G.DB.mobs).map(m => m.n)]);
  const sheet = {};
  if (H.every(h => colOf[h])) dropWs.eachRow((row, i) => {
    if (i === 1) return;
    const mob = val(row.getCell(colOf['怪物名稱']));
    const item = val(row.getCell(colOf['物品ID']));
    const raw = val(row.getCell(colOf['機率(%)']));
    if (mob == null && item == null && raw == null) return;
    const where = `掉落 第 ${i} 列`;
    if (mob == null || !knownMobs.has(String(mob))) { err(`${where}:找不到怪物「${mob ?? ''}」(名稱要跟怪物分頁一模一樣)。`); return; }
    if (item == null || !G.DB.items[item]) { err(`${where}(${mob}):找不到物品 ID「${item ?? ''}」,可以到武器/防具/飾品/道具分頁查 ID。`); return; }
    const p = toNumber(raw);
    if (raw == null || !Number.isFinite(p) || p < 0 || p > 100) { err(`${where}(${mob}):機率要填 0 到 100 的數字,現在是「${raw ?? ''}」。`); return; }
    (sheet[mob] ||= []).push([String(item), p]);
  });
  // 跟原始比:只比「試算表看得到的部分」;遺物等隱藏的掉落原樣接回去
  const allMobs = new Set([...Object.keys(G.MOB_DROPS), ...Object.keys(sheet)]);
  const key = (list) => list.map(([a, b]) => a + '@' + b).sort().join('|');
  for (const mob of allMobs) {
    const orig = G.MOB_DROPS[mob] || [];
    const visible = orig.filter(([id]) => !dropHidden(G, id));
    const now = sheet[mob] || [];
    if (key(visible) !== key(now)) out.drops[mob] = [...now, ...orig.filter(([id]) => dropHidden(G, id))];
  }
}

if (errors.length) {
  const shown = errors.slice(0, MAX_ERR);
  fail(`試算表有 ${errors.length} 個地方要修正,這次沒有更新遊戲:\n\n` + shown.map(e => '• ' + e).join('\n')
    + (errors.length > MAX_ERR ? `\n…還有 ${errors.length - MAX_ERR} 個,先修上面這些再試一次。` : ''));
}

// ── 寫檔 ────────────────────────────────────────────────
for (const k of Object.keys(out)) if (!Object.keys(out[k]).length) delete out[k];
const body = '// 由 scripts/sheet-apply.mjs 從試算表自動產生。不要手改這個檔案:改試算表後到 GitHub 按「更新遊戲」。\n'
  + 'window.MY_TWEAKS = ' + JSON.stringify(out, null, 1) + ';\n';
const changed = !fs.existsSync(DATA_OUT) || fs.readFileSync(DATA_OUT, 'utf8').replace(/\r\n/g, '\n') !== body;
if (changed) fs.writeFileSync(DATA_OUT, body);
const cnt = (k) => Object.keys(out[k] || {}).length;
const msg = changed
  ? `✅ 已套用:首頁 ${cnt('home')} 項、物品 ${cnt('items')}、怪物 ${cnt('mobs')}、魔法 ${cnt('skills')}、地圖 ${cnt('maps')}、掉落 ${cnt('drops')} 隻怪有修改。`
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
