import { describe, expect, it } from 'vitest';
import { createDefaultPalette } from './defaults.ts';
import { encodeAct, paletteFromPixels, parseAct } from './palette-file.ts';
import { paletteColor } from './vox.ts';

describe('palette files', () => {
  it('round-trips .act', () => {
    const palette = createDefaultPalette();
    expect([...parseAct(encodeAct(palette), new Uint8Array(1024)).subarray(0, 1020)]).toEqual([...palette.subarray(0, 1020)]);
  });

  it('reads PNG pixels as colours 1.., keeping the rest', () => {
    const base = createDefaultPalette();
    const palette = paletteFromPixels(Uint8ClampedArray.of(10, 20, 30, 0, 40, 50, 60, 255), base);
    expect(paletteColor(palette, 1)).toEqual([10, 20, 30]);
    expect(paletteColor(palette, 2)).toEqual([40, 50, 60]);
    expect(palette[3]).toBe(255);
    expect(paletteColor(palette, 3)).toEqual(paletteColor(base, 3));
  });
});
