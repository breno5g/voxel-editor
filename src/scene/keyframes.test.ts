import { describe, expect, it } from 'vitest';
import type { ShapeKey, TransformKey, Vec3 } from '../format/vox.ts';
import { adjacentKeyFrame, evaluateShape, evaluateTransform, parseRange, previousShapeModel, removeKeyAt, setTransformAt, upsertKey } from './keyframes.ts';

const key = (frame: number, translation: Vec3, rotation = 4): TransformKey => ({ frame, translation, rotation });

/** Keys of nTRN 2 in MagicaVoxel's vox/anim/T-Rex-m.vox. */
const TREX: TransformKey[] = [key(0, [0, 0, 13]), key(11, [44, 0, 13]), key(19, [148, 0, 13], 17)];

describe('evaluateTransform', () => {
  it('returns the key itself on a key frame', () => {
    expect(evaluateTransform(TREX, 0, false)).toEqual({ translation: [0, 0, 13], rotation: 4 });
    expect(evaluateTransform(TREX, 19, false)).toEqual({ translation: [148, 0, 13], rotation: 17 });
  });

  it('interpolates translation linearly between keys', () => {
    expect(evaluateTransform(TREX, 5, false).translation).toEqual([20, 0, 13]);
    expect(evaluateTransform(TREX, 15, false).translation).toEqual([96, 0, 13]);
  });

  it('holds the previous rotation until the next key', () => {
    expect(evaluateTransform(TREX, 18, false).rotation).toBe(4);
  });

  it('rounds half up, not away from zero', () => {
    const keys = [key(0, [0, 0, 0]), key(2, [-1, 1, 3])];
    expect(evaluateTransform(keys, 1, false).translation).toEqual([0, 1, 2]);
  });

  it('holds the first key before it and the last key after it', () => {
    expect(evaluateTransform([key(5, [7, 7, 7]), key(9, [0, 0, 0])], 0, false).translation).toEqual([7, 7, 7]);
    expect(evaluateTransform(TREX, 30, false)).toEqual({ translation: [148, 0, 13], rotation: 17 });
  });

  it('repeats with period last - first + 1 when looping', () => {
    expect(evaluateTransform(TREX, 25, true)).toEqual(evaluateTransform(TREX, 5, false));
  });
});

describe('evaluateShape', () => {
  const keys: ShapeKey[] = [{ frame: 0, model: 10 }, { frame: 2, model: 11 }];

  it('steps between models without blending', () => {
    expect([0, 1, 2, 3].map((frame) => evaluateShape(keys, frame, false))).toEqual([10, 10, 11, 11]);
  });

  it('wraps when looping', () => {
    expect(evaluateShape(keys, 5, true)).toBe(11);
  });
});

describe('previousShapeModel', () => {
  const keys: ShapeKey[] = [{ frame: 0, model: 10 }, { frame: 4, model: 11 }, { frame: 8, model: 12 }];

  it('returns the model of the frame before the one on screen', () => {
    expect(previousShapeModel(keys, 5, false)).toBe(10);
    expect(previousShapeModel(keys, 8, false)).toBe(11);
  });

  it('wraps to the last frame only when looping', () => {
    expect(previousShapeModel(keys, 2, false)).toBeNull();
    expect(previousShapeModel(keys, 2, true)).toBe(12);
  });

  it('has nothing to show for static shapes', () => {
    expect(previousShapeModel([{ frame: 0, model: 3 }], 5, true)).toBeNull();
  });
});

describe('key editing', () => {
  it('inserts keys in frame order and replaces a key on the same frame', () => {
    const keys = upsertKey(upsertKey([key(0, [0, 0, 0])], key(10, [1, 0, 0])), key(5, [2, 0, 0]));
    expect(keys.map((k) => k.frame)).toEqual([0, 5, 10]);
    expect(upsertKey(keys, key(5, [9, 9, 9])).find((k) => k.frame === 5)?.translation).toEqual([9, 9, 9]);
  });

  it('never removes the last key', () => {
    expect(removeKeyAt([key(0, [0, 0, 0])], 0)).toHaveLength(1);
  });

  it('edits static nodes in place and keys animated ones at the frame', () => {
    expect(setTransformAt([key(0, [0, 0, 0])], 12, { translation: [1, 2, 3], rotation: 4 })).toEqual([key(0, [1, 2, 3])]);
    expect(setTransformAt(TREX, 5, { translation: [1, 2, 3], rotation: 4 }).map((k) => k.frame)).toEqual([0, 5, 11, 19]);
  });

  it('finds adjacent key frames in both directions', () => {
    expect(adjacentKeyFrame([0, 11, 19], 5, 1)).toBe(11);
    expect(adjacentKeyFrame([0, 11, 19], 5, -1)).toBe(0);
    expect(adjacentKeyFrame([0, 11, 19], 19, 1)).toBeNull();
  });
});

describe('parseRange', () => {
  it('reads META _anim_range and falls back to 0-30 on garbage', () => {
    expect(parseRange('0 30')).toEqual([0, 30]);
    expect(parseRange('10 400')).toEqual([10, 360]);
    expect(parseRange('9 2')).toEqual([0, 30]);
    expect(parseRange(undefined)).toEqual([0, 30]);
  });
});
