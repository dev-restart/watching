import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Deterministic, dependency-free PNGs. The play mark stays inside the maskable safe area.
function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const name = Buffer.from(type, 'ascii');
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
	return Buffer.concat([length, name, data, checksum]);
}
function icon(size) {
	const stride = size * 4 + 1;
	const pixels = Buffer.alloc(stride * size);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let coverage = 0;
			for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) {
				const u = (x + dx) / size;
				const v = (y + dy) / size;
				if (u >= 0.34 && u <= 0.72 && Math.abs(v - 0.5) <= 0.24 * (0.72 - u) / 0.38) coverage += 0.25;
			}
			const offset = y * stride + 1 + x * 4;
			for (const [channel, value] of [229, 9, 20].entries()) pixels[offset + channel] = Math.round(value + (255 - value) * coverage);
			pixels[offset + 3] = 255;
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))
	]);
}
const directory = new URL('../static/icons/', import.meta.url);
mkdirSync(directory, { recursive: true });
for (const [filename, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
	writeFileSync(new URL(filename, directory), icon(size));
}
console.log('PWA icons generated: 180, 192 and 512 pixels.');
