import { applyRows, transposeRows } from '../format/rotation.ts';
import { cellOf, createModel, EMPTY_VOXEL, IDENTITY_ROTATION, MAX_MODEL_SIZE, modelPivot, voxelIndex } from '../format/vox.ts';
import type { ShapeNode, TransformNode, Vec3, VoxModel } from '../format/vox.ts';
import type { Instance, Pose } from '../scene/scene-graph.ts';
import { groupNode, instancesUnder, parentMap, parentPose, rootLevel } from '../scene/scene-tree.ts';
import type { Editor } from './editor.ts';
import { sceneChange } from './scene-change.ts';

/** World cells are packed into one number; coordinates must stay within ±OFFSET. */
const OFFSET = 1 << 15;
const SPAN = OFFSET * 2;
const packCell = ([x, y, z]: Vec3) => ((x + OFFSET) * SPAN + (y + OFFSET)) * SPAN + (z + OFFSET);
const unpackCell = (key: number): Vec3 => [Math.floor(key / (SPAN * SPAN)) - OFFSET, (Math.floor(key / SPAN) % SPAN) - OFFSET, (key % SPAN) - OFFSET];

/** Packed world cell of model cell `index`: the cell holding the voxel's centre. */
function worldCellOf(pose: Pose, model: VoxModel, index: number): number {
  const pivot = modelPivot(model.size);
  const [x, y, z] = cellOf(model.size, index);
  const [dx, dy, dz] = applyRows(pose.rows, [x + 0.5 - pivot[0], y + 0.5 - pivot[1], z + 0.5 - pivot[2]]);
  const [tx, ty, tz] = pose.translation;
  return packCell([Math.floor(tx + dx), Math.floor(ty + dy), Math.floor(tz + dz)]);
}

/** The world cell each filled voxel of `instance` occupies, mapped to its colour. */
export function worldCells({ pose, model }: Instance, models: VoxModel[]): Map<number, number> {
  const source = models[model];
  const cells = new Map<number, number>();
  source.voxels.forEach((color, index) => {
    if (color !== EMPTY_VOXEL) cells.set(worldCellOf(pose, source, index), color);
  });
  return cells;
}

/** The smallest model holding `cells` (at most 256 per axis, centred on them), and the world cell of its cell 0. */
export function modelFromCells(cells: Map<number, number>): { model: VoxModel; low: Vec3 } | null {
  if (cells.size === 0) return null;
  const low: Vec3 = [Infinity, Infinity, Infinity];
  const high: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const key of cells.keys()) {
    unpackCell(key).forEach((value, axis) => {
      low[axis] = Math.min(low[axis], value);
      high[axis] = Math.max(high[axis], value);
    });
  }
  const size: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const extent = high[axis] - low[axis] + 1;
    size[axis] = Math.min(extent, MAX_MODEL_SIZE);
    low[axis] += Math.floor((extent - size[axis]) / 2);
  }
  const model = createModel(size);
  for (const [key, color] of cells) {
    const cell = unpackCell(key).map((value, axis) => value - low[axis]);
    if (cell.every((value, axis) => value >= 0 && value < size[axis])) model.voxels[voxelIndex(size, cell[0], cell[1], cell[2])] = color;
  }
  return { model, low };
}

/**
 * MagicaVoxel's object booleans. Union and intersection replace the selection with one new object;
 * subtraction and replacement edit the selected objects with the operands picked before (`ooper`).
 */
export function createObjectBooleans(editor: Editor) {
  const { state } = editor;
  const change = sceneChange(editor);
  let operands: number[] = [];
  editor.subscribe((event) => {
    if (event.type === 'document') operands = [];
  });

  /** Instances drawn by each selected node, in selection order. */
  const selectedInstances = (ids: number[]) => {
    const parents = parentMap(state.vox);
    return ids.map((id) => instancesUnder(state.instances, parents, id));
  };

  /** Swaps the selected nodes for one new object built from `cells`, in the first one's place. */
  const replaceWithObject = (cells: Map<number, number>, message: string) => {
    const built = modelFromCells(cells);
    const levelId = state.level ?? rootLevel(state.vox) ?? -1;
    const level = groupNode(state.vox, levelId);
    if (!built || !level) return editor.status('O resultado ficou vazio', 'error');
    const parent = parentPose(state.vox, parentMap(state.vox), levelId, state.frame);
    const pivot = modelPivot(built.model.size);
    const world: Vec3 = [built.low[0] + pivot[0], built.low[1] + pivot[1], built.low[2] + pivot[2]];
    const local = applyRows(transposeRows(parent.rows), [world[0] - parent.translation[0], world[1] - parent.translation[1], world[2] - parent.translation[2]]);
    const transformId = state.vox.nodes.length;
    const modelId = state.vox.models.length;
    const nodes: [TransformNode, ShapeNode] = [
      { kind: 'transform', attrs: new Map(), child: transformId + 1, layer: state.layer, keys: [{ frame: 0, translation: local, rotation: IDENTITY_ROTATION }] },
      { kind: 'shape', attrs: new Map(), keys: [{ frame: 0, model: modelId }] },
    ];
    const before = level.children;
    const position = Math.min(...state.selection.map((id) => before.indexOf(id)).filter((index) => index >= 0));
    const after = before.filter((id) => !state.selection.includes(id));
    after.splice(Math.min(position, after.length), 0, transformId);
    const previous = state.selection;
    change(
      () => {
        state.vox.nodes.push(...nodes);
        state.vox.models.push(built.model);
        level.children = after;
        editor.setSelection([transformId]);
      },
      () => {
        level.children = before;
        state.vox.nodes.splice(transformId);
        state.vox.models.splice(modelId);
        editor.setSelection(previous);
      },
      message,
    );
  };

  /** Recolours or empties the voxels of every selected object where an operand has a voxel. */
  const editTargets = (edit: (current: number, operand: number) => number, message: string) => {
    if (operands.length === 0) return editor.status('Escolha os operandos primeiro (botão Operandos)', 'error');
    const operandCells = new Map<number, number>();
    selectedInstances(operands)
      .flat()
      .forEach((instance) => worldCells(instance, state.vox.models).forEach((color, key) => operandCells.set(key, color)));
    const targets = selectedInstances(state.selection.filter((id) => !operands.includes(id))).flat();
    if (targets.length === 0) return editor.status('Selecione os objetos a editar (além dos operandos)', 'error');
    const edits = [...new Set(targets.map((instance) => instance.model))].flatMap((modelId) => {
      const instance = targets.find((target) => target.model === modelId);
      if (!instance) return [];
      const model = state.vox.models[modelId];
      const next = model.voxels.slice();
      let changed = false;
      model.voxels.forEach((color, index) => {
        if (color === EMPTY_VOXEL) return;
        const operand = operandCells.get(worldCellOf(instance.pose, model, index));
        if (operand === undefined) return;
        next[index] = edit(color, operand);
        changed ||= next[index] !== color;
      });
      return changed ? [{ modelId, before: model, after: { size: model.size, voxels: next } }] : [];
    });
    if (edits.length === 0) return editor.status('Os operandos não tocam a seleção');
    change(
      () => edits.forEach(({ modelId, after }) => (state.vox.models[modelId] = after)),
      () => edits.forEach(({ modelId, before }) => (state.vox.models[modelId] = before)),
      message,
    );
  };

  return {
    /** MagicaVoxel `ounion`: one object with every selected voxel (later selections win where they overlap). */
    unionSelected() {
      const groups = selectedInstances(state.selection);
      if (groups.flat().length < 2) return editor.status('Selecione dois ou mais objetos (ou um grupo) para unir', 'error');
      const cells = new Map<number, number>();
      groups.flat().forEach((instance) => worldCells(instance, state.vox.models).forEach((color, key) => cells.set(key, color)));
      replaceWithObject(cells, 'Objetos unidos');
    },

    /** MagicaVoxel `ointer`: one object with the voxels every selected object has (colours of the first). */
    intersectSelected() {
      const groups = selectedInstances(state.selection).filter((instances) => instances.length > 0);
      if (groups.length < 2) return editor.status('Selecione dois ou mais objetos para intersectar', 'error');
      const [first, ...rest] = groups.map((instances) => {
        const cells = new Map<number, number>();
        instances.forEach((instance) => worldCells(instance, state.vox.models).forEach((color, key) => cells.set(key, color)));
        return cells;
      });
      const shared = new Map([...first].filter(([key]) => rest.every((cells) => cells.has(key))));
      replaceWithObject(shared, 'Interseção criada');
    },

    /** MagicaVoxel `ooper`: the selection becomes the operands of the next subtraction or replacement. */
    pickOperands() {
      operands = [...state.selection];
      editor.status(operands.length ? `${operands.length} operando(s) escolhido(s); selecione os alvos` : 'Operandos limpos');
    },

    /** MagicaVoxel `osub`: removes from the selected objects every voxel an operand has. */
    subtractSelected() {
      editTargets(() => EMPTY_VOXEL, 'Operandos subtraídos');
    },

    /** MagicaVoxel `orep`: recolours the selected objects' voxels with the operands' colours where they overlap. */
    replaceSelected() {
      editTargets((_current, operand) => operand, 'Voxels substituídos pelos operandos');
    },
  };
}

