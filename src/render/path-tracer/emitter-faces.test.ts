import { describe, expect, it } from 'vitest';
import { collectEmitterFaces, emitterPower, sampleEmitter } from './emitter-faces.ts';
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
    expect(Array.from(faces.cells)).toEqual(Array(5).fill(13));
  });

  it('finds nothing without area lights in the palette', () => {
    expect(collectEmitterFaces(volume(), flags(), flags(GLASS)).cells).toHaveLength(0);
  });
});

describe('sampleEmitter', () => {
  const radiance = new Float32Array(256 * 3);
  radiance.set([2, 1, 0.5], EMITTER * 3);
  const faces = collectEmitterFaces(volume(), flags(EMITTER), flags(GLASS));

  it('weighs faces by brightest channel times area', () => {
    expect(emitterPower(faces, radiance, [1, 1, 1]).at(-1)).toBe(10);
    expect(emitterPower(faces, radiance, [2, 1, 1]).at(-1)).toBe(2 * (1 + 4 * 2));
  });

  it('picks the face whose power span holds the draw', () => {
    const cumulative = emitterPower(faces, radiance, [1, 1, 1]);
    expect(sampleEmitter(faces, cumulative, 0, 0)).toEqual({ cell: 13, index: EMITTER, face: 0 });
    expect(sampleEmitter(faces, cumulative, 0.99, 0.5)).toEqual({ cell: 13, index: EMITTER, face: 5 });
  });

  it('returns nothing when no face shines', () => {
    expect(sampleEmitter(faces, emitterPower(faces, new Float32Array(256 * 3), [1, 1, 1]), 0.5, 0.5)).toBeNull();
  });
});
