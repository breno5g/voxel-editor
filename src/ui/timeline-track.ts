import type { FrameRange } from '../scene/keyframes.ts';

export type TrackView = {
  range: FrameRange;
  frame: number;
  transformKeys: number[];
  shapeKeys: number[];
  /** Selected key frames per row, and how far a drag is moving them. */
  selected: { transform: number[]; shape: number[] };
  dragDelta: number;
};

const COLORS = {
  background: '#1b1d22',
  tick: '#3a3e46',
  majorTick: '#5a5e68',
  label: '#8a8f99',
  cursor: 'rgba(255, 170, 51, 0.35)',
  cursorEdge: '#ffaa33',
  transformKey: '#5cc8ff',
  shapeKey: '#9be36d',
  selectedKey: '#ffffff',
};
const LABEL_STEPS = [1, 2, 5, 10, 20, 50, 100];
const MIN_LABEL_SPACING = 28;
const KEY_SIZE = 5;
const ROWS = { transform: 0.5, shape: 0.8 };

/** Frame ruler with the cursor and the selected object's keys: diamonds = position, squares = model. */
export function drawTrack(canvas: HTMLCanvasElement, view: TrackView): void {
  const ratio = window.devicePixelRatio;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  const [start, end] = view.range;
  const slot = width / (end - start + 1);
  const xOf = (frame: number) => (frame - start) * slot;
  const labelEvery = LABEL_STEPS.find((step) => step * slot >= MIN_LABEL_SPACING) ?? LABEL_STEPS[LABEL_STEPS.length - 1];

  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, width, height);
  context.font = '10px system-ui';
  for (let frame = start; frame <= end; frame++) {
    const isMajor = frame % labelEvery === 0;
    context.fillStyle = isMajor ? COLORS.majorTick : COLORS.tick;
    context.fillRect(Math.round(xOf(frame)), 0, 1, isMajor ? 12 : 6);
    if (!isMajor) continue;
    context.fillStyle = COLORS.label;
    context.fillText(String(frame), xOf(frame) + 3, 11);
  }

  context.fillStyle = COLORS.cursor;
  context.fillRect(xOf(view.frame), 0, Math.max(slot, 2), height);
  context.fillStyle = COLORS.cursorEdge;
  context.fillRect(xOf(view.frame), 0, 1, height);

  const visible = (frame: number) => frame >= start && frame <= end;
  /** Selected keys are drawn white, at their dragged place while a drag is moving them. */
  const placed = (frames: number[], selected: number[]) =>
    frames.map((frame) => (selected.includes(frame) ? { frame: frame + view.dragDelta, selected: true } : { frame, selected: false })).filter(({ frame }) => visible(frame));
  placed(view.transformKeys, view.selected.transform).forEach(({ frame, selected }) => {
    const x = xOf(frame) + slot / 2;
    const y = height * ROWS.transform;
    context.fillStyle = selected ? COLORS.selectedKey : COLORS.transformKey;
    context.beginPath();
    context.moveTo(x, y - KEY_SIZE);
    context.lineTo(x + KEY_SIZE, y);
    context.lineTo(x, y + KEY_SIZE);
    context.lineTo(x - KEY_SIZE, y);
    context.fill();
  });
  placed(view.shapeKeys, view.selected.shape).forEach(({ frame, selected }) => {
    context.fillStyle = selected ? COLORS.selectedKey : COLORS.shapeKey;
    context.fillRect(xOf(frame) + slot / 2 - KEY_SIZE / 1.4, height * ROWS.shape - KEY_SIZE / 1.4, KEY_SIZE * 1.4, KEY_SIZE * 1.4);
  });
}

/** The timeline row under a pointer: position keys in the upper half, model frames below. */
export function rowAtPoint(canvas: HTMLCanvasElement, clientY: number): 'transform' | 'shape' {
  const bounds = canvas.getBoundingClientRect();
  return (clientY - bounds.top) / bounds.height < (ROWS.transform + ROWS.shape) / 2 ? 'transform' : 'shape';
}

export function frameAtPoint(canvas: HTMLCanvasElement, [start, end]: FrameRange, clientX: number): number {
  const bounds = canvas.getBoundingClientRect();
  const ratio = (clientX - bounds.left) / bounds.width;
  return Math.min(Math.max(start + Math.floor(ratio * (end - start + 1)), start), end);
}
