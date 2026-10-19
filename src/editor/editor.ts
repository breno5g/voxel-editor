import { createDocument } from '../format/defaults.ts';
import type { VoxDocument, VoxModel } from '../format/vox.ts';
import { clampFrame, DEFAULT_RANGE, formatRange, parseRange, RANGE_META_KEY } from '../scene/keyframes.ts';
import type { FrameRange } from '../scene/keyframes.ts';
import { evaluateScene } from '../scene/scene-graph.ts';
import type { Instance } from '../scene/scene-graph.ts';
import { createHistory } from './history.ts';

export const TOOLS = ['select', 'attach', 'erase', 'paint'] as const;
export type Tool = (typeof TOOLS)[number];
export const BRUSHES = ['voxel', 'box'] as const;
export type Brush = (typeof BRUSHES)[number];
export type StatusTone = 'info' | 'error';

export type EditorEvent =
  | { type: 'document' }
  | { type: 'scene' }
  | { type: 'frame' }
  | { type: 'selection' }
  | { type: 'palette' }
  | { type: 'saved' }
  | { type: 'color' }
  | { type: 'tool' }
  | { type: 'playback' }
  | { type: 'voxels'; model: VoxModel; chunks: Set<number> }
  | { type: 'status'; message: string; tone: StatusTone };

export type EditorState = {
  vox: VoxDocument;
  fileName: string;
  dirty: boolean;
  frame: number;
  range: FrameRange;
  playing: boolean;
  fps: number;
  /** Visible objects at `frame`, recomputed whenever the frame or the scene changes. */
  instances: Instance[];
  /** Transform node id of the selected object. */
  selected: number | null;
  tool: Tool;
  /** `box` applies the tool to every cell between press and release. */
  brush: Brush;
  color: number;
  /** Shows the previous model frame translucent while editing frame-by-frame animation. */
  onionSkin: boolean;
};

export type Editor = ReturnType<typeof createEditor>;

export const UNTITLED = 'untitled.vox';

const DEFAULT_FPS = 12;
/** A mid-lightness orange in the default palette, readable against the dark viewport. */
const DEFAULT_COLOR = 100;

export const isTool = (value: unknown): value is Tool => TOOLS.some((tool) => tool === value);
export const isBrush = (value: unknown): value is Brush => BRUSHES.some((brush) => brush === value);

/**
 * Single source of editor state. Mutations go through these methods, which
 * emit events; panels and the viewport subscribe instead of calling each other.
 * Call `load` once subscribers are attached.
 */
export function createEditor() {
  const listeners = new Set<(event: EditorEvent) => void>();
  const history = createHistory();
  const state: EditorState = {
    vox: createDocument(),
    fileName: UNTITLED,
    dirty: false,
    frame: 0,
    range: [...DEFAULT_RANGE],
    playing: false,
    fps: DEFAULT_FPS,
    instances: [],
    selected: null,
    tool: 'attach',
    brush: 'voxel',
    color: DEFAULT_COLOR,
    onionSkin: false,
  };

  const emit = (event: EditorEvent) => listeners.forEach((listener) => listener(event));
  const evaluate = () => {
    state.instances = evaluateScene(state.vox, state.frame);
  };

  const setFrame = (frame: number) => {
    const [start, end] = state.range;
    const next = Math.min(Math.max(clampFrame(frame), start), end);
    if (next === state.frame) return;
    state.frame = next;
    evaluate();
    emit({ type: 'frame' });
  };

  const status = (message: string, tone: StatusTone = 'info') => emit({ type: 'status', message, tone });

  return {
    state,
    history,

    subscribe(listener: (event: EditorEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    load(vox: VoxDocument, name: string) {
      Object.assign(state, { vox, fileName: name, dirty: false, playing: false, range: parseRange(vox.meta.get(RANGE_META_KEY)) });
      state.frame = state.range[0];
      evaluate();
      state.selected = state.instances[0]?.transformId ?? null;
      history.clear();
      emit({ type: 'document' });
    },

    setFrame,

    /** Advances within the frame range, wrapping like MagicaVoxel's `astep time`. */
    stepFrame(delta: number) {
      const [start, end] = state.range;
      const length = end - start + 1;
      setFrame(start + ((((state.frame - start + delta) % length) + length) % length));
    },

    setRange(range: FrameRange) {
      state.range = [clampFrame(Math.min(...range)), clampFrame(Math.max(...range))];
      state.vox.meta.set(RANGE_META_KEY, formatRange(state.range));
      state.dirty = true;
      setFrame(state.frame);
      emit({ type: 'frame' });
    },

    sceneChanged() {
      state.dirty = true;
      evaluate();
      emit({ type: 'scene' });
    },

    voxelsChanged(model: VoxModel, chunks: Set<number>) {
      state.dirty = true;
      emit({ type: 'voxels', model, chunks });
    },

    paletteChanged() {
      state.dirty = true;
      emit({ type: 'palette' });
    },

    markSaved() {
      state.dirty = false;
      emit({ type: 'saved' });
    },

    select(transformId: number | null) {
      if (state.selected === transformId) return;
      state.selected = transformId;
      emit({ type: 'selection' });
    },

    setTool(tool: Tool) {
      state.tool = tool;
      emit({ type: 'tool' });
    },

    setBrush(brush: Brush) {
      state.brush = brush;
      emit({ type: 'tool' });
    },

    setOnionSkin(enabled: boolean) {
      state.onionSkin = enabled;
      emit({ type: 'tool' });
    },

    setColor(color: number) {
      state.color = color;
      emit({ type: 'color' });
    },

    setPlaying(playing: boolean) {
      state.playing = playing;
      emit({ type: 'playback' });
    },

    setFps(fps: number) {
      state.fps = Math.max(1, Math.round(fps));
    },

    selectedInstance(): Instance | undefined {
      return state.instances.find((instance) => instance.transformId === state.selected);
    },

    status,

    /** Every caught error goes through here: logged for debugging, shown to the user. */
    fail(context: string, error: unknown) {
      console.error(context, error);
      status(`${context}: ${error instanceof Error ? error.message : String(error)}`, 'error');
    },
  };
}
