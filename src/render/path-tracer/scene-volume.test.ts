import { describe, expect, it } from 'vitest';
import { createModel, voxelIndex } from '../../format/vox.ts';
import type { Vec3, VoxModel } from '../../format/vox.ts';
import { IDENTITY_POSE } from '../../scene/scene-graph.ts';
import type { Instance } from '../../scene/scene-graph.ts';
import { BRICK, bakeSceneVolume, dilateBricks, shapeDensity, VOLUME_MARGIN } from './scene-volume.ts';

const instance = (model: number, translation: Vec3, rows = IDENTITY_POSE.rows): Instance => ({ transformId: model, shapeId: model, model, pose: { rows, translation } });
const cellAt = (volume: { size: Vec3; voxels: Uint8Array }, [x, y, z]: Vec3) => volume.voxels[x + volume.size[0] * (y + volume.size[1] * z)];

function bar(): VoxModel {
  const model = createModel([3, 1, 1]);
  model.voxels[voxelIndex(model.size, 0, 0, 0)] = 7;
  model.voxels[voxelIndex(model.size, 2, 0, 0)] = 9;
  return model;
}

describe('bakeSceneVolume', () => {
  it('returns null for an empty scene', () => {
    expect(bakeSceneVolume([], [])).toBeNull();
  });

  it('places voxels at their world cells around the model pivot', () => {
    const volume = bakeSceneVolume([instance(0, [10, 0, 0])], [bar()]);
    const m = VOLUME_MARGIN;
    expect(volume?.origin).toEqual([9 - m, -m, -m]);
    expect(volume?.size).toEqual([3 + 2 * m, 1 + 2 * m, 1 + 2 * m]);
    if (!volume) return;
    expect([cellAt(volume, [m, m, m]), cellAt(volume, [m + 1, m, m]), cellAt(volume, [m + 2, m, m])]).toEqual([7, 0, 9]);
  });

  it('applies the instance rotation', () => {
    const quarterTurn = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const volume = bakeSceneVolume([instance(0, [0, 0, 0], quarterTurn)], [bar()]);
    const m = VOLUME_MARGIN;
    expect(volume?.size).toEqual([1 + 2 * m, 3 + 2 * m, 1 + 2 * m]);
    if (!volume) return;
    expect([cellAt(volume, [m, m, m]), cellAt(volume, [m, m + 2, m])]).toEqual([7, 9]);
  });

  it('marks only the bricks holding voxels', () => {
    const far = createModel([1, 1, 1]);
    far.voxels[0] = 1;
    const volume = bakeSceneVolume([instance(0, [0, 0, 0]), instance(1, [BRICK * 3, 0, 0])], [far, far]);
    expect(volume && Array.from(volume.bricks)).toEqual([1, 0, 0, 1]);
    expect(volume && Array.from(dilateBricks(volume))).toEqual([1, 1, 1, 1]);
  });
});

describe('shapeDensity', () => {
  const single = () => {
    const model = createModel([1, 1, 1]);
    model.voxels[0] = 1;
    const volume = bakeSceneVolume([instance(0, [0, 0, 0])], [model]);
    if (!volume) throw new Error('empty');
    return volume;
  };

  it('keeps plain occupancy for marching cubes', () => {
    const volume = single();
    const density = shapeDensity(volume, 0);
    expect(density.filter((value) => value === 255)).toHaveLength(1);
    expect(density.filter((value) => value !== 0 && value !== 255)).toHaveLength(0);
  });

  it('spreads occupancy to the neighbours for clay', () => {
    const volume = single();
    const m = VOLUME_MARGIN;
    const density = shapeDensity(volume, 1);
    const at = ([x, y, z]: Vec3) => density[x + volume.size[0] * (y + volume.size[1] * z)];
    expect(at([m, m, m])).toBe(Math.round(255 / 8));
    expect(at([m + 1, m, m])).toBe(Math.round(255 / 16));
  });
});
