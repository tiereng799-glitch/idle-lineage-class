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
  [['items', DB.items], ['mobs', DB.mobs], ['skills', DB.skills]].forEach(function (pair) {
    try {
      var src = T[pair[0]] || {}, base = pair[1];
      for (var id in src) {
        if (!base[id]) { console.warn('[my-tweaks] 找不到', pair[0], id); continue; }
        for (var p in src[id]) if (!setPath(base[id], p, src[id][p])) console.warn('[my-tweaks] 套不上', pair[0], id, p);
      }
    } catch (e) { console.warn('[my-tweaks] 套用失敗', pair[0], e); }
  });

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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyHome);
  else applyHome();

  // 樣式自帶(Tailwind 是預建置的,不能依賴沒出現過的 class)
  var css = document.createElement('style');
  css.textContent =
    '.my-home-notice{width:18rem;max-width:90vw;padding:.6rem .8rem;border:1px solid rgba(250,204,21,.45);border-radius:.5rem;' +
    'background:rgba(0,0,0,.55);color:#fde68a;font-size:.875rem;line-height:1.6;text-align:center;white-space:normal}' +
    '.my-home-links{display:flex;flex-wrap:wrap;justify-content:center;gap:.4rem 1rem;margin-bottom:.5rem}' +
    '.my-home-links a{color:#93c5fd;text-decoration:underline;font-size:.875rem}';
  (document.head || document.documentElement).appendChild(css);
})();
