// ============================================================
// js/35-daynight.js — 🌗 日夜系統（2026-10-15 站長規則，照經典版天堂）
//   ・遊戲時鐘＝真實時間 ×6（遊戲裡一天＝真實 4 小時）；06:00～18:00 白天、18:00～06:00 夜晚。
//     以真實時間（Date.now）算，所有玩家、所有裝置看到的是同一個時間，關掉遊戲也照走。
//   ・夜晚：不死系、惡魔系怪物 HP 與傷害 +20%（打玩家、寵物、召喚物、迷魅的怪都算）；
//           邪惡魔法傷害 +5%、有害魔法成功率 +5%。白天：正義魔法傷害 +5%。（戰鬥那邊讀這裡的函式）
//   ・夜晚戰鬥畫面變暗；日光術或點亮的燈籠＝照明，畫面恢復正常（只影響畫面）。
//   ・天亮／天黑時畫面正中央跳一行字幕＋系統訊息。
//   ・燈籠（一般商店 3,000）：點了可開／關，燈油 100 分鐘；可勾「自動補給燈油」（每次 500 金幣）。
//   ・時鐘：功能選單（js/00z）的「時鐘」打開。
// ============================================================
'use strict';

const GAME_CLOCK_SPEED = 6;
const NIGHT_START_MIN = 18 * 60, NIGHT_END_MIN = 6 * 60;
const NIGHT_EVIL_MULT = 1.2;           // 夜晚不死／惡魔：HP、傷害
const NIGHT_EVIL_SPELL_MULT = 1.05;    // 夜晚邪惡魔法傷害
const NIGHT_HARM_SPELL_BONUS = 0.05;   // 夜晚有害魔法成功率 +5%
const DAY_JUSTICE_SPELL_MULT = 1.05;   // 白天正義魔法傷害
const LANTERN_FUEL_SEC = 100 * 60;     // 一次燈油 100 分鐘
const LANTERN_REFILL_COST = 500;

function gameClockMinutes(ms) {   // 遊戲時間（一天 0～1439 分）
    let t = (ms == null ? Date.now() : ms) * GAME_CLOCK_SPEED / 60000;
    return Math.floor(t % 1440);
}
function gameClockText(ms) { let m = gameClockMinutes(ms); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function isNightTime(ms) { let m = gameClockMinutes(ms); return m >= NIGHT_START_MIN || m < NIGHT_END_MIN; }
function realMinutesToSwitch(ms) {   // 真實時間還有幾分鐘換日夜
    let m = gameClockMinutes(ms), target = isNightTime(ms) ? NIGHT_END_MIN : NIGHT_START_MIN;
    let gameLeft = (target - m + 1440) % 1440;
    return Math.max(1, Math.ceil(gameLeft / GAME_CLOCK_SPEED));
}
// 不死系：un 旗標＋這幾種族（殭屍／吸血鬼／巫妖…）；惡魔系：種族「惡魔」
const EVIL_UNDEAD_RACES = ['不死', '殭屍', '吸血鬼', '巫妖', '死神', '靈魂', '鬼火'];
function evilKind(m) {
    if (!m) return '';
    if (m.un || EVIL_UNDEAD_RACES.includes(m.race)) return 'undead';
    if (m.race === '惡魔') return 'demon';
    return '';
}
function isEvilMob(m) { return !!evilKind(m); }
// 不死／惡魔的狂暴傷害：夜晚 ×1.2；頭目白天也 ×1.1（打玩家、寵物、召喚物、迷魅都套）
const DAY_EVIL_BOSS_MULT = 1.1;
function evilDmgMult(m) {
    if (!isEvilMob(m)) return 1;
    if (isNightTime()) return NIGHT_EVIL_MULT;
    return m.boss ? DAY_EVIL_BOSS_MULT : 1;
}
// 🛡️ 祝福的頭盔／手套／靴子／內衣／盔甲／斗篷／盾牌（共 7 格）：每件抵掉狂暴多出來那段的 10%；7 件＝抵掉 70%，原本的傷害不會被減
const BLESS_ARMOR_CUT = 0.10;
const BLESS_ARMOR_SLOTS = ['helm', 'gloves', 'boots', 'tshirt', 'armor', 'cloak', 'shield'];
function blessArmorPieces() {
    if (typeof player === 'undefined' || !player || !player.eq) return 0;
    let n = 0;
    BLESS_ARMOR_SLOTS.forEach(k => { let e = player.eq[k]; if (e && e.bless === true) n++; });
    return n;
}
function playerEvilDmgMult(mob) {   // 打玩家用：狂暴倍率，祝福防具把多出來的那段扣掉一部分
    let m = evilDmgMult(mob); if (m <= 1) return 1;
    return 1 + (m - 1) * Math.max(0, 1 - BLESS_ARMOR_CUT * blessArmorPieces());
}
// ✨ 魔法的日夜加成：夜晚邪惡魔法 +5%、白天正義魔法 +5%（召喚術、造屍術不算）
const EVIL_SPELLS = ['sk_cold_shiver', 'sk_vampire', 'sk_darkwave', 'sk_demon_kiss', 'sk_hell_fang'];
const JUSTICE_SPELLS = ['sk_lightarrow', 'sk_disintegrate', 'sk_holy_lightning'];
function spellDayNightMult(skId) {
    if (!skId) return 1;
    let night = isNightTime();
    if (night && EVIL_SPELLS.includes(skId)) return NIGHT_EVIL_SPELL_MULT;
    if (!night && JUSTICE_SPELLS.includes(skId)) return DAY_JUSTICE_SPELL_MULT;
    return 1;
}
// 有害魔法（玩家施放、會被抵抗的異常狀態魔法）夜晚成功率 +5%＝命中判定 +1（d20 一格＝5%）
let _harmStatusSet = null;
function nightHarmHitOff(st) {
    if (!st || !isNightTime() || typeof DB === 'undefined') return 0;
    if (!_harmStatusSet) { _harmStatusSet = new Set(); for (let id in DB.skills) { let s = DB.skills[id]; if (s && s.status && !s.procOnly && !/^sk_relic_/.test(id)) _harmStatusSet.add(s.status); } }
    return _harmStatusSet.has(st) ? 1 : 0;
}
// 出生時：夜晚的不死／惡魔 HP +20%（js/05 applySherineBuff 尾端呼叫，每隻只加一次）
function applyNightSpawnBuff(m) {
    if (!m || m._nightBuff || !isNightTime() || !isEvilMob(m)) return;
    m._nightBuff = true;
    m.hp = Math.floor((m.hp || 1) * NIGHT_EVIL_MULT); m.curHp = m.hp;
}
function playerHasLight() {
    if (typeof player === 'undefined' || !player) return false;
    return ((player.buffs && player.buffs.sk_sunlight) || 0) > 0 || !!(player.lantern && player.lantern.on && player.lantern.fuel > 0);
}

// ── 夜晚畫面變暗（照明時不暗）──
function _dnShadeEl() {
    let bv = document.getElementById('battle-view'); if (!bv) return null;
    let el = document.getElementById('night-shade');
    if (!el) {
        el = document.createElement('div');
        el.id = 'night-shade';
        el.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;background:radial-gradient(ellipse at 35% 60%, rgba(10,14,40,.35), rgba(5,6,22,.72));transition:opacity 1.5s;opacity:0;';
        if (getComputedStyle(bv).position === 'static') bv.style.position = 'relative';
        bv.appendChild(el);
    }
    return el;
}
function _dnRenderShade() {
    let el = _dnShadeEl(); if (!el) return;
    let on = isNightTime() && typeof player !== 'undefined' && player && player.cls && !playerHasLight();
    let op = on ? '1' : '0';
    if (el.style.opacity !== op) el.style.opacity = op;
}

// ── 天亮／天黑字幕 ──
const DN_CAPTION = {
    night: '夜幕籠罩大地……不死者與惡魔的低語，正在黑暗中甦醒。',
    day: '晨光刺破長夜，邪惡的氣息悄然退散。'
};
function _dnCaption(kind) {
    let txt = DN_CAPTION[kind];
    try { if (typeof logSys === 'function') logSys(`<span style="color:${kind === 'night' ? '#a5b4fc' : '#fde68a'};font-weight:bold;">${kind === 'night' ? '🌙' : '☀️'} ${txt}</span>`); } catch (e) {}
    let old = document.getElementById('dn-caption'); if (old) old.remove();
    let el = document.createElement('div');
    el.id = 'dn-caption';
    el.textContent = txt;
    el.style.cssText = 'position:fixed;left:50%;top:34%;transform:translate(-50%,-50%);z-index:9000;pointer-events:none;width:max-content;max-width:88vw;box-sizing:border-box;padding:10px 18px;text-align:center;' +
        'font-size:17px;font-weight:bold;letter-spacing:1px;color:' + (kind === 'night' ? '#c7d2fe' : '#fef3c7') + ';text-shadow:0 0 8px #000,0 2px 3px #000;' +
        'background:linear-gradient(90deg,transparent,rgba(0,0,0,.6),transparent);opacity:0;transition:opacity 1.2s;';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => { el.style.opacity = '0'; }, 4200);
    setTimeout(() => { el.remove(); }, 5600);
}
let _dnLastNight = null;
function _dnTick() {
    try {
        let night = isNightTime();
        let inGame = typeof player !== 'undefined' && player && player.cls;
        if (_dnLastNight !== null && night !== _dnLastNight && inGame) _dnCaption(night ? 'night' : 'day');
        _dnLastNight = night;
        _dnLanternBurn();
        _dnRenderShade();
        _dnRenderClock();
    } catch (e) { console.warn('[daynight]', e); }
}
setInterval(_dnTick, 1000);

// ── 燈籠 ──
//   player.lantern = { on, fuel(剩餘秒數), auto(自動補燈油) }；照遊戲 tick 扣燈油（暫停時不扣、離線補跑會扣）
let _dnLastTicks = null;
function _dnLanternBurn() {
    if (typeof player === 'undefined' || !player || !player.cls || typeof state === 'undefined') { _dnLastTicks = null; return; }
    let L = player.lantern, now = state.ticks || 0;
    if (_dnLastTicks === null || now < _dnLastTicks) { _dnLastTicks = now; return; }
    let sec = (now - _dnLastTicks) / 10; _dnLastTicks = now;
    if (!L || !L.on || sec <= 0) return;
    L.fuel = Math.max(0, (L.fuel || 0) - sec);
    if (L.fuel > 0) return;
    if (L.auto && (player.gold || 0) >= LANTERN_REFILL_COST) {
        player.gold -= LANTERN_REFILL_COST; L.fuel = LANTERN_FUEL_SEC;
        logSys(`燈油用完了，自動補充燈油（${LANTERN_REFILL_COST} 金幣）。`);
    } else {
        L.on = false;
        logSys('燈油用完了，燈籠熄滅。');
    }
    try { updateUI(); } catch (e) {}
}
function lanternState() {
    if (!player.lantern) player.lantern = { on: false, fuel: LANTERN_FUEL_SEC, auto: false };
    return player.lantern;
}
function openLanternPanel() {
    if (typeof player === 'undefined' || !player || !player.cls) return;
    let L = lanternState();
    let old = document.getElementById('lantern-overlay'); if (old) old.remove();
    let ov = document.createElement('div');
    ov.id = 'lantern-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:97;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:12px;';
    let render = () => {
        let mins = Math.ceil((L.fuel || 0) / 60);
        ov.innerHTML = `<div style="width:100%;max-width:300px;background:#0f0c09;border:1px solid #b7791f;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;color:#eee;">
            <div style="display:flex;justify-content:space-between;align-items:center;color:#fbbf24;font-weight:bold;font-size:16px;"><span style="display:flex;align-items:center;gap:6px;"><img src="assets/icons/items/燈籠.png" alt="" style="width:28px;height:28px;">燈籠</span><button type="button" data-x="1" style="background:none;border:0;color:#aaa;font-size:18px;cursor:pointer;">✕</button></div>
            <div style="color:${L.on ? '#fde68a' : '#94a3b8'};">${L.on ? '點亮中' : '熄滅'}・燈油剩 ${mins} 分鐘</div>
            <div style="display:flex;gap:6px;">
                <button type="button" data-act="on" class="btn font-bold" style="flex:1;padding:8px;${L.on ? 'opacity:.5;' : ''}">打開</button>
                <button type="button" data-act="off" class="btn font-bold" style="flex:1;padding:8px;${L.on ? '' : 'opacity:.5;'}">關閉</button>
            </div>
            <button type="button" data-act="refill" class="btn font-bold" style="padding:8px;display:flex;align-items:center;justify-content:center;gap:6px;"><img src="assets/icons/items/燈油.png" alt="" style="width:24px;height:24px;">補充燈油（${LANTERN_REFILL_COST} 金幣）</button>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" data-act="auto" ${L.auto ? 'checked' : ''} style="width:16px;height:16px;">自動補給燈油</label>
        </div>`;
    };
    render();
    ov.addEventListener('click', e => {
        if (e.target === ov || e.target.closest('[data-x]')) { ov.remove(); return; }
        let b = e.target.closest('[data-act]'); if (!b) return;
        let act = b.getAttribute('data-act');
        if (act === 'on') {
            if ((L.fuel || 0) <= 0) { logSys('燈籠沒有燈油了，先補充燈油。'); return; }
            L.on = true; logSys('點亮了燈籠。');
        } else if (act === 'off') { L.on = false; logSys('熄滅了燈籠。'); }
        else if (act === 'refill') {
            if ((player.gold || 0) < LANTERN_REFILL_COST) { logSys(`金幣不足 ${LANTERN_REFILL_COST}。`); return; }
            player.gold -= LANTERN_REFILL_COST; L.fuel = LANTERN_FUEL_SEC; logSys(`補充了燈油（${LANTERN_REFILL_COST} 金幣）。`);
        } else if (act === 'auto') { L.auto = !!b.checked; return; }
        try { updateUI(); } catch (e2) {}
        _dnRenderShade();
        render();
    });
    document.body.appendChild(ov);
}

// ── 時鐘：功能鈕左邊的小轉盤（上半圈看得到天空，太陽／月亮跟著遊戲時間轉），點一下冒出時間 ──
const DN_CLOCK_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true">
    <defs>
        <linearGradient id="dnc-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d58a"/><stop offset=".5" stop-color="#9c7a40"/><stop offset="1" stop-color="#4a3418"/></linearGradient>
        <linearGradient id="dnc-plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b5330"/><stop offset="1" stop-color="#2a1d0e"/></linearGradient>
        <radialGradient id="dnc-day" cx="50%" cy="30%" r="70%"><stop offset="0" stop-color="#d6f0ff"/><stop offset="1" stop-color="#3f8fd6"/></radialGradient>
        <radialGradient id="dnc-night" cx="50%" cy="70%" r="70%"><stop offset="0" stop-color="#2b2f72"/><stop offset="1" stop-color="#0b0f2e"/></radialGradient>
        <clipPath id="dnc-win"><path d="M5 21 A15 15 0 0 1 35 21 Z"/></clipPath>
    </defs>
    <circle cx="20" cy="20" r="18.5" fill="#120c06" stroke="url(#dnc-rim)" stroke-width="2.2"/>
    <g clip-path="url(#dnc-win)"><g class="dnc-disc">
        <path d="M5 21 A15 15 0 0 1 35 21 Z" fill="url(#dnc-day)"/>
        <path d="M5 21 A15 15 0 0 0 35 21 Z" fill="url(#dnc-night)"/>
        <circle cx="20" cy="10" r="5" fill="#ffd54a" opacity=".35"/>
        <circle cx="20" cy="10" r="3.6" fill="#ffd54a" stroke="#f59e0b" stroke-width=".9"/>
        <path d="M22.6 29.2 A4 4 0 1 1 22.6 34.8 A3.1 3.1 0 1 0 22.6 29.2 Z" fill="#fff3bf"/>
        <circle cx="12" cy="27" r=".7" fill="#fff"/><circle cx="28" cy="26.5" r=".6" fill="#fff"/><circle cx="27" cy="33.5" r=".6" fill="#fff"/><circle cx="13.5" cy="32.5" r=".5" fill="#fff"/>
    </g></g>
    <path d="M3.4 21 H36.6 A16.6 16.6 0 0 1 3.4 21 Z" fill="url(#dnc-plate)"/>
    <path d="M4.5 21 H35.5" stroke="#f3d58a" stroke-width="1.2"/>
    <path d="M20 23.5 v3 M13.2 24.2 l1.2 2.6 M26.8 24.2 l-1.2 2.6" stroke="#c4a056" stroke-width="1" stroke-linecap="round" opacity=".8"/>
    <circle cx="20" cy="31" r="1.7" fill="#c4a056" stroke="#2a1d0e" stroke-width=".6"/>
</svg>`;
let _dnClockAng = null;
function _dnClockEl() {
    let el = document.getElementById('dn-clock');
    if (!el) {
        if (!document.getElementById('dn-clock-css')) {
            let st = document.createElement('style'); st.id = 'dn-clock-css';
            st.textContent = '#dn-clock{position:relative;width:40px;height:40px;padding:0;border:0;background:none;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent}' +
                '#dn-clock>svg{width:100%;height:100%;display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.8))}' +
                '#dn-clock .dnc-disc{transform-origin:20px 21px;transform-box:view-box;transition:transform 1s linear}' +
                '#lmui-vit>#dn-clock{position:absolute;right:54px;bottom:100%;margin-bottom:6px;z-index:5}' +
                'body>#dn-clock{position:fixed;top:8px;right:54px;z-index:90}' +
                '#dn-clock .dnc-tip{position:absolute;right:0;bottom:calc(100% + 6px);display:none;white-space:nowrap;padding:5px 10px;border:1px solid #9c7a40;border-radius:6px;background:rgba(15,11,6,.92);color:#f0e2bf;font-size:13px;font-weight:700;line-height:1.35;text-align:right;box-shadow:0 2px 6px #000}' +
                'body>#dn-clock .dnc-tip{top:calc(100% + 6px);bottom:auto}' +
                '#dn-clock .dnc-tip b{display:block;font-size:18px;letter-spacing:1px}' +
                '#dn-clock.tip .dnc-tip{display:block}';
            document.head.appendChild(st);
        }
        el = document.createElement('button');
        el.type = 'button'; el.id = 'dn-clock'; el.className = 'lmui-hit'; el.setAttribute('aria-label', '時鐘');
        el.innerHTML = DN_CLOCK_SVG + '<span class="dnc-tip"></span>';
        el.addEventListener('click', e => {
            e.stopPropagation();
            el.classList.toggle('tip');
            clearTimeout(el._tipT);
            if (el.classList.contains('tip')) { _dnClockTip(el); el._tipT = setTimeout(() => el.classList.remove('tip'), 5000); }
        });
        document.addEventListener('click', e => { if (!e.target.closest || !e.target.closest('#dn-clock')) el.classList.remove('tip'); }, true);
        _dnClockAng = null;
    }
    return el;
}
function _dnClockTip(el) {
    let night = isNightTime(), tip = el.querySelector('.dnc-tip'); if (!tip) return;
    let html = `<b style="color:${night ? '#c7d2fe' : '#fde68a'}">${gameClockText()}</b>${night ? '夜晚' : '白天'}・約 ${realMinutesToSwitch()} 分鐘後${night ? '天亮' : '天黑'}`;
    if (tip.innerHTML !== html) tip.innerHTML = html;
}
// 跟著功能鈕（#my-mail-btn）擺：同一個容器、在它左邊；功能鈕沒顯示（沒進角色）就藏起來
function _dnRenderClock() {
    let fn = document.getElementById('my-mail-btn');
    let show = fn && fn.parentNode && fn.style.display !== 'none' && typeof player !== 'undefined' && player && player.cls;
    let el = document.getElementById('dn-clock');
    if (!show) { if (el) { el.style.display = 'none'; el.classList.remove('tip'); } return; }
    el = _dnClockEl();
    if (el.parentNode !== fn.parentNode) fn.parentNode.insertBefore(el, fn);
    if (el.style.display) el.style.display = '';
    let ang = Math.round((gameClockMinutes() / 1440 * 360 - 180) * 2) / 2;   // 正午太陽在正上方、午夜月亮在正上方；6 點太陽在左、18 點在右
    if (ang !== _dnClockAng) {
        let disc = el.querySelector('.dnc-disc');
        if (disc) {
            let jump = _dnClockAng === null || Math.abs(ang - _dnClockAng) > 90;   // 第一次或跨過 -180/180 不要轉一大圈
            if (jump) disc.style.transition = 'none';
            disc.style.transform = `rotate(${ang}deg)`;
            if (jump) requestAnimationFrame(() => requestAnimationFrame(() => { disc.style.transition = ''; }));
        }
        _dnClockAng = ang;
    }
    if (el.classList.contains('tip')) _dnClockTip(el);
}
