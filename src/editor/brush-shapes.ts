import type { Axis } from '../format/rotation.ts';
import { cellOf, EMPTY_VOXEL, isInside, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';

export const AXES: readonly Axis[] = [0, 1, 2];
export const STAMP_SHAPES = ['cube', 'sphere'] as const;
export type StampShape = (typeof STAMP_SHAPES)[number];

/** The axis a face normal points along. */
export const axisOf = (normal: Vec3): Axis => (normal[0] !== 0 ? 0 : normal[1] !== 0 ? 1 : 2);

export const addScaled = (cell: Vec3, direction: Vec3, scale: number): Vec3 => [
  cell[0] + direction[0] * scale,
  cell[1] + direction[1] * scale,
  cell[2] + direction[2] * scale,
];

/** Face connectivity options: MagicaVoxel `b_face_col` (same colour only) and `b_face_4` (4 or 8 neighbours). */
export type FaceConnectivity = { byColor: boolean; neighbors: 4 | 8 };

const colorAt = (model: VoxModel, cell: Vec3) => (isInside(model.size, cell) ? model.voxels[voxelIndex(model.size, cell[0], cell[1], cell[2])] : EMPTY_VOXEL);

/**
 * MagicaVoxel face mode: the voxels whose `normal` face is exposed and that connect to `start`
 * across that plane (by geometry, or only through voxels of the same colour).
 */
export function faceRegion(model: VoxModel, start: Vec3, normal: Vec3, { byColor, neighbors }: FaceConnectivity): Vec3[] {
  const axis = axisOf(normal);
  const [u, v] = AXES.filter((other) => other !== axis);
  const startColor = colorAt(model, start);
  const steps = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    ...(neighbors === 8 ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : []),
  ];
  const isMember = (cell: Vec3) => {
    const color = colorAt(model, cell);
    return color !== EMPTY_VOXEL && colorAt(model, addScaled(cell, normal, 1)) === EMPTY_VOXEL && (!byColor || color === startColor);
  };
  if (!isMember(start)) return [];
  const key = (cell: Vec3) => `${cell[u]},${cell[v]}`;
  const seen = new Set([key(start)]);
  const region = [start];
  for (let index = 0; index < region.length; index++) {
    for (const [du, dv] of steps) {
      const next: Vec3 = [region[index][0], region[index][1], region[index][2]];
      next[u] += du;
      next[v] += dv;
      if (seen.has(key(next)) || !isMember(next)) continue;
      seen.add(key(next));
      region.push(next);
    }
  }
  return region;
}

/** Every cell of the box spanned by two corner cells, inclusive. */
export function* cellsBetween(from: Vec3, to: Vec3): Generator<Vec3> {
  const low = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.min(from[2], to[2])];
  const high = [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])];
  for (let z = low[2]; z <= high[2]; z++) {
    for (let y = low[1]; y <= high[1]; y++) {
      for (let x = low[0]; x <= high[0]; x++) yield [x, y, z];
    }
  }
}

/** Cells of the 3D line from `from` to `to`, one per step along the longest axis. */
export function lineCells(from: Vec3, to: Vec3): Vec3[] {
  const steps = Math.max(...AXES.map((axis) => Math.abs(to[axis] - from[axis])));
  return Array.from({ length: steps + 1 }, (_unused, step): Vec3 => {
    const t = steps === 0 ? 0 : step / steps;
    return [Math.round(from[0] + (to[0] - from[0]) * t), Math.round(from[1] + (to[1] - from[1]) * t), Math.round(from[2] + (to[2] - from[2]) * t)];
  });
}

/**
 * Region options: MagicaVoxel `b_region` (every voxel of the clicked colour, or only the connected
 * ones), `b_rsel_col` (connect through the same colour only) and `b_rsel_4`, whose 4/8 neighbour
 * choice becomes 6 (faces) or 26 (faces, edges, corners) in a volume.
 */
export type RegionOptions = { connected: boolean; byColor: boolean; neighbors: 6 | 26 };

const NEIGHBORS_26: Vec3[] = [];
for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NEIGHBORS_26.push([dx, dy, dz]);
const NEIGHBORS_6 = NEIGHBORS_26.filter((offset) => Math.abs(offset[0]) + Math.abs(offset[1]) + Math.abs(offset[2]) === 1);

/** The voxels a region action (remove, replace, region select) applies to, starting from a filled voxel. */
export function colorRegion(model: VoxModel, start: Vec3, { connected, byColor, neighbors }: RegionOptions): Vec3[] {
  const startColor = colorAt(model, start);
  if (startColor === EMPTY_VOXEL) return [];
  if (!connected) {
    const cells: Vec3[] = [];
    model.voxels.forEach((color, index) => {
      if (color === startColor) cells.push(cellOf(model.size, index));
    });
    return cells;
  }
  const offsets = neighbors === 26 ? NEIGHBORS_26 : NEIGHBORS_6;
  const seen = new Set([voxelIndex(model.size, start[0], start[1], start[2])]);
  const region = [start];
  for (let index = 0; index < region.length; index++) {
    for (const offset of offsets) {
      const next = addScaled(region[index], offset, 1);
      const color = colorAt(model, next);
      if (color === EMPTY_VOXEL || (byColor && color !== startColor)) continue;
      const key = voxelIndex(model.size, next[0], next[1], next[2]);
      if (seen.has(key)) continue;
      seen.add(key);
      region.push(next);
    }
  }
  return region;
}

/** Geometry brush shapes, MagicaVoxel `b_geo`. */
export const GEO_SHAPES = ['line', 'square', 'circle'] as const;
export type GeoShape = (typeof GEO_SHAPES)[number];
/** `b_center_fill` keeps the inside, else only the outline; `b_center_even` centres on a cell corner for even widths. */
export type CenterOptions = { fill: boolean; even: boolean };

/**
 * A square or circle on the plane across `axis`, centred on `center` and reaching `edge`.
 * The outline is one cell thick: the cells with a 4-neighbour outside the shape.
 */
export function centeredShape(shape: 'square' | 'circle', center: Vec3, edge: Vec3, axis: Axis, { fill, even }: CenterOptions): Vec3[] {
  const [u, v] = AXES.filter((other) => other !== axis);
  const offset = even ? 0.5 : 0;
  const reach = [Math.abs(edge[u] - center[u] - offset), Math.abs(edge[v] - center[v] - offset)];
  const half = shape === 'square' ? Math.max(...reach) : Math.hypot(reach[0], reach[1]) + 0.5;
  const inside = (du: number, dv: number) => {
    const [a, b] = [Math.abs(du - offset), Math.abs(dv - offset)];
    return shape === 'square' ? Math.max(a, b) <= half : a * a + b * b <= half * half;
  };
  const span = Math.ceil(half) + 1;
  const cells: Vec3[] = [];
  for (let dv = -span; dv <= span; dv++) {
    for (let du = -span; du <= span; du++) {
      if (!inside(du, dv)) continue;
      const isBorder = !inside(du + 1, dv) || !inside(du - 1, dv) || !inside(du, dv + 1) || !inside(du, dv - 1);
      if (!fill && !isBorder) continue;
      const cell: Vec3 = [center[0], center[1], center[2]];
      cell[u] += du;
      cell[v] += dv;
      cells.push(cell);
    }
  }
  return cells;
}

/**
 * Where to centre a stamp so it starts at `cell` and grows away from the face it was attached to
 * (`outward` +1 or -1 along `axis`), instead of sinking half into the surface.
 */
export function stampOutward(cell: Vec3, size: number, axis: Axis, outward: 1 | -1): Vec3 {
  const shifted: Vec3 = [cell[0], cell[1], cell[2]];
  const low = -Math.floor((size - 1) / 2);
  shifted[axis] = outward > 0 ? cell[axis] - low : cell[axis] - low - size + 1;
  return shifted;
}

/**
 * MagicaVoxel's voxel brush (`b_vox_size`, `b_vox_cube`, `b_vox_vol`): a cube or ball `size`
 * cells across around `center`. Even sizes grow toward +axis. A 2D stamp (`flatAxis`) stays
 * on the layer of `center`, the plane of the face under the pointer.
 */
export function stampCells(center: Vec3, size: number, shape: StampShape, flatAxis: Axis | null): Vec3[] {
  const low = -Math.floor((size - 1) / 2);
  const middle = low + (size - 1) / 2;
  const radiusSquared = (size / 2) ** 2;
  const span = (axis: Axis) => (axis === flatAxis ? [0] : Array.from({ length: size }, (_unused, i) => low + i));
  const cells: Vec3[] = [];
  for (const dz of span(2)) {
    for (const dy of span(1)) {
      for (const dx of span(0)) {
        const offset: Vec3 = [dx, dy, dz];
        const distanceSquared = AXES.reduce<number>((sum, axis) => (axis === flatAxis ? sum : sum + (offset[axis] - middle) ** 2), 0);
        if (shape === 'sphere' && distanceSquared > radiusSquared) continue;
        cells.push([center[0] + dx, center[1] + dy, center[2] + dz]);
      }
    }
  }
  return cells;
}

/**
 * MagicaVoxel axis mode (`b_axis_x/y/z`): each cell runs through the whole model along every
 * enabled axis. Inferred from the brush options; the binary keeps it in its GPU brush pass.
 */
export function* alongAxes(cells: Iterable<Vec3>, size: Vec3, axes: readonly boolean[]): Generator<Vec3> {
  for (const cell of cells) {
    yield* AXES.reduce(
      (lines: Vec3[], axis) =>
        axes[axis]
          ? lines.flatMap((line) =>
              Array.from({ length: size[axis] }, (_unused, value): Vec3 => {
                const moved: Vec3 = [line[0], line[1], line[2]];
                moved[axis] = value;
                return moved;
              }),
            )
          : lines,
      [cell],
    );
  }
}

const reflect = (cell: Vec3, axis: Axis, size: Vec3): Vec3 => {
  const reflected: Vec3 = [cell[0], cell[1], cell[2]];
  reflected[axis] = size[axis] - 1 - cell[axis];
  return reflected;
};

/** Each cell plus its reflections across the model centre on every enabled mirror axis. */
export function* withMirrors(cells: Iterable<Vec3>, size: Vec3, mirror: readonly boolean[]): Generator<Vec3> {
  for (const cell of cells) {
    yield* AXES.reduce((variants: Vec3[], axis) => (mirror[axis] ? variants.flatMap((variant) => [variant, reflect(variant, axis, size)]) : variants), [cell]);
  }
}
