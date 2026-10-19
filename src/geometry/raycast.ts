import type { Axis } from '../format/rotation.ts';
import { voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';

/** `normal` points from the hit voxel toward the cell the ray came from ([0,0,0] if the ray starts inside). */
export type VoxelHit = { voxel: Vec3; normal: Vec3; distance: number };

const EPSILON = 1e-9;

function axisNormal(axis: number, sign: number): Vec3 {
  const normal: Vec3 = [0, 0, 0];
  normal[axis] = sign;
  return normal;
}

/** Amanatides-Woo traversal in model voxel space (model occupies [0, size) on each axis). */
export function raycastVoxels(model: VoxModel, origin: Vec3, direction: Vec3): VoxelHit | null {
  const { size } = model;
  let enter = 0;
  let exit = Infinity;
  let enterAxis = -1;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < EPSILON) {
      if (origin[axis] < 0 || origin[axis] > size[axis]) return null;
      continue;
    }
    const near = (0 - origin[axis]) / direction[axis];
    const far = (size[axis] - origin[axis]) / direction[axis];
    const [tMin, tMax] = near < far ? [near, far] : [far, near];
    if (tMin > enter) {
      enter = tMin;
      enterAxis = axis;
    }
    exit = Math.min(exit, tMax);
  }
  if (enter > exit) return null;

  const cell = origin.map((value, axis) => Math.min(Math.max(Math.floor(value + direction[axis] * enter), 0), size[axis] - 1));
  const step = direction.map((value) => Math.sign(value));
  const delta = direction.map((value) => (Math.abs(value) < EPSILON ? Infinity : Math.abs(1 / value)));
  const next = direction.map((value, axis) => {
    if (Math.abs(value) < EPSILON) return Infinity;
    const boundary = value > 0 ? cell[axis] + 1 : cell[axis];
    return (boundary - origin[axis]) / value;
  });
  let normal = enterAxis >= 0 ? axisNormal(enterAxis, -step[enterAxis]) : axisNormal(0, 0);
  let distance = enter;

  for (;;) {
    if (model.voxels[voxelIndex(size, cell[0], cell[1], cell[2])] !== 0) {
      return { voxel: [cell[0], cell[1], cell[2]], normal, distance };
    }
    const axis = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : next[1] < next[2] ? 1 : 2;
    distance = next[axis];
    if (distance > exit) return null;
    cell[axis] += step[axis];
    if (cell[axis] < 0 || cell[axis] >= size[axis]) return null;
    next[axis] += delta[axis];
    normal = axisNormal(axis, -step[axis]);
  }
}

/** Cell on the model's bottom layer (z = 0) under the ray; lets the first voxel go into an empty model. */
/**
 * The cell of layer `layer` (along `axis`) where the ray crosses the plane `axis = plane`;
 * null when the ray runs parallel, points away or lands outside the model. The floor is
 * `(2, 0, 0)`; a stroke dragged over a face keeps that face's plane.
 */
export function raycastPlane(model: VoxModel, origin: Vec3, direction: Vec3, axis: Axis, plane: number, layer: number): Vec3 | null {
  if (Math.abs(direction[axis]) < EPSILON) return null;
  const distance = (plane - origin[axis]) / direction[axis];
  if (distance < 0) return null;
  const cell: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) cell[i] = i === axis ? layer : Math.floor(origin[i] + direction[i] * distance);
  return cell.every((value, i) => value >= 0 && value < model.size[i]) ? cell : null;
}

/** The face of the model box [0, size) the ray enters through, as an axis and a side; null if it misses or starts inside. */
export function raycastBoxFace(size: Vec3, origin: Vec3, direction: Vec3): { axis: Axis; side: 1 | -1 } | null {
  let enter = -Infinity;
  let exit = Infinity;
  let face: { axis: Axis; side: 1 | -1 } | null = null;
  for (const axis of [0, 1, 2] as const) {
    if (Math.abs(direction[axis]) < EPSILON) {
      if (origin[axis] < 0 || origin[axis] > size[axis]) return null;
      continue;
    }
    const near = (0 - origin[axis]) / direction[axis];
    const far = (size[axis] - origin[axis]) / direction[axis];
    const [tMin, tMax] = near < far ? [near, far] : [far, near];
    if (tMin > enter) {
      enter = tMin;
      face = { axis, side: direction[axis] > 0 ? -1 : 1 };
    }
    exit = Math.min(exit, tMax);
  }
  return enter > exit || enter < 0 ? null : face;
}
