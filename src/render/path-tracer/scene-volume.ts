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

/**
 * Every shown object at the current frame, baked into one world-space grid of palette indices
 * (`origin` is the world position of cell 0), plus a coarse grid marking the 8³ bricks holding any voxel.
 */
export type SceneVolume = { origin: Vec3; size: Vec3; voxels: Uint8Array; bricks: Uint8Array; brickSize: Vec3 };

export function bakeSceneVolume(instances: Instance[], models: VoxModel[]): SceneVolume | null {
  const bounds = unionBounds(instances.map((instance) => instanceBounds(instance, models)));
  if (!bounds) return null;
  const origin: Vec3 = [Math.floor(bounds.low[0]), Math.floor(bounds.low[1]), Math.floor(bounds.low[2])];
  const extent = (axis: number) => Math.max(1, Math.ceil(bounds.high[axis]) - origin[axis]);
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
