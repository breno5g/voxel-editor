import { applyRows, encodeRotation, multiplyRows, rotationRows, transposeRows } from '../format/rotation.ts';
import { cloneModel, IDENTITY_ROTATION } from '../format/vox.ts';
import type { SceneNode, TransformKey, Vec3, VoxModel } from '../format/vox.ts';
import { t } from '../i18n/i18n.ts';
import { evaluateShape, evaluateTransform, isLooping, setTransformAt } from '../scene/keyframes.ts';
import { compose, IDENTITY_POSE, ROOT_ID } from '../scene/scene-graph.ts';
import type { Pose } from '../scene/scene-graph.ts';
import { cloneSubtree, groupNode, isUnder, parentMap, parentPose, rootLevel } from '../scene/scene-tree.ts';
import type { Editor } from './editor.ts';
import { sceneChange } from './scene-change.ts';

/** MagicaVoxel `ocopy`: own copies of the voxels, `ref` shares them with the originals, `frame` only the current frame. */
export type CopyMode = 'copy' | 'ref' | 'frame';
/** MagicaVoxel `m_paste`: the whole transform, only rotation (`r`) or translation (`t`), or `i` to reset the rotation. */
export type TransformPart = 'all' | 'r' | 't' | 'i';

/**
 * Copied subtrees: nodes numbered from `base` (the document's node count when copied), roots in `roots`.
 * With `owned`, shape keys index `models` (copied again on every paste); otherwise they are the
 * document's own model ids (references).
 */
type Clipboard = { nodes: SceneNode[]; roots: number[]; base: number; owned: boolean; models: VoxModel[]; parents: Pose[] };

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** `node` with ids `id + shift`, and owned model ids `model + modelShift`. */
function rebase(node: SceneNode, shift: number, modelShift: number | null): SceneNode {
  if (node.kind === 'transform') return { ...node, attrs: new Map(node.attrs), keys: node.keys.map((key) => ({ ...key })), child: node.child + shift };
  if (node.kind === 'group') return { ...node, attrs: new Map(node.attrs), children: node.children.map((child) => child + shift) };
  return { ...node, attrs: new Map(node.attrs), keys: node.keys.map((key) => ({ ...key, model: modelShift === null ? key.model : key.model + modelShift })) };
}

/** Keys moved from parent frame `from` to parent frame `to`, keeping every key's world pose. */
function reparentKeys(keys: TransformKey[], from: Pose, to: Pose): TransformKey[] {
  const inverse = transposeRows(to.rows);
  return keys.map((key) => {
    const world = compose(from, { translation: key.translation, rotation: key.rotation });
    return { ...key, translation: applyRows(inverse, subtract(world.translation, to.translation)), rotation: encodeRotation(multiplyRows(inverse, world.rows)) };
  });
}

/** MagicaVoxel's object clipboard (`ocopy`, `ocut`, `opaste`), `oref2obj`, and the transform clipboard (`m_copy`, `m_paste`). */
export function createObjectClipboard(editor: Editor) {
  const { state } = editor;
  const change = sceneChange(editor);
  let clipboard: Clipboard | null = null;
  let copiedPose: Pose | null = null;
  editor.subscribe((event) => {
    if (event.type === 'document') clipboard = null;
  });

  const selectedTransforms = () =>
    state.selection.flatMap((id) => {
      const node = state.vox.nodes[id];
      return node?.kind === 'transform' ? [{ id, node }] : [];
    });

  const copy = (mode: CopyMode) => {
    const picked = selectedTransforms();
    if (picked.length === 0) return editor.status(t('Selecione objetos para copiar'), 'error');
    const parents = parentMap(state.vox);
    const base = state.vox.nodes.length;
    const scratch = { ...state.vox, nodes: [...state.vox.nodes] };
    const roots: number[] = [];
    for (const { id } of picked) {
      roots.push(scratch.nodes.length);
      scratch.nodes.push(...cloneSubtree(scratch, id, true).nodes);
    }
    let nodes = scratch.nodes.slice(base);
    if (mode === 'frame') {
      nodes = nodes.map((node) => {
        if (node.kind === 'transform') return { ...node, keys: [{ frame: 0, ...evaluateTransform(node.keys, state.frame, isLooping(node.attrs)) }] };
        if (node.kind === 'shape') return { ...node, keys: [{ frame: 0, model: evaluateShape(node.keys, state.frame, isLooping(node.attrs)) }] };
        return node;
      });
    }
    const models: VoxModel[] = [];
    if (mode !== 'ref') {
      const owned = new Map<number, number>();
      nodes = nodes.map((node) => {
        if (node.kind !== 'shape') return node;
        return {
          ...node,
          keys: node.keys.map((key) => {
            if (!owned.has(key.model)) {
              owned.set(key.model, models.length);
              models.push(cloneModel(state.vox.models[key.model]));
            }
            return { ...key, model: owned.get(key.model) ?? 0 };
          }),
        };
      });
    }
    clipboard = { nodes, roots, base, owned: mode !== 'ref', models, parents: picked.map(({ id }) => parentPose(state.vox, parents, id, state.frame)) };
    editor.status(mode === 'ref' ? t('Objetos copiados como referência') : t('Objetos copiados'));
  };

  /** Deletes nodes `ids` from their groups (one undo step), selecting nothing. */
  const unlink = (ids: number[], message: string) => {
    const parents = parentMap(state.vox);
    const links = ids.flatMap((id) => {
      const groupId = parents.get(id);
      const group = groupId === undefined ? undefined : groupNode(state.vox, groupId);
      return group ? [{ group, id, index: group.children.indexOf(id) }] : [];
    });
    const ordered = [...links].sort((a, b) => b.index - a.index);
    const previous = state.selection;
    change(
      () => {
        ordered.forEach(({ group, index }) => group.children.splice(index, 1));
        editor.setSelection([]);
      },
      () => {
        [...ordered].reverse().forEach(({ group, id, index }) => group.children.splice(index, 0, id));
        editor.setSelection(previous);
      },
      message,
    );
  };

  /** Gives the shapes under `ids` their own copies of every model another shape also shows. */
  const ownModels = (ids: number[], message: string) => {
    const parents = parentMap(state.vox);
    const reachable = state.vox.nodes.flatMap((node, id) => (node.kind === 'shape' && isUnder(parents, id, ROOT_ID) ? [{ id, node }] : []));
    const inside = reachable.filter(({ id }) => ids.some((root) => isUnder(parents, id, root)));
    const users = new Map<number, number>();
    reachable.forEach(({ node }) => new Set(node.keys.map((key) => key.model)).forEach((model) => users.set(model, (users.get(model) ?? 0) + 1)));
    const firstModel = state.vox.models.length;
    const copies: VoxModel[] = [];
    const edits = inside.flatMap(({ node }) => {
      if (!node.keys.some((key) => (users.get(key.model) ?? 0) > 1)) return [];
      const remap = new Map<number, number>();
      const keys = node.keys.map((key) => {
        if ((users.get(key.model) ?? 0) <= 1) return key;
        if (!remap.has(key.model)) {
          remap.set(key.model, firstModel + copies.length);
          copies.push(cloneModel(state.vox.models[key.model]));
        }
        users.set(key.model, (users.get(key.model) ?? 1) - 1);
        return { ...key, model: remap.get(key.model) ?? key.model };
      });
      return [{ node, before: node.keys, keys }];
    });
    if (edits.length === 0) return editor.status(t('Nenhuma referência na seleção'));
    change(
      () => {
        state.vox.models.push(...copies);
        edits.forEach(({ node, keys }) => (node.keys = keys));
      },
      () => {
        edits.forEach(({ node, before }) => (node.keys = before));
        state.vox.models.splice(firstModel);
      },
      message,
    );
  };

  /** The world pose of the primary selection, or null (with a status message unless `quiet`). */
  const primaryPose = (quiet = false): Pose | null => {
    const [primary] = selectedTransforms().slice(-1);
    if (!primary) {
      if (!quiet) editor.status(t('Selecione um objeto primeiro'), 'error');
      return null;
    }
    const parent = parentPose(state.vox, parentMap(state.vox), primary.id, state.frame);
    return compose(parent, evaluateTransform(primary.node.keys, state.frame, isLooping(primary.node.attrs)));
  };

  /** Sets the world pose of every selected transform at the current frame, as one undo step. */
  const setWorldPoses = (edit: (world: Pose) => Pose, message: string) => {
    const parents = parentMap(state.vox);
    const edits = selectedTransforms().map(({ id, node }) => {
      const parent = parentPose(state.vox, parents, id, state.frame);
      const next = edit(compose(parent, evaluateTransform(node.keys, state.frame, isLooping(node.attrs))));
      const local = reparentKeys([{ frame: state.frame, translation: next.translation, rotation: encodeRotation(next.rows) }], IDENTITY_POSE, parent)[0];
      return { node, before: node.keys, keys: setTransformAt(node.keys, state.frame, { translation: local.translation, rotation: local.rotation }) };
    });
    if (edits.length === 0) return;
    edits.forEach(({ node, before }) => editor.notePendingKeys(node, before));
    change(() => edits.forEach(({ node, keys }) => (node.keys = keys)), () => edits.forEach(({ node, before }) => (node.keys = before)), message);
  };

  return {
    copy,

    /** MagicaVoxel `ocut`: copies as reference and deletes, so pasting moves the objects. */
    cut() {
      if (selectedTransforms().length === 0) return editor.status(t('Selecione objetos para recortar'), 'error');
      copy('ref');
      unlink(state.selection, t('Objetos recortados'));
    },

    /** MagicaVoxel `opaste`: the copies go into the current group at the world place they were copied from, selected. */
    paste() {
      const copied = clipboard;
      const levelId = state.level ?? rootLevel(state.vox) ?? -1;
      const level = groupNode(state.vox, levelId);
      if (!copied) return editor.status(t('Nada copiado'), 'error');
      if (!level) return;
      const levelPose = parentPose(state.vox, parentMap(state.vox), levelId, state.frame);
      const firstNode = state.vox.nodes.length;
      const firstModel = state.vox.models.length;
      const shift = firstNode - copied.base;
      const nodes = copied.nodes.map((node) => rebase(node, shift, copied.owned ? firstModel : null));
      const roots = copied.roots.map((root) => root + shift);
      roots.forEach((root, index) => {
        const node = nodes[root - firstNode];
        if (node?.kind === 'transform') node.keys = reparentKeys(node.keys, copied.parents[index], levelPose);
      });
      const models = copied.owned ? copied.models.map(cloneModel) : [];
      const previous = state.selection;
      change(
        () => {
          state.vox.nodes.push(...nodes);
          state.vox.models.push(...models);
          level.children.push(...roots);
          editor.setSelection(roots);
        },
        () => {
          level.children.splice(level.children.length - roots.length);
          state.vox.nodes.splice(firstNode);
          state.vox.models.splice(firstModel);
          editor.setSelection(previous);
        },
        t('Objetos colados'),
      );
    },

    /** MagicaVoxel `oref2obj`: references become independent copies, for the selection or (`all`) the whole scene. */
    referencesToObjects(all: boolean) {
      const ids = all ? [ROOT_ID] : state.selection;
      if (ids.length === 0) return editor.status(t('Selecione objetos primeiro'), 'error');
      ownModels(ids, t('Referências convertidas em cópias'));
    },

    /** MagicaVoxel `m_copy`: the primary selection's world transform. */
    copyTransform() {
      copiedPose = primaryPose();
      if (copiedPose) editor.status(t('Transformação copiada'));
    },

    pasteTransform(part: TransformPart) {
      if (part === 'i') return setWorldPoses((world) => ({ ...world, rows: rotationRows(IDENTITY_ROTATION) }), t('Rotação zerada'));
      const copied = copiedPose;
      if (!copied) return editor.status(t('Nenhuma transformação copiada'), 'error');
      setWorldPoses(
        (world) => ({ rows: part === 't' ? world.rows : copied.rows, translation: part === 'r' ? world.translation : copied.translation }),
        t('Transformação colada'),
      );
    },

    /** MagicaVoxel `opos_x/y/z`: the primary selection's world position. */
    primaryPosition: (): Vec3 | null => primaryPose(true)?.translation ?? null,
  };
}

export type ObjectClipboard = ReturnType<typeof createObjectClipboard>;
