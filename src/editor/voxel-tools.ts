import { cellOf, EMPTY_VOXEL, isInside, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { chunksTouching } from '../geometry/mesher.ts';
import type { Viewport } from '../render/viewport.ts';
import type { Editor } from './editor.ts';

type Target = { transformId: number; model: VoxModel; cell: Vec3 };
/** Per model: voxel index -> [colour before the stroke, colour after]. */
type Stroke = Map<VoxModel, Map<number, [number, number]>>;
type BoxDrag = { anchor: Target; end: Vec3 };

const isZero = (vector: Vec3) => vector.every((axis) => axis === 0);

function* cellsBetween(from: Vec3, to: Vec3): Generator<Vec3> {
  const [low, high] = [from.map((axis, i) => Math.min(axis, to[i])), from.map((axis, i) => Math.max(axis, to[i]))];
  for (let z = low[2]; z <= high[2]; z++) {
    for (let y = low[1]; y <= high[1]; y++) {
      for (let x = low[0]; x <= high[0]; x++) yield [x, y, z];
    }
  }
}

/**
 * Voxel brush: attach places one voxel per click (dragging would stack toward the camera),
 * erase and paint keep applying while held. Box brush: press, drag and release to apply
 * the tool to the whole box. Alt+click picks the colour under the cursor.
 * One stroke = one undo step.
 */
export function createVoxelTools(editor: Editor, viewport: Viewport) {
  const { state } = editor;
  let stroke: Stroke | null = null;
  let dragging = false;
  let box: BoxDrag | null = null;

  const modelOf = (transformId: number): VoxModel | undefined => {
    const instance = state.instances.find((candidate) => candidate.transformId === transformId);
    return instance && state.vox.models[instance.model];
  };

  const targetAt = (clientX: number, clientY: number): Target | null => {
    const { tool, selected } = state;
    const pick = viewport.pick(clientX, clientY);
    const model = pick && modelOf(pick.transformId);
    if (pick && model) {
      const { voxel, normal } = pick.hit;
      if (tool !== 'attach') return { transformId: pick.transformId, model, cell: voxel };
      const cell: Vec3 = [voxel[0] + normal[0], voxel[1] + normal[1], voxel[2] + normal[2]];
      return isZero(normal) || !isInside(model.size, cell) ? null : { transformId: pick.transformId, model, cell };
    }
    if (tool !== 'attach' || selected === null) return null;
    const selectedModel = modelOf(selected);
    const cell = selectedModel && viewport.floorCell(clientX, clientY, selected);
    return selectedModel && cell ? { transformId: selected, model: selectedModel, cell } : null;
  };

  /** Applies the current tool to `cells` and emits one remesh request for everything touched. */
  const applyTo = (model: VoxModel, cells: Iterable<Vec3>) => {
    const { tool, color } = state;
    const after = tool === 'erase' ? EMPTY_VOXEL : color;
    const chunks = new Set<number>();
    stroke ??= new Map();
    const changes = stroke.get(model) ?? new Map<number, [number, number]>();
    for (const cell of cells) {
      const index = voxelIndex(model.size, cell[0], cell[1], cell[2]);
      const before = model.voxels[index];
      const skips = before === after || (tool === 'paint' && before === EMPTY_VOXEL) || (tool === 'attach' && before !== EMPTY_VOXEL);
      if (skips) continue;
      changes.set(index, [changes.get(index)?.[0] ?? before, after]);
      model.voxels[index] = after;
      chunksTouching(model.size, cell).forEach((chunk) => chunks.add(chunk));
    }
    stroke.set(model, changes);
    if (chunks.size > 0) editor.voxelsChanged(model, chunks);
  };

  const restore = (applied: Stroke, side: 0 | 1) => {
    for (const [model, changes] of applied) {
      const chunks = new Set<number>();
      for (const [index, colors] of changes) {
        model.voxels[index] = colors[side];
        chunksTouching(model.size, cellOf(model.size, index)).forEach((chunk) => chunks.add(chunk));
      }
      editor.voxelsChanged(model, chunks);
    }
  };

  const pickColor = (clientX: number, clientY: number) => {
    const pick = viewport.pick(clientX, clientY);
    const model = pick && modelOf(pick.transformId);
    if (!pick || !model) return;
    const color = model.voxels[voxelIndex(model.size, pick.hit.voxel[0], pick.hit.voxel[1], pick.hit.voxel[2])];
    editor.setColor(color);
    editor.status(`Cor ${color} selecionada`);
  };

  return {
    begin(clientX: number, clientY: number, isColorPick: boolean) {
      if (isColorPick) return pickColor(clientX, clientY);
      if (state.tool === 'select') return editor.select(viewport.pick(clientX, clientY)?.transformId ?? null);
      const target = targetAt(clientX, clientY);
      if (!target) return;
      editor.select(target.transformId);
      if (state.brush === 'box') {
        box = { anchor: target, end: target.cell };
        return viewport.showHover(target.transformId, target.cell);
      }
      applyTo(target.model, [target.cell]);
      dragging = state.tool !== 'attach';
    },

    move(clientX: number, clientY: number) {
      const target = state.tool === 'select' ? null : targetAt(clientX, clientY);
      if (box) {
        if (target?.model === box.anchor.model) box.end = target.cell;
        return viewport.showHover(box.anchor.transformId, box.anchor.cell, box.end);
      }
      viewport.showHover(target?.transformId ?? null, target?.cell);
      if (dragging && target) applyTo(target.model, [target.cell]);
    },

    end() {
      if (box) applyTo(box.anchor.model, cellsBetween(box.anchor.cell, box.end));
      box = null;
      dragging = false;
      const applied = stroke;
      stroke = null;
      if (!applied || [...applied.values()].every((changes) => changes.size === 0)) return;
      editor.history.push({ undo: () => restore(applied, 0), redo: () => restore(applied, 1) });
    },
  };
}
