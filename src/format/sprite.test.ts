import { describe, expect, it } from 'vitest';
import { createDefaultPalette } from './defaults.ts';
import { nearestColor, spriteModel } from './sprite.ts';
import { voxelIndex } from './vox.ts';

describe('sprite import', () => {
  it('stands the image upright with the nearest palette colours, skipping transparent pixels', () => {
    const palette = createDefaultPalette();
    const pixels = Uint8ClampedArray.of(255, 255, 255, 255, 0, 0, 0, 0, 250, 150, 50, 255, 1, 1, 1, 255);
    const model = spriteModel(pixels, 2, 2, palette);
    expect(model.size).toEqual([2, 1, 2]);
    expect(model.voxels[voxelIndex(model.size, 0, 0, 1)]).toBe(1);
    expect(model.voxels[voxelIndex(model.size, 1, 0, 1)]).toBe(0);
    expect(model.voxels[voxelIndex(model.size, 0, 0, 0)]).toBe(nearestColor(palette, 255, 153, 51));
  });
});
