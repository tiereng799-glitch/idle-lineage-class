/* ============================================================================
 * afk-noblackmarket.js — 隱藏黑市（潘朵拉）
 *
 * 入口全部藏起來，並在上游的 NPC 互動入口擋下（從任何地方都打不開）：
 *   ・村莊 NPC：潘朵拉（上游 npc_pandora，title「黑市」）—— NPC 清單卡片、村莊地圖上的人物都藏
 *   ・地圖面板的「黑市」快捷鈕（#btn-pandora-shortcut → openPandoraShortcut）
 *   ・世界頻道標題右邊的「黑市最新上架」跑馬燈（#syslog-pandora）
 *   ・interactNPC('npc_pandora', …) 一律不執行（任何外掛/核心路徑要打開黑市都會被擋）
 * 黑市的上架／交易資料不動（關掉開關就照原版恢復）。
 *
 * 掛接：在 index.html 的 </body> 前 <script src="afk-noblackmarket.js">（核心之後）。
 * ========================================================================== */
(function () {
  'use strict';

  if (window.AFK_TOGGLES) {
    AFK_TOGGLES.register({
      id: 'noblackmarket', name: '隱藏黑市', group: '遊戲玩法', def: true,
      desc: '村莊不再出現潘朵拉，地圖面板與世界頻道的黑市入口也一併隱藏'
    });
  }
  function on() { return !window.AFK_TOGGLES || AFK_TOGGLES.enabled('noblackmarket'); }
  if (!on()) return;

  var PANDORA_ID = 'npc_pandora';
  var NAME_RE = /潘朵拉/;

  // ── 互動入口兜底 ──
  if (typeof window.interactNPC === 'function') {
    var _origInteract = window.interactNPC;
    window.interactNPC = function (npcId) {
      if (npcId === PANDORA_ID && on()) return;
      return _origInteract.apply(this, arguments);
    };
  } else console.warn('[AFK-noblackmarket] 找不到 interactNPC，只藏入口。');
  if (typeof window.openPandoraShortcut === 'function') {
    var _origShortcut = window.openPandoraShortcut;
    window.openPandoraShortcut = function () { if (on()) return; return _origShortcut.apply(this, arguments); };
  }

  // ── 固定入口：樣式藏 ──
  var st = document.createElement('style');
  st.id = 'afk-noblackmarket-style';
  st.textContent = [
    '#btn-pandora-shortcut,#syslog-pandora{display:none !important;}',
    '.afk-bm-off{display:none !important;}',
    /* afk-lmui 的 NPC 卡片樣式帶 #afk-npclist 且 display:block !important，特異度要比它高才藏得掉 */
    'html body #afk-npclist .afk-npcl-row.afk-bm-off.afk-bm-off,html body #town-npc-map .town-npc.afk-bm-off.afk-bm-off{display:none !important;}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(st);

  // ── 村莊 NPC（清單卡片／地圖人物／上游卡片）：重繪後再標一次 ──
  function hideNpcs() {
    var rows = document.querySelectorAll('#afk-npclist .afk-npcl-row:not(.afk-bm-off)');
    for (var i = 0; i < rows.length; i++) {
      var nm = rows[i].querySelector('.afk-npcl-name');
      if (nm && NAME_RE.test(nm.textContent || '')) rows[i].classList.add('afk-bm-off');
    }
    var npcs = document.querySelectorAll('#town-npc-map .town-npc:not(.afk-bm-off)');
    for (var j = 0; j < npcs.length; j++) {
      var tn = npcs[j].querySelector('.tn-name');
      if (tn && NAME_RE.test(tn.textContent || '')) npcs[j].classList.add('afk-bm-off');
    }
    var cards = document.querySelectorAll('#town-npc-container > *:not(.afk-bm-off)');
    for (var k = 0; k < cards.length; k++) {
      var oc = cards[k].getAttribute('onclick') || '';
      if (oc.indexOf(PANDORA_ID) !== -1) cards[k].classList.add('afk-bm-off');
    }
  }
  function init() {
    hideNpcs();
    var tv = document.getElementById('town-view');
    if (tv && typeof MutationObserver === 'function') new MutationObserver(hideNpcs).observe(tv, { childList: true, subtree: true });
    else setInterval(hideNpcs, 1000);
    console.log('[AFK-noblackmarket] hooks OK — 黑市入口已隱藏。');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
