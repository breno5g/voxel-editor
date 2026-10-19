import { withComponents } from '../format/components.ts';
import type { Component } from '../format/components.ts';
import { createDocument } from '../format/defaults.ts';
import type { Axis } from '../format/rotation.ts';
import { MAX_MODEL_SIZE } from '../format/vox.ts';
import type { TransformKey, TransformNode, Vec3, VoxDocument, VoxModel } from '../format/vox.ts';
import { clampFrame, DEFAULT_RANGE, formatRange, parseRange, RANGE_META_KEY } from '../scene/keyframes.ts';
import type { FrameRange } from '../scene/keyframes.ts';
import { evaluateScene, ROOT_ID } from '../scene/scene-graph.ts';
import type { Instance } from '../scene/scene-graph.ts';
import { ancestorsOf, childOfGroup, parentMap, rootLevel } from '../scene/scene-tree.ts';
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
/** MagicaVoxel `b_obj`: the world editor's pointer tool; `patt` places the current pattern as a new object. */
export const OBJECT_TOOLS = ['move', 'msel', 'wrap', 'patt'] as const;
export type ObjectTool = (typeof OBJECT_TOOLS)[number];
/** MagicaVoxel `b_xform`: what dragging the selection does. */
export const TRANSFORM_TOOLS = ['move', 'scale', 'wrap', 'rotate'] as const;
export type TransformTool = (typeof TRANSFORM_TOOLS)[number];
/**
 * MagicaVoxel `b_mode`: `vox` stamps under the pointer, `face` works on the flat face region
 * under it, `box` fills the cells between press and release, `geo` draws lines and shapes,
 * `code` runs the XS shader on a dragged box, `pattern` stamps the current pattern on the face under the pointer.
 */
export const BRUSH_MODES = ['vox', 'face', 'box', 'geo', 'code', 'pattern'] as const;
export type BrushMode = (typeof BRUSH_MODES)[number];
/** MagicaVoxel `rm_b_grid`, `rm_b_frame`, `rm_b_edge`, `rm_b_bo`, `rm_b_wire`, `rm_b_sw` (shadow), `rm_b_ao`, `rm_b_const`, `rm_b_fade`. */
export const DISPLAY_OPTIONS = ['grid', 'frame', 'edges', 'backgroundObjects', 'wire', 'shadow', 'ao', 'constant', 'fade'] as const;
export type DisplayOption = (typeof DISPLAY_OPTIONS)[number];
/** MagicaVoxel `rm_bg_col`, `rm_grid_col`, `rm_edge_col`, `rm_sel_col`, as `#rrggbb`. */
export const DISPLAY_COLORS = ['background', 'grid', 'edge', 'selection'] as const;
export type DisplayColor = (typeof DISPLAY_COLORS)[number];
/** Plus `rm_space`: the model frame's floor grid spacing. */
export type Display = Record<DisplayOption, boolean> & { colors: Record<DisplayColor, string>; frameSpacing: number };
export const MAX_FRAME_SPACING = 1024;
/** MagicaVoxel's defaults (flags `0x6218`, `rm_space` 10 and its colours), except grid and frame, which start on. */
export const DEFAULT_DISPLAY: Display = {
  grid: true,
  frame: true,
  edges: false,
  backgroundObjects: true,
  wire: true,
  shadow: false,
  ao: true,
  constant: false,
  fade: true,
  colors: { background: '#262626', grid: '#111111', edge: '#111111', selection: '#ffffff' },
  frameSpacing: 10,
};
/** Voxel brush options: MagicaVoxel `b_vox_size` (1..64), `b_vox_cube`, `b_vox_vol` (false is 2D). */
export type VoxBrush = { size: number; shape: StampShape; volume: boolean };
/** Face brush options: MagicaVoxel `b_face_pal` (new voxels take the palette colour, else the face's), plus connectivity. */
export type FaceBrush = FaceConnectivity & { usePalette: boolean };
/** Geometry brush options: MagicaVoxel `b_geo`, `b_line_proj` (the line follows the surface), `b_center_fill`, `b_center_even`. */
export type GeoBrush = CenterOptions & { shape: GeoShape; project: boolean };
export const MAX_BRUSH_SIZE = 64;
export type StatusTone = 'info' | 'error';
/** Timeline rows: position keys (`nTRN`) and model frames (`nSHP`). */
export type KeyTrack = 'transform' | 'shape';
export type KeySelection = Record<KeyTrack, number[]>;

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
  /** MagicaVoxel's current layer: new objects go on it. */
  layer: number;
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
  /** MagicaVoxel `b_obj_wrap_space_x/y/z`: empty cells between wrapped object copies. */
  objectWrapSpacing: Vec3;
  transformTool: TransformTool;
  /** MagicaVoxel `b_wrap_space_x/y/z`: empty cells between wrapped copies. */
  wrapSpacing: Vec3;
  /** Selected voxels of the edited model; ignored once that model is no longer the one being edited. */
  voxelSelection: VoxelSelection | null;
  color: number;
  /** MagicaVoxel's palette multi-selection (Shift+click), for edits on several colours at once. */
  paletteSelection: number[];
  /** Selected key frames of the primary selection, per timeline row. */
  keySelection: KeySelection;
  /** On, editing an animated object off its keys adds a key; off (MagicaVoxel), the edit stays pending until F5 and a frame change discards it. */
  autoKey: boolean;
  /** Unrecorded edits: each edited transform's keys before them. */
  pendingKeys: Map<TransformNode, TransformKey[]>;
  /** MagicaVoxel `aset global`: every object follows the frame; off, only the selected one does and the rest stay at the range start. */
  globalTime: boolean;
  /** MagicaVoxel's current pattern (from a selection or the library), for the pattern brush, `fractal`, `mask` and `tex`. */
  pattern: VoxModel | null;
  /** MagicaVoxel `b_patt_pal`: stamped patterns take the current colour instead of their own. */
  patternUsesPalette: boolean;
  /** Pattern mode `Dir`/`Page`/`Home`: where the stamp sits relative to the pointer, in model cells. */
  patternOffset: Vec3;
  /** MagicaVoxel `save_pal`, `save_mtl`, `save_render`, `save_camera`, `save_note`: what saving writes into the file. */
  savedComponents: Record<Component, boolean>;
  /** Shows the previous model frame translucent while editing frame-by-frame animation. */
  onionSkin: boolean;
  display: Display;
};

export type Editor = ReturnType<typeof createEditor>;

export const UNTITLED = 'untitled.vox';

const DEFAULT_FPS = 12;
/** Orange (#ff9933) in MagicaVoxel's default palette, readable against the dark viewport. */
const DEFAULT_COLOR = 17;

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
    layer: 0,
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
    objectWrapSpacing: [0, 0, 0],
    transformTool: 'move',
    wrapSpacing: [0, 0, 0],
    voxelSelection: null,
    color: DEFAULT_COLOR,
    paletteSelection: [],
    keySelection: { transform: [], shape: [] },
    globalTime: true,
    pattern: null,
    patternUsesPalette: false,
    patternOffset: [0, 0, 0],
    savedComponents: { palette: true, material: true, render: true, camera: true, note: true },
    autoKey: true,
    pendingKeys: new Map(),
    onionSkin: false,
    display: DEFAULT_DISPLAY,
  };

  const emit = (event: EditorEvent) => listeners.forEach((listener) => listener(event));
  const evaluate = () => {
    state.instances = evaluateScene(state.vox, state.frame, state.globalTime ? null : { transformId: state.selected ?? -1, restFrame: state.range[0] });
  };

  /** MagicaVoxel: changing frame drops unrecorded edits (one undo step brings them back). */
  const discardPending = () => {
    const pending = [...state.pendingKeys].filter(([node, recorded]) => node.keys !== recorded);
    state.pendingKeys = new Map();
    if (pending.length === 0) return;
    const edited = pending.map(([node]) => node.keys);
    const apply = (keys: TransformKey[][]) => () => {
      pending.forEach(([node], index) => (node.keys = keys[index]));
      evaluate();
      emit({ type: 'scene' });
    };
    apply(pending.map(([, recorded]) => recorded))();
    history.push({ undo: apply(edited), redo: apply(pending.map(([, recorded]) => recorded)) });
    status('Edição sem key descartada (F5 grava a key antes de trocar de frame)', 'error');
  };

  const setFrame = (frame: number) => {
    const [start, end] = state.range;
    const next = Math.min(Math.max(clampFrame(frame), start), end);
    if (next === state.frame) return;
    discardPending();
    state.frame = next;
    evaluate();
    emit({ type: 'frame' });
  };

  const status = (message: string, tone: StatusTone = 'info') => emit({ type: 'status', message, tone });

  /** Leaving the selection without an object leaves model mode, which always edits one object. */
  const setSelection = (transformIds: number[], force = false) => {
    const next = [...new Set(transformIds)];
    if (!force && next.length === state.selection.length && next.every((id, index) => id === state.selection[index])) return;
    const primaryChanged = state.selected !== (next.at(-1) ?? null);
    state.selection = next;
    state.selected = next.at(-1) ?? null;
    if (primaryChanged) state.keySelection = { transform: [], shape: [] };
    if (!state.globalTime) evaluate();
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
      Object.assign(state, { vox, fileName: name, dirty: false, playing: false, voxelSelection: null, keySelection: { transform: [], shape: [] }, pendingKeys: new Map(), range: parseRange(vox.meta.get(RANGE_META_KEY)) });
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
      if (state.level !== null && !ancestorsOf(parentMap(state.vox), state.level).includes(ROOT_ID)) state.level = null;
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

    /** Selects object or group `transformId` wherever it sits, entering the group that holds it. */
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

    setCurrentLayer(layer: number) {
      state.layer = layer;
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

    /** Wrap spacing on `axis` for voxels (`model`) or objects (`world`). */
    setWrapSpacing(axis: Axis, spacing: number, target: Mode = 'model') {
      const key = target === 'model' ? 'wrapSpacing' : 'objectWrapSpacing';
      const next: Vec3 = [...state[key]];
      next[axis] = Math.min(Math.max(Math.round(spacing) || 0, 0), MAX_MODEL_SIZE);
      state[key] = next;
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

    setDisplay(changes: Partial<Display>) {
      const next = { ...state.display, ...changes, colors: { ...state.display.colors, ...changes.colors } };
      state.display = { ...next, frameSpacing: Math.min(Math.max(Math.round(next.frameSpacing) || 1, 1), MAX_FRAME_SPACING) };
      emit({ type: 'display' });
    },

    setOnionSkin(enabled: boolean) {
      state.onionSkin = enabled;
      emit({ type: 'tool' });
    },

    setKeySelection(selection: KeySelection) {
      state.keySelection = { transform: [...new Set(selection.transform)].sort((a, b) => a - b), shape: [...new Set(selection.shape)].sort((a, b) => a - b) };
      emit({ type: 'tool' });
    },

    setPattern(pattern: VoxModel | null) {
      state.pattern = pattern;
      emit({ type: 'tool' });
    },

    setPatternOffset(offset: Vec3) {
      state.patternOffset = offset;
      emit({ type: 'tool' });
    },

    setPatternUsesPalette(enabled: boolean) {
      state.patternUsesPalette = enabled;
      emit({ type: 'tool' });
    },

    setSavedComponent(component: Component, saved: boolean) {
      state.savedComponents = { ...state.savedComponents, [component]: saved };
      emit({ type: 'tool' });
    },

    /** The document as saving writes it: only the components chosen in `savedComponents`. */
    savedDocument: () => withComponents(state.vox, state.savedComponents),

    setAutoKey(enabled: boolean) {
      state.autoKey = enabled;
      emit({ type: 'tool' });
    },

    /** Records that `node` was edited off its keys while auto key is off; `recorded` are its keys before. */
    notePendingKeys(node: TransformNode, recorded: TransformKey[]) {
      if (state.autoKey || recorded.length <= 1 || recorded.some((key) => key.frame === state.frame)) return;
      if (!state.pendingKeys.has(node)) state.pendingKeys.set(node, recorded);
      status('Edição sem key: F5 grava, trocar de frame descarta');
    },

    /** F5 keeps the pending edits as keys. */
    recordPending() {
      const count = state.pendingKeys.size;
      state.pendingKeys = new Map();
      return count;
    },

    setGlobalTime(enabled: boolean) {
      state.globalTime = enabled;
      evaluate();
      emit({ type: 'scene' });
    },

    setPaletteSelection(indices: number[]) {
      state.paletteSelection = [...new Set(indices)].filter((index) => index > 0 && index < 256).sort((a, b) => a - b);
      emit({ type: 'color' });
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
