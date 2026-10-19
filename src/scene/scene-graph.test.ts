import { describe, expect, it } from 'vitest';
import { buildScene, createDocument } from '../format/defaults.ts';
import { createModel } from '../format/vox.ts';
import type { TransformNode, VoxDocument } from '../format/vox.ts';
import { evaluateScene } from './scene-graph.ts';

/** Root -> group -> [transform 2 -> shape 3, transform 4 -> shape 5]. */
function twoObjects(): VoxDocument {
  const document = createDocument();
  document.models.push(createModel([4, 4, 4]));
  document.nodes = buildScene([document.models[0].size, document.models[1].size]);
  return document;
}

function transform(document: VoxDocument, id: number): TransformNode {
  const node = document.nodes[id];
  if (node.kind !== 'transform') throw new Error(`node ${id} is not a transform`);
  return node;
}

describe('evaluateScene', () => {
  it('yields one instance per shape with its owning transform', () => {
    const instances = evaluateScene(twoObjects(), 0);
    expect(instances.map(({ transformId, shapeId, model }) => [transformId, shapeId, model])).toEqual([[2, 3, 0], [4, 5, 1]]);
  });

  it('composes parent rotation and translation into child poses', () => {
    const document = twoObjects();
    // Root rotated 90° about Z (x -> y, y -> -x): rows [[0,-1,0],[1,0,0],[0,0,1]] = packed 0b0010001 = 17.
    transform(document, 0).keys = [{ frame: 0, translation: [100, 0, 0], rotation: 17 }];
    transform(document, 2).keys = [{ frame: 0, translation: [5, 0, 0], rotation: 4 }];
    const [first] = evaluateScene(document, 0);
    expect(first.pose.translation).toEqual([100, 5, 0]);
  });

  it('skips hidden transforms and hidden layers', () => {
    const document = twoObjects();
    transform(document, 2).attrs.set('_hidden', '1');
    transform(document, 4).layer = 3;
    document.layers.push({ id: 3, attrs: new Map([['_hidden', '1']]) });
    expect(evaluateScene(document, 0)).toEqual([]);
  });

  it('instances a shape once per transform that references it', () => {
    const document = twoObjects();
    transform(document, 4).child = 3;
    expect(evaluateScene(document, 0).map((instance) => instance.shapeId)).toEqual([3, 3]);
  });

  it('terminates on cyclic graphs from malformed files', () => {
    const document = twoObjects();
    transform(document, 2).child = 1;
    expect(() => evaluateScene(document, 0)).not.toThrow();
  });
});
