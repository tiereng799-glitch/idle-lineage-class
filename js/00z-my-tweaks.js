// 00z-my-tweaks.js — 套用試算表的修改(資料在 js/00y-my-tweaks-data.js,由 scripts/sheet-apply.mjs 產生)
//
// 載入順序:緊接 js/00-data.js 與 00y 之後、其他核心檔之前——物品數值在這裡直接改進 DB,
// 後面所有系統(戰鬥、商店、查詢…)讀到的就是改過的值,不用各自處理。
// 資料壞掉或缺檔時安靜跳過,遊戲照原始數值跑。
(function () {
  'use strict';
  var T = window.MY_TWEAKS;
  if (!T || typeof DB === 'undefined') return;

  // ── 物品 / 怪物 / 魔法:{ 紀錄ID: { '路徑': 值 } },路徑可含點('dmg.0'、'mag2.cd') ──
  function setPath(obj, p, v) {
    var ks = p.split('.'), o = obj;
    for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) return false; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = v; return true;
  }
  // ── 新增的物品(整筆,照範本做好的)與新增的怪物魔法 ─────────
  try {
    var ni = T.newItems || {};
    for (var nid in ni) if (!DB.items[nid]) DB.items[nid] = ni[nid];
    var nm = T.newMagic || {};
    for (var mid0 in nm) if (DB.mobs[mid0]) for (var slot in nm[mid0]) if (!DB.mobs[mid0][slot]) DB.mobs[mid0][slot] = nm[mid0][slot];
  } catch (e) { console.warn('[my-tweaks] 新增項目套用失敗', e); }

  [['items', DB.items], ['mobs', DB.mobs], ['skills', DB.skills]].forEach(function (pair) {
    try {
      var src = T[pair[0]] || {}, base = pair[1];
      for (var id in src) {
        if (!base[id]) { console.warn('[my-tweaks] 找不到', pair[0], id); continue; }
        for (var p in src[id]) if (!setPath(base[id], p, src[id][p])) console.warn('[my-tweaks] 套不上', pair[0], id, p);
      }
    } catch (e) { console.warn('[my-tweaks] 套用失敗', pair[0], e); }
  });

  // 試算表改過金幣的怪：標記 _goldCustom → js/05 monsterGoldRange 改用 goldMin/goldMax(否則一般怪金幣是依等級算的，那兩欄沒作用)
  try { var _tm = T.mobs || {}; for (var _mid in _tm) if (DB.mobs[_mid] && (('goldMin' in _tm[_mid]) || ('goldMax' in _tm[_mid]))) DB.mobs[_mid]._goldCustom = true; } catch (e) {}

  // ── 倍率(試算表「倍率」分頁)：exp 角色/傭兵經驗、petExp 寵物經驗、drop 掉寶、gold 金幣；沒設＝1 ──
  var _rates = T.rates || {};
  window.myRate = function (k) { var v = Number(_rates[k]); return (isFinite(v) && v >= 0) ? v : 1; };

  // ── 地圖出怪:整張替換 ─────────────────────────────────
  try {
    var maps = T.maps || {};
    for (var mid in maps) if (Array.isArray(DB.maps[mid])) DB.maps[mid] = maps[mid].filter(function (m) { return DB.mobs[m]; });
  } catch (e) { console.warn('[my-tweaks] 地圖套用失敗', e); }
  // 掉落表(MOB_DROPS)在 js/01 才建立 → 由 js/01z-my-tweaks-drops.js 套用

  // ── 首頁 ──────────────────────────────────────────────
  var H = T.home || {};
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function applyHome() {
    try {
      var layer = document.getElementById('login-title-layer');
      if (H.title) {
        document.title = H.title;
        var h1 = layer && layer.querySelector('h1');
        if (h1) h1.textContent = H.title;
      }
      if (H.subtitle) {
        var p = layer && layer.querySelector('p');
        if (p) p.textContent = H.subtitle;
      }
      var menu = document.getElementById('main-menu');
      if (H.notice && menu && !document.getElementById('my-home-notice')) {
        var n = document.createElement('div');
        n.id = 'my-home-notice';
        n.className = 'my-home-notice';
        n.innerHTML = esc(H.notice).replace(/\n/g, '<br>');
        menu.appendChild(n);
      }
      var links = ['link1', 'link2', 'link3'].map(function (k) { return H[k]; }).filter(Boolean);
      var meta = document.getElementById('login-meta-layer');
      if (links.length && meta && !document.getElementById('my-home-links')) {
        var box = document.createElement('div');
        box.id = 'my-home-links';
        box.className = 'my-home-links';
        box.innerHTML = links.map(function (l) {
          return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + '</a>';
        }).join('');
        meta.insertBefore(box, meta.firstChild);
      }
    } catch (e) { console.warn('[my-tweaks] 首頁套用失敗', e); }
  }
  // 新武器照範本的武器種類標籤(單手劍/匕首…;js/10 的 WEAPON_TAGS 以 ID 為鍵,要等所有核心檔載完才讀得到)
  function copyWeaponTags() {
    try {
      if (typeof WEAPON_TAGS === 'undefined') return;
      var ni = T.newItems || {};
      for (var id in ni) if (ni[id]._tpl && WEAPON_TAGS[ni[id]._tpl] && !WEAPON_TAGS[id]) WEAPON_TAGS[id] = WEAPON_TAGS[ni[id]._tpl].slice();
    } catch (e) { console.warn('[my-tweaks] 武器種類標籤複製失敗', e); }
  }
  // ── 禮物(試算表「禮物」分頁)：角色載入/建立後，把還沒領過、寄給他(或「全部」)的發給他 ──
  //   領過的編號記在 player.giftsClaimed(跟著存檔走：物品和「已領」同一份存檔，不會領兩次也不會漏)。
  //   只在角色真的載入好(player.cls)時動作；發完存一次檔。
  function grantGifts() {
    // 改版前建的角色沒有名字：提醒去取名(禮物照名字寄，沒名字只收得到「全部」)
    try { if (typeof player !== 'undefined' && player && player.cls && !player.name && typeof logSys === 'function') logSys('<span class="text-yellow-300">這個角色還沒有名字：點畫面上的「（點此取名）」取一個。</span>'); } catch (e) {}
    try {
      var G = T.gifts || [];
      if (!G.length || typeof player === 'undefined' || !player || !player.cls) return;
      var claimed = Array.isArray(player.giftsClaimed) ? player.giftsClaimed : (player.giftsClaimed = []);
      var got = [];
      for (var i = 0; i < G.length; i++) {
        var g = G[i];
        if (claimed.indexOf(g.id) >= 0) continue;
        if (g.to !== '全部' && g.to !== player.name) continue;
        if (g.kind === 'gold') { player.gold = (player.gold || 0) + g.cnt; got.push('金幣 ' + g.cnt.toLocaleString() + (g.note ? '（' + g.note + '）' : '')); }
        else if (g.kind === 'item' && DB.items[g.item] && typeof gainItem === 'function') { gainItem(g.item, g.cnt, true); got.push(DB.items[g.item].n + ' ×' + g.cnt + (g.note ? '（' + g.note + '）' : '')); }
        else continue;
        claimed.push(g.id);
      }
      if (!got.length) return;
      if (typeof logSys === 'function') got.forEach(function (t) { logSys('<span class="text-yellow-300 font-bold">🎁 收到禮物：' + t + '</span>'); });
      if (typeof updateUI === 'function') updateUI();
      if (typeof saveGame === 'function') saveGame();
    } catch (e) { console.warn('[my-tweaks] 發禮物失敗', e); }
  }
  function hookGifts() {
    ['loadGame', 'startGame'].forEach(function (fn) {
      var orig = window[fn];
      if (typeof orig !== 'function') return;
      window[fn] = function () { var r = orig.apply(this, arguments); setTimeout(grantGifts, 1500); return r; };   // 等離線結算/建角流程跑完再發
    });
  }
  function onReady() { copyWeaponTags(); applyHome(); hookGifts(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();

  // 樣式自帶(Tailwind 是預建置的,不能依賴沒出現過的 class)
  var css = document.createElement('style');
  css.textContent =
    '.my-home-notice{width:18rem;max-width:90vw;padding:.6rem .8rem;border:1px solid rgba(250,204,21,.45);border-radius:.5rem;' +
    'background:rgba(0,0,0,.55);color:#fde68a;font-size:.875rem;line-height:1.6;text-align:center;white-space:normal}' +
    '.my-home-links{display:flex;flex-wrap:wrap;justify-content:center;gap:.4rem 1rem;margin-bottom:.5rem}' +
    '.my-home-links a{color:#93c5fd;text-decoration:underline;font-size:.875rem}';
  (document.head || document.documentElement).appendChild(css);
})();
