import type { Axis } from '../format/rotation.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { chunkCounts } from '../geometry/mesher.ts';
import type { Viewport } from '../render/viewport.ts';
import { addScaled, axisOf } from './brush-shapes.ts';
import type { Editor } from './editor.ts';
import { rotate, scale, tile } from './model-ops.ts';
import { selectionBounds, transformSelection } from './voxel-selection.ts';
import type { Anchor } from './voxel-selection.ts';

/** Degrees of rotation per pixel of horizontal drag, and the step Shift snaps to. */
const DEGREES_PER_PIXEL = 0.5;
const SNAP_DEGREES = 15;

/**
 * One transform session: every drag is recomputed from the voxels the session started with, so
 * repeated drags never resample an already scaled or rotated result (MagicaVoxel previews until
 * Enter). Each release is an undo step; Enter ends the session and Esc puts the original back.
 */
type Session = {
  model: VoxModel;
  tool: 'scale' | 'wrap' | 'rotate';
  original: Uint8Array;
  startMask: Uint8Array;
  /** The grabbed face's axis and side, and the selection box length on that axis. */
  axis: Axis;
  side: 1 | -1;
  length: number;
  /** Cells added (scale, wrap) or degrees turned (rotate), accumulated over the session's drags. */
  amount: number;
  /** The voxels this session last wrote, to tell whether something else edited the model since. */
  written: Uint8Array;
  writtenMask: Uint8Array;
};
type Drag = { start: [number, number]; screenNormal: [number, number]; base: number; twoSided: boolean; snap: boolean; before: Uint8Array; beforeMask: Uint8Array };

const sameVoxels = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((value, index) => value === right[index]);

const allChunks = (model: VoxModel) => {
  const [x, y, z] = chunkCounts(model.size);
  return new Set(Array.from({ length: x * y * z }, (_unused, chunk) => chunk));
};

/** MagicaVoxel's transform options besides move: scale, wrap and rotate the selection by dragging one of its faces. */
export function createTransformTool(editor: Editor, viewport: Pick<Viewport, 'pick' | 'project'>) {
  const { state } = editor;
  let session: Session | null = null;
  let drag: Drag | null = null;

  const write = (model: VoxModel, voxels: Uint8Array, mask: Uint8Array) => {
    model.voxels.set(voxels);
    editor.voxelsChanged(model, allChunks(model));
    editor.setVoxelSelection({ model, mask });
  };

  /** The session's result for `amount`: the original selection scaled, wrapped or turned. */
  const compute = (active: Session, amount: number, twoSided: boolean) => {
    const { axis, side, length } = active;
    const source: VoxModel = { size: active.model.size, voxels: active.original };
    const anchors: Anchor[] = ['center', 'center', 'center'];
    if (!twoSided && active.tool !== 'rotate') anchors[axis] = side > 0 ? 'low' : 'high';
    if (active.tool === 'rotate') return transformSelection(source, active.startMask, (part) => rotate(part, axis, amount), anchors);
    const grown = Math.max(1, length + amount * (twoSided ? 2 : 1));
    if (active.tool === 'scale') {
      const factors: Vec3 = [1, 1, 1];
      factors[axis] = grown / length;
      return transformSelection(source, active.startMask, (part) => scale(part, factors), anchors);
    }
    const spacing = state.wrapSpacing[axis];
    const phase = twoSided ? Math.max(amount, 0) : side > 0 ? 0 : grown - length;
    return transformSelection(source, active.startMask, (part) => tile(part, axis, Math.max(grown, length), spacing, phase), anchors);
  };

  const finish = () => {
    if (!session) return false;
    session = null;
    editor.status('Transformação aplicada');
    return true;
  };

  return {
    active: () => session !== null,
    finish,

    /** Esc: back to the voxels and selection the session started from, as one undo step. */
    cancel() {
      const active = session;
      if (!active) return false;
      session = null;
      const { model, original, startMask, written, writtenMask } = active;
      write(model, original, startMask);
      editor.history.push({ undo: () => write(model, written, writtenMask), redo: () => write(model, original, startMask) });
      editor.status('Transformação cancelada');
      return true;
    },

    begin(object: { transformId: number; model: VoxModel }, clientX: number, clientY: number, modifiers: { shiftKey: boolean }) {
      const tool = state.transformTool;
      if (tool === 'move') return;
      const mask = editor.selectionOf(object.model);
      const bounds = mask && selectionBounds(object.model.size, mask);
      if (!mask || !bounds) return editor.status('Selecione voxels para transformar (M ou N)', 'error');
      const continues = session?.model === object.model && session.tool === tool && sameVoxels(object.model.voxels, session.written);
      if (!continues) {
        const hit = viewport.pick(clientX, clientY, object.transformId)?.hit;
        if (!hit || hit.normal.every((value) => value === 0)) return editor.status('Arraste uma face da seleção', 'error');
        const axis = axisOf(hit.normal);
        session = {
          model: object.model,
          tool,
          original: object.model.voxels.slice(),
          startMask: mask,
          axis,
          side: hit.normal[axis] > 0 ? 1 : -1,
          length: bounds[1][axis] - bounds[0][axis] + 1,
          amount: 0,
          written: object.model.voxels.slice(),
          writtenMask: mask,
        };
      }
      const active = session;
      if (!active) return;
      const normal: Vec3 = [0, 0, 0];
      normal[active.axis] = active.side;
      const middle = (axis: Axis) => (bounds[0][axis] + bounds[1][axis] + 1) / 2;
      const center: Vec3 = [middle(0), middle(1), middle(2)];
      const from = viewport.project(object.transformId, center);
      const to = viewport.project(object.transformId, addScaled(center, normal, 1));
      drag = {
        start: [clientX, clientY],
        screenNormal: from && to ? [to[0] - from[0], to[1] - from[1]] : [1, 0],
        base: active.amount,
        twoSided: modifiers.shiftKey && tool !== 'rotate',
        snap: modifiers.shiftKey && tool === 'rotate',
        before: active.written,
        beforeMask: active.writtenMask,
      };
    },

    move(clientX: number, clientY: number) {
      const active = session;
      if (!active || !drag) return;
      const [dx, dy] = [clientX - drag.start[0], clientY - drag.start[1]];
      let amount: number;
      if (active.tool === 'rotate') {
        const degrees = drag.base + dx * DEGREES_PER_PIXEL;
        amount = drag.snap ? Math.round(degrees / SNAP_DEGREES) * SNAP_DEGREES : Math.round(degrees);
      } else {
        const [sx, sy] = drag.screenNormal;
        const cells = (dx * sx + dy * sy) / Math.max(sx * sx + sy * sy, 1);
        amount = Math.max(drag.base + Math.round(cells), active.tool === 'wrap' ? 0 : 1 - active.length);
      }
      if (amount === active.amount) return;
      active.amount = amount;
      const result = compute(active, amount, drag.twoSided);
      active.written = result.model.voxels;
      active.writtenMask = result.mask;
      write(active.model, result.model.voxels, result.mask);
    },

    end() {
      const active = session;
      const finished = drag;
      drag = null;
      if (!active || !finished || finished.before === active.written) return;
      const { model, written, writtenMask } = active;
      editor.history.push({ undo: () => write(model, finished.before, finished.beforeMask), redo: () => write(model, written, writtenMask) });
    },
  };
}
