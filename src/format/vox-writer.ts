import { EMPTY_VOXEL, IDENTITY_ROTATION, RESERVED_ID, VOX_MAGIC, VOX_VERSION } from './vox.ts';
import type { Dict, SceneNode, TransformKey, VoxDocument, VoxModel } from './vox.ts';

/** Editor state MagicaVoxel keeps for edits made off a keyframe; this editor always records keys. */
const UNRECORDED_ATTRS = new Set(['_frm_t', '_frm_r', '_frm_id']);

const textEncoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function int32s(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt32(index * 4, value, true));
  return bytes;
}

function encodeString(value: string): Uint8Array {
  const bytes = textEncoder.encode(value);
  return concat(int32s([bytes.length]), bytes);
}

function encodeDict(entries: Dict): Uint8Array {
  return concat(int32s([entries.size]), ...[...entries].flatMap(([key, value]) => [encodeString(key), encodeString(value)]));
}

function chunk(id: string, content: Uint8Array, children: Uint8Array = new Uint8Array(0)): Uint8Array {
  return concat(textEncoder.encode(id), int32s([content.length, children.length]), content, children);
}

function encodeVoxels(model: VoxModel): Uint8Array {
  const [sx, sy, sz] = model.size;
  const count = model.voxels.reduce((total, color) => total + (color === EMPTY_VOXEL ? 0 : 1), 0);
  const bytes = concat(int32s([count]), new Uint8Array(count * 4));
  let offset = 4;
  let index = 0;
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++, index++) {
        const color = model.voxels[index];
        if (color === EMPTY_VOXEL) continue;
        bytes[offset++] = x;
        bytes[offset++] = y;
        bytes[offset++] = z;
        bytes[offset++] = color;
      }
    }
  }
  return bytes;
}

/** MagicaVoxel omits `_f` on static single-key nodes, `_r` when identity and `_t` when zero. */
function frameDict(frame: number, keyCount: number, extra: [string, string][] = []): Dict {
  const frameEntry: [string, string][] = keyCount > 1 || frame !== 0 ? [['_f', String(frame)]] : [];
  return new Map([...frameEntry, ...extra]);
}

function transformKeyDict(key: TransformKey, keyCount: number): Dict {
  const extra: [string, string][] = [];
  if (key.rotation !== IDENTITY_ROTATION) extra.push(['_r', String(key.rotation)]);
  if (key.translation.some((axis) => axis !== 0)) extra.push(['_t', key.translation.join(' ')]);
  return frameDict(key.frame, keyCount, extra);
}

function persistentAttrs(attrs: Dict): Dict {
  return new Map([...attrs].filter(([key]) => !UNRECORDED_ATTRS.has(key)));
}

type Renumbering = { nodes: Map<number, number>; models: Map<number, number> };

function encodeNode(node: SceneNode, id: number, ids: Renumbering): Uint8Array {
  const header = concat(int32s([id]), encodeDict(persistentAttrs(node.attrs)));
  if (node.kind === 'transform') {
    const frames = node.keys.map((key) => encodeDict(transformKeyDict(key, node.keys.length)));
    const child = ids.nodes.get(node.child) ?? node.child;
    return chunk('nTRN', concat(header, int32s([child, RESERVED_ID, node.layer, node.keys.length]), ...frames));
  }
  if (node.kind === 'group') {
    const children = node.children.flatMap((child) => ids.nodes.get(child) ?? []);
    return chunk('nGRP', concat(header, int32s([children.length, ...children])));
  }
  const models = node.keys.map((key) =>
    concat(int32s([ids.models.get(key.model) ?? 0]), encodeDict(frameDict(key.frame, node.keys.length))),
  );
  return chunk('nSHP', concat(header, int32s([node.keys.length]), ...models));
}

/** Node ids reachable from the root, in original order: unlinked (deleted) objects are dropped. */
function reachableNodeIds(document: VoxDocument): number[] {
  const reached = new Set<number>();
  const visit = (id: number) => {
    const node = document.nodes[id];
    if (!node || reached.has(id)) return;
    reached.add(id);
    if (node.kind === 'transform') visit(node.child);
    if (node.kind === 'group') node.children.forEach(visit);
  };
  visit(0);
  return [...reached].sort((a, b) => a - b);
}

/** Drops models no reachable shape references (e.g. after deleting frames) and renumbers the rest. */
function referencedModelIds(document: VoxDocument, nodeIds: number[]): number[] {
  const referenced = nodeIds.flatMap((id) => {
    const node = document.nodes[id];
    return node.kind === 'shape' ? node.keys.map((key) => key.model) : [];
  });
  return [...new Set(referenced)].filter((model) => document.models[model]).sort((a, b) => a - b);
}

const renumber = (ids: number[]) => new Map(ids.map((id, index) => [id, index]));

export function writeVox(document: VoxDocument): Uint8Array<ArrayBuffer> {
  const nodeIds = reachableNodeIds(document);
  const modelIds = referencedModelIds(document, nodeIds);
  const ids: Renumbering = { nodes: renumber(nodeIds), models: renumber(modelIds) };
  const children = [
    ...(document.meta.size > 0 ? [chunk('META', encodeDict(document.meta))] : []),
    ...modelIds.map((id) => document.models[id]).flatMap((model) => [chunk('SIZE', int32s(model.size)), chunk('XYZI', encodeVoxels(model))]),
    ...nodeIds.map((id, index) => encodeNode(document.nodes[id], index, ids)),
    ...document.layers.map((layer) => chunk('LAYR', concat(int32s([layer.id]), encodeDict(layer.attrs), int32s([RESERVED_ID])))),
    chunk('RGBA', document.palette),
    ...[...document.materials].sort(([a], [b]) => a - b).map(([id, attrs]) => chunk('MATL', concat(int32s([id]), encodeDict(attrs)))),
    ...document.renderObjects.map((attrs) => chunk('rOBJ', encodeDict(attrs))),
    ...[...document.cameras].sort(([a], [b]) => a - b).map(([id, attrs]) => chunk('rCAM', concat(int32s([id]), encodeDict(attrs)))),
    ...(document.notes.length > 0 ? [chunk('NOTE', concat(int32s([document.notes.length]), ...document.notes.map(encodeString)))] : []),
    ...document.extras.map((extra) => chunk(extra.id, extra.content, extra.children)),
  ];
  return concat(textEncoder.encode(VOX_MAGIC), int32s([VOX_VERSION]), chunk('MAIN', new Uint8Array(0), concat(...children)));
}
