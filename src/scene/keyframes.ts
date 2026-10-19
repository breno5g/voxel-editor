import type { Dict, ShapeKey, TransformKey } from '../format/vox.ts';

export const MAX_FRAME = 360;
export const DEFAULT_RANGE: FrameRange = [0, 30];
export const RANGE_META_KEY = '_anim_range';

export type FrameRange = [number, number];
export type TransformValue = Omit<TransformKey, 'frame'>;

type Keyed = { frame: number };

export const isLooping = (attrs: Dict) => attrs.get('_loop') === '1';

export const clampFrame = (frame: number) => Math.min(Math.max(Math.round(frame), 0), MAX_FRAME);

/** Looping keys repeat with period `last - first + 1`; there is no blend from the last key back to the first. */
function wrapFrame(keys: readonly Keyed[], frame: number, loop: boolean): number {
  if (!loop) return frame;
  const first = keys[0].frame;
  const period = keys[keys.length - 1].frame - first + 1;
  return first + ((((frame - first) % period) + period) % period);
}

/** Last key at or before `frame`; the first key when `frame` precedes every key. */
function activeKeyIndex(keys: readonly Keyed[], frame: number): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (keys[middle].frame < frame) low = middle + 1;
    else high = middle;
  }
  const isExact = low < keys.length && keys[low].frame === frame;
  return isExact || low === 0 ? low : low - 1;
}

/** Translation lerps and rounds half up to whole voxels; rotation holds the previous key. */
export function evaluateTransform(keys: readonly TransformKey[], frame: number, loop: boolean): TransformValue {
  const time = wrapFrame(keys, frame, loop);
  const index = activeKeyIndex(keys, time);
  const from = keys[index];
  const to = keys[index + 1] ?? from;
  const progress = to === from ? 0 : Math.min(Math.max((time - from.frame) / (to.frame - from.frame), 0), 1);
  const lerp = (axis: number) => Math.floor(from.translation[axis] + (to.translation[axis] - from.translation[axis]) * progress + 0.5);
  return { translation: [lerp(0), lerp(1), lerp(2)], rotation: from.rotation };
}

/** Model swaps are stepped: the model of the last key at or before `frame`. */
export function evaluateShape(keys: readonly ShapeKey[], frame: number, loop: boolean): number {
  return keys[activeKeyIndex(keys, wrapFrame(keys, frame, loop))].model;
}

/**
 * Model of the frame before the one shown at `frame` (for onion skinning).
 * Wraps to the last frame when looping; null when there is no earlier frame.
 */
export function previousShapeModel(keys: readonly ShapeKey[], frame: number, loop: boolean): number | null {
  if (keys.length < 2) return null;
  const index = activeKeyIndex(keys, wrapFrame(keys, frame, loop));
  if (index > 0) return keys[index - 1].model;
  return loop ? keys[keys.length - 1].model : null;
}

export function upsertKey<K extends Keyed>(keys: readonly K[], key: K): K[] {
  return [...keys.filter((existing) => existing.frame !== key.frame), key].sort((a, b) => a.frame - b.frame);
}

/** Nodes always keep at least one key: MagicaVoxel rejects zero-frame nodes. */
export function removeKeyAt<K extends Keyed>(keys: readonly K[], frame: number): K[] {
  return keys.length <= 1 ? [...keys] : keys.filter((key) => key.frame !== frame);
}

/**
 * Static nodes (one key) are edited in place; animated nodes get a key at `frame`,
 * so moving an object never leaves an unrecorded state behind.
 */
export function setTransformAt(keys: readonly TransformKey[], frame: number, value: TransformValue): TransformKey[] {
  if (keys.length <= 1) return [{ frame: keys[0]?.frame ?? 0, ...value }];
  return upsertKey(keys, { frame, ...value });
}

export function adjacentKeyFrame(frames: readonly number[], frame: number, direction: 1 | -1): number | null {
  const candidates = frames.filter((keyFrame) => (direction > 0 ? keyFrame > frame : keyFrame < frame));
  if (candidates.length === 0) return null;
  return direction > 0 ? Math.min(...candidates) : Math.max(...candidates);
}

export function parseRange(value: string | undefined): FrameRange {
  const [start, end] = (value ?? '').split(' ').map(Number);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return [...DEFAULT_RANGE];
  return [clampFrame(start), clampFrame(end)];
}

export const formatRange = ([start, end]: FrameRange) => `${start} ${end}`;
