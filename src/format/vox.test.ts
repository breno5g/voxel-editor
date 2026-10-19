import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDocument } from './defaults.ts';
import { createModel, modelPivot, voxelIndex } from './vox.ts';
import type { VoxDocument } from './vox.ts';
import { parseVox } from './vox-reader.ts';
import { writeVox } from './vox-writer.ts';

/** MagicaVoxel's bundled samples; not committed, so these tests skip when the folder is absent. */
const SAMPLES = new URL('../../MagicaVoxel-0.99.7.2-win64/vox/', import.meta.url);
const sampleFiles = existsSync(SAMPLES)
  ? [...readdirSync(SAMPLES), ...readdirSync(new URL('anim/', SAMPLES)).map((name) => `anim/${name}`)].filter((name) => name.endsWith('.vox'))
  : [];

function animatedDocument(): VoxDocument {
  const document = createDocument([4, 3, 2]);
  document.models[0].voxels[voxelIndex([4, 3, 2], 3, 2, 1)] = 42;
  document.models.push(createModel([2, 2, 2]));
  document.models[1].voxels[0] = 9;
  const [, , transform, shape] = document.nodes;
  if (transform.kind !== 'transform' || shape.kind !== 'shape') throw new Error('unexpected default scene');
  transform.attrs.set('_name', 'hero').set('_loop', '1');
  transform.keys = [
    { frame: 0, translation: [0, 0, 1], rotation: 4 },
    { frame: 12, translation: [-8, 3, 1], rotation: 17 },
  ];
  shape.keys = [{ frame: 0, model: 0 }, { frame: 6, model: 1 }];
  document.meta.set('_anim_range', '0 24');
  document.layers.push({ id: 0, attrs: new Map([['_name', 'base']]) });
  document.extras.push({ id: 'rCAM', content: Uint8Array.of(1, 2, 3, 4), children: new Uint8Array(0) });
  document.palette[0] = 200;
  return document;
}

describe('writeVox -> parseVox', () => {
  it('round-trips scene, animation keys, palette, layers, meta and unknown chunks', () => {
    const document = animatedDocument();
    expect(parseVox(writeVox(document))).toEqual(document);
  });

  it('drops MagicaVoxel unrecorded edit state, since this editor always records keys', () => {
    const document = animatedDocument();
    document.nodes[2].attrs.set('_frm_t', '1 2 3');
    expect(parseVox(writeVox(document)).nodes[2].attrs.has('_frm_t')).toBe(false);
  });

  it('drops nodes unlinked from the scene and keeps ids contiguous', () => {
    const document = animatedDocument();
    const group = document.nodes[1];
    if (group.kind === 'group') group.children = [];
    const parsed = parseVox(writeVox(document));
    expect(parsed.nodes.map((node) => node.kind)).toEqual(['transform', 'group']);
    expect(parsed.models).toHaveLength(0);
  });

  it('drops models no shape references and renumbers the rest', () => {
    const document = animatedDocument();
    document.models.splice(1, 0, createModel([1, 1, 1]));
    const shape = document.nodes[3];
    if (shape.kind === 'shape') shape.keys[1].model = 2;
    const parsed = parseVox(writeVox(document));
    expect(parsed.models).toHaveLength(2);
    expect(parsed.nodes[3]).toMatchObject({ keys: [{ model: 0 }, { model: 1 }] });
  });
});

describe('parseVox', () => {
  it('rejects files that are not .vox', () => {
    expect(() => parseVox(new TextEncoder().encode('not a voxel file at all'))).toThrow('Not a MagicaVoxel');
  });

  it('rejects truncated files', () => {
    expect(() => parseVox(writeVox(animatedDocument()).slice(0, 60))).toThrow();
  });
});


describe.skipIf(sampleFiles.length === 0)('MagicaVoxel sample files', () => {
  it.each(sampleFiles)('%s survives a write/read round trip', (name) => {
    const original = readFileSync(new URL(name, SAMPLES));
    const parsed = parseVox(original);
    const reparsed = parseVox(writeVox(parsed));
    const recordedNodes = (document: VoxDocument) =>
      document.nodes.map((node) => ({ ...node, attrs: new Map([...node.attrs].filter(([key]) => !key.startsWith('_frm_'))) }));
    expect(recordedNodes(reparsed)).toEqual(recordedNodes(parsed));
    expect(reparsed.models.map((model) => model.size)).toEqual(parsed.models.map((model) => model.size));
    expect(reparsed.models.every((model, index) => Buffer.from(model.voxels).equals(parsed.models[index].voxels))).toBe(true);
    expect(reparsed.palette).toEqual(parsed.palette);
    expect(reparsed.extras).toEqual(parsed.extras);
  });

  it('places models with an integer pivot floor(size / 2), so odd-height samples rest on z = 0', () => {
    for (const name of ['anim/deer.vox', 'castle.vox', 'menger.vox', 'teapot.vox']) {
      const parsed = parseVox(readFileSync(new URL(name, SAMPLES)));
      const [, , object, shape] = parsed.nodes;
      if (object.kind !== 'transform' || shape.kind !== 'shape') throw new Error(`${name}: unexpected scene layout`);
      const height = parsed.models[shape.keys[0].model].size[2];
      expect(height % 2, name).toBe(1);
      expect(object.keys[0].translation[2] - modelPivot(parsed.models[shape.keys[0].model].size)[2], name).toBe(0);
    }
  });

  it('reads the undocumented animation keys of T-Rex-m.vox', () => {
    const parsed = parseVox(readFileSync(new URL('anim/T-Rex-m.vox', SAMPLES)));
    expect(parsed.meta.get('_anim_range')).toBe('0 30');
    expect(parsed.nodes[2]).toMatchObject({ kind: 'transform', keys: [{ frame: 0 }, { frame: 11 }, { frame: 19, rotation: 17 }] });
    expect(parsed.nodes[3]).toMatchObject({ kind: 'shape', keys: Array.from({ length: 8 }, (_unused, frame) => ({ frame })) });
  });
});
