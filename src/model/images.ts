/** Reads width and height from a PNG or JPEG header without decoding it. */
export function imageSize(bytes: Buffer): { width: number; height: number; format: "png" | "jpeg" } | undefined {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: "png" };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let pos = 2;
    while (pos + 9 < bytes.length) {
      if (bytes[pos] !== 0xff) { pos++; continue; }
      const marker = bytes[pos + 1] ?? 0;
      if (marker === 0xff) { pos++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(pos + 5), width: bytes.readUInt16BE(pos + 7), format: "jpeg" };
      }
      pos += 2 + bytes.readUInt16BE(pos + 2);
    }
  }
  return undefined;
}
