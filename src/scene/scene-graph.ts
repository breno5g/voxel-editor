import { applyRows, multiplyRows, rotationRows } from '../format/rotation.ts';
import type { Dict, GroupNode, Matrix3, Vec3, VoxDocument } from '../format/vox.ts';
import { evaluateShape, evaluateTransform, isLooping } from './keyframes.ts';
import type { TransformValue } from './keyframes.ts';

export type Pose = { rows: Matrix3; translation: Vec3 };
export type Instance = { transformId: number; shapeId: number; model: number; pose: Pose };
/** An editable object: a transform whose child is a shape. Listed even when hidden. */
export type SceneObject = { transformId: number; shapeId: number; hidden: boolean };

export const ROOT_ID = 0;
export const IDENTITY_POSE: Pose = { rows: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] };

export const isHidden = (attrs: Dict) => attrs.get('_hidden') === '1';

const hiddenLayerIds = (scene: VoxDocument) => new Set(scene.layers.filter((layer) => isHidden(layer.attrs)).map((layer) => layer.id));

/** World pose of a child: rotation then translation, in the parent's frame. */
export function compose(parent: Pose, local: TransformValue): Pose {
  const [x, y, z] = applyRows(parent.rows, local.translation);
  const [px, py, pz] = parent.translation;
  return { rows: multiplyRows(parent.rows, rotationRows(local.rotation)), translation: [x + px, y + py, z + pz] };
}

/** Local time: only `transformId` and what is under it follow the frame; everything else shows `restFrame`. */
export type LocalTime = { transformId: number; restFrame: number };

/** Flattens the scene graph at `frame` into drawable model instances with world poses. */
export function evaluateScene(scene: VoxDocument, frame: number, local: LocalTime | null = null): Instance[] {
  const hiddenLayers = hiddenLayerIds(scene);
  const instances: Instance[] = [];
  const path = new Set<number>();

  const visit = (nodeId: number, pose: Pose, transformId: number, timed: boolean): void => {
    const node = scene.nodes[nodeId];
    if (!node || path.has(nodeId)) return;
    path.add(nodeId);
    const inside = timed || local?.transformId === nodeId;
    const at = local === null || inside ? frame : local.restFrame;
    if (node.kind === 'transform' && !isHidden(node.attrs) && !hiddenLayers.has(node.layer)) {
      visit(node.child, compose(pose, evaluateTransform(node.keys, at, isLooping(node.attrs))), nodeId, inside);
    }
    if (node.kind === 'group') node.children.forEach((child) => visit(child, pose, transformId, inside));
    if (node.kind === 'shape') {
      const model = evaluateShape(node.keys, at, isLooping(node.attrs));
      if (scene.models[model]) instances.push({ transformId, shapeId: nodeId, model, pose });
    }
    path.delete(nodeId);
  };

  visit(ROOT_ID, IDENTITY_POSE, ROOT_ID, false);
  return instances;
}

export function listObjects(scene: VoxDocument): SceneObject[] {
  const hiddenLayers = hiddenLayerIds(scene);
  const objects: SceneObject[] = [];
  const path = new Set<number>();

  const visit = (nodeId: number, hiddenAbove: boolean): void => {
    const node = scene.nodes[nodeId];
    if (!node || path.has(nodeId) || node.kind === 'shape') return;
    path.add(nodeId);
    if (node.kind === 'group') node.children.forEach((child) => visit(child, hiddenAbove));
    if (node.kind === 'transform') {
      const hidden = hiddenAbove || isHidden(node.attrs) || hiddenLayers.has(node.layer);
      if (scene.nodes[node.child]?.kind === 'shape') objects.push({ transformId: nodeId, shapeId: node.child, hidden });
      else visit(node.child, hidden);
    }
    path.delete(nodeId);
  };

  visit(ROOT_ID, false);
  return objects;
}

export function parentGroupOf(scene: VoxDocument, nodeId: number): GroupNode | undefined {
  return scene.nodes.find((node): node is GroupNode => node.kind === 'group' && node.children.includes(nodeId));
}

/** The group directly under the root transform, where new objects go. */
export function rootGroup(scene: VoxDocument): GroupNode | undefined {
  const root = scene.nodes[ROOT_ID];
  const group = root?.kind === 'transform' ? scene.nodes[root.child] : undefined;
  return group?.kind === 'group' ? group : undefined;
}
