import { applyRows, transposeRows } from '../format/rotation.ts';
import { cloneModel, modelPivot } from '../format/vox.ts';
import type { GroupNode, SceneNode, Vec3, VoxDocument, VoxModel } from '../format/vox.ts';
import { evaluateTransform, isLooping } from './keyframes.ts';
import { compose, IDENTITY_POSE, ROOT_ID } from './scene-graph.ts';
import type { Instance, Pose } from './scene-graph.ts';

/** World-space box of voxel corners: cells span [low, high). */
export type Bounds = { low: Vec3; high: Vec3 };

/** Parent of every node that some transform or group points to. */
export function parentMap(scene: VoxDocument): Map<number, number> {
  const parents = new Map<number, number>();
  scene.nodes.forEach((node, id) => {
    if (node.kind === 'transform') parents.set(node.child, id);
    if (node.kind === 'group') node.children.forEach((child) => parents.set(child, id));
  });
  return parents;
}

/** Ancestors of `nodeId`, nearest first; stops on cycles a malformed file could contain. */
export function ancestorsOf(parents: Map<number, number>, nodeId: number): number[] {
  const ancestors: number[] = [];
  for (let id = parents.get(nodeId); id !== undefined && !ancestors.includes(id) && id !== nodeId; id = parents.get(id)) ancestors.push(id);
  return ancestors;
}

export const isUnder = (parents: Map<number, number>, nodeId: number, ancestorId: number) => nodeId === ancestorId || ancestorsOf(parents, nodeId).includes(ancestorId);

/** World pose of the frame `nodeId`'s own transform is expressed in (every transform above it, composed). */
export function parentPose(scene: VoxDocument, parents: Map<number, number>, nodeId: number, frame: number): Pose {
  return ancestorsOf(parents, nodeId)
    .reverse()
    .reduce((pose, id) => {
      const node = scene.nodes[id];
      return node?.kind === 'transform' ? compose(pose, evaluateTransform(node.keys, frame, isLooping(node.attrs))) : pose;
    }, IDENTITY_POSE);
}

/** A world-space offset expressed in the frame of `pose` (rotations are signed permutations, so the inverse is the transpose). */
export const toLocal = (pose: Pose, worldDelta: Vec3): Vec3 => applyRows(transposeRows(pose.rows), worldDelta);

/** The transform among `transformId` and its ancestors that sits directly in group `groupId`, if any. */
export function childOfGroup(scene: VoxDocument, parents: Map<number, number>, transformId: number, groupId: number): number | null {
  return [transformId, ...ancestorsOf(parents, transformId)].find((id) => scene.nodes[id]?.kind === 'transform' && parents.get(id) === groupId) ?? null;
}

export function groupNode(scene: VoxDocument, groupId: number): GroupNode | undefined {
  const node = scene.nodes[groupId];
  return node?.kind === 'group' ? node : undefined;
}

/** The group a transform's child points to, when the transform holds a group rather than a shape. */
export function groupOf(scene: VoxDocument, transformId: number): number | null {
  const node = scene.nodes[transformId];
  return node?.kind === 'transform' && scene.nodes[node.child]?.kind === 'group' ? node.child : null;
}

/** The group under the root transform: the outermost level of the world editor. */
export function rootLevel(scene: VoxDocument): number | null {
  const root = scene.nodes[ROOT_ID];
  return root?.kind === 'transform' && scene.nodes[root.child]?.kind === 'group' ? root.child : null;
}

/** Instances drawn by `nodeId` or anything below it. */
export const instancesUnder = (instances: Instance[], parents: Map<number, number>, nodeId: number) =>
  instances.filter((instance) => isUnder(parents, instance.transformId, nodeId));

/** World box of one instance's model volume. */
export function instanceBounds({ pose, model }: Instance, models: VoxModel[]): Bounds {
  const { size } = models[model];
  const pivot = modelPivot(size);
  const low: Vec3 = [...pose.translation];
  const high: Vec3 = [...pose.translation];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const weight = pose.rows[row * 3 + column];
      const ends = [-weight * pivot[column], weight * (size[column] - pivot[column])];
      low[row] += Math.min(...ends);
      high[row] += Math.max(...ends);
    }
  }
  return { low, high };
}

export function unionBounds(boxes: Bounds[]): Bounds | null {
  if (boxes.length === 0) return null;
  const low: Vec3 = [Infinity, Infinity, Infinity];
  const high: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], box.low[axis]);
      high[axis] = Math.max(high[axis], box.high[axis]);
    }
  }
  return { low, high };
}

/**
 * Copies the subtree under `rootId` as new nodes numbered from `scene.nodes.length` (the copy of
 * `rootId` first). Models are deep-copied, numbered from `scene.models.length`, or shared when
 * `shareModels` (MagicaVoxel references: every copy shows the same voxels).
 */
export function cloneSubtree(scene: VoxDocument, rootId: number, shareModels: boolean): { nodes: SceneNode[]; models: VoxModel[] } {
  const nodes: SceneNode[] = [];
  const models: VoxModel[] = [];
  const modelCopies = new Map<number, number>();
  const modelOf = (id: number) => {
    if (shareModels) return id;
    const known = modelCopies.get(id);
    if (known !== undefined) return known;
    modelCopies.set(id, scene.models.length + models.length);
    models.push(cloneModel(scene.models[id]));
    return scene.models.length + models.length - 1;
  };
  const visit = (id: number, path: Set<number>): number => {
    const node = scene.nodes[id];
    const slot = nodes.length;
    nodes.push(node);
    if (path.has(id)) throw new Error(`O nó ${id} contém a si mesmo`);
    const inner = new Set(path).add(id);
    if (node.kind === 'transform') {
      nodes[slot] = { ...node, attrs: new Map(node.attrs), keys: node.keys.map((key) => ({ ...key })), child: visit(node.child, inner) };
    }
    if (node.kind === 'group') nodes[slot] = { ...node, attrs: new Map(node.attrs), children: node.children.map((child) => visit(child, inner)) };
    if (node.kind === 'shape') nodes[slot] = { ...node, attrs: new Map(node.attrs), keys: node.keys.map((key) => ({ ...key, model: modelOf(key.model) })) };
    return scene.nodes.length + slot;
  };
  visit(rootId, new Set());
  return { nodes, models };
}
