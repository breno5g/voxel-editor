import { describe, expect, it } from 'vitest';
import { encodeRotation, mirrorRotation, normalizeRotation, rotationRows, turnRotation } from './rotation.ts';

const IDENTITY = 4;
/** All 48 signed permutations: 6 column orders x 8 sign combinations. */
const VALID_BYTES = Array.from({ length: 0x80 }, (_unused, byte) => byte).filter((byte) => normalizeRotation(byte) === byte);

const apply = (rotation: number, [x, y, z]: number[]) => {
  const rows = rotationRows(rotation);
  return [rows[0] * x + rows[1] * y + rows[2] * z, rows[3] * x + rows[4] * y + rows[5] * z, rows[6] * x + rows[7] * y + rows[8] * z];
};

describe('rotation byte', () => {
  it('falls back to identity for malformed values', () => {
    expect(normalizeRotation(0b0000)).toBe(IDENTITY);
    expect(normalizeRotation(0b0011)).toBe(IDENTITY);
    expect(normalizeRotation(17)).toBe(17);
  });

  it('decodes row permutations and signs', () => {
    expect(rotationRows(IDENTITY)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(rotationRows(17)).toEqual([0, -1, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('encodes every valid byte back to itself', () => {
    expect(VALID_BYTES).toHaveLength(48);
    VALID_BYTES.forEach((byte) => expect(encodeRotation(rotationRows(byte))).toBe(byte));
  });
});

describe('turnRotation', () => {
  it('turns +X toward +Y with a positive quarter turn about Z', () => {
    expect(apply(turnRotation(IDENTITY, 2, 1), [1, 0, 0])).toEqual([0, 1, 0]);
  });

  it('turns +Y toward +Z about X and +Z toward +X about Y', () => {
    expect(apply(turnRotation(IDENTITY, 0, 1), [0, 1, 0])).toEqual([0, 0, 1]);
    expect(apply(turnRotation(IDENTITY, 1, 1), [0, 0, 1])).toEqual([1, 0, 0]);
  });

  it('returns to the start after four turns or a turn and its inverse', () => {
    for (const axis of [0, 1, 2] as const) {
      expect(turnRotation(turnRotation(17, axis, 1), axis, -1)).toBe(17);
      let rotation = IDENTITY;
      for (let turn = 0; turn < 4; turn++) rotation = turnRotation(rotation, axis, 1);
      expect(rotation).toBe(IDENTITY);
    }
  });
});

describe('mirrorRotation', () => {
  it('negates one parent axis and undoes itself', () => {
    expect(apply(mirrorRotation(IDENTITY, 0), [1, 2, 3])).toEqual([-1, 2, 3]);
    expect(mirrorRotation(mirrorRotation(40, 1), 1)).toBe(40);
  });
});
