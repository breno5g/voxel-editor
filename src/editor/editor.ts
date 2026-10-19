import { createDocument } from '../format/defaults.ts';
import type { Axis } from '../format/rotation.ts';
import type { VoxDocument, VoxModel } from '../format/vox.ts';
import { clampFrame, DEFAULT_RANGE, formatRange, parseRange, RANGE_META_KEY } from '../scene/keyframes.ts';
import type { FrameRange } from '../scene/keyframes.ts';
import { evaluateScene } from '../scene/scene-graph.ts';
import type { Instance } from '../scene/scene-graph.ts';
import type { CenterOptions, FaceConnectivity, GeoShape, RegionOptions, StampShape } from './brush-shapes.ts';
import { createHistory } from './history.ts';
import type { VoxelSelection } from './voxel-selection.ts';

/** MagicaVoxel's editors: `model` edits the selected object's voxels, `world` arranges objects. */
export const MODES = ['model', 'world'] as const;
export type Mode = (typeof MODES)[number];
/**
 * MagicaVoxel `b_type`: brush actions, one-click actions on a colour region (`pick` takes its colour),
 * then selection: `msel` marquee (M), `asel` region (N) and `xform`, which moves the selected voxels.
 */
export const BRUSH_TYPES = ['attach', 'erase', 'paint', 'pick', 'remove', 'replace', 'msel', 'asel', 'xform'] as const;
export type BrushType = (typeof BRUSH_TYPES)[number];
/** MagicaVoxel `b_msel`: the marquee selects by screen rectangle, by brush stroke, or by box. */
export const MARQUEE_MODES = ['rect', 'brush', 'box'] as const;
export type MarqueeMode = (typeof MARQUEE_MODES)[number];
/**
 * MagicaVoxel `b_mode`: `vox` stamps under the pointer, `face` works on the flat face region
 * under it, `box` fills the cells between press and release, `geo` draws lines and shapes.
 */
export const BRUSH_MODES = ['vox', 'face', 'box', 'geo'] as const;
export type BrushMode = (typeof BRUSH_MODES)[number];
/** MagicaVoxel `rm_b_grid`, `rm_b_frame`, `rm_b_edge`, `rm_b_bo`. */
export const DISPLAY_OPTIONS = ['grid', 'frame', 'edges', 'backgroundObjects'] as const;
export type DisplayOption = (typeof DISPLAY_OPTIONS)[number];
export type Display = Record<DisplayOption, boolean>;
/** Voxel brush options: MagicaVoxel `b_vox_size` (1..64), `b_vox_cube`, `b_vox_vol` (false is 2D). */
export type VoxBrush = { size: number; shape: StampShape; volume: boolean };
/** Face brush options: MagicaVoxel `b_face_pal` (new voxels take the palette colour, else the face's), plus connectivity. */
export type FaceBrush = FaceConnectivity & { usePalette: boolean };
/** Geometry brush options: MagicaVoxel `b_geo`, `b_line_proj` (the line follows the surface), `b_center_fill`, `b_center_even`. */
export type GeoBrush = CenterOptions & { shape: GeoShape; project: boolean };
export const MAX_BRUSH_SIZE = 64;
export type StatusTone = 'info' | 'error';

export type EditorEvent =
  | { type: 'document' }
  | { type: 'scene' }
  | { type: 'frame' }
  | { type: 'selection' }
  | { type: 'voxelSelection' }
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
  /** MagicaVoxel `b_axis_x/y/z`: strokes run through the whole model along each enabled axis. */
  axes: [boolean, boolean, boolean];
  voxBrush: VoxBrush;
  faceBrush: FaceBrush;
  geoBrush: GeoBrush;
  regionBrush: RegionOptions;
  marquee: MarqueeMode;
  /** Selected voxels of the edited model; ignored once that model is no longer the one being edited. */
  voxelSelection: VoxelSelection | null;
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

const toggled = ([x, y, z]: [boolean, boolean, boolean], axis: Axis): [boolean, boolean, boolean] => [
  axis === 0 ? !x : x,
  axis === 1 ? !y : y,
  axis === 2 ? !z : z,
];

const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    values.some((candidate) => candidate === value);
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
    axes: [false, false, false],
    voxBrush: { size: 1, shape: 'cube', volume: true },
    faceBrush: { usePalette: true, byColor: false, neighbors: 4 },
    geoBrush: { shape: 'line', project: false, fill: true, even: false },
    regionBrush: { connected: true, byColor: true, neighbors: 6 },
    marquee: 'rect',
    voxelSelection: null,
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
      Object.assign(state, { vox, fileName: name, dirty: false, playing: false, voxelSelection: null, range: parseRange(vox.meta.get(RANGE_META_KEY)) });
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
      state.mirror = toggled(state.mirror, axis);
      emit({ type: 'tool' });
    },

    toggleAxis(axis: Axis) {
      state.axes = toggled(state.axes, axis);
      emit({ type: 'tool' });
    },

    setMarquee(marquee: MarqueeMode) {
      state.marquee = marquee;
      emit({ type: 'tool' });
    },

    setVoxelSelection(selection: VoxelSelection | null) {
      state.voxelSelection = selection;
      emit({ type: 'voxelSelection' });
    },

    /** The selection mask of `model`, when the current selection belongs to it. */
    selectionOf(model: VoxModel): Uint8Array | null {
      return state.voxelSelection?.model === model ? state.voxelSelection.mask : null;
    },

    setRegionBrush(changes: Partial<RegionOptions>) {
      state.regionBrush = { ...state.regionBrush, ...changes };
      emit({ type: 'tool' });
    },

    setGeoBrush(changes: Partial<GeoBrush>) {
      state.geoBrush = { ...state.geoBrush, ...changes };
      emit({ type: 'tool' });
    },

    setFaceBrush(changes: Partial<FaceBrush>) {
      state.faceBrush = { ...state.faceBrush, ...changes };
      emit({ type: 'tool' });
    },

    setVoxBrush(changes: Partial<VoxBrush>) {
      const next = { ...state.voxBrush, ...changes };
      state.voxBrush = { ...next, size: Math.min(Math.max(Math.round(next.size), 1), MAX_BRUSH_SIZE) };
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
