import { describe, expect, it } from 'vitest';
import { createDefaultPalette } from '../format/defaults.ts';
import { createModel, paletteColor } from '../format/vox.ts';
import { adjustColor, fromHex, gradient, hsvToRgb, identityMapping, permutePalette, remapVoxels, rgbToHsv, sortMapping, toHex } from './palette-ops.ts';

describe('default palette', () => {
  it('matches MagicaVoxel pal0: the colour cube, then the ramps', () => {
    const palette = createDefaultPalette();
    expect(toHex(paletteColor(palette, 1))).toBe('#ffffff');
    expect(toHex(paletteColor(palette, 17))).toBe('#ff9933');
    expect(toHex(paletteColor(palette, 215))).toBe('#000033');
    expect(toHex(paletteColor(palette, 216))).toBe('#ee0000');
    expect(toHex(paletteColor(palette, 255))).toBe('#111111');
  });
});

describe('colour conversions', () => {
  it('round-trips HSV and hex', () => {
    expect(rgbToHsv([255, 0, 0])).toEqual([0, 255, 255]);
    expect(hsvToRgb([120, 255, 255])).toEqual([0, 255, 0]);
    expect(hsvToRgb(rgbToHsv([51, 153, 204]))).toEqual([51, 153, 204]);
    expect(fromHex('ff9933')).toEqual([255, 153, 51]);
    expect(fromHex('#12345')).toBeNull();
  });

  it('adjusts one channel, wrapping hue', () => {
    expect(adjustColor([255, 0, 0], 'h', 120)).toEqual([0, 255, 0]);
    expect(adjustColor([255, 0, 0], 'h', -120)).toEqual([0, 0, 255]);
    expect(adjustColor([10, 20, 30], 'g', 300)).toEqual([10, 255, 30]);
  });
});

describe('palette edits', () => {
  it('blends a gradient between two indices', () => {
    const palette = new Uint8Array(1024);
    palette.set([0, 0, 0, 255], 0);
    palette.set([200, 100, 0, 255], 4 * 4);
    const colors = gradient(palette, 1, 5);
    expect(colors.get(3)).toEqual([100, 50, 0]);
    expect([...colors.keys()]).toEqual([1, 2, 3, 4, 5]);
  });

  it('sorts and permutes the palette while voxels follow', () => {
    const palette = new Uint8Array(1024);
    palette.set([0, 0, 255, 255], 0);
    palette.set([255, 0, 0, 255], 4);
    const mapping = sortMapping(palette, [1, 2]);
    expect([mapping[1], mapping[2]]).toEqual([2, 1]);
    const sorted = permutePalette(palette, mapping);
    expect(paletteColor(sorted, 1)).toEqual([255, 0, 0]);
    const model = createModel([2, 1, 1]);
    model.voxels.set([1, 2]);
    expect(remapVoxels([model], mapping)).toEqual([model]);
    expect([...model.voxels]).toEqual([2, 1]);
    expect(remapVoxels([model], identityMapping())).toEqual([]);
  });
});
