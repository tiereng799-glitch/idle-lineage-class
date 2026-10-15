// ============================================================================
// ⚒️ 裝備強化視窗（站長 2026-10-15：照範本圖改版）
//   上：卷軸格 ＋ 要強化的裝備（站長：裝備放右邊；點卷軸格切換 一般／祝福／詛咒）
//   中：成功機率｜強化等級 +N → +N+1｜消失機率，下面列強化前後的能力變化；開始強化鈕（與「連續強化到 +X」）
//   下：分頁（武器／防具／飾品）＋道具格，圖示下方顯示名稱，點一下換成要強化的裝備
//   不顯示金幣（強化本來就不花錢）。
//   規則一律走原本那套：單次＝doEnhance（js/08）、連續＝executeAutoSafeEnhance、詛咒卷軸＝executeCurseDeEnhance（js/10）；
//   機率由 enhanceOutcomeFromRoll（js/01，機率單一真相）均勻取樣算出，不另外抄一份公式。
//   入口：物品視窗的「強化」鈕（js/10 showEnhanceOptions 轉進來）。
// ============================================================================
(function () {
    'use strict';
    const TABS = [['wpn', '武器'], ['arm', '防具'], ['acc', '飾品']];
    let st = { uid: null, isEq: false, tab: 'wpn', scrollPick: 0, result: null };

    const $ = id => document.getElementById(id);
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const pct = x => { let v = Math.round(x * 1000) / 10; return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + '%'; };

    function enhanceable(d) { return !!d && ((d.type === 'wpn' && !d.isArrow) || d.type === 'arm' || d.type === 'acc') && !isRelic(d) && !d.noEnhance; }
    function findItem(uid, isEq) {
        if (isEq) { for (let k in player.eq) { let e = player.eq[k]; if (e && e.uid === uid) return e; } return null; }
        return player.inv.find(i => i && i.uid === uid) || null;
    }
    // 道具格清單：身上的在前、背包的在後（同一疊只列一格）
    function listItems(type) {
        let out = [];
        for (let k in player.eq) {
            let e = player.eq[k]; if (!e || k === 'arrow') continue;
            let d = DB.items[e.id]; if (enhanceable(d) && d.type === type) out.push({ it: e, isEq: true });
        }
        player.inv.forEach(i => { let d = i && DB.items[i.id]; if (enhanceable(d) && d.type === type) out.push({ it: i, isEq: false }); });
        return out;
    }
    // 這件裝備能用的卷軸（依序：一般、祝福、詛咒；沒有的不列）
    function scrollsFor(d) {
        let ids = d.type === 'wpn' ? ['scroll_weapon', 'scroll_weapon_b', 'scroll_weapon_c']
                : d.type === 'arm' ? ['scroll_armor', 'scroll_armor_b', 'scroll_armor_c']
                : ['scroll_acc'];
        return ids.map(id => player.inv.find(i => i && i.id === id && (i.cnt || 0) > 0)).filter(Boolean);
    }
    // 機率：對 enhanceOutcomeFromRoll 均勻取樣（安定值內不擲骰＝必成）
    function chances(d, en) {
        let safe = d.safe || 0, N = 6000, c = { ok: 0, break: 0, none: 0 };
        if (en < safe) return { ok: 1, break: 0, none: 0 };
        for (let i = 0; i < N; i++) c[enhanceOutcomeFromRoll(d.type, safe, en, (i + 0.5) / N)]++;
        return { ok: c.ok / N, break: c.break / N, none: c.none / N };
    }
    // 強化值 en 時，這件裝備「隨強化變動」的能力（只列會變的）
    function statRows(d, en) {
        let rows = [], ce = capEn(en, d);
        let sign = v => (v > 0 ? '+' : '') + v;
        if (d.type === 'wpn') {
            let b = enhanceWpnBonus(capWpnEn(en));
            rows.push(['額外傷害', sign(b.dmg)], ['額外命中', sign(b.hit)]);
            if (d.mdmgEnFrom7Max3) rows.push(['魔法傷害', sign(Math.min(3, Math.max(0, ce - 6)))]);
        } else if (d.type === 'arm') {
            if (d.armguard) rows.push(['HP', sign(ce * 10)]);
            else rows.push(['防禦', String(-((d.ac || 0) + enhanceArmAc(en)))]);
            if (d.mdmgEnFrom4) rows.push(['魔法傷害', sign(Math.min(6, Math.max(0, ce - 3)))]);
            if (d.drEnFrom7Max3) rows.push(['傷害減免', sign((d.dr || 0) + Math.min(3, Math.max(0, ce - 6)))]);
        } else if (d.type === 'acc') {
            let ae = Math.min(Math.max(Number(en) || 0, 0), 5);
            if (d.slot === 'ring') rows.push(['防禦', String(-((d.ac || 0) + ae))]);
            else if (d.slot === 'amulet') rows.push(['魔防', sign((d.mr || 0) + ae * 3)]);
            else if (d.slot === 'ear') rows.push(['魔防', sign((d.mr || 0) + ae * 2)]);
            else if (d.slot === 'belt') rows.push(['負重上限', sign(ae * 20)]);
        }
        if (d.mrPerEn) rows.push(['魔防', sign((d.mr || 0) + d.mrPerEn * ce)]);
        return rows;
    }
    function iconHTML(it, d, cls) {
        let src = ''; try { src = getIconUrl(d); } catch (e) {}
        let glow = ''; try { glow = getGlowClass(it, d) || ''; } catch (e) {}
        return `<img class="${cls} ${glow}" src="${esc(src)}" alt="" draggable="false" onerror="this.style.visibility='hidden'">`;
    }
    function enTag(en, d) { en = Number(en) || 0; return en ? `<span class="enh-en${d && en > (d.safe || 0) ? ' en-over' : ''}"><b>${en > 0 ? '+' : ''}${en}</b></span>` : ''; }

    function render() {
        let win = $('enh-window'); if (!win) return;
        let it = st.uid ? findItem(st.uid, st.isEq) : null;
        let d = it ? DB.items[it.id] : null;
        if (it && !enhanceable(d)) { it = null; d = null; }
        let en = it ? (Number(it.en) || 0) : 0;
        let cap = d ? enhanceCap(d) : 0;
        let scrolls = d ? scrollsFor(d) : [];
        if (st.scrollPick >= scrolls.length) st.scrollPick = 0;
        let sc = scrolls[st.scrollPick] || null, sd = sc ? DB.items[sc.id] : null;
        let isCurse = !!(sd && sd.isC), isBless = !!(sd && sd.isB);

        // 上：兩格
        let mainSlot = it
            ? `<div class="enh-slot-box">${iconHTML(it, d, 'enh-slot-img')}${enTag(en, d)}</div><div class="enh-slot-name ${getItemColor(it)}">${esc(d.n)}</div>`
            : `<div class="enh-slot-box empty"></div><div class="enh-slot-name dim">選擇裝備</div>`;
        let scrollSlot = sc
            ? `<div class="enh-slot-box">${iconHTML(sc, sd, 'enh-slot-img')}<span class="enh-cnt">${(sc.cnt || 1).toLocaleString()}</span></div><div class="enh-slot-name ${isBless ? 'text-yellow-300' : isCurse ? 'c-cursed' : ''}">${esc(sd.n)}</div>`
            : `<div class="enh-slot-box empty"></div><div class="enh-slot-name dim">${it ? '沒有卷軸' : '卷軸'}</div>`;
        let canCycle = scrolls.length > 1;

        // 中：機率＋等級＋能力
        let info = '', stats = '', canGo = false, note = '';
        if (it) {
            if (isCurse) {
                info = cell('成功機率', '100%') + cell('強化等級', `+${en} → ${en - 1 >= 0 ? '+' : ''}${en - 1}`) + cell('消失機率', '0%', 'safe');
                stats = statTable(d, en, en - 1);
                canGo = en > -1;
                if (!canGo) note = '已經降到最低';
            } else if (en >= cap) {
                info = cell('成功機率', '—') + cell('強化等級', `+${en}`) + cell('消失機率', '—');
                note = `已達強化上限 +${cap}`;
            } else {
                let c = chances(d, en);
                let to = en + 1, toTxt = '+' + to;
                if (isBless && c.ok > 0) { let mx = Math.min(cap, en + (en <= 2 ? 3 : en <= 5 ? 2 : 1)); if (mx > to) toTxt = `+${to}～+${mx}`; }
                info = cell('成功機率', pct(c.ok)) + cell('強化等級', `+${en} → ${toTxt}`) + cell('消失機率', pct(c.break), c.break > 0 ? 'danger' : 'safe');
                if (c.none > 0) note = `無變化 ${pct(c.none)}`;
                stats = statTable(d, en, to);
                canGo = !!sc;
            }
            if (!sc) canGo = false;
        } else {
            info = cell('成功機率', '—') + cell('強化等級', '—') + cell('消失機率', '—');
        }

        // 連續強化（一般卷軸＋武器／防具，沿用原本的「一鍵強化到指定值」）
        let auto = '';
        if (it && sc && !isBless && !isCurse && (d.type === 'wpn' || d.type === 'arm') && en < cap) {
            let safe = d.safe || 0, max = Math.min(cap, Math.max(safe, en) + 6), def = Math.min(max, Math.max(safe, en + 1)), opts = '';
            for (let t = en + 1; t <= max; t++) opts += `<option value="${t}" ${t === def ? 'selected' : ''}>+${t}${t <= safe ? '（安定）' : ''}</option>`;
            auto = `<div class="enh-auto"><button type="button" class="enh-auto-btn" onclick="enhWinAuto()">連續強化到</button><select id="enh-auto-target" class="enh-auto-sel">${opts}</select></div>`;
        }

        let res = st.result ? `<div class="enh-result ${st.result.cls}">${st.result.html}</div>` : '';

        // 下：分頁＋格子
        let tabs = TABS.map(([k, n]) => `<button type="button" class="enh-tab ${st.tab === k ? 'on' : ''}" onclick="enhWinTab('${k}')">${n}</button>`).join('');
        let list = listItems(st.tab);
        let grid = list.length ? list.map(x => {
            let dd = DB.items[x.it.id], sel = it && x.it.uid === it.uid;
            return `<button type="button" class="enh-cell ${sel ? 'sel' : ''}" onclick="enhWinPick('${x.it.uid}', ${x.isEq})">`
                + `<span class="enh-cell-box">${iconHTML(x.it, dd, 'enh-cell-img')}${enTag(x.it.en, dd)}${x.isEq ? '<span class="enh-eq">E</span>' : ''}${(x.it.cnt || 1) > 1 ? `<span class="enh-cnt">${x.it.cnt}</span>` : ''}</span>`
                + `<span class="enh-cell-name ${getItemColor(x.it)}">${esc(dd.n)}</span></button>`;
        }).join('') : `<div class="enh-empty">沒有可以強化的${TABS.find(t => t[0] === st.tab)[1]}</div>`;

        win.querySelector('.enh-body').innerHTML =
            `<div class="enh-slots">
                <div class="enh-slot ${canCycle ? 'cycle' : ''}" ${canCycle ? 'onclick="enhWinCycle()"' : ''}>${scrollSlot}${canCycle ? '<span class="enh-cycle-tip">點擊換卷軸</span>' : ''}</div>
                <div class="enh-plus">＋</div>
                <div class="enh-slot">${mainSlot}</div>
            </div>
            <div class="enh-info">${info}</div>
            ${note ? `<div class="enh-note">${note}</div>` : ''}
            ${stats}
            ${res}
            <button type="button" class="enh-go" ${canGo ? '' : 'disabled'} onclick="enhWinGo()">${isCurse ? '降低強化' : '開始強化'}</button>
            ${auto}
            <div class="enh-tabs">${tabs}</div>
            <div class="enh-grid">${grid}</div>`;
    }
    function cell(label, val, cls) { return `<div class="enh-info-cell"><div class="enh-info-label">${label}</div><div class="enh-info-val ${cls || ''}">${val}</div></div>`; }
    function statTable(d, en0, en1) {
        let a = statRows(d, en0), b = statRows(d, en1);
        if (!a.length) return '';
        let rows = a.map((r, i) => {
            let nv = b[i] ? b[i][1] : r[1], changed = nv !== r[1];
            return `<div class="enh-stat-row"><span class="enh-stat-label">${r[0]}</span><span class="enh-stat-old">${r[1]}</span><span class="enh-stat-arrow">→</span><span class="enh-stat-new ${changed ? 'up' : ''}">${nv}</span></div>`;
        }).join('');
        return `<div class="enh-stats">${rows}</div>`;
    }

    // 執行後找回「被強化的那一件」並寫結果：
    //   身上的／背包單件 → 同一個 uid；背包整疊（>1）→ 原規則會拆一件新的去衝，用前後 uid 差找那件（原本那疊數量 -1 還在）
    function afterAction(before, d0, en0, fn) {
        let wasEq = st.isEq, uid0 = st.uid, splitting = !wasEq && before.cnt > 1;
        let beforeUids = new Set(player.inv.map(i => i && i.uid));
        fn();
        let target = splitting ? player.inv.find(i => i && !beforeUids.has(i.uid) && i.id === before.id) : findItem(uid0, wasEq);
        let name = esc(d0.n);
        if (!target) {
            st.result = { cls: 'bad', html: `${en0 ? (en0 > 0 ? '+' : '') + en0 + ' ' : ''}${name} 消失了` };
            st.uid = splitting ? uid0 : null; st.isEq = false;
        } else {
            let en1 = Number(target.en) || 0;
            st.uid = target.uid; st.isEq = splitting ? false : wasEq;
            if (en1 > en0) st.result = { cls: 'good', html: `強化成功！${name} ${en0 >= 0 ? '+' : ''}${en0} → +${en1}` };
            else if (en1 < en0) st.result = { cls: 'mid', html: `${name} 強化值降為 ${en1 >= 0 ? '+' : ''}${en1}` };
            else st.result = { cls: 'mid', html: `${name} 沒有變化` };
        }
        render();
    }

    window.openEnhanceWindow = function (uid, isEq) {
        let it = uid ? findItem(uid, isEq) : null, d = it && DB.items[it.id];
        st = { uid: it ? uid : null, isEq: !!isEq, tab: (d && enhanceable(d)) ? d.type : 'wpn', scrollPick: 0, result: null };
        let win = $('enh-window');
        if (!win) {
            win = document.createElement('div');
            win.id = 'enh-window';
            win.innerHTML = `<div class="enh-panel" role="dialog" aria-label="裝備強化"><div class="enh-head"><span class="enh-title">裝備強化</span><button type="button" class="enh-x" aria-label="關閉" onclick="closeEnhanceWindow()">✕</button></div><div class="enh-body"></div></div>`;
            win.addEventListener('click', e => { if (e.target === win) closeEnhanceWindow(); });
            document.body.appendChild(win);
        }
        win.classList.remove('hidden');
        document.body.classList.add('enh-open');   // 浮動訊息（afk-toast，z-index 最上層）會蓋住視窗上半 → 開著時先藏；結果直接寫在視窗裡
        render();
        try { if (window.AFK_UI && AFK_UI.openLayer) st.layer = AFK_UI.openLayer(hideWin); } catch (e) {}
    };
    function hideWin() { let w = $('enh-window'); if (w) w.classList.add('hidden'); document.body.classList.remove('enh-open'); st.layer = null; }
    window.closeEnhanceWindow = function () { if (st.layer && window.AFK_UI && AFK_UI.closeLayer) AFK_UI.closeLayer(st.layer); else hideWin(); };
    window.enhWinTab = function (k) { st.tab = k; render(); };
    window.enhWinPick = function (uid, isEq) { st.uid = uid; st.isEq = !!isEq; st.scrollPick = 0; st.result = null; render(); };
    window.enhWinCycle = function () { st.scrollPick++; st.result = null; render(); };
    window.enhWinGo = function () {
        let it = findItem(st.uid, st.isEq); if (!it) return;
        let d = DB.items[it.id], sc = scrollsFor(d)[st.scrollPick]; if (!sc) return;
        let before = { id: it.id, cnt: it.cnt || 1 }, en0 = Number(it.en) || 0;
        if (DB.items[sc.id].isC) afterAction(before, d, en0, () => executeCurseDeEnhance(it.uid, st.isEq, sc.id));
        else afterAction(before, d, en0, () => { activeScroll = sc; doEnhance(it.uid, st.isEq); });
    };
    window.enhWinAuto = function () {
        let it = findItem(st.uid, st.isEq); if (!it) return;
        let d = DB.items[it.id], sel = $('enh-auto-target'), sc = scrollsFor(d)[st.scrollPick]; if (!sel || !sc) return;
        let before = { id: it.id, cnt: it.cnt || 1 }, en0 = Number(it.en) || 0;
        afterAction(before, d, en0, () => executeAutoSafeEnhance(it.uid, st.isEq, sc.id, Number(sel.value)));
    };
})();
