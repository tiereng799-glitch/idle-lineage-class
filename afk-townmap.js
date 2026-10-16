/* ============================================================================
 * afk-townmap.js — 村莊換成會動的地圖，玩家可以操控角色在整張地圖上自由走動
 *
 * 村莊畫面(#town-npc-map)原本是一張靜態背景圖。開啟時(對得到天堂用戶端地圖的村莊；其他照舊)：
 *   - 背景換成天堂用戶端的真地圖(地磚＋房子樹木)，用 canvas 即時畫；角色從村莊起點出發，整張地圖都能走
 *     (說話之島＝整座島、大陸上的村莊＝整片大陸)，鏡頭置中跟著角色
 *   - 角色＝玩家目前的職業外型＋手上武器的走路／待機動畫(assets/classanim 八方向)，
 *     由玩家操控(站長要求：不要自己走)：點地面＝找路走過去、按住＝往手指方向走、電腦方向鍵；
 *     八方向；能不能走照模擬器地圖檔 maps/<圖>.txt 跟它的 isPassable（牆邊、門口是「邊」擋住，不是整格擋）
 *   - 走速＝官方未變身每格 16/24 秒 × 遊戲自己的移速倍率 playerMoveDelayMultiplier(js/02)：
 *     一段/二段/三段加速(加速、勇敢、疾走、餅乾、行走加速)、變身走速、裝備移速都照遊戲現有規則，每一步重算
 *   - 外型跟狩獵區同一套(每秒重查)：職業＋手上武器；真夏納＝職業式變身；一般變身走路用 assets/anim/<名>/d0..d7/walk
 *     (tools/gen-walk-anim.js 從用戶端 .spr 補抽，79 個變身有 77 個)、站著用變身自己的待機；沒有走路幀的移動時也播待機
 *   - 帶出來的寵物(petsOutList)沿著角色走過的格子跟在後面，用寵物自己的八方向走路／待機動畫
 *   - 站在地圖上的 NPC／叫賣玩家(.town-npc，核心照舊建)站在模擬器 spawnlist_npc 的位置(照名字對)，
 *     對不到的(遊戲自己加的 NPC)站村莊起點附近的空位；跟著地圖捲動，點擊照舊
 *   - 前後遮擋：房子、樹會擋住走到後面的角色；被整個擋住時再疊一層半透明身影
 *   - 進村莊／換村莊(所有村莊)：地圖上先跑一段載入條，至少 1.5 秒，地圖還在載就等載好
 *   - 狩獵區(子開關 huntmap，hunts.json 有的地圖：對得到用戶端地圖、有一般怪的狩獵地圖都有，約 200 張)：怪物照模擬器重生表站在地圖上，
 *     角色自己走過去打；戰鬥計算沿用核心，只換「怪從哪來」(細節見下方「狩獵區」段落)。開發時網址帶 ?tmlocal 讀本機資料
 *
 * 資料：assets/townmap/towns.json(各村莊在哪張圖、起點、NPC 站位)、m<圖>.json(每張圖的總表)、
 *   m<圖>/r<x>_<y>.bin(各區地面/物件/可走)、m<圖>/p<頁>.webp(小塊拼圖)、hero.js(角色落腳點)，
 *   都由 tools/gen-townmap.js 從用戶端與模擬器檔案產生(格式與投影的說明在那支檔頭)。
 *   除了 hero.js，地圖資料(約 235MB)不進 repo：tools/upload-r2.mjs 傳到 Cloudflare R2(檔名帶內容雜湊)，
 *   入口 assets/townmap/remote.json 跟遊戲一起發佈；沒有它就讀本機 assets/townmap/(剛產完、還沒上傳時開發用)。
 *   每張圖 32×32 格一區：只載角色附近的區＋它們用到的拼圖頁、走遠了放掉(整片大陸一起解開會吃掉幾百 MB 記憶體)；
 *   地面畫成 512px 的分塊快取，最多留 CHUNK_MAX 塊。
 *   ⚠ 用 fetch 讀：直接開 index.html(file://)時讀不到 → 那時村莊留原本的靜態背景(站長 2026-10-15：之後只做線上版)。
 *   canvas 只畫不讀回。
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
            desc: '村莊換成會動的地圖，點地面就能讓角色走過去'
        });
        AFK_TOGGLES.register({   // 子項：共用這支的地圖引擎，村莊地圖關掉它也一起失效
            id: 'huntmap', name: '狩獵區動態地圖', group: '遊戲介面', def: true, parent: 'townmap',
            desc: '狩獵區換成會動的地圖，角色自己走過去打怪'
        });
        if (!AFK_TOGGLES.enabled('townmap')) return;
    }
    if (typeof window.renderTownNPCMap !== 'function' || !document.getElementById('town-npc-map')) {
        try { console.warn('[AFK-townmap] 缺核心掛點(renderTownNPCMap/#town-npc-map)，村莊動態地圖停用。'); } catch (e) {}
        return;
    }

    var BASE = 'assets/townmap/';
    var BW = 24, BH = 23;
    var STEP = 16 / 24;                          // 走一格的秒數：官方未變身 wlk=16（每單位 1/24 秒）
    var IDLE_FPS = 6;                            // 待機動作：每幀 4 單位
    // 方向 0..7＝畫面上的 西北,北,東北,東,東南,南,西南,西（＝天堂 heading＝classanim 資料夾順序）→ 格子位移
    var DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    var DIR_SFX = ['2', 'F', '', 'd3', 'd4', 'd5', 'd6', 'd7'];

    var st = document.createElement('style');
    st.id = 'afk-townmap-css';
    st.textContent = '#town-npc-map > canvas.afk-tm-cv{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;touch-action:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}' +   // NPC、面板都疊在上面，點它們不受影響
        // 進村莊的載入條：蓋住整個地圖（地圖 z-index:1 自成堆疊環境，9000 只在地圖裡面最上層，不會蓋過 NPC 浮動視窗）
        '#town-npc-map > .afk-tm-load,#battle-view > .afk-tm-load{position:absolute;inset:0;z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(4,7,11,.86);transition:opacity .25s;}' +
        '.afk-tm-load > .afk-tm-txt{font-size:14px;font-weight:700;letter-spacing:2px;color:#e8cf8f;text-shadow:0 1px 2px #000,0 0 4px #000;}' +
        '#town-npc-map > .afk-tm-load.out,#battle-view > .afk-tm-load.out{opacity:0;}' +
        // 狩獵區（地圖模式）：地圖畫在最底層；原本的怪物卡片變透明、移到怪物站的位置（只留點擊與特效定位）；原本的角色／隊員／寵物圖藏起來（地圖上畫）
        '#battle-view.afk-hm{background-image:none!important;position:relative;}' +
        // 核心打死怪時會在特效層（#vfx-layer）另外複製一份怪物圖播倒地動畫；地圖上自己播了死亡動作 → 藏起來，不然同一隻怪倒兩次
        'body.afk-hm-on #vfx-layer > .vfx-ghost{display:none!important;}' +
        '#battle-view.afk-hm > canvas.afk-tm-cv{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;touch-action:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}' +
        // 選擇器刻意疊兩次 id：原作手機版（area-fit / mob-grid）的卡片規則也帶 !important、權重是兩個 id＋三個 class，不疊會輸（卡片被拉高、整排被推到右邊＝傷害數字跑到右下角）
        '#battle-view.afk-hm #mob-list#mob-list{position:absolute!important;inset:0!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;display:block!important;transform:none!important;pointer-events:none;z-index:2;}' +
        '#battle-view.afk-hm #mob-list#mob-list .mob-target{position:absolute!important;width:48px!important;height:70px!important;min-height:0!important;max-height:none!important;opacity:0!important;pointer-events:auto;transform:none!important;margin:0!important;padding:0!important;right:auto!important;bottom:auto!important;}' +
        '#battle-view.afk-hm #mob-list#mob-list .mob-target:not([data-uid]){visibility:hidden!important;pointer-events:none!important;}' +   // 空格子：沒有怪可以對位，別擋住點地圖
        '#battle-view.afk-hm #mob-list#mob-list .mob-target .mob-img-wrap{position:absolute!important;inset:0!important;}' +
        '#battle-view.afk-hm #mob-list#mob-list .mob-target .mob-img-inner{width:100%!important;height:100%!important;transform:none!important;}' +
        '#battle-view.afk-hm #player-morph-sprite,#battle-view.afk-hm .party-sprite,#battle-view.afk-hm #pet-layer{opacity:0!important;pointer-events:none!important;}' +
        '.afk-tm-load > .afk-tm-bar{width:min(62%,340px);height:10px;padding:1px;border:1px solid #8a6a2c;border-radius:2px;background:#140f06;box-shadow:inset 0 0 4px #000,0 0 8px rgba(0,0,0,.7);}' +
        '.afk-tm-load > .afk-tm-bar > i{display:block;height:100%;width:0;background:linear-gradient(#f6dc8c,#c08a2c 55%,#8a5e18);}';
    (document.head || document.documentElement).appendChild(st);

    // ── 載入 ──────────────────────────────────────────
    var prog = { n: 0, done: 0 };   // 開始載／載完（成功失敗都算）的檔案數：進村莊載入條的進度
    function track(p) { prog.n++; return p.then(function (v) { prog.done++; return v; }, function (e) { prog.done++; throw e; }); }
    var loading = {};
    function loadScript(src) {
        if (loading[src]) return loading[src];
        return (loading[src] = track(new Promise(function (ok, bad) {
            var s = document.createElement('script');
            s.src = src; s.onload = ok; s.onerror = function () { delete loading[src]; bad(new Error('載不到 ' + src)); };
            document.head.appendChild(s);
        })));
    }
    function get(url, kind) {
        return track(fetch(url).then(function (r) { if (!r.ok) throw new Error('載不到 ' + url + '（' + r.status + '）'); return kind === 'json' ? r.json() : r.arrayBuffer(); }));
    }
    function loadImg(src) {
        return track(new Promise(function (ok, bad) {
            var im = new Image();
            im.onload = function () { ok(im); };
            im.onerror = function () { bad(new Error('載不到 ' + src)); };
            im.src = src;
        }));
    }
    // 地圖資料放在 Cloudflare R2（tools/upload-r2.mjs 上傳，檔名帶內容雜湊、快取一年）；入口 remote.json 跟遊戲一起發佈。
    //   沒有 remote.json（本機開發剛產完資料）就讀 assets/townmap/ 底下原檔名。
    var REMOTE = null, remoteP = null;
    if (/[?&]tmlocal\b/.test(location.search)) window.__tmTEST = function () { return S; };   // 開發用：測試腳本看地圖狀態（玩家的網址不會帶 ?tmlocal）
    function loadRemote() {
        if (/[?&]tmlocal\b/.test(location.search)) return remoteP || (remoteP = Promise.resolve(REMOTE = null));   // 開發用：網址帶 ?tmlocal 讀本機剛產的資料
        return remoteP || (remoteP = fetch(BASE + 'remote.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
            .then(function (j) { REMOTE = (j && j.base && j.towns && j.maps) ? j : null; }));
    }
    function townsUrl() { return REMOTE ? REMOTE.base + REMOTE.towns : BASE + 'towns.json'; }
    function mapUrl(id) { return REMOTE ? (REMOTE.maps[id] ? REMOTE.base + REMOTE.maps[id] : null) : BASE + 'm' + id + '.json'; }
    function regionUrl(t, rx, ry) { return REMOTE ? REMOTE.base + 'm' + t.id + '/' + t.d.files.r[rx + '_' + ry] : BASE + 'm' + t.id + '/r' + rx + '_' + ry + '.bin'; }
    function pageUrl(t, k) { return REMOTE ? REMOTE.base + 'm' + t.id + '/' + t.d.files.p[k] : BASE + 'm' + t.id + '/p' + k + '.webp'; }
    var townsP = null;   // towns.json：村莊 id → { map, home, npc{名字:[x,y]}, spots }
    function loadTowns() {
        return townsP || (townsP = loadRemote().then(function () { return get(townsUrl(), 'json'); }).catch(function (e) { townsP = null; throw e; }));
    }
    var maps = {};   // 用戶端地圖編號 → { id, d 總表, reg[區] 走到附近才載, pages[頁] 有區用到才載 }
    function loadMap(id) {
        if (maps[id]) return maps[id].p;
        var t = maps[id] = { id: id, reg: [], pages: [] }, u = mapUrl(id);
        if (!u) { delete maps[id]; return Promise.reject(new Error('remote.json 沒有地圖 ' + id)); }
        t.p = Promise.all([loadScript(BASE + 'hero.js'), get(u, 'json')]).then(function (a) {
            if (!a[1] || a[1].v !== 5) throw new Error('資料格式不對：m' + id);   // 瀏覽器還快取著別版的資料：留原背景
            t.d = a[1]; return t;
        }).catch(function (e) { delete maps[id]; throw e; });
        return t.p;
    }

    // ── 分區：只載角色附近的區＋它們用到的拼圖頁，走遠了放掉 ───────────
    var PREFETCH = 16;     // 畫面外再多載幾格內的區（走過去之前就載好）
    var KEEP = 24;         // 離畫面超過幾格的區放掉
    var CHUNK_MAX = 24;    // 地面分塊快取最多幾塊（每塊 512×512，約 1MB）
    function pos(d, hx, gy, X, Y, k) {   // 小塊的畫面位置（半格 x、y 加了 off 偏移存成無號數）
        var h = hx - d.off, ly = gy - d.off, lx = h >> 1;
        X[k] = 24 * (lx + ly) - (h & 1 ? 0 : 24) + d.ox; Y[k] = 12 * (ly - lx) - 11 + d.oy;
        return [lx, ly];
    }
    // 區檔（格式見 tools/gen-townmap.js）：uint32 nPal,nFlat,nTall 後各段對齊 4 bytes
    function unpackRegion(d, r, buf) {
        var o = 0, rs = d.rs;
        function take(T, n, sz) { var a = new T(buf, o, n); o += (n * sz + 3) & ~3; return a; }
        var head = take(Uint32Array, 3, 4), nP = head[0], nF = head[1], nT = head[2];
        r.pal = take(Uint32Array, nP, 4); r.g = take(Uint16Array, rs * rs * 2, 2); r.f = take(Uint8Array, rs * rs, 1);
        r.fIdx = take(Uint16Array, nF, 2); var fHx = take(Uint16Array, nF, 2), fGy = take(Uint16Array, nF, 2); r.fOrd = take(Uint32Array, nF, 4);
        r.tIdx = take(Uint16Array, nT, 2); var tHx = take(Uint16Array, nT, 2), tGy = take(Uint16Array, nT, 2); r.tLy = take(Uint8Array, nT, 1); r.tSeq = take(Uint32Array, nT, 4);
        var k, ci, cj, b;
        // 照地面分塊分桶：貼地的每個碰到的分塊都放（拼地面用）、立著的照左上角（每幀挑畫面裡的）
        r.fX = new Int32Array(nF); r.fY = new Int32Array(nF); r.fBy = {};
        for (k = 0; k < nF; k++) {
            pos(d, fHx[k], fGy[k], r.fX, r.fY, k);
            for (cj = Math.max(0, Math.floor(r.fY[k] / d.cs)); cj <= Math.min(d.cy - 1, Math.floor((r.fY[k] + BH - 1) / d.cs)); cj++)
                for (ci = Math.max(0, Math.floor(r.fX[k] / d.cs)); ci <= Math.min(d.cx - 1, Math.floor((r.fX[k] + BW - 1) / d.cs)); ci++)
                    (r.fBy[b = cj * d.cx + ci] || (r.fBy[b] = [])).push(k);
        }
        r.tX = new Int32Array(nT); r.tY = new Int32Array(nT); r.tKey = new Int32Array(nT); r.tBy = {};
        for (k = 0; k < nT; k++) {
            var c = pos(d, tHx[k], tGy[k], r.tX, r.tY, k);
            r.tKey[k] = 4 * (c[1] - c[0]) + r.tLy[k];   // 4×畫面列＋圖層：越大越前面
            b = Math.min(d.cy - 1, Math.max(0, Math.floor(r.tY[k] / d.cs))) * d.cx + Math.min(d.cx - 1, Math.max(0, Math.floor(r.tX[k] / d.cs)));
            (r.tBy[b] || (r.tBy[b] = [])).push(k);
        }
    }
    // 拼圖頁：有區用到才載（refs＝用到它的區數），沒區用了就放掉
    function usePage(t, k) {
        var pg = t.pages[k];
        if (!pg) { pg = t.pages[k] = { refs: 0, img: null }; pg.p = loadImg(pageUrl(t, k)).then(function (im) { pg.img = im; }); }
        pg.refs++;
        return pg.p;
    }
    function freePage(t, k) {
        var pg = t.pages[k]; if (!pg || --pg.refs > 0) return;
        if (pg.img) pg.img.src = '';   // 解開的拼圖佔記憶體大，馬上放
        t.pages[k] = null;
    }
    function loadRegion(t, i) {
        var d = t.d, rx = i % d.rnx, ry = (i / d.rnx) | 0;
        var r = t.reg[i] = { i: i, x0: rx * d.rs, y0: ry * d.rs, ready: false, failed: false, pages: d.regions[i] };
        r.pages.forEach(function (k) { usePage(t, k); });   // 先佔著，區還沒到就被放掉時一併還
        r.p = get(regionUrl(t, rx, ry)).then(function (buf) {
            unpackRegion(d, r, buf);
            return Promise.all(r.pages.map(function (k) { return t.pages[k].p; }));
        }).then(function () {
            if (t.reg[i] !== r) return;   // 等的時候已經走遠被放掉
            r.ready = true; dirty = true;
            if (S && S.t === t) for (var c in S.chunks) if (S.chunks[c].partial) { delete S.chunks[c]; S.nChunks--; }   // 缺這區畫的分塊重畫
        }).catch(function (e) {
            try { console.warn('[AFK-townmap] 地圖分區載入失敗（那一區當成不能走）：', e); } catch (x) {}
            r.failed = true;
        });
        return r;
    }
    // 載入範圍內的區（還沒載的開始載）；回傳範圍內有資料的區
    function wantRegions(x0, y0, x1, y1) {
        var t = S.t, d = t.d, out = [];
        for (var ry = Math.max(0, Math.floor(y0 / d.rs)); ry <= Math.min(d.rny - 1, Math.floor(y1 / d.rs)); ry++)
            for (var rx = Math.max(0, Math.floor(x0 / d.rs)); rx <= Math.min(d.rnx - 1, Math.floor(x1 / d.rs)); rx++) {
                var i = ry * d.rnx + rx; if (d.regions[i] === -1) continue;
                out.push(t.reg[i] || loadRegion(t, i));
            }
        return out;
    }
    function dropRegions(x0, y0, x1, y1) {
        var t = S.t, d = t.d;
        for (var i = 0; i < t.reg.length; i++) {
            var r = t.reg[i]; if (!r) continue;
            if (r.x0 + d.rs - 1 >= x0 && r.x0 <= x1 && r.y0 + d.rs - 1 >= y0 && r.y0 <= y1) continue;
            t.reg[i] = null;
            r.pages.forEach(function (k) { freePage(t, k); });
        }
    }
    // 畫面（鏡頭位置＋寬高）涵蓋的格子範圍 [x0,y0,x1,y1]，多留 pad 格
    function viewBox(cam, W, H, pad) {
        var d = S.t.d, s0 = (cam[0] - d.ox - 48) / 24, s1 = (cam[0] + W - d.ox + 24) / 24, d0 = (cam[1] - d.oy - 12) / 12, d1 = (cam[1] + H - d.oy + 12) / 12;
        return [Math.floor((s0 - d1) / 2) - pad, Math.floor((s0 + d0) / 2) - pad, Math.ceil((s1 - d0) / 2) + pad, Math.ceil((s1 + d1) / 2) + pad];
    }

    // ── 外型（角色／變身／寵物）───────────────────────────
    //   class＝assets/classanim/<外型><方向>/<武器>_<動作>_N（八方向、走路 4 幀；落腳點與逐幀位移查 TOWNMAP_HERO）
    //   anim ＝assets/anim/<名>/d<方向>/<動作>_N（寵物、有走路幀的變身；走路一輪＝一格、每幀往前 1/N 格，用等分扣掉）
    //   morph＝assets/morphanim/<名>{,2,F}/idle_N（沒有走路幀的變身：移動時也播待機，repo 裡沒有它們的走路動畫）
    var imgCache = {};
    function img(src) {
        var im = imgCache[src];
        if (!im) { im = imgCache[src] = new Image(); im.src = src; }
        return im;
    }
    // 發光的怪（鬼火、閃電球、火炎蛋、鬼魂、各種精靈…）：天堂用加亮疊加畫，圖檔是「半透明的暗色光暈」，照一般方式畫會把地面蓋暗成一團黑影（玩家回報）。
    //   每個外型量一次它的原始待機圖（資料夾根目錄 idle_0，核心戰鬥畫面用的那套）：半透明像素過半是暗的、不透明的部分幾乎沒有暗色 → 改用 screen 畫。
    //   ⚠ 不能量地圖當下畫的那張：八方向走路幀（tools/gen-walk-anim）把光暈存成不透明的深藍色，量了會認不出來。screen 畫時深色幾乎看不見，兩套都適用。
    //   數字分不乾淨的幾隻照名字指定（熔岩高崙的岩石身體就是半透明深色；火精靈王光暈比例低但也是發光的）。量小張的離屏畫布
    var GLOW_FIX = { '熔岩高崙': false, '火精靈王': true, '夢幻之島火精靈王': true, '強力火屬性精靈': true }, glowOf = {};
    function glowLook(L) {
        if (!L || L.kind === 'class') return false;
        var k = L.name; if (k in glowOf) return glowOf[k];
        if (k in GLOW_FIX) return (glowOf[k] = GLOW_FIX[k]);
        var base = (L.kind === 'anim' ? 'assets/anim/' : 'assets/morphanim/') + k, pf = null;
        ['idle_', 'attack_', 'walk_'].some(function (p) { return mf(base, p) && (pf = p); });
        if (!pf) return (glowOf[k] = false);
        var im = img(base.replace(k, encodeURIComponent(k)) + '/' + pf + '0.png');
        if (!im.complete) return false;   // 還在下載：先照一般畫，下載好再定
        if (!im.naturalWidth) return (glowOf[k] = false);
        var v = false;
        try {
            var w = Math.min(im.naturalWidth, 256), h = Math.min(im.naturalHeight, 256), c = document.createElement('canvas'); c.width = w; c.height = h;
            var x = c.getContext('2d'); x.drawImage(im, 0, 0);
            var p = x.getImageData(0, 0, w, h).data, vis = 0, semiDark = 0, opq = 0, opqDark = 0;
            for (var i = 0; i < p.length; i += 4) {
                var a = p[i + 3], hi = Math.max(p[i], p[i + 1], p[i + 2]); if (a < 8) continue;
                vis++;
                if (a < 230) { if (hi < 110) semiDark++; } else { opq++; if (hi < 90) opqDark++; }
            }
            v = vis > 50 && semiDark / vis > 0.5 && (!opq || opqDark / opq < 0.2);
        } catch (e) {}
        return (glowOf[k] = v);
    }
    function mf(folder, pfx) { try { return (ANIM_MANIFEST[folder] || {})[pfx] || 0; } catch (e) { return 0; } }
    var SFX3 = ['2', 'F', '', '', '', '', '2', '2'];   // 三方向變身：右半邊→東北那夾、左半邊→西北那夾（同 js/09 ANIM_DIR_SFX3）
    function classLook(av, wk) {
        var tab = window.TOWNMAP_HERO && TOWNMAP_HERO[av]; if (!tab) return null;
        if (!tab[wk]) wk = 'unarmed';
        if (!tab[wk]) return null;
        return { key: 'c:' + av + ':' + wk, kind: 'class', av: av, wk: wk, at: tab[wk], walkN: 4, idleN: mf('assets/classanim/' + av + 'd5', wk + '_idle_') || 1 };
    }
    function animLook(name) {
        var at = window.TOWNMAP_ANIM && TOWNMAP_ANIM[name]; if (!at) return null;
        var f = 'assets/anim/' + name;
        return { key: 'a:' + name, kind: 'anim', name: name, at: at, walkN: mf(f, 'd5/walk_'), idleN: mf(f, 'd5/idle_') };   // idleN 可能是 0：只補了走路幀
    }
    function morphLook(name) {
        var M = window.TOWNMAP_MORPH || {};
        if (!M[name]) return null;
        return { key: 'm:' + name, kind: 'morph', name: name, three: !!(M[name + '2'] && M[name + 'F']), walkN: 0, idleN: mf('assets/morphanim/' + name, 'idle_') || 1 };
    }
    function morphFolder(L, dir) { return L.name + (L.three ? SFX3[dir] : ''); }
    function frameSrc(L, dir, act, k, shadow) {
        var s = (shadow ? '_s_' : '_') + k + '.png';
        if (L.kind === 'class') return 'assets/classanim/' + encodeURIComponent(L.av + DIR_SFX[dir]) + '/' + L.wk + '_' + act + s;
        if (L.kind === 'anim') return 'assets/anim/' + encodeURIComponent(L.name) + '/d' + dir + '/' + act + s;
        return 'assets/morphanim/' + encodeURIComponent(morphFolder(L, dir)) + '/idle' + s;
    }
    // 落腳點＝影子中心在圖裡的位置；走路幀本身每幀往前挪，角色改成平滑移動，所以把這段扣掉，人才穩、地圖平順捲動
    function anchorOf(L, dir, walk, k) {
        if (L.kind === 'class') { var a = L.at[dir]; return walk ? [a[0] + (k ? a[2 * k] : 0), a[1] + (k ? a[2 * k + 1] : 0)] : [a[8], a[9]]; }
        if (L.kind === 'anim') {
            var b = L.at[dir]; if (!walk) return [b[2], b[3]];
            var d = DIRS[dir], f = k / L.walkN;
            return [b[0] + 24 * (d[0] + d[1]) * f, b[1] + 12 * (d[1] - d[0]) * f];
        }
        return TOWNMAP_MORPH[morphFolder(L, dir)] || TOWNMAP_MORPH[L.name];
    }
    function preloadDir(L, dir) {
        if (!L) return;
        if (L.idle) preloadDir(L.idle, dir);
        for (var k = 0; k < L.walkN; k++) { img(frameSrc(L, dir, 'walk', k)); img(frameSrc(L, dir, 'walk', k, true)); }
        for (k = 0; k < L.idleN; k++) { img(frameSrc(L, dir, 'idle', k)); img(frameSrc(L, dir, 'idle', k, true)); }
    }
    // 玩家目前外型（跟狩獵區同一套規則）：變身優先——真夏納＝職業式變身(classanim 真夏納<外型>)；
    //   一般變身有同名怪物走路動畫就用它，沒有就用變身的待機動畫；沒變身＝職業外型＋手上武器
    function heroLook() {
        try {
            var p = (typeof player !== 'undefined') ? player : null;   // 核心的 let 全域
            if (!p) return null;
            var av = p.avatar;
            var wkOf = function (sets) { return (typeof _classAnimWpnKey === 'function' && sets && sets[av]) ? _classAnimWpnKey(p, sets[av]) : 'unarmed'; };
            var pf = p._setPoly || ((p.buffs && p.buffs.poly > 0 && p.poly) ? p.poly : null);
            if (pf && pf.classMorph && typeof TRUE_SHANNA_ANIM_SETS !== 'undefined' && TRUE_SHANNA_ANIM_SETS[av]) {
                var cm = classLook(pf.n + av, wkOf(TRUE_SHANNA_ANIM_SETS));
                if (cm) return cm;
            }
            var m = (typeof _actorMorphName === 'function') ? _actorMorphName(p) : null;
            if (m) {
                // 走路用 assets/anim 的八方向走路幀；站著用變身自己的待機（八方向待機只有寵物類才有）
                var al = animLook(m), ml = morphLook(m);
                if (al && al.walkN) { if (!al.idleN && ml) { al.idle = ml; al.key += '+' + ml.key; } return al; }
                if (ml) return ml;
            }
            return classLook(av, wkOf(typeof CLASS_ANIM_SETS !== 'undefined' ? CLASS_ANIM_SETS : null));
        } catch (e) { return null; }
    }
    // 給裝備欄（afk-lmui）畫「面向玩家的待機（呼吸）」：目前外型（含變身）某方向的待機幀。
    //   外型表(hero.js)要等第一次進村莊／狩獵區才載到，還沒載到回 null → 裝備欄自己退回頭像圖（本外掛關掉時同理）
    window.AFK_TM_HERO_IDLE = function (dir) {
        var L = heroLook(); if (!L) return null;
        var d = dir == null ? 5 : dir, IL = L.idle || L, act = 'idle', walk = false, n = IL.idleN || 0;
        if (!n) { act = 'walk'; walk = true; n = 1; }   // 只有走路幀的外型：停在走路第 0 幀
        return {
            key: L.key + '@' + d, n: n, fps: IDLE_FPS,
            src: function (k) { return frameSrc(IL, d, act, k); },
            shadow: function (k) { return frameSrc(IL, d, act, k, true); },
            anchor: function (k) { return anchorOf(IL, d, walk, k); }
        };
    };
    // 走一格的秒數：官方未變身每格 16/24 秒 × 遊戲自己的移速倍率（變身走速、加速／勇敢／疾走／餅乾／行走加速、裝備移速，js/02）
    function stepSec() {
        var m = 1;
        try { if (typeof playerMoveDelayMultiplier === 'function') m = playerMoveDelayMultiplier(); } catch (e) {}
        return STEP * ((m > 0.05 && m < 20) ? m : 1);
    }

    // ── 執行狀態 ────────────────────────────────────────
    var S = null;          // 目前掛著的村莊
    var running = false, lastT = 0, clock = 0, dirty = true, lastSig = '', lastCam = null;

    // 能不能走照模擬器地圖檔（bit0 往 x+1 的邊能過、bit1 往 y-1 的邊能過）；地圖最外一圈、還沒載的區當牆
    function pass(x, y) {
        var d = S.t.d; if (x < 1 || y < 1 || x >= d.cw - 1 || y >= d.ch - 1) return 0;
        var r = S.t.reg[Math.floor(y / d.rs) * d.rnx + Math.floor(x / d.rs)];
        return (r && r.ready) ? r.f[(y - r.y0) * d.rs + x - r.x0] & 3 : 0;
    }
    // 站得上去：至少一條邊能過（模擬器「修正怪物穿牆」）、沒有 NPC 站著
    function blocked(x, y) { return !pass(x, y) || S.occ[y * S.t.d.cw + x] === 1; }
    // 角色可走範圍：鏡頭以角色為中心時整個畫面還在地圖資料裡的格子（S.lim 依畫面大小算，見 draw）。
    //   在範圍外（例如畫面剛變大）只准往裡走，不會卡住。回傳離範圍幾格（0＝範圍內）。
    function outside(x, y) {
        var L = S.lim; if (!L) return 0;
        return Math.max(L.x0 - x, x - L.x1, L.y0 - y, y - L.y1, 0);
    }
    // 從 (x,y) 往方向 k 走一步：照抄模擬器 L1V1Map.isPassable（斜走看旁邊那兩格的邊）
    function canStep(x, y, k) {
        var nx = x + DIRS[k][0], ny = y + DIRS[k][1];
        if (blocked(nx, ny)) return false;
        var o = outside(nx, ny); if (o && o >= outside(x, y)) return false;
        switch (k) {
            case 0: return !!(pass(x, y) & 2);
            case 1: return !!((pass(x, y - 1) & 1) || (pass(x + 1, y) & 2));
            case 2: return !!(pass(x, y) & 1);
            case 3: return !!(pass(x, y + 1) & 1);
            case 4: return !!(pass(nx, ny) & 2);
            case 5: return true;   // 目標格有任一條邊能過即可（上面 blocked 已擋）
            case 6: return !!(pass(nx, ny) & 1);
            default: return !!(pass(x - 1, y) & 2);
        }
    }
    // A* 八方向；很多條路一樣短時加一點「離起點終點直線多遠」，挑最直的，不會東、北、東、北鋸齒走。
    //   只在起點終點外框再多 24 格的範圍裡找（整張圖 512×512，每次都開整張的陣列太浪費；點地面、寵物跟隨都在畫面內）
    function findPath(sx, sy, gx, gy) {
        if ((sx === gx && sy === gy) || blocked(gx, gy)) return [];
        var d = S.t.d, P = 24, X0 = Math.max(0, Math.min(sx, gx) - P), Y0 = Math.max(0, Math.min(sy, gy) - P);
        var W = Math.min(d.cw - 1, Math.max(sx, gx) + P) - X0 + 1, H = Math.min(d.ch - 1, Math.max(sy, gy) + P) - Y0 + 1;
        sx -= X0; sy -= Y0; gx -= X0; gy -= Y0;
        var S0 = sy * W + sx, G = gy * W + gx;
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
                var nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
                if (nx < 0 || ny < 0 || nx >= W || ny >= H || !canStep(cx + X0, cy + Y0, k)) continue;
                var n = ny * W + nx, ng = g[c] + 1;
                if (ng < g[n]) { g[n] = ng; from[n] = c; push(n, ng + h(n)); }
            }
        }
        if (from[G] < 0) return [];
        var out = [], i = G; while (i !== S0) { out.push([i % W + X0, (i / W | 0) + Y0]); i = from[i]; }
        return out.reverse();
    }
    // 點到不能走的地方（牆、房子、樹）：改走到附近最近能站的格子
    function nearestWalkable(gx, gy) {
        var L = S.lim;   // 點到可走範圍外：先拉回範圍邊上
        if (L) { gx = Math.max(L.x0, Math.min(L.x1, gx)); gy = Math.max(L.y0, Math.min(L.y1, gy)); }
        var ok = function (x, y) { return !blocked(x, y) && !outside(x, y); };
        if (ok(gx, gy)) return [gx, gy];
        var best = null, bd = 1e9;
        for (var r = 1; r <= 6 && !best; r++) for (var y = gy - r; y <= gy + r; y++) for (var x = gx - r; x <= gx + r; x++) {
            if (ok(x, y)) { var dd = (x - gx) * (x - gx) + (y - gy) * (y - gy); if (dd < bd) { bd = dd; best = [x, y]; } }
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
        if (S && S.kind === 'hunt' && S.me.act === 'death') return -1;   // 倒在地上：不能走
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
        if (S.kind === 'hunt' && S.me.act === 'death') return;
        if (S.kind === 'hunt') { var pe = huntPick(px, py); if (pe) { S.prefer = pe; S.manual = false; S.path = []; dirty = true; return; } }   // 點到怪：走過去打牠
        var d = S.t.d, s = (px + S.cam[0] - d.ox) / 24, dd = (py + S.cam[1] - d.oy) / 12;
        var c = nearestWalkable(Math.round((s - dd) / 2), Math.round((s + dd) / 2));
        if (!c) return;
        S.path = findPath(S.me.tx, S.me.ty, c[0], c[1]);
        if (S.path.length) { S.marker = { x: c[0], y: c[1], t: clock }; if (S.kind === 'hunt') { S.manual = true; S.prefer = null; } }   // 狩獵區點地面：先走過去，到了再自己找怪
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
        if (!canStep(me.tx, me.ty, d)) return false;
        me.sx = me.tx; me.sy = me.ty; me.tx += DIRS[d][0]; me.ty += DIRS[d][1]; me.t = 0; me.walking = true;
        me.step = stepSec();   // 每一步重算：路上喝水、加速剛好過期都會馬上反映
        S.trail.push([me.tx, me.ty]); if (S.trail.length > 80) S.trail.shift();   // 寵物沿著這條走
        preloadDir(S.form, d);
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
    // ── 寵物：沿著角色走過的格子跟在後面（第 i 隻落後 2+2i 格），離太遠就直接跳到那格 ──────
    // 跟著角色的夥伴：出戰寵物；狩獵區再加召喚物（召喚術、造屍術骷髏，js/23 summonRenderList）與迷魅的怪——
    //   核心把牠們畫在 #pet-layer，地圖模式那層藏起來了，不在這裡畫就整個看不到（玩家回報）。四種都用同一套欄位（form/hp/_animAct/_downed）
    function petsOut() {
        try {
            if (typeof petsOutList !== 'function' || typeof player === 'undefined' || !player || !player.cls) return [];
            var out = (petsOutList() || []).slice();
            if (S && S.kind === 'hunt') {
                if (typeof summonRenderList === 'function') out = out.concat(summonRenderList() || []);
                var c = player.charmed; if (c && c._charm && !c._downed && c.form) out.push(c);
            }
            return out;
        } catch (e) { return []; }
    }
    function compKey(p) { return p.uid || ('charm:' + p.form); }   // 迷魅的怪沒有 uid
    function spawnNear(x, y, taken) {
        for (var r = 1; r <= 3; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
            var nx = x + dx, ny = y + dy;
            if (blocked(nx, ny) || taken.some(function (c) { return c[0] === nx && c[1] === ny; })) continue;
            return [nx, ny];
        }
        return [x, y];
    }
    function syncPets() {
        var outs = petsOut(), keep = [], taken = [[S.me.tx, S.me.ty]];
        outs.forEach(function (p) {
            var L = animLook(p.formGfx || p.form) || morphLook(p.formGfx || p.form);
            if (!L) return;
            var a = null, key = compKey(p);
            for (var j = 0; j < S.pets.length; j++) if (S.pets[j].uid === key) a = S.pets[j];
            if (!a) {
                var c = spawnNear(S.me.tx, S.me.ty, taken.concat(keep.map(function (q) { return [q.tx, q.ty]; })));
                a = { uid: key, fx: c[0], fy: c[1], sx: c[0], sy: c[1], tx: c[0], ty: c[1], t: 1, dir: S.me.dir, walking: false, path: [], step: STEP, phase: Math.random() * 8 };
            }
            if (!a.look || a.look.key !== L.key) { a.look = L; preloadDir(L, a.dir); }
            keep.push(a);
        });
        S.pets = keep;
    }
    // 狩獵區：寵物的戰鬥動作照核心（js/22 _petAnimAct 記在寵物身上的 _animAct／_faceMobUid）——
    //   出手、被打播一輪動作並面向目標怪；倒地停在死亡最後一格、不跟著走；打怪時走到目標旁邊（不然站在角色後面空揮，被打也看不出來：玩家回報）
    function petSyncAct(a, p) {
        a.pet = true;
        if (p._downed) { if (a.act !== 'death') { a.act = 'death'; a.actT = performance.now(); } a.tgt = null; return; }
        if (a.act === 'death') a.act = null;   // 復活了
        var aa = p._animAct;
        if (aa && aa.t !== a._aT) {
            a._aT = aa.t;
            if (aa.k === 'attack' || aa.k === 'skill' || aa.k === 'hurt') { a.act = aa.k; a.actT = performance.now(); }
        }
        var e = p._faceMobUid != null ? S.entByUid[p._faceMobUid] : null;
        a.tgt = (e && e.alive && e.placed) ? e : null;
        if (a.tgt && !a.walking) { var k = dirTo(a.tx, a.ty, a.tgt.tx, a.tgt.ty); if (k >= 0) a.dir = k; }
    }
    function petTick(a, i, dt, cp) {
        if (cp) petSyncAct(a, cp);
        if (a.act === 'death') { a.walking = false; return; }
        var left = 0;
        if (a.t < 1) {
            var t = a.t + dt / a.step;
            if (t < 1) { a.t = t; a.fx = a.sx + (a.tx - a.sx) * t; a.fy = a.sy + (a.ty - a.sy) * t; return; }
            left = t - 1; a.t = 1; a.fx = a.tx; a.fy = a.ty;
        }
        var e = a.tgt, g;
        if (e && cheb(e.tx, e.ty, S.me.tx, S.me.ty) <= 10) {   // 有目標：走到它旁邊
            if (cheb(a.tx, a.ty, e.tx, e.ty) <= 1) { a.walking = false; var kf = dirTo(a.tx, a.ty, e.tx, e.ty); if (kf >= 0) a.dir = kf; return; }
            g = [e.tx, e.ty];
        } else {
            var tr = S.trail, gap = 2 + 2 * i; g = tr.length > gap ? tr[tr.length - 1 - gap] : null;
            if (!g || (g[0] === a.tx && g[1] === a.ty)) { a.walking = false; return; }
            if (Math.max(Math.abs(g[0] - a.tx), Math.abs(g[1] - a.ty)) > 12) {   // 跟丟了：直接到位
                a.fx = a.sx = a.tx = g[0]; a.fy = a.sy = a.ty = g[1]; a.path = []; a.walking = false; return;
            }
        }
        var gk = g[0] + ',' + g[1];
        if (!a.path.length || a.goal !== gk) { a.path = findPath(a.tx, a.ty, g[0], g[1]); a.goal = gk; }
        var n = a.path.shift();
        if (!n) { a.walking = false; return; }
        for (var k = 0; k < 8; k++) if (DIRS[k][0] === n[0] - a.tx && DIRS[k][1] === n[1] - a.ty) { a.dir = k; break; }
        a.sx = a.tx; a.sy = a.ty; a.tx = n[0]; a.ty = n[1]; a.walking = true;
        a.step = S.me.step || STEP;   // 跟主人同速
        a.t = Math.min(left * 1, 0.99); a.fx = a.sx + (a.tx - a.sx) * a.t; a.fy = a.sy + (a.ty - a.sy) * a.t;
        preloadDir(a.look, a.dir);
    }
    function tick(dt) {
        var me = S.me, cps = {};
        if (S.kind === 'hunt') petsOut().forEach(function (p) { cps[compKey(p)] = p; });
        S.pets.forEach(function (a, i) { petTick(a, i, dt, cps[a.uid]); });
        if (me.t < 1) {
            var t = me.t + dt / (me.step || STEP);
            if (t >= 1) {
                me.t = 1; me.fx = me.tx; me.fy = me.ty;
                var pt = S.portals && S.portals[me.tx + ',' + me.ty];   // 走上傳送點：玩家自己走的才傳（村莊一律是玩家自己走）
                if (pt && (S.kind !== 'hunt' || S.manual || wantDir() >= 0)) { me.walking = false; usePortal(pt); return; }
                nextStep();
                if (me.walking && me.t === 0) me.t = Math.min(t - 1, 0.99);   // 接著走下一步：多出來的時間帶過去，每格之間不會頓一下
            } else me.t = t;
            me.fx = me.sx + (me.tx - me.sx) * me.t; me.fy = me.sy + (me.ty - me.sy) * me.t;
        } else if (S.path.length || wantDir() >= 0) nextStep();
        else me.walking = false;
    }

    // ── 畫面 ──────────────────────────────────────────
    // 小塊：區裡存的是 pal 位置 → 全圖編號 → 第幾頁第幾格
    function blit(c, r, idx, dx, dy) {
        var d = S.t.d, g = r.pal[idx], pg = S.t.pages[(g / d.per) | 0], im = pg && pg.img;
        if (!im) return;
        var s = g % d.per;
        c.drawImage(im, (s % d.cols) * d.cellW + 1, ((s / d.cols) | 0) * d.cellH + 1, BW, BH, dx, dy, BW, BH);
    }
    // 地面分塊：地磚＋貼地物件。碰到的區還沒載好就先畫有的、標成 partial，那區載好時重畫
    function buildChunk(ci, cj) {
        var t = S.t, d = t.d, cs = d.cs;
        var c = document.createElement('canvas'); c.width = cs; c.height = cs;
        var x = c.getContext('2d'), X0 = ci * cs, Y0 = cj * cs, partial = false;
        var sMin = Math.floor((X0 - d.ox - 48) / 24), sMax = Math.ceil((X0 + cs - d.ox + 24) / 24);
        var dMin = Math.floor((Y0 - d.oy - 12) / 12), dMax = Math.ceil((Y0 + cs - d.oy + 11) / 12);
        for (var dd = dMin; dd <= dMax; dd++) for (var s = sMin; s <= sMax; s++) {
            if ((s + dd) & 1) continue;
            var lx = (s - dd) / 2, ly = (s + dd) / 2;
            if (lx < 0 || ly < 0 || lx >= d.cw || ly >= d.ch) continue;
            var ri = Math.floor(ly / d.rs) * d.rnx + Math.floor(lx / d.rs), r = t.reg[ri];
            if (!r || !r.ready) { if (d.regions[ri] !== -1 && !(r && r.failed)) partial = true; continue; }
            var wx = 24 * s + d.ox - X0, wy = 12 * dd + d.oy - 11 - Y0, gi = ((ly - r.y0) * d.rs + lx - r.x0) * 2;
            blit(x, r, r.g[gi], wx - 24, wy);
            blit(x, r, r.g[gi + 1], wx, wy);
        }
        // 貼地物件：各區的分桶合起來照全域順序畫
        var b = cj * d.cx + ci, list = [];
        for (var i = 0; i < t.reg.length; i++) {
            var rr = t.reg[i], fb = rr && rr.ready && rr.fBy[b];
            if (fb) for (var j = 0; j < fb.length; j++) list.push([rr, fb[j]]);
        }
        list.sort(function (p, q) { return p[0].fOrd[p[1]] - q[0].fOrd[q[1]]; });
        for (j = 0; j < list.length; j++) { var o = list[j][0], k = list[j][1]; blit(x, o, o.fIdx[k], o.fX[k] - X0, o.fY[k] - Y0); }
        c.partial = partial;
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
        // 畫圖倍率一律取整數（1 或 2）：倍率帶小數（瀏覽器縮放 107%、手機 2.6 倍）時，各分塊會落在半個像素上、接縫露出細線
        var W = map.clientWidth, H = map.clientHeight, dpr = Math.max(1, Math.min(2, Math.round(window.devicePixelRatio || 1)));
        if (!W || !H) return;
        // 角色可走範圍：鏡頭置中時畫面不超出地圖資料（同 camera 的夾邊公式）；畫面大到放不下就不限（交給 camera 夾邊）
        var mm = Math.ceil((W / 2 / 24 + H / 2 / 12) / 2), L = { x0: mm, x1: d.cw - 1 - mm, y0: mm, y1: d.ch - 1 - mm };
        S.lim = (L.x0 < L.x1 && L.y0 < L.y1) ? L : null;
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
        var ctx = S.ctx, cam = camera(W, H, dpr), cx0 = cam[0], cy0 = cam[1];
        S.cam = cam;   // 點地面換算格子要用同一個鏡頭
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#0b1a26'; ctx.fillRect(0, 0, W, H);
        // 角色附近的區：畫面外 PREFETCH 格內先載，離畫面超過 KEEP 格的放掉（每 2 秒看一次）
        var vb = viewBox(cam, W, H, 0);
        wantRegions(vb[0] - PREFETCH, vb[1] - PREFETCH, vb[2] + PREFETCH, vb[3] + PREFETCH);
        if (clock - (S.dropAt || 0) > 2) { S.dropAt = clock; dropRegions(vb[0] - KEEP, vb[1] - KEEP, vb[2] + KEEP, vb[3] + KEEP); }
        // 地面分塊：第一次看到才做，最多留 CHUNK_MAX 塊（最久沒看到的先丟）
        var frame = S.frame = (S.frame || 0) + 1;
        var i0 = Math.max(0, Math.floor(cx0 / d.cs)), i1 = Math.min(d.cx - 1, Math.floor((cx0 + W) / d.cs));
        var j0 = Math.max(0, Math.floor(cy0 / d.cs)), j1 = Math.min(d.cy - 1, Math.floor((cy0 + H) / d.cs));
        for (var cj = j0; cj <= j1; cj++) for (var ci = i0; ci <= i1; ci++) {
            var key = cj * d.cx + ci, ch = S.chunks[key];
            if (!ch) { ch = S.chunks[key] = buildChunk(ci, cj); S.nChunks++; }
            ch.used = frame;
            ctx.drawImage(ch, ci * d.cs - cx0, cj * d.cs - cy0);
        }
        if (S.nChunks > CHUNK_MAX) {
            var old = Object.keys(S.chunks).filter(function (c) { return S.chunks[c].used !== frame; }).sort(function (p, q) { return S.chunks[p].used - S.chunks[q].used; });
            for (var oi = 0; oi < old.length && S.nChunks > CHUNK_MAX; oi++) { delete S.chunks[old[oi]]; S.nChunks--; }
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
        drawPortals(ctx, cam, W, H);
        // 立著的物件＋角色：依全域序號畫，角色插在第一個比他前面的小塊之前（各區畫面裡的合起來排）
        vis.length = 0;
        var bi0 = Math.max(0, Math.floor((cx0 - BW) / d.cs)), bj0 = Math.max(0, Math.floor((cy0 - BH) / d.cs));
        for (var ri = 0; ri < t.reg.length; ri++) {
            var r = t.reg[ri]; if (!r || !r.ready) continue;
            for (cj = bj0; cj <= j1; cj++) for (ci = bi0; ci <= i1; ci++) {
                var tb = r.tBy[cj * d.cx + ci]; if (!tb) continue;
                for (var q = 0; q < tb.length; q++) {
                    var k = tb[q], x = r.tX[k] - cx0, y = r.tY[k] - cy0;
                    if (x > -BW && y > -BH && x < W && y < H) vis.push({ r: r, k: k, s: r.tSeq[k] });
                }
            }
        }
        vis.sort(function (p, q) { return p.s - q.s; });
        // 角色與寵物依各自的「4×畫面列」插進去（走路中用起點終點較前面那列）
        var acts = [];
        function addActor(a, L, hero) {
            if (!L) return;
            var row = a.walking ? Math.max(a.sy - a.sx, a.ty - a.tx) : a.ty - a.tx;
            acts.push({ a: a, L: L, hero: hero, key: 4 * row + 19.5 + (hero ? 0.25 : 0) });
        }
        addActor(S.me, S.form, true);
        S.pets.forEach(function (p) { addActor(p, p.look, false); });
        if (S.kind === 'hunt') S.ents.forEach(function (e) {   // 狩獵區：畫面附近的怪（死掉的播完死亡動作才消失）
            if (e.placed && e.look && (e.alive || e.act === 'death') && e.tx >= vb[0] - 3 && e.tx <= vb[2] + 3 && e.ty >= vb[1] - 3 && e.ty <= vb[3] + 3) addActor(e, e.look, false);
        });
        acts.sort(function (x, y) { return x.key - y.key; });
        // 被樹或房子擋住的：最後再疊一層半透明的，才找得到人（村莊只管自己的角色；狩獵區連怪物一起，不然樹林裡什麼都看不到）
        var ai = 0, drawn = [], seeAll = S.kind === 'hunt';
        for (var n = 0; n < vis.length; n++) {
            var o = vis[n].r, e = vis[n].k;
            while (ai < acts.length && o.tKey[e] > acts[ai].key) {
                var it = acts[ai++];
                drawActor(ctx, cam, dpr, it, 1);
                if (it.hero || seeAll) { it.wx = 24 * (it.a.fx + it.a.fy) + d.ox; it.wy = 12 * (it.a.fy - it.a.fx) + d.oy; it.cov = false; drawn.push(it); }   // 身體大概的範圍：腳下往上 62、左右各 22
            }
            for (var di = 0; di < drawn.length; di++) {
                var dw = drawn[di];
                if (!dw.cov && o.tX[e] < dw.wx + 22 && o.tX[e] + BW > dw.wx - 22 && o.tY[e] < dw.wy && o.tY[e] + BH > dw.wy - 62) dw.cov = true;
            }
            blit(ctx, o, o.tIdx[e], o.tX[e] - cx0, o.tY[e] - cy0);
        }
        while (ai < acts.length) drawActor(ctx, cam, dpr, acts[ai++], 1);
        for (di = 0; di < drawn.length; di++) if (drawn[di].cov) drawActor(ctx, cam, dpr, drawn[di], drawn[di].hero ? 0.45 : 0.4);
        drawPortalNames(ctx, cam, W, H);
        if (S.kind === 'hunt') huntOverlay(ctx, cam); else placeNpcs(cam);
    }
    // 戰鬥動作（狩獵區）：attack/hurt/skill/death 播一輪；怪物死亡停在最後一幀再淡出，角色死亡倒在地上直到復活。回傳要畫的幀，播完回 null（改畫走路／待機）
    //   職業：八方向資料夾裡的 <武器>_attack/_hurt、death/skill；怪物：資料夾根目錄的單方向幀（面向左），角色在右邊就左右翻
    //   幀長照原作戰鬥畫面（js/09）：角色攻擊＝出手間隔÷幀數、施法照施法速度，收刀後停在最後一幀等下一刀；其餘 8 幀/秒。
    //   ⚠ 固定短幀長會一下播完、跳回待機姿勢再等下一刀＝打怪一頓一頓的（玩家回報）
    var ACT_MS = { attack: 125, hurt: 125, skill: 125, death: 130 }, ATK_HOLD_MS = 250;
    function actMs(a, act, n) {
        if (a === S.me && act === 'attack' && typeof _pmAtkFrameMs === 'function') return _pmAtkFrameMs(n);
        if (a === S.me && act === 'skill' && typeof _skillFrameMs === 'function') return _skillFrameMs(n);
        return ACT_MS[act] || 125;
    }
    function actionFrame(a, L, now) {
        var act = a.act, el = now - a.actT, ms, folder, name, n, an, flip = false, dir8 = false;
        if (L.kind === 'class') {
            folder = 'assets/classanim/' + L.av + DIR_SFX[a.dir];
            name = (act === 'death' || act === 'skill') ? act : L.wk + '_' + act;
            n = mf(folder, name + '_');
            var at = L.at[a.dir]; an = (act === 'attack' && at.length > 11) ? [at[10], at[11]] : [at[8], at[9]];
            folder = 'assets/classanim/' + encodeURIComponent(L.av + DIR_SFX[a.dir]);
        } else if (L.kind === 'anim') {
            var R = window.TOWNMAP_ANIMROOT && TOWNMAP_ANIMROOT[L.name];
            var has8 = a.pet && L.at && L.at[a.dir] && mf('assets/anim/' + L.name, 'd' + a.dir + '/' + (act === 'skill' ? 'attack' : act) + '_');   // 夥伴有八方向動作就用（面向目標），怪物照單方向
            if (R && R[act] && !has8) {
                name = act; n = mf('assets/anim/' + L.name, act + '_'); an = R[act];
                folder = 'assets/anim/' + encodeURIComponent(L.name);
                flip = !!a.faceRight;
            } else {   // 八方向的動作（寵物）：d<方向>/<動作>，跟同方向待機同一張畫布 → 用待機落腳點；沒有 skill 幀就播 attack
                var b = L.at && L.at[a.dir]; if (!b) return null;
                var base = 'assets/anim/' + L.name, dp = 'd' + a.dir + '/';
                name = act; n = mf(base, dp + act + '_');
                if (!n && act === 'skill') { name = 'attack'; n = mf(base, dp + 'attack_'); }
                an = [b[2], b[3]]; dir8 = true;
                folder = 'assets/anim/' + encodeURIComponent(L.name) + '/d' + a.dir;
            }
        } else return null;
        if (!n) return null;
        var withSh = L.kind === 'class' || dir8;
        if (a.msFor !== a.actT) {   // 每次出手算一次就好；整組動作圖先下載，第一次往這個方向打才不會跳幀
            a.msFor = a.actT; a.ms = actMs(a, act, n);
            for (var pi = 0; pi < n; pi++) { img(folder + '/' + name + '_' + pi + '.png'); if (withSh) img(folder + '/' + name + '_s_' + pi + '.png'); }
        }
        ms = a.ms;
        var k = Math.floor(el / ms), fade = 1;
        if (k >= n) {
            if (act === 'attack' && a === S.me && el < n * ms + ATK_HOLD_MS) k = n - 1;   // 收刀幀停一下等下一刀，不閃回待機
            else if (act !== 'death') { a.act = null; return null; }
            else {
                k = n - 1;
                if (a !== S.me && !a.pet) { fade = Math.max(0, 1 - (el - n * ms) / 600); if (!fade) return { gone: true }; }   // 寵物倒地：躺著等復活
            }
        }
        return { src: folder + '/' + name + '_' + k + '.png', sh: withSh ? folder + '/' + name + '_s_' + k + '.png' : null, an: an, flip: flip, fade: fade };
    }
    function drawActor(ctx, cam, dpr, it, alpha) {
        var a = it.a, L = it.L, d = S.t.d;
        // 正在走（核心在角色走向下一隻怪的路上照樣出手）：播走路，不然攻擊姿勢平移過去＝人物在滑（玩家回報）
        var moving = (a.walking || a.glide) && (a.vt != null ? a.vt : a.t) < 1 && L.walkN > 0;
        if (a.act && !(moving && a.act !== 'death')) {
            var fa = actionFrame(a, L, performance.now());
            if (!fa && a.act === 'death' && a !== S.me) return;   // 這隻怪沒有死亡動作：打死就消失，不要站著留在原地
            if (fa) {
                if (fa.gone) return;
                var fx = 24 * (a.fx + a.fy) + d.ox - cam[0], fy = 12 * (a.fy - a.fx) + d.oy - cam[1];
                var bimg = img(fa.src), simg = fa.sh && img(fa.sh), oyy = Math.round((fy - fa.an[1]) * dpr) / dpr;
                ctx.save();
                if (fa.flip) { ctx.translate(Math.round(fx * dpr) / dpr, 0); ctx.scale(-1, 1); fx = 0; }
                var oxx = Math.round((fx - fa.an[0]) * dpr) / dpr;
                if (bimg.complete && bimg.naturalWidth) {
                    if (alpha === 1 && simg && simg.complete && simg.naturalWidth) { ctx.globalAlpha = 0.55 * fa.fade; ctx.drawImage(simg, oxx, oyy); }
                    if (glowLook(L)) ctx.globalCompositeOperation = 'screen';
                    ctx.globalAlpha = alpha * fa.fade; ctx.drawImage(bimg, oxx, oyy);
                    ctx.restore();
                } else { ctx.restore(); drawLast(ctx, cam, dpr, a, alpha * fa.fade); }   // 這幀還沒下載完：先畫上一張，不要整個不見
                ctx.globalAlpha = 1;
                return;
            }
        }
        var at = a.vt != null ? a.vt : a.t;   // 狩獵區：邏輯每 0.1 秒走一次，畫面用推算的進度才平順
        var walk = (a.walking || a.glide) && at < 1 && L.walkN > 0, k, act = walk ? 'walk' : 'idle';
        if (!walk && L.idle) L = L.idle;                                   // 變身站著：用變身自己的待機
        if (walk) k = Math.min(L.walkN - 1, Math.floor(at * L.walkN));
        else if (L.idleN) k = Math.floor(clock * IDLE_FPS + (a.phase || 0)) % L.idleN;   // 沒有走路幀的變身：移動中也播待機
        else { act = 'walk'; k = 0; walk = true; }                         // 只有走路幀又沒有待機：停在走路第 0 幀
        var an = anchorOf(L, a.dir, walk, k); if (!an) return;
        var px = 24 * (a.fx + a.fy) + d.ox - cam[0], py = 12 * (a.fy - a.fx) + d.oy - cam[1];
        var ox = Math.round((px - an[0]) * dpr) / dpr, oy = Math.round((py - an[1]) * dpr) / dpr;
        var pk = (L.key || L.name) + ':' + a.dir;
        if (a._pd !== pk) { a._pd = pk; preloadDir(L, a.dir); }   // 換方向／換外型：這個方向的走路、待機幀一次先抓
        var body = img(frameSrc(L, a.dir, act, k)), sh = img(frameSrc(L, a.dir, act, k, true));
        if (body.complete && body.naturalWidth) {
            if (alpha === 1 && sh.complete && sh.naturalWidth) { ctx.globalAlpha = 0.55; ctx.drawImage(sh, ox, oy); }
            var glow = glowLook(L);
            if (glow) ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = alpha; ctx.drawImage(body, ox, oy);
            if (glow) ctx.globalCompositeOperation = 'source-over';
            a._lb = { im: body, an: an, glow: glow };
        } else drawLast(ctx, cam, dpr, a, alpha);   // 這幀還沒下載完：先畫上一張成功畫過的（不然人物、怪物會一閃一閃不見）
        ctx.globalAlpha = 1;
    }
    function drawLast(ctx, cam, dpr, a, alpha) {
        var lb = a._lb; if (!lb) return;
        var d = S.t.d, px = 24 * (a.fx + a.fy) + d.ox - cam[0], py = 12 * (a.fy - a.fx) + d.oy - cam[1];
        if (lb.glow) ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = alpha; ctx.drawImage(lb.im, Math.round((px - lb.an[0]) * dpr) / dpr, Math.round((py - lb.an[1]) * dpr) / dpr);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
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
        // 每秒重查一次外型與寵物：換武器、變身、加減寵物不必離開村莊就會反映
        if (clock - (S.lookAt || 0) > 1) {
            S.lookAt = clock;
            var L = heroLook();
            if ((L && L.key) !== (S.form && S.form.key)) { S.form = L; preloadDir(L, S.me.dir); dirty = true; }
            var np = S.pets.length; syncPets(); if (S.pets.length !== np) dirty = true;
        }
        if (S.kind === 'hunt') {   // 狩獵區：走路、怪物都在遊戲主迴圈（每 0.1 秒）算，這裡只推算位置來畫；怪一直在動，固定約 30 幀
            if (now - (S.lastDraw || 0) >= 33 || dirty) {
                huntInterp(now);
                try { draw(); } catch (e) { console.warn('[AFK-townmap] 狩獵區繪圖失敗，改回原畫面：', e); unmount(true); running = false; return; }
                S.lastDraw = now; dirty = false;
            }
            requestAnimationFrame(loop); return;
        }
        tick(dt);
        var me = S.me, moving = (me.walking && me.t < 1) || S.pets.some(function (p) { return p.walking; });
        var sig = moving ? 'w' + clock : 'i' + me.tx + ',' + me.ty + ',' + me.dir + ',' + Math.floor(clock * IDLE_FPS);
        if (sig !== lastSig || dirty || S.marker || S.map.clientWidth !== S.lastW || S.map.clientHeight !== S.lastH) {
            try { draw(); } catch (e) { console.warn('[AFK-townmap] 繪圖失敗，改回原背景：', e); unmount(true); running = false; return; }
            S.lastW = S.map.clientWidth; S.lastH = S.map.clientHeight; dirty = false; lastSig = sig;
        }
        requestAnimationFrame(loop);
    }
    function kick() { if (!running) { running = true; lastT = 0; requestAnimationFrame(loop); } }

    // ── 掛上／拿掉 ───────────────────────────────────────
    // NPC 照名字站到模擬器的位置；對不到的（遊戲自己加的、叫賣玩家）依序站起點附近的空位
    function attachNpcs() {
        var d = S.t.d, cw = d.cw, tw = S.town, used = {}, k = 0;
        S.occ = new Uint8Array(cw * d.ch);
        S.npcs = [];
        var els = S.map.querySelectorAll('.town-npc');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (getComputedStyle(el).display === 'none') continue;   // NPC 條列式開著時地圖上的 NPC 是藏起來的，不佔位
            var nm = el.querySelector('.tn-name'), p = nm && tw.npc[nm.textContent.trim()];
            if (!p || used[p]) p = tw.spots.length ? tw.spots[k++ % tw.spots.length] : tw.home;
            used[p] = 1;
            S.npcs.push({ el: el, x: p[0], y: p[1] });
            S.occ[p[1] * cw + p[0]] = 1;   // 角色不會穿過 NPC
        }
        S.npcDirty = true; lastCam = null;
    }
    function releaseMap(t) {   // 換到別張圖：這張圖載著的區、拼圖全部放掉
        t.reg.forEach(function (r) { if (r) r.pages.forEach(function (k) { freePage(t, k); }); });
        t.reg = [];
    }
    function unmount(restoreBg) {
        if (!S) return;
        if (S.cv && S.cv.parentNode) S.cv.parentNode.removeChild(S.cv);
        if (restoreBg && S.bg != null) S.map.style.backgroundImage = S.bg;
        S.npcs && S.npcs.forEach(function (n) { n.el.style.removeProperty('left'); n.el.style.removeProperty('top'); });
        if (S.kind !== 'hunt' && S.map) S.map.classList.remove('afk-tm-live');
        if (S.kind === 'hunt') {   // 狩獵區：怪物卡片放回原本的排法
            S.map.classList.remove('afk-hm'); document.body.classList.remove('afk-hm-on');
            [].forEach.call(S.map.querySelectorAll('#mob-list .mob-target'), function (c) { c.style.removeProperty('left'); c.style.removeProperty('top'); });
            if (restoreBg && typeof applyAreaBackground === 'function') try { applyAreaBackground(); } catch (e) {}
        }
        S = null;
    }
    var mountWait = null;   // 等 towns.json 時的村莊 id（載入條算「還在載」）
    function mount(townId) {
        var map = document.getElementById('town-npc-map');
        if (!map) { unmount(false); return; }
        mountWait = townId;
        loadTowns().then(function (all) {
            if (mountWait !== townId) return;
            mountWait = null;
            mountTown(townId, all[townId], map);
        }, function (e) {
            if (mountWait === townId) mountWait = null;
            try { console.warn('[AFK-townmap] 村莊表載入失敗（直接開檔案時讀不到），維持原背景：', e); } catch (x) {}
            unmount(true);
        });
    }
    function mountTown(townId, tw, map) {
        if (!tw) { unmount(false); return; }   // 對不到用戶端地圖的村莊：維持原背景
        var keep = S && S.townId === townId ? S : null;   // 同一個村莊重畫(開關 NPC 視窗等)：角色位置、地面快取都留著
        if (!keep) {
            unmount(false);
            for (var id in maps) if (+id !== tw.map && maps[id].d) releaseMap(maps[id]);
            var cv = document.createElement('canvas'); cv.className = 'afk-tm-cv'; cv.setAttribute('aria-hidden', 'true');
            bindInput(cv);
            S = { townId: townId, town: tw, map: map, cv: cv, ctx: cv.getContext('2d'), ready: false, chunks: {}, nChunks: 0, path: [], npcs: [], marker: null, pets: [], trail: [] };
        }
        S.map = map;
        S.bg = map.style.backgroundImage;   // 核心剛設好的靜態背景；資料到之前先留著，失敗時也用它
        map.insertBefore(S.cv, map.firstChild);
        var cur = S;
        loadMap(tw.map).then(function (t) {
            if (S !== cur) return;
            if (!S.t) {
                S.t = t;
                var h = takeArrive(townId) || tw.home; S.me = { fx: h[0], fy: h[1], tx: h[0], ty: h[1], sx: h[0], sy: h[1], t: 1, dir: 5, walking: false, step: STEP };
                S.trail = [[h[0], h[1]]];
            }
            // 畫面看得到的區載好才換掉原背景（其餘邊走邊載）；地圖藏著量不到大小就當電腦版 800×450
            var W = map.clientWidth || 800, H = map.clientHeight || 450, R0 = Math.ceil((W / 48 + H / 24) / 2) + 2, mx = S.me.tx, my = S.me.ty;
            return Promise.all(wantRegions(mx - R0, my - R0, mx + R0, my + R0).map(function (r) { return r.p; })).then(function () {
                if (S !== cur) return;
                S.form = heroLook();   // 落腳點表(hero.js)跟地圖資料一起載，載好才查得到；之後每秒重查(換武器、變身會換動畫)
                map.classList.add('afk-tm-live');   // 動態地圖載好了：天堂M 介面看到這個就不把 NPC 重排成一排（NPC 照站位；開了 NPC 條列式則整批藏著、走下方清單）
                attachNpcs();
                syncPets();
                preloadDir(S.form, S.me.dir);
                map.style.backgroundImage = 'none';
                S.ready = true; dirty = true;
                attachPortals(tw.map);
                kick();
            });
        }).catch(function (e) {
            try { console.warn('[AFK-townmap] 村莊地圖資料載入失敗，維持原背景：', e); } catch (x) {}
            if (S === cur) unmount(true);
        });
    }

    // ── 進村莊／換村莊：地圖上先跑一段載入條（站長要求）──────────────────
    //   至少 MIN_LOAD 秒；說話之島地圖資料還在載就照實際進度（載完的檔案數）跑，載好才收。
    //   掛在 renderTownNPCs（只有 changeMap 進村莊時呼叫：登入、回村、換村莊）；renderTownNPCMap 另有重畫用途(叫賣玩家更新等)不掛。
    var MIN_LOAD = 1.5, LB = null;
    function showLoadBar(hostId) {   // 村莊：#town-npc-map；狩獵區（地圖模式）：#battle-view
        var map = document.getElementById(hostId || 'town-npc-map'); if (!map) return;
        if (!LB) {
            var el = document.createElement('div'); el.className = 'afk-tm-load'; el.setAttribute('aria-hidden', 'true');
            el.innerHTML = '<div class="afk-tm-txt">地圖讀取中…</div><div class="afk-tm-bar"><i></i></div>';
            LB = { el: el, fill: el.querySelector('i'), raf: 0, hide: 0 };
        }
        clearTimeout(LB.hide);
        LB.host = hostId || 'town-npc-map';
        LB.t0 = performance.now(); LB.shown = 0; LB.n0 = prog.n; LB.d0 = prog.done; LB.on = true;
        LB.el.classList.remove('out'); LB.fill.style.width = '0%';
        map.appendChild(LB.el);
        if (!LB.raf) LB.raf = requestAnimationFrame(stepLoadBar);
    }
    function stepLoadBar(now) {
        LB.raf = 0;
        var map = document.getElementById(LB.host);
        if (map && LB.el.parentNode !== map) map.appendChild(LB.el);   // 核心重畫村莊會清空地圖：放回去
        var sec = (now - LB.t0) / 1000, busy = !!((LB.host === 'town-npc-map' && mountWait) || huntWait || (S && !S.ready && S.map === map));
        var n = prog.n - LB.n0, dn = prog.done - LB.d0, real = busy ? 0.1 + 0.85 * (n ? Math.min(1, dn / n) : 0) : 1;   // 還在載最多到 95%
        LB.shown = Math.max(LB.shown, Math.min(sec / MIN_LOAD, real));
        LB.fill.style.width = (LB.shown * 100).toFixed(1) + '%';
        if (LB.shown < 1 && sec < 30) { LB.raf = requestAnimationFrame(stepLoadBar); return; }   // 30 秒還沒好也收（地圖失敗會自己退回原背景）
        LB.on = false; LB.el.classList.add('out');
        LB.hide = setTimeout(function () { if (!LB.on && LB.el.parentNode) LB.el.parentNode.removeChild(LB.el); }, 260);
    }
    if (typeof window.renderTownNPCs === 'function') {
        var _origNPCs = window.renderTownNPCs;
        window.renderTownNPCs = function () {
            try { showLoadBar(); } catch (e) {}
            return _origNPCs.apply(this, arguments);
        };
    }

    var _orig = window.renderTownNPCMap;
    window.renderTownNPCMap = function (townId) {
        var r = _orig.apply(this, arguments);
        try { mount(townId); } catch (e) { try { console.warn('[AFK-townmap] 掛載失敗：', e); } catch (x) {} unmount(true); }
        var m = document.getElementById('town-npc-map');
        if (LB && LB.on && LB.host === 'town-npc-map' && m && LB.el.parentNode !== m) m.appendChild(LB.el);   // 原函式清空了地圖：載入條放回最上層
        return r;
    };
    // ── 狩獵區（地圖模式）：怪物照模擬器重生表站在地圖上，角色自己走過去打（站長 2026-10-15）──────────
    //   戰鬥計算整套沿用核心（傷害、經驗、掉寶、技能、頭目出現率、野外 PvP）：只換「怪從哪來」——
    //   地圖上的怪平常自己閒晃；角色走到旁邊（拿弓 6 格內）那一刻才用核心 spawnMob 放進戰鬥格子開打
    //   （怪物池暫時換成「這隻＋這張圖的頭目」，頭目出現率、野外 PvP 照舊），主動怪看到角色會追過來；
    //   打死照重生表的秒數在重生範圍內重生。核心自己的定時補怪在這張圖關掉。
    //   走路、怪物 AI 都在核心 tick（每 0.1 秒）裡算：分頁在背景也照樣打怪（掛機遊戲必須）；畫面另外用 rAF 推算位置畫。
    //   離線結算（afk-offline 停掉主迴圈 _gameLoopId 時）不用地圖模式，照原本三格出怪。
    //   畫面：怪物全畫在地圖上；核心的怪物卡片變透明、移到怪物身上（點怪鎖定、傷害數字、死亡特效照原本的跑）；
    //   原本的角色圖藏起來，施法／弓箭的發射點改成地圖上的角色（_pmCasterRect）。
    //   資料：hunts.json（tools/gen-townmap.js 產；HUNT_MAPS 列到的狩獵地圖才有，其餘照原本畫面）
    // ── 傳送點（樓梯、洞口、碼頭：模擬器 dungeon 表，tools/gen-townmap.js planPortals 產 portals.json）──────
    //   地上畫一個藍圈＋目的地名字；玩家自己走上去（點地面、按住方向）才傳送，自動打怪路過不算（不然掛機掛一掛被傳走）。
    //   目的地是另一張遊戲地圖 → 走核心 changeMap（進入條件、鑰匙／傳送符照核心規則，不夠就擋下、核心自己提示），到了從終點出發；
    //   同一張遊戲地圖裡的 → 直接移過去
    var portalsP = null, PORTALS = null, ARRIVE = null;
    function loadPortals() {
        return portalsP || (portalsP = loadRemote().then(function () {
            var u = REMOTE ? (REMOTE.portals ? REMOTE.base + REMOTE.portals : null) : BASE + 'portals.json';
            return u ? get(u, 'json') : {};
        }).then(function (j) { PORTALS = j || {}; return PORTALS; }, function () { portalsP = null; return {}; }));
    }
    function attachPortals(mapId) {
        var cur = S;
        loadPortals().then(function () {
            if (S !== cur) return;
            var idx = {}; ((PORTALS && PORTALS[mapId]) || []).forEach(function (p) { idx[p[0] + ',' + p[1]] = p; });
            S.portals = idx; dirty = true;
        });
    }
    function takeArrive(gameId) {   // 剛從傳送點過來：從終點出發（20 秒內有效，換圖被擋或載很久就作廢）
        var a = ARRIVE; ARRIVE = null;
        return (a && a.game === gameId && Date.now() - a.t < 20000) ? [a.x, a.y] : null;
    }
    function portalName(g) {
        try { var n = typeof mapDisplayName === 'function' ? mapDisplayName(g) : null; if (n) return n; } catch (e) {}
        try { var tw = DB.towns && DB.towns[g]; if (tw && tw.n) return tw.n; } catch (e) {}
        return '';
    }
    function usePortal(p) {
        var g = p[2], x = p[3], y = p[4], cur = (typeof mapState !== 'undefined' && mapState.current) || '';
        S.path = []; S.manual = false; S.prefer = null; S.goal = null;
        if (g === cur || (S.kind !== 'hunt' && g === S.townId)) { jumpHero(x, y); return; }
        ARRIVE = { game: g, x: x, y: y, t: Date.now() };
        try { setMapSelectors(g); changeMap(); } catch (e) { try { console.warn('[AFK-townmap] 傳送點換地圖失敗：', e); } catch (x2) {} }
        if (mapState.current !== g) ARRIVE = null;   // 進入條件不夠：核心已擋下並提示，原地不動
    }
    function jumpHero(x, y) {
        var me = S.me;
        me.fx = me.sx = me.tx = x; me.fy = me.sy = me.ty = y; me.t = 1; me.walking = false; me.p0x = me.p1x = x; me.p0y = me.p1y = y;
        S.path = []; S.trail = [[x, y]];
        S.pets.forEach(function (p) { p.fx = p.sx = p.tx = x; p.fy = p.sy = p.ty = y; p.t = 1; p.walking = false; p.path = []; p.p0x = p.p1x = x; p.p0y = p.p1y = y; });
        dirty = true;
    }
    // 藍圈畫在地面上（角色、物件之下），名字另外畫在最上層（不被人物、石頭蓋住）。不會閃，停著不用一直重畫（省電）；同目的地挨在一起的只寫一次名字
    function portalsInView(cam, W, H) {
        var d = S.t.d, out = [];
        for (var k in S.portals) {
            var p = S.portals[k], x = 24 * (p[0] + p[1]) + d.ox - cam[0], y = 12 * (p[1] - p[0]) + d.oy - cam[1];
            if (x > -60 && y > -40 && x < W + 60 && y < H + 40) out.push({ p: p, x: x, y: y });
        }
        return out;
    }
    function drawPortals(ctx, cam, W, H) {
        if (!S.portals) return;
        ctx.fillStyle = 'rgba(90,200,255,.22)'; ctx.strokeStyle = 'rgba(140,225,255,.9)'; ctx.lineWidth = 2;
        portalsInView(cam, W, H).forEach(function (v) { ctx.beginPath(); ctx.ellipse(v.x, v.y, 20, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    }
    function drawPortalNames(ctx, cam, W, H) {
        if (!S.portals) return;
        var named = [];
        ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.fillStyle = '#bfefff';
        portalsInView(cam, W, H).forEach(function (v) {
            if (named.some(function (q) { return q.g === v.p[2] && Math.abs(q.x - v.x) < 90 && Math.abs(q.y - v.y) < 50; })) return;
            named.push({ g: v.p[2], x: v.x, y: v.y });
            var nm = portalName(v.p[2]); if (!nm) return;
            ctx.strokeText('▶ ' + nm, v.x, v.y - 14); ctx.fillText('▶ ' + nm, v.x, v.y - 14);
        });
    }
    var huntsP = null, huntWait = null, HUNTS = null, AGGRO = 7;
    function loadHunts() {
        return huntsP || (huntsP = loadRemote().then(function () {
            var u = REMOTE ? (REMOTE.hunts ? REMOTE.base + REMOTE.hunts : null) : BASE + 'hunts.json';
            return u ? get(u, 'json') : {};
        }).then(function (j) { HUNTS = j || {}; return HUNTS; }).catch(function (e) { huntsP = null; throw e; }));
    }
    function liveLoop() { return typeof _gameLoopId === 'undefined' || _gameLoopId !== null; }   // 離線結算時主迴圈停著
    function huntOn() { return !window.AFK_TOGGLES || AFK_TOGGLES.enabled('huntmap'); }
    function huntOwns() { return !!(S && S.kind === 'hunt' && S.huntId === mapState.current && liveLoop() && huntOn()); }   // 載入中也算：不讓核心先補怪
    function huntActive() { return huntOwns() && S.ready; }
    function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
    function dirTo(ax, ay, bx, by) { var dx = Math.sign(bx - ax), dy = Math.sign(by - ay); for (var k = 0; k < 8; k++) if (DIRS[k][0] === dx && DIRS[k][1] === dy) return k; return -1; }
    function regionReadyAt(x, y) { var d = S.t.d, r = S.t.reg[Math.floor(y / d.rs) * d.rnx + Math.floor(x / d.rs)]; return !!(r && r.ready); }
    function heroRange() {   // 拿弓：6 格內就能打；其他：走到旁邊
        try { var w = player.eq && player.eq.wpn && DB.items[player.eq.wpn.id]; return (w && (w.isBow || w.ranged)) ? 6 : 1; } catch (e) { return 1; }
    }
    function huntMaybeMount() {   // 進狩獵區（換地圖、讀檔、離線結算完）都經過這裡：有地圖資料就換成地圖模式
        if (!huntOn() || !liveLoop() || typeof mapState === 'undefined' || !mapState.current || mapState.current.indexOf('town_') === 0) return;
        if (S && S.kind === 'hunt' && S.huntId === mapState.current) return;
        if (!HUNTS) { if (!huntsP) loadHunts().then(function () { huntMaybeMount(); }, function () {}); return; }   // 載好馬上掛（自動戰鬥暫停時主迴圈不跑）
        var info = HUNTS[mapState.current];
        if (info) mountHunt(mapState.current, info);
        else if (S && S.kind === 'hunt') unmount(true);
    }
    function mountHunt(huntId, info) {
        var bv = document.getElementById('battle-view'); if (!bv) return;
        unmount(false);
        for (var id in maps) if (+id !== info.map && maps[id].d) releaseMap(maps[id]);
        var cv = document.createElement('canvas'); cv.className = 'afk-tm-cv'; cv.setAttribute('aria-hidden', 'true');
        bindInput(cv);
        S = { kind: 'hunt', huntId: huntId, hunt: info, map: bv, cv: cv, ctx: cv.getContext('2d'), ready: false, chunks: {}, nChunks: 0, path: [], npcs: [], marker: null, pets: [], trail: [], ents: [], entByUid: {}, ht: 0 };
        S.bg = bv.style.backgroundImage;
        bv.insertBefore(cv, bv.firstChild); bv.classList.add('afk-hm'); document.body.classList.add('afk-hm-on');
        showLoadBar('battle-view');
        var cur = S;
        loadMap(info.map).then(function (t) {
            if (S !== cur) return;
            S.t = t;
            var h = takeArrive(huntId) || info.home; S.me = { fx: h[0], fy: h[1], tx: h[0], ty: h[1], sx: h[0], sy: h[1], t: 1, dir: 5, walking: false, step: STEP };
            S.trail = [[h[0], h[1]]];
            S.occ = new Uint8Array(t.d.cw * t.d.ch);
            var W = bv.clientWidth || 800, H = bv.clientHeight || 450, R0 = Math.ceil((W / 48 + H / 24) / 2) + 2;
            return Promise.all(wantRegions(h[0] - R0, h[1] - R0, h[0] + R0, h[1] + R0).map(function (r) { return r.p; })).then(function () {
                if (S !== cur) return;
                S.form = heroLook(); syncPets(); preloadDir(S.form, S.me.dir);
                buildEnts(); placeNear();   // 先把附近的怪擺好（自動戰鬥暫停時主迴圈不跑，畫面也要看得到怪）
                S.lastLogicMs = performance.now();
                S.ready = true; dirty = true; attachPortals(info.map); kick();
            });
        }).catch(function (e) {
            try { console.warn('[AFK-townmap] 狩獵區地圖載入失敗，改回原本的戰鬥畫面：', e); } catch (x) {}
            if (S === cur) unmount(true);
        });
    }
    // 重生點 [怪物 id, 數量, 中心 x, y, 隨機範圍 rx, ry, 方框 x1, y1, x2, y2, 重生秒數 最短, 最長]
    function buildEnts() {
        S.ents = []; S.entByUid = {};
        S.hunt.spawns.forEach(function (sp, si) {
            var base = DB.mobs[sp[0]]; if (!base) return;
            for (var i = 0; i < sp[1]; i++) {
                var e = { mob: sp[0], name: base.n, look: animLook(base.n) || morphLook(base.n), sp: si, aggro: base.beh === '主動',
                    placed: false, alive: true, uid: null, fx: 0, fy: 0, tx: 0, ty: 0, sx: 0, sy: 0, t: 1, dir: Math.floor(Math.random() * 8), walking: false, step: 1, next: 0, phase: Math.random() * 8 };
                pickHome(e); S.ents.push(e);
            }
        });
    }
    // 每隻怪在重生範圍（方框，或中心±隨機範圍）裡分到自己的出生點：分布照模擬器，不會全擠到角色附近
    function pickHome(e) {
        var sp = S.hunt.spawns[e.sp];
        if (sp[6] && sp[8]) { var x0 = Math.min(sp[6], sp[8]), x1 = Math.max(sp[6], sp[8]), y0 = Math.min(sp[7], sp[9]), y1 = Math.max(sp[7], sp[9]); e.hx = x0 + Math.floor(Math.random() * (x1 - x0 + 1)); e.hy = y0 + Math.floor(Math.random() * (y1 - y0 + 1)); }
        else { var rx = Math.max(sp[4], 3), ry = Math.max(sp[5], 3); e.hx = sp[2] + Math.round((Math.random() * 2 - 1) * rx); e.hy = sp[3] + Math.round((Math.random() * 2 - 1) * ry); }
    }
    function spawnCell(e) {   // 出生點那區載好了：出生點附近 3 格內四邊都能走的格子；都是牆就重抽出生點
        if (!regionReadyAt(e.hx, e.hy)) return null;
        for (var r = 0; r <= 3; r++) for (var y = e.hy - r; y <= e.hy + r; y++) for (var x = e.hx - r; x <= e.hx + r; x++) {
            if (cheb(x, y, e.hx, e.hy) === r && pass(x, y) === 3) return [x, y];
        }
        pickHome(e);
        return null;
    }
    function putEnt(e, x, y) { e.fx = e.sx = e.tx = e.ox = x; e.fy = e.sy = e.ty = e.oy = y; e.t = 1; e.walking = false; e.placed = true; e.next = S.ht + Math.floor(Math.random() * 40); }
    function entStep(e, k, sec) {
        if (!canStep(e.tx, e.ty, k)) return false;
        var nx = e.tx + DIRS[k][0], ny = e.ty + DIRS[k][1];
        if (nx === S.me.tx && ny === S.me.ty) return false;   // 不走到角色身上
        e.sx = e.tx; e.sy = e.ty; e.tx = nx; e.ty = ny; e.t = 0; e.walking = true; e.step = sec; e.dir = k;
        return true;
    }
    function stepToward(e, x, y, sec) { var k = dirTo(e.tx, e.ty, x, y); return k >= 0 && (entStep(e, k, sec) || entStep(e, (k + 1) % 8, sec) || entStep(e, (k + 7) % 8, sec)); }
    function freeSlot() { var n = (typeof mobSlotCount === 'function') ? mobSlotCount() : 3; for (var i = 0; i < n; i++) if (!mapState.mobs[i]) return i; return -1; }
    function slotOf(uid) { for (var i = 0; i < mapState.mobs.length; i++) if (mapState.mobs[i] && mapState.mobs[i].uid === uid) return i; return -1; }
    // 開打：用核心的 spawnMob 把這隻放進空的戰鬥格子（怪物池暫時換成「這隻＋這張圖的頭目」→ 頭目出現率、野外 PvP 照原本）
    function engage(e) {
        if (e.uid) return true;
        if (!e.alive || e.sp < 0) return false;
        var i = freeSlot(); if (i < 0) return false;
        var cur = mapState.current, pool = DB.maps[cur]; if (!pool) return false;
        DB.maps[cur] = [e.mob].concat(pool.filter(function (id) { return DB.mobs[id] && DB.mobs[id].boss; }));
        try { spawnMob(i); } finally { DB.maps[cur] = pool; }
        var m = mapState.mobs[i]; if (!m) return false;
        if (mapState.spawnAt) mapState.spawnAt[i] = null;
        e.uid = m.uid; S.entByUid[m.uid] = e;
        if (m.n !== e.name) { var L = animLook(m.n) || morphLook(m.n); e.name = m.n; if (L) e.look = L; }   // 抽到頭目：外型跟著換
        if (typeof renderMobs === 'function') renderMobs();
        return true;
    }
    // 戰鬥格子跟地圖上的怪對帳：格子裡沒了（瞬移、換圖清掉）就放回地圖；格子裡多出來的（存檔帶來的、地圖載好前出的）放到角色旁邊
    function syncEngaged() {
        var live = {};
        mapState.mobs.forEach(function (m) { if (m && !m._dead) live[m.uid] = m; });
        for (var uid in S.entByUid) if (!live[uid]) { var e = S.entByUid[uid]; delete S.entByUid[uid]; if (e.uid == uid) e.uid = null; }
        mapState.mobs.forEach(function (m) {
            if (!m || m._dead || S.entByUid[m.uid]) return;
            var me = S.me, c = null;
            for (var k = 0; k < 8 && !c; k++) { var x = me.tx + DIRS[(k + 3) % 8][0], y = me.ty + DIRS[(k + 3) % 8][1]; if (pass(x, y) === 3) c = [x, y]; }
            c = c || [me.tx + 1, me.ty];
            var e = { mob: null, name: m.n, look: animLook(m.n) || morphLook(m.n), sp: -1, aggro: true, placed: true, alive: true, uid: m.uid, t: 1, dir: 6, walking: false, step: 1, next: 0, phase: 0 };
            putEnt(e, c[0], c[1]);
            S.ents.push(e); S.entByUid[m.uid] = e;
        });
    }
    function huntKilled(m) {
        var e = S.entByUid[m.uid]; if (!e) return;
        delete S.entByUid[m.uid]; e.uid = null; e.alive = false; e.walking = false; e.act = 'death'; e.actT = performance.now();
        if (S.prefer === e) S.prefer = null;
        if (e.sp < 0) { e.gone = true; return; }   // 收養來的不重生
        var sp = S.hunt.spawns[e.sp], r0 = sp[10] || 60, r1 = Math.max(r0, sp[11] || r0);
        e.respawnAt = S.ht + Math.round((r0 + Math.random() * (r1 - r0)) * 10);
        pickHome(e);   // 重生在範圍裡另一個點（死亡動作播完前還留在原地）
    }
    function nearestEnt(radius) {
        var me = S.me, best = null, bd = radius + 1;
        for (var i = 0; i < S.ents.length; i++) {
            var e = S.ents[i]; if (!e.alive || !e.placed || e.gone || (e.noPathUntil || 0) > S.ht) continue;
            var d = cheb(me.tx, me.ty, e.tx, e.ty) - (e.uid ? 100 : 0);   // 已經在打的優先
            if (d < bd) { bd = d; best = e; }
        }
        return best;
    }
    function face(e) { var k = dirTo(S.me.tx, S.me.ty, e.tx, e.ty); if (k >= 0 && !S.me.walking) S.me.dir = k; }
    // 角色：自己找最近的怪走過去打；方向鍵／按住＝玩家自己走；點地面＝走過去，到了停 2 秒再自己找怪
    function heroAI(idle) {
        var me = S.me;
        if (!player || player.dead) { S.path = []; return; }
        if (!pass(me.tx, me.ty) && regionReadyAt(me.tx, me.ty)) {   // 瞬移到牆裡：拉到旁邊能站的地方
            var c = nearestWalkable(me.tx, me.ty); if (c) { me.fx = me.sx = me.tx = c[0]; me.fy = me.sy = me.ty = c[1]; }
        }
        if (wantDir() >= 0) { S.prefer = null; return; }
        if (S.manual) { if (!S.path.length && !me.walking) { S.manual = false; S.autoAt = S.ht + 20; } return; }
        if (idle) { if (S.goal) { S.path = []; S.goal = null; } return; }   // 自動暫停：玩家自己走，不自動找怪
        if (S.ht < (S.autoAt || 0)) return;
        var range = heroRange(), tgt = (typeof getTarget === 'function') ? getTarget() : null, te = tgt && S.entByUid[tgt.uid];
        if (te && cheb(me.tx, me.ty, te.tx, te.ty) <= range) { S.path = []; face(te); return; }   // 打得到：站著打
        var e = (S.prefer && S.prefer.alive && S.prefer.placed) ? S.prefer : (te || nearestEnt(20));
        if (!e) { roam(); return; }
        S.roaming = false;
        if (cheb(me.tx, me.ty, e.tx, e.ty) <= range) {
            if (engage(e)) { var idx = slotOf(e.uid); if (idx >= 0 && mapState.targetIdx !== idx && typeof setTarget === 'function') setTarget(idx); S.prefer = null; }
            S.path = []; face(e); return;
        }
        if (S.goal !== e || S.ht >= (S.repath || 0) || !S.path.length) {   // 怪會動：每 0.5 秒重找一次路
            S.goal = e; S.repath = S.ht + 5;
            var p = findPath(me.tx, me.ty, e.tx, e.ty);
            if (p.length) p.pop(); else e.noPathUntil = S.ht + 50;   // 不走到怪身上；走不到的先換別隻
            S.path = p;
        }
    }
    // 附近 20 格沒有怪（打光了、還在重生）：往最近一隻活著或 30 秒內會重生的怪那邊走，不要站著發呆（玩家回報）
    //   太遠的先走到那個方向 20 格左右（找路有範圍限制），走到了再找下一段；走不到的那隻先換別隻
    function roam() {
        var me = S.me;
        if (S.roaming && S.path.length && S.ht < S.roamAt) return;
        var best = null, bd = 1e9;
        for (var i = 0; i < S.ents.length; i++) {
            var e = S.ents[i]; if (e.gone || (e.noPathUntil || 0) > S.ht) continue;
            if (!e.alive && (e.respawnAt || 0) - S.ht > 300) continue;
            var on = e.alive && e.placed, x = on ? e.tx : e.hx, y = on ? e.ty : e.hy, dd = cheb(me.tx, me.ty, x, y);
            if (dd < 6) continue;   // 就在這附近、只是還沒重生：換下一個地方
            if (dd < bd) { bd = dd; best = { e: e, x: x, y: y }; }
        }
        S.roaming = true; S.goal = null;
        if (!best) { S.path = []; S.roamAt = S.ht + 20; return; }
        var gx = best.x, gy = best.y;
        if (bd > 20) { gx = me.tx + Math.round((gx - me.tx) * 20 / bd); gy = me.ty + Math.round((gy - me.ty) * 20 / bd); }
        var c = nearestWalkable(gx, gy), p = c ? findPath(me.tx, me.ty, c[0], c[1]) : [];
        if (p.length) { S.path = p; S.roamAt = S.ht + 30; }
        else { S.path = []; best.e.noPathUntil = S.ht + 100; S.roamAt = S.ht + 5; }
    }
    // 地圖上的怪：開打中站到角色旁邊；主動怪看到角色追過來（到旁邊就開打）；其餘在出生點附近閒晃
    function entAI(e, idle) {
        var me = S.me;
        if (e.walking) {
            e.t += 0.1 / e.step;
            if (e.t >= 1) { e.t = 1; e.walking = false; }
            e.fx = e.sx + (e.tx - e.sx) * e.t; e.fy = e.sy + (e.ty - e.sy) * e.t;
            if (e.walking) return;
        }
        var dist = cheb(e.tx, e.ty, me.tx, me.ty);
        e.faceRight = (me.fx + me.fy) > (e.fx + e.fy);   // 單方向的戰鬥動作面向左：角色在右邊就翻過來
        if (e.uid) {
            if (dist > 1 && heroRange() === 1) stepToward(e, me.tx, me.ty, 0.6);
            else { var k = dirTo(e.tx, e.ty, me.tx, me.ty); if (k >= 0) e.dir = k; }
            return;
        }
        if (!idle && e.aggro && player && !player.dead && dist <= AGGRO) {   // 自動暫停時不算戰鬥：主動怪也只閒晃
            if (dist <= 1) { engage(e); return; }
            if (S.ht >= e.next) { stepToward(e, me.tx, me.ty, 0.7); e.next = S.ht + 1; }
            return;
        }
        if (S.ht >= e.next) {
            e.next = S.ht + 20 + Math.floor(Math.random() * 40);
            var d = Math.floor(Math.random() * 8);
            if (cheb(e.tx + DIRS[d][0], e.ty + DIRS[d][1], e.ox, e.oy) <= 6) entStep(e, d, 1.0);
        }
    }
    // 重生／第一次放：角色附近（60 格內）的才放，那區要已經載好。回傳 true＝這隻還沒放好
    function placeEnt(e) {
        if (e.gone || (!e.alive && S.ht < e.respawnAt)) return false;
        if (e.alive && e.placed) return false;
        if (e.sp < 0 || cheb(e.hx, e.hy, S.me.tx, S.me.ty) > 60) return true;
        var c = spawnCell(e); if (!c) return true;
        putEnt(e, c[0], c[1]); e.alive = true; e.act = null;
        return false;
    }
    function placeNear() { S.ents.forEach(placeEnt); }
    // idle＝自動戰鬥暫停（遊戲主迴圈不跑）：由下面的小計時器推動，怪物照常閒晃、玩家可以自己走，只是不開打
    function huntActors() { var out = [S.me].concat(S.pets); S.ents.forEach(function (e) { if (e.placed) out.push(e); }); return out; }
    function huntTick(idle) {
        var now = performance.now(), gap = now - (S.lastLogicMs || now);
        if (gap > 40 && gap < 600) S.tickMs = (S.tickMs || 100) * 0.7 + gap * 0.3;   // 遊戲主迴圈實際多久跑一次（手機忙時常常 >0.1 秒）
        S.ht++; S.lastLogicMs = now;
        // 畫面插值：起點＝這一刻畫面上的位置（接得上、不跳），終點＝這次邏輯算完的位置，下一拍之前畫面從起點滑到終點
        huntActors().forEach(function (a) { a.p0x = a.fx; a.p0y = a.fy; a.pt0 = a.vt != null ? a.vt : a.t; a.pcell = a.tx + ',' + a.ty; a.w0 = a.walking && a.t < 1; });
        huntTickLogic(idle);
        huntActors().forEach(function (a) {
            var mv = a.walking && a.t < 1, lx = mv ? a.sx + (a.tx - a.sx) * a.t : a.tx, ly = mv ? a.sy + (a.ty - a.sy) * a.t : a.ty;
            if (a.p0x == null || Math.abs(lx - a.p0x) + Math.abs(ly - a.p0y) > 3) { a.p0x = lx; a.p0y = ly; }   // 剛放上地圖／重生／瞬移：直接到位，不要滑過整張圖
            a.p1x = lx; a.p1y = ly; a.newStep = a.pcell !== a.tx + ',' + a.ty;
            a.stopped = a.w0 && !mv;   // 就是這一拍走完那一步停下來（畫面補播走路幀只限這一拍）
        });
    }
    function huntTickLogic(idle) {
        if (!idle) syncEngaged();
        heroAI(idle);
        tick(0.1);   // 角色、寵物走路（同村莊那套）
        var me = S.me;
        for (var i = 0; i < S.ents.length; i++) {
            var e = S.ents[i]; if (e.gone) continue;
            if (!e.alive || !e.placed) { placeEnt(e); continue; }
            if (!e.uid && cheb(e.tx, e.ty, me.tx, me.ty) > 40) continue;   // 離角色遠的先不動
            entAI(e, idle);
        }
    }
    // 遊戲主迴圈超過 0.3 秒沒跑（自動戰鬥暫停、角色死亡等）：改由這裡每 0.1 秒推動地圖
    setInterval(function () {
        try { if (huntActive() && performance.now() - (S.lastCoreTick || 0) > 300) huntTick(true); } catch (e) {}
    }, 100);
    function huntTeleport() {   // 瞬移卷軸／自動瞬移：跳到隨機一個重生點
        var sp = S.hunt.spawns[Math.floor(Math.random() * S.hunt.spawns.length)], me = S.me, x = sp[2], y = sp[3];
        me.fx = me.sx = me.tx = x; me.fy = me.sy = me.ty = y; me.t = 1; me.walking = false; me.p0x = me.p1x = x; me.p0y = me.p1y = y;
        S.path = []; S.prefer = null; S.goal = null; S.manual = false; S.trail = [[x, y]];
        for (var uid in S.entByUid) S.entByUid[uid].uid = null;
        S.entByUid = {};
        S.pets.forEach(function (p) { p.fx = p.sx = p.tx = x; p.fy = p.sy = p.ty = y; p.t = 1; p.walking = false; p.path = []; p.p0x = p.p1x = x; p.p0y = p.p1y = y; });
        dirty = true;
    }
    // 畫面：上一拍畫面位置 → 這拍算完的位置，照「離上次邏輯過了多久 ÷ 主迴圈實際間隔」滑過去。
    //   ⚠ 不可以從邏輯位置往前「預測」：主迴圈慢於 0.1 秒時畫面會先推過頭、下一拍又被拉回來＝人物和怪物一前一後地飄（玩家回報）
    // 角色死亡／復活：原作戰鬥畫面是直接看 player.dead 播死亡（不會呼叫 _playerMorphTrigger('death')），地圖上的角色要自己對
    function syncHeroDeath() {
        var dead = !!(player && (player.dead || player.hp <= 0)), me = S.me;
        if (dead && me.act !== 'death') { me.act = 'death'; me.actT = performance.now(); S.path = []; S.goal = null; }
        else if (!dead && me.act === 'death') me.act = null;
    }
    function huntInterp(now) {
        syncHeroDeath();
        var al = Math.max(0, Math.min(1, (now - (S.lastLogicMs || now)) / (S.tickMs || 100)));
        function f(a) {
            a.glide = false;
            if (a.p1x == null) { a.vt = null; return; }
            a.fx = a.p0x + (a.p1x - a.p0x) * al; a.fy = a.p0y + (a.p1y - a.p0y) * al;
            if (a.walking && a.t < 1) { var t0 = (a.newStep || a.pt0 == null || a.pt0 > a.t) ? 0 : a.pt0; a.vt = Math.min(0.999, t0 + (a.t - t0) * al); }
            // 這一拍邏輯上已經走到格子停下，畫面還在滑最後一段：照樣播走路幀走完，不然最後一段是站姿平移＝在滑。
            //   ⚠ 只能看「這一拍剛停」：主迴圈間隔不規則時，站著的人每拍都還差一點點沒對齊，拿位置差來判斷會一直當成在走＝原地踏步、攻擊動作被蓋掉（玩家回報）
            else if (a.stopped && al < 1 && a.pt0 != null && a.pt0 < 1) { a.glide = true; a.vt = Math.min(0.999, a.pt0 + (1 - a.pt0) * al); }
            else a.vt = null;
        }
        f(S.me); S.pets.forEach(f); S.ents.forEach(function (e) { if (e.placed) f(e); });
    }
    function huntPick(px, py) {   // 點到哪隻怪（身體中心 30px 內最近的）
        var d = S.t.d, best = null, bd = 900;
        S.ents.forEach(function (e) {
            if (!e.alive || !e.placed) return;
            var x = 24 * (e.fx + e.fy) + d.ox - S.cam[0], y = 12 * (e.fy - e.fx) + d.oy - S.cam[1] - 20;
            var dd = (x - px) * (x - px) + (y - py) * (y - py); if (dd < bd) { bd = dd; best = e; }
        });
        return best;
    }
    // 開打中的怪：頭上血條＋名字，目標腳下一圈；核心的透明卡片移到怪物身上
    function huntOverlay(ctx, cam) {
        var d = S.t.d, tm = mapState.mobs[mapState.targetIdx];
        ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        for (var uid in S.entByUid) {
            var e = S.entByUid[uid], m = mapState.mobs[slotOf(e.uid)];
            if (!m || !e.placed) continue;
            var px = 24 * (e.fx + e.fy) + d.ox - cam[0], py = 12 * (e.fy - e.fx) + d.oy - cam[1];
            var an = (e.look && anchorOf(e.look, e.dir, false, 0)) || [0, 50], top = py - an[1] - 6;
            if (tm && tm.uid === m.uid) { ctx.strokeStyle = 'rgba(255,214,90,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(px, py, 18, 9, 0, 0, Math.PI * 2); ctx.stroke(); }
            var r = Math.max(0, Math.min(1, (m.curHp || 0) / (m.hp || 1)));
            ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(px - 17, top, 34, 5);
            ctx.fillStyle = r > 0.5 ? '#4ade80' : r > 0.2 ? '#facc15' : '#ef4444'; ctx.fillRect(px - 16, top + 1, 32 * r, 3);
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.fillStyle = m.boss ? '#f87171' : '#fff';
            ctx.strokeText(m.n, px, top - 3); ctx.fillText(m.n, px, top - 3);
        }
        // 寵物頭上的血條：被打扣血看得到（核心只在隊伍面板顯示寵物血量）
        var cps = {}; petsOut().forEach(function (p) { cps[compKey(p)] = p; });
        S.pets.forEach(function (a) {
            var p = cps[a.uid]; if (!p || !a.look || p._downed) return;
            var px = 24 * (a.fx + a.fy) + d.ox - cam[0], py = 12 * (a.fy - a.fx) + d.oy - cam[1];
            var an = anchorOf(a.look, a.dir, false, 0) || [0, 40], top = py - an[1] - 4;
            var mhp = (p.outOwner && typeof petMhpEff === 'function') ? petMhpEff(p) : (p.mhp || 1), r = Math.max(0, Math.min(1, (p.hp || 0) / (mhp || 1)));   // 寵物另有光環加的血量上限
            ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(px - 14, top, 28, 5);
            ctx.fillStyle = r > 0.5 ? '#38bdf8' : r > 0.2 ? '#facc15' : '#ef4444'; ctx.fillRect(px - 13, top + 1, 26 * r, 3);
        });
        placeCards();
    }
    // 核心的透明怪物卡片移到怪物身上。核心重畫怪物時會換掉卡片元素、緊接著照卡片位置噴傷害數字／未命中／死亡特效，
    //   所以除了每次畫地圖，核心要量卡片位置前（下面包 _vfxFlush 等）也先放一次，不然新卡片停在預設位置（右下角）
    function placeCards() {
        if (!S || S.kind !== 'hunt' || !S.ready || !S.cam) return;
        var d = S.t.d, cam = S.cam, cards = S.map.querySelectorAll('#mob-list .mob-target[data-uid]');
        for (var c = 0; c < cards.length; c++) {
            var el = cards[c], ee = S.entByUid[el.getAttribute('data-uid')];
            if (!ee) { el.style.setProperty('left', '-999px', 'important'); continue; }
            var x = 24 * (ee.fx + ee.fy) + d.ox - cam[0], y = 12 * (ee.fy - ee.fx) + d.oy - cam[1];
            el.style.setProperty('left', (x - 24).toFixed(1) + 'px', 'important');
            el.style.setProperty('top', (y - 66).toFixed(1) + 'px', 'important');
        }
    }
    function heroRect() {   // 地圖上角色的螢幕位置（施法、弓箭的發射點、治癒特效錨點）
        if (!huntActive() || !S.cam) return null;
        var d = S.t.d, me = S.me, cr = S.cv.getBoundingClientRect(), k = S.map.clientWidth ? cr.width / S.map.clientWidth : 1;
        var px = 24 * (me.fx + me.fy) + d.ox - S.cam[0], py = 12 * (me.fy - me.fx) + d.oy - S.cam[1];
        var l = cr.left + (px - 20) * k, t = cr.top + (py - 60) * k, w = 40 * k, h = 60 * k;
        return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t };
    }
    function wrapCore(name, make) { if (typeof window[name] === 'function') window[name] = make(window[name]); }
    wrapCore('tick', function (orig) {
        return function () {
            try { huntMaybeMount(); if (huntActive() && state.running && !player.dead) { S.lastCoreTick = performance.now(); huntTick(); } } catch (e) { try { console.warn('[AFK-townmap] 狩獵區地圖模式出錯：', e); } catch (x) {} }
            return orig.apply(this, arguments);
        };
    });
    wrapCore('maybeSpawnMobs', function (orig) { return function () { if (huntOwns()) return; return orig.apply(this, arguments); }; });
    wrapCore('killMob', function (orig) {
        return function (idx) {
            var m = mapState.mobs[idx], r = orig.apply(this, arguments);
            try { if (S && S.kind === 'hunt' && m && m._dead) huntKilled(m); } catch (e) {}
            return r;
        };
    });
    wrapCore('doTeleport', function (orig) {
        return function () { var r = orig.apply(this, arguments); try { if (huntActive()) huntTeleport(); } catch (e) {} return r; };
    });
    wrapCore('changeMap', function (orig) {
        return function () {
            var r = orig.apply(this, arguments);
            try { if (S && S.kind === 'hunt' && S.huntId !== mapState.current) unmount(true); huntMaybeMount(); } catch (e) {}
            return r;
        };
    });
    ['_vfxFlush', 'vfxMiss', 'vfxKill', '_vfxSlotRect'].forEach(function (n) {   // 量卡片位置前先把卡片放到怪物身上
        wrapCore(n, function (orig) { return function () { try { placeCards(); } catch (e) {} return orig.apply(this, arguments); }; });
    });
    wrapCore('_pmCasterRect', function (orig) { return function () { return heroRect() || orig.apply(this, arguments); }; });
    wrapCore('_partyMemberRect', function (orig) { return function () { return heroRect() || orig.apply(this, arguments); }; });
    wrapCore('_playerMorphTrigger', function (orig) {
        return function (k) {
            try { if (huntActive() && S.me.act !== 'death' && (k === 'attack' || k === 'skill')) { S.me.act = k; S.me.actT = performance.now(); } } catch (e) {}
            return orig.apply(this, arguments);
        };
    });
    wrapCore('summonAttack', function (orig) {   // 迷魅的怪出手：核心沒記動作（舊制召喚流程），補記一筆攻擊＋目標，地圖上才會揮動、面向怪
        return function (sm) {
            try {
                if (huntActive() && sm && sm._charm && typeof _petAnimAct === 'function') { var t = typeof getTarget === 'function' ? getTarget() : null; _petAnimAct(sm, 'attack', t ? t.uid : undefined); }
            } catch (e) {}
            return orig.apply(this, arguments);
        };
    });
    wrapCore('_mobAnimTrigger', function (orig) {
        return function (m, k) {
            try {
                var e = S && S.kind === 'hunt' && m && S.entByUid[m.uid];
                if (e && e.act !== 'death' && (k === 'attack' || k === 'skill' || k === 'hurt')) { e.act = k === 'skill' ? 'attack' : k; e.actT = performance.now(); }
            } catch (x) {}
            return orig.apply(this, arguments);
        };
    });

    document.addEventListener('visibilitychange', function () { dirty = true; });
    window.addEventListener('resize', function () { dirty = true; if (S) { S.npcDirty = true; } });

    try { console.log('[AFK-townmap] hooks OK — 說話之島村莊動態地圖已啟用(外掛開關可關回靜態背景)。'); } catch (e) {}
})();
