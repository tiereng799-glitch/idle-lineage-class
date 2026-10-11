/* ============================================================================
 * afk-noclassitems.js — 戰士／幻術士／龍騎士的專屬道具不開放取得
 *
 * 「專屬」的判定（只認上游自己的欄位，不寫死物品清單 —— 上游新增同類道具會自動跟上）：
 *   ・裝備（武器/防具/遺物…）：req 欄位列出的職業「全部」都落在這三職內（例 req:'dragon'、'warrior'）。
 *     跟其他職業共用的（例 'royal,knight,dragon'）不算，照常取得。
 *   ・技能書（type:'skillbk'）：書裡那支技能只有這三職的需求欄（reqW / reqI / reqDk），沒有其他職業的。
 *
 * 取得管道一次在載入時切掉（陣列/物件就地修改，上游拿的是同一份參照）：
 *   怪物掉落表（MOB_DROPS 等 6 張）、潘朵拉抽獎/黑市/世界頻道收購（gachaWeight 歸 0）、
 *   NPC 商店清單（SHOP_LISTS）、製作配方（成品是這些道具的那幾條）、遺物掉落池（_relicDropPool）、
 *   收藏冊的「有取得管道」名單（OBTAINABLE_MISC）。
 *   最後在 gainItem 入口兜底擋下（任務獎勵等其他零散來源）。
 * 玩家「已經擁有」的不刪、不動 —— 只是之後拿不到新的。
 * 開關關掉＝重新整理後一切照原版（本檔只在載入時動手）。
 *
 * 掛接：在 index.html 的 </body> 前 <script src="afk-noclassitems.js">（核心之後）。
 * ========================================================================== */
(function () {
  'use strict';

  if (window.AFK_TOGGLES) {
    AFK_TOGGLES.register({
      id: 'noclassitems', name: '不開放戰士、幻術士、龍騎士道具', group: '遊戲玩法', def: true,
      desc: '這三個職業的專屬裝備與技能書不再掉落、販售或製作（已擁有的不受影響）'
    });
  }
  function on() { return !window.AFK_TOGGLES || AFK_TOGGLES.enabled('noclassitems'); }
  if (!on()) return;
  if (typeof DB === 'undefined' || !DB.items) { console.warn('[AFK-noclassitems] 找不到 DB.items，停用。'); return; }

  var CLS = { warrior: 1, illusion: 1, dragon: 1 };
  var OTHER_SKILL_REQ = ['reqM', 'reqK', 'reqE', 'reqD', 'reqRoy'];
  function exclusiveReq(req) {
    var c = String(req).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return c.length > 0 && c.every(function (x) { return CLS[x]; });
  }
  function exclusiveSkill(sk) {
    if (!sk) return false;
    var mine = sk.reqW !== undefined || sk.reqI !== undefined || sk.reqDk !== undefined;
    return mine && !OTHER_SKILL_REQ.some(function (k) { return sk[k] !== undefined; });
  }

  var blocked = {}, n = 0;
  Object.keys(DB.items).forEach(function (id) {
    var d = DB.items[id]; if (!d) return;
    var hit = (d.req !== undefined && exclusiveReq(d.req)) ||
      (d.type === 'skillbk' && d.sk && DB.skills && exclusiveSkill(DB.skills[d.sk]));
    if (hit) { blocked[id] = true; n++; }
  });
  window.AFK_NOCLASS_ITEMS = blocked;   // 給其他外掛查（例如收藏/查詢想一起藏）

  // ── 1. 怪物掉落表 ──
  function stripTable(tbl) {
    if (!tbl || typeof tbl !== 'object') return 0;
    var cut = 0;
    Object.keys(tbl).forEach(function (mob) {
      var arr = tbl[mob]; if (!Array.isArray(arr)) return;
      for (var i = arr.length - 1; i >= 0; i--) { var id = Array.isArray(arr[i]) ? arr[i][0] : arr[i]; if (blocked[id]) { arr.splice(i, 1); cut++; } }
    });
    return cut;
  }
  var cutDrops = 0;
  [typeof MOB_DROPS !== 'undefined' ? MOB_DROPS : null,
   typeof DARK_WEAPON_DROPS !== 'undefined' ? DARK_WEAPON_DROPS : null,
   typeof DARK_CRYSTAL_DROPS !== 'undefined' ? DARK_CRYSTAL_DROPS : null,
   typeof DRAGON_DROPS !== 'undefined' ? DRAGON_DROPS : null,
   typeof WARRIOR_DROPS !== 'undefined' ? WARRIOR_DROPS : null,
   typeof MEM_DROPS !== 'undefined' ? MEM_DROPS : null].forEach(function (t) { cutDrops += stripTable(t); });

  // ── 2. 潘朵拉抽獎／黑市／世界頻道收購：都靠 gachaWeight>0 挑道具 ──
  Object.keys(blocked).forEach(function (id) { if (DB.items[id].gachaWeight) DB.items[id].gachaWeight = 0; });

  // ── 3. NPC 商店 ──
  var cutShop = 0;
  try {
    if (typeof SHOP_LISTS === 'object' && SHOP_LISTS) Object.keys(SHOP_LISTS).forEach(function (npc) {
      var lst = SHOP_LISTS[npc]; if (!Array.isArray(lst)) return;
      for (var i = lst.length - 1; i >= 0; i--) if (blocked[lst[i]]) { lst.splice(i, 1); cutShop++; }
    });
  } catch (e) {}

  // ── 4. 製作配方（成品是被封鎖的道具）──
  var cutCraft = 0;
  function stripRecipes(arr) {
    if (!Array.isArray(arr)) return;
    for (var i = arr.length - 1; i >= 0; i--) if (arr[i] && blocked[arr[i].result]) { arr.splice(i, 1); cutCraft++; }
  }
  try {
    if (typeof CRAFT_RECIPES === 'object' && CRAFT_RECIPES) Object.keys(CRAFT_RECIPES).forEach(function (k) { stripRecipes(CRAFT_RECIPES[k]); });
    if (typeof DEMONKING_RECIPES !== 'undefined') stripRecipes(DEMONKING_RECIPES);
    if (typeof LUMIEL_RECIPES !== 'undefined') stripRecipes(LUMIEL_RECIPES);
    if (typeof MYSTICWAND_RECIPES !== 'undefined') stripRecipes(MYSTICWAND_RECIPES);
    if (typeof SLAYER_RECIPES !== 'undefined') stripRecipes(SLAYER_RECIPES);
  } catch (e) {}

  // ── 5. 遺物掉落池：上游是懶建立的快取（null 才建），先把過濾好的填進去 ──
  try {
    if (typeof isRelic === 'function') _relicDropPool = Object.keys(DB.items).filter(function (id) { return isRelic(DB.items[id]) && !blocked[id]; });
  } catch (e) { console.warn('[AFK-noclassitems] 遺物池無法過濾', e); }

  // ── 6. 收藏冊「有取得管道」名單 ──
  try { if (typeof OBTAINABLE_MISC === 'object' && OBTAINABLE_MISC) Object.keys(blocked).forEach(function (id) { delete OBTAINABLE_MISC[id]; }); } catch (e) {}

  // ── 7. 兜底：任何來源要給這些道具都不給 ──
  if (typeof window.gainItem === 'function') {
    var _origGain = window.gainItem;
    window.gainItem = function (id) {
      if (blocked[id] && on()) { console.info('[AFK-noclassitems] 擋下取得：' + ((DB.items[id] && DB.items[id].n) || id)); return null; }
      return _origGain.apply(this, arguments);
    };
  }

  console.log('[AFK-noclassitems] hooks OK — 封鎖 ' + n + ' 件專屬道具（掉落 ' + cutDrops + '、商店 ' + cutShop + '、製作 ' + cutCraft + '）。');
})();
