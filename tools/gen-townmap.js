#!/usr/bin/env node
// 村莊動態地圖資料生成工具（afk-townmap.js 讀的資料）
//
// 用法（在 repo 根目錄跑）：
//   node tools/gen-townmap.js --map "<用戶端>/map/0" --tiles "<從 Tile.pak 抽出的 .til 資料夾>"
//     → assets/townmap/talking.js、assets/townmap/talking_<頁>.png（說話之島村莊）
//   node tools/gen-townmap.js --hero-only
//     → 只重量角色落腳點 assets/townmap/hero.js（換過 assets/classanim 的走路／待機幀後要重跑）
//   跑完記得 node scripts/gen-manifests.mjs（assets 有新圖要進對帳清單）。
//
// ── 用戶端格式（逆向結果）────────────────────────────────
// .s32（每檔 64×64 格）：
//   第 1 層：64 列 × 128 個 4 bytes [小塊編號][地磚組 uint16][0]，每格左右兩個半格（偶數＝左半、奇數＝右半）
//   第 2 層：uint16 筆數 × 6 bytes（此圖都是 0）
//   第 3 層：64×64 × 兩個 uint16 屬性 a、b；(a|b)&1＝不能走、(a|b)&4＝安全區域
//   第 4 層（物件）：uint32 群數；每群 uint16 index、uint16 count，之後 count 筆 7 bytes [半格x][y][圖層][小塊][地磚組 uint16][未知]
// .til：int32 小塊數 n、(n+1) 個 int32 位移、資料。每小塊＝半格（寬 24、高 23），16 位元 RGB555。
//   類型 bit0＝右半；bit1＝壓縮（逐列：段數，每段 跳過bytes/2、像素數、像素）；bit4＝半透明（物件的影子）。
//   不壓縮時是菱形半邊：第 r 列寬 r<=11 ? 2(r+1) : 2(23-r)，左半靠右、右半靠左。
// 投影（跟用戶端一樣）：格子 (x,y) 中心在 (24(x+y), 12(y-x))，x 往右上、y 往右下。物件也是半格小塊、同一套位置。
// 畫的順序：依「4×畫面列(y-x)＋圖層」排序，跟用戶端依圖層排的結果逐像素相同（量過）；圖層 ≤8 是貼地的（影子、花紋）。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'assets', 'townmap');

// 每個村莊一筆：用哪張地圖、哪幾個區塊檔、村莊中心（地圖格座標）、遊戲座標原點
const TOWNS = {
    talking: { bx0: 0x7ff8, by0: 0x8000, nb: 8, home: [332, 182], gameX0: 32320, gameY0: 32768 },
};
const RADIUS = 20;            // 村莊範圍＝安全區域裡、離村莊中心 20 格內（說話之島的安全區一路延伸到港口，全收太大）
const MARGIN = 13;            // 範圍外多留幾格＝手機村莊畫面(約 390×390)半個畫面；鏡頭另外會夾在資料範圍內，不會露出空白
const CS = 512;               // 地面分塊（畫面像素）
const BW = 24, BH = 23, CELL_W = 26, CELL_H = 25, PAGE_W = 2048;   // 小塊尺寸、拼圖格（含 1px 透明邊）
const COLS = Math.floor(PAGE_W / CELL_W), PAGE_ROWS = 78, PER = COLS * PAGE_ROWS;
const OFF = 64;               // 物件相對座標加的偏移（存成無號整數）

function arg(name) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }

// ── PNG ─────────────────────────────────────────
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {   // RGBA 8bit，每列挑最省的濾波
    const stride = w * 4, raw = Buffer.alloc((stride + 1) * h), prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
        Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(cur);
        let best = null, bestSum = Infinity;
        for (const ft of [0, 1, 2, 4]) {
            const out = Buffer.alloc(stride); let sum = 0;
            for (let i = 0; i < stride; i++) {
                const a = i >= 4 ? cur[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
                let p = 0;
                if (ft === 1) p = a; else if (ft === 2) p = b;
                else if (ft === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
                out[i] = (cur[i] - p) & 255; sum += out[i] < 128 ? out[i] : 256 - out[i];
            }
            if (sum < bestSum) { bestSum = sum; best = [ft, out]; }
        }
        raw[y * (stride + 1)] = best[0]; best[1].copy(raw, y * (stride + 1) + 1);
        cur.copy(prev);
    }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function decodePNG(buf) {   // 8bit、不交錯；回傳 { w, h, a: Uint8Array(每像素不透明度) }
    let p = 8, w = 0, h = 0, depth = 8, ct = 6, inter = 0, pal = null, trns = null; const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; inter = d[12]; }
        else if (type === 'PLTE') pal = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
        p += 12 + len;
    }
    if (depth !== 8 || inter) throw new Error('不支援的 PNG（' + depth + 'bit／交錯）');
    const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct], stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), img = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
        const ft = raw[y * (stride + 1)], s = y * (stride + 1) + 1, o = y * stride;
        for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? img[o + i - bpp] : 0, b = y ? img[o - stride + i] : 0, c = (i >= bpp && y) ? img[o - stride + i - bpp] : 0;
            let v = raw[s + i];
            if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
            else if (ft === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : pb <= pc ? b : c; }
            img[o + i] = v & 255;
        }
    }
    const al = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        if (ct === 6) al[i] = img[i * 4 + 3];
        else if (ct === 4) al[i] = img[i * 2 + 1];
        else if (ct === 3) al[i] = trns && img[i] < trns.length ? trns[img[i]] : 255;
        else al[i] = 255;
    }
    return { w, h, a: al };
}

// ── .til / .s32 ──────────────────────────────────
function loadTil(file) {
    const b = fs.readFileSync(file), n = b.readInt32LE(0), base = 4 + (n + 1) * 4, blocks = [];
    for (let i = 0; i < n; i++) blocks.push(base + b.readInt32LE(4 + i * 4));
    return { b, n, blocks };
}
function decodeBlock(til, i, semi) {
    const b = til.b; let p = til.blocks[i];
    const type = b[p++], px = new Uint8Array(BW * BH * 4);
    const put = (x, y, v) => { const k = (y * BW + x) * 4; px[k] = ((v >> 10) & 31) * 255 / 31 | 0; px[k + 1] = ((v >> 5) & 31) * 255 / 31 | 0; px[k + 2] = (v & 31) * 255 / 31 | 0; px[k + 3] = (semi && (type & 0x10)) ? 128 : 255; };
    if (type & 2) {
        const xo = b[p], yo = b[p + 1], h = b[p + 3]; p += 4;
        for (let r = 0; r < h; r++) {
            const segs = b[p++]; let x = xo;
            for (let s = 0; s < segs; s++) { x += b[p++] / 2; const c = b[p++]; for (let k = 0; k < c; k++) { put(x++, yo + r, b.readUInt16LE(p)); p += 2; } }
        }
    } else {
        for (let r = 0; r < BH; r++) {
            const n = r <= 11 ? 2 * (r + 1) : 2 * (23 - r), x0 = type & 1 ? 0 : BW - n;
            for (let k = 0; k < n; k++) { put(x0 + k, r, b.readUInt16LE(p)); p += 2; }
        }
    }
    return px;
}
function readS32(file) {
    const d = fs.readFileSync(file);
    const l1 = new Uint32Array(64 * 128);   // tile*256+sub
    for (let i = 0; i < 64 * 128; i++) l1[i] = d.readUInt16LE(i * 4 + 1) * 256 + d[i * 4];
    let o = 64 * 128 * 4; o += 2 + d.readUInt16LE(o) * 6;
    const attr = new Uint16Array(4096);
    for (let i = 0; i < 4096; i++) attr[i] = d.readUInt16LE(o + i * 4) | d.readUInt16LE(o + i * 4 + 2);
    o += 16384;
    const n4 = d.readUInt32LE(o), objs = []; o += 4;
    for (let k = 0; k < n4; k++) {
        const cnt = d.readUInt16LE(o + 2); o += 4;
        for (let j = 0; j < cnt; j++) { objs.push({ x: d[o], y: d[o + 1], layer: d[o + 2], key: d.readUInt16LE(o + 4) * 256 + d[o + 3] }); o += 7; }
    }
    return { l1, attr, objs };
}

function b64(typed) { return Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64'); }

// ── 村莊地圖 ─────────────────────────────────────
function buildTown(id, cfg, mapDir, tileDir) {
    const N = cfg.nb * 64, ground = new Uint32Array(N * 2 * N), attr = new Uint16Array(N * N), objs = [];
    let rank = 0;
    for (let bx = 0; bx < cfg.nb; bx++) for (let by = 0; by < cfg.nb; by++) {
        const m = readS32(path.join(mapDir, (cfg.bx0 + bx).toString(16) + (cfg.by0 + by).toString(16) + '.s32'));
        for (let y = 0; y < 64; y++) {
            for (let hx = 0; hx < 128; hx++) ground[(by * 64 + y) * N * 2 + bx * 128 + hx] = m.l1[y * 128 + hx];
            for (let x = 0; x < 64; x++) attr[(by * 64 + y) * N + bx * 64 + x] = m.attr[y * 64 + x];
        }
        for (const o of m.objs) objs.push({ hx: bx * 128 + o.x, gy: by * 64 + o.y, layer: o.layer, key: o.key, rank: rank++ });
    }
    const safe = (x, y) => x >= 0 && y >= 0 && x < N && y < N && (attr[y * N + x] & 4);
    const walk = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !(attr[y * N + x] & 1);

    // 村莊範圍＝從村莊中心連過去的安全區域，限離中心 RADIUS 格內（人物只在這裡面走）
    const near = (x, y) => Math.max(Math.abs(x - cfg.home[0]), Math.abs(y - cfg.home[1])) <= RADIUS;
    const zone = new Uint8Array(N * N), q = [cfg.home];
    zone[cfg.home[1] * N + cfg.home[0]] = 1;
    let zx0 = N, zy0 = N, zx1 = 0, zy1 = 0;
    while (q.length) {
        const [x, y] = q.pop();
        zx0 = Math.min(zx0, x); zy0 = Math.min(zy0, y); zx1 = Math.max(zx1, x); zy1 = Math.max(zy1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (safe(nx, ny) && near(nx, ny) && !zone[ny * N + nx]) { zone[ny * N + nx] = 1; q.push([nx, ny]); }
        }
    }
    const x0 = Math.max(0, zx0 - MARGIN), y0 = Math.max(0, zy0 - MARGIN), x1 = Math.min(N - 1, zx1 + MARGIN), y1 = Math.min(N - 1, zy1 + MARGIN);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    console.log('[gen-townmap] ' + id + ' 安全區 ' + zx0 + '..' + zx1 + ' × ' + zy0 + '..' + zy1 + ' → 裁 ' + cw + '×' + ch + ' 格');

    // 世界像素：相對格 (lx,ly) 中心 (24(lx+ly)+OX, 12(ly-lx)+OY)
    const OX = 48, OY = 12 * cw + 32, WW = 24 * (cw + ch) + 96, WH = 12 * (cw + ch) + 64;
    const CX = Math.ceil(WW / CS), CY = Math.ceil(WH / CS);

    // 小塊：去重複（同樣內容只放一份）
    const tils = {}, entries = new Map(), byKey = new Map();
    function use(kind, key) {
        const mk = kind + key;
        if (byKey.has(mk)) return byKey.get(mk);
        const t = key >> 8, s = key & 255;
        const til = tils[t] || (tils[t] = loadTil(path.join(tileDir, t + '.til')));
        const px = decodeBlock(til, s, kind === 'o');   // 地面上的半透明塊照不透明畫（底下沒東西可透）；物件的是影子
        const h = crypto.createHash('md5').update(px).digest('hex');
        let e = entries.get(h);
        if (!e) entries.set(h, e = { px, sortKey: key, idx: -1 });
        byKey.set(mk, e);
        return e;
    }
    const gE = [];
    for (let y = y0; y <= y1; y++) for (let hx = x0 * 2; hx <= x1 * 2 + 1; hx++) gE.push(use('g', ground[y * N * 2 + hx]));
    const inObj = objs.filter(o => (o.hx >> 1) >= x0 - 3 && (o.hx >> 1) <= x1 + 3 && o.gy >= y0 - 3 && o.gy <= y1 + 3);
    for (const o of inObj) o.e = use('o', o.key);

    const list = [...entries.values()].sort((a, b) => a.sortKey - b.sortKey);
    list.forEach((e, i) => { e.idx = i; });
    const pages = Math.ceil(list.length / PER);
    for (let pg = 0; pg < pages; pg++) {
        const part = list.slice(pg * PER, (pg + 1) * PER), H = Math.ceil(part.length / COLS) * CELL_H, img = new Uint8Array(PAGE_W * H * 4);
        part.forEach((e, i) => {
            const ox = (i % COLS) * CELL_W + 1, oy = (i / COLS | 0) * CELL_H + 1;
            for (let y = 0; y < BH; y++) Buffer.from(e.px.buffer, y * BW * 4, BW * 4).copy(Buffer.from(img.buffer), ((oy + y) * PAGE_W + ox) * 4);
        });
        const f = path.join(OUT_DIR, id + '_' + pg + '.png');
        fs.writeFileSync(f, encodePNG(PAGE_W, H, img));
        console.log('[gen-townmap] ' + path.relative(REPO_ROOT, f) + '  ' + part.length + ' 小塊  ' + (fs.statSync(f).size / 1e6).toFixed(2) + 'MB');
    }

    const groundIdx = new Uint16Array(gE.map(e => e.idx));
    const flags = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const v = attr[(y0 + y) * N + x0 + x];
        flags[y * cw + x] = (v & 1 ? 1 : 0) | (zone[(y0 + y) * N + x0 + x] ? 2 : 0);   // bit0 不能走、bit1 村莊（安全區）
    }

    // 物件分塊：貼地的照「圖層、檔案順序」、每個碰到的分塊各放一份（拼地面用）；
    //   立著的照「4×列＋圖層、圖層、檔案順序」給全域序號，只放進左上角所在的分塊（每幀依序號畫，人物插在中間）
    function topLeft(o) { const lx = (o.hx >> 1) - x0, ly = o.gy - y0; return [24 * (lx + ly) - (o.hx & 1 ? 0 : 24) + OX, 12 * (ly - lx) - 11 + OY]; }
    const flat = inObj.filter(o => o.layer <= 8).sort((a, b) => a.layer - b.layer || a.rank - b.rank);
    const keyOf = o => 4 * (o.gy - (o.hx >> 1)) + o.layer;
    const tall = inObj.filter(o => o.layer > 8).sort((a, b) => keyOf(a) - keyOf(b) || a.layer - b.layer || a.rank - b.rank);
    const fB = Array.from({ length: CX * CY }, () => []), tB = Array.from({ length: CX * CY }, () => []);
    for (const o of flat) {
        const [x, y] = topLeft(o);
        if (x + BW <= 0 || y + BH <= 0 || x >= WW || y >= WH) continue;
        for (let cj = Math.max(0, Math.floor(y / CS)); cj <= Math.min(CY - 1, Math.floor((y + BH - 1) / CS)); cj++)
            for (let ci = Math.max(0, Math.floor(x / CS)); ci <= Math.min(CX - 1, Math.floor((x + BW - 1) / CS)); ci++) fB[cj * CX + ci].push(o);
    }
    tall.forEach((o, seq) => {
        o.seq = seq;
        const [x, y] = topLeft(o);
        if (x + BW <= 0 || y + BH <= 0 || x >= WW || y >= WH) return;
        tB[Math.min(CY - 1, Math.max(0, Math.floor(y / CS))) * CX + Math.min(CX - 1, Math.max(0, Math.floor(x / CS)))].push(o);
    });
    function pack(buckets, withTall) {
        const off = new Uint32Array(buckets.length + 1); let n = 0;
        buckets.forEach((b, i) => { off[i] = n; n += b.length; }); off[buckets.length] = n;
        const idx = new Uint16Array(n), hx = new Uint16Array(n), gy = new Uint16Array(n), ly = new Uint8Array(withTall ? n : 0), seq = new Uint32Array(withTall ? n : 0);
        let k = 0;
        for (const b of buckets) for (const o of b) {
            idx[k] = o.e.idx; hx[k] = o.hx - x0 * 2 + OFF; gy[k] = o.gy - y0 + OFF;
            if (withTall) { ly[k] = o.layer; seq[k] = o.seq; }
            k++;
        }
        return { off, idx, hx, gy, ly, seq };
    }
    const F = pack(fB, false), T = pack(tB, true);

    // NPC 站位：村莊裡能走、四周八格也都能走的格子，彼此隔 4 格以上，離中心近的先
    const spots = [];
    const cand = [];
    for (let y = zy0; y <= zy1; y++) for (let x = zx0; x <= zx1; x++) {
        if (!zone[y * N + x] || !walk(x, y)) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!walk(x + dx, y + dy)) { ok = false; break; }
        if (ok) cand.push([x, y, Math.max(Math.abs(x - cfg.home[0]), Math.abs(y - cfg.home[1]))]);
    }
    cand.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    for (const c of cand) {
        if (c[2] < 2) continue;   // 讓出正中央給人物起步
        if (spots.every(s => Math.max(Math.abs(s[0] - c[0]), Math.abs(s[1] - c[1])) >= 4)) spots.push([c[0], c[1]]);
        if (spots.length >= 24) break;
    }

    const data = {
        v: 1, x0, y0, cw, ch, gameX0: cfg.gameX0 + x0, gameY0: cfg.gameY0 + y0, home: [cfg.home[0] - x0, cfg.home[1] - y0],
        ox: OX, oy: OY, ww: WW, wh: WH, cs: CS, cx: CX, cy: CY, off: OFF, per: PER, cols: COLS, cellW: CELL_W, cellH: CELL_H, pages,
        spots: spots.map(s => [s[0] - x0, s[1] - y0]),
        ground: b64(groundIdx), flags: b64(flags),
        fOff: b64(F.off), fIdx: b64(F.idx), fHx: b64(F.hx), fGy: b64(F.gy),
        tOff: b64(T.off), tIdx: b64(T.idx), tHx: b64(T.hx), tGy: b64(T.gy), tLy: b64(T.ly), tSeq: b64(T.seq),
    };
    const js = '// 🤖 自動生成·勿手改 —— node tools/gen-townmap.js 重生（地圖＝天堂用戶端 map/0 說話之島，裁村莊附近）\n' +
        'window.TOWNMAP = window.TOWNMAP || {};\nTOWNMAP.' + id + ' = ' + JSON.stringify(data) + ';\n';
    const f = path.join(OUT_DIR, id + '.js');
    fs.writeFileSync(f, js);
    console.log('[gen-townmap] ' + path.relative(REPO_ROOT, f) + '  ' + (js.length / 1e6).toFixed(2) + 'MB  小塊 ' + list.length + '、貼地物件 ' + flat.length + '、立著 ' + tall.length + '、NPC 站位 ' + spots.length);
}

// ── 角色落腳點 ───────────────────────────────────
// 每個職業 × 武器 × 八方向：走路第 0 幀影子重心、第 1~3 幀影子相對第 0 幀的位移（走路幀本身就往前挪約 1/4 格）、待機第 0 幀影子重心。
// 八方向資料夾共畫布，所以每個方向各量一次即可。量不到（缺幀）就給 null，afk-townmap 會跳過那個武器改用空手。
const DIR_SFX = ['2', 'F', '', 'd3', 'd4', 'd5', 'd6', 'd7'];
function centroid(file) {
    if (!fs.existsSync(file)) return null;
    const { w, h, a } = decodePNG(fs.readFileSync(file));
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = a[y * w + x]; if (v) { sx += x * v; sy += y * v; n += v; } }
    return n ? [sx / n, sy / n] : null;
}
// 沒有影子幀時的後備：腳底（最下面幾列不透明像素的中心，往上 6px≈影子中心的高度）
function foot(file) {
    if (!fs.existsSync(file)) return null;
    const { w, h, a } = decodePNG(fs.readFileSync(file));
    let y1 = -1;
    for (let y = h - 1; y >= 0 && y1 < 0; y--) for (let x = 0; x < w; x++) if (a[y * w + x]) { y1 = y; break; }
    if (y1 < 0) return null;
    let sx = 0, n = 0;
    for (let y = Math.max(0, y1 - 3); y <= y1; y++) for (let x = 0; x < w; x++) if (a[y * w + x]) { sx += x; n++; }
    return [sx / n, y1 - 6];
}
function anchor(dir, act) { return centroid(path.join(dir, act + '_s_0.png')) || foot(path.join(dir, act + '_0.png')); }
// 寵物／怪物八方向動畫(assets/anim/<名>/d0..d7)：每方向 [走路第0幀落腳 x,y, 待機落腳 x,y]（沒走路幀就用待機的）
//   這類走路幀一輪剛好走一格、每幀往前挪 1/N 格（量過哈士奇），afk-townmap 用等分位移扣掉，不必逐幀量。
// 變身動畫(assets/morphanim/<名>{,2,F})：只有待機/攻擊沒有走路幀 → 每個資料夾 [待機落腳 x,y]
function buildAnims() {
    const r1 = v => Math.round(v * 10) / 10;
    const anim = {}, morph = {};
    const aroot = path.join(REPO_ROOT, 'assets', 'anim');
    for (const n of fs.readdirSync(aroot)) {
        if (!fs.existsSync(path.join(aroot, n, 'd0'))) continue;
        const dirs = [0, 1, 2, 3, 4, 5, 6, 7].map(d => {
            const dd = path.join(aroot, n, 'd' + d), i = anchor(dd, 'idle'), w = anchor(dd, 'walk') || i;
            return (i && w) ? [r1(w[0]), r1(w[1]), r1(i[0]), r1(i[1])] : null;
        });
        if (dirs.every(Boolean)) anim[n] = dirs;
    }
    const mroot = path.join(REPO_ROOT, 'assets', 'morphanim');
    for (const n of fs.readdirSync(mroot)) { const i = anchor(path.join(mroot, n), 'idle'); if (i) morph[n] = [r1(i[0]), r1(i[1])]; }
    return { anim, morph };
}
function buildHero() {
    const root = path.join(REPO_ROOT, 'assets', 'classanim');
    const names = fs.readdirSync(root);
    const avatars = names.filter(n => DIR_SFX.every(s => names.includes(n + s)));   // 含真夏納（職業式變身，同樣八方向＋走路幀）
    const out = {};
    const r1 = v => Math.round(v * 10) / 10;
    for (const av of avatars) {
        const wpns = fs.readdirSync(path.join(root, av)).map(f => (f.match(/^([a-z0-9]+)_walk_s_0\.png$/) || [])[1]).filter(Boolean);
        out[av] = {};
        for (const wk of wpns) {
            const dirs = DIR_SFX.map(s => {
                const d = path.join(root, av + s);
                const w0 = centroid(path.join(d, wk + '_walk_s_0.png')), i0 = centroid(path.join(d, wk + '_idle_s_0.png'));
                if (!w0 || !i0) return null;
                const row = [r1(w0[0]), r1(w0[1])];
                for (let k = 1; k < 4; k++) { const c = centroid(path.join(d, wk + '_walk_s_' + k + '.png')); if (!c) return null; row.push(r1(c[0] - w0[0]), r1(c[1] - w0[1])); }
                row.push(r1(i0[0]), r1(i0[1]));
                return row;
            });
            out[av][wk] = dirs.every(Boolean) ? dirs : null;
        }
    }
    const { anim, morph } = buildAnims();
    const js = '// 🤖 自動生成·勿手改 —— node tools/gen-townmap.js --hero-only 重生（掃 assets/classanim、anim、morphanim 的影子幀量落腳點）\n' +
        '// TOWNMAP_HERO[職業][武器] → 八方向（西北起順時針）各 [走路第0幀影子重心x,y, 第1~3幀相對位移 dx,dy ×3, 待機影子重心x,y]\n' +
        'window.TOWNMAP_HERO = ' + JSON.stringify(out) + ';\n' +
        '// TOWNMAP_ANIM[assets/anim 八方向資料夾] → 八方向各 [走路第0幀落腳x,y, 待機落腳x,y]（寵物、有走路幀的變身）\n' +
        'window.TOWNMAP_ANIM = ' + JSON.stringify(anim) + ';\n' +
        '// TOWNMAP_MORPH[assets/morphanim 資料夾] → [待機落腳x,y]（沒有走路幀的變身）\n' +
        'window.TOWNMAP_MORPH = ' + JSON.stringify(morph) + ';\n';
    const f = path.join(OUT_DIR, 'hero.js');
    fs.writeFileSync(f, js);
    console.log('[gen-townmap] ' + path.relative(REPO_ROOT, f) + '  ' + avatars.length + ' 個職業外型、' + Object.keys(anim).length + ' 個八方向怪物/寵物、' + Object.keys(morph).length + ' 個變身資料夾');
}

fs.mkdirSync(OUT_DIR, { recursive: true });
buildHero();
if (!process.argv.includes('--hero-only')) {
    const mapDir = arg('map'), tileDir = arg('tiles');
    if (!mapDir || !tileDir) { console.error('用法：node tools/gen-townmap.js --map <用戶端 map/0> --tiles <.til 資料夾>（或 --hero-only）'); process.exit(1); }
    buildTown('talking', TOWNS.talking, mapDir, tileDir);
}
