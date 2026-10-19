import { describe, expect, it } from 'vitest';
import { createDefaultPalette } from './defaults.ts';
import { flatImage, ISO_OPTIONS, isoImage, sliceImage } from './voxel-images.ts';
import { createModel, voxelIndex } from './vox.ts';

const model = () => {
  const result = createModel([2, 3, 2]);
  result.voxels[voxelIndex(result.size, 0, 0, 0)] = 17;
  result.voxels[voxelIndex(result.size, 1, 2, 1)] = 1;
  return result;
};
const alphaAt = (image: { width: number; pixels: Uint8ClampedArray }, x: number, y: number) => image.pixels[(y * image.width + x) * 4 + 3];

describe('voxel images', () => {
  const palette = createDefaultPalette();

  it('tiles z slices left to right, +y up', () => {
    const image = sliceImage(model(), palette);
    expect([image.width, image.height]).toEqual([4, 3]);
    expect(alphaAt(image, 0, 2)).toBe(255);
    expect(alphaAt(image, 3, 0)).toBe(255);
    expect(alphaAt(image, 1, 2)).toBe(0);
  });

  it('draws the front view at the configured voxel size', () => {
    const image = flatImage(model(), palette, { size: 2, shadow: false, outline: false });
    expect([image.width, image.height]).toEqual([4, 4]);
    expect([...image.pixels.slice((3 * 4 + 0) * 4, (3 * 4 + 0) * 4 + 4)]).toEqual([255, 153, 51, 255]);
  });

  it('draws one isometric view per configured turn', () => {
    const image = isoImage(model(), palette, { ...ISO_OPTIONS, views: 2, outline: false });
    expect(image.width).toBeGreaterThan(2 * 5 * ISO_OPTIONS.size * 2);
    expect(image.pixels.some((value, index) => index % 4 === 3 && value === 255)).toBe(true);
  });
});
