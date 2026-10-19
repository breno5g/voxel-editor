import { buildScene, createDefaultPalette } from './defaults.ts';
import { normalizeRotation } from './rotation.ts';
import { createModel, IDENTITY_ROTATION, MAX_MODEL_SIZE, PALETTE_BYTES, VOX_MAGIC, voxelIndex } from './vox.ts';
import type { Dict, SceneNode, TransformKey, Vec3, VoxDocument } from './vox.ts';

type Chunk = { id: string; content: Uint8Array; children: Uint8Array };
type Cursor = ReturnType<typeof createCursor>;

const textDecoder = new TextDecoder();

const byFrame = (a: { frame: number }, b: { frame: number }) => a.frame - b.frame;

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function* readChunks(bytes: Uint8Array): Generator<Chunk> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('Truncated chunk header');
    const contentSize = view.getInt32(offset + 4, true);
    const childrenSize = view.getInt32(offset + 8, true);
    const contentStart = offset + 12;
    const childrenStart = contentStart + contentSize;
    const end = childrenStart + childrenSize;
    if (contentSize < 0 || childrenSize < 0 || end > bytes.length) throw new Error('Chunk exceeds file bounds');
    yield {
      id: ascii(bytes.subarray(offset, offset + 4)),
      content: bytes.subarray(contentStart, childrenStart),
      children: bytes.subarray(childrenStart, end),
    };
    offset = end;
  }
}

function createCursor(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const int32 = () => {
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  };
  const string = () => {
    const length = int32();
    if (length < 0 || offset + length > bytes.length) throw new Error('String exceeds chunk bounds');
    const value = textDecoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  };
  /** A Map, not an object: keys come from the file and must not reach Object.prototype. */
  const dict = (): Dict => {
    const entries: Dict = new Map();
    for (let count = int32(); count > 0; count--) entries.set(string(), string());
    return entries;
  };
  return { int32, string, dict };
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseVec3(value: string | undefined): Vec3 {
  const [x = 0, y = 0, z = 0] = (value ?? '').trim().split(/\s+/).map((part) => toInt(part, 0));
  return [x, y, z];
}

/** `_f` is absent only on single-key (static) nodes; frame 0 is the normalized form. */
function parseTransformKey(frame: Dict): TransformKey {
  return {
    frame: toInt(frame.get('_f'), 0),
    translation: parseVec3(frame.get('_t')),
    rotation: normalizeRotation(toInt(frame.get('_r'), IDENTITY_ROTATION)),
  };
}

function readTransform(cursor: Cursor, attrs: Dict): SceneNode {
  const child = cursor.int32();
  cursor.int32();
  const layer = cursor.int32();
  const frameCount = cursor.int32();
  if (frameCount < 1) throw new Error('Transform node without frames');
  const keys = Array.from({ length: frameCount }, () => parseTransformKey(cursor.dict()));
  return { kind: 'transform', attrs, child, layer, keys: keys.sort(byFrame) };
}

function readGroup(cursor: Cursor, attrs: Dict): SceneNode {
  return { kind: 'group', attrs, children: Array.from({ length: cursor.int32() }, () => cursor.int32()) };
}

function readShape(cursor: Cursor, attrs: Dict): SceneNode {
  const keys = Array.from({ length: cursor.int32() }, () => {
    const model = cursor.int32();
    return { frame: toInt(cursor.dict().get('_f'), 0), model };
  });
  if (keys.length === 0) throw new Error('Shape node without models');
  return { kind: 'shape', attrs, keys: keys.sort(byFrame) };
}

const NODE_READERS = new Map([
  ['nTRN', readTransform],
  ['nGRP', readGroup],
  ['nSHP', readShape],
]);

function denseNodes(nodes: Map<number, SceneNode>): SceneNode[] {
  return Array.from({ length: nodes.size }, (_unused, id) => {
    const node = nodes.get(id);
    if (!node) throw new Error(`Scene node ids are not contiguous: missing ${id}`);
    return node;
  });
}

function validateModelReferences(document: VoxDocument): void {
  for (const node of document.nodes) {
    if (node.kind !== 'shape') continue;
    const missing = node.keys.find((key) => !document.models[key.model]);
    if (missing) throw new Error(`Shape node references missing model ${missing.model}`);
  }
}

/** Parses MagicaVoxel .vox (v150 model-only files and v200 scenes with animation). */
export function parseVox(input: Uint8Array): VoxDocument {
  // A plain view, so `slice` copies even when given a Node Buffer (whose `slice` aliases memory).
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 20 || ascii(bytes.subarray(0, 4)) !== VOX_MAGIC) throw new Error('Not a MagicaVoxel .vox file');
  const [main] = readChunks(bytes.subarray(8));
  if (main?.id !== 'MAIN') throw new Error('Missing MAIN chunk');

  const document: VoxDocument = { models: [], nodes: [], palette: createDefaultPalette(), layers: [], materials: new Map(), notes: [], cameras: new Map(), renderObjects: [], meta: new Map(), extras: [] };
  const nodes = new Map<number, SceneNode>();
  let pendingSize: Vec3 | null = null;

  const readSize = (content: Uint8Array) => {
    const cursor = createCursor(content);
    const size: Vec3 = [cursor.int32(), cursor.int32(), cursor.int32()];
    if (size.some((axis) => axis < 1 || axis > MAX_MODEL_SIZE)) throw new Error(`Invalid model size ${size.join('x')}`);
    pendingSize = size;
  };

  const readVoxels = (content: Uint8Array) => {
    if (!pendingSize) throw new Error('XYZI chunk without a preceding SIZE');
    const model = createModel(pendingSize);
    const [sx, sy, sz] = model.size;
    const count = createCursor(content).int32();
    if (count < 0 || 4 + count * 4 > content.length) throw new Error('XYZI voxel count exceeds chunk');
    for (let offset = 4; offset < 4 + count * 4; offset += 4) {
      const [x, y, z, color] = content.subarray(offset, offset + 4);
      if (x < sx && y < sy && z < sz) model.voxels[voxelIndex(model.size, x, y, z)] = color;
    }
    document.models.push(model);
    pendingSize = null;
  };

  const chunkReaders = new Map<string, (content: Uint8Array) => void>([
    ['SIZE', readSize],
    ['XYZI', readVoxels],
    ['LAYR', (content) => {
      const cursor = createCursor(content);
      document.layers.push({ id: cursor.int32(), attrs: cursor.dict() });
    }],
    ['RGBA', (content) => {
      if (content.length < PALETTE_BYTES) throw new Error('Truncated RGBA palette');
      document.palette = content.slice(0, PALETTE_BYTES);
    }],
    ['META', (content) => {
      document.meta = createCursor(content).dict();
    }],
    ['MATL', (content) => {
      const cursor = createCursor(content);
      document.materials.set(cursor.int32(), cursor.dict());
    }],
    ['rOBJ', (content) => {
      document.renderObjects.push(createCursor(content).dict());
    }],
    ['rCAM', (content) => {
      const cursor = createCursor(content);
      document.cameras.set(cursor.int32(), cursor.dict());
    }],
    ['NOTE', (content) => {
      const cursor = createCursor(content);
      document.notes = Array.from({ length: Math.max(cursor.int32(), 0) }, () => cursor.string());
    }],
    ['PACK', () => undefined],
  ]);

  for (const chunk of readChunks(main.children)) {
    const readNode = NODE_READERS.get(chunk.id);
    if (readNode) {
      const cursor = createCursor(chunk.content);
      const id = cursor.int32();
      if (nodes.has(id)) throw new Error(`Duplicate scene node id ${id}`);
      nodes.set(id, readNode(cursor, cursor.dict()));
      continue;
    }
    const readChunk = chunkReaders.get(chunk.id);
    if (readChunk) {
      readChunk(chunk.content);
      continue;
    }
    document.extras.push({ id: chunk.id, content: chunk.content.slice(), children: chunk.children.slice() });
  }

  document.nodes = nodes.size > 0 ? denseNodes(nodes) : buildScene(document.models.map((model) => model.size));
  validateModelReferences(document);
  return document;
}
