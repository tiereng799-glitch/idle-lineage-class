/* ============================================================================
 * afk-lmui.js — 天堂M風格介面（手機）
 *
 * 第一階段：戰鬥畫面改成天堂M的樣子 ——
 *   ・戰鬥框滿版、場景壓暗＋四周暗角（怪物站在下方 HUD 之上）
 *   ・左上：角色頭像（職業徽章；點頭像開裝備欄）、名字＋等級、AC / MR / 正邪值、金幣；≫ 收合狀態圖示
 *   ・右上：地圖名稱框＋半透明圓形小地圖（中心是自己、紅點是場上的怪；點了開「地圖」面板
 *     ＝上游原本的回村/瞬移/黑市/地圖選單）
 *   ・下方：HP/MP 長條、F1~F6 快捷列（先放已學會的手動技能，剩下的格子放身上的藥水/瞬移卷軸，
 *     顯示數量）、聊天框（一般/世界/戰鬥/掉落 分頁，點了開完整日誌）、最底下經驗 %
 *   ・按鈕：AUTO＝暫停／繼續（灰＝暫停中）、回村鈕＝回村（搖桿/攻擊/鎖定/PVP 玩家要求拿掉）
 *   ・底部導覽列換成只有圖示的樣式
 *
 * 資料來源一律讀核心 DOM / 全域（st-lv / st-ac / txt-hp / bar-hp… / player / mapState），
 *   不讀 afk-battlehud / afk-skillbar 的元素（那些可以被玩家單獨關掉）。
 *   這支是 afk-mobile 的子選項（parent:'mobile'）：底部導覽、日誌面板、mview-* 都是那支建的，
 *   那支關掉＝這支沒有掛點，所以讀 body.m-mobile / mview-center / #m-nav 是對的。
 *
 * 只在「上游手機 media query 成立 + 遊戲畫面 + 戰鬥分頁 + 在狩獵地圖」時套用；
 *   其他時候（村莊、背包分頁、桌機）body 上沒有 lmui-battle，畫面完全是原本的樣子。
 *
 * 掛接：在 index.html 的 </body> 前 <script src="afk-lmui.js">（排在 afk-mobile / afk-skillbar 之後）。
 * ========================================================================== */
(function () {
  'use strict';

  if (window.AFK_TOGGLES) {
    AFK_TOGGLES.register({
      id: 'lmui', name: '天堂M風格介面', group: '遊戲介面', def: true, parent: 'mobile',
      desc: '手機戰鬥畫面滿版，狀態、快捷列、聊天框浮在畫面上'
    });
  }
  function on() { return !window.AFK_TOGGLES || AFK_TOGGLES.enabled('lmui'); }
  if (!on()) return;

  // 與 css/style.css 手機版面那條一字不差（afk-mobile 的 MOBILE_GEOM_MQ 同一條）
  var MOBILE_MQ = '(max-width: 768px), (max-height: 520px) and (pointer: coarse)';
  var TICK_MS = 300;
  var TICKS_PER_SEC = 10;   // 核心 TICK_MS=100 → manualCd 是 tick 數
  var HOT_SLOTS = 12;   // F1~F12；一排 6 格，右邊的切換鈕循環「F1~F6 → F7~F12 → 兩排 → F1~F6」
  var HOT_ROW = 6;
  var HOT_MODE_KEY = 'lmui_hot_mode';   // 這台裝置的顯示方式（只是畫面偏好，不進存檔）
  var CHAT_LINES = 60;   // 聊天框可往上捲，保留最近幾行（取代 afk-mobile 的完整日誌面板）
  var CLASS_LOGO = { royal: '王族', knight: '騎士', mage: '法師', elf: '妖精', dark: '黑暗妖精' };
  // 快捷列的道具順序：治癒藥水由強到弱 → 藍水 → 加速/勇敢 → 瞬移卷軸；其餘 type:'pot' 排最後
  var HOT_ITEM_ORDER = ['potion_ult', 'potion_strong', 'potion_heal', 'potion_blue', 'potion_haste', 'potion_brave', 'scroll_teleport'];

  // 彈窗清單由 afk-banner 單一維護（不可停用的基礎設施）；取不到時退成不匹配任何元素的選擇器
  var MODAL_HOSTS = (window.AFK_BANNER && AFK_BANNER.MODAL_HOSTS) || '#afk-no-such-element';
  var LOG_AUTOCLOSE_MS = 5000;   // 進遊戲後這段時間內，afk-mobile 自動打開的日誌一律收起（聊天框已顯示同樣的內容）

  var mq = null;
  try { mq = matchMedia(MOBILE_MQ); } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function txt(id) { var e = $(id); return e ? (e.textContent || '').trim() : ''; }
  function setTxt(el, v) { if (el && el.textContent !== v) el.textContent = v; }
  function setStyle(el, k, v) { if (el && el.style[k] !== v) el.style[k] = v; }
  function hasP() { return typeof player !== 'undefined' && player && player.cls; }

  // ── 樣式 ────────────────────────────────────────────────
  function injectCSS() {
    if ($('afk-lmui-style')) return;
    var B = 'body.lmui-battle ';
    var STAND = '0px';   // 戰鬥框已縮在上半（#col-center 釘住），怪物/角色直接站在框底
    var css = [
      /* 戰鬥場景只佔上半（玩家要求「縮到一半、下方留空間」）：下方 HUD 面板＝可用高度的一半扣掉 AUTO 那條 */
      ':root{--lmui-btns:0px;--lmui-vit:58px;--lmui-stack:calc((100dvh - var(--orig-bar-h,0px) - var(--m-nav-h,0px)) / 2 - var(--lmui-vit));--lmui-gold:#d9bf86;--lmui-line:rgba(214,190,140,.45);--lmui-glass:rgba(8,8,10,.42);}',

      /* ── 上下兩塊：上半永遠是戰鬥（不管切到哪個分頁），下半放 HUD 或分頁內容 ──
         #col-center 釘在上半（fixed，不受 afk-mobile「一次只顯示一欄」影響）；#game-screen 本身縮到下半當捲動區——
         分頁內容、嵌入式裝備視窗（js/19 跟著 #game-screen 捲動對位）、afk-mobile 的觸控捲動轉發都還是同一個捲動容器。
         html 前綴＝壓過 afk-mobile 的 body.m-mobile #game-screen{padding-bottom:…!important}、#col-center{display:none!important}。 */
      'html ' + B + '#game-screen{top:var(--lmui-mtop) !important;height:auto !important;bottom:0 !important;padding:8px 8px calc(var(--m-nav-h,0px) + 8px) !important;overflow-y:auto !important;}',
      'html ' + B + '#col-center{display:flex !important;position:fixed !important;top:var(--orig-bar-h,0px) !important;left:0 !important;right:0 !important;width:auto !important;height:calc(var(--lmui-mtop) - var(--lmui-vit) - var(--orig-bar-h,0px)) !important;gap:0 !important;margin:0 !important;z-index:1;}',
      B + '#map-view-panel{flex:1 1 auto !important;height:100% !important;min-height:0 !important;display:flex !important;flex-direction:column !important;background:none !important;border:0 !important;border-radius:0 !important;box-shadow:none !important;padding:0 !important;margin:0 !important;position:relative !important;}',
      B + '#map-view-panel::before,' + B + '#map-view-panel::after{display:none !important;}',
      B + '#map-view-panel>.panel-header{display:none !important;}',
      /* 場景壓暗：底色 #555 × multiply ≈ 原圖亮度 1/3；inset 陰影做四周暗角（畫在背景之上、怪物之下） */
      B + '#battle-view{flex:1 1 auto !important;width:100% !important;max-width:none !important;height:auto !important;min-height:0 !important;aspect-ratio:auto !important;margin:0 !important;border:0 !important;border-radius:0 !important;background-size:cover !important;background-position:center !important;background-color:#5a5550 !important;background-blend-mode:multiply !important;box-shadow:inset 0 0 140px 50px rgba(0,0,0,.9) !important;padding:0 0 ' + STAND + ' !important;align-self:stretch !important;}',
      /* 角色/夥伴是 absolute 貼戰鬥框底（核心 inline bottom:2px），padding 對它們無效 → 底線跟著抬 */
      B + '#player-morph-sprite{bottom:calc(' + STAND + ' + 2px) !important;}',
      B + '#pet-layer{top:0 !important;height:auto !important;bottom:' + STAND + ' !important;}',
      B + '#status-icon-bar{position:absolute !important;top:48px !important;right:6px !important;left:auto !important;max-width:62% !important;z-index:5;display:flex !important;flex-flow:row-reverse wrap !important;justify-content:flex-start !important;gap:3px;}',   // 右上角、地圖鈕下方，從右往左排
      /* 狀態（魔法）圖示放大：上游手機只有 ~12px，看不出是哪個魔法 */
      B + '#status-icon-bar .status-icon{width:28px !important;height:28px !important;min-width:28px;border:1px solid rgba(0,0,0,.8);box-shadow:0 1px 3px #000;}',
      B + '#status-icon-bar .status-icon img{width:100% !important;height:100% !important;object-fit:cover;}',
      'body.lmui-battle.lmui-nobuff #status-icon-bar{display:none !important;}',
      /* 戰鬥畫面不被視窗遮住：彈窗一律改放在「場景下緣以下」（蓋住按鈕/快捷列/聊天框，不蓋場景）。
         afk-mobile / afk-banner 的彈窗讓位規則全是 top＝var(--orig-bar-h)、高＝100dvh−bar−nav，
         所以只要在「彈窗元素自己身上」把 --orig-bar-h 換成場景下緣，那整套規則（A 型/B 型/內卡封頂）就自動跟著改。
         --lmui-mtop 定義在 :root、繼承下來時已算好值，不會跟 --orig-bar-h 形成循環；#app-stage 等主畫面不受影響。 */
      ':root{--lmui-mtop:calc(100dvh - var(--m-nav-h,0px) - var(--lmui-stack) - var(--lmui-btns));--lmui-bar:var(--orig-bar-h,0px);--lmui-pop-top:calc(var(--lmui-bar) + 92px);--lmui-pop-bot:calc(var(--m-nav-h,0px) + 4px);--lmui-pop-side:max(4px,calc((100vw - max(330px,80vw)) / 2));}',
      /* 所有彈窗＝浮動視窗：寬約畫面 8 成置中（至少 330px）、上緣在頭像列下方、下緣到工具列上方、圓角金框、外圍壓暗（玩家要求「滿版、四周留點間隙」） */
      B + ':is(#item-modal,#warehouse-window-frame,.fixed.inset-0,' + MODAL_HOSTS + '){--orig-bar-h:calc(var(--lmui-bar) + 4px) !important;}',
      /* 遮罩型（滿版半透明底＋內卡置中）只靠 padding 把內卡推下去，那片暗底還是從頂端蓋住戰鬥 → 遮罩本身也從場景下緣開始 */
      'html ' + B + ':is(.fixed.inset-0,' + MODAL_HOSTS + '){top:var(--lmui-bar) !important;padding:calc(var(--lmui-pop-top) - var(--lmui-bar)) var(--lmui-pop-side) var(--lmui-pop-bot) !important;}',
      'html ' + B + '#warehouse-window-frame{top:var(--lmui-pop-top) !important;bottom:var(--lmui-pop-bot) !important;left:var(--lmui-pop-side) !important;right:var(--lmui-pop-side) !important;width:auto !important;height:auto !important;max-height:none !important;transform:none !important;border-radius:10px !important;box-shadow:0 0 0 100vmax rgba(0,0,0,.55),0 10px 40px rgba(0,0,0,.9) !important;}',
      /* 遮罩型的內卡撐滿遮罩（扣掉上面那圈 padding） */
      'html ' + B + ':is(' + (window.AFK_BANNER && AFK_BANNER.MODAL_BOXES || '#afk-no-such-element') + '){width:100% !important;max-width:none !important;height:auto !important;max-height:100% !important;border-radius:10px !important;overflow:auto !important;}',
      /* 內容少的視窗不撐滿：遮罩型的內卡改成靠上、高度跟內容走（最多到工具列上方） */
      'html ' + B + ':is(.fixed.inset-0,' + MODAL_HOSTS + '){align-items:flex-start !important;}',
      B + '#m-log-sheet{height:calc(var(--lmui-stack) + var(--lmui-btns)) !important;}',
      /* 不在上面清單裡、直接掛在 body 下的全螢幕彈窗（決鬥競技場、小百科、掉落查詢…）：tick 偵測到蓋住戰鬥就掛 .lmui-below。
         遮罩型（inset:0＋置中）→ 上緣壓到場景下緣、內卡封頂可捲；transform 置中型 → 改貼場景下緣、只留水平置中。 */
      B + '.lmui-below{top:var(--lmui-pop-top) !important;bottom:auto !important;left:var(--lmui-pop-side) !important;right:var(--lmui-pop-side) !important;width:auto !important;height:auto !important;max-height:calc(100dvh - var(--lmui-pop-top) - var(--lmui-pop-bot)) !important;border-radius:10px !important;}',
      B + '.lmui-below>*{max-height:100% !important;overflow:auto !important;}',
      B + '.lmui-below-c{top:var(--lmui-pop-top) !important;bottom:auto !important;left:var(--lmui-pop-side) !important;right:var(--lmui-pop-side) !important;width:auto !important;height:auto !important;max-height:calc(100dvh - var(--lmui-pop-top) - var(--lmui-pop-bot)) !important;transform:none !important;overflow:auto !important;border-radius:10px !important;box-shadow:0 0 0 100vmax rgba(0,0,0,.55),0 10px 40px rgba(0,0,0,.9) !important;}',
      /* 彈窗開著時收起下方 HUD：#app-stage 是 fixed＝自成疊層，裡面的彈窗 z-index 再高也蓋不過 body 層的 HUD。
         核心 js/10 同步到 body 的 item-modal-open / town-int-open 讓常見的兩種當下就收（不等 tick；不用 :has()，那會讓整頁樣式一直重算）；其餘彈窗由 tick 掛 .lmui-win。 */
      'body.lmui-battle.lmui-win #lmui-hud>:not(#lmui-mobinfo):not(#lmui-tl):not(#lmui-tr):not(#lmui-vit),' +
      'body.lmui-battle.mlog-open #lmui-bottom,' +
      'body.lmui-battle.lmui-map #lmui-bottom,body.lmui-battle.lmui-dead #lmui-bottom,' +
      /* 下方 HUD 只屬於「戰鬥」分頁；切到背包/素質/隊伍時下半給分頁內容 */
      'body.lmui-battle:not(.mview-center) #lmui-bottom{display:none !important;}',
      'body.lmui-battle.item-modal-open #lmui-hud>:not(#lmui-mobinfo):not(#lmui-tl):not(#lmui-tr):not(#lmui-vit){display:none !important;}',
      'body.lmui-battle.lmui-mobinfo #lmui-hud>:not(#lmui-mobinfo):not(#lmui-tl):not(#lmui-tr):not(#lmui-vit){visibility:hidden !important;}',
      /* 子分頁列（工具列正上方那排）也是 fixed、層級很高，彈窗開著時會蓋住視窗底部 → 一起收起 */
      'body.lmui-win #lmui-bagtabs,body.lmui-mobinfo #lmui-bagtabs,body.lmui-npcwin #lmui-bagtabs{display:none !important;}',
      'body.lmui.item-modal-open #lmui-bagtabs{display:none !important;}',
      /* 怪物血條移到頭上（名字下方）：怪物卡是直向 flex（名字/徽章/圖/狀態/血條），只改 order 不動結構 */
      B + '#mob-list .mob-target>.mob-name{order:-2;}',
      B + '#mob-list .mob-target>.mob-hp-bar{order:-1;margin:1px 0 2px !important;}',
      /* 被 HUD 取代的元件 */
      B + '#m-status,' + B + '#mobile-vitals,' + B + '#m-skillbar,' + B + '#m-battle-buffs{display:none !important;}',
      /* 死亡視窗（天堂M）：重新開始／離開／取消＋狩獵紀錄，蓋在戰鬥畫面中央；按「取消」收起後只留頭頂那顆「重新開始」 */
      'body.lmui-popover #lmui-vit{visibility:hidden !important;}',
      '#lmui-death{display:none;position:fixed;left:50%;top:calc(var(--orig-bar-h,0px) + 48px);max-height:calc(100dvh - var(--orig-bar-h,0px) - 48px - var(--m-nav-h,0px) - 4px);overflow:auto;transform:translateX(-50%);z-index:60;width:min(250px,78vw);padding:8px;background:linear-gradient(#24211d,#121110);border:1px solid #57514a;border-radius:3px;box-shadow:0 0 0 1px #000,0 10px 30px rgba(0,0,0,.85);color:#e9e2d4;font-size:15px;text-shadow:0 1px 1px #000;}',
      'body.lmui-battle.lmui-dead:not(.lmui-deathx) #lmui-death,body.lmui-exitwin #lmui-death{display:block;}',
      'html body.lmui-battle.lmui-dead:not(.lmui-deathx) #map-view-panel>.panel-header{display:none !important;}',
      '#lmui-death button{font-family:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}',
      '.ld-btns{display:flex;flex-direction:column;gap:5px;}',
      '.ld-btns button{height:32px;font-size:16px;font-weight:700;letter-spacing:2px;color:#f1ead9;background:linear-gradient(#4a4741,#2b2925 55%,#22201d);border:1px solid #6b665d;border-radius:2px;box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 1px 2px #000;}',
      '.ld-btns button:active{filter:brightness(1.3);}',
      '.ld-stats{margin-top:8px;padding:7px 8px 6px;background:rgba(0,0,0,.35);border:1px solid #3d3933;border-radius:2px;}',
      '.ld-row{display:flex;align-items:center;gap:6px;height:21px;}',
      '.ld-row span{flex:1;color:#cfc6b4;}',
      '.ld-row span::before{content:"◆";margin-right:4px;font-size:12px;color:#6fa8dc;vertical-align:1px;}',
      '.ld-row b{font-weight:600;color:#fff;font-variant-numeric:tabular-nums;}',
      '.ld-look{width:20px;height:18px;padding:0;font-size:13px;line-height:16px;background:#2e2b27;border:1px solid #5a554c;border-radius:2px;}',
      '.ld-items{max-height:90px;overflow:auto;margin:3px 0 2px;padding:3px 6px;background:rgba(0,0,0,.4);border:1px solid #33302b;font-size:14px;}',
      '.ld-items div{display:flex;justify-content:space-between;gap:8px;line-height:18px;}',
      '.ld-items b{font-weight:600;}',
      '.ld-items .ld-none{color:#8d8577;justify-content:center;}',
      '.ld-reset{display:block;margin:6px 0 0;width:64px;height:24px;font-size:14px;font-weight:700;color:#e9e2d4;background:linear-gradient(#45423c,#26241f);border:1px solid #6b665d;border-radius:2px;}',
      /* 取消後：標題列只留「祈求復活」一顆，改名「重新開始」，浮在角色身上（位置由 placeDeadBtn 量） */
      'html body.lmui-battle.lmui-dead.lmui-deathx #map-view-panel>.panel-header{display:block !important;position:fixed !important;left:var(--lmui-dead-x,50%) !important;top:var(--lmui-dead-y,30%) !important;right:auto !important;bottom:auto !important;width:auto !important;height:auto !important;min-height:0 !important;transform:translate(-50%,-100%) !important;z-index:60 !important;padding:0 !important;margin:0 !important;background:none !important;border:0 !important;box-shadow:none !important;}',
      'html body.lmui-battle.lmui-dead.lmui-deathx #map-view-panel>.panel-header>:not(:has(#btn-revive)),html body.lmui-battle.lmui-dead.lmui-deathx #map-view-panel>.panel-header>div>:not(#btn-revive){display:none !important;}',
      'html body.lmui-battle.lmui-dead.lmui-deathx #map-view-panel>.panel-header>div{display:block !important;width:auto !important;}',
      'html body.lmui-battle.lmui-dead.lmui-deathx #btn-revive{display:block !important;flex:none !important;width:auto !important;margin:0 !important;padding:10px 28px !important;font-size:0 !important;line-height:0 !important;white-space:nowrap !important;background:linear-gradient(#e7c56f,#a8822f) !important;border:1px solid #f0d58c !important;border-radius:6px !important;box-shadow:0 0 14px rgba(240,213,140,.55),0 3px 10px rgba(0,0,0,.8) !important;}',
      'html body.lmui-battle.lmui-dead.lmui-deathx #btn-revive::after{content:"重新開始";font-size:17px;line-height:20px;font-weight:700;color:#1d1407;letter-spacing:1px;}',
      /* 地圖面板（上游標題列：回村/瞬移/黑市/地圖選單/復活鈕），點地圖名稱才出現 */
      'body.lmui-battle.lmui-map:not(.lmui-dead) #map-view-panel>.panel-header{display:flex !important;position:fixed !important;top:calc(var(--lmui-mtop) + 8px) !important;left:10px !important;right:10px !important;z-index:60 !important;flex-wrap:wrap !important;gap:8px !important;padding:10px !important;background:rgba(14,12,10,.92) !important;border:1px solid var(--lmui-line) !important;border-radius:6px !important;box-shadow:0 8px 30px rgba(0,0,0,.7) !important;height:auto !important;}',

      /* ── HUD 外框：釘在視窗上（讓開橫幅與底部導覽），本身不吃點擊 ── */
      '#lmui-hud{display:none;position:fixed;left:0;right:0;top:var(--orig-bar-h,0px);bottom:var(--m-nav-h,0px);z-index:50;pointer-events:none;font-family:inherit;color:#eee;text-shadow:0 1px 2px #000,0 0 2px #000;}',
      'body.lmui-battle #lmui-hud{display:block;}',
      '#lmui-hud button{font-family:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}',
      '#lmui-hud .lmui-hit{pointer-events:auto;}',

      /* 左上：頭像＋數值 */
      '#lmui-tl{position:absolute;top:6px;left:6px;display:flex;gap:6px;align-items:flex-start;}',
      '#lmui-face{width:44px;flex:none;display:flex;flex-direction:column;align-items:center;}',
      '#lmui-face .pic{width:44px;height:50px;border:1px solid var(--lmui-line);background:rgba(0,0,0,.5);overflow:hidden;box-shadow:0 1px 4px #000;}',
      '#lmui-face img{width:100%;height:100%;object-fit:cover;object-position:50% 40%;transform:scale(3.2);transform-origin:50% 36%;}',
      '#lmui-face img.logo{object-fit:contain;object-position:center;transform:none;padding:4px;}',
      '#lmui-face{position:relative;}',
      '#lmui-face .pic{cursor:pointer;}',
      '#lmui-lv{font-size:14px;font-weight:700;color:#e8d9b0;}',   /* 等級跟在名字右邊 */
      '#lmui-buffbtn{margin-top:3px;width:22px;height:14px;padding:0;font-size:12px;line-height:12px;color:#ddd;background:rgba(0,0,0,.55);border:1px solid var(--lmui-line);border-radius:2px;}',
      '#lmui-stats{display:flex;flex-direction:column;gap:2px;padding-top:2px;font-size:13px;}',
      '#lmui-stats .row{display:flex;gap:9px;align-items:baseline;white-space:nowrap;}',
      '#lmui-stats .k{color:#bdbdbd;margin-right:3px;}',
      '#lmui-stats b{color:#fff;font-weight:600;}',
      '#lmui-align .k,#lmui-align b{color:#d1d5db;}#lmui-align.justice .k,#lmui-align.justice b{color:#60a5fa;}#lmui-align.evil .k,#lmui-align.evil b{color:#f87171;}',
      '#lmui-gold b{color:#f5d77b;}',
      /* 角色名字(點一下改名；沒名字的舊角色顯示灰色「（點此取名）」) */
      '#lmui-name{all:unset;cursor:pointer;font-size:15px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000;max-width:150px;overflow:hidden;text-overflow:ellipsis;}',
      '#lmui-name.empty{color:#94a3b8;font-weight:400;}',
      '#lmui-name-input{width:96px;font-size:15px;padding:1px 4px;border-radius:3px;border:1px solid #d9bf86;background:#020617;color:#fff;}',
      '#lmui-name-ok{margin-left:4px;padding:0 6px;font-weight:700;color:#4ade80;background:rgba(0,0,0,.6);border:1px solid #4ade80;border-radius:3px;}',

      /* 右上：地圖名稱框＋小地圖 */
      '#lmui-tr{position:absolute;top:6px;right:6px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;}',
      '#lmui-mapname{min-width:104px;max-width:160px;padding:3px 10px 3px;border:1px solid #7a6440;border-radius:3px;background:linear-gradient(#4a3c2a,#211910);color:#f0e2bf;text-align:center;box-shadow:inset 0 1px 0 rgba(255,235,190,.2),0 1px 4px #000;}',
      '#lmui-mapname b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '#lmui-mapname small{display:block;font-size:12px;color:#bfae86;line-height:1.2;}',
      '#lmui-mini{display:none !important;position:relative;width:92px;height:92px;border-radius:50%;padding:0;border:1px solid rgba(255,255,255,.22);background:radial-gradient(circle,rgba(30,30,30,.35),rgba(0,0,0,.6));box-shadow:0 0 0 1px rgba(0,0,0,.6),inset 0 0 14px rgba(0,0,0,.7);overflow:hidden;}',
      '#lmui-mini i{position:absolute;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:#ef4444;box-shadow:0 0 4px #ef4444;}',
      '#lmui-mini i.me{width:7px;height:7px;margin:-3.5px 0 0 -3.5px;background:#fef3c7;box-shadow:0 0 5px #fde68a;}',
      '#lmui-mini i.boss{width:8px;height:8px;margin:-4px 0 0 -4px;background:#f97316;box-shadow:0 0 6px #f97316;}',
      '#lmui-mini .moon{position:absolute;right:10px;top:6px;font-size:12px;opacity:.8;}',

      /* 半透明圓鈕（天堂M那種玻璃感） */
      '.lmui-round{position:absolute;border-radius:50%;border:1px solid rgba(255,255,255,.28);background:radial-gradient(circle at 50% 40%,rgba(60,60,60,.35),rgba(0,0,0,.45) 75%);color:rgba(255,255,255,.85);box-shadow:inset 0 0 14px rgba(0,0,0,.55),0 1px 3px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:0;font-weight:600;}',
      '.lmui-round:active{background:radial-gradient(circle at 50% 40%,rgba(120,110,90,.45),rgba(0,0,0,.45) 75%);}',
      /* AUTO：小紅球，壓在血條上緣正中 */
      '#lmui-auto{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:4;width:40px;height:40px;padding:0;border-radius:50%;font:700 12px/1 inherit;letter-spacing:.3px;border:1px solid rgba(255,200,150,.7);background:radial-gradient(circle at 40% 35%,#f87171,#991b1b 55%,#3b0a0a);color:#fff;text-shadow:0 1px 1px #000;box-shadow:0 0 10px rgba(239,68,68,.55),0 1px 4px #000;cursor:pointer;}',
      '#lmui-auto:active{filter:brightness(1.3);}',
      /* AUTO 暫停中：灰掉、不發光 */
      '#lmui-auto.off{border-color:rgba(255,255,255,.35);background:radial-gradient(circle at 40% 35%,#9ca3af,#4b5563 55%,#1f2937);box-shadow:0 1px 4px #000;color:#e5e7eb;}',

      /* ── 下方堆疊：血條 → 快捷列 → 聊天框 ── */
      '#lmui-vit{position:absolute;left:0;right:0;top:calc(var(--lmui-mtop) - var(--lmui-vit) - var(--orig-bar-h,0px));height:var(--lmui-vit);padding:3px 4px 0;display:flex;flex-direction:column;justify-content:center;gap:2px;background:linear-gradient(#1d1711,#0e0b08);border-top:1px solid #4a3f30;box-shadow:0 -3px 8px rgba(0,0,0,.6);pointer-events:auto;z-index:3;}',
      '#lmui-bottom{position:absolute;left:0;right:0;bottom:0;height:var(--lmui-stack);display:flex;flex-direction:column;gap:4px;padding:6px 4px 4px;background:linear-gradient(#1a1612,#0b0907);border-top:1px solid #4a3f30;box-shadow:0 -6px 14px rgba(0,0,0,.65);}',
      /* HP/MP：經典天堂那種「左右兩條＋中間圓章」的框。框借上游的 assets/character/血條底圖.png（334×34，桌機狀態面板同一張），
         調成銅色（只濾 ::before 那層，血條本身不受影響）；血條位置照上游 .status-vitals-row 的比例（左 3.3%／右 55.5%、寬 41.2%）。 */
      '#lmui-bars{position:relative;flex:none;width:100%;aspect-ratio:334/34;max-height:40px;}',
      /* 夥伴列：寵物(項圈圖)／召喚(召喚術圖)／迷魅(迷魅術圖)，一隻一格，壓在血條上緣；點一下看狀態 */
      '#lmui-comp{position:absolute;left:4px;bottom:100%;margin-bottom:3px;display:flex;gap:4px;z-index:5;}',
      '.lmui-cp{position:relative;width:28px;height:28px;padding:0;border:1px solid var(--lmui-line);border-radius:4px;background:rgba(0,0,0,.6);box-shadow:0 1px 3px #000;cursor:pointer;}',
      '.lmui-cp img{width:100%;height:100%;object-fit:contain;display:block;}',
      '.lmui-cp i{position:absolute;left:1px;right:1px;bottom:1px;height:3px;background:#3b0a0a;}',
      '.lmui-cp i b{display:block;height:100%;background:#ef4444;}',
      '.lmui-cp.down{filter:grayscale(1);opacity:.55;}',
      '.lmui-cp.on{border-color:#fde68a;box-shadow:0 0 6px #fde68a;}',
      '#lmui-comp-pop{position:absolute;left:4px;bottom:calc(100% + 36px);min-width:150px;padding:6px 9px;background:rgba(12,9,6,.94);border:1px solid var(--lmui-line);border-radius:6px;font-size:14px;line-height:1.6;color:#eee;z-index:6;white-space:nowrap;}',
      '#lmui-comp-pop.hidden{display:none;}',
      '#lmui-comp-pop .t{color:#fde68a;font-weight:700;}',
      '#lmui-bars::before{content:"";position:absolute;inset:0;background:url("assets/character/血條底圖.png") center/100% 100% no-repeat;filter:sepia(1) saturate(1.6) hue-rotate(-12deg) brightness(.72) contrast(1.15);z-index:0;pointer-events:none;}',
      '.lmui-bar{position:absolute;top:50%;width:41.2%;height:46%;transform:translateY(-50%);background:#100606;border-radius:2px;overflow:hidden;box-shadow:inset 0 1px 3px #000;z-index:1;}',
      '#lmui-hp{left:3.3%;}#lmui-mp{left:55.5%;}',
      '.lmui-bar i{position:absolute;left:0;top:0;bottom:0;width:0;transition:width .25s;}',
      '#lmui-hp i{background:linear-gradient(#ff7a6a,#c81e1e 35%,#7a0b0b 75%,#4a0505);}',
      '#lmui-mp i{background:linear-gradient(#7aa8ff,#2453c8 35%,#10307a 75%,#081a4a);}',
      '.lmui-bar span{position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;font:700 12px/1 Consolas,"Courier New",monospace;letter-spacing:.5px;color:#fff;text-shadow:1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;}',
      '#lmui-hot{display:grid;grid-template-columns:repeat(' + HOT_ROW + ',1fr) 24px;gap:3px;flex:none;}',
      '#lmui-hot[data-mode="0"] .lmui-slot.r2,#lmui-hot[data-mode="1"] .lmui-slot.r1{display:none;}',
      '#lmui-hot[data-mode="2"] .lmui-slot{max-height:40px;}',   /* 兩排時矮一點，聊天框才不會被擠光 */
      '#lmui-hot[data-mode="2"] #lmui-hotmode{grid-row:1 / span 2;max-height:none;}',
      '#lmui-hotmode{grid-column:' + (HOT_ROW + 1) + ';grid-row:1;padding:0;border:1px solid #5d4c33;border-radius:4px;background:linear-gradient(#2a2119,#0f0c09);color:#f0e2bf;font-size:13px;line-height:1.1;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;max-height:54px;}',
      '#lmui-hotmode b{font-size:15px;}',
      '#lmui-hotpick{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:12px;}',
      '#lmui-hotpick .box{width:100%;max-width:380px;max-height:80vh;display:flex;flex-direction:column;background:#0f0c09;border:1px solid #b7791f;border-radius:10px;overflow:hidden;color:#eee;}',
      '#lmui-hotpick .hd{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #4a3f30;color:#fbbf24;font-weight:700;font-size:17px;}',
      '#lmui-hotpick .hd button{background:none;border:0;color:#aaa;font-size:19px;cursor:pointer;}',
      '#lmui-hotpick .bd{overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px;}',
      '#lmui-hotpick .sec{color:#d9bf86;font-size:14px;margin-top:4px;}',
      '#lmui-hotpick .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px;}',
      '#lmui-hotpick .opt{display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #4a3f30;border-radius:6px;background:#1a1612;color:#eee;font-size:15px;text-align:left;cursor:pointer;min-width:0;}',
      '#lmui-hotpick .opt.on{border-color:#fde68a;box-shadow:0 0 6px rgba(253,230,138,.6);}',
      '#lmui-hotpick .opt img{width:26px;height:26px;object-fit:contain;flex:none;}',
      '#lmui-hotpick .opt span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#lmui-hotpick .ft{display:flex;gap:6px;padding:8px;border-top:1px solid #4a3f30;}',
      '#lmui-hotpick .ft button{flex:1;padding:8px;border:1px solid #6b5636;border-radius:6px;background:#1a1612;color:#f0e2bf;font-weight:700;cursor:pointer;}',
      '.lmui-slot{position:relative;aspect-ratio:1;max-height:54px;border:1px solid #5d4c33;background:linear-gradient(#1d1813,#0a0806);box-shadow:inset 0 0 6px #000;padding:0;display:flex;align-items:center;justify-content:center;}',
      '.lmui-slot .fk{position:absolute;left:1px;top:1px;padding:0 3px;font-size:11px;line-height:11px;color:#f0e2bf;background:rgba(0,0,0,.7);border:1px solid #6b5636;border-radius:6px;z-index:2;}',
      '.lmui-slot img{width:86%;height:86%;object-fit:contain;}',
      '.lmui-slot .n{position:absolute;right:2px;bottom:0;font-size:12px;font-weight:700;color:#fff;z-index:2;}',
      '.lmui-slot.is-off img{opacity:.4;}',
      '.lmui-slot .cd{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.65);color:#fca5a5;font-size:15px;font-weight:700;}',
      '.lmui-slot.is-cd .cd{display:flex;}',
      '#lmui-chat{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;background:rgba(0,0,0,.5);overflow:hidden;}',
      '#lmui-tabs{display:flex;gap:2px;padding:2px 2px 0;flex:none;align-items:stretch;}',
      '#lmui-tabs button{flex:1;padding:1px 0;font-size:12px;color:#c9b88f;background:linear-gradient(#3b3022,#1c160e);border:1px solid #4d3e29;border-radius:2px;}',
      '#lmui-tabs button.on{color:#fff6dc;background:linear-gradient(#7a5f35,#3f2f18);border-color:#b8955a;}',
      '#lmui-tabs .more{flex:0 0 22px;}',
      '#lmui-tabs .flt{flex:0 0 38px;}',
      'body.lmui-flt #lmui-tabs .flt{color:#fff6dc;border-color:#b8955a;}',
      /* 篩選列：搬進來的是核心原本那排 #combat-filter-pills（id 不變，核心的開關與存檔照舊） */
      '#lmui-flt{display:none;flex-wrap:wrap;gap:3px;padding:3px 4px;border-bottom:1px solid #3d3326;flex:none;}',
      'body.lmui-flt #lmui-flt{display:flex;}',
      '#lmui-flt #combat-filter-pills{display:flex !important;flex-wrap:wrap;gap:3px;justify-content:flex-start !important;}',
      /* ▲ 放大：聊天框吃掉整個下方面板（血條/快捷列先收起） */
      'body.lmui-chatbig #lmui-hot{display:none !important;}',   /* 血條在固定狀態列裡，放大聊天框時不收 */
      'body.lmui-chatbig #lmui-tabs .more{color:#fff6dc;border-color:#b8955a;}',
      '#lmui-lines{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:2px 5px;}',
      '#lmui-lines>*{margin:0 !important;padding:0 !important;font-size:13px !important;line-height:1.4 !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:none !important;border:0 !important;}',
      '#lmui-input{display:flex;gap:4px;align-items:center;padding:2px 3px 3px;flex:none;}',
      '#lmui-say{flex:1;min-width:0;padding:4px 8px;border:1px solid #3d3326;background:rgba(0,0,0,.6);color:#eee;font-size:17px;line-height:1.1;font-family:inherit;outline:none;}',   /* 16px：iOS 小於 16px 的輸入框一聚焦就整頁放大 */
      '#lmui-say::placeholder{color:#7d7058;font-size:14px;}',
      '#lmui-send{flex:none;padding:3px 10px;border:1px solid #2563eb;background:linear-gradient(#1e3a8a,#172554);color:#dbeafe;font-size:13px;}',
      /* 戰鬥地圖裡不用 afk-mobile 的完整日誌面板（聊天框已取代）；村莊沒有聊天框，照舊用面板 */
      'body.lmui-battle #m-log-sheet{display:none !important;}',
      '#lmui-town{flex:none;padding:3px 10px;border:1px solid #7a6440;background:linear-gradient(#5a4528,#2a1f10);color:#f0e2bf;font-size:13px;}',
      /* 經驗：導覽列正上方一條細線＋百分比 */
      '#lmui-exp{position:relative;flex:none;height:13px;margin:0 6px;background:#0b0805;border:1px solid #3d3121;border-radius:2px;overflow:hidden;}',
      '#lmui-exp span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 11px/1 Consolas,"Courier New",monospace;color:#fff;text-shadow:1px 1px 0 #000,-1px -1px 0 #000;}',
      '#lmui-exp i{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#a16207,#facc15);}',

      /* ── 右欄面板（能力/魔法/背包/設定）拉高：從頭像列下方一路到工具列，蓋住戰鬥畫面下半與血條 ──
         #game-screen（捲動區）上緣改到頭像列下方；#col-center（戰鬥）照跑，只用 clip-path 裁成頭像列那一條當底圖（不動版面，切回狩獵場不會重排）。
         #col-right 抬到 #col-center（z:1）之上；血條（#lmui-hud 裡、z 比整個 #game-screen 高）直接收起。 */
      ':root{--lmui-ptop:calc(var(--orig-bar-h,0px) + 90px);--lmui-ptabs-h:32px;}',
      'html body.lmui-battle.lmui-tall #game-screen{top:var(--lmui-ptop) !important;padding:6px 6px calc(var(--m-nav-h,0px) + 6px) !important;}',
      'html body.lmui-battle.lmui-tall.lmui-ptabs #game-screen{padding-top:calc(var(--lmui-ptabs-h) + 6px) !important;}',
      'html body.lmui-battle.lmui-tall #col-center{clip-path:inset(0 0 calc(100% - var(--lmui-ptop) + var(--orig-bar-h,0px)) 0);}',
      'html body.lmui-battle.lmui-tall #col-right{position:relative;z-index:2;}',
      'body.lmui-battle.lmui-tall #lmui-vit{display:none !important;}',
      /* 面板上方的分頁列（背包：全部/裝備/道具/自動賣出；能力：能力/裝備/…）：樣式＝狩獵場的分頁（.lm-tabs），釘在頭像列正下方 */
      '#lmui-bagtabs{display:none;position:fixed;left:6px;right:6px;top:var(--lmui-ptop);height:var(--lmui-ptabs-h);box-sizing:border-box;z-index:9550;padding:3px 2px;background:linear-gradient(#1a1612,#0b0907);border:1px solid #4a3f30;border-radius:3px 3px 0 0;}',
      'body.lmui-ptabs #lmui-bagtabs{display:flex;}',
      'body.lmui-ptabs:not(.lmui-battle) #lmui-bagtabs{top:var(--orig-bar-h,0px);}',
      'html body.lmui.lmui-ptabs:not(.lmui-battle) #col-right{padding-top:var(--lmui-ptabs-h);}',
      /* ── 背包：武器/防具/道具三個核心分頁攤平成同一片方格（分類由上方分頁列決定），每格是獨立的框（同魔法分頁的技能格） ──
         作法：#tab-content-panel 當 grid，三個分頁與其中的 shell/viewport 都 display:contents，物品格直接成為 grid 的格子；
         核心每次重繪只換掉分頁裡面的東西，這層攤平不受影響。補空格放自己的 #lmui-bagfill（排在最後）。
         壓過 afk-invlist 的條列式（body.afk-invlist … !important）→ 選擇器前面多掛 html + #tab-content-panel 拉高特異度。 */
      'body.lmui #col-right .tab-bar{display:none !important;}',
      /* 背包上方的搜尋列（afk-itemsearch）與快速廢品/快速強化工具列、整理鈕、上下捲動鈕：玩家要求拿掉（整理＝再點一次「全部」） */
      'html body.lmui-bag #afk-isearch{display:none !important;}',
      'html body.lmui-bag-grid #tab-content-panel{display:grid !important;grid-template-columns:repeat(5,minmax(0,1fr)) !important;grid-auto-rows:auto !important;gap:6px !important;align-content:start !important;padding:6px !important;height:auto !important;overflow:visible !important;}',
      'html body.lmui-bag-grid #tab-content-panel>:not(#tab-items):not(#tab-weapons):not(#tab-armors):not(#lmui-bagfill){display:none !important;}',
      'html body.lmui-bag-grid #tab-content-panel :is(#tab-items,#tab-weapons,#tab-armors,#lmui-bagfill),html body.lmui-bag-grid #tab-content-panel .classic-inventory-shell,html body.lmui-bag-grid #tab-content-panel .classic-inventory-viewport{display:contents !important;}',
      'html body.lmui-cat-weapon #tab-content-panel #tab-items,html body.lmui-cat-weapon #tab-content-panel #tab-armors,html body.lmui-cat-armor #tab-content-panel #tab-items,html body.lmui-cat-armor #tab-content-panel #tab-weapons,html body.lmui-cat-item #tab-content-panel #tab-weapons,html body.lmui-cat-item #tab-content-panel #tab-armors{display:none !important;}',
      'html body.lmui-bag-grid #tab-content-panel :is(.classic-list-toolbar,.classic-inventory-scroll,.classic-sort-wrap,.classic-grid-empty){display:none !important;}',
      '#lmui-bagfill{display:none;}',
      'html body.lmui-bag #tab-weapons .list-item{order:1;}html body.lmui-bag #tab-armors .list-item{order:2;}html body.lmui-bag #tab-items .list-item{order:3;}html body.lmui-bag #lmui-bagfill>.lmui-empty{order:4;}',
      'html body.lmui-bag #tab-content-panel .classic-inventory-viewport>.list-item,html body.lmui-bag #tab-content-panel #lmui-bagfill>.lmui-empty{position:relative;aspect-ratio:1 !important;width:auto !important;height:auto !important;min-height:0 !important;margin:0 !important;padding:0 !important;border:1px solid #6b5636 !important;border-radius:4px !important;background:linear-gradient(#2a241c,#14110d) !important;box-shadow:inset 0 0 0 1px rgba(0,0,0,.8),0 1px 2px #000 !important;display:flex !important;align-items:center !important;justify-content:center !important;overflow:hidden !important;contain-intrinsic-size:auto 70px;}',
      'html body.lmui-bag #tab-content-panel #lmui-bagfill>.lmui-empty{border-color:#2e271e !important;background:#0d0b09 !important;box-shadow:inset 0 0 6px #000 !important;}',
      'html body.lmui-bag #tab-content-panel .classic-inventory-viewport>.list-item:hover{background:linear-gradient(#3a3226,#1c1712) !important;}',
      'html body.lmui-bag #tab-content-panel .classic-inventory-viewport>.list-item.bg-red-950\\/40{background:linear-gradient(#3a1016,#1c070a) !important;border-color:#6b2a2a !important;}',
      'html body.lmui-bag #tab-content-panel .classic-inventory-viewport>.list-item:has(.classic-item-flags .text-red-500){background:linear-gradient(#3a1016,#1c070a) !important;border-color:#6b2a2a !important;}',
      'html body.lmui-bag #tab-content-panel .classic-item-main{width:100% !important;height:100% !important;display:flex !important;align-items:center !important;justify-content:center !important;gap:0 !important;flex:1 1 auto;}',
      'html body.lmui-bag #tab-content-panel .classic-name-box{display:none !important;}',
      'html body.lmui-bag #tab-content-panel .classic-icon-box{position:static !important;width:66% !important;height:66% !important;flex:0 0 auto !important;}',
      'html body.lmui-bag #tab-content-panel .classic-icon-box img{width:100% !important;height:100% !important;object-fit:contain;filter:drop-shadow(0 1px 1px #000);}',
      /* 角落數字（數量金色/強化藍色，上游配色）：afk-invlist 條列式把它藏了（數量寫在名稱裡），方格只剩圖示，要叫回來 */
      'html body.lmui-bag #tab-content-panel .classic-inventory-viewport>.list-item .classic-icon-corner-value{display:block !important;position:absolute !important;right:3px !important;bottom:2px !important;left:auto !important;top:auto !important;font-size:14px !important;background:none !important;}',
      /* 勾選框等其他子元素（快速強化/廢品模式）縮到右上角 */
      'html body.lmui-bag #tab-content-panel .classic-inventory-viewport>.list-item>:not(.classic-item-main){position:absolute !important;top:2px;right:2px;transform:scale(.85);transform-origin:top right;}',
      /* ── 背包「自動賣出」分類：核心的自動販賣規則視窗（#autosell-rule-modal）搬進面板裡就地顯示 ──
         視窗本體、草稿制（開窗拍快照、儲存才生效、離開＝還原）全部照核心；這裡只把它從滿版遮罩改成面板內容。
         標題列（標題＋Close）藏起來：離開這個分類就等於 Close。 */
      '#lmui-ashost{display:none;}',
      'html body.lmui-cat-as #tab-content-panel>:not(#lmui-ashost){display:none !important;}',
      '#lmui-bagtabs .lmui-tabicon{margin-left:4px;font-size:.9em;opacity:.8;}',
      'html body.lmui-cat-as #tab-content-panel #lmui-ashost{display:block;}',
      'html body.lmui #lmui-ashost #autosell-rule-modal{position:static !important;inset:auto !important;width:auto !important;height:auto !important;max-height:none !important;margin:0 !important;padding:0 !important;display:block !important;z-index:auto !important;background:none !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;transform:none !important;}',
      'html body.lmui #lmui-ashost #autosell-rule-modal .as-box{width:auto !important;max-width:none !important;height:auto !important;max-height:none !important;overflow:visible !important;margin:0 !important;padding:8px !important;border:0 !important;border-radius:0 !important;box-shadow:none !important;}',
      'html body.lmui #lmui-ashost #autosell-rule-modal .as-head{display:none !important;}',
      'html body.lmui #lmui-ashost #autosell-rule-modal .as-head+.as-sec{margin-top:0 !important;}',

      /* ── 怪物資訊小視窗：戰鬥畫面下緣、置中小卡片（同道具卡片的寬度/配色） ── */
      '#lmui-mobinfo{display:none;position:absolute;left:var(--lmui-pop-side);right:var(--lmui-pop-side);top:calc(var(--lmui-pop-top) - var(--lmui-bar));bottom:auto;max-height:calc(100dvh - var(--lmui-pop-top) - var(--lmui-pop-bot));z-index:8;flex-direction:column;padding:12px 12px 8px;background:linear-gradient(#211a12,#0f0b08);border:1px solid #8a6a3a;border-radius:10px;box-shadow:0 0 0 100vmax rgba(0,0,0,.55),0 10px 40px rgba(0,0,0,.9);color:#eee;text-shadow:none;}',
      'body.lmui-battle.lmui-mobinfo #lmui-mobinfo{display:flex;}',
      '.mi-hd{display:flex;align-items:baseline;gap:8px;padding-bottom:6px;border-bottom:1px solid #3d3121;}',
      '.mi-name{font-size:17px;font-weight:700;color:#fff;}',
      '.mi-name.boss{color:#f87171;}',
      '.mi-lv{font-size:14px;color:#e8b04a;}',
      '.mi-x{margin-left:auto;width:26px;height:26px;border:1px solid #5a4630;border-radius:4px;background:#1c150e;color:#d6c7a5;font-size:15px;line-height:1;cursor:pointer;}',
      '.mi-tags{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 4px;}',
      '.mi-tag{padding:1px 6px;font-size:12px;border:1px solid #4d3f2b;border-radius:3px;color:#c9b88f;background:#17120c;}',
      '.mi-tag.ele-fire{color:#fca5a5;border-color:#7f1d1d;}.mi-tag.ele-water{color:#93c5fd;border-color:#1e3a8a;}.mi-tag.ele-earth{color:#d6b98a;border-color:#5a4630;}.mi-tag.ele-wind{color:#86efac;border-color:#14532d;}',
      '.mi-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:3px 8px;font-size:13px;margin-bottom:6px;}',
      '.mi-stats span{display:flex;justify-content:space-between;gap:4px;white-space:nowrap;}',
      '.mi-stats i{font-style:normal;color:#9c8f78;}',
      '.mi-stats b{color:#fff;font-weight:600;}',
      '.mi-sub{font-size:14px;font-weight:700;color:#f0c35a;padding:4px 0;border-top:1px solid #3d3121;}',
      '.mi-sub em{font-style:normal;font-weight:400;color:#a78bfa;margin-left:4px;font-size:13px;}',
      '.mi-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}',
      '.mi-drop{display:flex;align-items:center;gap:6px;padding:4px 2px;border-bottom:1px solid rgba(90,70,48,.35);font-size:14px;}',
      '.mi-drop img{width:24px;height:24px;object-fit:contain;flex:none;}',
      '.mi-drop .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.mi-drop .rt{flex:none;color:#d6c7a5;font-family:Consolas,monospace;font-size:13px;}',
      '.mi-none{font-size:14px;color:#8d7c5c;padding:6px 0;}',

      /* ── 狩獵場（選地圖）：下半部、分頁＋清單；外觀跟戰鬥畫面的聊天框同一套（小分頁、半透明黑底、細分隔線） ── */
      '#lmui-maps{display:none;position:absolute;left:0;right:0;top:calc(var(--lmui-mtop) - var(--orig-bar-h,0px));bottom:0;z-index:6;flex-direction:column;padding:4px 4px 2px;background:linear-gradient(#1a1612,#0b0907);border-top:1px solid #4a3f30;}',
      'body.lmui-battle.lmui-maps #lmui-maps{display:flex;}',
      'body.lmui-battle.lmui-maps #lmui-bottom{display:none !important;}',
      '.lm-tabs{display:flex;gap:2px;padding:2px 2px 0;flex:none;}',
      '.lm-tabs button{flex:1;padding:3px 0;font-size:13px;font-family:inherit;color:#c9b88f;background:linear-gradient(#3b3022,#1c160e);border:1px solid #4d3e29;border-radius:2px;}',
      '.lm-tabs button.on{color:#fff6dc;background:linear-gradient(#7a5f35,#3f2f18);border-color:#b8955a;}',
      '.lm-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;margin-top:3px;padding:0 4px;background:rgba(0,0,0,.5);}',
      '.lm-row{display:flex;align-items:center;justify-content:space-between;width:100%;padding:8px 6px;text-align:left;font-family:inherit;background:transparent;border:0;border-bottom:1px solid rgba(90,70,48,.45);color:#eee;cursor:pointer;text-shadow:0 1px 1px #000;}',
      '.lm-row .nm{font-size:15px;}',
      '.lm-row .rt{font-size:13px;color:#9c8f78;}',
      '.lm-row.cur{background:linear-gradient(90deg,rgba(122,95,53,.55),rgba(63,47,24,.15));}',
      '.lm-row.cur .nm{color:#fff6dc;font-weight:700;}',
      '.lm-row.off{opacity:.4;cursor:not-allowed;}',
      '.lm-row:not(.off):active{background:rgba(122,95,53,.35);}',

      /* ── 村莊：跟戰鬥一樣上下兩塊。上半＝上游村莊地圖（NPC 站位是百分比，放大鋪滿也對得上），下半＝NPC 卡片兩欄 ──
         村莊時 body 同時帶 lmui-battle（共用上下分割、HUD、狀態列、彈窗下移）＋ lmui-town（村莊專屬）。
         NPC 清單是 afk-npclist 的 #afk-npclist，整塊 fixed 到下半部（它在 #col-center 裡，fixed 不受外層裁切）。 */
      /* :not(.hidden) 要帶上：afk-npclist 的 body.afk-npclist #town-view:not(.hidden){height:auto;min-height:200px} 特異度比較高 */
      'html body.lmui-town #town-view:not(.hidden){display:block !important;position:absolute !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;width:100% !important;height:100% !important;min-height:0 !important;padding:0 !important;margin:0 !important;gap:0 !important;flex:none !important;align-self:stretch !important;}',
      'html body.lmui-town #town-name,html body.lmui-town #town-view>p{display:none !important;}',
      'html body.lmui-town #town-npc-map{display:block !important;position:absolute !important;inset:0 !important;width:100% !important;height:100% !important;max-width:none !important;aspect-ratio:auto !important;margin:0 !important;border:0 !important;border-radius:0 !important;background-size:cover !important;background-position:center !important;box-shadow:inset 0 0 120px 40px rgba(0,0,0,.75) !important;}',
      'html body.lmui-town #afk-npclist{display:grid !important;position:fixed !important;top:var(--lmui-mtop) !important;bottom:var(--m-nav-h,0px) !important;left:0 !important;right:0 !important;width:auto !important;height:auto !important;max-height:none !important;margin:0 !important;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:max-content !important;gap:6px;align-content:start;padding:8px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:linear-gradient(rgba(23,18,13,.97),rgba(11,9,7,.98));z-index:5;}',
      /* NPC 卡片只屬於「狩獵場（戰鬥）」那一頁：切到背包/素質/設定時收起，不然會蓋在那些頁面上 */
      'html body.lmui-town:not(.mview-center) #afk-npclist,html body.lmui-town.lmui-townchat #afk-npclist{display:none !important;}',
      'html body.lmui-town #afk-npclist .afk-npcl-row{display:block !important;min-width:0 !important;overflow:visible !important;width:auto !important;height:auto !important;max-height:none !important;line-height:1.35 !important;min-height:0 !important;margin:0 !important;padding:7px 9px !important;text-align:left !important;background:rgba(30,22,14,.85) !important;border:1px solid #5a4630 !important;border-radius:6px !important;box-shadow:inset 0 1px 0 rgba(255,220,150,.06),0 1px 3px rgba(0,0,0,.6) !important;}',
      'html body.lmui-town #afk-npclist .afk-npcl-row:active{background:rgba(60,44,26,.9) !important;}',
      'html body.lmui-town #afk-npclist .afk-npcl-ico{display:none !important;}',
      'html body.lmui-town #afk-npclist .afk-npcl-main{display:block !important;min-width:0;}',
      'html body.lmui-town #afk-npclist .afk-npcl-main>span:first-child{display:block;}',
      'html body.lmui-town #afk-npclist .afk-npcl-name{display:inline !important;font-size:16px !important;font-weight:700 !important;color:#fff !important;}',
      'html body.lmui-town #afk-npclist .lmui-npc-emo{margin-right:4px;font-size:15px;}',
      'html body.lmui-town #afk-npclist .afk-npcl-title{display:block !important;margin:1px 0 0 !important;font-size:13px !important;color:#e8b04a !important;}',
      'html body.lmui-town #afk-npclist .afk-npcl-title[data-lmui-br]::before{content:"[";}',
      'html body.lmui-town #afk-npclist .afk-npcl-title[data-lmui-br]::after{content:"]";}',
      'html body.lmui-town #afk-npclist .afk-npcl-desc{display:block !important;margin-top:2px;font-size:13px !important;color:#bfb3a0 !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      /* NPC 對話/商店：蓋在 NPC 卡片上、同一塊下半部 */
      /* 浮動大視窗：頭像列下方到工具列上方、左右留邊、圓角金框；外圍用超大陰影把其他畫面壓暗。
         村莊沒有戰鬥畫面要避開，可以蓋過上半部的村莊地圖。開著時 HUD（頭像列/狀態列）先收起來（它在 body 層會疊到視窗上）。 */
      'html body.lmui-town #town-interaction-container:not(.hidden){position:fixed !important;top:var(--lmui-pop-top) !important;bottom:auto !important;left:var(--lmui-pop-side) !important;right:var(--lmui-pop-side) !important;width:auto !important;height:auto !important;max-height:calc(100dvh - var(--lmui-pop-top) - var(--lmui-pop-bot)) !important;margin:0 !important;transform:none !important;border-radius:10px !important;border:1px solid #8a6a3a !important;background:linear-gradient(#1f1912,#0e0b08) !important;box-shadow:0 0 0 100vmax rgba(0,0,0,.55),0 10px 40px rgba(0,0,0,.9) !important;z-index:20 !important;}',
      'body.lmui-npcwin #lmui-hud>:not(#lmui-tl):not(#lmui-tr):not(#lmui-vit){display:none !important;}',
      'body.lmui-town.town-int-open #lmui-hud>:not(#lmui-tl):not(#lmui-tr):not(#lmui-vit){display:none !important;}',   // 同上，開的當下就收（不等 tick）
      /* 不顯示的 NPC（龍鑽收購、傭兵公會）：卡片與地圖都藏 */
      'html body.lmui-town .lmui-npc-off,html body.lmui-town #afk-npclist .afk-npcl-row.lmui-npc-off{display:none !important;}',
      /* NPC 對話標題：金色「名字（職稱）」＋右邊金幣 */
      'html body.lmui-town #interaction-npc-name{color:#e8b04a !important;font-size:19px !important;}',
      'html body.lmui-town #interaction-npc-title{color:#e8b04a !important;font-size:17px !important;font-weight:700;margin-left:2px;}',
      '#lmui-ihead-gold{margin-left:auto;margin-right:10px;color:#f5d77b;font-weight:700;font-size:17px;white-space:nowrap;}',
      /* 製作清單（一列＝圖示＋名稱＋材料接成一行＋數量＋按鈕） */
      /* 一列拆兩行：上＝圖示/名稱/材料，下＝數量＋按鈕靠右（視窗窄時材料字才不會被按鈕蓋住） */
      'html body.lmui-town #interaction-content .list-item{flex-wrap:wrap !important;row-gap:6px !important;padding:8px !important;margin-bottom:6px !important;gap:8px;background:rgba(26,20,14,.92) !important;border:1px solid #4a3c29 !important;border-radius:6px !important;}',
      'html body.lmui-town #interaction-content .list-item>div:first-child{gap:10px !important;}',
      'html body.lmui-town #interaction-content .list-item .w-12.h-12{width:44px !important;height:44px !important;background:#0f0b08 !important;border-color:#4a3c29 !important;}',
      'html body.lmui-town #interaction-content .list-item .w-12.h-12 img{width:38px !important;height:38px !important;}',
      'html body.lmui-town #interaction-content .list-item .text-lg{font-size:17px !important;}',
      'html body.lmui-town #interaction-content .list-item .flex-wrap{display:block !important;font-size:14px !important;line-height:1.5 !important;color:#c9bfae;}',
      'html body.lmui-town #interaction-content .list-item .flex-wrap>span{display:inline !important;font-size:14px !important;font-weight:400 !important;margin:0 !important;line-height:1.5 !important;}',
      'html body.lmui-town #interaction-content .list-item .flex-wrap>span.text-slate-400:first-child{display:none !important;}',
      'html body.lmui-town #interaction-content .list-item .flex-wrap>span.text-slate-500{margin:0 4px !important;color:#7d8f5a !important;}',
      'html body.lmui-town #interaction-content .list-item .flex-wrap .text-red-400{color:#f87171 !important;font-weight:700;}',
      'html body.lmui-town #interaction-content .list-item .flex-wrap .text-green-400{color:#4ade80 !important;font-weight:700;}',
      'html body.lmui-town #interaction-content .list-item>div:first-child{flex:1 1 100% !important;min-width:0 !important;}',
      'html body.lmui-town #interaction-content .list-item>div:last-child{flex:1 1 100% !important;justify-content:flex-end !important;}',
      'html body.lmui-town #interaction-content .list-item input[type="number"]{width:52px !important;padding:5px 2px !important;}',
      /* 標題列不換行：名字（職稱）｜金幣｜關閉 */
      'html body.lmui-town #town-interaction-header{flex-wrap:nowrap !important;gap:6px;}',
      'html body.lmui-town #town-interaction-heading{min-width:0;overflow:hidden;white-space:nowrap;}',
      'html body.lmui-town #town-interaction-close{flex:none;padding:4px 10px !important;}',
      'html body.lmui-town #interaction-content .list-item .btn{padding:8px 10px !important;font-size:15px !important;white-space:nowrap;}',
      'html body.lmui-town #interaction-content .list-item .btn.lmui-nomat{background:#2b2b31 !important;border-color:#45454d !important;color:#8b8b94 !important;cursor:not-allowed;box-shadow:none !important;}',
      /* 村莊的下半部給 NPC 卡片；按「聊天」才把聊天框叫出來（lmui-townchat） */
      'body.lmui-town:not(.lmui-townchat) #lmui-bottom{display:none !important;}',
      'body.lmui-town.lmui-townchat #lmui-bottom{display:flex !important;}',

      /* ── 裝備分頁（紙娃娃）：上游嵌入式裝備視窗與 afk-eqlist 的清單都先藏起來，改顯示 #lmui-doll ── */
      '#lmui-doll{display:none;}',
      'html body.lmui-equip #lmui-doll{display:block;padding:6px 8px 8px;background:radial-gradient(ellipse at 50% 40%,#2a2a2a,#121212 75%);border:1px solid #4a4a4a;border-radius:4px;box-shadow:inset 0 0 18px #000;}',
      'html body.lmui-equip #tab-equip,html body.lmui-equip #equipment-window{display:none !important;}',
      '.ld-weight{font-size:14px;color:#cfcfcf;}',
      /* 格子邊長跟著面板可用高度走（5 排＋底排＝6 列，扣掉上方分頁列/負重字/間距約 150px），上限 64px，盡量一屏放完不用捲 */
      '#lmui-doll{--ld-c:clamp(36px,calc((100dvh - var(--lmui-ptop) - var(--m-nav-h,0px) - var(--lmui-ptabs-h) - 120px) / 6),64px);}',
      '.ld-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}',
      '.ld-head .ld-weight{margin:0 !important;}',
      '.ld-grid{display:grid;grid-template-columns:repeat(3,var(--ld-c));justify-content:center;gap:6px calc(var(--ld-c) * .45);}',
      '.ld-bottom{display:grid;grid-template-columns:repeat(4,var(--ld-c));justify-content:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #333;}',
      '.ld-cell{position:relative;aspect-ratio:1;border:1px solid #5c5c5c;border-radius:3px;background:radial-gradient(circle at 50% 40%,#2c2c2c,#0e0e0e 75%);box-shadow:inset 0 0 0 1px #000,inset 0 0 10px rgba(0,0,0,.9),0 1px 2px #000;display:flex;align-items:center;justify-content:center;cursor:pointer;}',
      '.ld-cell img{width:78%;height:78%;object-fit:contain;filter:drop-shadow(0 1px 2px #000);}',
      '.ld-cell.is-empty{cursor:default;color:rgba(255,255,255,.16);}',
      '.ld-cell.is-empty svg{width:62%;height:62%;}',
      '.ld-en{position:absolute;right:2px;bottom:1px;font:800 13px/1 Arial,sans-serif;color:#39a9ff;text-shadow:0 0 3px #0b4f99,1px 1px 1px #000;}',
      '.ld-cnt{position:absolute;right:2px;bottom:1px;font:800 13px/1 Arial,sans-serif;color:#d5a94f;text-shadow:1px 1px 1px #000;}',
      '.ld-tabs{display:flex;gap:3px;}',
      '.ld-tabs button{flex:0 0 44px;height:26px;display:flex;align-items:center;justify-content:center;border:1px solid #4a4a4a;border-radius:3px;background:linear-gradient(#3a3a3a,#1a1a1a);color:#8f8f8f;}',
      '.ld-tabs button svg{width:18px;height:18px;}',
      '.ld-tabs button.on{color:#f2f2f2;background:linear-gradient(#5e5e5e,#2a2a2a);border-color:#8a8a8a;}',

      /* ── 技能分頁（攤開清單）：金色分區標題、每階一列（左標籤＋右 4 格銅框） ── */
      '.lsk{padding:6px 4px 10px;background:#110e0b;color:#e8d9b0;}',
      '.lsk-sec{margin:8px 0 6px;padding-left:8px;border-left:3px solid #d4a24a;color:#f0c35a;font-size:16px;font-weight:700;}',
      '.lsk-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;}',
      '.lsk-lb{flex:0 0 52px;display:flex;flex-direction:column;align-items:center;line-height:1.25;}',
      '.lsk-lb b{color:#f0c35a;font-size:15px;}',
      '.lsk-lb small{color:#c9a96a;font-size:12px;}',
      '.lsk-grid{flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}',
      '.lsk-cell{position:relative;aspect-ratio:1;border:1px solid #6b5636;border-radius:4px;background:linear-gradient(#2a241c,#14110d);box-shadow:inset 0 0 0 1px rgba(0,0,0,.8),0 1px 2px #000;display:flex;align-items:center;justify-content:center;padding:4px;cursor:pointer;}',
      '.lsk-cell img{width:100%;height:100%;object-fit:contain;border-radius:2px;}',
      '.lsk-cell.is-empty{border-color:#2e271e;background:#0d0b09;box-shadow:inset 0 0 6px #000;cursor:default;}',
      /* 沒學過＝暗色：圖片去色壓暗，再蓋一層黑（別處有通用的 img 濾鏡規則會蓋掉單純的 filter，故帶 #tab-skill + !important） */
      '#tab-skill .lsk-cell.is-unlearned img{filter:grayscale(1) brightness(.35) !important;}',
      '#tab-skill .lsk-cell.is-unlearned::after{content:"";position:absolute;inset:0;border-radius:3px;background:rgba(0,0,0,.45);pointer-events:none;}',
      '#tab-skill .lsk-cell.is-unlearned{border-color:#3a3023;}',
      '#tab-skill .lsk-cell.is-off img{filter:brightness(.6) !important;}',
      '.lsk-foot{display:flex;justify-content:space-around;margin-top:10px;padding-top:8px;border-top:1px solid #3a3024;font-size:14px;color:#c9a96a;}',
      '.lsk-foot b{color:#fff;margin-left:4px;}',

      /* ── 道具視窗：小卡片（寬 ~300、高度跟內容、按鈕兩欄），不再整頁蓋住 ──
         上緣沿用 afk-mobile 的 top:calc(8px + var(--orig-bar-h))（戰鬥時 --orig-bar-h 已換成場景下緣）；
         這裡只改寬度/高度/置中與內部密度。#modal-compare（裝備比對）照樣排在卡片上方，一起在卡片裡捲。 */
      'html body.lmui #item-modal:not(.hidden){top:var(--lmui-pop-top) !important;bottom:auto !important;left:var(--lmui-pop-side) !important;right:var(--lmui-pop-side) !important;width:auto !important;transform:none !important;height:auto !important;max-height:calc(100dvh - var(--lmui-pop-top) - var(--lmui-pop-bot)) !important;overflow-y:auto !important;flex-direction:column !important;align-items:stretch !important;gap:6px !important;padding:8px !important;background:linear-gradient(#1f1912,#0e0b08) !important;border:1px solid #8a6a3a !important;border-radius:10px !important;box-shadow:0 0 0 100vmax rgba(0,0,0,.55),0 10px 40px rgba(0,0,0,.9) !important;}',
      'html body.lmui #item-modal>.panel{min-width:0 !important;max-width:none !important;width:100% !important;max-height:none !important;padding:12px !important;margin:0 !important;box-shadow:none !important;}',
      'html body.lmui #modal-item-name{font-size:18px !important;margin-bottom:8px !important;padding-bottom:8px !important;}',
      'html body.lmui #modal-item-name img{width:28px !important;height:28px !important;}',
      'html body.lmui #modal-item-desc{font-size:15px !important;line-height:1.55 !important;min-height:0 !important;margin-bottom:10px !important;}',
      'html body.lmui #modal-item-desc .class-eq-icon{width:16px !important;height:16px !important;}',
      'html body.lmui #modal-actions{grid-template-columns:1fr 1fr !important;gap:6px !important;}',
      'html body.lmui #modal-actions>*{grid-column:auto !important;width:auto !important;min-height:0 !important;padding:7px 4px !important;font-size:15px !important;line-height:1.3 !important;}',
      'html body.lmui #item-modal .panel>button.mt-5{margin-top:8px !important;padding:7px !important;font-size:16px !important;}',
      'html body.lmui #item-modal>.panel{overflow:visible !important;height:auto !important;}',   // 整張卡片一起捲，不要卡片裡面各自再一條捲軸
      'html body.lmui #modal-compare{font-size:14px !important;}',
      'html body.lmui #modal-compare>*{font-size:14px !important;}',
      /* 裝備比對預設收起，按「與身上比較」才展開（參考圖的做法；上游手機是一律攤開在卡片上方，佔掉半張） */
      'html body.lmui:not(.lmui-cmp) #modal-compare{display:none !important;}',
      'html body.lmui #lmui-cmp-btn{grid-column:1 / -1 !important;border:1px solid #3b82f6 !important;background:rgba(30,41,59,.85) !important;color:#bfdbfe !important;border-radius:6px;font-weight:700;}',
      'html body.lmui.lmui-cmp #lmui-cmp-btn{background:#1e3a8a !important;color:#fff !important;}',

      /* ── 底部工具列（經典天堂暗色那排：黑底、銀色金屬圖示；手機遊戲畫面一律套） ── */
      'body.lmui #m-nav{background:linear-gradient(#2b2b2b,#141414 45%,#0a0a0a) !important;border-top:1px solid #5a5a5a !important;box-shadow:0 -2px 6px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.08);position:fixed;}',
      'body.lmui #m-nav>.m-nav-btn{display:none !important;}',
      /* 工具列＝純文字按鈕（玩家要求「直接顯示文字」）：選中的那格金底深字，其他淺色字；圖示保留在 DOM 但不顯示 */
      '#lmui-nav{display:flex;flex:1;align-items:stretch;gap:2px;padding:3px 2px 12px;}',
      '.lmui-tool{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;padding:10px 0;background:transparent;border:1px solid transparent;border-radius:3px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;font-family:inherit;}',
      '.lmui-tool svg{display:none;}',
      '.lmui-tool span{font-size:16px;font-weight:600;color:#d8cbb0;white-space:nowrap;letter-spacing:.5px;text-shadow:0 1px 1px #000;}',
      '.lmui-tool:active{background:rgba(255,255,255,.08);}',
      '.lmui-tool.on{background:linear-gradient(#e7c56f,#a8822f);border-color:#f0d58c;box-shadow:inset 0 1px 0 rgba(255,250,220,.5),0 0 6px rgba(231,197,111,.35);}',
      '.lmui-tool.on span{color:#1d1407;font-weight:700;text-shadow:none;}',
      /* 經驗 % 已移到狀態列的經驗條裡，這裡不再重複顯示 */
      'body.lmui-battle #lmui-navexp{display:none;}',
      '#lmui-navexp{position:absolute;left:0;right:0;bottom:1px;text-align:center;font-size:12px;font-weight:700;color:#bdbdbd;pointer-events:none;}'
    ].join('\n');
    css += '\n' + themeCSS();
    var s = document.createElement('style');
    s.id = 'afk-lmui-style';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // ── 全介面配色：把上游/各外掛的灰藍（Tailwind slate）換成天堂M的深褐＋銅框 ──
  //   只換「中性底色/邊框」：slate 那組（上游幾乎所有面板、輸入框、預設按鈕都是它）＋幾個外掛自己寫死的灰藍元件。
  //   有自己顏色的按鈕（紅/金/紫…）不動。class 用 [class~="…"] 精確比對整個 token —— 子字串比對會連
  //   「hover:bg-slate-700」一起中，把本來是琥珀色的按鈕永遠刷成褐色。
  function themeCSS() {
    var S = 'html body.lmui ';
    var OP = ['', '/10', '/20', '/30', '/40', '/50', '/60', '/70', '/75', '/80', '/90', '/95'];
    function tok(prefix, shades) {
      var out = [];
      shades.forEach(function (sh) { OP.forEach(function (o) { out.push(S + '[class~="' + prefix + sh + o + '"]'); }); });
      return out.join(',');
    }
    var BG = '#0f0b08', BG1 = '#18120d', BG2 = '#241b13', BG3 = '#31261a', BD = '#4a3c29', BD2 = '#6b5636', TX = '#ecdcb6';
    return [
      tok('bg-slate-', ['950', '900']) + '{background-color:rgba(15,11,8,.94) !important;}',
      tok('bg-slate-', ['800']) + '{background-color:rgba(26,20,14,.95) !important;}',
      tok('bg-slate-', ['700']) + '{background-color:' + BG3 + ' !important;}',
      tok('bg-slate-', ['600']) + '{background-color:#3d3022 !important;}',
      tok('border-slate-', ['500', '600', '700', '800']) + '{border-color:' + BD + ' !important;}',
      /* 面板（上游 .panel 是灰藍漸層）。戰鬥框那塊 #map-view-panel 另有更高優先的「去框」規則，不受影響 */
      S + '.panel{background:linear-gradient(' + BG1 + ',' + BG + ') !important;border-color:' + BD + ' !important;box-shadow:inset 0 1px 0 rgba(255,220,150,.06),0 2px 8px rgba(0,0,0,.6) !important;}',
      S + '.panel-header{border-color:' + BD + ' !important;}',
      S + '.log-bg{background:' + BG + ' !important;}',
      /* 預設按鈕（沒有自己的底色 class、也沒有內聯底色的那種） */
      S + '.btn:not([class*="bg-"]):not([style*="background"]){background:linear-gradient(#4a3a26,#271d12) !important;border-color:#7a6440 !important;color:#f0e2bf !important;}',
      /* 中性灰藍的按鈕（bg-slate-*）：.btn 自帶漸層會蓋過單純的 background-color → 整個 background 換掉 */
      S + '.btn[class~="bg-slate-700"],' + S + '.btn[class~="bg-slate-800"],' + S + '.btn[class~="bg-slate-600"]{background:linear-gradient(#4a3a26,#271d12) !important;border-color:#7a6440 !important;color:#f0e2bf !important;}',
      /* 村莊 NPC 條列（afk-npclist）、世界頻道輸入列（日誌面板裡） */
      S + '.afk-npcl-row{background:linear-gradient(' + BG2 + ',' + BG1 + ') !important;border-color:' + BD + ' !important;}',
      S + '#world-input-row{background:' + BG1 + ' !important;border-color:' + BD + ' !important;}',
      S + '#world-send{background:linear-gradient(#4a3a26,#271d12) !important;border-color:#7a6440 !important;color:#f0e2bf !important;}',
      /* afk-toast 提示、afk-mobile 登出確認窗的遮罩與分隔線 */
      S + '.m-toast{background:rgba(20,15,10,.95) !important;border-color:' + BD2 + ' !important;color:' + TX + ' !important;}',
      S + '#m-logout-modal{background:rgba(8,6,4,.7) !important;}',
      S + '#m-logout-hr{border-top-color:' + BD + ' !important;}',
      /* 輸入框/下拉/勾選/滑桿 */
      S + 'input[type="text"],' + S + 'input[type="number"],' + S + 'input[type="search"],' + S + 'select,' + S + 'textarea{background-color:' + BG + ' !important;border-color:#5a4a33 !important;color:' + TX + ' !important;}',
      S + 'input[type="checkbox"],' + S + 'input[type="radio"],' + S + 'input[type="range"]{accent-color:#c9a25a;}',
      /* 角色素質：六圍方塊、能力值來源（afk-statpts） */
      S + '.ability-primary-control{background:' + BG1 + ' !important;border-color:' + BD + ' !important;}',
      S + '.afk-stpts{background:rgba(15,11,8,.7) !important;border-color:' + BD + ' !important;}',
      S + '.afk-stpts-row{border-color:rgba(74,60,41,.6) !important;}',
      S + '.m-bav-entrybtn{background:' + BG2 + ' !important;border-color:' + BD + ' !important;}',
      S + '.ability-detail-column{background:rgba(15,11,8,.75) !important;border-color:' + BD + ' !important;}',
      S + '#afk-isearch{background:' + BG1 + ' !important;border-color:' + BD + ' !important;}',
      /* 戰鬥畫面裡的小東西：狀態圖示的底、怪物血條的底槽（核心內聯 background:#475569） */
      S + '.status-icon{background-color:#120d09 !important;}',
      S + '.mob-hp-bar>div{background:#1c0b08 !important;box-shadow:0 0 0 1px #000;}',
      /* 左上角「外掛」入口（逃生門，afk-toggles）：只換顏色，位置/大小/可點性完全不動 */
      S + '#afk-toggles-entry{background:linear-gradient(#3a2d1d,#1d150d) !important;border-color:' + BD2 + ' !important;color:#f0e2bf !important;}',
      /* 「外掛」入口按鈕：玩家要求登入畫面與遊戲中都不顯示（不帶 body.lmui 前綴＝登入畫面也藏）。
         ⚠️ 這是外掛開關面板唯一的入口（逃生門）：藏了之後玩家無法自行關掉出問題的外掛。
            要叫出面板：主控台執行 AFK_TOGGLES.openPanel()；或在外掛面板外把本檔關掉後按鈕就回來。 */
      '#afk-toggles-entry{display:none !important;}',
      /* afk-mobile / afk-battlehud 的元件（村莊裡還看得到） */
      S + '#m-status{background:linear-gradient(#211a12,#120d09) !important;border-color:' + BD + ' !important;}',
      S + '#m-log-sheet{background:#110d09 !important;border-top-color:' + BD2 + ' !important;}',
      S + '#m-log-hd{border-bottom-color:#3a3024 !important;color:' + TX + ' !important;}',
      S + '#m-log-hd button{background:' + BG2 + ' !important;border-color:#5a4a33 !important;color:' + TX + ' !important;}',
      S + '#m-logout-card{background:#15100b !important;border-color:#5a4a33 !important;}',
      S + '.m-logout-slot{background:' + BG2 + ' !important;border-color:' + BD + ' !important;}',
      S + '.m-logout-slot-go,' + S + '#m-logout-cancel{background:' + BG3 + ' !important;border-color:#5a4a33 !important;color:' + TX + ' !important;}'
    ].join('\n');
  }

  // ── HUD DOM ─────────────────────────────────────────────
  var hud = null, el = {}, slots = [], chatTab = 'sys';
  function build() {
    hud = document.createElement('div');
    hud.id = 'lmui-hud';
    var hot = '';
    for (var i = 0; i < HOT_SLOTS; i++) hot += '<button type="button" class="lmui-slot lmui-hit ' + (i < HOT_ROW ? 'r1' : 'r2') + '" data-i="' + i + '"><span class="fk">F' + (i + 1) + '</span><span class="n"></span><span class="cd"></span></button>';
    hot += '<button type="button" id="lmui-hotmode" class="lmui-hit" aria-label="切換快捷列"></button>';
    hud.innerHTML =
      '<div id="lmui-tl">' +
        '<div id="lmui-face"><div class="pic lmui-hit" role="button" aria-label="裝備欄"><img alt=""></div><button type="button" id="lmui-buffbtn" class="lmui-hit" aria-label="狀態圖示">≫</button></div>' +
        '<div id="lmui-stats">' +
          '<div class="row"><button type="button" id="lmui-name" class="lmui-hit"></button><span id="lmui-lv"></span></div>' +
          '<div class="row"><span><span class="k">AC</span><b id="lmui-ac"></b></span><span><span class="k">MR</span><b id="lmui-mr"></b></span><span id="lmui-align"><span class="k"></span><b></b></span></div>' +
          '<div class="row"><span id="lmui-gold"><span class="k">💰</span><b></b></span></div>' +
        '</div>' +
      '</div>' +
      '<div id="lmui-tr">' +
        '<button type="button" id="lmui-mapname" class="lmui-hit"><b></b><small></small></button>' +
        '<button type="button" id="lmui-mini" class="lmui-hit" aria-label="地圖"><span class="moon">🌙</span><i class="me" style="left:50%;top:50%"></i></button>' +
      '</div>' +
      /* 狀態列：血條/魔力條（AUTO 壓在中間圓章上）＋經驗條，釘在戰鬥畫面下緣，任何分頁都在 */
      '<div id="lmui-vit">' +
        '<div id="lmui-comp"></div><div id="lmui-comp-pop" class="hidden"></div>' +
        '<div id="lmui-bars"><div id="lmui-hp" class="lmui-bar"><i></i><span></span></div><div id="lmui-mp" class="lmui-bar"><i></i><span></span></div>' +
          '<button type="button" id="lmui-auto" class="lmui-hit">AUTO</button></div>' +
        '<div id="lmui-exp"><i></i><span></span></div>' +
      '</div>' +
      '<div id="lmui-bottom">' +
        '<div id="lmui-hot" data-mode="0">' + hot + '</div>' +
        '<div id="lmui-chat" class="lmui-hit">' +
          '<div id="lmui-tabs"><button type="button" class="more" data-t="big" aria-label="放大聊天框">▲</button><button type="button" data-t="sys">一般</button><button type="button" data-t="world">世界</button><button type="button" data-t="combat">戰鬥</button><button type="button" data-t="drop">掉落</button><button type="button" class="flt" data-t="filter">篩選</button></div>' +
          '<div id="lmui-flt"></div>' +
          '<div id="lmui-lines"></div>' +
          '<div id="lmui-input"><input id="lmui-say" type="text" maxlength="60" autocomplete="off" enterkeyhint="send" placeholder="向世界頻道發問"><button type="button" id="lmui-send">發送</button><button type="button" id="lmui-town">回村</button></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hud);

    ['ac', 'mr', 'lv', 'hp', 'mp', 'exp', 'align', 'gold', 'mapname', 'mini', 'lines', 'tabs', 'name'].forEach(function (k) { el[k] = $('lmui-' + k); });
    if (el.name) el.name.addEventListener('click', function (e) { e.stopPropagation(); startLmuiRename(); });
    bindCompanions();
    el.face = hud.querySelector('#lmui-face img');
    hud.querySelector('#lmui-face .pic').addEventListener('click', toggleEquipWin);
    slots = Array.prototype.slice.call(hud.querySelectorAll('.lmui-slot')).map(function (b) {
      return { el: b, key: '', kind: null, id: null, uid: null, img: null, cd: b.querySelector('.cd'), n: b.querySelector('.n') };
    });

    el.mapname.addEventListener('click', function () { closeAllWindows(); toggleMaps(); });
    el.mini.addEventListener('click', toggleMap);
    $('lmui-buffbtn').addEventListener('click', function () { document.body.classList.toggle('lmui-nobuff'); });
    $('lmui-auto').addEventListener('click', function () {
      var p = !isPaused(); setPaused(p);
      try { logSys(p ? '⏸ 已暫停，再按一次 AUTO 繼續' : '▶ 自動戰鬥繼續'); } catch (e) {}
    });
    $('lmui-town').addEventListener('click', function (e) { e.stopPropagation(); try { returnToTown(); } catch (err) { console.warn('[AFK-lmui] 回村失敗', err); } });
    el.tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-t]'); if (!b) return;
      e.stopPropagation();
      var t = b.getAttribute('data-t');
      if (t === 'big') { document.body.classList.toggle('lmui-chatbig'); return; }
      if (t === 'filter') { toggleFilter(); return; }
      chatTab = t; lastChatSig = ''; renderChat(true);
    });
    $('lmui-send').addEventListener('click', sendWorld);
    $('lmui-say').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendWorld(); } });
    // 捲回最底時，把捲上去那段期間累積的新訊息補上
    el.lines.addEventListener('scroll', function () { if (chatDirty && linesAtBottom()) { chatDirty = false; renderChat(); } }, { passive: true });
    bindHot();
  }

  // ── 按鈕動作（全部是遊戲既有功能）──────────────────────
  // ── AUTO＝暫停／繼續 ──────────────────────────────────
  // 暫停＝核心 tick 整個不跑（怪物、回血、增益倒數一起凍結），不是「人站著被打」。
  //   狀態按角色存 localStorage（my_autopause_<slot>）→ 重開遊戲照樣暫停；
  //   afk-offline 讀同一個鍵（且本外掛開著）時不結算離線收益——暫停中關掉瀏覽器不該還在掛機賺。
  //   本外掛被關掉時 wrapper 透明放行，暫停自然失效（按鈕也不在了，不能留一個解不開的暫停）。
  function pauseKey() { return 'my_autopause_' + (typeof currentSlot !== 'undefined' ? currentSlot : ''); }
  function isPaused() { try { return localStorage.getItem(pauseKey()) === '1'; } catch (e) { return false; } }
  function setPaused(v) {
    try { if (v) localStorage.setItem(pauseKey(), '1'); else localStorage.removeItem(pauseKey()); } catch (e) {}
    renderAuto();
  }
  function renderAuto() { var b = $('lmui-auto'); if (b) b.classList.toggle('off', hasP() && isPaused()); }
  function hookPause() {
    if (typeof window.tick !== 'function') { console.warn('[AFK-lmui] 找不到核心 tick，AUTO 暫停停用。'); return; }
    var _origTick = window.tick;
    window.tick = function () {
      if (on() && hasP() && isPaused()) return;
      return _origTick.apply(this, arguments);
    };
    setInterval(renderAuto, 500);
  }

  function navBtn(view) { var n = $('m-nav'); return n ? n.querySelector('.m-nav-btn[data-view="' + view + '"]') : null; }
  function openRightTab(btnId) {
    var nb = navBtn('right'); if (nb) nb.click();
    var b = $(btnId); if (b) b.click();
  }
  function toggleMap() { document.body.classList.toggle('lmui-map'); }
  function closeMap() { document.body.classList.remove('lmui-map'); }
  function aliveIdx() {
    var out = [];
    if (typeof mapState === 'undefined' || !mapState || !mapState.mobs) return out;
    for (var i = 0; i < mapState.mobs.length; i++) { var m = mapState.mobs[i]; if (m && !m._dead) out.push(i); }
    return out;
  }
  function useSlot(s) {
    if (!s.kind) { openHotPick(slots.indexOf(s)); return; }   // 空格：直接打開設定
    if (s.kind === 'skill') {
      var sk = DB.skills[s.id];
      try { if (sk && sk.type === 'manual') manualCast(s.id); else if (typeof castSkill === 'function') castSkill(s.id); } catch (e) { console.warn('[AFK-lmui] 施放失敗', e); }
    }
    else if (s.kind === 'item') { var u = s.uid || hotItemUid(s.id); if (u) { try { useItem(u); } catch (e) { console.warn('[AFK-lmui] 使用道具失敗', e); } } }
  }

  // ── 快捷列自訂（F1~F12）──────────────────────────────
  //   player.lmHot＝12 格 [{k:'skill'|'item', id}|null]，跟著角色存檔；沒設過＝照舊自動排（手動技能→藥水/瞬移卷軸，只排前 6 格）。
  //   第一次指定任一格時，把當下自動排好的那 6 格抄進來再改，畫面不會突然跳掉。
  function hotCustom() { return hasP() && Array.isArray(player.lmHot) ? player.lmHot : null; }
  function hotItemUid(id) {
    if (!hasP() || !player.inv) return null;
    var best = null;
    player.inv.forEach(function (it) { if (it && it.id === id && (+it.cnt || 0) > 0 && (!best || (best.lock && !it.lock))) best = it; });
    return best ? best.uid : null;
  }
  function hotItemCount(id) {
    var n = 0;
    if (hasP() && player.inv) player.inv.forEach(function (it) { if (it && it.id === id) n += (+it.cnt || 0); });
    return n;
  }
  function hotSkillOk(id) {
    var sk = DB.skills[id];
    return !!(sk && !sk.procOnly && sk.type !== 'passive' && player.skills && player.skills.indexOf(id) !== -1);
  }
  function hotItemOk(d, id) {
    return !!(d && !d.noUse && id !== 'scroll_revive' && d.type !== 'skillbk' && ['wpn', 'arm', 'acc'].indexOf(d.type) === -1 && (d.type === 'pot' || d.eff));
  }
  function hotSave() { try { if (hasP() && typeof saveGame === 'function') saveGame(); } catch (e) { console.warn('[AFK-lmui] 快捷列存檔失敗', e); } }
  function setHotSlot(i, entry) {
    if (!hasP()) return;
    if (!hotCustom()) {
      var auto = autoHotPlan();
      player.lmHot = [];
      for (var j = 0; j < HOT_SLOTS; j++) player.lmHot.push(auto[j] ? { k: auto[j].kind, id: auto[j].id } : null);
    }
    player.lmHot[i] = entry;
    lastHotKey = ''; updateHot(); hotSave();
  }
  function hotMode() { try { var m = +localStorage.getItem(HOT_MODE_KEY); return m === 1 || m === 2 ? m : 0; } catch (e) { return 0; } }
  function applyHotMode() {
    var box = $('lmui-hot'), btn = $('lmui-hotmode'); if (!box || !btn) return;
    var m = hotMode();
    box.setAttribute('data-mode', String(m));
    btn.innerHTML = '<b>▾</b>' + (m === 0 ? '1~6' : m === 1 ? '7~12' : '全部');
  }
  function bindHot() {
    var pressT = null, longAt = 0;
    slots.forEach(function (s, i) {
      s.el.addEventListener('click', function () { if (Date.now() - longAt < 700) return; useSlot(s); });
      s.el.addEventListener('contextmenu', function (e) { e.preventDefault(); longAt = Date.now(); openHotPick(i); });
      var start = function () { clearTimeout(pressT); pressT = setTimeout(function () { longAt = Date.now(); openHotPick(i); }, 500); };
      var stop = function () { clearTimeout(pressT); };
      s.el.addEventListener('touchstart', start, { passive: true });
      s.el.addEventListener('mousedown', function (e) { if (e.button === 0) start(); });
      ['touchend', 'touchmove', 'touchcancel', 'mouseup', 'mouseleave'].forEach(function (ev) { s.el.addEventListener(ev, stop, { passive: true }); });
    });
    var mb = $('lmui-hotmode');
    if (mb) mb.addEventListener('click', function () {
      try { localStorage.setItem(HOT_MODE_KEY, String((hotMode() + 1) % 3)); } catch (e) {}
      applyHotMode();
    });
    applyHotMode();
  }
  function closeHotPick() { var ov = $('lmui-hotpick'); if (ov) ov.remove(); }
  function openHotPick(i) {
    if (!hasP() || i < 0) return;
    closeHotPick();
    var cur = (hotCustom() || [])[i] || (!hotCustom() && autoHotPlan()[i] ? { k: autoHotPlan()[i].kind, id: autoHotPlan()[i].id } : null);
    var opt = function (k, id, d, extra) {
      var on = cur && cur.k === k && cur.id === id;
      var src = (typeof getIconUrl === 'function') ? getIconUrl(d, k === 'skill') : '';
      return '<button type="button" class="opt' + (on ? ' on' : '') + '" data-k="' + k + '" data-id="' + id + '"><img src="' + src + '" alt="" onerror="this.style.visibility=&quot;hidden&quot;"><span>' + (d.n || id) + (extra || '') + '</span></button>';
    };
    var sk = [];
    for (var id in DB.skills) if (hotSkillOk(id)) sk.push(id);
    sk.sort(function (a, b) { var A = DB.skills[a], B = DB.skills[b]; return (A.type === 'manual' ? 0 : 1) - (B.type === 'manual' ? 0 : 1) || (+A.tier || 0) - (+B.tier || 0); });
    var items = [], seen = {};
    (player.inv || []).forEach(function (it) { var d = it && DB.items[it.id]; if (d && !seen[it.id] && hotItemOk(d, it.id)) { seen[it.id] = 1; items.push(it.id); } });
    items.sort(function (a, b) { var ia = HOT_ITEM_ORDER.indexOf(a), ib = HOT_ITEM_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    var ov = document.createElement('div');
    ov.id = 'lmui-hotpick';
    ov.innerHTML = '<div class="box"><div class="hd">F' + (i + 1) + ' 要放什麼？<button type="button" data-x="1" aria-label="關閉">✕</button></div><div class="bd">' +
      '<div class="sec">技能</div><div class="grid">' + (sk.map(function (id) { return opt('skill', id, DB.skills[id]); }).join('') || '<span style="color:#94a3b8;font-size:14px;">還沒學會技能</span>') + '</div>' +
      '<div class="sec">道具（背包裡有的）</div><div class="grid">' + (items.map(function (id) { return opt('item', id, DB.items[id], ' ×' + hotItemCount(id)); }).join('') || '<span style="color:#94a3b8;font-size:14px;">背包沒有可用的道具</span>') + '</div>' +
      '</div><div class="ft"><button type="button" data-clear="1">清空這格</button><button type="button" data-auto="1">全部改回自動排列</button></div></div>';
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.closest('[data-x]')) { closeHotPick(); return; }
      if (e.target.closest('[data-clear]')) { setHotSlot(i, null); closeHotPick(); return; }
      if (e.target.closest('[data-auto]')) { if (hasP()) { delete player.lmHot; lastHotKey = ''; updateHot(); hotSave(); } closeHotPick(); return; }
      var b = e.target.closest('.opt'); if (!b) return;
      setHotSlot(i, { k: b.getAttribute('data-k'), id: b.getAttribute('data-id') });
      closeHotPick();
    });
    document.body.appendChild(ov);
  }
  // ── 怪物資訊小視窗：點戰鬥畫面上的怪 → 資料＋掉落物與機率（點怪原本的「鎖定目標」照舊） ──
  //   掉落表＝上游 MOB_DROPS 等（[物品id, 機率%]，每樣各自擲一次，見 js/05 killMob）；本職不能拿的試煉道具照上游 trialDropBlocked 不列。
  //   這隻是席琳的世界（×3／瘋狂×5）或恩賜怪（×10）時，機率直接乘上去顯示（同 killMob 的 _dropBase）。
  var ELE_NAME = { fire: '火', water: '水', earth: '地', wind: '風' };
  function dropTables() {   // 上游是頂層 const（不在 window 上，但同一個全域作用域讀得到）；少哪張就跳過
    return [
      typeof MOB_DROPS !== 'undefined' ? MOB_DROPS : null,
      typeof DARK_WEAPON_DROPS !== 'undefined' ? DARK_WEAPON_DROPS : null,
      typeof DARK_CRYSTAL_DROPS !== 'undefined' ? DARK_CRYSTAL_DROPS : null
    ];
  }
  function mobDropList(name) {
    var out = {}, order = [];
    dropTables().forEach(function (tbl) {
      var list = tbl && tbl[name]; if (!list) return;
      list.forEach(function (en) {
        var id = Array.isArray(en) ? en[0] : en, rate = Array.isArray(en) ? +en[1] : NaN;
        if (!id || !DB.items[id]) return;
        try { if (typeof trialDropBlocked === 'function' && trialDropBlocked(id)) return; } catch (e) {}
        if (!(id in out)) { out[id] = rate; order.push(id); }
      });
    });
    return order.map(function (id) { return { id: id, rate: out[id] }; });
  }
  function fmtRate(r) {
    if (!isFinite(r)) return '—';
    if (r >= 100) return '100%';
    if (r >= 1) return (Math.round(r * 10) / 10) + '%';
    return parseFloat(r.toPrecision(2)) + '%';
  }
  function showMobInfo(mob) {
    if (!mob || typeof DB === 'undefined') return;
    var base = DB.mobs && Object.keys(DB.mobs).filter(function (k) { return DB.mobs[k].n === mob.n; })[0];
    var d = (base && DB.mobs[base]) || mob;
    var mult = mob._grace ? 10 : (mob._sherine ? (mob._sherineMad ? 5 : 3) : 1);
    var drops = mobDropList(mob.n);
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var tags = [d.race, d.s === 'L' ? '大型' : (d.s === 'S' ? '小型' : ''), d.beh, d.un ? '不死' : ''].filter(Boolean).map(function (t) { return '<span class="mi-tag">' + esc(t) + '</span>'; }).join('');
    var stat = function (k, v) { return '<span><i>' + k + '</i><b>' + v + '</b></span>'; };
    var hp = (mob.curHp != null ? Math.max(0, Math.round(mob.curHp)) + ' / ' : '') + (mob.hp || d.hp);
    var rows = drops.length ? drops.map(function (x) {
      var it = DB.items[x.id];
      var cls = typeof getItemColor === 'function' ? getItemColor({ id: x.id }) : '';
      var icon = typeof getIconUrl === 'function' ? getIconUrl(it) : '';
      return '<div class="mi-drop tip-host" data-tip-id="' + x.id + '" data-tip-craft="1"><img src="' + icon + '" alt="" onerror="this.style.visibility=\'hidden\'"><span class="nm ' + cls + '">' + esc(it.n) + '</span><span class="rt">' + fmtRate(x.rate * mult) + '</span></div>';
    }).join('') : '<div class="mi-none">沒有專屬掉落物</div>';
    var box = $('lmui-mobinfo');
    if (!box) {
      box = document.createElement('div'); box.id = 'lmui-mobinfo'; box.className = 'lmui-hit';
      hud.appendChild(box);
      box.addEventListener('click', function (e) { if (e.target.closest('.mi-x')) document.body.classList.remove('lmui-mobinfo'); });
    }
    box.innerHTML = '<div class="mi-hd"><span class="mi-name' + (d.boss ? ' boss' : '') + '">' + (d.boss ? '👑 ' : '') + esc(mob.n) + '</span><span class="mi-lv">Lv.' + (mob.lv || d.lv) + '</span><button type="button" class="mi-x" aria-label="關閉">✕</button></div>' +
      '<div class="mi-tags">' + tags + (d.e && ELE_NAME[d.e] ? '<span class="mi-tag ele-' + d.e + '">' + ELE_NAME[d.e] + '屬性</span>' : '') + '</div>' +
      '<div class="mi-stats">' + stat('HP', hp) + stat('AC', d.ac) + stat('MR', d.mr) + stat('經驗', d.exp) + stat('金幣', (d.goldMin || 0) + '~' + (d.goldMax || 0)) + '</div>' +
      '<div class="mi-sub">掉落物' + (mult > 1 ? '<em>（已含 ×' + mult + '）</em>' : '') + '</div>' +
      '<div class="mi-list">' + rows + '</div>';
    document.body.classList.add('lmui-mobinfo');
  }
  function bindMobClick() {
    var list = $('mob-list'); if (!list || list._lmuiMobInfo) return;
    list._lmuiMobInfo = true;
    list.addEventListener('click', function (e) {
      if (!document.body.classList.contains('lmui-battle')) return;
      var card = e.target.closest('.mob-target[data-uid]'); if (!card) return;
      var uid = card.getAttribute('data-uid');
      var mob = (typeof mapState !== 'undefined' && mapState && mapState.mobs || []).filter(function (m) { return m && m.uid === uid; })[0];
      if (mob) { try { showMobInfo(mob); } catch (err) { console.warn('[AFK-lmui] 怪物資訊失敗', err); } }
    });
  }

  // ── 狩獵場（選地圖）：依類型分頁（村莊/野外/地監/世界王/時空裂痕），取代上游「地區」下拉 ──
  //   清單＝上游 MAP_CATEGORIES；能不能進＝上游 mapOptDisabled；移動＝上游 setMapSelectors + changeMap（受控狀態由它自己擋）。
  //   右欄：安全區／怪物等級範圍（由該圖出怪池的 DB.mobs.lv 算）／未開放。
  var MAP_TABS = [
    { k: 'town', name: '村莊' }, { k: 'wild', name: '野外' }, { k: 'dungeon', name: '地監' }, { k: 'boss', name: '世界王' }, { k: 'rift', name: '時空裂痕' }
  ];
  var mapTab = 'town', mapLvCache = {};
  function mapTabOf(cat, v) {
    if (/^town_/.test(v)) return 'town';
    if (cat === 'wild' || v === 'pirate_wild') return 'wild';
    if (cat === 'dungeon' || cat === 'tower' || cat === 'pirate_island') return 'dungeon';
    if (cat === 'special') return 'boss';
    if (cat === 'rift') return 'rift';
    return 'wild';
  }
  function mapList(tab) {
    if (typeof MAP_CATEGORIES === 'undefined') return [];
    var out = [], seen = {};
    Object.keys(MAP_CATEGORIES).forEach(function (cat) {
      MAP_CATEGORIES[cat].forEach(function (m) {
        if (!m || !m.v || seen[m.v] || mapTabOf(cat, m.v) !== tab) return;
        if (m.classicHide && player.classicMode) return;
        seen[m.v] = 1; out.push(m);
      });
    });
    return out;
  }
  function mapLvText(v) {
    if (v in mapLvCache) return mapLvCache[v];
    var pool = (typeof DB !== 'undefined' && DB.maps && DB.maps[v]) || [], lo = Infinity, hi = -Infinity;
    pool.forEach(function (mid) { var mb = DB.mobs && DB.mobs[mid]; var lv = mb && +mb.lv; if (lv) { if (lv < lo) lo = lv; if (lv > hi) hi = lv; } });
    return (mapLvCache[v] = isFinite(lo) ? ('Lv.' + lo + (hi > lo ? '~' + hi : '')) : '');
  }
  function renderMaps() {
    var box = $('lmui-maps'); if (!box || !hasP()) return;
    var cur = ($('map-select') || {}).value || '';
    var tabs = MAP_TABS.map(function (t) { return '<button type="button" data-mt="' + t.k + '" class="' + (t.k === mapTab ? 'on' : '') + '">' + t.name + '</button>'; }).join('');
    var rows = mapList(mapTab).map(function (m) {
      var off = false; try { off = typeof mapOptDisabled === 'function' && mapOptDisabled(m); } catch (e) {}
      var right = off ? '未開放' : (/^town_/.test(m.v) ? '安全區' : mapLvText(m.v));
      return '<button type="button" class="lm-row' + (m.v === cur ? ' cur' : '') + (off ? ' off' : '') + '" data-map="' + m.v + '"' + (off ? ' disabled' : '') + '>' +
        '<span class="nm"' + (m.c && !off ? ' style="color:' + m.c + '"' : '') + '>' + m.t + '</span><span class="rt">' + right + '</span></button>';
    }).join('');
    box.innerHTML = '<div class="lm-tabs">' + tabs + '</div><div class="lm-list">' + rows + '</div>';
  }
  function ensureMaps() {
    var box = $('lmui-maps'); if (box) return box;
    box = document.createElement('div'); box.id = 'lmui-maps'; box.className = 'lmui-hit';
    hud.appendChild(box);
    box.addEventListener('click', function (e) {
      var t = e.target.closest('[data-mt]'); if (t) { mapTab = t.getAttribute('data-mt'); renderMaps(); return; }
      var r = e.target.closest('.lm-row'); if (!r || r.disabled) return;
      var v = r.getAttribute('data-map');
      closeMaps();
      try { if (typeof setMapSelectors === 'function') setMapSelectors(v); var ms = $('map-select'); if (ms) ms.value = v; if (typeof changeMap === 'function') changeMap(); }
      catch (err) { console.warn('[AFK-lmui] 換地圖失敗', err); }
    });
    return box;
  }
  function openMaps() {
    ensureMaps();
    var cur = ($('map-select') || {}).value || '';
    if (typeof MAP_CATEGORIES !== 'undefined' && cur) { try { mapTab = mapTabOf(mapCategoryOf(cur), cur); } catch (e) {} }   // 打開時跳到目前所在那一類
    renderMaps();
    document.body.classList.add('lmui-maps');
    var curRow = document.querySelector('#lmui-maps .lm-row.cur'); if (curRow) try { curRow.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }
  function closeMaps() { document.body.classList.remove('lmui-maps'); }
  function toggleMaps() { if (document.body.classList.contains('lmui-maps')) closeMaps(); else openMaps(); }

  // 切換功能（工具列/子分頁）前，把目前開著的視窗都關掉，不要疊在新頁面上。
  //   一律走各視窗「自己的」關閉路徑（核心 closeModal、視窗裡的關閉鈕），不直接刪 DOM——
  //   有的視窗關閉時要收尾（存設定、交還返回鍵歷史層），有的是常駐節點只切 class，刪了下次就開不起來。
  var CLOSE_TEXT = /^(✕|×|x|X|關閉|返回|Close)$/;
  function findCloseBtn(root) {
    var cand = root.querySelectorAll('button, [role="button"], .close, [aria-label*="關閉"]');
    for (var i = 0; i < cand.length; i++) {
      var c = cand[i];
      if (!c.getClientRects().length) continue;
      var label = (c.getAttribute('aria-label') || '') + ' ' + (c.className || '');
      if (CLOSE_TEXT.test((c.textContent || '').trim()) || /關閉|close/i.test(label)) return c;
    }
    return null;
  }
  function closeAllWindows() {
    var body = document.body;
    body.classList.remove('lmui-map', 'lmui-cmp', 'lmui-chatbig', 'lmui-flt', 'lmui-townchat', 'lmui-maps', 'lmui-mobinfo', 'lmui-exitwin');
    var tic = $('town-interaction-close');   // 村莊 NPC 對話/商店
    if (tic && tic.getClientRects().length) { try { tic.click(); } catch (e) {} }
    var im = $('item-modal');
    if (im && !im.classList.contains('hidden') && typeof closeModal === 'function') { try { closeModal(); } catch (e) {} }
    if (body.classList.contains('mlog-open')) { var lc = $('m-log-close'); if (lc) lc.click(); else body.classList.remove('mlog-open'); }
    var list = document.querySelectorAll('#warehouse-window-frame,.lmui-below,.lmui-below-c,' + MODAL_HOSTS);
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.closest('#lmui-ashost')) continue;   // 背包「自動賣出」分類裡就地顯示的規則視窗：不是彈窗，離開分類時由 syncInlineAS 收
      if (!w.getClientRects().length || getComputedStyle(w).display === 'none') continue;
      var x = findCloseBtn(w);
      if (x) { try { x.click(); } catch (e) {} }
    }
  }
  // 聊天框取代完整日誌面板：篩選（搬入核心那排篩選鈕）、世界頻道發問、工具列「聊天」
  function toggleFilter() {
    var box = $('lmui-flt'), pills = $('combat-filter-pills');
    if (box && pills && pills.parentNode !== box) box.appendChild(pills);   // 只搬一次；id 不變，核心的 toggleCombatFilter 等照舊找得到
    document.body.classList.toggle('lmui-flt');
  }
  function sendWorld() {
    var say = $('lmui-say'), src = $('world-input');
    var v = say ? say.value.trim() : '';
    if (!v || !src || typeof worldChannelAsk !== 'function') return;
    src.value = v;
    try { worldChannelAsk(); } catch (e) { console.warn('[AFK-lmui] 世界頻道發問失敗', e); return; }
    say.value = '';
    chatTab = 'world'; lastChatSig = ''; chatDirty = true;
    try { renderChat(true); } catch (e) {}
  }
  function openChat() {
    if (!document.body.classList.contains('lmui-battle')) { chatTab = 'world'; openFullLog(); return; }   // 村莊沒有聊天框 → 照舊開日誌面板
    var b = navBtn('center'); if (b) b.click();
    chatTab = 'world'; lastChatSig = ''; chatDirty = true;
    document.body.classList.add('lmui-chatbig');
    if (document.body.classList.contains('lmui-town')) document.body.classList.add('lmui-townchat');   // 村莊：聊天框蓋在 NPC 卡片上，按其他工具就收回
    try { renderChat(true); } catch (e) {}
    var say = $('lmui-say'); if (say) try { say.focus(); } catch (e) {}
  }
  // 完整日誌面板（afk-mobile 的 #m-log-sheet；⇆ 在「戰鬥/系統」與「世界頻道」間切）——只剩村莊用
  function openFullLog() {
    var body = document.body;
    if (!body.classList.contains('mlog-open')) { var nb = navBtn('log'); if (nb) nb.click(); }
    var wantWorld = chatTab === 'world';
    if (body.classList.contains('mlog-sys') !== wantWorld) { var sw = document.querySelector('#m-log-sheet .m-log-sw'); if (sw) sw.click(); }
    if (!wantWorld) { try { switchLogTab(chatTab === 'combat' ? 'combat' : 'sys'); } catch (e) {} }
  }

  // ── 狀態判斷 ────────────────────────────────────────────
  function inGame() { var gs = $('game-screen'); return !!(gs && !gs.classList.contains('hidden')); }
  function isMobileGeom() { return !!(mq && mq.matches) && document.body.classList.contains('m-mobile'); }
  function inBattleMap() { var bv = $('battle-view'); return !!(bv && !bv.classList.contains('hidden')); }
  function inTownView() { var tv = $('town-view'); return !!(tv && !tv.classList.contains('hidden')); }
  // 村莊 NPC 卡片前面的小圖示（依職稱；跟參考圖一樣只是辨識用，不影響點擊）
  var NPC_EMO = [[/雜貨|商人|商店/, '💰'], [/倉庫/, '📦'], [/製作|鍛造|工匠/, '🔨'], [/試煉|任務/, '❗'], [/傭兵|協力/, '⚔️'], [/黑市/, '🎲'], [/魔法|傳授/, '📖'], [/收購|龍鑽/, '💎'], [/血盟/, '🛡️']];
  // 不顯示的 NPC：龍鑽收購（叫賣型）、傭兵公會（隊伍入口已拿掉）
  var NPC_HIDE = /龍鑽收購|傭兵公會|協力/;
  function hideNpcs() {
    var rows = document.querySelectorAll('#afk-npclist .afk-npcl-row');
    for (var i = 0; i < rows.length; i++) if (!rows[i].classList.contains('lmui-npc-off') && NPC_HIDE.test(rows[i].textContent || '')) rows[i].classList.add('lmui-npc-off');
    var npcs = document.querySelectorAll('#town-npc-map .town-npc');
    for (var j = 0; j < npcs.length; j++) {
      var lb = npcs[j].querySelector('.tn-label');
      if (lb && !npcs[j].classList.contains('lmui-npc-off') && NPC_HIDE.test(lb.textContent || '')) npcs[j].classList.add('lmui-npc-off');
    }
  }
  // 村莊地圖 NPC 重新站位：名字不疊、不被頭像/地圖名稱蓋住。
  //   照原本左右順序「像排文字一樣」逐排塞（量實際的名字寬度），一排塞不下就換下一排；
  //   排數多到上下放不下時，整隻 NPC（連名字）等比縮小再排一次。NPC 數量、畫面大小變了才重算。
  //   用 data-lmui-slot ＋ 樣式表 !important 蓋上游的內聯 left/top（上游之後再改內聯也不會抖）。
  //   .town-npc 以腳底為基準點（上游 transform:translate(-50%,-100%)）；縮放的原點也放在腳底，位置才不會跑掉。
  var NPC_TOP_PAD = 84;   // 上緣留給左上頭像/右上地圖名稱
  var npcLayoutSig = '';
  function layoutTownNpcs() {
    var map = $('town-npc-map'); if (!map) return;
    var W = map.clientWidth, H = map.clientHeight; if (!W || !H) return;
    // 只排看得到的（被本檔或其他外掛藏起來的 NPC，例如黑市潘朵拉，量不到大小、也不該佔位）
    var all = Array.prototype.slice.call(map.querySelectorAll('.town-npc:not(.lmui-npc-off)')).filter(function (e) { return e.offsetParent !== null; });
    if (!all.length) return;
    all.sort(function (a, b) { return (parseFloat(a.style.left) || 0) - (parseFloat(b.style.left) || 0); });
    var names = all.map(function (e) { var nm = e.querySelector('.tn-name'); return nm ? nm.textContent : ''; }).join(',');
    all.forEach(function (e, i) { if (e.getAttribute('data-lmui-slot') !== String(i)) e.setAttribute('data-lmui-slot', i); });
    // 簽章含每隻的高度：NPC 圖晚載入（尺寸變了）也會重排，不會沿用載入前量到的高度把名字推進上方 HUD
    var sig = names + '|' + W + 'x' + H + '|' + all.map(function (e) { var lb = e.querySelector('.tn-label'); return e.offsetHeight + ':' + (lb ? lb.offsetTop : 0); }).join(',');
    if (sig === npcLayoutSig) return;
    var items = all.map(function (e) {
      var lb = e.querySelector('.tn-label');
      var lw = lb ? lb.offsetWidth : 80;
      // 實際高度＝名字標籤頂端到腳底：上游會把某些 NPC 的名字放得比圖高很多（頭上留一段），只算「圖高＋標籤高」會低估
      var top = lb ? Math.min(0, lb.offsetTop) : -24;
      return { w: Math.max(lw, e.offsetWidth), h: e.offsetHeight - top };
    });
    if (items.some(function (it) { return !it.h; })) return;   // 圖還沒載完量不到高度，下一輪再排
    npcLayoutSig = sig;
    var avail = H - NPC_TOP_PAD - 4, s = 1, rows = null, heights = null;
    [1, 0.9, 0.8, 0.7, 0.6, 0.5].some(function (sc) {
      s = sc; rows = []; var cur = [], curW = 0;
      items.forEach(function (it, i) {
        var w = it.w * sc + 8;
        if (cur.length && curW + w > W - 6) { rows.push(cur); cur = []; curW = 0; }
        cur.push(i); curW += w;
      });
      if (cur.length) rows.push(cur);
      heights = rows.map(function (r) { return Math.max.apply(null, r.map(function (i) { return items[i].h; })) * sc + 6; });
      return heights.reduce(function (a, b) { return a + b; }, 0) <= avail;
    });
    var extra = Math.max(0, (avail - heights.reduce(function (a, b) { return a + b; }, 0)) / rows.length);
    var css = '', y = NPC_TOP_PAD;
    rows.forEach(function (r, ri) {
      y += heights[ri] + extra;
      var foot = y - extra / 2;
      var tw = r.reduce(function (a, i) { return a + items[i].w * s; }, 0);
      var gap = (W - tw) / (r.length + 1), x = gap;
      r.forEach(function (i) {
        var cx = x + items[i].w * s / 2; x += items[i].w * s + gap;
        css += 'html body.lmui-town #town-npc-map .town-npc[data-lmui-slot="' + i + '"]{left:' + (cx / W * 100).toFixed(2) + '% !important;top:' + (foot / H * 100).toFixed(2) + '% !important;' +
          'transform:translate(-50%,-100%) scale(' + s + ') !important;transform-origin:50% 100% !important;z-index:' + (600 + Math.round(foot)) + ' !important;}\n';
      });
    });
    var st = $('lmui-npcpos');
    if (!st) { st = document.createElement('style'); st.id = 'lmui-npcpos'; document.head.appendChild(st); }
    st.textContent = css;
  }
  // NPC 對話標題「名字（職稱）」＋金幣；製作清單材料不足的按鈕改成灰色「材料不足」
  function decorateInteraction() {
    var box = $('town-interaction-container');
    if (!box || box.classList.contains('hidden')) return;
    var t = $('interaction-npc-title');
    if (t) { var m = (t.textContent || '').match(/^\s*[\[［](.+)[\]］]\s*$/); if (m) t.textContent = '（' + m[1] + '）'; }
    var hd = $('town-interaction-header'), close = $('town-interaction-close');
    if (hd && close) {
      var g = $('lmui-ihead-gold');
      if (!g) { g = document.createElement('span'); g.id = 'lmui-ihead-gold'; hd.insertBefore(g, close); }
      setTxt(g, '💰 ' + (txt('st-gold') || '0'));
    }
    var items = document.querySelectorAll('#interaction-content .list-item');
    for (var i = 0; i < items.length; i++) {
      var btn = items[i].querySelector('button.btn[onclick*="doCraft"]'); if (!btn) continue;
      var lack = !!items[i].querySelector('.flex-wrap .text-red-400');
      if (lack !== btn.classList.contains('lmui-nomat')) {
        btn.classList.toggle('lmui-nomat', lack);
        btn.disabled = lack;
        if (lack) { if (!btn.hasAttribute('data-lmui-txt')) btn.setAttribute('data-lmui-txt', btn.textContent); btn.textContent = '材料不足'; }
        else if (btn.hasAttribute('data-lmui-txt')) btn.textContent = btn.getAttribute('data-lmui-txt');
      }
    }
  }
  function decorateNpcCards() {
    var rows = document.querySelectorAll('#afk-npclist .afk-npcl-row');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]; if (r.querySelector('.lmui-npc-emo')) continue;
      var nm = r.querySelector('.afk-npcl-name'); if (!nm) continue;
      var title = (r.querySelector('.afk-npcl-title') || {}).textContent || '';
      var emo = '📜';
      for (var k = 0; k < NPC_EMO.length; k++) if (NPC_EMO[k][0].test(title)) { emo = NPC_EMO[k][1]; break; }
      var tEl = r.querySelector('.afk-npcl-title');   // 職稱本身沒有括號才補（像「[龍鑽收購]」已經自帶）
      if (tEl && title.trim() && !/^\s*[\[［]/.test(title)) tEl.setAttribute('data-lmui-br', '');
      var s = document.createElement('span'); s.className = 'lmui-npc-emo'; s.textContent = emo;
      nm.parentNode.insertBefore(s, nm);
    }
  }
  // 死亡時「重新開始」浮在角色頭頂：以角色精靈框量位置
  function placeDeadBtn() {
    var pb = document.querySelector('#player-morph-sprite .pm-body'); if (!pb) return;
    var r = pb.getBoundingClientRect(); if (!r.width) return;
    var s = document.documentElement.style;
    s.setProperty('--lmui-dead-x', Math.round(r.left + r.width / 2) + 'px');
    s.setProperty('--lmui-dead-y', Math.round(r.top + r.height / 2 - 28) + 'px');   // 圖框四周留白很多，人物約在框中心偏下 → 按鈕底緣壓在頭頂上
  }
  function isDead() {
    var a = $('btn-revive'), b = $('btn-revive-inplace');
    return !!((a && !a.classList.contains('hidden')) || (b && !b.classList.contains('hidden')));
  }

  // ── 狩獵紀錄（死亡視窗下半那塊）：經驗% / 擊殺數 / 金幣 / 道具，按「重整」歸零 ──
  //   只放記憶體（重新整理頁面就歸零）：純顯示用，不佔存檔的 localStorage。
  //   金幣、道具只算在狩獵地圖上的進出（村莊買賣不算）；經驗含死亡扣的（天堂M 也是這樣顯示負的）。
  var hunt = null;
  function expMetric() {
    if (!hasP()) return 0;
    var req = typeof getExpReq === 'function' ? getExpReq(player.lv) : 0;
    var pct = player.lv >= 100 ? 0 : (req > 0 && isFinite(req) ? (player.exp / req) * 100 : 0);
    return player.lv * 100 + pct;
  }
  function huntReset() {
    hunt = { slot: typeof currentSlot !== 'undefined' ? currentSlot : null, exp0: expMetric(), kills: 0, gold: 0, lastGold: hasP() ? (player.gold || 0) : 0, items: {}, itemCnt: 0 };
    renderDeathStats();
  }
  function huntTick(town) {
    if (!hasP()) return;
    var slot = typeof currentSlot !== 'undefined' ? currentSlot : null;
    if (!hunt || hunt.slot !== slot) huntReset();
    var g = player.gold || 0;
    if (!town) hunt.gold += g - hunt.lastGold;
    hunt.lastGold = g;
  }
  function huntActive() { return hunt && hasP() && !document.body.classList.contains('lmui-town') && !(typeof state !== 'undefined' && state && state.ff); }
  function fmtSigned(n) { return (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString(); }
  function renderDeathStats() {
    var w = $('lmui-death'); if (!w || !hunt) return;
    setTxt(w.querySelector('[data-k="exp"]'), (expMetric() - hunt.exp0).toFixed(4) + '%');
    setTxt(w.querySelector('[data-k="kills"]'), hunt.kills.toLocaleString());
    setTxt(w.querySelector('[data-k="gold"]'), fmtSigned(hunt.gold));
    setTxt(w.querySelector('[data-k="items"]'), hunt.itemCnt.toLocaleString());
    var list = w.querySelector('.ld-items');
    if (list && list.style.display !== 'none') {
      var keys = Object.keys(hunt.items);
      list.innerHTML = keys.length ? keys.map(function (k) { return '<div><span>' + k + '</span><b>' + hunt.items[k].toLocaleString() + '</b></div>'; }).join('') : '<div class="ld-none">沒有道具</div>';
    }
  }
  function buildDeathWin() {
    if ($('lmui-death')) return;
    var w = document.createElement('div');
    w.id = 'lmui-death';
    w.innerHTML =
      '<div class="ld-btns">' +
        '<button type="button" data-act="revive">重新開始</button>' +
        '<button type="button" data-act="exit">離開</button>' +
        '<button type="button" data-act="cancel">取消</button>' +
      '</div>' +
      '<div class="ld-stats">' +
        '<div class="ld-row"><span>獲得經驗值</span><b data-k="exp">0%</b></div>' +
        '<div class="ld-row"><span>狩獵怪物數</span><b data-k="kills">0</b></div>' +
        '<div class="ld-row"><span>獲得金幣</span><b data-k="gold">0</b></div>' +
        '<div class="ld-row"><span>獲得道具</span><b data-k="items">0</b><button type="button" class="ld-look" data-act="items" aria-label="道具清單">🔍</button></div>' +
        '<div class="ld-items" style="display:none"></div>' +
        '<button type="button" class="ld-reset" data-act="reset">重整</button>' +
      '</div>';
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      var body = document.body;
      // 重新開始：死亡＝回村復活；活著（從工具列「離開」打開）＝回到選角（afk-mobile 的切換角色/回首頁窗）
      if (act === 'revive') {
        body.classList.remove('lmui-exitwin');
        if (isDead()) { if (typeof revive === 'function') revive(); }
        else { var t0 = navBtn('logout'); if (t0) t0.click(); }
      }
      // 離開：直接走 afk-mobile「確定回首頁」（它會先存檔、顯示回首頁遮罩）
      else if (act === 'exit') {
        body.classList.remove('lmui-exitwin');
        var t = navBtn('logout'); if (t) t.click();
        var ok = $('m-logout-ok'); if (ok) ok.click();
      }
      else if (act === 'cancel') { if (body.classList.contains('lmui-exitwin')) body.classList.remove('lmui-exitwin'); else body.classList.add('lmui-deathx'); }
      else if (act === 'items') { var l = w.querySelector('.ld-items'); l.style.display = l.style.display === 'none' ? '' : 'none'; renderDeathStats(); }
      else if (act === 'reset') huntReset();
    });
    document.body.appendChild(w);
  }
  function hookHunt() {
    if (typeof window.killMob === 'function' && !window.killMob.__lmuiHunt) {
      var _km = window.killMob;
      window.killMob = function (idx) {
        var m = (typeof mapState !== 'undefined' && mapState.mobs) ? mapState.mobs[idx] : null, was = m && m._dead;
        var r = _km.apply(this, arguments);
        try { if (m && !was && m._dead && huntActive()) hunt.kills++; } catch (e) {}
        return r;
      };
      window.killMob.__lmuiHunt = true;
    }
    if (typeof window.gainItem === 'function' && !window.gainItem.__lmuiHunt) {
      var _gi = window.gainItem;
      window.gainItem = function (id, cnt) {
        var r = _gi.apply(this, arguments);
        try {
          if (huntActive() && r !== false) {
            var n = Math.max(1, Number(cnt) || 1), it = typeof DB !== 'undefined' && DB.items && DB.items[id], nm = (it && it.n) || id;
            hunt.items[nm] = (hunt.items[nm] || 0) + n; hunt.itemCnt += n;
          }
        } catch (e) {}
        return r;
      };
      window.gainItem.__lmuiHunt = true;
    }
  }
  // 有沒有彈窗開在戰鬥畫面上（道具/倉庫/afk-banner 清單裡的各種窗/Tailwind 的 .fixed.inset-0 遮罩）
  var WIN_SEL = '#item-modal:not(.hidden),#warehouse-window-frame,.fixed.inset-0,.lmui-below,.lmui-below-c,' + MODAL_HOSTS;
  // 掛在 body 下、蓋到戰鬥場景的彈窗 → 推到下半。不碰：主畫面/我們自己的元件/橫幅(z 極大)/不吃點擊的特效層/提示框
  var KEEP_IDS = { 'app-stage': 1, 'creation-screen': 1, 'lmui-hud': 1, 'm-nav': 1, 'lmui-bagtabs': 1, 'm-log-sheet': 1, 'm-logout-overlay': 1 };
  function pushWindowsBelow() {
    var gs = $('game-screen'); if (!gs) return;
    var limit = gs.getBoundingClientRect().top;   // ＝場景下緣（#game-screen 已縮到下半）
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      var e = kids[i];
      if (e.id && KEEP_IDS[e.id]) continue;
      if (e.classList.contains('lmui-below') || e.classList.contains('lmui-below-c')) continue;
      if (/tooltip/i.test(e.className || '') || e.tagName === 'SCRIPT' || e.tagName === 'STYLE') continue;
      if (!e.getClientRects().length) continue;
      var cs = getComputedStyle(e);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
      if ((parseInt(cs.zIndex, 10) || 0) >= 1000000) continue;   // 非官方橫幅（afk-banner 管）
      var r = e.getBoundingClientRect();
      if (r.height < 120 || r.top >= limit - 4 || r.bottom <= limit) continue;
      e.classList.add(cs.transform && cs.transform !== 'none' && r.height < window.innerHeight * 0.9 ? 'lmui-below-c' : 'lmui-below');
    }
  }
  function anyWindowOpen() {
    var list = document.querySelectorAll(WIN_SEL);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.id === 'game-screen' || e.closest('#lmui-hud') || e.closest('#lmui-ashost')) continue;
      if (e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden') return true;
    }
    return false;
  }
  function toggleCls(c, v) { if (document.body.classList.contains(c) !== v) document.body.classList.toggle(c, v); }
  // 彈窗內容太長時可以一路往下長到工具列上緣；真的長到血條那一帶才把血條收起來（短的視窗血條照常露著、不移動）
  //   遮罩型（整片 inset:0）量裡面那張卡；其餘量自己。
  function updatePopover() {
    var vit = $('lmui-vit'), on = false;
    if (vit && document.body.classList.contains('lmui-battle')) {
      var vt = vit.getBoundingClientRect().top;
      if (!vt) vt = parseFloat(vit.style.top) || 0;
      var list = document.querySelectorAll(WIN_SEL + ',#town-interaction-container:not(.hidden),#lmui-mobinfo,#lmui-death');
      for (var i = 0; i < list.length && !on; i++) {
        var e = list[i];
        if (e.id === 'game-screen' || !e.getClientRects().length || e.closest('#lmui-ashost')) continue;
        var cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        var r = e.getBoundingClientRect(), bot = r.bottom;
        if (r.height > window.innerHeight * 0.85) {   // 遮罩：取子元素
          bot = 0;
          for (var c = e.firstElementChild; c; c = c.nextElementSibling) { var cr = c.getBoundingClientRect(); if (cr.height) bot = Math.max(bot, cr.bottom); }
        }
        if (bot > vt + 2) on = true;
      }
    }
    toggleCls('lmui-popover', on);
  }

  // 底部工具列（經典天堂那排圖示）：自己建一排鈕塞進 afk-mobile 的 #m-nav，原本那幾顆藏起來但留著——
  //   切欄/日誌/登出直接 click 原鈕，afk-mobile 的 setView/登出確認窗/--m-nav-h 量測全部照舊。
  function rightTabBtn(tab) {
    var bar = document.querySelector('#col-right .tab-bar'); if (!bar) return null;
    return bar.querySelector('button[onclick*="switchTab(\'' + tab + '\'"]');
  }
  function openTab(tab) {
    var nb = navBtn('right'); if (nb) nb.click();
    var b = rightTabBtn(tab); if (b) b.click();
  }
  // 順序照玩家給的參考圖：信封(聊天)・人形(素質)・星(魔法)・袋子(背包)・握手(隊伍)・扳手(設定)・門(離開)，最前面加戰鬥
  var TOOLS = [
    { id: 'battle', name: '狩獵場', run: function () { var b = navBtn('center'); if (b) b.click(); openMaps(); }, toggle: true },
    { id: 'chat', name: '聊天', run: openChat },
    { id: 'stats', name: '角色素質', label: '能力', run: function () { openTab('stats'); } },
    { id: 'skill', name: '魔法', run: function () { openTab('skill'); if (typeof refreshClassicSkillBookOnly === 'function') { try { refreshClassicSkillBookOnly(); } catch (e) {} } } },
    { id: 'items', name: '背包', run: function () { bagCat = 'all'; openTab('items'); } },   // 每次打開都從「全部」開始（停在「自動賣出」＝規則視窗開著、背景自動賣出暫停）
    { id: 'automation', name: '設定', run: function () { openTab('automation'); } },
    { id: 'exit', name: '離開', run: function () { buildDeathWin(); renderDeathStats(); document.body.classList.add('lmui-exitwin'); } }   // 天堂M：離開也是那個「重新開始/離開/取消＋狩獵紀錄」視窗
  ];
  // 線條圖示；畫兩次（黑色粗描邊＋銀色漸層細線）做出參考圖那種金屬浮雕感
  var SVG = {
    battle: '<path d="M4 4l11 11M20 4L9 15M4 20l3-3M20 20l-3-3M6 15l3 3M18 15l-3 3"/>',
    chat: '<path d="M3 6h18v12H3z"/><path d="M3 6l9 7 9-7"/>',
    stats: '<circle cx="12" cy="5.5" r="2.8"/><path d="M8 21l1-7-3-1 1.5-4.5h9L18 13l-3 1 1 7"/>',
    skill: '<circle cx="12" cy="12" r="8.5"/><path d="M12 6l1.8 4 4.2.3-3.2 2.7 1 4.1L12 15l-3.8 2.1 1-4.1L6 10.3l4.2-.3z"/>',
    items: '<path d="M9 4.5h6l-1.5 3h-3z"/><path d="M10.5 7.5C6 9 4.5 13 5 16.5 5.5 19.5 8 20.5 12 20.5s6.5-1 7-4c.5-3.5-1-7.5-5.5-9"/>',
    automation: '<path d="M14.5 4.5a4 4 0 0 0-4.9 5.2L4 15.3 6.7 18l5.6-5.6a4 4 0 0 0 5.2-4.9l-2.4 2.4-2.3-.6-.6-2.3z"/>',
    exit: '<path d="M14 4H6v16h8"/><path d="M11 12h9M17 9l3 3-3 3"/>'
  };
  function buildToolbar() {
    var n = $('m-nav'); if (!n || $('lmui-nav')) return;
    var bar = document.createElement('div');
    bar.id = 'lmui-nav';
    // 銀色漸層只定義一次，各圖示用 url(#lmui-silver) 共用
    bar.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="lmui-silver" gradientUnits="userSpaceOnUse" x1="0" y1="3" x2="0" y2="21"><stop offset="0" stop-color="#f4f4f4"/><stop offset=".5" stop-color="#b8b8b8"/><stop offset="1" stop-color="#6e6e6e"/></linearGradient></defs></svg>';
    TOOLS.forEach(function (t) {
      if (t.need && !t.need()) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'lmui-tool'; b.setAttribute('data-tool', t.id);
      b.setAttribute('aria-label', t.name); b.title = t.name;
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g class="o">' + SVG[t.id] + '</g><g class="f">' + SVG[t.id] + '</g></svg><span>' + (t.label || t.name) + '</span>';
      b.addEventListener('click', function () {
        // 可開關的（狩獵場）：已經開著就只收起來
        if (t.toggle && document.body.classList.contains('lmui-maps')) { closeAllWindows(); try { syncToolbar(); } catch (e) {} return; }
        closeAllWindows();
        try { t.run(); } catch (e) { console.warn('[AFK-lmui] 工具列「' + t.name + '」失敗', e); }
        try { syncBag(); syncToolbar(); } catch (e) {}   // 立刻更新子分頁列/亮燈，不等下一個 tick（否則切換後有一瞬間空白）
      });
      bar.appendChild(b);
    });
    var ex = document.createElement('div'); ex.id = 'lmui-navexp';
    bar.appendChild(ex);
    n.appendChild(bar);
  }
  // 目前在哪一格：日誌開著＝聊天；戰鬥/隊伍看 mview-*；右欄看哪個分頁亮著（武器/防具算背包，裝備欄位算能力）
  var RIGHT_TAB_TOOL = { stats: 'stats', audit: 'stats', pvp: 'stats', clan: 'stats', equip: 'items', skill: 'skill', items: 'items', weapons: 'items', armors: 'items', automation: 'automation' };
  function currentTool() {
    var c = document.body.classList;
    if (c.contains('mlog-open')) return 'chat';
    if (c.contains('lmui-battle') && c.contains('mview-center') && c.contains('lmui-chatbig')) return 'chat';
    if (c.contains('mview-center')) return 'battle';
    if (c.contains('mview-right')) {
      for (var k in RIGHT_TAB_TOOL) { var p = $('tab-' + k); if (p && !p.classList.contains('hidden')) return RIGHT_TAB_TOOL[k]; }
    }
    return '';
  }
  function syncToolbar() {
    buildToolbar();
    var bar = $('lmui-nav'); if (!bar) return;
    var cur = currentTool();
    var btns = bar.querySelectorAll('.lmui-tool');
    for (var i = 0; i < btns.length; i++) { var on = btns[i].getAttribute('data-tool') === cur; if (btns[i].classList.contains('on') !== on) btns[i].classList.toggle('on', on); }
    setTxt($('lmui-navexp'), txt('txt-exp'));
  }

  // ── 右欄面板上方的分頁列（取代上游那排 12 顆分頁鈕）：依目前所在的工具分組，釘在頭像列正下方 ──
  //   t＝核心分頁（點上游原鈕切過去，switchTab 的副作用如「統計/存檔」順便存檔照舊）；btn＝開彈窗的上游原鈕（收藏）
  //   cat＝背包分類（不是核心分頁：核心分頁停在「道具」，三個物品分頁由 CSS 依 lmui-cat-* 攤平/篩選）
  //   魔法、設定沒有分頁列（設定原本的「自動賣出」移到背包的分類）。
  var SUB_GROUPS = {
    items: [{ cat: 'all', name: '全部', icon: '⇅' }, { cat: 'weapon', name: '武器' }, { cat: 'armor', name: '防具' }, { cat: 'item', name: '道具' }, { t: 'equip', name: '裝備欄' }, { cat: 'as', name: '自動賣出' }],
    stats: [
      { t: 'stats', name: '能力' }, { t: 'audit', name: '統計' }].concat((typeof DISABLE_COLLECTION !== 'undefined' && DISABLE_COLLECTION) ? [] : [{ btn: 'btn-collection', name: '收藏' }]).concat([
      { t: 'pvp', name: '社交' }, { t: 'clan', name: '血盟' }
    ])
  };
  var TAB_GROUP = { items: 'items', armors: 'items', weapons: 'items', equip: 'items', stats: 'stats', audit: 'stats', pvp: 'stats', clan: 'stats', automation: 'automation' };
  var BAG_CATS = ['all', 'weapon', 'armor', 'item', 'as'];
  var CAT_TABS = { all: ['tab-weapons', 'tab-armors', 'tab-items'], weapon: ['tab-weapons'], armor: ['tab-armors'], item: ['tab-items'] };
  var BAG_COLS = 5;     // 背包一排幾格（CSS 的 grid-template-columns 同步）
  var EMPTY_MIN = 35;   // 至少畫幾格（不足補空格），像遊戲裡固定格數的背包
  var bagCat = 'all';
  function activeRightTab() {
    for (var k in TAB_GROUP) { var p = $('tab-' + k); if (p && !p.classList.contains('hidden')) return k; }
    var sk = $('tab-skill'); if (sk && !sk.classList.contains('hidden')) return 'skill';
    return '';
  }
  var subGroup = '';
  function buildSubTabs(group) {
    var bar = $('lmui-bagtabs');
    if (!bar) { bar = document.createElement('div'); bar.id = 'lmui-bagtabs'; bar.className = 'lm-tabs'; document.body.appendChild(bar); }
    if (subGroup === group) return;
    subGroup = group;
    bar.innerHTML = '';
    (SUB_GROUPS[group] || []).forEach(function (x) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('data-t', x.cat ? 'cat:' + x.cat : (x.t || x.btn));   // 背包分類「裝備」與核心分頁「裝備欄」都叫 equip → 分類加前綴
      b.textContent = x.name;
      if (x.icon) {   // 「全部」的 ⇅：已經在全部時再點一次＝整理背包(見 pickBagCat)
        var ic = document.createElement('span'); ic.className = 'lmui-tabicon'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = x.icon;
        b.appendChild(ic); b.title = '再點一次整理背包';
      }
      b.addEventListener('click', function () {
        if (x.cat) { pickBagCat(x.cat); return; }
        closeAllWindows();
        var tb = x.t ? rightTabBtn(x.t) : $(x.btn);
        if (tb) tb.click();
        syncBag();
      });
      bar.appendChild(b);
    });
  }
  // 背包分類：點目前這個「全部」＝整理背包（原本 ↕ 整理鈕的功能；照目前的整理方式排一次，不存檔，同核心「立即排列」）
  function pickBagCat(cat) {
    if (activeRightTab() === 'equip') {
      closeAllWindows();
      var tb = rightTabBtn('items'); if (tb) tb.click();
      bagCat = cat;
      syncBag();
      var g0 = $('game-screen'); if (g0) g0.scrollTop = 0;
      return;
    }
    if (cat === bagCat) {
      if (cat === 'all' && typeof sortInventoryNow === 'function') { try { sortInventoryNow(); } catch (e) { console.warn('[AFK-lmui] 整理背包失敗', e); } }
      syncBag();
      return;
    }
    closeAllWindows();
    bagCat = cat;
    syncBag();
    var gs = $('game-screen'); if (gs) gs.scrollTop = 0;
  }
  // 方格不足一整排/最少格數時補空格（放在自己的 #lmui-bagfill，核心重繪分頁不會動到它）
  function fillEmpty() {
    var panel = $('tab-content-panel'); if (!panel) return;
    var box = $('lmui-bagfill');
    if (!box) { box = document.createElement('div'); box.id = 'lmui-bagfill'; box.setAttribute('aria-hidden', 'true'); panel.appendChild(box); }
    var n = 0;
    (CAT_TABS[bagCat] || []).forEach(function (id) { n += document.querySelectorAll('#' + id + ' .classic-inventory-viewport>.list-item').length; });
    var want = Math.max(EMPTY_MIN, Math.ceil(n / BAG_COLS) * BAG_COLS) - n;
    var have = box.children.length;
    for (; have > want; have--) box.lastElementChild.remove();
    for (; have < want; have++) { var e = document.createElement('div'); e.className = 'lmui-empty'; box.appendChild(e); }
  }
  // 「自動賣出」分類：核心的規則視窗（openAutoSellRules）搬進面板裡的 #lmui-ashost 就地顯示。
  //   在這個分類＝視窗開著（核心草稿制：開窗拍快照、背景自動賣出暫停）；離開分類/換工具/離開手機版面＝走核心 closeAutoSellRules（沒按儲存就還原）。
  //   按「儲存規則／立即賣出」核心會自己關窗 → 還在這個分類就馬上再開一份（見 init 包的 closeAutoSellRules）。
  var asFail = 0;
  function ensureASHost() {
    var h = $('lmui-ashost'); if (h) return h;
    var panel = $('tab-content-panel'); if (!panel) return null;
    h = document.createElement('div'); h.id = 'lmui-ashost';
    panel.appendChild(h);
    return h;
  }
  function syncInlineAS(want) {
    var m = $('autosell-rule-modal'), host = $('lmui-ashost');
    if (!want) {
      if (m && host && host.contains(m)) {
        try { closeAutoSellRules(); } catch (e) { console.warn('[AFK-lmui] 關閉自動賣出規則失敗', e); m.remove(); }
      }
      return;
    }
    host = ensureASHost(); if (!host || !hasP()) return;
    if (!m) {
      if (typeof openAutoSellRules !== 'function' || asFail > 3) return;
      try { openAutoSellRules(); } catch (e) { asFail++; console.warn('[AFK-lmui] 開啟自動賣出規則失敗', e); return; }
      m = $('autosell-rule-modal');
    }
    if (m && m.parentNode !== host) host.appendChild(m);
  }
  function syncBag() {
    var game = document.body.classList.contains('lmui');
    var tab = game && document.body.classList.contains('mview-right') && !document.body.classList.contains('mlog-open') ? activeRightTab() : '';
    var group = TAB_GROUP[tab] || '';
    var bag = group === 'items' && tab !== 'equip';   // 裝備欄掛在背包分頁列，但不是背包格子
    toggleCls('lmui-tall', !!group || tab === 'skill');
    toggleCls('lmui-ptabs', !!SUB_GROUPS[group]);
    toggleCls('lmui-bag', bag);
    toggleCls('lmui-bag-grid', bag && bagCat !== 'as');
    BAG_CATS.forEach(function (c) { toggleCls('lmui-cat-' + c, bag && bagCat === c); });
    toggleCls('lmui-equip', tab === 'equip');
    if (tab === 'equip') { try { renderDoll(); } catch (e) { console.warn('[AFK-lmui] 裝備紙娃娃失敗', e); } }
    syncInlineAS(bag && bagCat === 'as');
    if (!SUB_GROUPS[group]) return;
    buildSubTabs(group);
    var cur = bag ? 'cat:' + bagCat : tab;
    var btns = document.querySelectorAll('#lmui-bagtabs button');
    for (var i = 0; i < btns.length; i++) { var on = btns[i].getAttribute('data-t') === cur; if (btns[i].classList.contains('on') !== on) btns[i].classList.toggle('on', on); }
    if (bag && bagCat !== 'as') fillEmpty();
  }

  // ── HUD 更新 ────────────────────────────────────────────
  function pct(id) { var e = $(id); return e ? (e.style.width || '0%') : '0%'; }
  function pctNum(id) { var v = parseFloat(pct(id)); return isFinite(v) ? Math.round(v) : 0; }
  // 點頭像＝開/關裝備欄(背包分頁列的「裝備欄」同一個畫面)。
  function toggleEquipWin() {
    if (activeRightTab() === 'equip' && document.body.classList.contains('mview-right')) {   // 已開著 → 收回戰鬥畫面
      var c = navBtn('center'); if (c) c.click();
      return;
    }
    closeAllWindows();
    openTab('equip');
  }
  // 頭像固定用職業徽章(以前借戰鬥貼圖當下那一格，攻擊/走路時頭像跟著變)；沒有徽章的職業才退回貼圖。
  function updateFace() {
    if (hasP() && CLASS_LOGO[player.cls]) {
      var logo = 'assets/logo/' + CLASS_LOGO[player.cls] + 'logo.png';
      if (el.face.getAttribute('src') !== logo) el.face.setAttribute('src', logo);
      if (!el.face.classList.contains('logo')) el.face.classList.add('logo');
      return;
    }
    var body = document.querySelector('#player-morph-sprite .pm-body');
    var src = body && body.getAttribute('src');
    if (src) {
      if (el.face.getAttribute('src') !== src) el.face.setAttribute('src', src);
      if (el.face.classList.contains('logo')) el.face.classList.remove('logo');
    }
  }
  var lastMiniSig = '';
  function updateMini() {
    var a = aliveIdx(), sig = a.join(',');
    if (a.length) sig += '|' + a.map(function (i) { return mapState.mobs[i].boss ? 'b' : ''; }).join('');
    if (sig === lastMiniSig) return;
    lastMiniSig = sig;
    var old = el.mini.querySelectorAll('i:not(.me)');
    for (var k = 0; k < old.length; k++) old[k].remove();
    // 怪物依格位排成一圈：位置每格固定（不是真座標，是「場上有幾隻、哪隻是頭目」的示意）
    var n = (mapState && mapState.mobs) ? mapState.mobs.length : 0;
    a.forEach(function (i) {
      var ang = (-150 + (n > 1 ? 120 * i / (n - 1) : 60)) * Math.PI / 180;
      var dot = document.createElement('i');
      if (mapState.mobs[i].boss) dot.className = 'boss';
      dot.style.left = (50 + Math.cos(ang) * 26) + '%';
      dot.style.top = (50 + Math.sin(ang) * 26) + '%';
      el.mini.appendChild(dot);
    });
  }
  // ── 角色名字 / 改名(天堂M介面把原版左欄整個藏起來，原版「點狀態欄名字改名」在這裡點不到 → 自己做一個) ──
  //   規則與創角/原版改名同一套(js/13 characterNameProblem·characterNamesInUse)，存檔走原版 saveGame。
  var renaming = false;
  function updateName() {
    if (!el.name || renaming || !hasP()) return;
    var n = player.name || '';
    setTxt(el.name, n || '（點此取名）');
    if (el.name.classList.contains('empty') === !!n) el.name.classList.toggle('empty', !n);
  }
  function startLmuiRename() {
    if (renaming || !hasP() || !el.name) return;
    renaming = true;
    var cur = String(player.name || '').replace(/"/g, '&quot;');
    el.name.innerHTML = '<input id="lmui-name-input" type="text" maxlength="12" value="' + cur + '" placeholder="2~12 字"><button type="button" id="lmui-name-ok">✓</button>';
    var inp = $('lmui-name-input'), ok = $('lmui-name-ok');
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finishLmuiRename(); } else if (e.key === 'Escape') { renaming = false; updateName(); } });
    ok.addEventListener('click', function (e) { e.stopPropagation(); finishLmuiRename(); });
    inp.focus(); inp.select();
  }
  function finishLmuiRename() {
    var inp = $('lmui-name-input'); if (!inp) { renaming = false; return; }
    var v = inp.value.trim();
    if (v !== (player.name || '')) {
      if (typeof characterNameProblem === 'function') {
        var problem = characterNameProblem(v, typeof characterNamesInUse === 'function' ? characterNamesInUse(currentSlot) : null);
        if (problem) { alert(problem); inp.focus(); return; }
      }
      player.name = v;
      try { if (typeof updateUI === 'function') updateUI(); if (typeof saveGame === 'function' && player.cls) saveGame(); } catch (e) { console.warn('[AFK-lmui] 改名存檔失敗', e); }
    }
    renaming = false;
    updateName();
  }
  // ── 夥伴列(寵物／召喚／迷魅)：一隻一格小圖示，點一下顯示狀態 ─────────────
  //   資料全讀核心：寵物 petsOutList()(js/22)、召喚 summonV2List()(js/23)＋舊制 player.summon、迷魅 player.charmed(js/07)。
  //   迷魅的怪在核心是「從場上移除、變成看不見的幫手」，沒有立繪；血量在這一格和隊伍分頁(js/23 renderCharmTeamHTML)。
  var COLLAR_ICON = encodeURI('assets/icons/items/項圈 (牧羊犬).png');   // 站長決定：所有寵物都用牧羊犬項圈
  var SKILL_ICON = function (n) { return encodeURI('assets/icons/skills/' + n + '.png'); };
  function companions() {
    var out = [];
    try { (typeof petsOutList === 'function' ? petsOutList() : []).forEach(function (p) { out.push({ key: 'pet:' + p.uid, kind: '寵物', icon: COLLAR_ICON, name: p.form, lv: p.lv, hp: p.hp, mhp: p.mhp, mp: p.mp, mmp: p.mmp, down: !!p._downed }); }); } catch (e) {}
    try { (typeof summonV2List === 'function' ? summonV2List() : []).forEach(function (s, i) { out.push({ key: 'sum:' + (s.uid || i), kind: '召喚', icon: SKILL_ICON('召喚術'), name: s.form, lv: s.lv, hp: s.hp, mhp: s.mhp, down: !!s._downed }); }); } catch (e) {}
    if (player.summon) out.push({ key: 'sum:old', kind: '召喚', icon: SKILL_ICON('召喚術'), name: String(player.summon.n || '召喚獸'), end: player.summon.endTick, dice: player.summon.dmgDice, itv: player.summon.interval });
    if (player.charmed) { var ch = player.charmed; out.push({ key: 'charm', kind: '迷魅', icon: SKILL_ICON('迷魅術'), name: String(ch.n || '').replace(/^迷魅：/, ''), lv: ch.lv, hp: ch.hp, mhp: ch.mhp, down: !!ch._downed, end: ch.endTick, dice: ch.dmgDice, itv: ch.interval }); }
    return out;
  }
  var compSig = '', compOpen = null, lastLong = 0;
  function compPopHtml(c) {
    var L = ['<div class="t">' + c.kind + '：' + c.name + (c.lv ? '　Lv' + c.lv : '') + '</div>'];
    if (c.mhp) L.push('HP ' + Math.max(0, Math.floor(c.hp || 0)) + ' / ' + Math.floor(c.mhp) + (c.down ? '　<span style="color:#f87171">倒地中</span>' : ''));
    if (c.mmp) L.push('MP ' + Math.max(0, Math.floor(c.mp || 0)) + ' / ' + Math.floor(c.mmp));
    if (c.dice && c.dice.length === 2) L.push('傷害 ' + c.dice[0] + '～' + (c.dice[0] * c.dice[1]) + '，每 ' + ((c.itv || 10) / 10) + ' 秒攻擊一次');
    if (c.end && typeof state !== 'undefined' && state) { var sec = Math.max(0, Math.floor((c.end - state.ticks) / 10)); L.push('剩餘 ' + Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒'); }
    return L[0] + L.slice(1).join('<br>');   // 標題本身是 div，後面才用 <br> 接(否則標題下多一行空白)
  }
  function updateCompanions() {
    var bar = $('lmui-comp'), pop = $('lmui-comp-pop'); if (!bar || !pop) return;
    var list = hasP() ? companions() : [];
    var sig = list.map(function (c) { return c.key + '|' + (c.mhp ? Math.round(100 * (c.hp || 0) / c.mhp) : '') + '|' + (c.down ? 1 : 0); }).join(',') + '#' + compOpen;
    if (sig !== compSig) {
      compSig = sig;
      bar.innerHTML = list.map(function (c) {
        var pct = c.mhp ? Math.max(0, Math.min(100, Math.round(100 * (c.hp || 0) / c.mhp))) : null;
        return '<button type="button" class="lmui-cp lmui-hit' + (c.down ? ' down' : '') + (compOpen === c.key ? ' on' : '') + '" data-k="' + c.key + '" aria-label="' + c.kind + ' ' + c.name + '">'
          + '<img src="' + c.icon + '" alt="" onerror="this.style.visibility=&quot;hidden&quot;">' + (pct != null ? '<i><b style="width:' + pct + '%"></b></i>' : '') + '</button>';
      }).join('');
    }
    var open = compOpen && list.filter(function (c) { return c.key === compOpen; })[0];
    if (!open) { compOpen = null; pop.classList.add('hidden'); return; }
    var h = compPopHtml(open);
    if (pop.innerHTML !== h) pop.innerHTML = h;
    pop.classList.remove('hidden');
  }
  function bindCompanions() {
    var bar = $('lmui-comp'); if (!bar) return;
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('.lmui-cp'); if (!b) return;
      e.stopPropagation();
      if (Date.now() - lastLong < 700) return;   // 長按放開後跟來的那下 click 不要又把它關掉
      // 點一下＝夥伴視窗(換寵物裝備、設定喝水；js/22 openCompanionPanel)；核心沒有這個函式就退回顯示狀態
      if (typeof openCompanionPanel === 'function') { compOpen = null; compSig = ''; updateCompanions(); openCompanionPanel(); return; }
      var k = b.getAttribute('data-k');
      compOpen = (compOpen === k) ? null : k;
      compSig = ''; updateCompanions();
    });
    document.addEventListener('click', function (e) { if (compOpen && !e.target.closest('#lmui-comp,#lmui-comp-pop')) { compOpen = null; compSig = ''; updateCompanions(); } });
    // 長按也要能看(手機長按不一定觸發 click，Android 會改發 contextmenu)：長按＝打開(不切換)，並擋掉系統選單
    var pressT = null;
    var openKey = function (b) { if (!b) return; lastLong = Date.now(); compOpen = b.getAttribute('data-k'); compSig = ''; updateCompanions(); };
    bar.addEventListener('contextmenu', function (e) { var b = e.target.closest('.lmui-cp'); if (!b) return; e.preventDefault(); openKey(b); });
    bar.addEventListener('touchstart', function (e) { var b = e.target.closest('.lmui-cp'); clearTimeout(pressT); if (b) pressT = setTimeout(function () { openKey(b); }, 450); }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach(function (ev) { bar.addEventListener(ev, function () { clearTimeout(pressT); }, { passive: true }); });
    // 滑鼠也能長按(電腦版)
    bar.addEventListener('mousedown', function (e) { var b = e.target.closest('.lmui-cp'); clearTimeout(pressT); if (b && e.button === 0) pressT = setTimeout(function () { openKey(b); }, 450); });
    ['mouseup', 'mouseleave'].forEach(function (ev) { bar.addEventListener(ev, function () { clearTimeout(pressT); }); });
  }

  function updateStats() {
    updateName();
    setTxt(el.lv, 'Lv.' + (txt('st-lv') || '--'));
    setTxt(el.ac, txt('st-ac') || '--');
    setTxt(el.mr, txt('st-mr') || '--');
    setTxt(el.gold.querySelector('b'), txt('st-gold') || '--');
    setTxt(el.hp.querySelector('span'), 'HP:' + txt('txt-hp') + ' (' + pctNum('bar-hp') + '%)');
    setTxt(el.mp.querySelector('span'), 'MP:' + txt('txt-mp') + ' (' + pctNum('bar-mp') + '%)');
    setTxt(el.exp.querySelector('span'), 'EXP ' + (txt('txt-exp') || (pctNum('bar-exp') + '%')));
    setStyle(el.hp.querySelector('i'), 'width', pct('bar-hp'));
    setStyle(el.mp.querySelector('i'), 'width', pct('bar-mp'));
    setStyle(el.exp.querySelector('i'), 'width', pct('bar-exp'));
    if (hasP()) {
      var v = (typeof pvpClampAlignment === 'function') ? pvpClampAlignment(player.alignmentValue) : (Math.round(+player.alignmentValue || 0));
      var label = (typeof pvpAlignmentLabel === 'function') ? pvpAlignmentLabel(v) : '';
      setTxt(el.align.querySelector('.k'), label);
      setTxt(el.align.querySelector('b'), (v > 0 ? '+' : '') + v);
      el.align.className = label === '正義' ? 'justice' : (label === '邪惡' ? 'evil' : '');
    }
    var ms = $('map-select'), mc = $('map-category');
    setTxt(el.mapname.querySelector('b'), ms && ms.selectedOptions[0] ? ms.selectedOptions[0].text : '');
    setTxt(el.mapname.querySelector('small'), mc && mc.selectedOptions[0] ? mc.selectedOptions[0].text : '');  }

  // F1~F6：先放已學會的手動技能（名單規則同 afk-skillbar，但不讀那支的 DOM），剩下的放身上的藥水/瞬移卷軸
  var lastHotKey = '', lastHotSig = '';
  function manualIds() {
    if (typeof DB === 'undefined' || !DB.skills || !hasP() || !player.skills) return [];
    var out = [];
    for (var id in DB.skills) { var sk = DB.skills[id]; if (sk && sk.type === 'manual' && player.skills.indexOf(id) !== -1) out.push(id); }
    out.sort(function (a, b) { return (+DB.skills[a].tier || 0) - (+DB.skills[b].tier || 0); });
    return out;
  }
  function hotItems() {
    if (typeof DB === 'undefined' || !DB.items || !hasP() || !player.inv) return [];
    var byId = {};
    player.inv.forEach(function (it) {
      var d = it && DB.items[it.id]; if (!d) return;
      if (!(d.type === 'pot' || d.eff === 'teleport_scroll') || d.noUse) return;
      var g = byId[it.id] || (byId[it.id] = { id: it.id, uid: it.uid, n: 0 });
      g.n += (+it.cnt || 1);
    });
    var list = Object.keys(byId).map(function (k) { return byId[k]; });
    list.sort(function (a, b) {
      var ia = HOT_ITEM_ORDER.indexOf(a.id), ib = HOT_ITEM_ORDER.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return list;
  }
  function autoHotPlan() {
    var skills = manualIds(), items = hotItems();
    return skills.map(function (id) { return { kind: 'skill', id: id }; })
      .concat(items.map(function (g) { return { kind: 'item', id: g.id, uid: g.uid, n: g.n }; }))
      .slice(0, HOT_ROW);
  }
  function hotPlan() {
    var c = hotCustom(), out = [];
    if (!c) { var a = autoHotPlan(); for (var i = 0; i < HOT_SLOTS; i++) out.push(a[i] || null); return out; }
    for (var j = 0; j < HOT_SLOTS; j++) {
      var e = c[j];
      if (e && e.k === 'skill' && hotSkillOk(e.id)) out.push({ kind: 'skill', id: e.id });
      else if (e && e.k === 'item' && DB.items[e.id]) out.push({ kind: 'item', id: e.id, uid: hotItemUid(e.id), n: hotItemCount(e.id) });
      else out.push(null);
    }
    return out;
  }
  function updateHot() {
    var plan = hotPlan();
    var key = plan.map(function (p) { return p ? p.kind + ':' + p.id : '-'; }).join(',');
    if (key !== lastHotKey) {
      lastHotKey = key; lastHotSig = '';
      slots.forEach(function (s, i) {
        var p = plan[i] || null;
        s.kind = p ? p.kind : null; s.id = p ? p.id : null;
        if (s.img) { s.img.remove(); s.img = null; }
        s.el.classList.remove('tip-host', 'is-cd', 'is-off'); s.el.removeAttribute('data-tip-skill');   // 長按改成「設定這一格」，不再掛 afk-touchtip 的說明
        setTxt(s.n, ''); setTxt(s.cd, '');
        if (!p) { s.el.removeAttribute('aria-label'); return; }
        var d = p.kind === 'skill' ? DB.skills[p.id] : DB.items[p.id];
        s.img = document.createElement('img'); s.img.alt = '';
        s.img.src = (typeof getIconUrl === 'function') ? getIconUrl(d, p.kind === 'skill') : '';
        s.img.onerror = function () { this.style.display = 'none'; };
        s.el.insertBefore(s.img, s.n);
        s.el.setAttribute('aria-label', d.n || p.id);
      });
    }
    // 數量（道具）與冷卻/MP（技能）：簽章沒變就不動 DOM
    var barrier = false;
    try { barrier = typeof inAbsBarrier === 'function' && inAbsBarrier(); } catch (e) {}
    var sig = barrier ? 'B' : '-';
    var st = plan.map(function (p, i) {
      slots[i].uid = p ? (p.uid || null) : null;
      if (!p) { sig += '|-'; return { off: false }; }
      if (p.kind === 'item') { sig += '|' + p.n; return { n: p.n, off: barrier || !(p.n > 0) }; }
      var sk = DB.skills[p.id], cost = sk.mp || 0;
      try { if (player.d && player.d.getMpCost) cost = player.d.getMpCost(sk.mp || 0, sk.tier); } catch (e) {}
      var cd = Math.ceil(Math.max(0, (player.manualCd && player.manualCd[p.id]) || 0) / TICKS_PER_SEC);
      sig += '|' + cd + ':' + (player.mp < cost ? 1 : 0);
      return { cd: cd, off: barrier || cd > 0 || player.mp < cost };
    });
    if (sig === lastHotSig) return;
    lastHotSig = sig;
    st.forEach(function (x, i) {
      var s = slots[i];
      s.el.classList.toggle('is-cd', (x.cd || 0) > 0);
      s.el.classList.toggle('is-off', x.off);
      setTxt(s.cd, x.cd > 0 ? String(x.cd) : '');
      setTxt(s.n, x.n != null ? (x.n > 999 ? '999+' : String(x.n)) : '');
    });
  }

  // 聊天框：鏡射來源日誌的最後幾行（cloneNode，不搬動原本的節點）
  //   一般＝系統日誌、世界＝世界頻道、戰鬥＝戰鬥日誌、掉落＝系統日誌裡「獲得/掉落」的那幾行
  var CHAT_SRC = { sys: 'sys-log', world: 'world-log', combat: 'combat-log', drop: 'sys-log' };
  var DROP_RE = /獲得|掉落|撿到|得到/;
  var lastChatSig = '', chatDirty = true;
  function linesAtBottom() { var l = el.lines; return !l || l.scrollHeight - l.scrollTop - l.clientHeight < 24; }
  function renderChat(force) {
    var tabs = el.tabs.querySelectorAll('button[data-t]');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-t') === chatTab);
    // 玩家往上捲在看舊訊息 → 先不刷新（同核心日誌的捲動鎖定）；捲回最底時由 scroll 事件補上
    if (!force && !linesAtBottom()) { chatDirty = true; return; }
    var src = $(CHAT_SRC[chatTab]);
    if (!src) { el.lines.innerHTML = ''; return; }
    var kids = src.children, n = kids.length;
    var last = n ? kids[n - 1] : null;
    var sig = chatTab + ':' + n + ':' + (last ? (last.textContent || '').length + (last.textContent || '').slice(-24) : '');
    if (sig === lastChatSig) return;
    lastChatSig = sig;
    var pick = [];
    for (var j = n - 1; j >= 0 && pick.length < CHAT_LINES; j--) {
      if (chatTab === 'drop' && !DROP_RE.test(kids[j].textContent || '')) continue;
      pick.unshift(kids[j]);
      if (chatTab === 'drop' && n - j > 300) break;   // 往回最多翻 300 行，免得長日誌每次掃到底
    }
    var frag = document.createDocumentFragment();
    pick.forEach(function (node) {
      var c = node.cloneNode(true);
      c.removeAttribute('id');
      var withId = c.querySelectorAll('[id]'); for (var k = 0; k < withId.length; k++) withId[k].removeAttribute('id');
      frag.appendChild(c);
    });
    el.lines.innerHTML = '';
    el.lines.appendChild(frag);
    el.lines.scrollTop = el.lines.scrollHeight;
  }
  function watchChat() {
    if (typeof MutationObserver !== 'function') return;
    var mo = new MutationObserver(function () { chatDirty = true; });
    ['sys-log', 'world-log', 'combat-log'].forEach(function (id) { var s = $(id); if (s) mo.observe(s, { childList: true }); });
  }

  // ── 主迴圈 ──────────────────────────────────────────────
  var enteredAt = 0;
  function tick() {
    if (document.hidden) return;
    var game = inGame() && isMobileGeom();
    if (game && !document.body.classList.contains('lmui')) enteredAt = Date.now();
    toggleCls('lmui', game);
    // afk-mobile 一進遊戲就打開日誌（為了讓玩家看到離線結算）——天堂M介面下聊天框「一般」分頁就看得到，收起來別擋戰鬥
    if (game && enteredAt && Date.now() - enteredAt < LOG_AUTOCLOSE_MS && document.body.classList.contains('mlog-open')) {
      var x = $('m-log-close'); if (x) x.click();
      chatTab = 'sys'; lastChatSig = ''; chatDirty = true;
    }
    if (game) { try { syncToolbar(); } catch (e) {} }
    try { syncBag(); } catch (e) {}
    var town = game && !inBattleMap() && inTownView();
    var battle = game && (inBattleMap() || town);   // 不看 mview-*：戰鬥畫面（村莊時＝村莊地圖）在任何分頁都留在上半
    toggleCls('lmui-town', town);
    var tic = $('town-interaction-container');
    toggleCls('lmui-npcwin', !!(town && tic && !tic.classList.contains('hidden')));
    if (!town) toggleCls('lmui-townchat', false);
    if (town) {
      try { hideNpcs(); } catch (e) {}
      try { decorateNpcCards(); } catch (e) {}
      try { layoutTownNpcs(); } catch (e) {}
      try { decorateInteraction(); } catch (e) {}
    } else npcLayoutSig = '';
    toggleCls('lmui-battle', battle);
    try { huntTick(town); } catch (e) {}
    if (!battle) { closeMap(); toggleCls('lmui-dead', false); toggleCls('lmui-deathx', false); toggleCls('lmui-win', false); toggleCls('lmui-chatbig', false); return; }
    // 戰鬥地圖裡不用完整日誌面板（被 CSS 藏起來了）；有人打開它（afk-mobile 登入時自動開）就直接收掉，免得 HUD 跟著被收
    if (document.body.classList.contains('mlog-open')) document.body.classList.remove('mlog-open');
    var dead = isDead();
    toggleCls('lmui-dead', dead);
    if (dead) { try { placeDeadBtn(); buildDeathWin(); renderDeathStats(); } catch (e) {} }
    else toggleCls('lmui-deathx', false);
    try { pushWindowsBelow(); } catch (e) {}
    try { toggleCls('lmui-win', anyWindowOpen()); } catch (e) {}
    try { updatePopover(); } catch (e) {}
    try { updateCompanions(); } catch (e) {}
    if (typeof state !== 'undefined' && state && state.ff) return;   // 離線補跑期間不動畫面
    try { updateStats(); } catch (e) {}
    try { updateFace(); } catch (e) {}
    try { placeMobBars(); } catch (e) {}
    try { updateHot(); } catch (e) {}
    if (chatDirty && document.body.classList.contains('mview-center')) { chatDirty = false; try { renderChat(); } catch (e) {} }
  }

  // ── 技能分頁：分區（通用魔法書／職業魔法／裝備授予）、每階一列（左標籤＋右 4 格），全部攤開 ──
  //   取代上游 1.8 皮膚技能視窗（一次一階、要選階數/切模式）。名單與「學會/可用/點了施放」規則照抄上游
  //   renderClassicSkillBook（js/10），只換版面；用到的判斷全走上游全域（skillReqLv / classicSkillIsClassSkill…）。
  function skillCell(id, granted) {
    var sk = DB.skills[id];
    var learned = (player.skills || []).indexOf(id) !== -1;
    var isGranted = granted.indexOf(id) !== -1;
    var needLv = isGranted ? 0 : (typeof skillReqLv === 'function' ? skillReqLv(sk, id) : undefined);
    var eleOk = !sk.reqEle || player.elfEle === sk.reqEle;
    var eleChosen = !sk.reqEleAny || !!player.elfEle;
    var usable = learned && eleOk && eleChosen && (isGranted || needLv === undefined || player.lv >= needLv);
    var cls = 'lsk-cell tip-host' + (learned ? (usable ? '' : ' is-off') : ' is-unlearned');
    var img = '<img src="' + (typeof getIconUrl === 'function' ? getIconUrl(sk, true) : '') + '" onerror="this.style.display=\'none\'" alt="">';
    var cast = (learned && usable && sk.type === 'manual') ? ' onclick="manualCast(\'' + id + '\')"' : '';
    return '<div class="' + cls + '" data-tip-skill="' + id + '" title="' + (sk.n || '') + '"' + cast + '>' + img + '</div>';
  }
  function skillRows(ids, label, sub, granted) {
    var cells = ids.map(function (id) { return skillCell(id, granted); });
    while (cells.length % 4 || cells.length < 4) cells.push('<div class="lsk-cell is-empty"></div>');
    return '<div class="lsk-row"><div class="lsk-lb"><b>' + label + '</b><small>' + sub + '</small></div><div class="lsk-grid">' + cells.join('') + '</div></div>';
  }
  function byTier(ids) {
    var g = {}, order = [];
    ids.forEach(function (id) { var t = +DB.skills[id].tier || 0; if (!g[t]) { g[t] = []; order.push(t); } g[t].push(id); });
    order.sort(function (a, b) { return a - b; });
    return order.map(function (t) { return { tier: t, ids: g[t] }; });
  }
  function renderSkillList(div) {
    var all = Object.keys(DB.skills).filter(function (id) { return DB.skills[id] && !DB.skills[id].procOnly && id.indexOf('sk_helm_') !== 0; });
    var general = all.filter(function (id) { var sk = DB.skills[id]; return sk.reqM !== undefined && typeof skillReqLv === 'function' && skillReqLv(sk, id) !== undefined; });
    var cls = typeof classicSkillIsClassSkill === 'function' ? all.filter(function (id) { return classicSkillIsClassSkill(DB.skills[id]); }) : [];
    var granted = (player.grantedSkills || []).filter(function (id) { return DB.skills[id]; });
    var classLabel = typeof classicSkillClassLabel === 'function' ? classicSkillClassLabel() : '職業技能';
    var html = '<div class="lsk">';
    if (general.length) {
      html += '<div class="lsk-sec">通用魔法書</div>';
      byTier(general).forEach(function (g) { html += skillRows(g.ids, g.tier + '階', '魔法書', granted); });
    }
    if (cls.length) {
      html += '<div class="lsk-sec">' + classLabel + '</div>';
      byTier(cls).forEach(function (g) { html += skillRows(g.ids, g.tier ? g.tier + '階' : '', classLabel, granted); });
    }
    if (granted.length) {
      html += '<div class="lsk-sec">裝備授予魔法</div>' + skillRows(granted, '裝備', '授予', granted);
    }
    var sp = (player.d && player.d.magicDmg != null) ? Math.round(player.d.magicDmg) : 0;
    var mr = (player.d && player.d.mr != null) ? Math.round(player.d.mr) : 0;
    html += '<div class="lsk-foot"><span>魔法傷害 <b>' + sp + '</b></span><span>魔防 <b>' + mr + '%</b></span></div></div>';
    div.innerHTML = html;
  }

  // ── 怪物血條貼在頭頂：動畫圖四周有大片透明邊，怪物只畫在圖的下半部 → 單靠排版順序血條會浮在半空 ──
  //   第一次看到某隻怪的圖時掃一次像素，找出最上面有顏色的那一列（＝頭頂佔圖高的比例），依怪物資料夾快取；
  //   之後依圖片實際畫出來的範圍（object-fit:contain、貼底）算出頭頂位置，把名字＋血條平移過去。
  //   掃不到（file:// 下 canvas 被視為跨來源、圖還沒載完）就不動，維持在卡片上方。
  //   動畫是逐格換圖、各動作頭頂高低不同 → 每一格都掃（依檔名快取），同一隻怪取「看過的格裡頭頂最高」那個，血條就不會壓到身上。
  var headCache = {}, headTop = {}, headCanvas = null;
  // 回傳這隻怪（依圖片資料夾）目前量到的 {r:頭頂佔圖高比例, w, h:圖原尺寸}；換格中新圖還沒載完也照用舊值
  function headRatio(img) {
    var src = img.currentSrc || img.src;
    if (!src) return null;
    var key = src.replace(/\/[^\/]*$/, '');
    if (!(src in headCache) && img.complete && img.naturalWidth) {
      // 只採待機/走路格：受擊、技能、死亡格常帶特效（噴血、光圈），頭頂會被量到圖框最上緣 → 血條浮到半空
      var fn = src.replace(/^.*\//, '').replace(/[?#].*$/, '');
      var fr = /^(hurt|skill|attack|atk|die|death|dead|cast)/i.test(fn) ? null : scanHead(img);
      headCache[src] = fr;
      if (fr != null && (!headTop[key] || fr < headTop[key].r)) headTop[key] = { r: fr, w: img.naturalWidth, h: img.naturalHeight };
    }
    return headTop[key] || null;
  }
  function scanHead(img) {
    var ratio = null;
    try {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!headCanvas) headCanvas = document.createElement('canvas');
      headCanvas.width = w; headCanvas.height = h;
      var ctx = headCanvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, w, h); ctx.drawImage(img, 0, 0);
      var data = ctx.getImageData(0, 0, w, h).data;
      outer: for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 60) { ratio = y / h; break outer; }
    } catch (e) { ratio = null; }
    return ratio;
  }
  function placeMobBars() {
    var mobs = document.querySelectorAll('#mob-list .mob-target');
    for (var i = 0; i < mobs.length; i++) {
      var m = mobs[i], img = m.querySelector('.mob-img-wrap img'), bar = m.querySelector(':scope>.mob-hp-bar'), nm = m.querySelector(':scope>.mob-name');
      if (!img || !bar) continue;
      var cur = parseFloat(bar.getAttribute('data-lmui-ty')) || 0, ty = 0;
      var hd = headRatio(img);
      if (!hd && cur) continue;
      if (hd) {
        var ib = img.getBoundingClientRect();
        var sc = Math.min(ib.width / hd.w, ib.height / hd.h);
        var drawnH = hd.h * sc;
        var headY = ib.bottom - drawnH + hd.r * drawnH;
        var natTop = bar.getBoundingClientRect().top - cur;   // 沒平移時血條原本的位置
        ty = Math.max(0, Math.round(headY - 6 - natTop));
      }
      if (Math.abs(ty - cur) < 1) continue;
      var t = ty ? 'translateY(' + ty + 'px)' : '';
      bar.style.transform = t; bar.setAttribute('data-lmui-ty', ty);
      if (nm) nm.style.transform = t;
    }
  }

  // ── 裝備分頁：天堂紙娃娃版面（3×5＋底排 4 格＝上游第 1 頁的 19 格；第 2 頁＝魔眼＋席琳遺骸） ──
  //   部位清單與「副手武器佔盾牌格」(offwpn)、點一下開物品視窗、雙擊卸下，都照上游 js/19 的 PAGE_SLOTS / renderSlots。
  var DOLL_PAGES = [
    { grid: ['ear1', 'helm', 'ear2', 'gloves', 'amulet', 'cloak', 'ring1', 'tshirt', 'ring2', 'ring3', 'armor', 'ring4', 'shield', 'wpn', 'arrow'],
      bottom: ['belt', 'shin', 'boots', 'doll'] },
    { grid: ['eye', 'rem_eye', 'rem_blood', 'rem_bone', 'rem_scale', 'rem_fang', 'rem_claw', 'rem_heart', 'rem_flesh'], bottom: [] }
  ];
  var SLOT_NAME = { helm: '頭盔', ear1: '耳環', ear2: '耳環', amulet: '項鍊', gloves: '手套', cloak: '斗篷', tshirt: 'T恤', wpn: '武器', shield: '盾牌', armor: '盔甲',
    ring1: '戒指', ring2: '戒指', ring3: '戒指', ring4: '戒指', belt: '腰帶', shin: '脛甲', boots: '長靴', doll: '魔法娃娃', arrow: '箭', eye: '魔眼',
    rem_eye: '遺骸·眼', rem_blood: '遺骸·血', rem_bone: '遺骸·骨', rem_scale: '遺骸·鱗', rem_fang: '遺骸·牙', rem_claw: '遺骸·爪', rem_heart: '遺骸·心', rem_flesh: '遺骸·肉' };
  var RING = '<circle cx="12" cy="14.5" r="5"/><path d="M10 9.5l2-4 2 4"/>', EAR = '<path d="M9 7a3 3 0 0 1 6 0c0 3-3 3.5-3 7a2 2 0 0 1-4 0"/><circle cx="12" cy="19" r="1.5"/>';
  var RELIC = '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>';
  var SLOT_SVG = {
    helm: '<path d="M5 14a7 7 0 0 1 14 0v4h-4v-4H9v4H5z"/><path d="M12 7v7"/>', ear1: EAR, ear2: EAR,
    amulet: '<path d="M6 4c0 6 3 8.5 6 8.5S18 10 18 4"/><circle cx="12" cy="16" r="3"/>',
    gloves: '<path d="M8 21v-6L5.5 11l1.2-1.2L9 12V5.5h1.6V11V4.5h1.6V11V5.5h1.6V11l1.2-3h1.5l-1.1 6.5V21z"/>',
    cloak: '<path d="M8.5 4h7L19 20H5z"/><path d="M12 4v16"/>',
    tshirt: '<path d="M8.5 4L4 7l2 3 2-1v11h8V9l2 1 2-3-4.5-3c-.5 1.3-1.8 2-3.5 2S9 5.3 8.5 4z"/>',
    wpn: '<path d="M19 5l-9 9M19 5h-3.5M19 5v3.5M7 13l4 4M5 19l3-3"/>',
    shield: '<path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z"/>',
    armor: '<path d="M7.5 4h9l2.5 4-2 2v10H7V10L5 8z"/><path d="M10 4v3h4V4"/>',
    ring1: RING, ring2: RING, ring3: RING, ring4: RING,
    belt: '<path d="M3 10h18v4H3z"/><path d="M10 9h4v6h-4z"/>',
    shin: '<path d="M9 3h6v12l1.5 6h-7.5l-1-6z"/>',
    boots: '<path d="M8 3h5v10l6 3v5H6v-6z"/>',
    doll: '<circle cx="12" cy="7" r="3"/><path d="M8 21v-6l-2-3 3-2h6l3 2-2 3v6z"/>',
    arrow: '<path d="M4 20L18 6M14 6h4v4M4 20l3-1M4 20l1-3"/>',
    eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
  };
  var dollPage = 0, dollSig = '';
  function dollKey(k) { return (k === 'shield' && player.eq.offwpn) ? 'offwpn' : k; }   // 副手武器顯示在盾牌格（同上游 alt）
  function dollCell(k) {
    var key = dollKey(k), item = player.eq[key], data = item && DB.items[item.id];
    if (!item || !data) {
      return '<div class="ld-cell is-empty" title="' + (SLOT_NAME[k] || k) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (SLOT_SVG[k] || RELIC) + '</svg></div>';
    }
    var glow = (typeof getGlowClass === 'function') ? (getGlowClass(item, data) || '') : '';
    var en = Number(item.en) || 0, badge = '';
    if (en > 0) badge = '<span class="ld-en">+' + (typeof capEn === 'function' ? capEn(item.en, data) : en) + '</span>';
    else if ((item.cnt || 1) > 1) badge = '<span class="ld-cnt">' + (item.cnt || 1).toLocaleString() + '</span>';
    return '<div class="ld-cell is-filled tip-host" data-k="' + key + '" data-tip-uid="' + item.uid + '" data-tip-src="eq" title="' + (data.n || '') + '">' +
      '<img src="' + getIconUrl(data) + '" alt="" draggable="false" class="' + glow + '" onerror="this.style.display=\'none\'">' + badge + '</div>';
  }
  function ensureDoll() {
    var d = $('lmui-doll'); if (d) return d;
    var panel = $('tab-content-panel'); if (!panel) return null;
    d = document.createElement('div'); d.id = 'lmui-doll';
    panel.appendChild(d);
    d.addEventListener('click', function (e) {
      var t = e.target.closest('[data-page]');
      if (t) { dollPage = +t.getAttribute('data-page'); dollSig = ''; renderDoll(); return; }
      var c = e.target.closest('.ld-cell.is-filled'); if (!c) return;
      var k = c.getAttribute('data-k'), item = player.eq[k];
      if (item && typeof openModal === 'function') openModal(item, true, k);
    });
    d.addEventListener('dblclick', function (e) {
      var c = e.target.closest('.ld-cell.is-filled'); if (!c) return;
      e.preventDefault();
      if (typeof unequipItem === 'function') unequipItem(c.getAttribute('data-k'));
    });
    return d;
  }
  function renderDoll() {
    if (!hasP() || !player.eq || typeof DB === 'undefined') return;
    var d = ensureDoll(); if (!d) return;
    var pg = DOLL_PAGES[dollPage];
    var sig = dollPage + '|' + pg.grid.concat(pg.bottom).map(function (k) { var it = player.eq[dollKey(k)]; return it ? it.uid + ':' + (it.en || 0) + ':' + (it.cnt || 1) : '-'; }).join(',') + '|' + ((player.d && player.d.weightPct) || 0);
    if (sig === dollSig) return;
    dollSig = sig;
    var w = Math.max(0, Math.round(Number(player.d && player.d.weightPct) || 0));
    d.innerHTML = '<div class="ld-head"><div class="ld-tabs"><button type="button" data-page="0" class="' + (dollPage === 0 ? 'on' : '') + '" aria-label="裝備"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4.5 3-7.5 7-7.5s7 3 7 7.5"/></svg></button>' +
      '<button type="button" data-page="1" class="' + (dollPage === 1 ? 'on' : '') + '" aria-label="席琳遺骸" title="席琳遺骸"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + RELIC + '</svg></button></div>' +
      '<div class="ld-weight">負重 ' + w + ' %</div></div>' +
      '<div class="ld-grid">' + pg.grid.map(dollCell).join('') + '</div>' +
      (pg.bottom.length ? '<div class="ld-bottom">' + pg.bottom.map(dollCell).join('') + '</div>' : '');
  }

  function addCompareBtn() {
    document.body.classList.remove('lmui-cmp');
    // 「標記為廢品」勾選列：玩家要求拿掉（只藏，不動核心的廢品資料）
    var acts0 = $('modal-actions');
    if (acts0) {
      var labels = acts0.querySelectorAll('label');
      for (var i = 0; i < labels.length; i++) if (/標記為廢品/.test(labels[i].textContent || '')) labels[i].style.display = 'none';
    }
    var cmp = $('modal-compare'), acts = $('modal-actions');
    if (!acts || $('lmui-cmp-btn')) return;
    if (!cmp || cmp.classList.contains('hidden') || !(cmp.textContent || '').trim()) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'lmui-cmp-btn'; b.className = 'btn';
    b.textContent = '⚖ 與身上比較';
    b.addEventListener('click', function () { document.body.classList.toggle('lmui-cmp'); });
    acts.insertBefore(b, acts.firstChild);
  }

  function init() {
    if (!$('game-screen') || !$('battle-view') || !$('map-view-panel')) {
      console.warn('[AFK-lmui] 找不到 #game-screen / #battle-view / #map-view-panel（上游可能改了結構），天堂M介面停用。');
      return;
    }
    injectCSS();
    build();
    watchChat();
    bindMobClick();
    // 道具卡片：有裝備比對內容時，在按鈕區最上面補一顆「與身上比較」（比對預設收起）。
    //   包核心 openModal：核心每次開啟都重畫 #modal-actions，所以每次都要補；收起狀態也每次重置。
    if (typeof window.openModal === 'function') {
      var _origOpenModal = window.openModal;
      window.openModal = function () {
        var r = _origOpenModal.apply(this, arguments);
        try { addCompareBtn(); } catch (e) {}
        try { updatePopover(); } catch (e) {}
        return r;
      };
    }
    // 背包「自動賣出」分類：核心規則視窗每次重畫（加/刪個別例外）都是砍掉重建在 body 上 → 建好當下就搬回面板，不閃滿版遮罩；
    //   核心關窗（儲存規則/立即賣出）後下一輪 syncBag 會在還停在這個分類時重開。只在 body.lmui-cat-as（本外掛設的）時動作，其餘照原版。
    if (typeof window.openAutoSellRules === 'function') {
      var _origOpenAS = window.openAutoSellRules;
      window.openAutoSellRules = function () {
        var r = _origOpenAS.apply(this, arguments);
        if (document.body.classList.contains('lmui-cat-as')) { try { syncInlineAS(true); } catch (e) {} }
        return r;
      };
    }
    if (typeof window.closeAutoSellRules === 'function') {
      var _origCloseAS = window.closeAutoSellRules;
      window.closeAutoSellRules = function () {
        var r = _origCloseAS.apply(this, arguments);
        if (document.body.classList.contains('lmui-cat-as')) setTimeout(function () { try { syncBag(); } catch (e) {} }, 0);
        return r;
      };
    }
    // 怪物重畫（換怪/換目標）後立刻把名字＋血條擺回頭頂，不等下一個 tick（否則會先在卡片頂端閃一下）
    try { hookHunt(); } catch (e) {}
    try { hookPause(); } catch (e) { console.warn('[AFK-lmui] AUTO 暫停掛不上', e); }
    //   包 _renderMobsImpl（真正寫 DOM 的那支）：戰鬥 tick 中 renderMobs 只標記 dirty，之後由 flushTickRender 直呼 _renderMobsImpl，包外層會漏掉
    var MOB_RENDER = typeof window._renderMobsImpl === 'function' ? '_renderMobsImpl' : 'renderMobs';
    if (typeof window[MOB_RENDER] === 'function') {
      var _origRenderMobs = window[MOB_RENDER];
      window[MOB_RENDER] = function () {
        var r = _origRenderMobs.apply(this, arguments);
        if (document.body.classList.contains('lmui-battle')) { try { placeMobBars(); } catch (e) {} }
        return r;
      };
    }
    // 技能分頁：天堂M介面開著（手機遊戲畫面）時改畫攤開的清單版面，其餘情況交回上游原版
    if (typeof window.renderClassicSkillBook === 'function') {
      var _origSkillBook = window.renderClassicSkillBook;
      window.renderClassicSkillBook = function (div) {
        if (div && typeof player !== 'undefined' && player && document.body.classList.contains('lmui') && typeof DB !== 'undefined') {
          try { renderSkillList(div); return; } catch (e) { console.warn('[AFK-lmui] 技能清單版面失敗，改用原版', e); }
        }
        return _origSkillBook.apply(this, arguments);
      };
    }
    // 地圖面板：換地圖、按了回村/瞬移/黑市就收起
    var ms = $('map-select'); if (ms) ms.addEventListener('change', closeMap);
    var hd = document.querySelector('#map-view-panel>.panel-header');
    if (hd) hd.addEventListener('click', function (e) { if (e.target.closest('button')) setTimeout(closeMap, 0); });
    setInterval(tick, TICK_MS);
    tick();
    console.log('[AFK-lmui] hooks OK — 天堂M風格介面已啟用。');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
