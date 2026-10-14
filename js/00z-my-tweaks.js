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
  // ── 禮物信箱(試算表「禮物」分頁)：寄給這個角色(或「全部」)、還沒領的禮物放在信箱，玩家點「領取」才進背包 ──
  //   領過的編號記在 player.giftsClaimed(跟著存檔走：物品和「已領」同一份存檔，不會領兩次也不會漏)。
  //   信箱按鈕插在天堂M介面血條列(#lmui-vit)、MP 條右上方(左邊是夥伴圖示)；那支外掛關掉時改成畫面右上角的浮動按鈕。
  // 禮物一律是「白板」(不擲祝福/詛咒等隨機詞綴)；有強化值的照 gainItem 的堆疊規則(同簽章併同一格)自己放進背包
  function giveItem(id, cnt, en) {
    if (!en) { gainItem(id, cnt, true, true); return; }
    var probe = { id: id, en: en, bless: false, anc: false, attr: false, seteff: false };
    var ex = typeof sameItemSig === 'function' && player.inv.find(function (i) { return !i.gw && sameItemSig(i, probe); });
    if (ex) ex.cnt += cnt;
    else player.inv.push({ id: id, uid: uid(), cnt: cnt, en: en, bless: false, anc: false, attr: false, seteff: false, lock: false, junk: false });
  }
  function loaded() { return typeof player !== 'undefined' && player && player.cls; }
  function giftLabel(g) {
    if (g.kind === 'gold') return '金幣 ' + g.cnt.toLocaleString();
    return (g.en ? '+' + g.en + ' ' : '') + (DB.items[g.item] ? DB.items[g.item].n : g.item) + ' ×' + g.cnt;
  }
  function pendingGifts() {
    if (!loaded()) return [];
    var claimed = Array.isArray(player.giftsClaimed) ? player.giftsClaimed : [];
    return (T.gifts || []).filter(function (g) {
      return claimed.indexOf(g.id) < 0 && (g.to === '全部' || g.to === player.name) && (g.kind === 'gold' || (g.kind === 'item' && DB.items[g.item]));
    });
  }
  function claimGifts(ids) {
    try {
      if (!loaded()) return;
      var claimed = Array.isArray(player.giftsClaimed) ? player.giftsClaimed : (player.giftsClaimed = []);
      var got = [];
      pendingGifts().forEach(function (g) {
        if (ids && ids.indexOf(g.id) < 0) return;
        if (g.kind === 'gold') player.gold = (player.gold || 0) + g.cnt;
        else if (typeof gainItem === 'function') giveItem(g.item, g.cnt, g.en | 0);
        else return;
        claimed.push(g.id);
        got.push(giftLabel(g));
      });
      if (!got.length) return;
      if (typeof logSys === 'function') got.forEach(function (t) { logSys('<span class="text-yellow-300 font-bold">🎁 領取禮物：' + esc(t) + '</span>'); });
      if (typeof updateUI === 'function') updateUI();
      if (typeof saveGame === 'function' && loaded()) saveGame();
    } catch (e) { console.warn('[my-tweaks] 領禮物失敗', e); }
    renderMailbox();
  }
  function closeMailbox() { var ov = document.getElementById('my-mailbox'); if (ov) ov.remove(); }
  function renderMailbox() {
    var ov = document.getElementById('my-mailbox'); if (!ov) return;
    var list = pendingGifts();
    var rows = list.map(function (g) {
      return '<div class="my-mb-row"><div class="my-mb-txt"><b>🎁 ' + esc(giftLabel(g)) + '</b>' + (g.note ? '<small>' + esc(g.note) + '</small>' : '') + '</div>' +
        '<button type="button" class="my-mb-btn" data-id="' + esc(g.id) + '">領取</button></div>';
    }).join('');
    ov.querySelector('.my-mb-list').innerHTML = rows || '<div class="my-mb-empty">信箱是空的</div>';
    ov.querySelector('.my-mb-all').style.display = list.length > 1 ? '' : 'none';
    updateMailButton();
  }
  function openMailbox() {
    if (!loaded()) return;
    closeMailbox();
    var ov = document.createElement('div');
    ov.id = 'my-mailbox';
    ov.innerHTML = '<div class="my-mb-box"><div class="my-mb-head">📬 信箱<button type="button" class="my-mb-x" aria-label="關閉">✕</button></div>' +
      '<div class="my-mb-list"></div><button type="button" class="my-mb-btn my-mb-all">全部領取</button></div>';
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.closest('.my-mb-x')) { closeMailbox(); return; }
      var b = e.target.closest('.my-mb-btn'); if (!b) return;
      claimGifts(b.classList.contains('my-mb-all') ? null : [b.getAttribute('data-id')]);
    });
    document.body.appendChild(ov);
    renderMailbox();
  }
  function updateMailButton() {
    var btn = document.getElementById('my-mail-btn');
    if (!loaded()) { if (btn) btn.style.display = 'none'; return; }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'my-mail-btn'; btn.className = 'lmui-hit'; btn.setAttribute('aria-label', '信箱');
      // 金色信封(內嵌 SVG,不依賴 emoji 字型——各家手機的 📬 長得都不一樣)
      btn.innerHTML = '<svg viewBox="0 0 32 24" aria-hidden="true"><defs><linearGradient id="my-mail-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8dd8f"/><stop offset="1" stop-color="#c08a2e"/></linearGradient></defs>' +
        '<rect x="1.5" y="2" width="29" height="20" rx="2" fill="url(#my-mail-g)" stroke="#5b3d12" stroke-width="1.4"/>' +
        '<path d="M2.5 3.5 16 14 29.5 3.5" fill="none" stroke="#5b3d12" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M2.5 20.5 12.5 11.5M29.5 20.5 19.5 11.5" fill="none" stroke="#7a5418" stroke-width="1.2"/></svg><i></i>';
      btn.addEventListener('click', function (e) { e.stopPropagation(); openMailbox(); });
    }
    var vit = document.getElementById('lmui-vit');
    var host = vit || document.body;
    if (btn.parentNode !== host) host.appendChild(btn);
    btn.classList.toggle('my-mail-float', host === document.body);
    btn.style.display = '';   // 在 #lmui-vit 裡就跟著血條列一起顯示/隱藏(切到能力/背包等畫面時不會跑去擋別的東西)
    var n = pendingGifts().length, badge = btn.querySelector('i');
    var t = n ? String(n) : '';
    if (badge.textContent !== t) badge.textContent = t;
    btn.classList.toggle('has', n > 0);
  }
  var _notifiedFor = null;   // 每次進角色只提醒一次
  function onCharLoaded() {
    // 改版前建的角色沒有名字：提醒去取名(禮物照名字寄，沒名字只收得到「全部」)
    try { if (loaded() && !player.name && typeof logSys === 'function') logSys('<span class="text-yellow-300">這個角色還沒有名字：點畫面上的「（點此取名）」取一個。</span>'); } catch (e) {}
    try {
      var n = pendingGifts().length;
      if (n && _notifiedFor !== player && typeof logSys === 'function') logSys('<span class="text-yellow-300 font-bold">📬 你有 ' + n + ' 份禮物，點血條右上方的信箱領取。</span>');
      _notifiedFor = player;
    } catch (e) {}
    updateMailButton();
  }
  function hookGifts() {
    ['loadGame', 'startGame'].forEach(function (fn) {
      var orig = window[fn];
      if (typeof orig !== 'function') return;
      window[fn] = function () { var r = orig.apply(this, arguments); setTimeout(onCharLoaded, 1500); return r; };   // 等離線結算/建角流程跑完
    });
    setInterval(updateMailButton, 1000);   // 改名、回主選單、天堂M介面重建時跟著更新
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
    '.my-home-links a{color:#93c5fd;text-decoration:underline;font-size:.875rem}' +
    '#my-mail-btn{position:relative;display:flex;align-items:center;justify-content:center;width:38px;height:34px;padding:0;border:1px solid #8a6a3a;border-radius:6px;' +
    'background:linear-gradient(#3a2e20,#1a140d);box-shadow:inset 0 1px 0 rgba(255,220,150,.15),0 1px 4px #000;cursor:pointer;pointer-events:auto}' +
    '#my-mail-btn svg{width:70%;height:auto;filter:drop-shadow(0 1px 1px rgba(0,0,0,.7))}' +
    '#my-mail-btn.has{border-color:#c9a25a}' +
    '#my-mail-btn.my-mail-float{position:fixed;top:8px;right:8px;z-index:90}' +
    '#lmui-vit>#my-mail-btn{position:absolute;right:10px;bottom:100%;margin-bottom:4px;width:34px;height:30px;z-index:5}' +
    '#my-mail-btn i{position:absolute;top:-7px;right:-7px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;border:1px solid #fff;background:#dc2626;color:#fff;font:bold 11px/16px sans-serif;font-style:normal;text-align:center;box-shadow:0 1px 2px #000}' +
    '#my-mail-btn i:empty{display:none}' +
    '#my-mailbox{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.my-mb-box{width:100%;max-width:360px;max-height:80vh;display:flex;flex-direction:column;gap:8px;padding:12px;background:#1a1612;border:1px solid #b7791f;border-radius:10px;color:#eee}' +
    '.my-mb-head{display:flex;justify-content:space-between;align-items:center;color:#fbbf24;font-weight:bold;font-size:17px}' +
    '.my-mb-x{background:none;border:0;color:#aaa;font-size:18px;cursor:pointer}' +
    '.my-mb-list{overflow:auto;display:flex;flex-direction:column;gap:6px}' +
    '.my-mb-row{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#0e0b08;border:1px solid #4a3f30;border-radius:6px}' +
    '.my-mb-txt{flex:1;min-width:0;display:flex;flex-direction:column}.my-mb-txt small{color:#94a3b8}' +
    '.my-mb-btn{padding:6px 12px;border:1px solid #f59e0b;border-radius:6px;background:linear-gradient(#b45309,#78350f);color:#fff7ed;font-weight:bold;cursor:pointer;white-space:nowrap}' +
    '.my-mb-empty{padding:16px;text-align:center;color:#94a3b8}';
  (document.head || document.documentElement).appendChild(css);
})();
