import { t } from '../i18n/i18n.ts';

export type ZipEntry = { name: string; data: Uint8Array };

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Fixed DOS date (1980-01-01): the archive's bytes depend only on its entries. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8_NAMES = 0x0800;

/**
 * A zip archive whose entries are stored uncompressed: what the final render's PNG sequences need
 * (PNG is already compressed). No zip64, so the archive must stay under 4 GiB.
 */
export function zipStore(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const records = entries.map(({ name, data }) => ({ name: encoder.encode(name), data, crc: crc32(data) }));
  const localSize = records.reduce((sum, { name, data }) => sum + 30 + name.length + data.length, 0);
  const centralSize = records.reduce((sum, { name }) => sum + 46 + name.length, 0);
  if (localSize + centralSize + 22 > 0xffffffff) throw new Error(t('Arquivo zip grande demais (mais de 4 GiB)'));
  const bytes = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const offsets: number[] = [];
  records.forEach(({ name, data, crc }) => {
    offsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, UTF8_NAMES, true);
    view.setUint16(offset + 12, DOS_DATE, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, data.length, true);
    view.setUint32(offset + 22, data.length, true);
    view.setUint16(offset + 26, name.length, true);
    bytes.set(name, offset + 30);
    bytes.set(data, offset + 30 + name.length);
    offset += 30 + name.length + data.length;
  });
  records.forEach(({ name, data, crc }, index) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, UTF8_NAMES, true);
    view.setUint16(offset + 14, DOS_DATE, true);
    view.setUint32(offset + 16, crc, true);
    view.setUint32(offset + 20, data.length, true);
    view.setUint32(offset + 24, data.length, true);
    view.setUint16(offset + 28, name.length, true);
    view.setUint32(offset + 42, offsets[index], true);
    bytes.set(name, offset + 46);
    offset += 46 + name.length;
  });
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, records.length, true);
  view.setUint16(offset + 10, records.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, localSize, true);
  return bytes;
}
