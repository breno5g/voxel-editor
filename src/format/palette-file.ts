import { t } from '../i18n/i18n.ts';
import { PALETTE_BYTES, PALETTE_SIZE } from './vox.ts';

/** Adobe .act: 256 RGB triplets (768 bytes), optionally followed by a count and a transparent index. */
const ACT_BYTES = PALETTE_SIZE * 3;

/**
 * A palette from RGBA pixels read left to right, top to bottom, as MagicaVoxel's palette PNG
 * (256×1, pixel i is colour i + 1). Missing pixels keep `base`'s colours.
 */
export function paletteFromPixels(rgba: Uint8ClampedArray | Uint8Array, base: Uint8Array): Uint8Array {
  const palette = base.slice();
  palette.set(rgba.subarray(0, Math.min(rgba.length, PALETTE_BYTES - 4)));
  for (let index = 3; index < PALETTE_BYTES - 4; index += 4) palette[index] = 255;
  return palette;
}

/** .act triplets in the same order: entry i is colour i + 1. */
export function parseAct(bytes: Uint8Array, base: Uint8Array): Uint8Array {
  if (bytes.length < ACT_BYTES) throw new Error(t('Paleta .act deve ter {bytes} bytes', { bytes: ACT_BYTES }));
  const palette = base.slice();
  for (let entry = 0; entry < PALETTE_SIZE - 1; entry++) palette.set([bytes[entry * 3], bytes[entry * 3 + 1], bytes[entry * 3 + 2], 255], entry * 4);
  return palette;
}

export function encodeAct(palette: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(ACT_BYTES);
  for (let entry = 0; entry < PALETTE_SIZE; entry++) bytes.set(palette.subarray(entry * 4, entry * 4 + 3), entry * 3);
  return bytes;
}
