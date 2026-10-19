import { DEFAULT_MODEL_SIZE, objectTransform } from '../format/defaults.ts';
import { applyRows, encodeRotation, mirrorRotation, multiplyRows, rotationRows, transposeRows, turnRotation } from '../format/rotation.ts';
import type { Axis } from '../format/rotation.ts';
import { createModel, IDENTITY_ROTATION } from '../format/vox.ts';
import type { GroupNode, Matrix3, ShapeNode, TransformKey, TransformNode, Vec3 } from '../format/vox.ts';
import { evaluateTransform, isLooping, setTransformAt } from '../scene/keyframes.ts';
import { compose, IDENTITY_POSE, isHidden } from '../scene/scene-graph.ts';
import type { Pose } from '../scene/scene-graph.ts';
import { cloneSubtree, groupNode, groupOf, instanceBounds, instancesUnder, parentMap, parentPose, rootLevel, unionBounds } from '../scene/scene-tree.ts';
import type { Bounds } from '../scene/scene-tree.ts';
import type { Editor } from './editor.ts';
import { sceneChange } from './scene-change.ts';

type Picked = { id: number; node: TransformNode };

/**
 * Keys of a child moved out of its group: its own keys composed with the group's transform, with a
 * key at every frame either of them had one.
 */
function mergeKeys(holder: TransformKey[], child: TransformKey[]): TransformKey[] {
  const frames = [...new Set([...holder, ...child].map((key) => key.frame))].sort((a, b) => a - b);
  return frames.map((frame) => {
    const pose = compose(compose(IDENTITY_POSE, evaluateTransform(holder, frame, false)), evaluateTransform(child, frame, false));
    return { frame, translation: pose.translation, rotation: encodeRotation(pose.rows) };
  });
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const isZero = (vector: Vec3) => vector.every((axis) => axis === 0);
const floorCenter = ({ low, high }: Bounds): Vec3 => [Math.floor((low[0] + high[0]) / 2), Math.floor((low[1] + high[1]) / 2), Math.floor((low[2] + high[2]) / 2)];

/** The pose turned or mirrored by `rows` about the world point `center`. */
const aboutPoint = (rows: Matrix3, center: Vec3) => (pose: Pose): Pose => ({
  rows: multiplyRows(rows, pose.rows),
  translation: add(center, applyRows(rows, subtract(pose.translation, center))),
});

/**
 * MagicaVoxel's world editor commands on the selected transforms (objects or groups at the
 * current level): every edit is in world space and is one undo step for the whole selection.
 */
export function createWorldCommands(editor: Editor) {
  const { state } = editor;
  const change = sceneChange(editor);

  const levelGroup = () => groupNode(state.vox, state.level ?? rootLevel(state.vox) ?? -1);

  const picked = (): Picked[] =>
    state.selection.flatMap((id) => {
      const node = state.vox.nodes[id];
      return node?.kind === 'transform' ? [{ id, node }] : [];
    });

  const requireSelection = () => {
    const nodes = picked();
    if (nodes.length === 0) editor.status('Selecione um objeto primeiro', 'error');
    return nodes;
  };

  const boundsOf = (nodes: Picked[]) => {
    const parents = parentMap(state.vox);
    return unionBounds(nodes.flatMap(({ id }) => instancesUnder(state.instances, parents, id).map((instance) => instanceBounds(instance, state.vox.models))));
  };

  /** Keys of `node` holding world pose `next` at the current frame, given the pose of its parent frame. */
  const keysFor = (node: TransformNode, parent: Pose, next: Pose): TransformKey[] => {
    const inverse = transposeRows(parent.rows);
    const value = { translation: applyRows(inverse, subtract(next.translation, parent.translation)), rotation: encodeRotation(multiplyRows(inverse, next.rows)) };
    return setTransformAt(node.keys, state.frame, value);
  };

  const commitKeys = (edits: { node: TransformNode; keys: TransformKey[] }[], message?: string) => {
    const before = edits.map(({ node }) => node.keys);
    change(
      () => edits.forEach(({ node, keys }) => (node.keys = keys)),
      () => edits.forEach(({ node }, index) => (node.keys = before[index])),
      message,
    );
  };

  /** World poses of the selected transforms and of their parent frames at the current frame. */
  const worldPoses = (nodes: Picked[]) => {
    const parents = parentMap(state.vox);
    return nodes.map(({ id, node }) => {
      const parent = parentPose(state.vox, parents, id, state.frame);
      return { node, parent, world: compose(parent, evaluateTransform(node.keys, state.frame, isLooping(node.attrs))) };
    });
  };

  const editWorld = (nodes: Picked[], edit: (pose: Pose) => Pose, message?: string) =>
    commitKeys(worldPoses(nodes).map(({ node, parent, world }) => ({ node, keys: keysFor(node, parent, edit(world)) })), message);

  /** One object turns about its own pivot; several turn together about the centre of their box. */
  const pivotOf = (nodes: Picked[]): Vec3 | null => {
    if (nodes.length === 1) return worldPoses(nodes)[0].world.translation;
    const bounds = boundsOf(nodes);
    return bounds && floorCenter(bounds);
  };

  const setHidden = (ids: number[], hidden: boolean) => {
    const nodes = ids.flatMap((id) => {
      const node = state.vox.nodes[id];
      return node?.kind === 'transform' ? [node] : [];
    });
    const before = nodes.map((node) => node.attrs.get('_hidden'));
    const apply = (values: (string | undefined)[]) => () =>
      nodes.forEach((node, index) => {
        const value = values[index];
        if (value === undefined) node.attrs.delete('_hidden');
        else node.attrs.set('_hidden', value);
      });
    change(apply(nodes.map(() => (hidden ? '1' : undefined))), apply(before), hidden ? 'Objetos ocultos' : 'Objetos visíveis');
  };

  /** Adds the subtrees copied from `sources` next to them in their groups, shifted by `offset`, and selects the copies. */
  const copyNodes = (nodes: Picked[], offset: Vec3, shareModels: boolean, message: string) => {
    const parents = parentMap(state.vox);
    const copies: { group: number; id: number }[] = [];
    const addedNodes: typeof state.vox.nodes = [];
    const addedModels: typeof state.vox.models = [];
    const scratch = { ...state.vox, nodes: [...state.vox.nodes], models: [...state.vox.models] };
    for (const { id } of nodes) {
      const group = parents.get(id);
      if (group === undefined) continue;
      const clone = cloneSubtree(scratch, id, shareModels);
      copies.push({ group, id: scratch.nodes.length });
      scratch.nodes.push(...clone.nodes);
      scratch.models.push(...clone.models);
      addedNodes.push(...clone.nodes);
      addedModels.push(...clone.models);
    }
    const firstNode = state.vox.nodes.length;
    const firstModel = state.vox.models.length;
    const previous = state.selection;
    change(
      () => {
        state.vox.nodes.push(...addedNodes);
        state.vox.models.push(...addedModels);
        copies.forEach(({ group, id }) => groupNode(state.vox, group)?.children.push(id));
        copies.forEach(({ id }) => {
          const node = state.vox.nodes[id];
          if (node.kind === 'transform' && !isZero(offset)) node.keys = node.keys.map((key) => ({ ...key, translation: add(key.translation, offset) }));
        });
        editor.setSelection(copies.map(({ id }) => id));
      },
      () => {
        copies.forEach(({ group }) => groupNode(state.vox, group)?.children.pop());
        state.vox.nodes.splice(firstNode);
        state.vox.models.splice(firstModel);
        editor.setSelection(previous);
      },
      message,
    );
  };

  /** The level above the current group: its holder becomes the selection. */
  const exitLevel = () => {
    if (state.mode === 'model') return editor.setMode('world');
    if (state.level === null) return;
    const parents = parentMap(state.vox);
    const holder = parents.get(state.level);
    const above = holder === undefined ? undefined : parents.get(holder);
    if (holder === undefined || above === undefined) return editor.setLevel(null);
    editor.setLevel(above, [holder]);
  };

  return {
    setHidden,
    exitLevel,

    /** MagicaVoxel `olevel` (Tab): enters the selected group or object; from a model, or with nothing selected, climbs a level. */
    enterLevel() {
      if (state.mode === 'model' || state.selected === null) return exitLevel();
      const group = groupOf(state.vox, state.selected);
      if (group === null) return editor.setMode('model');
      editor.setLevel(group, groupNode(state.vox, group)?.children.slice(0, 1) ?? []);
    },

    /**
     * MagicaVoxel `ogroup` (Ctrl+R): the selection moves into a new group in its place, whose
     * transform sits on the selection's centre; children keep their world position.
     */
    groupSelected() {
      const nodes = requireSelection();
      const level = levelGroup();
      const bounds = boundsOf(nodes);
      if (nodes.length === 0 || !level) return;
      const center: Vec3 = bounds ? [...floorCenter(bounds)] : [0, 0, 0];
      if (bounds) center[2] = bounds.low[2];
      const transformId = state.vox.nodes.length;
      const ids = nodes.map(({ id }) => id);
      const holder: TransformNode = { kind: 'transform', attrs: new Map(), child: transformId + 1, layer: nodes[0].node.layer, keys: [{ frame: 0, translation: center, rotation: IDENTITY_ROTATION }] };
      const group: GroupNode = { kind: 'group', attrs: new Map(), children: ids };
      const beforeChildren = level.children;
      const position = Math.min(...ids.map((id) => level.children.indexOf(id)));
      const afterChildren = level.children.filter((id) => !ids.includes(id));
      afterChildren.splice(position, 0, transformId);
      const shifted = nodes.map(({ node }) => node.keys.map((key) => ({ ...key, translation: subtract(key.translation, center) })));
      const before = nodes.map(({ node }) => node.keys);
      const previous = state.selection;
      change(
        () => {
          state.vox.nodes.push(holder, group);
          level.children = afterChildren;
          nodes.forEach(({ node }, index) => (node.keys = shifted[index]));
          editor.setSelection([transformId]);
        },
        () => {
          nodes.forEach(({ node }, index) => (node.keys = before[index]));
          level.children = beforeChildren;
          state.vox.nodes.splice(transformId, 2);
          editor.setSelection(previous);
        },
        'Grupo criado',
      );
    },

    /** MagicaVoxel `oungroup` (Ctrl+Shift+R): the selected groups' members take their place, keeping their world poses. */
    ungroupSelected() {
      const level = levelGroup();
      const groups = requireSelection().flatMap(({ id, node }) => {
        const groupId = groupOf(state.vox, id);
        const group = groupId === null ? undefined : groupNode(state.vox, groupId);
        return group ? [{ id, node, group }] : [];
      });
      if (!level || groups.length === 0) return editor.status('Selecione um grupo para desagrupar', 'error');
      const members = groups.flatMap(({ node: holder, group }) =>
        group.children.flatMap((childId) => {
          const child = state.vox.nodes[childId];
          return child?.kind === 'transform' ? [{ id: childId, node: child, keys: mergeKeys(holder.keys, child.keys) }] : [];
        }),
      );
      const beforeChildren = level.children;
      const afterChildren = level.children.flatMap((id) => groups.find((entry) => entry.id === id)?.group.children ?? [id]);
      const before = members.map(({ node }) => node.keys);
      const previous = state.selection;
      change(
        () => {
          members.forEach(({ node, keys }) => (node.keys = keys));
          level.children = afterChildren;
          editor.setSelection(members.map(({ id }) => id));
        },
        () => {
          members.forEach(({ node }, index) => (node.keys = before[index]));
          level.children = beforeChildren;
          editor.setSelection(previous);
        },
        'Grupo desfeito',
      );
    },

    /** MagicaVoxel `order`: render order among siblings; ±2 brings to the first or last place, ±1 moves one place. */
    orderSelected(step: -2 | -1 | 1 | 2) {
      const level = levelGroup();
      const ids = requireSelection().map(({ id }) => id);
      if (!level || ids.length === 0) return;
      const before = level.children;
      const kept = before.filter((id) => !ids.includes(id));
      const chosen = before.filter((id) => ids.includes(id));
      const first = before.findIndex((id) => ids.includes(id));
      const place = step === 2 ? 0 : step === -2 ? kept.length : Math.min(Math.max(first - step, 0), kept.length);
      const after = [...kept.slice(0, place), ...chosen, ...kept.slice(place)];
      change(() => (level.children = after), () => (level.children = before), 'Ordem alterada');
    },

    selectAll() {
      editor.setSelection(levelGroup()?.children ?? []);
    },

    selectNone() {
      editor.setSelection([]);
    },

    invertSelection() {
      editor.setSelection((levelGroup()?.children ?? []).filter((id) => !state.selection.includes(id)));
    },

    moveSelected(delta: Vec3) {
      const nodes = requireSelection();
      if (nodes.length) editWorld(nodes, (pose) => ({ ...pose, translation: add(pose.translation, delta) }));
    },

    /**
     * Live move for a pointer drag: `preview` repositions the selection without touching
     * history, `commit` records the whole drag as one undo step.
     */
    dragSelected() {
      const nodes = picked();
      if (nodes.length === 0) return null;
      const start = worldPoses(nodes);
      const before = nodes.map(({ node }) => node.keys);
      let moved = false;
      return {
        preview(delta: Vec3) {
          moved = !isZero(delta);
          start.forEach(({ node, parent, world }, index) => {
            node.keys = moved ? keysFor(node, parent, { ...world, translation: add(world.translation, delta) }) : before[index];
          });
          editor.sceneChanged();
        },
        commit() {
          if (!moved) return;
          const after = nodes.map(({ node }) => node.keys);
          nodes.forEach(({ node }, index) => (node.keys = before[index]));
          commitKeys(nodes.map(({ node }, index) => ({ node, keys: after[index] })), nodes.length > 1 ? 'Objetos movidos' : 'Objeto movido');
        },
      };
    },

    /** MagicaVoxel `omove g`: drops the selection until the bottom of its box rests on z = 0. */
    groundSelected() {
      const nodes = requireSelection();
      const bounds = nodes.length ? boundsOf(nodes) : null;
      if (!bounds) return;
      editWorld(nodes, (pose) => ({ ...pose, translation: [pose.translation[0], pose.translation[1], pose.translation[2] - bounds.low[2]] }), 'Apoiado no chão');
    },

    /** MagicaVoxel `orot`: a quarter turn about a world axis. */
    rotateSelected(axis: Axis, direction: 1 | -1) {
      const nodes = requireSelection();
      const center = nodes.length ? pivotOf(nodes) : null;
      if (center) editWorld(nodes, aboutPoint(rotationRows(turnRotation(IDENTITY_ROTATION, axis, direction)), center), 'Girado 90°');
    },

    /** MagicaVoxel `oflip`: mirrors along a world axis (the rotation becomes improper). */
    mirrorSelected(axis: Axis) {
      const nodes = requireSelection();
      const center = nodes.length ? pivotOf(nodes) : null;
      if (center) editWorld(nodes, aboutPoint(rotationRows(mirrorRotation(IDENTITY_ROTATION, axis)), center), 'Espelhado');
    },

    /** MagicaVoxel `oalign`: lines up each selected box with the selection's minimum (-1), centre (0) or maximum (1) on `axis`. */
    alignSelected(axis: Axis, side: -1 | 0 | 1) {
      const nodes = requireSelection();
      const all = nodes.length > 1 ? boundsOf(nodes) : null;
      if (!all) return editor.status('Selecione dois ou mais objetos para alinhar', 'error');
      const anchor = (box: Bounds) => (side < 0 ? box.low[axis] : side > 0 ? box.high[axis] : Math.floor((box.low[axis] + box.high[axis]) / 2));
      const target = anchor(all);
      const poses = worldPoses(nodes);
      const edits = nodes.flatMap(({ node }, index) => {
        const box = boundsOf([nodes[index]]);
        if (!box) return [];
        const delta: Vec3 = [0, 0, 0];
        delta[axis] = target - anchor(box);
        const { parent, world } = poses[index];
        return [{ node, keys: keysFor(node, parent, { ...world, translation: add(world.translation, delta) }) }];
      });
      commitKeys(edits, 'Objetos alinhados');
    },

    /** MagicaVoxel `ohide`: hides (true), shows (false) or toggles (no argument) the selection. */
    hideSelected(hidden?: boolean) {
      const nodes = requireSelection();
      if (nodes.length === 0) return;
      setHidden(
        nodes.map(({ id }) => id),
        hidden ?? nodes.some(({ node }) => !isHidden(node.attrs)),
      );
    },

    toggleHidden(transformId: number) {
      const node = state.vox.nodes[transformId];
      if (node?.kind === 'transform') setHidden([transformId], !isHidden(node.attrs));
    },

    /** Unlinks the selection from its groups; the writer drops unreachable nodes and undo relinks them. */
    deleteSelected() {
      const parents = parentMap(state.vox);
      const links = requireSelection().flatMap(({ id }) => {
        const groupId = parents.get(id);
        const group = groupId === undefined ? undefined : groupNode(state.vox, groupId);
        return group ? [{ group, id, index: group.children.indexOf(id) }] : [];
      });
      if (links.length === 0) return;
      const previous = state.selection;
      const ordered = [...links].sort((a, b) => b.index - a.index);
      change(
        () => {
          ordered.forEach(({ group, index }) => group.children.splice(index, 1));
          editor.setSelection([]);
        },
        () => {
          [...ordered].reverse().forEach(({ group, id, index }) => group.children.splice(index, 0, id));
          editor.setSelection(previous);
        },
        links.length > 1 ? 'Objetos apagados' : 'Objeto apagado',
      );
    },

    /** Deep copies (own models for every frame) placed beside the selection, or on it when `inPlace`. */
    duplicateSelected(inPlace = false) {
      const nodes = requireSelection();
      const bounds = nodes.length ? boundsOf(nodes) : null;
      const gap: Vec3 = [inPlace || !bounds ? 0 : bounds.high[0] - bounds.low[0] + 1, 0, 0];
      if (nodes.length) copyNodes(nodes, gap, false, nodes.length > 1 ? 'Objetos duplicados' : 'Objeto duplicado');
    },

    /**
     * MagicaVoxel `b_obj wrap`: repeats the selection along world `axis` on side `side` (both with
     * `twoSided`), one copy per box length plus the wrap spacing. Copies are references (they share
     * the voxels). `preview(count)` rebuilds the copies live; `commit` records them as one undo step.
     */
    wrapDrag(axis: Axis, side: 1 | -1, twoSided: boolean) {
      const nodes = picked();
      const level = levelGroup();
      const bounds = boundsOf(nodes);
      if (nodes.length === 0 || !level || !bounds) return null;
      const step = bounds.high[axis] - bounds.low[axis] + state.objectWrapSpacing[axis];
      const firstNode = state.vox.nodes.length;
      const children = level.children;
      let added: { nodes: typeof state.vox.nodes; roots: number[] } = { nodes: [], roots: [] };
      const apply = (copies: typeof added) => {
        state.vox.nodes.splice(firstNode, Infinity, ...copies.nodes);
        level.children = [...children, ...copies.roots];
      };
      return {
        step,
        preview(count: number) {
          const scratch = { ...state.vox, nodes: state.vox.nodes.slice(0, firstNode) };
          const roots: number[] = [];
          const sides = twoSided ? [side, -side] : [side];
          for (let index = 1; index <= count; index++) {
            for (const direction of sides) {
              const offset: Vec3 = [0, 0, 0];
              offset[axis] = direction * index * step;
              for (const { id } of nodes) {
                const root = scratch.nodes.length;
                const { nodes: copies } = cloneSubtree(scratch, id, true);
                const [holder] = copies;
                if (holder?.kind === 'transform') holder.keys = holder.keys.map((key) => ({ ...key, translation: add(key.translation, offset) }));
                scratch.nodes.push(...copies);
                roots.push(root);
              }
            }
          }
          added = { nodes: scratch.nodes.slice(firstNode), roots };
          apply(added);
          editor.sceneChanged();
        },
        commit() {
          const copies = added;
          apply({ nodes: [], roots: [] });
          if (copies.roots.length === 0) return editor.sceneChanged();
          change(() => apply(copies), () => apply({ nodes: [], roots: [] }), `${copies.roots.length} cópia(s) por wrap`);
        },
      };
    },

    /** MagicaVoxel `onew`: an empty object in the current group. */
    addObject() {
      const group = levelGroup();
      if (!group) return editor.status('A cena não tem um grupo raiz para receber objetos', 'error');
      const transformId = state.vox.nodes.length;
      const nodes: [TransformNode, ShapeNode] = [
        { ...objectTransform(transformId + 1, DEFAULT_MODEL_SIZE), layer: state.layer },
        { kind: 'shape', attrs: new Map(), keys: [{ frame: 0, model: state.vox.models.length }] },
      ];
      const previous = state.selection;
      change(
        () => {
          state.vox.models.push(createModel(DEFAULT_MODEL_SIZE));
          state.vox.nodes.push(...nodes);
          group.children.push(transformId);
          editor.setSelection([transformId]);
        },
        () => {
          group.children.pop();
          state.vox.nodes.splice(transformId, nodes.length);
          state.vox.models.pop();
          editor.setSelection(previous);
        },
        'Objeto criado',
      );
    },
  };
}
