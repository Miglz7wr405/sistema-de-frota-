// Gera os ícones PNG (PWA) e a imagem Open Graph sem dependências (desenho simples de camião).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const BLUE = [0x17, 0x69, 0xe8], NAVY = [0x10, 0x24, 0x3d], WHITE = [255, 255, 255];
// camião em coordenadas normalizadas (0..1) dentro de uma caixa
function truck(u, v) {
  const inRect = (x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
  const circle = (cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  return inRect(0.12, 0.3, 0.58, 0.62) || inRect(0.6, 0.42, 0.86, 0.62) || circle(0.28, 0.7, 0.08) || circle(0.72, 0.7, 0.08);
}
for (const s of [192, 512]) writeFileSync(`public/icons/icon-${s}.png`, png(s, s, (x, y) => (truck(x / s, y / s) ? WHITE : BLUE)));
writeFileSync('public/og-image.png', png(1200, 630, (x, y) => {
  const inBox = x > 120 && x < 520 && y > 115 && y < 515;
  if (inBox && truck((x - 120) / 400, (y - 115) / 400)) return WHITE;
  if (inBox) return BLUE;
  return NAVY;
}));
console.log('ícones gerados');
