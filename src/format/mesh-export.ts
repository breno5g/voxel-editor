import { applyRows } from './rotation.ts';
import { cellOf, EMPTY_VOXEL, modelPivot, paletteColor, voxelIndex } from './vox.ts';
import type { Matrix3, Vec3, VoxModel } from './vox.ts';

/** MagicaVoxel's mesh exports (`o obj|ply|mc|cube|pcl`), with `config.txt`'s `io_*` options. */
export const MESH_FORMATS = ['obj', 'ply', 'mc', 'cube', 'pcl'] as const;
export type MeshFormat = (typeof MESH_FORMATS)[number];
/** `XYZ` keeps Z up; `XZ-Y` turns it Y up (x, z, -y), as MagicaVoxel's OBJ default. */
export type ExportAxis = 'XYZ' | 'XZ-Y';
export type MeshOptions = { scale: number; axis: ExportAxis; clockwise: boolean; merge: boolean; cubeMargin: number };
export const DEFAULT_MESH_OPTIONS: Record<MeshFormat, MeshOptions> = {
  obj: { scale: 0.1, axis: 'XZ-Y', clockwise: false, merge: true, cubeMargin: 0.1 },
  ply: { scale: 0.1, axis: 'XYZ', clockwise: false, merge: true, cubeMargin: 0.1 },
  mc: { scale: 0.1, axis: 'XYZ', clockwise: false, merge: true, cubeMargin: 0.1 },
  cube: { scale: 0.1, axis: 'XYZ', clockwise: false, merge: true, cubeMargin: 0.1 },
  pcl: { scale: 1, axis: 'XYZ', clockwise: false, merge: true, cubeMargin: 0.1 },
};

/** One exported object: its model and where it sits (null exports it in its own model space). */
export type ExportObject = { name: string; model: VoxModel; pose: { rows: Matrix3; translation: Vec3 } | null };
export type ExportFile = { name: string; data: string | Uint8Array<ArrayBuffer>; type: string };
type Face = { corners: Vec3[]; color: number };

const isFilled = (model: VoxModel, [x, y, z]: Vec3) =>
  x >= 0 && y >= 0 && z >= 0 && x < model.size[0] && y < model.size[1] && z < model.size[2] && model.voxels[voxelIndex(model.size, x, y, z)] !== EMPTY_VOXEL;

const colorAt = (model: VoxModel, [x, y, z]: Vec3) => model.voxels[voxelIndex(model.size, x, y, z)];

/**
 * Visible voxel faces as quads in model space (counter-clockwise from outside). With `merge`, coplanar
 * neighbours of one colour become one rectangle (greedy meshing), as MagicaVoxel's `io_obj merge`.
 */
export function voxelFaces(model: VoxModel, merge: boolean): Face[] {
  const faces: Face[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
    for (const side of [1, -1]) {
      for (let slice = 0; slice < model.size[axis]; slice++) {
        const [width, height] = [model.size[u], model.size[v]];
        const mask = new Int16Array(width * height);
        for (let b = 0; b < height; b++) {
          for (let a = 0; a < width; a++) {
            const cell: Vec3 = [0, 0, 0];
            cell[axis] = slice;
            cell[u] = a;
            cell[v] = b;
            const neighbor: Vec3 = [...cell];
            neighbor[axis] += side;
            if (isFilled(model, cell) && !isFilled(model, neighbor)) mask[a + b * width] = colorAt(model, cell);
          }
        }
        for (let b = 0; b < height; b++) {
          for (let a = 0; a < width; a++) {
            const color = mask[a + b * width];
            if (!color) continue;
            let w = 1;
            while (merge && a + w < width && mask[a + w + b * width] === color) w++;
            let h = 1;
            while (merge && b + h < height && Array.from({ length: w }, (_unused, step) => mask[a + step + (b + h) * width]).every((value) => value === color)) h++;
            for (let row = 0; row < h; row++) mask.fill(0, a + (b + row) * width, a + w + (b + row) * width);
            const plane = slice + (side > 0 ? 1 : 0);
            const corner = (du: number, dv: number): Vec3 => {
              const point: Vec3 = [0, 0, 0];
              point[axis] = plane;
              point[u] = a + du;
              point[v] = b + dv;
              return point;
            };
            const corners = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)];
            faces.push({ corners: side > 0 ? corners : corners.reverse(), color });
          }
        }
      }
    }
  }
  return faces;
}

/** Every filled cell's six faces, shrunk by `margin` toward its centre (MagicaVoxel `cube`). */
function cubeFaces(model: VoxModel, margin: number): Face[] {
  const faces: Face[] = [];
  const unit = createUnitModel();
  const shrink = (value: number) => value * (1 - margin) + margin / 2;
  model.voxels.forEach((color, index) => {
    if (color === EMPTY_VOXEL) return;
    const cell = cellOf(model.size, index);
    for (const face of voxelFaces(unit, false)) {
      faces.push({ color, corners: face.corners.map((corner): Vec3 => [cell[0] + shrink(corner[0]), cell[1] + shrink(corner[1]), cell[2] + shrink(corner[2])]) });
    }
  });
  return faces;
}

function createUnitModel(): VoxModel {
  return { size: [1, 1, 1], voxels: Uint8Array.of(1) };
}

/**
 * Smoothed surface for `mc`: naive surface nets over the occupancy grid (one vertex per boundary cell,
 * at the mean of its edge crossings; one quad per crossing edge), coloured by the adjacent voxel.
 */
export function smoothFaces(model: VoxModel): Face[] {
  const [sx, sy, sz] = model.size;
  const solid = (x: number, y: number, z: number) => isFilled(model, [x, y, z]);
  const vertexAt = new Map<number, Vec3>();
  const key = (x: number, y: number, z: number) => (x + 1) + (sx + 2) * ((y + 1) + (sy + 2) * (z + 1));
  for (let z = -1; z < sz; z++) {
    for (let y = -1; y < sy; y++) {
      for (let x = -1; x < sx; x++) {
        let crossings = 0;
        const sum: Vec3 = [0, 0, 0];
        for (let edge = 0; edge < 12; edge++) {
          const axis = Math.floor(edge / 4);
          const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
          const start: Vec3 = [0, 0, 0];
          start[u] = edge & 1;
          start[v] = (edge >> 1) & 1;
          const end: Vec3 = [...start];
          end[axis] = 1;
          if (solid(x + start[0], y + start[1], z + start[2]) === solid(x + end[0], y + end[1], z + end[2])) continue;
          crossings++;
          for (let k = 0; k < 3; k++) sum[k] += (start[k] + end[k]) / 2;
        }
        if (crossings) vertexAt.set(key(x, y, z), [x + 0.5 + sum[0] / crossings, y + 0.5 + sum[1] / crossings, z + 0.5 + sum[2] / crossings]);
      }
    }
  }
  const faces: Face[] = [];
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        if (!solid(x, y, z)) continue;
        for (let axis = 0; axis < 3; axis++) {
          for (const side of [1, -1]) {
            const next: Vec3 = [x, y, z];
            next[axis] += side;
            if (solid(...next)) continue;
            const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
            const plane = side > 0 ? [x, y, z][axis] : [x, y, z][axis] - 1;
            const vertex = (du: number, dv: number) => {
              const cell: Vec3 = [x, y, z];
              cell[axis] = plane;
              cell[u] -= du;
              cell[v] -= dv;
              return vertexAt.get(key(...cell));
            };
            const corners = [vertex(1, 1), vertex(0, 1), vertex(0, 0), vertex(1, 0)];
            if (corners.some((corner) => !corner)) continue;
            const ordered = corners.filter((corner): corner is Vec3 => corner !== undefined);
            faces.push({ color: colorAt(model, [x, y, z]), corners: side > 0 ? ordered : ordered.reverse() });
          }
        }
      }
    }
  }
  return faces;
}

/** Model-space point of `object` to the exported frame: pose, axis swap and scale. */
const placer = (object: ExportObject, options: MeshOptions) => {
  const pivot = modelPivot(object.model.size);
  return (point: Vec3): Vec3 => {
    const local: Vec3 = object.pose ? applyRows(object.pose.rows, [point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]]) : point;
    const world: Vec3 = object.pose ? [local[0] + object.pose.translation[0], local[1] + object.pose.translation[1], local[2] + object.pose.translation[2]] : local;
    const turned: Vec3 = options.axis === 'XZ-Y' ? [world[0], world[2], -world[1]] : world;
    return [turned[0] * options.scale, turned[1] * options.scale, turned[2] * options.scale];
  };
};

/** A pose with a mirror (an improper rotation) turns faces inside out, so their winding flips back. */
const isMirrored = (rows: Matrix3) =>
  rows[0] * (rows[4] * rows[8] - rows[5] * rows[7]) - rows[1] * (rows[3] * rows[8] - rows[5] * rows[6]) + rows[2] * (rows[3] * rows[7] - rows[4] * rows[6]) < 0;

const number = (value: number) => String(Math.round(value * 1e5) / 1e5);

function facesFor(format: MeshFormat, model: VoxModel, options: MeshOptions): Face[] {
  if (format === 'cube') return cubeFaces(model, options.cubeMargin);
  if (format === 'mc') return smoothFaces(model);
  return voxelFaces(model, options.merge);
}

/** The exported faces of every object, placed, wound as asked. */
function placedFaces(format: MeshFormat, objects: ExportObject[], options: MeshOptions) {
  return objects.map((object) => {
    const place = placer(object, options);
    // The Y-up swap (x, z, -y) is a proper rotation, so only `cw` and mirrored poses change the winding.
    const flip = options.clockwise !== Boolean(object.pose && isMirrored(object.pose.rows));
    return {
      name: object.name,
      faces: facesFor(format, object.model, options).map((face) => {
        const corners = face.corners.map(place);
        return { color: face.color, corners: flip ? corners.reverse() : corners };
      }),
    };
  });
}

/** OBJ + MTL using a 256×1 palette texture (`<base>.png`, written by the caller), like MagicaVoxel. */
function writeObj(base: string, objects: ReturnType<typeof placedFaces>): ExportFile[] {
  const lines = [`# Exportado pelo editor de voxels (MagicaVoxel obj)`, `mtllib ${base}.mtl`, 'usemtl palette'];
  for (let color = 1; color < 256; color++) lines.push(`vt ${number((color - 0.5) / 256)} 0.5`);
  let next = 1;
  for (const { name, faces } of objects) {
    lines.push(`o ${name.replace(/\s+/g, '_')}`);
    for (const { corners, color } of faces) {
      corners.forEach((corner) => lines.push(`v ${corner.map(number).join(' ')}`));
      lines.push(`f ${corners.map((_corner, index) => `${next + index}/${color}`).join(' ')}`);
      next += corners.length;
    }
  }
  const mtl = ['newmtl palette', 'Ka 0 0 0', 'Kd 1 1 1', 'Ks 0 0 0', 'illum 1', `map_Kd ${base}.png`].join('\n');
  return [
    { name: `${base}.obj`, data: `${lines.join('\n')}\n`, type: 'text/plain' },
    { name: `${base}.mtl`, data: `${mtl}\n`, type: 'text/plain' },
  ];
}

/** ASCII PLY with one colour per face (and per vertex, for viewers that only read those). */
function writePly(base: string, objects: ReturnType<typeof placedFaces>, palette: Uint8Array): ExportFile {
  const faces = objects.flatMap((object) => object.faces);
  const vertexCount = faces.reduce((total, face) => total + face.corners.length, 0);
  const header = ['ply', 'format ascii 1.0', `element vertex ${vertexCount}`, 'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue', `element face ${faces.length}`, 'property list uchar int vertex_indices', 'end_header'];
  const vertices = faces.flatMap(({ corners, color }) => corners.map((corner) => `${corner.map(number).join(' ')} ${paletteColor(palette, color).join(' ')}`));
  let next = 0;
  const indices = faces.map(({ corners }) => {
    const line = `${corners.length} ${corners.map((_corner, index) => next + index).join(' ')}`;
    next += corners.length;
    return line;
  });
  return { name: `${base}.ply`, data: `${[...header, ...vertices, ...indices].join('\n')}\n`, type: 'text/plain' };
}

/** MagicaVoxel `pcl`: one coloured point per voxel centre, as PLY. */
function writePointCloud(base: string, objects: ExportObject[], options: MeshOptions, palette: Uint8Array): ExportFile {
  const points = objects.flatMap((object) => {
    const place = placer(object, options);
    return [...object.model.voxels].flatMap((color, index) => {
      if (color === EMPTY_VOXEL) return [];
      const [x, y, z] = cellOf(object.model.size, index);
      return [`${place([x + 0.5, y + 0.5, z + 0.5]).map(number).join(' ')} ${paletteColor(palette, color).join(' ')}`];
    });
  });
  const header = ['ply', 'format ascii 1.0', `element vertex ${points.length}`, 'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue', 'end_header'];
  return { name: `${base}.ply`, data: `${[...header, ...points].join('\n')}\n`, type: 'text/plain' };
}

/** The files of a mesh export (OBJ also needs the palette PNG, which the caller renders). */
export function exportMesh(format: MeshFormat, base: string, objects: ExportObject[], palette: Uint8Array, options: MeshOptions = DEFAULT_MESH_OPTIONS[format]): ExportFile[] {
  if (format === 'pcl') return [writePointCloud(base, objects, options, palette)];
  const placed = placedFaces(format, objects, options);
  return format === 'obj' ? writeObj(base, placed) : [writePly(base, placed, palette)];
}
