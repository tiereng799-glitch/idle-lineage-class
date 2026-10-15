/* ============================================================================
 * afk-townmap.js — 說話之島村莊換成會動的地圖，玩家可以操控角色在村裡自由走動
 *
 * 村莊畫面(#town-npc-map)原本是一張靜態背景圖。開啟時(只有說話之島，其他村莊照舊)：
 *   - 背景換成天堂用戶端的真地圖(地磚＋房子樹木)，用 canvas 即時畫；鏡頭跟著角色、夾在資料範圍內
 *   - 角色＝玩家目前的職業外型＋手上武器的走路／待機動畫(assets/classanim 八方向)，
 *     由玩家操控(站長要求：不要自己走)：點地面＝找路走過去、按住＝往手指方向走、電腦方向鍵；
 *     官方未變身走速(每格 16/24 秒)；八方向、斜走不切牆角、不能走的格子照用戶端第 3 層屬性
 *   - 站在地圖上的 NPC／叫賣玩家(.town-npc，核心照舊建)釘在村裡固定的格子上，跟著地圖捲動，點擊照舊
 *   - 前後遮擋：房子、樹會擋住走到後面的角色；被整個擋住時再疊一層半透明身影
 *
 * 資料：assets/townmap/talking.js(地面/物件/可走/站位)、talking_<頁>.png(小塊拼圖)、hero.js(角色落腳點)，
 *   都由 tools/gen-townmap.js 從用戶端檔案產生(格式與投影的說明在那支檔頭)。
 *   用 <script>/<img> 動態載入(不用 fetch)：玩家常直接開 index.html(file://)，fetch 在那裡讀不到本機檔。
 *   canvas 只畫不讀回(file:// 下讀回會丟 SecurityError)。
 *
 * 省電：只在村莊畫面看得見時才畫；走路時每幀畫，停著只在待機動作換幀時畫；
 *   看不見(打怪、開 NPC 視窗、切到背景)就改成每 0.4 秒看一次要不要醒來，不跑 requestAnimationFrame。
 *
 * 包 renderTownNPCMap(村莊畫面唯一入口)：原函式照跑(會清空地圖重建 NPC)，之後把 canvas 放回最底層。
 * 關掉外掛開關 → 完全回原版靜態背景。優雅降級：缺核心掛點或資料載入失敗就留原背景、console.warn。
 * ========================================================================== */
(function () {
    'use strict';
    if (window.AFK_TOGGLES) {
        AFK_TOGGLES.register({
            id: 'townmap', name: '村莊動態地圖', group: '遊戲介面', def: true,
            desc: '說話之島村莊換成會動的地圖，點地面就能讓角色走過去'
        });
        if (!AFK_TOGGLES.enabled('townmap')) return;
    }
    if (typeof window.renderTownNPCMap !== 'function' || !document.getElementById('town-npc-map')) {
        try { console.warn('[AFK-townmap] 缺核心掛點(renderTownNPCMap/#town-npc-map)，村莊動態地圖停用。'); } catch (e) {}
        return;
    }

    var TOWNS = { town_talking: 'talking' };   // 村莊 id → assets/townmap/<名>.js
    var BASE = 'assets/townmap/';
    var BW = 24, BH = 23;
    var STEP = 16 / 24;                          // 走一格的秒數：官方未變身 wlk=16（每單位 1/24 秒）
    var IDLE_FPS = 6;                            // 待機動作：每幀 4 單位
    // 方向 0..7＝畫面上的 西北,北,東北,東,東南,南,西南,西（＝天堂 heading＝classanim 資料夾順序）→ 格子位移
    var DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    var DIR_SFX = ['2', 'F', '', 'd3', 'd4', 'd5', 'd6', 'd7'];

    var st = document.createElement('style');
    st.id = 'afk-townmap-css';
    st.textContent = '#town-npc-map > canvas.afk-tm-cv{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;touch-action:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}';   // NPC、面板都疊在上面，點它們不受影響
    (document.head || document.documentElement).appendChild(st);

    // ── 載入 ──────────────────────────────────────────
    var loading = {};
    function loadScript(src) {
        if (loading[src]) return loading[src];
        return (loading[src] = new Promise(function (ok, bad) {
            var s = document.createElement('script');
            s.src = src; s.onload = ok; s.onerror = function () { delete loading[src]; bad(new Error('載不到 ' + src)); };
            document.head.appendChild(s);
        }));
    }
    function bytes(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
    function u16(b64) { return new Uint16Array(bytes(b64).buffer); }
    function u32(b64) { return new Uint32Array(bytes(b64).buffer); }
    var towns = {};   // 名 → 解好的資料（含拼圖 Image）
    function loadTown(name) {
        if (towns[name]) return Promise.resolve(towns[name]);
        return Promise.all([loadScript(BASE + 'hero.js'), loadScript(BASE + name + '.js')]).then(function () {
            var d = window.TOWNMAP && TOWNMAP[name];
            if (!d) throw new Error('資料格式不對：' + name);
            var t = {
                d: d, ground: u16(d.ground), flags: bytes(d.flags),
                fOff: u32(d.fOff), fIdx: u16(d.fIdx), fHx: u16(d.fHx), fGy: u16(d.fGy),
                tOff: u32(d.tOff), tIdx: u16(d.tIdx), tHx: u16(d.tHx), tGy: u16(d.tGy), tLy: bytes(d.tLy), tSeq: u32(d.tSeq),
                atlas: []
            };
            // 物件小塊的畫面位置預先算好（相對格；半格 x 加了 off 偏移存成無號數）
            function pos(hx, gy, out, k) {
                var h = hx - d.off, ly = gy - d.off, lx = h >> 1;
                out[0][k] = 24 * (lx + ly) - (h & 1 ? 0 : 24) + d.ox; out[1][k] = 12 * (ly - lx) - 11 + d.oy;
                return [lx, ly];
            }
            var n = t.fIdx.length; t.fX = new Int32Array(n); t.fY = new Int32Array(n);
            for (var i = 0; i < n; i++) pos(t.fHx[i], t.fGy[i], [t.fX, t.fY], i);
            n = t.tIdx.length; t.tX = new Int32Array(n); t.tY = new Int32Array(n); t.tKey = new Int32Array(n);
            for (i = 0; i < n; i++) { var c = pos(t.tHx[i], t.tGy[i], [t.tX, t.tY], i); t.tKey[i] = 4 * (c[1] - c[0]) + t.tLy[i]; }   // 4×畫面列＋圖層：越大越前面
            var pages = [];
            for (var p = 0; p < d.pages; p++) pages.push(new Promise(function (ok, bad) {
                var img = new Image(), pi = p;
                img.onload = function () { t.atlas[pi] = img; ok(); };
                img.onerror = function () { bad(new Error('載不到拼圖 ' + pi)); };
                img.src = BASE + name + '_' + p + '.png';
            }));
            return Promise.all(pages).then(function () { towns[name] = t; return t; });
        });
    }

    // ── 角色外型（職業＋武器）───────────────────────────
    var imgCache = {};
    function img(src) {
        var im = imgCache[src];
        if (!im) { im = imgCache[src] = new Image(); im.src = src; }
        return im;
    }
    function heroForm() {
        try {
            var p = (typeof player !== 'undefined') ? player : null;   // 核心的 let 全域
            var av = p && p.avatar, tab = window.TOWNMAP_HERO && TOWNMAP_HERO[av];
            if (!tab) return null;
            var wk = 'unarmed';
            if (typeof _classAnimWpnKey === 'function' && typeof CLASS_ANIM_SETS !== 'undefined' && CLASS_ANIM_SETS[av]) wk = _classAnimWpnKey(p, CLASS_ANIM_SETS[av]);
            if (!tab[wk]) wk = 'unarmed';
            if (!tab[wk]) return null;
            var idleN = 1;
            try { idleN = ANIM_MANIFEST['assets/classanim/' + av + DIR_SFX[5]][wk + '_idle_'] || 1; } catch (e) {}
            return { av: av, wk: wk, at: tab[wk], idleN: idleN };
        } catch (e) { return null; }
    }
    function frameSrc(f, dir, act, k, shadow) {
        return 'assets/classanim/' + encodeURIComponent(f.av + DIR_SFX[dir]) + '/' + f.wk + '_' + act + (shadow ? '_s_' : '_') + k + '.png';
    }
    function preloadDir(f, dir) {
        for (var k = 0; k < 4; k++) { img(frameSrc(f, dir, 'walk', k)); img(frameSrc(f, dir, 'walk', k, true)); }
        for (k = 0; k < f.idleN; k++) { img(frameSrc(f, dir, 'idle', k)); img(frameSrc(f, dir, 'idle', k, true)); }
    }

    // ── 執行狀態 ────────────────────────────────────────
    var S = null;          // 目前掛著的村莊
    var running = false, lastT = 0, clock = 0, dirty = true, lastSig = '', lastCam = null;

    // 資料最外一圈當牆：不讓角色走到資料邊上（再過去就沒地圖了）
    function cellFlag(x, y) { var d = S.t.d; return (x < 1 || y < 1 || x >= d.cw - 1 || y >= d.ch - 1) ? 1 : S.t.flags[y * d.cw + x]; }
    function blocked(x, y) { return (cellFlag(x, y) & 1) || S.occ[y * S.t.d.cw + x] === 1; }
    function canStep(x, y, d) {
        var nx = x + d[0], ny = y + d[1];
        if (blocked(nx, ny)) return false;
        if (d[0] && d[1] && (blocked(x + d[0], y) || blocked(x, y + d[1]))) return false;   // 斜走不能切牆角
        return true;
    }
    // A* 八方向；很多條路一樣短時加一點「離起點終點直線多遠」，挑最直的，不會東、北、東、北鋸齒走
    function findPath(sx, sy, gx, gy) {
        var W = S.t.d.cw, H = S.t.d.ch, S0 = sy * W + sx, G = gy * W + gx;
        if (S0 === G || blocked(gx, gy)) return [];
        var g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H), heap = [], hf = [];
        var lx = sx - gx, ly = sy - gy, ll = Math.hypot(lx, ly) || 1;
        function h(i) { var x = i % W - gx, y = (i / W | 0) - gy; return Math.max(Math.abs(x), Math.abs(y)) + Math.abs(x * ly - y * lx) / ll * 0.001; }
        function push(i, f) { heap.push(i); hf.push(f); var k = heap.length - 1; while (k > 0) { var p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; var t = heap[p]; heap[p] = heap[k]; heap[k] = t; t = hf[p]; hf[p] = hf[k]; hf[k] = t; k = p; } }
        function pop() { var top = heap[0], lt = heap.pop(), lf = hf.pop(); if (heap.length) { heap[0] = lt; hf[0] = lf; var k = 0; for (;;) { var l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && hf[l] < hf[m]) m = l; if (r < heap.length && hf[r] < hf[m]) m = r; if (m === k) break; var t = heap[m]; heap[m] = heap[k]; heap[k] = t; t = hf[m]; hf[m] = hf[k]; hf[k] = t; k = m; } } return top; }
        g[S0] = 0; push(S0, h(S0));
        var budget = 8000;
        while (heap.length && budget-- > 0) {
            var c = pop(); if (c === G) break; if (closed[c]) continue; closed[c] = 1;
            var cx = c % W, cy = c / W | 0;
            for (var k = 0; k < 8; k++) {
                if (!canStep(cx, cy, DIRS[k])) continue;
                var n = (cy + DIRS[k][1]) * W + cx + DIRS[k][0], ng = g[c] + 1;
                if (ng < g[n]) { g[n] = ng; from[n] = c; push(n, ng + h(n)); }
            }
        }
        if (from[G] < 0) return [];
        var out = [], i = G; while (i !== S0) { out.push([i % W, i / W | 0]); i = from[i]; }
        return out.reverse();
    }
    // 點到不能走的地方（牆、房子、樹）：改走到附近最近能站的格子
    function nearestWalkable(gx, gy) {
        if (!blocked(gx, gy)) return [gx, gy];
        var best = null, bd = 1e9;
        for (var r = 1; r <= 6 && !best; r++) for (var y = gy - r; y <= gy + r; y++) for (var x = gx - r; x <= gx + r; x++) {
            if (!blocked(x, y)) { var dd = (x - gx) * (x - gx) + (y - gy) * (y - gy); if (dd < bd) { bd = dd; best = [x, y]; } }
        }
        return best;
    }
    // ── 玩家操作：點地面＝找路走過去；按住＝往手指方向走；電腦方向鍵 ──────────
    var hold = null, keys = {};
    function screenDir(dx, dy) {   // 畫面向量 → 方向 0..7（西北起順時針）
        var idx = Math.round(Math.atan2(dy, dx) * 180 / Math.PI / 45);   // 東=0、南=2、西=±4、北=-2
        return (idx + 3 + 8) % 8;
    }
    function wantDir() {
        var vx = 0, vy = 0;
        if (keys.ArrowUp) vy -= 1; if (keys.ArrowDown) vy += 1; if (keys.ArrowLeft) vx -= 1; if (keys.ArrowRight) vx += 1;
        if (vx || vy) return screenDir(vx, vy);
        if (hold && hold.follow && S.cam) {
            var p = heroWorld(), dx = hold.px - (p[0] - S.cam[0]), dy = hold.py - (p[1] - S.cam[1] - 30);
            if (dx * dx + dy * dy < 400) return -1;   // 手指就在角色身上：停
            // 手指在兩個方向交界附近時維持原方向，免得一步東一步東北來回換
            var diff = ((Math.atan2(dy, dx) * 180 / Math.PI - (S.me.dir - 3) * 45) % 360 + 540) % 360 - 180;
            if (S.me.walking && Math.abs(diff) < 34) return S.me.dir;
            return screenDir(dx, dy);
        }
        return -1;
    }
    // 手指在地圖上的位置（地圖 CSS px）；地圖被 CSS 縮放時照比例換回來
    function mapPoint(e) {
        var r = S.cv.getBoundingClientRect(), k = r.width ? S.map.clientWidth / r.width : 1;
        return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
    }
    function tapTo(px, py) {
        if (!S || !S.ready || !S.cam) return;
        var d = S.t.d, s = (px + S.cam[0] - d.ox) / 24, dd = (py + S.cam[1] - d.oy) / 12;
        var c = nearestWalkable(Math.round((s - dd) / 2), Math.round((s + dd) / 2));
        if (!c) return;
        S.path = findPath(S.me.tx, S.me.ty, c[0], c[1]);
        if (S.path.length) S.marker = { x: c[0], y: c[1], t: clock };
        dirty = true;
    }
    function bindInput(cv) {
        cv.addEventListener('pointerdown', function (e) {
            if (!S || !S.ready) return;
            try { cv.setPointerCapture(e.pointerId); } catch (x) {}
            var p = mapPoint(e);
            hold = { px: p[0], py: p[1], x0: e.clientX, y0: e.clientY, follow: false };
            hold.timer = setTimeout(function () { if (hold) { hold.follow = true; S && (S.path = []); dirty = true; } }, 220);
        });
        cv.addEventListener('pointermove', function (e) {
            if (!hold || !S) return;
            var p = mapPoint(e); hold.px = p[0]; hold.py = p[1];
            if (!hold.follow && Math.hypot(e.clientX - hold.x0, e.clientY - hold.y0) > 12) { hold.follow = true; S.path = []; }
        });
        function release() {
            if (!hold) return;
            clearTimeout(hold.timer);
            if (!hold.follow) tapTo(hold.px, hold.py);   // 短按：找路走過去
            hold = null;
        }
        cv.addEventListener('pointerup', release);
        cv.addEventListener('pointercancel', release);
    }
    function typing(el) { var t = el && el.tagName; return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (el && el.isContentEditable); }
    window.addEventListener('keydown', function (e) {
        if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement) || !visible()) return;
        keys[e.key] = true; if (S) S.path = []; dirty = true; e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { delete keys[e.key]; });
    window.addEventListener('blur', function () { keys = {}; hold = null; });
    function startStep(d) {
        var me = S.me;
        me.fx = me.tx; me.fy = me.ty; me.dir = d;
        if (!canStep(me.tx, me.ty, DIRS[d])) return false;
        me.sx = me.tx; me.sy = me.ty; me.tx += DIRS[d][0]; me.ty += DIRS[d][1]; me.t = 0; me.walking = true;
        if (S.form) preloadDir(S.form, d);
        return true;
    }
    function nextStep() {
        var me = S.me, d = wantDir();
        if (d >= 0) {   // 按住／方向鍵：往那個方向走，正前方擋住就試左右斜方向
            S.path = [];
            if (startStep(d) || startStep((d + 1) % 8) || startStep((d + 7) % 8)) return;
            me.dir = d; me.walking = false; return;
        }
        if (S.path.length) {
            var n = S.path.shift(), dx = n[0] - me.tx, dy = n[1] - me.ty;
            for (var k = 0; k < 8; k++) if (DIRS[k][0] === dx && DIRS[k][1] === dy) { if (startStep(k)) return; break; }
            S.path = [];
        }
        me.walking = false;
    }
    function tick(dt) {
        var me = S.me;
        if (me.t < 1) {
            var t = me.t + dt / STEP;
            if (t >= 1) {
                me.t = 1; me.fx = me.tx; me.fy = me.ty; nextStep();
                if (me.walking && me.t === 0) me.t = Math.min(t - 1, 0.99);   // 接著走下一步：多出來的時間帶過去，每格之間不會頓一下
            } else me.t = t;
            me.fx = me.sx + (me.tx - me.sx) * me.t; me.fy = me.sy + (me.ty - me.sy) * me.t;
        } else if (S.path.length || wantDir() >= 0) nextStep();
        else me.walking = false;
    }

    // ── 畫面 ──────────────────────────────────────────
    function blit(c, idx, dx, dy) {
        var d = S.t.d, im = S.t.atlas[(idx / d.per) | 0]; if (!im) return;
        var s = idx % d.per;
        c.drawImage(im, (s % d.cols) * d.cellW + 1, ((s / d.cols) | 0) * d.cellH + 1, BW, BH, dx, dy, BW, BH);
    }
    function buildChunk(ci, cj) {
        var t = S.t, d = t.d, cs = d.cs;
        var c = document.createElement('canvas'); c.width = cs; c.height = cs;
        var x = c.getContext('2d'), X0 = ci * cs, Y0 = cj * cs;
        var sMin = Math.floor((X0 - d.ox - 48) / 24), sMax = Math.ceil((X0 + cs - d.ox + 24) / 24);
        var dMin = Math.floor((Y0 - d.oy - 12) / 12), dMax = Math.ceil((Y0 + cs - d.oy + 11) / 12);
        for (var dd = dMin; dd <= dMax; dd++) for (var s = sMin; s <= sMax; s++) {
            if ((s + dd) & 1) continue;
            var lx = (s - dd) / 2, ly = (s + dd) / 2;
            if (lx < 0 || ly < 0 || lx >= d.cw || ly >= d.ch) continue;
            var wx = 24 * s + d.ox - X0, wy = 12 * dd + d.oy - 11 - Y0, gi = (ly * d.cw + lx) * 2;
            blit(x, t.ground[gi], wx - 24, wy);
            blit(x, t.ground[gi + 1], wx, wy);
        }
        var b = cj * d.cx + ci;
        for (var k = t.fOff[b]; k < t.fOff[b + 1]; k++) blit(x, t.fIdx[k], t.fX[k] - X0, t.fY[k] - Y0);
        return c;
    }
    function heroWorld() { var d = S.t.d, me = S.me; return [24 * (me.fx + me.fy) + d.ox, 12 * (me.fy - me.fx) + d.oy]; }
    // 鏡頭：跟著角色，但整個畫面要落在資料範圍裡（格子座標夾在 [m, 邊-m]）
    function camera(W, H, dpr) {
        var d = S.t.d, me = S.me, m = (W / 2 / 24 + H / 2 / 12) / 2;
        var xc = me.fx, yc = me.fy;
        xc = (d.cw - 1 < 2 * m) ? (d.cw - 1) / 2 : Math.max(m, Math.min(d.cw - 1 - m, xc));
        yc = (d.ch - 1 < 2 * m) ? (d.ch - 1) / 2 : Math.max(m, Math.min(d.ch - 1 - m, yc));
        var px = 24 * (xc + yc) + d.ox - W / 2, py = 12 * (yc - xc) + d.oy - H / 2;
        return [Math.round(px * dpr) / dpr, Math.round(py * dpr) / dpr];
    }
    var vis = [];
    function draw() {
        var t = S.t, d = t.d, cv = S.cv, map = S.map;
        var W = map.clientWidth, H = map.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
        if (!W || !H) return;
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
        var ctx = S.ctx, cam = camera(W, H, dpr), cx0 = cam[0], cy0 = cam[1];
        S.cam = cam;   // 點地面換算格子要用同一個鏡頭
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#0b1a26'; ctx.fillRect(0, 0, W, H);
        // 地面分塊（資料範圍小，第一次看到就整塊做好留著）
        var i0 = Math.max(0, Math.floor(cx0 / d.cs)), i1 = Math.min(d.cx - 1, Math.floor((cx0 + W) / d.cs));
        var j0 = Math.max(0, Math.floor(cy0 / d.cs)), j1 = Math.min(d.cy - 1, Math.floor((cy0 + H) / d.cs));
        for (var cj = j0; cj <= j1; cj++) for (var ci = i0; ci <= i1; ci++) {
            var key = cj * d.cx + ci, ch = S.chunks[key] || (S.chunks[key] = buildChunk(ci, cj));
            ctx.drawImage(ch, ci * d.cs - cx0, cj * d.cs - cy0);
        }
        // 點地面的目的地標記：一個慢慢擴散淡出的圈
        var mk = S.marker;
        if (mk) {
            var ma = 1 - (clock - mk.t) / 1.2;
            if (ma <= 0) S.marker = null;
            else {
                var mx = 24 * (mk.x + mk.y) + d.ox - cx0, my = 12 * (mk.y - mk.x) + d.oy - cy0, sc = 1.3 - ma * 0.4;
                ctx.strokeStyle = 'rgba(255,220,140,' + ma + ')'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.ellipse(mx, my, 24 * sc, 12 * sc, 0, 0, Math.PI * 2); ctx.stroke();
            }
        }
        // 立著的物件＋角色：依全域序號畫，角色插在第一個比他前面的小塊之前
        vis.length = 0;
        var bi0 = Math.max(0, Math.floor((cx0 - BW) / d.cs)), bj0 = Math.max(0, Math.floor((cy0 - BH) / d.cs));
        for (cj = bj0; cj <= j1; cj++) for (ci = bi0; ci <= i1; ci++) {
            var b = cj * d.cx + ci;
            for (var k = t.tOff[b]; k < t.tOff[b + 1]; k++) {
                var x = t.tX[k] - cx0, y = t.tY[k] - cy0;
                if (x > -BW && y > -BH && x < W && y < H) vis.push(k);
            }
        }
        vis.sort(function (a, b) { return t.tSeq[a] - t.tSeq[b]; });
        var me = S.me, hv = me.walking ? Math.max(me.sy - me.sx, me.ty - me.tx) : me.ty - me.tx;   // 走路中用起點終點較前面那列
        var heroKey = 4 * hv + 19.5, todo = !!S.form, after = false, covered = false;
        var hp = heroWorld(), hx0 = hp[0] - 22, hx1 = hp[0] + 22, hy0 = hp[1] - 62, hy1 = hp[1];   // 角色身體大概的範圍
        for (var n = 0; n < vis.length; n++) {
            var e = vis[n];
            if (todo && t.tKey[e] > heroKey) { drawHero(ctx, cam, dpr, 1); todo = false; after = true; }
            if (after && !covered && t.tX[e] < hx1 && t.tX[e] + BW > hx0 && t.tY[e] < hy1 && t.tY[e] + BH > hy0) covered = true;
            blit(ctx, t.tIdx[e], t.tX[e] - cx0, t.tY[e] - cy0);
        }
        if (todo) drawHero(ctx, cam, dpr, 1);
        else if (covered) drawHero(ctx, cam, dpr, 0.4);   // 被樹或房子擋住：再疊一層半透明的，才找得到人
        placeNpcs(cam);
    }
    function drawHero(ctx, cam, dpr, alpha) {
        var f = S.form, me = S.me; if (!f) return;
        var walk = me.walking && me.t < 1, k = walk ? Math.min(3, Math.floor(me.t * 4)) : Math.floor(clock * IDLE_FPS) % f.idleN;
        var a = f.at[me.dir];   // [走路0幀x,y, 1~3幀位移×3, 待機x,y]
        // 走路幀本身每幀往前挪約 1/4 格；角色改成平滑移動，所以把這段扣掉，人才穩在中央、地圖平順捲動
        var ax = walk ? a[0] + (k ? a[2 * k] : 0) : a[8], ay = walk ? a[1] + (k ? a[2 * k + 1] : 0) : a[9];
        var p = heroWorld(), ox = Math.round((p[0] - cam[0] - ax) * dpr) / dpr, oy = Math.round((p[1] - cam[1] - ay) * dpr) / dpr;
        var act = walk ? 'walk' : 'idle', body = img(frameSrc(f, me.dir, act, k)), sh = img(frameSrc(f, me.dir, act, k, true));
        if (alpha === 1 && sh.complete && sh.naturalWidth) { ctx.globalAlpha = 0.55; ctx.drawImage(sh, ox, oy); }
        if (body.complete && body.naturalWidth) { ctx.globalAlpha = alpha; ctx.drawImage(body, ox, oy); }
        ctx.globalAlpha = 1;
    }
    // 地圖上的 NPC／叫賣玩家：腳點釘在村裡的站位格，跟著鏡頭移（只在鏡頭動了才改位置）
    function placeNpcs(cam) {
        if (lastCam && Math.abs(lastCam[0] - cam[0]) < 0.25 && Math.abs(lastCam[1] - cam[1]) < 0.25 && !S.npcDirty) return;
        lastCam = cam; S.npcDirty = false;
        var d = S.t.d;
        S.npcs.forEach(function (n) {
            var x = 24 * (n.x + n.y) + d.ox - cam[0], y = 12 * (n.y - n.x) + d.oy - cam[1] + 6;
            n.el.style.setProperty('left', x.toFixed(1) + 'px', 'important');
            n.el.style.setProperty('top', y.toFixed(1) + 'px', 'important');
            n.el.style.zIndex = String(Math.round(y) + 1000);
        });
    }

    // ── 迴圈：看得見才畫 ──────────────────────────────────
    function visible() {
        return !!(S && S.ready && document.visibilityState !== 'hidden' && S.map.isConnected && !S.map.classList.contains('hidden') && S.map.offsetWidth > 0);
    }
    function loop(now) {
        if (!S || !S.ready) { running = false; return; }
        if (!visible()) { lastT = 0; dirty = true; setTimeout(function () { loop(performance.now()); }, 400); return; }
        var dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now; clock += dt;
        tick(dt);
        var me = S.me, sig = (me.walking && me.t < 1) ? 'w' + me.t : 'i' + me.tx + ',' + me.ty + ',' + me.dir + ',' + Math.floor(clock * IDLE_FPS);
        if (sig !== lastSig || dirty || S.marker || S.map.clientWidth !== S.lastW || S.map.clientHeight !== S.lastH) {
            try { draw(); } catch (e) { console.warn('[AFK-townmap] 繪圖失敗，改回原背景：', e); unmount(true); running = false; return; }
            S.lastW = S.map.clientWidth; S.lastH = S.map.clientHeight; dirty = false; lastSig = sig;
        }
        requestAnimationFrame(loop);
    }
    function kick() { if (!running) { running = true; lastT = 0; requestAnimationFrame(loop); } }

    // ── 掛上／拿掉 ───────────────────────────────────────
    function attachNpcs() {
        var d = S.t.d, cw = d.cw;
        S.occ = new Uint8Array(cw * d.ch);
        S.npcs = [];
        var els = S.map.querySelectorAll('.town-npc'), k = 0;
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (getComputedStyle(el).display === 'none') continue;   // NPC 條列式開著時地圖上的 NPC 是藏起來的，不佔位
            var sp = d.spots[k++ % d.spots.length];
            S.npcs.push({ el: el, x: sp[0], y: sp[1] });
            S.occ[sp[1] * cw + sp[0]] = 1;   // 角色不會穿過 NPC
        }
        S.npcDirty = true; lastCam = null;
    }
    function unmount(restoreBg) {
        if (!S) return;
        if (S.cv && S.cv.parentNode) S.cv.parentNode.removeChild(S.cv);
        if (restoreBg && S.bg != null) S.map.style.backgroundImage = S.bg;
        S.npcs && S.npcs.forEach(function (n) { n.el.style.removeProperty('left'); n.el.style.removeProperty('top'); });
        S = null;
    }
    function mount(townId) {
        var name = TOWNS[townId], map = document.getElementById('town-npc-map');
        if (!name || !map) { unmount(false); return; }
        var keep = S && S.name === name ? S : null;   // 同一個村莊重畫(開關 NPC 視窗等)：角色位置、地面快取都留著
        if (!keep) {
            unmount(false);
            var cv = document.createElement('canvas'); cv.className = 'afk-tm-cv'; cv.setAttribute('aria-hidden', 'true');
            bindInput(cv);
            S = { name: name, map: map, cv: cv, ctx: cv.getContext('2d'), ready: false, chunks: {}, path: [], npcs: [], marker: null };
        }
        S.map = map;
        S.bg = map.style.backgroundImage;   // 核心剛設好的靜態背景；資料到之前先留著，失敗時也用它
        map.insertBefore(S.cv, map.firstChild);
        var cur = S;
        loadTown(name).then(function (t) {
            if (S !== cur) return;
            S.form = heroForm();   // 落腳點表(hero.js)跟地圖資料一起載，載好才查得到；每次重畫都重查(換武器會換動畫)
            if (!S.t) {
                S.t = t;
                var h = t.d.home; S.me = { fx: h[0], fy: h[1], tx: h[0], ty: h[1], sx: h[0], sy: h[1], t: 1, dir: 5, walking: false };
            }
            attachNpcs();
            if (S.form) preloadDir(S.form, S.me.dir);
            map.style.backgroundImage = 'none';
            S.ready = true; dirty = true;
            kick();
        }).catch(function (e) {
            try { console.warn('[AFK-townmap] 村莊地圖資料載入失敗，維持原背景：', e); } catch (x) {}
            if (S === cur) unmount(true);
        });
    }

    var _orig = window.renderTownNPCMap;
    window.renderTownNPCMap = function (townId) {
        var r = _orig.apply(this, arguments);
        try { mount(townId); } catch (e) { try { console.warn('[AFK-townmap] 掛載失敗：', e); } catch (x) {} unmount(true); }
        return r;
    };
    document.addEventListener('visibilitychange', function () { dirty = true; });
    window.addEventListener('resize', function () { dirty = true; if (S) { S.npcDirty = true; } });

    try { console.log('[AFK-townmap] hooks OK — 說話之島村莊動態地圖已啟用(外掛開關可關回靜態背景)。'); } catch (e) {}
})();
