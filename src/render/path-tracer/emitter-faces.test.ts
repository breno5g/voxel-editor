import { describe, expect, it } from 'vitest';
import { collectEmitterFaces, emitterPower } from './emitter-faces.ts';
import type { SceneVolume } from './scene-volume.ts';

const EMITTER = 5;
const OPAQUE = 2;
const GLASS = 3;
const flags = (...indices: number[]) => Uint8Array.from({ length: 256 }, (_, index) => Number(indices.includes(index)));

/** A 3³ grid: an emitter in the middle, an opaque voxel on its +x side and glass below it. */
function volume(): SceneVolume {
  const voxels = new Uint8Array(27);
  const at = (x: number, y: number, z: number) => x + 3 * (y + 3 * z);
  voxels[at(1, 1, 1)] = EMITTER;
  voxels[at(2, 1, 1)] = OPAQUE;
  voxels[at(1, 1, 0)] = GLASS;
  return { origin: [0, 0, 0], size: [3, 3, 3], voxels, bricks: new Uint8Array(1), brickSize: [1, 1, 1] };
}

describe('collectEmitterFaces', () => {
  it('keeps the faces that border empty cells or glass', () => {
    const faces = collectEmitterFaces(volume(), flags(EMITTER), flags(GLASS));
    const count = (face: number) => faces.offsets[EMITTER * 6 + face + 1] - faces.offsets[EMITTER * 6 + face];
    expect([0, 1, 2, 3, 4, 5].map(count)).toEqual([1, 0, 1, 1, 1, 1]);
    expect(Array.from(faces.faces)).toEqual([0, 2, 3, 4, 5].map((face) => 13 * 8 + face));
  });

  it('finds nothing without area lights in the palette', () => {
    expect(collectEmitterFaces(volume(), flags(), flags(GLASS)).faces).toHaveLength(0);
  });
});

describe('emitterPower', () => {
  const radiance = new Float32Array(256 * 3);
  radiance.set([2, 1, 0.5], EMITTER * 3);
  const faces = collectEmitterFaces(volume(), flags(EMITTER), flags(GLASS));

  it('weighs faces by brightest channel times area', () => {
    expect(emitterPower(faces, radiance, [1, 1, 1]).total).toBe(10);
    expect(emitterPower(faces, radiance, [2, 1, 1]).total).toBe(2 * (1 + 4 * 2));
  });

  it('runs each group up to its share of the total', () => {
    const { cumulative } = emitterPower(faces, radiance, [1, 1, 1]);
    const group = (face: number) => EMITTER * 6 + face;
    expect([cumulative[group(0) - 1], cumulative[group(0)], cumulative[group(1)], cumulative[group(5)], cumulative.at(-1)]).toEqual([0, expect.closeTo(0.2), expect.closeTo(0.2), 1, 1]);
  });

  it('is all zero when no face shines', () => {
    expect(emitterPower(faces, new Float32Array(256 * 3), [1, 1, 1])).toMatchObject({ total: 0 });
  });
});
