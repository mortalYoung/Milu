const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detectSupportedImageMimeType(bytes: Uint8Array): string | undefined {
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return bytes[3] === 0xf7 ? undefined : "image/jpeg";
	if (startsWith(bytes, PNG_SIGNATURE)) return isPng(bytes) && !isAnimatedPng(bytes) ? "image/png" : undefined;
	if (startsWithAscii(bytes, 0, "GIF")) return "image/gif";
	if (startsWithAscii(bytes, 0, "RIFF") && startsWithAscii(bytes, 8, "WEBP")) return "image/webp";
	if (startsWithAscii(bytes, 0, "BM") && isBmp(bytes)) return "image/bmp";
	return undefined;
}

export function encodeBase64(bytes: Uint8Array): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let output = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index] ?? 0;
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		output += alphabet[first >> 2];
		output += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
		output += second === undefined ? "=" : alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
		output += third === undefined ? "=" : alphabet[third & 0x3f];
	}
	return output;
}

function isPng(bytes: Uint8Array): boolean {
	return bytes.length >= 16 && readUint32BE(bytes, PNG_SIGNATURE.length) === 13 && startsWithAscii(bytes, 12, "IHDR");
}

function isAnimatedPng(bytes: Uint8Array): boolean {
	let offset = PNG_SIGNATURE.length;
	while (offset + 8 <= bytes.length) {
		const chunkLength = readUint32BE(bytes, offset);
		const chunkTypeOffset = offset + 4;
		if (startsWithAscii(bytes, chunkTypeOffset, "acTL")) return true;
		if (startsWithAscii(bytes, chunkTypeOffset, "IDAT")) return false;
		const nextOffset = offset + 8 + chunkLength + 4;
		if (nextOffset <= offset || nextOffset > bytes.length) return false;
		offset = nextOffset;
	}
	return false;
}

function isBmp(bytes: Uint8Array): boolean {
	if (bytes.length < 26) return false;
	const declaredFileSize = readUint32LE(bytes, 2);
	const pixelDataOffset = readUint32LE(bytes, 10);
	const dibHeaderSize = readUint32LE(bytes, 14);
	if (declaredFileSize !== 0 && declaredFileSize < 26) return false;
	if (pixelDataOffset < 14 + dibHeaderSize) return false;
	if (declaredFileSize !== 0 && pixelDataOffset >= declaredFileSize) return false;
	let colorPlanes: number;
	let bitsPerPixel: number;
	if (dibHeaderSize === 12) {
		colorPlanes = readUint16LE(bytes, 22);
		bitsPerPixel = readUint16LE(bytes, 24);
	} else if (dibHeaderSize >= 40 && dibHeaderSize <= 124) {
		if (bytes.length < 30) return false;
		colorPlanes = readUint16LE(bytes, 26);
		bitsPerPixel = readUint16LE(bytes, 28);
	} else {
		return false;
	}
	return colorPlanes === 1 && [1, 4, 8, 16, 24, 32].includes(bitsPerPixel);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) * 0x1000000 + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8) + ((bytes[offset + 2] ?? 0) << 16) + (bytes[offset + 3] ?? 0) * 0x1000000;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
	if (bytes.length < prefix.length) return false;
	return prefix.every((byte, index) => bytes[index] === byte);
}

function startsWithAscii(bytes: Uint8Array, offset: number, text: string): boolean {
	if (bytes.length < offset + text.length) return false;
	for (let index = 0; index < text.length; index++) {
		if (bytes[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}
