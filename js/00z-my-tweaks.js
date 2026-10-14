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
    var sheet = (T.gifts || []).filter(function (g) {
      return claimed.indexOf(g.id) < 0 && (g.to === '全部' || g.to === player.name) && (g.kind === 'gold' || (g.kind === 'item' && DB.items[g.item]));
    });
    return sheet.concat(testMails().filter(function (g) { return DB.items[g.item]; }));
  }
  // ── 🧪 測試用寄信（站長 2026-10-14）：聊天框輸入「.道具名稱 數量」→ 那個道具寄到自己的信箱 ──
  //   信件存在 player.testMail（跟著存檔走）；領取時從清單移除，不記進 giftsClaimed（編號是臨時產生的，記了只會越堆越多）。
  function testMails() { return (loaded() && Array.isArray(player.testMail)) ? player.testMail : []; }
  function findItemByName(name) {
    var flat = name.replace(/\s+/g, ''), hit = null, near = [];
    for (var id in DB.items) {
      var d = DB.items[id]; if (!d || !d.n) continue;
      if (d.n === name || id === name) return id;
      var dn = String(d.n).replace(/\s+/g, '');
      if (!hit && dn === flat) hit = id;
      else if (near.length < 5 && dn.indexOf(flat) >= 0) near.push(d.n);
    }
    return hit || { near: near };
  }
  // 回傳 true＝這句是指令（已處理，不要當聊天送出）
  window.myChatCommand = function (text) {
    var t = String(text || '').trim();
    if (t.charAt(0) !== '.' && t.charAt(0) !== '．') return false;
    if (!loaded()) return true;
    var body = t.slice(1).trim(), m = body.match(/^(.*?)\s+(\d+)$/);
    var name = (m ? m[1] : body).trim(), cnt = m ? Math.min(99999, parseInt(m[2], 10)) : 1;
    var say = function (h) { if (typeof logSys === 'function') logSys(h); };
    if (!name) { say('<span class="text-slate-300">用法：.道具名稱 數量（例：.對武器施法的卷軸 5）</span>'); return true; }
    if (!(cnt > 0)) { say('<span class="text-red-300">數量要大於 0。</span>'); return true; }
    var r = findItemByName(name);
    if (typeof r !== 'string') {
      say('<span class="text-red-300">找不到「' + esc(name) + '」。' + (r.near.length ? '你是不是要找：' + r.near.map(esc).join('、') : '') + '</span>');
      return true;
    }
    if (!Array.isArray(player.testMail)) player.testMail = [];
    player.testMail.push({ id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: 'item', item: r, cnt: cnt, en: 0, _test: true });
    say('<span class="text-yellow-300 font-bold">📬 ' + esc(DB.items[r].n) + ' ×' + cnt + ' 已寄到信箱。</span>');
    updateMailButton(); renderMailbox();
    if (typeof saveGame === 'function') saveGame();
    return true;
  };
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
        if (g._test) { var tm = testMails(), k = tm.indexOf(g); if (k >= 0) tm.splice(k, 1); }
        else claimed.push(g.id);
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
  // 金色信封(內嵌 SVG,不依賴 emoji 字型——各家手機的 📬 長得都不一樣);按鈕與信箱標題共用
  var MAIL_SVG = '<svg viewBox="0 0 32 24" aria-hidden="true"><defs><linearGradient id="my-mail-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8dd8f"/><stop offset="1" stop-color="#c08a2e"/></linearGradient></defs>' +
    '<rect x="1.5" y="2" width="29" height="20" rx="2" fill="url(#my-mail-g)" stroke="#5b3d12" stroke-width="1.4"/>' +
    '<path d="M2.5 3.5 16 14 29.5 3.5" fill="none" stroke="#5b3d12" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M2.5 20.5 12.5 11.5M29.5 20.5 19.5 11.5" fill="none" stroke="#7a5418" stroke-width="1.2"/></svg>';
  function openMailbox() {
    if (!loaded()) return;
    closeMailbox();
    var ov = document.createElement('div');
    ov.id = 'my-mailbox';
    ov.className = 'fixed inset-0';   // 跟其他遮罩型視窗同一套擺位(天堂M介面會把它放到場景下方、不留空白)
    ov.innerHTML = '<div class="my-mb-box"><div class="my-mb-head"><span class="my-mb-title">' + MAIL_SVG + '信箱</span><button type="button" class="my-mb-x" aria-label="關閉">✕</button></div>' +
      '<div class="my-mb-list"></div><button type="button" class="my-mb-btn my-mb-all">全部領取</button></div>';
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.closest('.my-mb-x')) { closeMailbox(); return; }
      var b = e.target.closest('.my-mb-btn'); if (!b) return;
      claimGifts(b.classList.contains('my-mb-all') ? null : [b.getAttribute('data-id')]);
    });
    document.body.appendChild(ov);
    renderMailbox();
  }
  // 🧩 2026-10-14 站長：信箱鈕改成「功能」鈕（四格＋號圖示），點了彈出選單：信箱／交易所／排行榜。
  //   交易所、排行榜要等線上版，先顯示尚未開放。紅點數字仍是未領禮物數（掛在功能鈕上，選單裡的信箱也標一份）。
  //   按鈕 id 沿用 my-mail-btn（樣式與其他程式都認這個 id）。
  var FN_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="my-fn-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe6a6"/><stop offset="1" stop-color="#b8862f"/></linearGradient></defs>' +
    '<g fill="none" stroke="url(#my-fn-g)" stroke-width="2.4" stroke-linejoin="round"><rect x="4" y="4" width="10" height="10" rx="2"/><rect x="18" y="4" width="10" height="10" rx="2"/><rect x="4" y="18" width="10" height="10" rx="2"/></g>' +
    '<path d="M23 17.5v11M17.5 23h11" stroke="url(#my-fn-g)" stroke-width="2.8" stroke-linecap="round"/></svg>';
  // 選單圖示：金色線條（stroke 用 currentColor，顏色由 CSS 給）
  var FN_ICO = {
    mail: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="1.5"/><path d="M3 6l9 7 9-7"/></svg>',
    trade: '<svg viewBox="0 0 24 24"><path d="M4 8h15l-4-4M20 16H5l4 4"/></svg>',
    rank: '<svg viewBox="0 0 24 24"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5A3.5 3.5 0 0 1 16.5 11"/><path d="M12 14v3.5M8.5 20.5h7M9.5 17.5h5v3h-5z"/></svg>'
  };
  var FN_ITEMS = [
    { k: 'mail', name: '信箱', run: function () { openMailbox(); } },
    { k: 'trade', name: '交易所', run: function () { logSys('交易所尚未開放。'); } },
    { k: 'rank', name: '排行榜', run: function () { logSys('排行榜尚未開放。'); } }
  ];
  // 開：選單從功能鈕的位置彈出、選項依序滑入；關：先播收合動畫再移除（點選項時直接移除，不等動畫）
  function closeFnMenu(instant) {
    var m = document.getElementById('my-fn-menu'), b = document.getElementById('my-mail-btn');
    if (b) b.classList.remove('open');
    if (!m) return;
    if (instant || m.classList.contains('closing')) { m.remove(); return; }
    m.classList.add('closing');
    setTimeout(function () { if (m.parentNode) m.remove(); }, 140);
  }
  function toggleFnMenu(btn) {
    var cur = document.getElementById('my-fn-menu');
    if (cur && !cur.classList.contains('closing')) { closeFnMenu(); return; }
    if (cur) cur.remove();
    btn.classList.add('open');
    var m = document.createElement('div');
    m.id = 'my-fn-menu'; m.className = 'lmui-hit';
    var n = pendingGifts().length;
    m.innerHTML = FN_ITEMS.map(function (it) {
      return '<button type="button" data-k="' + it.k + '">' + (FN_ICO[it.k] || '') + '<span>' + it.name + '</span>' + (it.k === 'mail' && n ? '<i>' + n + '</i>' : '') + '</button>';
    }).join('');
    m.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-k]'); if (!b) return;
      e.stopPropagation(); closeFnMenu(true);
      var it = FN_ITEMS.filter(function (x) { return x.k === b.getAttribute('data-k'); })[0];
      if (it) it.run();
    });
    btn.parentNode.appendChild(m);
  }
  document.addEventListener('click', function (e) {   // 點選單以外的地方就收起
    if (!e.target.closest || e.target.closest('#my-fn-menu') || e.target.closest('#my-mail-btn')) return;
    closeFnMenu();
  }, true);
  function updateMailButton() {
    var btn = document.getElementById('my-mail-btn');
    if (!loaded()) { if (btn) btn.style.display = 'none'; closeFnMenu(true); return; }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'my-mail-btn'; btn.className = 'lmui-hit'; btn.setAttribute('aria-label', '功能');
      btn.innerHTML = '<span class="my-fn-ico">' + FN_SVG + '</span><i></i>';   // 站長：圖示下的「功能」字拿掉
      btn.addEventListener('click', function (e) { e.stopPropagation(); toggleFnMenu(btn); });
    }
    var vit = document.getElementById('lmui-vit');
    var host = vit || document.body;
    if (btn.parentNode !== host) { closeFnMenu(true); host.appendChild(btn); }
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
      if (n && _notifiedFor !== player && typeof logSys === 'function') logSys('<span class="text-yellow-300 font-bold">📬 你有 ' + n + ' 份禮物，點右下方的「功能」→「信箱」領取。</span>');
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
    /* 功能鈕：金框方塊圖示（按鈕本身透明） */
    '#my-mail-btn{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:0;border:0;background:none;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent}' +
    '#my-mail-btn .my-fn-ico{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid #9c7a40;border-radius:6px;' +
    'background:linear-gradient(#3a2e20,#140f09);box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,220,150,.18),0 1px 4px #000}' +
    '#my-mail-btn svg{width:72%;height:auto;filter:drop-shadow(0 1px 1px rgba(0,0,0,.8))}' +
    '#my-mail-btn .my-fn-lb{font-size:12px;font-weight:700;color:#efe2c2;text-shadow:0 1px 2px #000,0 0 2px #000;line-height:1}' +
    '#my-mail-btn:active .my-fn-ico{filter:brightness(1.25)}' +
    '#my-mail-btn.has .my-fn-ico{border-color:#d9b25e}' +
    '#my-mail-btn.my-mail-float{position:fixed;top:8px;right:8px;z-index:90}' +
    '#lmui-vit>#my-mail-btn{position:absolute;right:8px;bottom:100%;margin-bottom:6px;z-index:5}' +
    '#my-fn-menu{position:absolute;right:56px;bottom:100%;margin-bottom:8px;z-index:6;display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid #9c7a40;border-radius:8px;' +
    'background:linear-gradient(rgba(36,28,19,.97),rgba(14,11,7,.98));box-shadow:0 4px 14px rgba(0,0,0,.7);pointer-events:auto}' +
    'body>#my-fn-menu{position:fixed;top:52px;right:8px;bottom:auto;z-index:91}' +
    '#my-fn-menu button{position:relative;display:flex;align-items:center;gap:8px;min-width:112px;padding:8px 14px 8px 10px;border:1px solid #5a4630;border-radius:5px;background:linear-gradient(#2c2218,#18120c);color:#f0e2bf;font-size:15px;font-weight:700;text-align:left;cursor:pointer}' +
    '#my-fn-menu button svg{flex:none;width:20px;height:20px;fill:none;stroke:#e2bd6b;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 1px #000)}' +
    '#my-fn-menu button:active{filter:brightness(1.3)}' +
    '#my-fn-menu{transform-origin:100% 100%;animation:myFnPop .2s cubic-bezier(.2,.9,.3,1.25) both}' +
    'body>#my-fn-menu{transform-origin:100% 0}' +
    '#my-fn-menu.closing{animation:myFnOut .14s ease-in both}' +
    '#my-fn-menu button{animation:myFnItem .24s ease-out both}' +
    '#my-fn-menu button:nth-child(2){animation-delay:.05s}#my-fn-menu button:nth-child(3){animation-delay:.1s}' +
    '#my-fn-menu.closing button{animation:none}' +
    '@keyframes myFnPop{from{opacity:0;transform:scale(.55) translateX(14px)}to{opacity:1;transform:none}}' +
    '@keyframes myFnOut{from{opacity:1;transform:none}to{opacity:0;transform:scale(.7) translateX(10px)}}' +
    '@keyframes myFnItem{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}' +
    '#my-mail-btn.open .my-fn-ico{border-color:#f0cd7a;box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),0 0 0 1px #3a280c,0 0 10px rgba(240,190,90,.55)}' +
    '#my-fn-menu i{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;border:1px solid #fff;background:#dc2626;color:#fff;font:bold 11px/16px sans-serif;font-style:normal}' +
    '#my-mail-btn>i{position:absolute;top:-7px;right:-7px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;border:1px solid #fff;background:#dc2626;color:#fff;font:bold 11px/16px sans-serif;font-style:normal;text-align:center;box-shadow:0 1px 2px #000}' +
    '#my-mail-btn i:empty{display:none}' +
    '#my-mailbox{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.my-mb-box{width:100%;max-width:360px;max-height:80vh;display:flex;flex-direction:column;gap:8px;padding:12px;background:#1a1612;border:1px solid #b7791f;border-radius:10px;color:#eee}' +
    '.my-mb-head{display:flex;justify-content:space-between;align-items:center;color:#fbbf24;font-weight:bold;font-size:17px}' +
    '.my-mb-x{background:none;border:0;color:#aaa;font-size:18px;cursor:pointer}' +
    '.my-mb-title{display:inline-flex;align-items:center;gap:8px}.my-mb-title svg{width:26px;height:auto}' +
    '.my-mb-list{overflow:auto;display:flex;flex-direction:column;gap:6px}' +
    '.my-mb-row{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#0e0b08;border:1px solid #4a3f30;border-radius:6px}' +
    '.my-mb-txt{flex:1;min-width:0;display:flex;flex-direction:column}.my-mb-txt small{color:#94a3b8}' +
    '.my-mb-btn{padding:6px 12px;border:1px solid #f59e0b;border-radius:6px;background:linear-gradient(#b45309,#78350f);color:#fff7ed;font-weight:bold;cursor:pointer;white-space:nowrap}' +
    '.my-mb-empty{padding:16px;text-align:center;color:#94a3b8}';
  (document.head || document.documentElement).appendChild(css);
})();
