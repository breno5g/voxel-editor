import { createDocument } from '../format/defaults.ts';
import type { Axis } from '../format/rotation.ts';
import type { VoxDocument, VoxModel } from '../format/vox.ts';
import { clampFrame, DEFAULT_RANGE, formatRange, parseRange, RANGE_META_KEY } from '../scene/keyframes.ts';
import type { FrameRange } from '../scene/keyframes.ts';
import { evaluateScene } from '../scene/scene-graph.ts';
import type { Instance } from '../scene/scene-graph.ts';
import { createHistory } from './history.ts';

/** MagicaVoxel's editors: `model` edits the selected object's voxels, `world` arranges objects. */
export const MODES = ['model', 'world'] as const;
export type Mode = (typeof MODES)[number];
/** MagicaVoxel `b_type`. */
export const BRUSH_TYPES = ['attach', 'erase', 'paint'] as const;
export type BrushType = (typeof BRUSH_TYPES)[number];
/** MagicaVoxel `b_mode`: `vox` follows the pointer, `box` fills the cells between press and release. */
export const BRUSH_MODES = ['vox', 'box'] as const;
export type BrushMode = (typeof BRUSH_MODES)[number];
/** MagicaVoxel `rm_b_grid`, `rm_b_frame`, `rm_b_edge`, `rm_b_bo`. */
export const DISPLAY_OPTIONS = ['grid', 'frame', 'edges', 'backgroundObjects'] as const;
export type DisplayOption = (typeof DISPLAY_OPTIONS)[number];
export type Display = Record<DisplayOption, boolean>;
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
  | { type: 'mode' }
  | { type: 'display' }
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
  mode: Mode;
  /** Transform node id of the selected object; in model mode, the object being edited. */
  selected: number | null;
  brushType: BrushType;
  brushMode: BrushMode;
  /** MagicaVoxel `b_mirror_x/y/z`: strokes are repeated across the model's centre on each enabled axis. */
  mirror: [boolean, boolean, boolean];
  color: number;
  /** Shows the previous model frame translucent while editing frame-by-frame animation. */
  onionSkin: boolean;
  display: Display;
};

export type Editor = ReturnType<typeof createEditor>;

export const UNTITLED = 'untitled.vox';

const DEFAULT_FPS = 12;
/** A mid-lightness orange in the default palette, readable against the dark viewport. */
const DEFAULT_COLOR = 100;

const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    values.some((candidate) => candidate === value);
export const isMode = isOneOf(MODES);
export const isBrushType = isOneOf(BRUSH_TYPES);
export const isBrushMode = isOneOf(BRUSH_MODES);
export const isDisplayOption = isOneOf(DISPLAY_OPTIONS);

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
    mode: 'model',
    selected: null,
    brushType: 'attach',
    brushMode: 'vox',
    mirror: [false, false, false],
    color: DEFAULT_COLOR,
    onionSkin: false,
    display: { grid: true, frame: true, edges: false, backgroundObjects: true },
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
      state.mode = state.selected === null ? 'world' : 'model';
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

    markSaved(fileName = state.fileName) {
      state.fileName = fileName;
      state.dirty = false;
      emit({ type: 'saved' });
    },

    /** Clearing the selection leaves model mode, which always edits one object. */
    select(transformId: number | null) {
      if (state.selected === transformId) return;
      state.selected = transformId;
      emit({ type: 'selection' });
      if (transformId === null && state.mode === 'model') {
        state.mode = 'world';
        emit({ type: 'mode' });
      }
    },

    setMode(mode: Mode) {
      if (state.mode === mode) return;
      if (mode === 'model' && state.selected === null) return status('Selecione um objeto para editar o modelo', 'error');
      state.mode = mode;
      emit({ type: 'mode' });
    },

    setBrushType(brushType: BrushType) {
      state.brushType = brushType;
      emit({ type: 'tool' });
    },

    setBrushMode(brushMode: BrushMode) {
      state.brushMode = brushMode;
      emit({ type: 'tool' });
    },

    toggleMirror(axis: Axis) {
      const [x, y, z] = state.mirror;
      state.mirror = [axis === 0 ? !x : x, axis === 1 ? !y : y, axis === 2 ? !z : z];
      emit({ type: 'tool' });
    },

    toggleDisplay(option: DisplayOption) {
      state.display = { ...state.display, [option]: !state.display[option] };
      emit({ type: 'display' });
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
