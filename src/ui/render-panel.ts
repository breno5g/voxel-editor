import type { Editor } from '../editor/editor.ts';
import type { MaterialCommands } from '../editor/material-commands.ts';
import { readRenderSettings, writeRenderSettings } from '../format/render-settings.ts';
import { EMPTY_VOXEL, voxelIndex } from '../format/vox.ts';
import type { RenderSettings } from '../format/render-settings.ts';
import { parseHdr } from '../render/path-tracer/hdr-image.ts';
import { materialTable } from '../render/path-tracer/material-table.ts';
import { createPathTracer, MAX_SAMPLES } from '../render/path-tracer/path-tracer.ts';
import type { PathTracer, TraceView } from '../render/path-tracer/path-tracer.ts';
import { bakeSceneVolume } from '../render/path-tracer/scene-volume.ts';
import type { Viewport } from '../render/viewport.ts';
import { element } from './dom.ts';
import { buildRenderFields, RENDER_PANELS } from './render-fields.ts';

export type RenderShortcuts = { toggle: () => void; keys: [string, () => void][] };
/** What final images need from the live renderer. */
export type RenderSession = {
  /** The tracer with the current scene, palette and materials uploaded; null when the GPU cannot path trace. */
  prepare: () => PathTracer | null;
  /** The live view: the editor camera and the lens focus. */
  view: () => TraceView;
  /** While a final image renders, the live view stops tracing. */
  setBusy: (busy: boolean) => void;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * MagicaVoxel's renderer mode (`pt_mode`, F2): the path tracer covers the viewport and refines while
 * nothing changes, the side panels switch to the render settings, and the left button stops editing:
 * it sets the focus depth (with a fixed focus) or, with Alt, picks the colour (and material) under it.
 */
export function bindRenderPanel(editor: Editor, viewport: Viewport, materials: MaterialCommands): { shortcuts: RenderShortcuts; session: RenderSession } {
  const { state } = editor;
  const container = element('viewport', HTMLElement);
  const toggleButton = element('render-toggle', HTMLButtonElement);
  const samplesLabel = element('render-samples', HTMLOutputElement);
  const shadowsCheck = element('render-shadows', HTMLInputElement);
  const fixFocusCheck = element('render-fix-focus', HTMLInputElement);
  const focusInput = element('render-focus', HTMLInputElement);
  const iblRow = element('render-ibl-row', HTMLElement);
  const iblInput = element('render-ibl-input', HTMLInputElement);
  const iblName = element('render-ibl-name', HTMLSpanElement);

  let tracer: PathTracer | null = null;
  let settings = readRenderSettings(state.vox.renderObjects);
  let sceneStale = true;
  let paletteStale = true;
  let frameQueued = false;
  let busy = false;
  /** The `.hdr` file the tracer holds; the document only stores a file name, which the browser cannot open. */
  let loadedIbl: string | null = null;

  const write = (next: RenderSettings) => {
    settings = next;
    editor.setRenderObjects(writeRenderSettings(state.vox.renderObjects, next));
  };
  const syncFields = Object.entries(RENDER_PANELS).map(([panel, fields]) => buildRenderFields(element(`render-${panel}`, HTMLElement), fields, () => settings, write));
  const syncPanels = () => {
    syncFields.forEach((sync) => sync());
    iblRow.hidden = settings.environment !== 'ibl';
    iblName.textContent = !settings.ibl.path ? 'nenhuma' : settings.ibl.path === loadedIbl ? settings.ibl.path : `${settings.ibl.path} (não carregada)`;
  };

  const fail = (error: unknown) => {
    editor.status(`Renderizador: ${errorMessage(error)}`, 'error');
    editor.setRendering(false);
  };
  const focusDistance = () => (fixFocusCheck.checked ? Number(focusInput.value) || 0 : viewport.camera.distance());

  const view = (): TraceView => ({ camera: viewport.camera.camera(), focusDistance: focusDistance() });
  /** Uploads whatever changed since the last sample. */
  const upload = (target: PathTracer) => {
    if (sceneStale) target.setVolume(bakeSceneVolume(state.instances, state.vox.models));
    sceneStale = false;
    if (paletteStale) {
      target.setPalette(state.vox.palette);
      target.setMaterials(materialTable(state.vox.materials));
    }
    paletteStale = false;
  };

  const frame = () => {
    frameQueued = false;
    if (!state.rendering || !tracer || busy) return;
    try {
      upload(tracer);
      tracer.trace(view());
    } catch (error) {
      return fail(error);
    }
    samplesLabel.value = `${tracer.samples} amostra${tracer.samples === 1 ? '' : 's'}`;
    if (tracer.samples < MAX_SAMPLES) requestFrame();
  };
  const requestFrame = () => {
    if (frameQueued || !state.rendering) return;
    frameQueued = true;
    requestAnimationFrame(frame);
  };

  /** The tracer is made on first use: a GPU without float render targets only fails when asked to render. */
  const ensureTracer = () => {
    if (tracer) return tracer;
    try {
      tracer = createPathTracer(container);
      tracer.setSettings(settings);
      return tracer;
    } catch (error) {
      editor.status(`Renderizador: ${errorMessage(error)}`, 'error');
      return null;
    }
  };
  const toggle = () => {
    if (state.rendering || ensureTracer()) editor.setRendering(!state.rendering);
  };

  editor.subscribe((event) => {
    if (event.type === 'document' || event.type === 'scene' || event.type === 'frame' || event.type === 'voxels') sceneStale = true;
    if (event.type === 'document' || event.type === 'palette') paletteStale = true;
    if (event.type === 'document' || event.type === 'render') {
      settings = readRenderSettings(state.vox.renderObjects);
      tracer?.setSettings(settings);
      if (loadedIbl !== null && settings.ibl.path !== loadedIbl) {
        tracer?.setIbl(null);
        loadedIbl = null;
      }
      syncPanels();
    }
    if (event.type === 'render') {
      document.body.toggleAttribute('data-rendering', state.rendering);
      toggleButton.setAttribute('aria-pressed', String(state.rendering));
      if (tracer) tracer.canvas.hidden = !state.rendering;
    }
    if (sceneStale || paletteStale || event.type === 'render') requestFrame();
  });
  viewport.camera.onChange(requestFrame);
  new ResizeObserver(requestFrame).observe(container);

  toggleButton.addEventListener('click', toggle);
  shadowsCheck.addEventListener('change', () => {
    tracer?.setOptions({ shadows: shadowsCheck.checked });
    requestFrame();
  });
  for (const input of [fixFocusCheck, focusInput]) {
    input.addEventListener('change', () => {
      tracer?.reset();
      requestFrame();
    });
  }

  element('render-ibl-open', HTMLButtonElement).addEventListener('click', () => iblInput.click());
  iblInput.addEventListener('change', async () => {
    const file = iblInput.files?.[0];
    iblInput.value = '';
    if (!file) return;
    try {
      const image = parseHdr(new Uint8Array(await file.arrayBuffer()));
      const target = ensureTracer();
      if (!target) return;
      target.setIbl(image);
      loadedIbl = file.name;
      write({ ...settings, environment: 'ibl', ibl: { ...settings.ibl, path: file.name } });
      editor.status(`IBL: ${file.name} (${image.width}×${image.height})`);
    } catch (error) {
      editor.status(errorMessage(error), 'error');
    }
  });

  const pickColor = (clientX: number, clientY: number) => {
    const pick = viewport.pick(clientX, clientY);
    const instance = pick && state.instances.find(({ transformId }) => transformId === pick.transformId);
    const model = instance && state.vox.models[instance.model];
    const color = model && pick ? model.voxels[voxelIndex(model.size, ...pick.hit.voxel)] : EMPTY_VOXEL;
    if (color !== EMPTY_VOXEL) editor.setColor(color);
  };

  /* The left button belongs to the renderer while it shows: no voxel editing under it. */
  container.addEventListener(
    'pointerdown',
    (event) => {
      if (!state.rendering || event.button !== 0 || !(event.target instanceof HTMLCanvasElement)) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (event.altKey) return pickColor(event.clientX, event.clientY);
      const depth = fixFocusCheck.checked ? viewport.depthAt(event.clientX, event.clientY) : null;
      if (depth === null) return;
      focusInput.value = depth.toFixed(1);
      tracer?.reset();
      requestFrame();
    },
    { capture: true },
  );

  syncPanels();
  const toggleShow = (key: 'edge' | 'grid' | 'ground' | 'backgroundColor') => () => {
    if (state.rendering) write({ ...settings, show: { ...settings.show, [key]: !settings.show[key] } });
  };
  const session: RenderSession = {
    prepare() {
      const target = ensureTracer();
      if (target) upload(target);
      return target;
    },
    view,
    setBusy(next) {
      busy = next;
      tracer?.reset();
      requestFrame();
    },
  };
  const shortcuts: RenderShortcuts = {
    toggle,
    keys: [
      ['ctrl+r', materials.resetMaterial],
      ['ctrl+c', materials.copyMaterial],
      ['ctrl+v', materials.pasteMaterial],
      ['ctrl+e', toggleShow('edge')],
      ['ctrl+g', toggleShow('grid')],
      ['ctrl+u', toggleShow('ground')],
      ['ctrl+b', toggleShow('backgroundColor')],
      ['ctrl+w', () => shadowsCheck.click()],
    ],
  };
  return { shortcuts, session };
}
