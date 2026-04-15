// generate-icons.js
// Generates icon16.png, icon48.png, icon128.png for the Raindrop Menu extension.
// Run: node generate-icons.js

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── Minimal PNG encoder ───────────────────────────────────────────────────────

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
    const len  = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const tb   = Buffer.from(type);
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc32(Buffer.concat([tb, data])));
    return Buffer.concat([len, tb, data, crcB]);
}

function makePNG(rgba, w, h) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

    const stride = w * 4 + 1;
    const raw = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
        raw[y * stride] = 0;
        for (let x = 0; x < w; x++) {
            const s = (y * w + x) * 4, d = y * stride + 1 + x * 4;
            raw[d] = rgba[s]; raw[d+1] = rgba[s+1]; raw[d+2] = rgba[s+2]; raw[d+3] = rgba[s+3];
        }
    }

    return Buffer.concat([
        Buffer.from([137,80,78,71,13,10,26,10]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

// ── Raindrop shape ────────────────────────────────────────────────────────────
// Canvas: 24×24.  Drop: tip at (12, 3), circle centre (12, 16), radius 7.
// The tapered body linearly widens from tip to the circle centre.

function insideRaindrop(sx, sy) {
    const cx = 12, cy = 16, r = 7;

    // Inside the bottom circle?
    if ((sx - cx) ** 2 + (sy - cy) ** 2 <= r * r) return true;

    // Inside the tapered upper body (tip at y=3, full width at y=cy)?
    if (sy >= 3 && sy < cy) {
        const t  = (sy - 3) / (cy - 3); // 0 at tip → 1 at widest
        const hw = t * r;                // half-width
        if (Math.abs(sx - cx) <= hw) return true;
    }

    return false;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function renderIcon(size) {
    const pixels = new Uint8Array(size * size * 4); // transparent
    const scale  = size / 24;

    const BG = [232, 240, 254, 255]; // #e8f0fe  light blue bg
    const FG = [ 26, 115, 232, 255]; // #1a73e8  blue drop

    const r = size * 0.22; // rounded-square corner radius

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i  = (y * size + x) * 4;
            const cx = Math.min(x, size - 1 - x);
            const cy = Math.min(y, size - 1 - y);

            // Rounded-square background with anti-aliased corners
            let alpha = 255;
            if (cx < r && cy < r) {
                const dist = Math.sqrt((r - cx) ** 2 + (r - cy) ** 2);
                if      (dist >= r + 0.5) { alpha = 0; }
                else if (dist >= r - 0.5) { alpha = Math.round((r + 0.5 - dist) * 255); }
            }
            if (alpha === 0) continue;

            // Map pixel centre to SVG space
            const sx = (x + 0.5) / scale;
            const sy = (y + 0.5) / scale;

            const color = insideRaindrop(sx, sy) ? FG : BG;
            pixels[i]   = color[0];
            pixels[i+1] = color[1];
            pixels[i+2] = color[2];
            pixels[i+3] = alpha === 255 ? color[3] : Math.round(alpha * color[3] / 255);
        }
    }
    return pixels;
}

// ── Generate files ────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

[16, 48, 128].forEach(size => {
    const file = path.join(outDir, `icon${size}.png`);
    fs.writeFileSync(file, makePNG(renderIcon(size), size, size));
    console.log(`✓ icons/icon${size}.png`);
});
console.log('Done.');
