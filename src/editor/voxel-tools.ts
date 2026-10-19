import type { Axis } from '../format/rotation.ts';
import { cellOf, EMPTY_VOXEL, isInside, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { chunksTouching } from '../geometry/mesher.ts';
import type { ClientRect, Viewport } from '../render/viewport.ts';
import { addScaled, AXES, alongAxes, axisOf, cellsBetween, centeredShape, colorRegion, faceRegion, lineCells, stampCells, stampOutward, withMirrors } from './brush-shapes.ts';
import type { BrushMode, BrushType, Editor } from './editor.ts';
import { mergeMask, selectionMode } from './voxel-selection.ts';
import type { SelectionMode } from './voxel-selection.ts';

/** Pointer modifiers: Alt picks a colour, Shift adds to a selection and Shift+Alt removes from it. */
export type PointerModifiers = { altKey: boolean; shiftKey: boolean; ctrlKey: boolean };

/** A brush cell and the face plane it was found on; attach strokes keep that plane while dragging. */
type Target = { cell: Vec3; axis: Axis; plane: number };
/** Voxel index -> [colour before the stroke, colour now]. */
type Changes = Map<number, [number, number]>;
/** A face stroke: the region picked at press, and the screen direction its normal points to. */
type FaceStroke = { region: Vec3[]; normal: Vec3; start: [number, number]; screenNormal: [number, number]; layers: number };
/** A selecting stroke collects the filled cells it reaches and merges them into the selection it started from. */
type StrokeSelection = { previous: Uint8Array | null; picked: Set<number>; mode: SelectionMode };
type Stroke = {
  model: VoxModel;
  transformId: number;
  anchor: Target;
  last: Target;
  changes: Changes;
  face: FaceStroke | null;
  /** Client position of the press, for lines projected onto the surface. */
  start: [number, number];
  selection: StrokeSelection | null;
};
/** A marquee rectangle being dragged. */
type Marquee = { transformId: number; model: VoxModel; rect: ClientRect; previous: Uint8Array | null; mode: SelectionMode };
/** Selected voxels lifted by the transform tool, following the pointer on the plane of the face it grabbed. */
type Move = { model: VoxModel; transformId: number; anchor: Target; lifted: [number, number][]; offset: Vec3; changes: Changes; oneAxis: boolean; startMask: Uint8Array };

type Effect = 'attach' | 'erase' | 'paint' | 'select';
/** What each brush action does to a cell; `pick` and `xform` change none. */
const EFFECTS: Record<BrushType, Effect | null> = {
  attach: 'attach',
  erase: 'erase',
  paint: 'paint',
  remove: 'erase',
  replace: 'paint',
  pick: null,
  msel: 'select',
  asel: 'select',
  xform: null,
};
/** Actions that apply once to the region under the click, ignoring brush mode, mirror and axis mode. */
const isRegionAction = (type: BrushType) => type === 'pick' || type === 'remove' || type === 'replace' || type === 'asel';
/** A click without a drag selects the voxel under it instead of a rectangle. */
const MARQUEE_CLICK = 3;

/** Screen pixels between surface samples of a projected line. */
const PROJECTION_STEP = 2;

/** Pixels of vertical drag per layer when the face normal points at the camera. */
const PIXELS_PER_LAYER = 12;

const regionBounds = (region: Vec3[]): [Vec3, Vec3] => [
  [Math.min(...region.map((cell) => cell[0])), Math.min(...region.map((cell) => cell[1])), Math.min(...region.map((cell) => cell[2]))],
  [Math.max(...region.map((cell) => cell[0])), Math.max(...region.map((cell) => cell[1])), Math.max(...region.map((cell) => cell[2]))],
];

/**
 * Model editor strokes (MagicaVoxel `b_mode` x `b_type`):
 * - `vox` stamps the brush (size, cube/ball, 2D/3D) under the pointer; dragging an attach
 *   stroke stays on the plane where it started instead of stacking toward the camera;
 * - `face` works on the flat face region under the pointer: attach extrudes it and erase digs
 *   into it by as many layers as the drag along the normal, paint recolours it;
 * - `box` previews the box between press and pointer live, reverting and redrawing it;
 * - `geo` previews a line, square or circle on the plane where the drag started (a projected
 *   line instead follows the surface under the dragged screen segment).
 * Every stroke goes through axis mode and mirror, and is one undo step. Alt+click (or `pick`) takes
 * the colour under the pointer; `remove` and `replace` clear or recolour the region under the click.
 */
export function createVoxelTools(editor: Editor, viewport: Viewport) {
  const { state } = editor;
  let stroke: Stroke | null = null;
  let marquee: Marquee | null = null;
  let move: Move | null = null;

  /** The box marquee is the box brush selecting; every other stroke follows `b_mode`. */
  const brushMode = (): BrushMode => (state.brushType === 'msel' && state.marquee === 'box' ? 'box' : state.brushMode);

  const edited = () => {
    const instance = editor.selectedInstance();
    return instance ? { transformId: instance.transformId, model: state.vox.models[instance.model] } : null;
  };

  /** The face position of a hit: the side of the voxel the ray entered through. */
  const facePlane = (voxel: Vec3, normal: Vec3, axis: Axis) => voxel[axis] + Math.max(normal[axis], 0);

  const targetAt = (clientX: number, clientY: number, model: VoxModel, transformId: number): Target | null => {
    const { brushType } = state;
    const locked = stroke && (brushType === 'attach' || brushMode() === 'geo') ? stroke.anchor : null;
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
  const brushCells = (active: Stroke, target: Target, pointer: [number, number]): Iterable<Vec3> => {
    if (brushMode() === 'box') return cellsBetween(active.anchor.cell, target.cell);
    if (brushMode() === 'geo') return geoCells(active, target, pointer);
    const path = state.brushType === 'attach' ? lineCells(active.last.cell, target.cell) : [target.cell];
    return path.flatMap((cell) => stamp({ ...target, cell }));
  };

  /** Applies the brush action to `cells` (after axis mode and mirror for strokes), adding the chunks it touched to `chunks`. */
  const apply = (active: Stroke, cells: Iterable<Vec3>, chunks: Set<number>, colorFor: (cell: Vec3) => number = () => state.color) => {
    const { model, changes } = active;
    const effect = EFFECTS[state.brushType];
    if (!effect) return;
    const reached = isRegionAction(state.brushType) ? cells : withMirrors(alongAxes(cells, model.size, state.axes), model.size, state.mirror);
    for (const cell of reached) {
      if (!isInside(model.size, cell)) continue;
      const index = voxelIndex(model.size, cell[0], cell[1], cell[2]);
      const current = model.voxels[index];
      if (effect === 'select') {
        if (current !== EMPTY_VOXEL) active.selection?.picked.add(index);
        continue;
      }
      const after = effect === 'erase' ? EMPTY_VOXEL : colorFor(cell);
      const skips = current === after || (effect === 'paint' && current === EMPTY_VOXEL) || (effect === 'attach' && current !== EMPTY_VOXEL);
      if (skips) continue;
      changes.set(index, [changes.get(index)?.[0] ?? current, after]);
      model.voxels[index] = after;
      chunksTouching(model.size, cell).forEach((chunk) => chunks.add(chunk));
    }
  };

  /** Puts back every voxel the stroke changed (and forgets what it selected), for redrawing a live preview. */
  const revert = ({ model, changes, selection }: { model: VoxModel; changes: Changes; selection?: StrokeSelection | null }, chunks: Set<number>) => {
    for (const [index, [before]] of changes) {
      model.voxels[index] = before;
      chunksTouching(model.size, cellOf(model.size, index)).forEach((chunk) => chunks.add(chunk));
    }
    changes.clear();
    selection?.picked.clear();
  };

  /**
   * Shows the stroke's selection merged into the one it started from.
   * ponytail: rebuilds a full-size mask and the highlight mesh per pointer move; throttle or diff if huge models lag.
   */
  const publishSelection = ({ model, selection }: Stroke) => {
    if (!selection) return;
    const picked = new Uint8Array(model.voxels.length);
    selection.picked.forEach((index) => (picked[index] = 1));
    editor.setVoxelSelection({ model, mask: mergeMask(model, selection.previous, picked, selection.mode) });
  };

  /** Cells under the screen segment from the press to the pointer, attach ones on the hit face. */
  const surfacePath = (active: Stroke, clientX: number, clientY: number): Vec3[] => {
    const [startX, startY] = active.start;
    const samples = Math.max(1, Math.ceil(Math.hypot(clientX - startX, clientY - startY) / PROJECTION_STEP));
    const cells = new Map<string, Vec3>();
    for (let sample = 0; sample <= samples; sample++) {
      const t = sample / samples;
      const hit = viewport.pick(startX + (clientX - startX) * t, startY + (clientY - startY) * t, active.transformId)?.hit;
      if (!hit) continue;
      const cell = state.brushType === 'attach' ? addScaled(hit.voxel, hit.normal, 1) : hit.voxel;
      cells.set(`${cell}`, cell);
    }
    return [...cells.values()];
  };

  const geoCells = (active: Stroke, target: Target, pointer: [number, number]): Vec3[] => {
    const { shape, project } = state.geoBrush;
    if (shape === 'line') return project ? surfacePath(active, pointer[0], pointer[1]) : lineCells(active.anchor.cell, target.cell);
    return centeredShape(shape, active.anchor.cell, target.cell, active.anchor.axis, state.geoBrush);
  };

  /** Box and geometry strokes are previews: the previous shape is reverted before the new one is drawn. */
  const draw = (active: Stroke, target: Target, pointer: [number, number]) => {
    const chunks = new Set<number>();
    if (brushMode() === 'box' || brushMode() === 'geo') revert(active, chunks);
    apply(active, brushCells(active, target, pointer), chunks);
    active.last = target;
    if (chunks.size > 0) editor.voxelsChanged(active.model, chunks);
    publishSelection(active);
  };

  /** Extruded voxels copy the colour of the face they grow from (`b_face_pal` off), searching both ways so mirrored copies find theirs. */
  const faceColor = ({ model }: Stroke, { normal, layers }: FaceStroke) => (cell: Vec3) => {
    if (state.faceBrush.usePalette) return state.color;
    for (let step = 1; step <= layers; step++) {
      for (const source of [addScaled(cell, normal, -step), addScaled(cell, normal, step)]) {
        const color = isInside(model.size, source) ? model.voxels[voxelIndex(model.size, source[0], source[1], source[2])] : EMPTY_VOXEL;
        if (color !== EMPTY_VOXEL) return color;
      }
    }
    return state.color;
  };

  const drawFace = (active: Stroke, face: FaceStroke) => {
    const { brushType } = state;
    const chunks = new Set<number>();
    revert(active, chunks);
    const layers = brushType === 'attach' || brushType === 'erase' ? face.layers : 1;
    const first = brushType === 'attach' ? 1 : 0;
    const direction = brushType === 'attach' ? 1 : -1;
    const cells = Array.from({ length: layers }, (_unused, layer) => face.region.map((cell) => addScaled(cell, face.normal, direction * (first + layer)))).flat();
    apply(active, cells, chunks, faceColor(active, face));
    if (chunks.size > 0) editor.voxelsChanged(active.model, chunks);
    publishSelection(active);
  };

  /** Layers follow the drag along the face normal on screen; attach extrudes outward, erase digs inward. */
  const layersAt = (face: FaceStroke, clientX: number, clientY: number) => {
    const [sx, sy] = face.screenNormal;
    const lengthSquared = sx * sx + sy * sy;
    const [dx, dy] = [clientX - face.start[0], clientY - face.start[1]];
    const along = lengthSquared < 16 ? -dy / PIXELS_PER_LAYER : (dx * sx + dy * sy) / lengthSquared;
    return Math.max(1, 1 + Math.round(state.brushType === 'erase' ? -along : along));
  };

  const beginFace = (object: { transformId: number; model: VoxModel }, clientX: number, clientY: number, selection: StrokeSelection | null) => {
    const hit = viewport.pick(clientX, clientY, object.transformId)?.hit;
    if (!hit || hit.normal.every((value) => value === 0)) return;
    const region = faceRegion(object.model, hit.voxel, hit.normal, state.faceBrush);
    const center: Vec3 = [hit.voxel[0] + 0.5 + hit.normal[0] / 2, hit.voxel[1] + 0.5 + hit.normal[1] / 2, hit.voxel[2] + 0.5 + hit.normal[2] / 2];
    const from = viewport.project(object.transformId, center);
    const to = viewport.project(object.transformId, addScaled(center, hit.normal, 1));
    if (region.length === 0 || !from || !to) return;
    const axis = axisOf(hit.normal);
    const target: Target = { cell: hit.voxel, axis, plane: facePlane(hit.voxel, hit.normal, axis) };
    const face: FaceStroke = { region, normal: hit.normal, start: [clientX, clientY], screenNormal: [to[0] - from[0], to[1] - from[1]], layers: 1 };
    stroke = { ...object, anchor: target, last: target, changes: new Map(), face, start: [clientX, clientY], selection };
    drawFace(stroke, face);
  };

  /** `remove` / `replace` / `asel`: one click clears, recolours or selects the region under it (edits are one undo step). */
  const applyRegion = (object: { transformId: number; model: VoxModel }, clientX: number, clientY: number, selection: StrokeSelection | null) => {
    const hit = viewport.pick(clientX, clientY, object.transformId)?.hit;
    if (!hit) {
      if (selection?.mode === 'replace') editor.setVoxelSelection(null);
      return;
    }
    const target: Target = { cell: hit.voxel, axis: axisOf(hit.normal), plane: 0 };
    stroke = { ...object, anchor: target, last: target, changes: new Map(), face: null, start: [clientX, clientY], selection };
    const chunks = new Set<number>();
    apply(stroke, colorRegion(object.model, hit.voxel, state.regionBrush), chunks);
    if (chunks.size > 0) editor.voxelsChanged(object.model, chunks);
    publishSelection(stroke);
  };

  /** Marquee by rectangle: on release, every filled voxel whose centre falls inside it, through the whole depth. */
  const finishMarquee = ({ transformId, model, rect, previous, mode }: Marquee) => {
    viewport.showMarquee(null);
    const isClick = Math.abs(rect.x1 - rect.x0) < MARQUEE_CLICK && Math.abs(rect.y1 - rect.y0) < MARQUEE_CLICK;
    const picked = isClick ? new Uint8Array(model.voxels.length) : viewport.rectCells(transformId, rect);
    if (!picked) return;
    const hit = isClick ? viewport.pick(rect.x0, rect.y0, transformId)?.hit : undefined;
    if (hit) picked[voxelIndex(model.size, hit.voxel[0], hit.voxel[1], hit.voxel[2])] = 1;
    const mask = mergeMask(model, previous, picked, mode);
    editor.setVoxelSelection(mask.some((selected) => selected) ? { model, mask } : null);
  };

  /** Transform tool: grabs the selected voxels on the face under the pointer. */
  const beginMove = (object: { transformId: number; model: VoxModel }, clientX: number, clientY: number, oneAxis: boolean) => {
    const mask = editor.selectionOf(object.model);
    if (!mask) return editor.status('Selecione voxels para mover (M ou N)', 'error');
    const lifted: [number, number][] = [];
    mask.forEach((selected, index) => {
      if (selected && object.model.voxels[index] !== EMPTY_VOXEL) lifted.push([index, object.model.voxels[index]]);
    });
    if (lifted.length === 0) return editor.status('Selecione voxels para mover (M ou N)', 'error');
    const hit = viewport.pick(clientX, clientY, object.transformId)?.hit;
    const axis = hit ? axisOf(hit.normal) : 2;
    const anchor: Target = hit ? { cell: hit.voxel, axis, plane: facePlane(hit.voxel, hit.normal, axis) } : { cell: [0, 0, 0], axis: 2, plane: 0 };
    move = { ...object, anchor, lifted, offset: [0, 0, 0], changes: new Map(), oneAxis, startMask: mask };
  };

  /**
   * Moves the lifted voxels by `offset`, wrapping around the volume (MagicaVoxel `Move/Loop`);
   * with Ctrl only along the axis the pointer moved most.
   */
  const dragMove = (active: Move, clientX: number, clientY: number) => {
    const { model, anchor } = active;
    const cell = viewport.planeCell(clientX, clientY, active.transformId, anchor.axis, anchor.plane, anchor.cell[anchor.axis]);
    if (!cell) return;
    const offset: Vec3 = [cell[0] - anchor.cell[0], cell[1] - anchor.cell[1], cell[2] - anchor.cell[2]];
    if (active.oneAxis) {
      const longest = AXES.reduce((best, axis) => (Math.abs(offset[axis]) > Math.abs(offset[best]) ? axis : best));
      AXES.forEach((axis) => axis !== longest && (offset[axis] = 0));
    }
    if (offset.every((value, axis) => value === active.offset[axis])) return;
    active.offset = offset;
    const chunks = new Set<number>();
    revert(active, chunks);
    const write = (index: number, color: number) => {
      const current = model.voxels[index];
      if (current === color) return;
      active.changes.set(index, [active.changes.get(index)?.[0] ?? current, color]);
      model.voxels[index] = color;
      chunksTouching(model.size, cellOf(model.size, index)).forEach((chunk) => chunks.add(chunk));
    };
    active.lifted.forEach(([index]) => write(index, EMPTY_VOXEL));
    const mask = new Uint8Array(model.voxels.length);
    for (const [index, color] of active.lifted) {
      const moved = cellOf(model.size, index).map((value, axis) => (((value + offset[axis]) % model.size[axis]) + model.size[axis]) % model.size[axis]);
      const target = voxelIndex(model.size, moved[0], moved[1], moved[2]);
      write(target, color);
      mask[target] = 1;
    }
    if (chunks.size > 0) editor.voxelsChanged(model, chunks);
    editor.setVoxelSelection({ model, mask });
  };

  /** Hover outline of the face region under the pointer, cached while the pointer stays on the same face. */
  let hoverKey = '';
  let hoverBounds: [Vec3, Vec3] | null = null;
  const showFaceHover = (object: { transformId: number; model: VoxModel }, clientX: number, clientY: number) => {
    const hit = viewport.pick(clientX, clientY, object.transformId)?.hit;
    const key = hit ? `${hit.voxel}|${hit.normal}` : '';
    if (key !== hoverKey) {
      hoverKey = key;
      const region = hit ? faceRegion(object.model, hit.voxel, hit.normal, state.faceBrush) : [];
      hoverBounds = region.length > 0 ? regionBounds(region) : null;
    }
    viewport.showHover(hoverBounds ? object.transformId : null, hoverBounds?.[0], hoverBounds?.[1]);
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
    begin(clientX: number, clientY: number, modifiers: PointerModifiers) {
      const { brushType } = state;
      if ((modifiers.altKey && !modifiers.shiftKey) || brushType === 'pick') return pickColor(clientX, clientY);
      const object = edited();
      if (!object) return;
      if (brushType === 'xform') return beginMove(object, clientX, clientY, modifiers.ctrlKey);
      const mode = selectionMode(modifiers);
      const selection = EFFECTS[brushType] === 'select' ? { previous: editor.selectionOf(object.model), picked: new Set<number>(), mode } : null;
      if (brushType === 'msel' && state.marquee === 'rect') {
        marquee = { ...object, rect: { x0: clientX, y0: clientY, x1: clientX, y1: clientY }, previous: selection?.previous ?? null, mode };
        return viewport.showMarquee(marquee.rect);
      }
      if (isRegionAction(brushType)) return applyRegion(object, clientX, clientY, selection);
      if (brushMode() === 'face') return beginFace(object, clientX, clientY, selection);
      const target = targetAt(clientX, clientY, object.model, object.transformId);
      if (!target) return selection?.mode === 'replace' ? editor.setVoxelSelection(null) : undefined;
      stroke = { ...object, anchor: target, last: target, changes: new Map(), face: null, start: [clientX, clientY], selection };
      draw(stroke, target, [clientX, clientY]);
    },

    move(clientX: number, clientY: number) {
      if (marquee) {
        marquee.rect = { ...marquee.rect, x1: clientX, y1: clientY };
        return viewport.showMarquee(marquee.rect);
      }
      if (move) return dragMove(move, clientX, clientY);
      if (stroke?.face) {
        const layers = layersAt(stroke.face, clientX, clientY);
        if (layers !== stroke.face.layers) drawFace(stroke, { ...stroke.face, layers });
        stroke.face.layers = layers;
        return;
      }
      const object = stroke ?? edited();
      if (!stroke && object && brushMode() === 'face') return showFaceHover(object, clientX, clientY);
      if (!stroke && (state.brushType === 'xform' || (state.brushType === 'msel' && state.marquee === 'rect'))) return viewport.showHover(null);
      const target = object && targetAt(clientX, clientY, object.model, object.transformId);
      if (stroke?.anchor && brushMode() === 'box') viewport.showHover(stroke.transformId, stroke.anchor.cell, target?.cell ?? stroke.anchor.cell);
      else viewport.showHover(object && target ? object.transformId : null, target?.cell);
      if (stroke && target && !isRegionAction(state.brushType)) draw(stroke, target, [clientX, clientY]);
    },

    end() {
      if (marquee) finishMarquee(marquee);
      marquee = null;
      const moved = move;
      const finished = stroke ?? move;
      stroke = null;
      move = null;
      hoverKey = '';
      if (!finished || finished.changes.size === 0) return;
      const { model, changes } = finished;
      if (moved) {
        const endMask = editor.selectionOf(model);
        const reselect = (mask: Uint8Array | null) => editor.setVoxelSelection(mask && { model, mask });
        return editor.history.push({
          undo: () => {
            restore(model, changes, 0);
            reselect(moved.startMask);
          },
          redo: () => {
            restore(model, changes, 1);
            reselect(endMask);
          },
        });
      }
      editor.history.push({ undo: () => restore(model, changes, 0), redo: () => restore(model, changes, 1) });
    },
  };
}
