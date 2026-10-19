import { applyRows } from '../../format/rotation.ts';
import { EMPTY_VOXEL, modelPivot } from '../../format/vox.ts';
import type { Vec3, VoxModel } from '../../format/vox.ts';
import type { Instance } from '../../scene/scene-graph.ts';
import { instanceBounds, unionBounds } from '../../scene/scene-tree.ts';

/** Side of the occupancy bricks rays use to skip empty space. */
export const BRICK = 8;
/** WebGL2 guarantees 256 per 3D texture axis; common GPUs allow 2048, which bounds a scene's extent. */
export const MAX_VOLUME_AXIS = 2048;
const MAX_VOLUME_CELLS = 2 ** 29;
/** Empty cells around the scene, so smoothed shapes fade to nothing before the volume's edge. */
export const VOLUME_MARGIN = 2;

/**
 * Every shown object at the current frame, baked into one world-space grid of palette indices
 * (`origin` is the world position of cell 0), plus a coarse grid marking the 8³ bricks holding any voxel.
 */
export type SceneVolume = { origin: Vec3; size: Vec3; voxels: Uint8Array; bricks: Uint8Array; brickSize: Vec3 };

export function bakeSceneVolume(instances: Instance[], models: VoxModel[]): SceneVolume | null {
  const bounds = unionBounds(instances.map((instance) => instanceBounds(instance, models)));
  if (!bounds) return null;
  const origin: Vec3 = [Math.floor(bounds.low[0]) - VOLUME_MARGIN, Math.floor(bounds.low[1]) - VOLUME_MARGIN, Math.floor(bounds.low[2]) - VOLUME_MARGIN];
  const extent = (axis: number) => Math.max(1, Math.ceil(bounds.high[axis]) - origin[axis] + VOLUME_MARGIN);
  const size: Vec3 = [extent(0), extent(1), extent(2)];
  if (size.some((axis) => axis > MAX_VOLUME_AXIS) || size[0] * size[1] * size[2] > MAX_VOLUME_CELLS) throw new Error(`Cena grande demais para renderizar (${size.join('×')})`);
  const voxels = new Uint8Array(size[0] * size[1] * size[2]);
  const brickSize: Vec3 = [Math.ceil(size[0] / BRICK), Math.ceil(size[1] / BRICK), Math.ceil(size[2] / BRICK)];
  const bricks = new Uint8Array(brickSize[0] * brickSize[1] * brickSize[2]);
  for (const { pose, model } of instances) {
    const source = models[model];
    const [sx, sy, sz] = source.size;
    const pivot = modelPivot(source.size);
    const shift: Vec3 = [pose.translation[0] - origin[0], pose.translation[1] - origin[1], pose.translation[2] - origin[2]];
    let index = 0;
    for (let z = 0; z < sz; z++) {
      for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++, index++) {
          const color = source.voxels[index];
          if (color === EMPTY_VOXEL) continue;
          const [dx, dy, dz] = applyRows(pose.rows, [x + 0.5 - pivot[0], y + 0.5 - pivot[1], z + 0.5 - pivot[2]]);
          const cx = Math.floor(shift[0] + dx);
          const cy = Math.floor(shift[1] + dy);
          const cz = Math.floor(shift[2] + dz);
          if (cx < 0 || cy < 0 || cz < 0 || cx >= size[0] || cy >= size[1] || cz >= size[2]) continue;
          voxels[cx + size[0] * (cy + size[1] * cz)] = color;
          bricks[Math.floor(cx / BRICK) + brickSize[0] * (Math.floor(cy / BRICK) + brickSize[1] * Math.floor(cz / BRICK))] = 1;
        }
      }
    }
  }
  return { origin, size, voxels, bricks, brickSize };
}

/**
 * Occupancy as 0–255 density for the smooth shapes: plain for marching cubes (the GPU's trilinear filter
 * then gives MC's iso-surface at 128), blurred `passes` times with a [1 2 1] kernel per axis for clay.
 */
export function shapeDensity({ size, voxels }: SceneVolume, passes: number): Uint8Array {
  let density = Float32Array.from(voxels, (color) => (color === 0 ? 0 : 1));
  const strides = [1, size[0], size[0] * size[1]];
  for (let pass = 0; pass < passes; pass++) {
    for (let axis = 0; axis < 3; axis++) {
      const source = density;
      const stride = strides[axis];
      density = new Float32Array(source.length);
      for (let index = 0; index < source.length; index++) {
        const coordinate = Math.floor(index / stride) % size[axis];
        const before = coordinate > 0 ? source[index - stride] : 0;
        const after = coordinate < size[axis] - 1 ? source[index + stride] : 0;
        density[index] = (before + 2 * source[index] + after) / 4;
      }
    }
  }
  return Uint8Array.from(density, (value) => Math.round(value * 255));
}

/** Bricks next to occupied ones too: a smooth surface can bulge into a neighbouring brick. */
export function dilateBricks({ brickSize, bricks }: SceneVolume): Uint8Array {
  const [bx, by, bz] = brickSize;
  const dilated = new Uint8Array(bricks.length);
  for (let z = 0; z < bz; z++) {
    for (let y = 0; y < by; y++) {
      for (let x = 0; x < bx; x++) {
        if (!bricks[x + bx * (y + by * z)]) continue;
        for (let dz = Math.max(z - 1, 0); dz <= Math.min(z + 1, bz - 1); dz++) {
          for (let dy = Math.max(y - 1, 0); dy <= Math.min(y + 1, by - 1); dy++) {
            for (let dx = Math.max(x - 1, 0); dx <= Math.min(x + 1, bx - 1); dx++) dilated[dx + bx * (dy + by * dz)] = 1;
          }
        }
      }
    }
  }
  return dilated;
}
