export type Vec3 = [number, number, number];
export type Matrix3 = readonly number[];
export type Dict = Map<string, string>;

export type VoxModel = { size: Vec3; voxels: Uint8Array };
export type TransformKey = { frame: number; translation: Vec3; rotation: number };
export type ShapeKey = { frame: number; model: number };

export type TransformNode = { kind: 'transform'; attrs: Dict; child: number; layer: number; keys: TransformKey[] };
export type GroupNode = { kind: 'group'; attrs: Dict; children: number[] };
export type ShapeNode = { kind: 'shape'; attrs: Dict; keys: ShapeKey[] };
export type SceneNode = TransformNode | GroupNode | ShapeNode;

export type Layer = { id: number; attrs: Dict };
export type RawChunk = { id: string; content: Uint8Array; children: Uint8Array };

export type VoxDocument = {
  models: VoxModel[];
  /** Index is the node id: MagicaVoxel's reader requires ids 0..n-1. */
  nodes: SceneNode[];
  /** RGBA chunk layout: palette index i (1..255) lives at byte (i - 1) * 4. */
  palette: Uint8Array;
  layers: Layer[];
  /** MATL: material properties per palette index (`_type`, `_rough`, ...), kept as MagicaVoxel writes them. */
  materials: Map<number, Dict>;
  /** NOTE: MagicaVoxel's palette notes, one per row of eight colours. */
  notes: string[];
  /** rCAM: MagicaVoxel's camera slots (`_mode`, `_focus`, `_angle`, `_radius`, `_frustum`, `_fov`) by slot id. */
  cameras: Map<number, Dict>;
  meta: Dict;
  /** Chunks this editor does not model (rOBJ, IMAP, ...), written back verbatim. */
  extras: RawChunk[];
};

export const VOX_MAGIC = 'VOX ';
export const VOX_VERSION = 200;
export const IDENTITY_ROTATION = 4;
export const MAX_MODEL_SIZE = 256;
export const PALETTE_SIZE = 256;
export const PALETTE_BYTES = PALETTE_SIZE * 4;
export const NO_LAYER = -1;
export const RESERVED_ID = -1;
export const EMPTY_VOXEL = 0;

export function createModel(size: Vec3): VoxModel {
  return { size: [...size], voxels: new Uint8Array(size[0] * size[1] * size[2]) };
}

export function cloneModel(model: VoxModel): VoxModel {
  return { size: [...model.size], voxels: model.voxels.slice() };
}

/**
 * Copy of `model` at a new size whose cell 0 is the old cell `origin` (the minimum corner by default);
 * cells outside the old volume are empty and cells outside the new one are dropped.
 */
export function resizeModel(model: VoxModel, size: Vec3, origin: Vec3 = [0, 0, 0]): VoxModel {
  const resized = createModel(size);
  const [x0, x1] = [Math.max(origin[0], 0), Math.min(origin[0] + size[0], model.size[0])];
  if (x1 <= x0) return resized;
  for (let z = Math.max(origin[2], 0); z < Math.min(origin[2] + size[2], model.size[2]); z++) {
    for (let y = Math.max(origin[1], 0); y < Math.min(origin[1] + size[1], model.size[1]); y++) {
      const source = voxelIndex(model.size, x0, y, z);
      resized.voxels.set(model.voxels.subarray(source, source + x1 - x0), voxelIndex(size, x0 - origin[0], y - origin[1], z - origin[2]));
    }
  }
  return resized;
}

export function voxelIndex(size: Vec3, x: number, y: number, z: number): number {
  return x + size[0] * (y + size[1] * z);
}

/**
 * Model-space point that sits on the transform's translation. MagicaVoxel uses
 * floor(size / 2): every sample with an odd height has t.z = floor(h / 2) and rests on z = 0,
 * and an integer pivot keeps voxels on the world grid under any 90° rotation.
 */
export function modelPivot(size: Vec3): Vec3 {
  return [Math.floor(size[0] / 2), Math.floor(size[1] / 2), Math.floor(size[2] / 2)];
}

export function cellOf(size: Vec3, index: number): Vec3 {
  return [index % size[0], Math.floor(index / size[0]) % size[1], Math.floor(index / (size[0] * size[1]))];
}

export function isInside(size: Vec3, cell: Vec3): boolean {
  return cell.every((axis, i) => axis >= 0 && axis < size[i]);
}

/** RGB bytes of a palette index (1..255). */
export function paletteColor(palette: Uint8Array, index: number): Vec3 {
  const offset = (index - 1) * 4;
  return [palette[offset], palette[offset + 1], palette[offset + 2]];
}
