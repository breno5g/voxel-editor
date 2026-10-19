import { DEFAULT_MODEL_SIZE, objectTransform } from '../format/defaults.ts';
import { applyRows, mirrorRotation, rotationRows, turnRotation } from '../format/rotation.ts';
import type { Axis } from '../format/rotation.ts';
import { cellOf, cloneModel, createModel, EMPTY_VOXEL, MAX_MODEL_SIZE, modelPivot, resizeModel } from '../format/vox.ts';
import type { ShapeNode, TransformNode, Vec3, VoxModel } from '../format/vox.ts';
import { adjacentKeyFrame, evaluateShape, evaluateTransform, isLooping, removeKeyAt, setTransformAt, upsertKey } from '../scene/keyframes.ts';
import type { TransformValue } from '../scene/keyframes.ts';
import { isHidden, parentGroupOf, rootGroup } from '../scene/scene-graph.ts';
import type { Editor } from './editor.ts';

export type ObjectCommands = ReturnType<typeof createObjectCommands>;
export type Track = 'transform' | 'shape';

type Selection = { transformId: number; transform: TransformNode; shape: ShapeNode; model: number };

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const isZero = (vector: Vec3) => vector.every((axis) => axis === 0);
const uniqueModels = (shape: ShapeNode) => [...new Set(shape.keys.map((key) => key.model))];

/** Object-level edits (keys, transforms, size, lifecycle); every one is a single undo step. */
export function createObjectCommands(editor: Editor) {
  const { state } = editor;

  /** Works from the scene graph, not the visible instances, so hidden objects stay editable. */
  const selection = (): Selection | null => {
    const transformId = state.selected;
    const transform = transformId === null ? undefined : state.vox.nodes[transformId];
    const shape = transform?.kind === 'transform' ? state.vox.nodes[transform.child] : undefined;
    if (transformId === null || transform?.kind !== 'transform' || shape?.kind !== 'shape') {
      editor.status('Selecione um objeto primeiro', 'error');
      return null;
    }
    return { transformId, transform, shape, model: evaluateShape(shape.keys, state.frame, isLooping(shape.attrs)) };
  };

  const change = (redo: () => void, undo: () => void, message?: string) => {
    redo();
    editor.sceneChanged();
    editor.history.push({
      undo: () => {
        undo();
        editor.sceneChanged();
      },
      redo: () => {
        redo();
        editor.sceneChanged();
      },
    });
    if (message) editor.status(message);
  };

  const commitKeys = <K>(node: { keys: K[] }, next: K[], message?: string) => {
    const before = node.keys;
    change(() => (node.keys = next), () => (node.keys = before), message);
  };

  /** Applies a transform edit at the current frame (in place for static objects, as a key for animated ones). */
  const changeTransform = (edit: (current: TransformValue) => TransformValue, message?: string) => {
    const selected = selection();
    if (!selected) return;
    const { transform } = selected;
    const current = evaluateTransform(transform.keys, state.frame, isLooping(transform.attrs));
    commitKeys(transform, setTransformAt(transform.keys, state.frame, edit(current)), message);
  };

  /**
   * Every model of the selected object (all its frames) at `size`, with old cell `origin` as new cell 0,
   * and the transform keys that keep the voxels at their world position.
   */
  const reshaped = (selected: Selection, size: Vec3, origin: Vec3) => {
    const { transform, shape } = selected;
    const ids = uniqueModels(shape);
    const models = ids.map((id) => resizeModel(state.vox.models[id], size, origin));
    const oldPivot = modelPivot(state.vox.models[selected.model].size);
    const newPivot = modelPivot(size);
    const shift: Vec3 = [newPivot[0] + origin[0] - oldPivot[0], newPivot[1] + origin[1] - oldPivot[1], newPivot[2] + origin[2] - oldPivot[2]];
    const keys = transform.keys.map((key) => ({ ...key, translation: add(key.translation, applyRows(rotationRows(key.rotation), shift)) }));
    return { ids, models, keys };
  };

  const assignShape = (selected: Selection, ids: number[], models: VoxModel[], keys: TransformNode['keys']) => () => {
    ids.forEach((id, i) => (state.vox.models[id] = models[i]));
    selected.transform.keys = keys;
  };

  const reshape = (size: Vec3, origin: Vec3, message: string) => {
    const selected = selection();
    if (!selected) return;
    const after = reshaped(selected, size, origin);
    const before = after.ids.map((id) => state.vox.models[id]);
    change(assignShape(selected, after.ids, after.models, after.keys), assignShape(selected, after.ids, before, selected.transform.keys), message);
  };

  const hasKeyAt = (keys: { frame: number }[]) => keys.some((key) => key.frame === state.frame);

  const dropKey = (node: { keys: { frame: number }[] }, label: string) => {
    if (node.keys.length <= 1) return editor.status(`O objeto precisa de pelo menos uma ${label}`, 'error');
    if (!hasKeyAt(node.keys)) return editor.status(`Nenhuma ${label} no frame ${state.frame}`, 'error');
    commitKeys(node, removeKeyAt(node.keys, state.frame), `${label} removida do frame ${state.frame}`);
  };

  const setAttr = (attrs: Map<string, string>, key: string, value: string | null) => {
    if (value === null) attrs.delete(key);
    else attrs.set(key, value);
  };

  const addTransformKey = () => {
    const selected = selection();
    if (!selected) return;
    const { transform } = selected;
    if (hasKeyAt(transform.keys)) return editor.status(`Já existe key de posição no frame ${state.frame}`, 'error');
    const current = evaluateTransform(transform.keys, state.frame, isLooping(transform.attrs));
    commitKeys(transform, upsertKey(transform.keys, { frame: state.frame, ...current }), `Key de posição no frame ${state.frame}`);
  };

  /** Duplicates the model on screen into a new frame, ready to be edited (sprite-style animation). */
  const addModelFrame = () => {
    const selected = selection();
    if (!selected) return;
    const { shape, model } = selected;
    if (hasKeyAt(shape.keys)) return editor.status(`Já existe frame de modelo no frame ${state.frame}`, 'error');
    state.vox.models.push(cloneModel(state.vox.models[model]));
    commitKeys(shape, upsertKey(shape.keys, { frame: state.frame, model: state.vox.models.length - 1 }), `Frame de modelo no frame ${state.frame}`);
  };

  const removeTransformKey = () => {
    const selected = selection();
    if (selected) dropKey(selected.transform, 'key de posição');
  };

  const removeModelFrame = () => {
    const selected = selection();
    if (selected) dropKey(selected.shape, 'frame de modelo');
  };

  return {
    addTransformKey,
    addModelFrame,
    removeTransformKey,
    removeModelFrame,

    /** MagicaVoxel `aadd` (F5): the editor on top decides the track, as in `***REMOVED***`. */
    addKey() {
      if (state.mode === 'model') addModelFrame();
      else addTransformKey();
    },

    /** MagicaVoxel `adel` (F6). */
    removeKey() {
      if (state.mode === 'model') removeModelFrame();
      else removeTransformKey();
    },

    moveSelected(delta: Vec3) {
      changeTransform((current) => ({ ...current, translation: add(current.translation, delta) }));
    },

    /**
     * Live move for a pointer drag: `preview` repositions the object without touching
     * history, `commit` records the whole drag as one undo step.
     */
    dragSelected() {
      const selected = selection();
      if (!selected) return null;
      const { transform } = selected;
      const before = transform.keys;
      const start = evaluateTransform(before, state.frame, isLooping(transform.attrs));
      return {
        preview(delta: Vec3) {
          transform.keys = isZero(delta) ? before : setTransformAt(before, state.frame, { ...start, translation: add(start.translation, delta) });
          editor.sceneChanged();
        },
        commit() {
          const after = transform.keys;
          if (after !== before) change(() => (transform.keys = after), () => (transform.keys = before), 'Objeto movido');
        },
      };
    },

    /** MagicaVoxel `omove g`: drops the object until the bottom of its model box rests on z = 0. */
    groundSelected() {
      const selected = selection();
      if (!selected) return;
      const { size } = state.vox.models[selected.model];
      const pivot = modelPivot(size);
      changeTransform((current) => {
        const rows = rotationRows(current.rotation);
        const bottom = [0, 1, 2].reduce((sum, axis) => sum + Math.min(-rows[6 + axis] * pivot[axis], rows[6 + axis] * (size[axis] - pivot[axis])), 0);
        return { ...current, translation: [current.translation[0], current.translation[1], -bottom] };
      }, 'Objeto apoiado no chão');
    },

    rotateSelected(axis: Axis, direction: 1 | -1) {
      changeTransform((current) => ({ ...current, rotation: turnRotation(current.rotation, axis, direction) }), 'Objeto girado 90°');
    },

    mirrorSelected(axis: Axis) {
      changeTransform((current) => ({ ...current, rotation: mirrorRotation(current.rotation, axis) }), 'Objeto espelhado');
    },

    toggleLoop(track: 'transform' | 'shape') {
      const selected = selection();
      if (!selected) return;
      const { attrs } = selected[track];
      const before = attrs.get('_loop') ?? null;
      const after = isLooping(attrs) ? null : '1';
      change(() => setAttr(attrs, '_loop', after), () => setAttr(attrs, '_loop', before));
    },

    /** MagicaVoxel `astep key`: next/previous key of the mode's track; `toEdge` jumps to the first/last. */
    stepKey(direction: 1 | -1, toEdge = false) {
      const selected = selection();
      if (!selected) return;
      const frames = selected[state.mode === 'model' ? 'shape' : 'transform'].keys.map((key) => key.frame);
      const edge = direction > 0 ? Math.max(...frames) : Math.min(...frames);
      const target = toEdge ? edge : adjacentKeyFrame(frames, state.frame, direction);
      if (target !== null) editor.setFrame(target);
    },

    /**
     * Resizes every model of the object (all its frames), anchored at the minimum corner;
     * translations are compensated so voxels keep their world position.
     */
    resizeSelected(size: Vec3) {
      if (size.some((axis) => !Number.isInteger(axis) || axis < 1 || axis > MAX_MODEL_SIZE)) {
        return editor.status(`Tamanho inválido: cada eixo vai de 1 a ${MAX_MODEL_SIZE}`, 'error');
      }
      reshape(size, [0, 0, 0], `Modelo redimensionado para ${size.join('×')}`);
    },

    /**
     * MagicaVoxel `b_type resize`: a live resize of every frame. `preview` takes the cells added below
     * and above the current box on each axis (negative shrinks); `commit` records it as one undo step.
     */
    resizeDrag() {
      const selected = selection();
      if (!selected) return null;
      const base = state.vox.models[selected.model].size;
      const ids = uniqueModels(selected.shape);
      const before = { models: ids.map((id) => state.vox.models[id]), keys: selected.transform.keys };
      let current = before;
      return {
        preview(below: Vec3, above: Vec3) {
          const length = (axis: 0 | 1 | 2) => Math.min(Math.max(base[axis] + below[axis] + above[axis], 1), MAX_MODEL_SIZE);
          const size: Vec3 = [length(0), length(1), length(2)];
          const origin: Vec3 = [-below[0], -below[1], -below[2]];
          assignShape(selected, ids, before.models, before.keys)();
          current = reshaped(selected, size, origin);
          assignShape(selected, ids, current.models, current.keys)();
          editor.sceneChanged();
          return size;
        },
        commit() {
          const after = current;
          if (after === before) return;
          change(assignShape(selected, ids, after.models, after.keys), assignShape(selected, ids, before.models, before.keys), `Modelo redimensionado para ${after.models[0]?.size.join('×')}`);
        },
      };
    },

    /** MagicaVoxel `shrink`: crops every frame's volume to the box holding all of their voxels. */
    shrinkSelected() {
      const selected = selection();
      if (!selected) return;
      const low: Vec3 = [Infinity, Infinity, Infinity];
      const high: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const id of uniqueModels(selected.shape)) {
        const model = state.vox.models[id];
        model.voxels.forEach((color, index) => {
          if (color === EMPTY_VOXEL) return;
          cellOf(model.size, index).forEach((value, axis) => {
            low[axis] = Math.min(low[axis], value);
            high[axis] = Math.max(high[axis], value);
          });
        });
      }
      if (low[0] === Infinity) return editor.status('O modelo está vazio', 'error');
      const size: Vec3 = [high[0] - low[0] + 1, high[1] - low[1] + 1, high[2] - low[2] + 1];
      reshape(size, low, `Modelo ajustado ao conteúdo: ${size.join('×')}`);
    },

    renameSelected(name: string) {
      const selected = selection();
      if (!selected) return;
      const { attrs } = selected.transform;
      const before = attrs.get('_name') ?? null;
      const after = name.trim() || null;
      if (before === after) return;
      change(() => setAttr(attrs, '_name', after), () => setAttr(attrs, '_name', before));
    },

    toggleHidden(transformId: number) {
      const transform = state.vox.nodes[transformId];
      if (transform?.kind !== 'transform') return;
      const before = transform.attrs.get('_hidden') ?? null;
      const after = isHidden(transform.attrs) ? null : '1';
      change(() => setAttr(transform.attrs, '_hidden', after), () => setAttr(transform.attrs, '_hidden', before));
    },

    /** Unlinks the object from its group; the writer drops unreachable nodes, undo relinks it. */
    deleteSelected() {
      const selected = selection();
      const group = selected && parentGroupOf(state.vox, selected.transformId);
      if (!selected || !group) return;
      const index = group.children.indexOf(selected.transformId);
      change(
        () => {
          group.children.splice(index, 1);
          editor.select(null);
        },
        () => {
          group.children.splice(index, 0, selected.transformId);
          editor.select(selected.transformId);
        },
        'Objeto apagado',
      );
    },

    /** Deep copy (own models for every frame) placed next to the original. */
    duplicateSelected() {
      const selected = selection();
      const group = selected && parentGroupOf(state.vox, selected.transformId);
      if (!selected || !group) return;
      const { transform, shape } = selected;
      const ids = uniqueModels(shape);
      const firstCopy = state.vox.models.length;
      const copies = ids.map((id) => cloneModel(state.vox.models[id]));
      const copyOf = new Map(ids.map((id, i) => [id, firstCopy + i]));
      const transformId = state.vox.nodes.length;
      const gap = state.vox.models[selected.model].size[0] + 1;
      const attrs = new Map(transform.attrs);
      const name = attrs.get('_name');
      if (name) attrs.set('_name', `${name} cópia`);
      const nodes: [TransformNode, ShapeNode] = [
        {
          ...transform,
          attrs,
          child: transformId + 1,
          keys: transform.keys.map((key) => ({ ...key, translation: add(key.translation, [gap, 0, 0]) })),
        },
        { kind: 'shape', attrs: new Map(shape.attrs), keys: shape.keys.map((key) => ({ ...key, model: copyOf.get(key.model) ?? key.model })) },
      ];
      change(
        () => {
          state.vox.models.push(...copies);
          state.vox.nodes.push(...nodes);
          group.children.push(transformId);
          editor.select(transformId);
        },
        () => {
          group.children.pop();
          state.vox.nodes.splice(transformId, nodes.length);
          state.vox.models.splice(firstCopy, copies.length);
          editor.select(selected.transformId);
        },
        'Objeto duplicado',
      );
    },

    addObject() {
      const group = rootGroup(state.vox);
      if (!group) return editor.status('A cena não tem um grupo raiz para receber objetos', 'error');
      const transformId = state.vox.nodes.length;
      const model = createModel(DEFAULT_MODEL_SIZE);
      const nodes: [TransformNode, ShapeNode] = [
        objectTransform(transformId + 1, DEFAULT_MODEL_SIZE),
        { kind: 'shape', attrs: new Map(), keys: [{ frame: 0, model: state.vox.models.length }] },
      ];
      const previous = state.selected;
      change(
        () => {
          state.vox.models.push(model);
          state.vox.nodes.push(...nodes);
          group.children.push(transformId);
          editor.select(transformId);
        },
        () => {
          group.children.pop();
          state.vox.nodes.splice(transformId, nodes.length);
          state.vox.models.pop();
          editor.select(previous);
        },
        'Objeto criado',
      );
    },
  };
}
