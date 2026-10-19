import type { Axis } from '../format/rotation.ts';
import { cellOf, EMPTY_VOXEL, isInside, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { chunksTouching } from '../geometry/mesher.ts';
import type { Viewport } from '../render/viewport.ts';
import { alongAxes, axisOf, cellsBetween, lineCells, stampCells, stampOutward, withMirrors } from './brush-shapes.ts';
import type { Editor } from './editor.ts';

/** A brush cell and the face plane it was found on; attach strokes keep that plane while dragging. */
type Target = { cell: Vec3; axis: Axis; plane: number };
/** Voxel index -> [colour before the stroke, colour now]. */
type Changes = Map<number, [number, number]>;
type Stroke = { model: VoxModel; transformId: number; anchor: Target; last: Target; changes: Changes };

/**
 * Model editor strokes (MagicaVoxel `b_mode` x `b_type`):
 * - `vox` stamps the brush (size, cube/ball, 2D/3D) under the pointer; dragging an attach
 *   stroke stays on the plane where it started instead of stacking toward the camera;
 * - `box` previews the box between press and pointer live, reverting and redrawing it.
 * Every stroke goes through axis mode and mirror, and is one undo step. Alt+click picks a colour.
 */
export function createVoxelTools(editor: Editor, viewport: Viewport) {
  const { state } = editor;
  let stroke: Stroke | null = null;

  const edited = () => {
    const instance = editor.selectedInstance();
    return instance ? { transformId: instance.transformId, model: state.vox.models[instance.model] } : null;
  };

  /** The face position of a hit: the side of the voxel the ray entered through. */
  const facePlane = (voxel: Vec3, normal: Vec3, axis: Axis) => voxel[axis] + Math.max(normal[axis], 0);

  const targetAt = (clientX: number, clientY: number, model: VoxModel, transformId: number): Target | null => {
    const { brushType } = state;
    const locked = stroke && brushType === 'attach' ? stroke.anchor : null;
    if (locked) {
      const cell = viewport.planeCell(clientX, clientY, transformId, locked.axis, locked.plane, locked.cell[locked.axis]);
      return cell && { ...locked, cell };
    }
    const hit = viewport.pick(clientX, clientY, transformId)?.hit;
    if (hit) {
      const axis = axisOf(hit.normal);
      const plane = facePlane(hit.voxel, hit.normal, axis);
      if (brushType !== 'attach') return { cell: hit.voxel, axis, plane };
      const cell: Vec3 = [hit.voxel[0] + hit.normal[0], hit.voxel[1] + hit.normal[1], hit.voxel[2] + hit.normal[2]];
      return hit.normal.every((value) => value === 0) || !isInside(model.size, cell) ? null : { cell, axis, plane };
    }
    const cell = brushType === 'attach' ? viewport.floorCell(clientX, clientY, transformId) : null;
    return cell && { cell, axis: 2, plane: 0 };
  };

  /** One stamp; attach stamps rest on the face they grow from. */
  const stamp = (target: Target): Vec3[] => {
    const { size, shape, volume } = state.voxBrush;
    const outward = target.cell[target.axis] >= target.plane ? 1 : -1;
    const center = state.brushType === 'attach' && volume ? stampOutward(target.cell, size, target.axis, outward) : target.cell;
    return stampCells(center, size, shape, volume ? null : target.axis);
  };

  /**
   * Box: the whole box. Voxel: an attach drag stamps every cell since the last pointer position
   * (both lie on the locked plane, so fast drags leave no gaps); erase and paint only stamp the
   * surface under the pointer, never the inside a straight line would cut through.
   */
  const brushCells = (active: Stroke, target: Target): Iterable<Vec3> => {
    if (state.brushMode === 'box') return cellsBetween(active.anchor.cell, target.cell);
    const path = state.brushType === 'attach' ? lineCells(active.last.cell, target.cell) : [target.cell];
    return path.flatMap((cell) => stamp({ ...target, cell }));
  };

  /** Applies the brush type to `cells` after axis mode and mirror; returns the chunks it touched. */
  const apply = (active: Stroke, cells: Iterable<Vec3>, chunks: Set<number>) => {
    const { model, changes } = active;
    const { brushType, color } = state;
    const after = brushType === 'erase' ? EMPTY_VOXEL : color;
    for (const cell of withMirrors(alongAxes(cells, model.size, state.axes), model.size, state.mirror)) {
      if (!isInside(model.size, cell)) continue;
      const index = voxelIndex(model.size, cell[0], cell[1], cell[2]);
      const current = model.voxels[index];
      const skips = current === after || (brushType === 'paint' && current === EMPTY_VOXEL) || (brushType === 'attach' && current !== EMPTY_VOXEL);
      if (skips) continue;
      changes.set(index, [changes.get(index)?.[0] ?? current, after]);
      model.voxels[index] = after;
      chunksTouching(model.size, cell).forEach((chunk) => chunks.add(chunk));
    }
  };

  /** Puts back every voxel the stroke changed, for redrawing a live preview. */
  const revert = ({ model, changes }: Stroke, chunks: Set<number>) => {
    for (const [index, [before]] of changes) {
      model.voxels[index] = before;
      chunksTouching(model.size, cellOf(model.size, index)).forEach((chunk) => chunks.add(chunk));
    }
    changes.clear();
  };

  /** Box strokes are previews: the previous box is reverted before the new one is drawn. */
  const draw = (active: Stroke, target: Target) => {
    const chunks = new Set<number>();
    if (state.brushMode === 'box') revert(active, chunks);
    apply(active, brushCells(active, target), chunks);
    active.last = target;
    if (chunks.size > 0) editor.voxelsChanged(active.model, chunks);
  };

  const restore = (model: VoxModel, changes: Changes, side: 0 | 1) => {
    const chunks = new Set<number>();
    for (const [index, colors] of changes) {
      model.voxels[index] = colors[side];
      chunksTouching(model.size, cellOf(model.size, index)).forEach((chunk) => chunks.add(chunk));
    }
    editor.voxelsChanged(model, chunks);
  };

  const pickColor = (clientX: number, clientY: number) => {
    const pick = viewport.pick(clientX, clientY);
    const instance = pick && state.instances.find((candidate) => candidate.transformId === pick.transformId);
    if (!pick || !instance) return;
    const model = state.vox.models[instance.model];
    const color = model.voxels[voxelIndex(model.size, pick.hit.voxel[0], pick.hit.voxel[1], pick.hit.voxel[2])];
    editor.setColor(color);
    editor.status(`Cor ${color} selecionada`);
  };

  return {
    begin(clientX: number, clientY: number, isColorPick: boolean) {
      if (isColorPick) return pickColor(clientX, clientY);
      const object = edited();
      const target = object && targetAt(clientX, clientY, object.model, object.transformId);
      if (!object || !target) return;
      stroke = { ...object, anchor: target, last: target, changes: new Map() };
      draw(stroke, target);
    },

    move(clientX: number, clientY: number) {
      const object = stroke ?? edited();
      const target = object && targetAt(clientX, clientY, object.model, object.transformId);
      if (stroke?.anchor && state.brushMode === 'box') viewport.showHover(stroke.transformId, stroke.anchor.cell, target?.cell ?? stroke.anchor.cell);
      else viewport.showHover(object && target ? object.transformId : null, target?.cell);
      if (stroke && target) draw(stroke, target);
    },

    end() {
      const finished = stroke;
      stroke = null;
      if (!finished || finished.changes.size === 0) return;
      const { model, changes } = finished;
      editor.history.push({ undo: () => restore(model, changes, 0), redo: () => restore(model, changes, 1) });
    },
  };
}
