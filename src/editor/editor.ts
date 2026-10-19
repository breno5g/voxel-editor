import { createDocument } from '../format/defaults.ts';
import type { Axis } from '../format/rotation.ts';
import { MAX_MODEL_SIZE } from '../format/vox.ts';
import type { Vec3, VoxDocument, VoxModel } from '../format/vox.ts';
import { clampFrame, DEFAULT_RANGE, formatRange, parseRange, RANGE_META_KEY } from '../scene/keyframes.ts';
import type { FrameRange } from '../scene/keyframes.ts';
import { evaluateScene } from '../scene/scene-graph.ts';
import type { Instance } from '../scene/scene-graph.ts';
import { childOfGroup, parentMap, rootLevel } from '../scene/scene-tree.ts';
import type { CenterOptions, FaceConnectivity, GeoShape, RegionOptions, StampShape } from './brush-shapes.ts';
import { createHistory } from './history.ts';
import type { VoxelSelection } from './voxel-selection.ts';

/** MagicaVoxel's editors: `model` edits the selected object's voxels, `world` arranges objects. */
export const MODES = ['model', 'world'] as const;
export type Mode = (typeof MODES)[number];
/**
 * MagicaVoxel `b_type`: brush actions, one-click actions on a colour region (`pick` takes its colour),
 * then selection: `msel` marquee (M), `asel` region (N) and `xform`, which transforms the selected voxels;
 * `resize` drags a face of the model frame to resize the volume.
 */
export const BRUSH_TYPES = ['attach', 'erase', 'paint', 'pick', 'remove', 'replace', 'msel', 'asel', 'xform', 'resize'] as const;
export type BrushType = (typeof BRUSH_TYPES)[number];
/** MagicaVoxel `b_msel`: the marquee selects by screen rectangle, by brush stroke, or by box. */
export const MARQUEE_MODES = ['rect', 'brush', 'box'] as const;
export type MarqueeMode = (typeof MARQUEE_MODES)[number];
/** MagicaVoxel `b_obj`: the world editor's pointer tool (`patt` waits for patterns). */
export const OBJECT_TOOLS = ['move', 'msel', 'wrap'] as const;
export type ObjectTool = (typeof OBJECT_TOOLS)[number];
/** MagicaVoxel `b_xform`: what dragging the selection does. */
export const TRANSFORM_TOOLS = ['move', 'scale', 'wrap', 'rotate'] as const;
export type TransformTool = (typeof TRANSFORM_TOOLS)[number];
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
  /** The primary selected transform (the last one picked); in model mode, the object being edited. */
  selected: number | null;
  /** Every selected transform, children of the `level` group, in selection order (`selected` is the last). */
  selection: number[];
  /** MagicaVoxel `olevel`: the group whose children the world editor picks; null is the scene's root group. */
  level: number | null;
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
  objectTool: ObjectTool;
  transformTool: TransformTool;
  /** MagicaVoxel `b_wrap_space_x/y/z`: empty cells between wrapped copies. */
  wrapSpacing: Vec3;
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

/** A transform holding a model (an object), as opposed to one holding a group. */
export const isObject = (vox: VoxDocument, transformId: number) => {
  const node = vox.nodes[transformId];
  return node?.kind === 'transform' && vox.nodes[node.child]?.kind === 'shape';
};

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
    selection: [],
    level: null,
    brushType: 'attach',
    brushMode: 'vox',
    mirror: [false, false, false],
    axes: [false, false, false],
    voxBrush: { size: 1, shape: 'cube', volume: true },
    faceBrush: { usePalette: true, byColor: false, neighbors: 4 },
    geoBrush: { shape: 'line', project: false, fill: true, even: false },
    regionBrush: { connected: true, byColor: true, neighbors: 6 },
    marquee: 'rect',
    objectTool: 'move',
    transformTool: 'move',
    wrapSpacing: [0, 0, 0],
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

  /** Leaving the selection without an object leaves model mode, which always edits one object. */
  const setSelection = (transformIds: number[], force = false) => {
    const next = [...new Set(transformIds)];
    if (!force && next.length === state.selection.length && next.every((id, index) => id === state.selection[index])) return;
    state.selection = next;
    state.selected = next.at(-1) ?? null;
    emit({ type: 'selection' });
    if (state.mode === 'model' && (state.selected === null || !isObject(state.vox, state.selected))) {
      state.mode = 'world';
      emit({ type: 'mode' });
    }
  };

  const editorApi = {
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
      const first = state.instances[0]?.transformId;
      const top = first === undefined ? null : childOfGroup(vox, parentMap(vox), first, rootLevel(vox) ?? -1);
      state.level = null;
      state.selection = top === null ? [] : [top];
      state.selected = top;
      state.mode = top !== null && isObject(vox, top) ? 'model' : 'world';
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

    select(transformId: number | null) {
      setSelection(transformId === null ? [] : [transformId]);
    },

    setSelection,

    /** Enters group `groupId` (null: the root group), selecting `selection` among its children. */
    setLevel(groupId: number | null, selection: number[] = []) {
      state.level = groupId === rootLevel(state.vox) ? null : groupId;
      state.selection = [];
      setSelection(selection, true);
    },

    /** Selects object `transformId` wherever it sits, entering the group that holds it. */
    focusObject(transformId: number) {
      const parent = parentMap(state.vox).get(transformId);
      if (parent === undefined) return;
      if (parent === (state.level ?? rootLevel(state.vox))) return setSelection([transformId]);
      editorApi.setLevel(parent, [transformId]);
    },

    setMode(mode: Mode) {
      if (state.mode === mode) return;
      if (mode === 'model' && state.selected === null) return status('Selecione um objeto para editar o modelo', 'error');
      if (mode === 'model' && state.selected !== null && !isObject(state.vox, state.selected)) return status('Entre no grupo (Tab) para editar um dos seus objetos', 'error');
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

    setObjectTool(objectTool: ObjectTool) {
      state.objectTool = objectTool;
      emit({ type: 'tool' });
    },

    setTransformTool(transformTool: TransformTool) {
      state.transformTool = transformTool;
      emit({ type: 'tool' });
    },

    setWrapSpacing(axis: Axis, spacing: number) {
      const next: Vec3 = [...state.wrapSpacing];
      next[axis] = Math.min(Math.max(Math.round(spacing) || 0, 0), MAX_MODEL_SIZE);
      state.wrapSpacing = next;
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
  return editorApi;
}
