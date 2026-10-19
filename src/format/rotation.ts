import { IDENTITY_ROTATION } from './vox.ts';
import type { Matrix3, Vec3 } from './vox.ts';

export type Axis = 0 | 1 | 2;

export const isAxis = (value: number): value is Axis => value === 0 || value === 1 || value === 2;

const SIGN_BITS = [0x10, 0x20, 0x40];

/** Quarter turns (counter-clockwise looking down the positive axis), row-major. */
const QUARTER_TURNS: Record<Axis, Matrix3> = {
  0: [1, 0, 0, 0, 0, -1, 0, 1, 0],
  1: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  2: [0, -1, 0, 1, 0, 0, 0, 0, 1],
};

/**
 * Packed rotation byte: bits 0-1 and 2-3 hold the column of the non-zero entry
 * in rows 0 and 1 (row 2 takes the remaining column), bits 4-6 the row signs.
 * Malformed values fall back to identity, as MagicaVoxel's reader does.
 */
export function normalizeRotation(rotation: number): number {
  const packed = rotation & 0x7f;
  const row0 = packed & 3;
  const row1 = (packed >> 2) & 3;
  return row0 > 2 || row1 > 2 || row0 === row1 ? IDENTITY_ROTATION : packed;
}

export function rotationRows(rotation: number): Matrix3 {
  const row0 = rotation & 3;
  const row1 = (rotation >> 2) & 3;
  const columns = [row0, row1, 3 - row0 - row1];
  const rows = new Array<number>(9).fill(0);
  columns.forEach((column, row) => {
    rows[row * 3 + column] = rotation & SIGN_BITS[row] ? -1 : 1;
  });
  return rows;
}

/** Inverse of `rotationRows` for signed permutation matrices. */
export function encodeRotation(rows: Matrix3): number {
  let packed = 0;
  for (let row = 0; row < 3; row++) {
    const column = [0, 1, 2].find((candidate) => rows[row * 3 + candidate] !== 0) ?? row;
    if (row < 2) packed |= column << (row * 2);
    if (rows[row * 3 + column] < 0) packed |= SIGN_BITS[row];
  }
  return packed;
}

export function applyRows(rows: Matrix3, [x, y, z]: Vec3): Vec3 {
  return [
    rows[0] * x + rows[1] * y + rows[2] * z,
    rows[3] * x + rows[4] * y + rows[5] * z,
    rows[6] * x + rows[7] * y + rows[8] * z,
  ];
}

export function multiplyRows(a: Matrix3, b: Matrix3): Matrix3 {
  return Array.from({ length: 9 }, (_unused, cell) => {
    const row = Math.floor(cell / 3) * 3;
    const column = cell % 3;
    return a[row] * b[column] + a[row + 1] * b[3 + column] + a[row + 2] * b[6 + column];
  });
}

/** The inverse of a rotation matrix (orthonormal, so its transpose). */
export const transposeRows = (rows: Matrix3): Matrix3 => [0, 3, 6, 1, 4, 7, 2, 5, 8].map((cell) => rows[cell]);

/** Applies a quarter turn about a parent-space axis on top of an existing rotation. */
export function turnRotation(rotation: number, axis: Axis, direction: 1 | -1): number {
  const turn = QUARTER_TURNS[axis];
  const signedTurn = direction > 0 ? turn : transposeRows(turn);
  return encodeRotation(multiplyRows(signedTurn, rotationRows(rotation)));
}

/** Mirrors along a parent-space axis (the rotation becomes improper, as MagicaVoxel's flip does). */
export function mirrorRotation(rotation: number, axis: Axis): number {
  const mirror = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  mirror[axis * 4] = -1;
  return encodeRotation(multiplyRows(mirror, rotationRows(rotation)));
}
