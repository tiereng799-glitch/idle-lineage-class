// sheet-lib.mjs — 試算表 ↔ 遊戲數值 共用定義(sheet-export / sheet-apply 都靠這份)
//
// 試算表的分頁、欄位、中文名稱都定義在這裡。要加新分頁/新欄位只改這份,兩支腳本自動跟上。
// 原始數值一律從 js/00-data.js 讀(那份不手改),試算表只記「改成多少」,
// 產出的 js/00y-my-tweaks-data.js 只放「跟原始不一樣」的部分。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_OUT = path.join(ROOT, 'js', '00y-my-tweaks-data.js');
export const CONFIG = path.join(ROOT, 'sheet-config.json');

// 在 Node 裡跑一次 js/00-data.js 拿到原始 DB(瀏覽器全域用最小替身頂著)
export function loadDB() {
  const src = fs.readFileSync(path.join(ROOT, 'js', '00-data.js'), 'utf8') + '\n;globalThis.__DB = DB;';
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    document: { readyState: 'complete', addEventListener: noop, createElement: () => ({ style: {} }),
      body: { appendChild: noop }, getElementById: () => null, querySelector: () => null },
    location: { hostname: '', href: '' }, localStorage: { getItem: () => null, setItem: noop },
    navigator: { userAgent: '' }, setTimeout: noop, setInterval: noop,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.__DB;
}

// 職業代碼 ↔ 中文(可用職業欄用中文、頓號分隔)
export const CLASS_ZH = {
  all: '全職業', royal: '王族', knight: '騎士', elf: '妖精', mage: '法師', dark: '黑暗妖精',
  illusion: '幻術士', dragon: '龍騎士', warrior: '戰士',
};
const ZH_CLASS = Object.fromEntries(Object.entries(CLASS_ZH).map(([k, v]) => [v, k]));
export const reqToZh = (req) => String(req || '').split(',').filter(Boolean).map(c => CLASS_ZH[c.trim()] || c.trim()).join('、');
export function zhToReq(text) {
  const parts = String(text).split(/[、,，\s]+/).filter(Boolean);
  const bad = parts.filter(p => !ZH_CLASS[p] && !CLASS_ZH[p]);
  if (bad.length) throw new Error(`看不懂的職業「${bad.join('、')}」,只能填:${Object.values(CLASS_ZH).join('、')}`);
  return parts.map(p => ZH_CLASS[p] || p).join(',');
}

// 欄位型別:int=整數、num=可有小數、text=文字、req=可用職業
// readonly=只給人看,改了也不會套用(灰底)
export const ITEM_SHEETS = [
  {
    sheet: '武器', filter: d => d.type === 'wpn' && !d.isArrow,
    cols: [
      { key: 'n', zh: '名稱', type: 'text', width: 16 },
      { key: 'dmgS', zh: '對小怪傷害', type: 'int' },
      { key: 'dmgL', zh: '對大怪傷害', type: 'int' },
      { key: 'hit', zh: '命中', type: 'int' },
      { key: 'dmgBonus', zh: '額外傷害', type: 'int' },
      { key: 'spd', zh: '攻擊間隔(秒)', type: 'num', note: '每幾秒攻擊一次,數字越小越快' },
      { key: 'safe', zh: '安定值', type: 'int', note: '強化到這個數字以內不會爆' },
      { key: 'p', zh: '價格', type: 'int' },
      { key: 'str', zh: '力量', type: 'int' },
      { key: 'dex', zh: '敏捷', type: 'int' },
      { key: 'con', zh: '體質', type: 'int' },
      { key: 'int', zh: '智力', type: 'int' },
      { key: 'wis', zh: '精神', type: 'int' },
      { key: 'req', zh: '可用職業', type: 'req', width: 22 },
      { key: 'w2h', zh: '雙手武器', type: 'flag', readonly: true },
      { key: 'd', zh: '說明', type: 'text', width: 40 },
    ],
  },
];

// 首頁:一列一個項目(A 欄項目名、B 欄內容)
export const HOME_ROWS = [
  { key: 'title', zh: '遊戲標題', note: '首頁最上面的大字,也是瀏覽器分頁上的名字' },
  { key: 'subtitle', zh: '副標題', note: '標題下面那行小字' },
  { key: 'notice', zh: '公告', note: '顯示在「開始遊戲」按鈕下方;空白就不顯示。要換行請按 Alt+Enter' },
  { key: 'link1', zh: '連結1', note: '格式:顯示文字 | 網址(例:我們的LINE群 | https://line.me/...)' },
  { key: 'link2', zh: '連結2', note: '同上,空白就不顯示' },
  { key: 'link3', zh: '連結3', note: '同上,空白就不顯示' },
];
export const HOME_DEFAULTS = { title: '放置天堂 - 日出之國', subtitle: '創造您的角色並開始冒險' };
