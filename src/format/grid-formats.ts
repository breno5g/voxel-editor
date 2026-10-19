import { buildScene, createDefaultPalette } from './defaults.ts';
import { paletteFromColors } from './sprite.ts';
import { createModel, EMPTY_VOXEL, PALETTE_BYTES, paletteColor, voxelIndex } from './vox.ts';
import type { Vec3, VoxDocument, VoxModel } from './vox.ts';

/** A model and where its cell 0 sits in a shared grid (Qubicle matrices carry their own position). */
export type PlacedModel = { name: string; model: VoxModel; position: Vec3 };

const textDecoder = new TextDecoder();

function writer(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  return {
    bytes,
    u8: (value: number) => view.setUint8(offset++, value),
    u32: (value: number) => {
      view.setUint32(offset, value, true);
      offset += 4;
    },
    i32: (value: number) => {
      view.setInt32(offset, value, true);
      offset += 4;
    },
    raw: (data: Uint8Array) => {
      bytes.set(data, offset);
      offset += data.length;
    },
  };
}

function reader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const need = (count: number) => {
    if (offset + count > bytes.length) throw new Error('Arquivo truncado');
  };
  return {
    u8: () => (need(1), view.getUint8(offset++)),
    u32: () => {
      need(4);
      const value = view.getUint32(offset, true);
      offset += 4;
      return value;
    },
    i32: () => {
      need(4);
      const value = view.getInt32(offset, true);
      offset += 4;
      return value;
    },
    raw: (count: number) => {
      need(count);
      const value = bytes.subarray(offset, offset + count);
      offset += count;
      return value;
    },
  };
}

const checkSize = (size: Vec3) => {
  if (size.some((axis) => !Number.isInteger(axis) || axis < 1 || axis > 2048)) throw new Error(`Tamanho inválido ${size.join('×')}`);
};

/** A document holding `models` side by side on the ground, with `palette`. */
export function documentFromModels(models: PlacedModel[], palette: Uint8Array): VoxDocument {
  const nodes = buildScene(models.map(({ model }) => model.size));
  models.forEach(({ name, position, model }, index) => {
    const transform = nodes[2 + index * 2];
    if (transform.kind !== 'transform') return;
    transform.keys = [{ frame: 0, rotation: 4, translation: [position[0] + Math.floor(model.size[0] / 2), position[1] + Math.floor(model.size[1] / 2), position[2] + Math.floor(model.size[2] / 2)] }];
    if (name) transform.attrs.set('_name', name);
  });
  return { models: models.map(({ model }) => model), nodes, palette, layers: [], materials: new Map(), notes: [], meta: new Map(), extras: [] };
}

/** XRAW (MagicaVoxel's raw format): 8-bit indices over a 256-colour RGBA palette; index 0 is empty. */
export function encodeXraw(model: VoxModel, palette: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = writer(4 + 4 + 16 + model.voxels.length + PALETTE_BYTES);
  out.raw(new TextEncoder().encode('XRAW'));
  [0, 4, 8, 8].forEach(out.u8);
  model.size.forEach(out.u32);
  out.u32(256);
  out.raw(model.voxels);
  out.raw(Uint8Array.of(0, 0, 0, 0));
  out.raw(palette.subarray(0, PALETTE_BYTES - 4));
  return out.bytes;
}

export function decodeXraw(bytes: Uint8Array): VoxDocument {
  const input = reader(bytes);
  if (textDecoder.decode(input.raw(4)) !== 'XRAW') throw new Error('Não é um arquivo XRAW');
  const [type, channels, bits, indexBits] = [input.u8(), input.u8(), input.u8(), input.u8()];
  if (type !== 0 || bits !== 8 || channels < 3 || indexBits !== 8) throw new Error('XRAW suportado: índices de 8 bits e paleta RGB(A) de 8 bits');
  const size: Vec3 = [input.u32(), input.u32(), input.u32()];
  checkSize(size);
  const colors = input.u32();
  const model = createModel(size);
  model.voxels.set(input.raw(model.voxels.length));
  const palette = createDefaultPalette();
  input.raw(channels);
  for (let index = 1; index < Math.min(colors, 256); index++) {
    const entry = input.raw(channels);
    palette.set([entry[0], entry[1], entry[2], 255], (index - 1) * 4);
  }
  return documentFromModels([{ name: '', model, position: [0, 0, 0] }], palette);
}

/** Slab6 .vox: sizes, then columns x → y → z with z pointing down, 255 empty, and a 6-bit RGB palette. */
export function encodeSlab(model: VoxModel, palette: Uint8Array): Uint8Array<ArrayBuffer> {
  const [sx, sy, sz] = model.size;
  const out = writer(12 + model.voxels.length + 768);
  model.size.forEach(out.i32);
  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (let z = sz - 1; z >= 0; z--) {
        const color = model.voxels[voxelIndex(model.size, x, y, z)];
        out.u8(color === EMPTY_VOXEL ? 255 : color - 1);
      }
    }
  }
  for (let index = 1; index <= 256; index++) paletteColor(palette, Math.min(index, 255)).forEach((channel) => out.u8(channel >> 2));
  return out.bytes;
}

export function decodeSlab(bytes: Uint8Array): VoxDocument {
  const input = reader(bytes);
  const size: Vec3 = [input.i32(), input.i32(), input.i32()];
  checkSize(size);
  const [sx, sy, sz] = size;
  if (bytes.length !== 12 + sx * sy * sz + 768) throw new Error('Não é um .vox do Slab6');
  const model = createModel(size);
  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (let z = sz - 1; z >= 0; z--) {
        const value = input.u8();
        if (value !== 255) model.voxels[voxelIndex(size, x, y, z)] = value + 1;
      }
    }
  }
  const palette = createDefaultPalette();
  for (let index = 1; index <= 255; index++) {
    const [red, green, blue] = input.raw(3);
    palette.set([(red << 2) | (red >> 4), (green << 2) | (green >> 4), (blue << 2) | (blue >> 4), 255], (index - 1) * 4);
  }
  return documentFromModels([{ name: '', model, position: [0, 0, 0] }], palette);
}

/** Qubicle cell of a model cell: Qubicle is Y up and right-handed, so its z runs toward the viewer (MagicaVoxel's -y). */
const toQubicle = ([x, y, z]: Vec3, [, sy]: Vec3): Vec3 => [x, z, sy - 1 - y];

/** Qubicle .qb: one uncompressed RGBA matrix per model, alpha 0 empty. */
export function encodeQb(models: PlacedModel[], palette: Uint8Array): Uint8Array<ArrayBuffer> {
  const names = models.map(({ name }, index) => new TextEncoder().encode((name || `obj${index}`).slice(0, 255)));
  const length = 24 + models.reduce((total, { model }, index) => total + 1 + names[index].length + 24 + model.voxels.length * 4, 0);
  const out = writer(length);
  [0x00000101, 0, 1, 0, 1, models.length].forEach(out.u32);
  models.forEach(({ model, position }, index) => {
    const [sx, sy, sz] = model.size;
    out.u8(names[index].length);
    out.raw(names[index]);
    [sx, sz, sy].forEach(out.u32);
    [position[0], position[2], -(position[1] + sy)].forEach(out.i32);
    const cells = new Uint8Array(model.voxels.length * 4);
    model.voxels.forEach((color, cell) => {
      if (color === EMPTY_VOXEL) return;
      const [x, y, z] = toQubicle([cell % sx, Math.floor(cell / sx) % sy, Math.floor(cell / (sx * sy))], model.size);
      cells.set([...paletteColor(palette, color), 255], (x + sx * (y + sz * z)) * 4);
    });
    out.raw(cells);
  });
  return out.bytes;
}

const CODE_FLAG = 2;
const NEXT_SLICE_FLAG = 6;

/** Qubicle .qb (compressed or not, RGBA or BGRA): matrices become models, colours the nearest of a palette built from them. */
export function decodeQb(bytes: Uint8Array): VoxDocument {
  const input = reader(bytes);
  input.u32();
  const bgra = input.u32() === 1;
  const rightHanded = input.u32() === 1;
  const compressed = input.u32() === 1;
  input.u32();
  const count = input.u32();
  if (count > 1024) throw new Error('Matrizes demais no .qb');
  const matrices = Array.from({ length: count }, () => {
    const name = textDecoder.decode(input.raw(input.u8()));
    const size: Vec3 = [input.u32(), input.u32(), input.u32()];
    checkSize(size);
    const position: Vec3 = [input.i32(), input.i32(), input.i32()];
    const [sx, sy, sz] = size;
    const colors = new Uint32Array(sx * sy * sz);
    if (!compressed) {
      for (let index = 0; index < colors.length; index++) colors[index] = input.u32();
    } else {
      for (let z = 0; z < sz; z++) {
        let index = 0;
        for (let data = input.u32(); data !== NEXT_SLICE_FLAG; data = input.u32()) {
          const [repeat, value] = data === CODE_FLAG ? [input.u32(), input.u32()] : [1, data];
          for (let step = 0; step < repeat && index < sx * sy; step++, index++) colors[z * sx * sy + index] = value;
        }
      }
    }
    return { name, size, position, colors };
  });
  const rgbOf = (value: number): Vec3 => (bgra ? [(value >> 16) & 255, (value >> 8) & 255, value & 255] : [value & 255, (value >> 8) & 255, (value >> 16) & 255]);
  const { palette, indexOf } = paletteFromColors(matrices.flatMap(({ colors }) => [...colors].filter((value) => value >>> 24 !== 0).map(rgbOf)));
  const models = matrices.map(({ name, size: [qx, qy, qz], position, colors }): PlacedModel => {
    const model = createModel([qx, qz, qy]);
    colors.forEach((value, cell) => {
      if (value >>> 24 === 0) return;
      const [x, y, z] = [cell % qx, Math.floor(cell / qx) % qy, Math.floor(cell / (qx * qy))];
      const mvY = rightHanded ? qz - 1 - z : z;
      model.voxels[voxelIndex(model.size, x, mvY, y)] = indexOf(rgbOf(value));
    });
    return { name, model, position: [position[0], rightHanded ? -(position[2] + qz) : position[2], position[1]] };
  });
  return documentFromModels(models, palette);
}
