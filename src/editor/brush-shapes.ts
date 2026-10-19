import type { Axis } from '../format/rotation.ts';
import type { Vec3 } from '../format/vox.ts';

export const AXES: readonly Axis[] = [0, 1, 2];
export const STAMP_SHAPES = ['cube', 'sphere'] as const;
export type StampShape = (typeof STAMP_SHAPES)[number];

/** The axis a face normal points along. */
export const axisOf = (normal: Vec3): Axis => (normal[0] !== 0 ? 0 : normal[1] !== 0 ? 1 : 2);

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
