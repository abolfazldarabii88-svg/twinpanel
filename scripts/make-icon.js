const fs = require('node:fs');
const path = require('node:path');

const size = 32;
const xorBytes = size * size * 4;
const maskStride = 4;
const maskBytes = maskStride * size;
const imageBytes = 40 + xorBytes + maskBytes;
const ico = Buffer.alloc(22 + imageBytes);

ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = size;
ico[7] = size;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(imageBytes, 14);
ico.writeUInt32LE(22, 18);

const dib = 22;
ico.writeUInt32LE(40, dib);
ico.writeInt32LE(size, dib + 4);
ico.writeInt32LE(size * 2, dib + 8);
ico.writeUInt16LE(1, dib + 12);
ico.writeUInt16LE(32, dib + 14);
ico.writeUInt32LE(0, dib + 16);
ico.writeUInt32LE(xorBytes, dib + 20);

function insideRoundedSquare(x, y) {
  const radius = 6;
  const cx = x < radius ? radius - 0.5 : x >= size - radius ? size - radius - 0.5 : x;
  const cy = y < radius ? radius - 0.5 : y >= size - radius ? size - radius - 0.5 : y;
  if (x >= radius && x < size - radius || y >= radius && y < size - radius) return true;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

const pixels = dib + 40;
for (let row = 0; row < size; row++) {
  const y = size - 1 - row;
  for (let x = 0; x < size; x++) {
    const pos = pixels + (row * size + x) * 4;
    const visible = insideRoundedSquare(x, y);
    const mark = (y >= 7 && y <= 11 && x >= 6 && x <= 25) ||
      (y >= 11 && y <= 25 && x >= 13 && x <= 18);
    if (!visible) continue;
    const mix = (x + y) / (size * 2);
    ico[pos] = Math.round(225 - 20 * mix);
    ico[pos + 1] = Math.round(65 + 20 * mix);
    ico[pos + 2] = Math.round(95 + 40 * mix);
    ico[pos + 3] = 255;
    if (mark) ico[pos] = ico[pos + 1] = ico[pos + 2] = 255;
  }
}

const mask = pixels + xorBytes;
for (let row = 0; row < size; row++) {
  const y = size - 1 - row;
  for (let x = 0; x < size; x++) {
    if (!insideRoundedSquare(x, y)) ico[mask + row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
  }
}

const output = path.join(__dirname, '..', 'assets', 'twinpanel.ico');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, ico);
console.log('TwinPanel icon generated:', output);
