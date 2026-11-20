import type { ImageMediaType } from "@milu/protocol";

import { detectSupportedImageMimeType } from "../tools/image.ts";

export interface ProbedImage {
	readonly mediaType: ImageMediaType;
	readonly width: number;
	readonly height: number;
}

const ACCEPTED: readonly ImageMediaType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function be16(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset] ?? 0) << 8) + (bytes[offset + 1] ?? 0);
}

function le16(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8);
}

function le24(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8) + ((bytes[offset + 2] ?? 0) << 16);
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
	for (let index = 0; index < text.length; index += 1) {
		if (bytes[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
	if (bytes.length < 24 || !ascii(bytes, 12, "IHDR")) return undefined;
	return {
		width: ((bytes[16] ?? 0) << 24) + ((bytes[17] ?? 0) << 16) + ((bytes[18] ?? 0) << 8) + (bytes[19] ?? 0),
		height: ((bytes[20] ?? 0) << 24) + ((bytes[21] ?? 0) << 16) + ((bytes[22] ?? 0) << 8) + (bytes[23] ?? 0),
	};
}

function gifSize(bytes: Uint8Array): { width: number; height: number } | undefined {
	if (bytes.length < 10) return undefined;
	return { width: le16(bytes, 6), height: le16(bytes, 8) };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
	let offset = 2;
	while (offset + 9 <= bytes.length) {
		if (bytes[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		const marker = bytes[offset + 1] ?? 0;
		if (marker === 0xff) {
			offset += 1;
			continue;
		}
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 2;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) return undefined;
		const length = be16(bytes, offset + 2);
		if (length < 2) return undefined;
		const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isFrame) return { width: be16(bytes, offset + 7), height: be16(bytes, offset + 5) };
		offset += 2 + length;
	}
	return undefined;
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | undefined {
	if (bytes.length < 30) return undefined;
	if (ascii(bytes, 12, "VP8X")) return { width: le24(bytes, 24) + 1, height: le24(bytes, 27) + 1 };
	if (ascii(bytes, 12, "VP8 ")) {
		if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined;
		return { width: le16(bytes, 26) & 0x3fff, height: le16(bytes, 28) & 0x3fff };
	}
	if (ascii(bytes, 12, "VP8L")) {
		if (bytes[20] !== 0x2f) return undefined;
		const bits = le24(bytes, 21);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}
	return undefined;
}

/** Read a supported raster's intrinsic size from its header without decoding pixels. */
export function probeImage(bytes: Uint8Array): ProbedImage | undefined {
	const detected = detectSupportedImageMimeType(bytes);
	if (detected === undefined) return undefined;
	const mediaType = ACCEPTED.find((each) => each === detected);
	if (mediaType === undefined) return undefined;
	const size = mediaType === "image/png" ? pngSize(bytes) : mediaType === "image/jpeg" ? jpegSize(bytes) : mediaType === "image/gif" ? gifSize(bytes) : webpSize(bytes);
	if (size === undefined || size.width <= 0 || size.height <= 0) return undefined;
	return { mediaType, width: size.width, height: size.height };
}
