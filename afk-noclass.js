/* ============================================================================
 * afk-noclass.js — 創角不開放「幻術士」「龍騎士」
 *
 * 創角畫面的職業按鈕在 index.html(#btn-class-base-illusionist / -Dknight),
 * 點下去走 js/13 的 selectClassBase → selectClass。本外掛:
 *   ① 注入樣式把兩顆按鈕藏掉
 *   ② 包 selectClassBase / selectClass:被擋的職業一律改成王族(防有別的入口繞過按鈕)
 * 只管「新建角色」;已存在的幻術士/龍騎士存檔、傭兵、裝備職業限制一概不碰
 * (讀檔不經過 selectClass,所以舊角色照常能玩)。
 *
 * 掛接:在 index.html 的 </body> 前 <script src="afk-noclass.js">。
 * ========================================================================== */
(function () {
  'use strict';

  if (window.AFK_TOGGLES) {
    AFK_TOGGLES.register({
      id: 'noclass', name: '不開放幻術士、龍騎士', group: '遊戲玩法', def: true,
      desc: '建立角色時不能選這兩個職業（已有的角色不受影響）'
    });
  }
  function on() { return !window.AFK_TOGGLES || AFK_TOGGLES.enabled('noclass'); }
  if (!on()) return;

  var BLOCKED_BASE = { illusionist: 1, Dknight: 1 };
  function blockedRaw(c) { return typeof c === 'string' && /illusionist|Dknight/.test(c); }

  var style = document.createElement('style');
  style.textContent = '#btn-class-base-illusionist,#btn-class-base-Dknight{display:none!important}';
  document.head.appendChild(style);

  if (typeof window.selectClassBase !== 'function' || typeof window.selectClass !== 'function') {
    console.warn('[AFK-noclass] 找不到 selectClassBase/selectClass,只藏按鈕。');
    return;
  }

  var _origBase = window.selectClassBase;
  window.selectClassBase = function (base) {
    if (on() && BLOCKED_BASE[base]) base = 'royal';
    return _origBase.call(this, base);
  };

  var _origSel = window.selectClass;
  window.selectClass = function (c) {
    if (on() && blockedRaw(c)) c = String(c).indexOf('f_') === 0 ? 'f_royal' : 'm_royal';
    return _origSel.call(this, c);
  };

  console.log('[AFK-noclass] hooks OK — 創角已移除幻術士、龍騎士。');
})();
