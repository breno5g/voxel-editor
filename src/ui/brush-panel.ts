import { BRUSH_MODES, BRUSH_TYPES, MARQUEE_MODES, TRANSFORM_TOOLS } from '../editor/editor.ts';
import type { TransformTool } from '../editor/editor.ts';
import type { Editor } from '../editor/editor.ts';
import { GEO_SHAPES, STAMP_SHAPES } from '../editor/brush-shapes.ts';
import { isAxis } from '../format/rotation.ts';
import { t } from '../i18n/i18n.ts';
import { bindButtonGroup, element } from './dom.ts';

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (raw: string | undefined): T | undefined =>
    values.find((value) => value === raw);
const flag = (onValue: string, offValue: string) => (raw: string | undefined) => (raw === onValue ? true : raw === offValue ? false : undefined);

/** Toggle buttons with `data-axis` in group `groupId`; returns the function that shows the enabled axes. */
function bindAxisToggles(groupId: string, toggle: (axis: 0 | 1 | 2) => void) {
  const buttons = [...element(groupId, HTMLElement).querySelectorAll('button')];
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      const axis = Number(button.dataset.axis);
      if (isAxis(axis)) toggle(axis);
    }),
  );
  return (enabled: readonly boolean[]) => buttons.forEach((button) => button.setAttribute('aria-pressed', String(enabled[Number(button.dataset.axis)] ?? false)));
}

const TRANSFORM_HINTS: Record<TransformTool, string> = {
  move: t('Arraste a seleção; ela dá a volta no volume. Ctrl limita a um eixo.'),
  scale: t('Arraste uma face da seleção. Shift: dos dois lados. Enter aplica, Esc cancela.'),
  wrap: t('Arraste uma face para repetir a seleção. Shift: dos dois lados. Enter aplica, Esc cancela.'),
  rotate: t('Arraste na horizontal para girar em torno do eixo da face. Shift: de 15 em 15°. Enter aplica, Esc cancela.'),
};

/** MagicaVoxel's brush panel: mode, action, mirror, axis and the options of the current mode. */
export function bindBrushPanel(editor: Editor): void {
  const { state } = editor;
  const showMode = bindButtonGroup('brush-modes', oneOf(BRUSH_MODES), editor.setBrushMode);
  const showType = bindButtonGroup('brush-types', oneOf(BRUSH_TYPES), editor.setBrushType);
  const showMirror = bindAxisToggles('mirror', editor.toggleMirror);
  const showAxes = bindAxisToggles('axes', editor.toggleAxis);

  const voxSize = element('vox-size', HTMLInputElement);
  voxSize.addEventListener('change', () => editor.setVoxBrush({ size: voxSize.valueAsNumber || state.voxBrush.size }));
  const showStamp = bindButtonGroup('vox-shape', oneOf(STAMP_SHAPES), (shape) => editor.setVoxBrush({ shape }));
  const showVolume = bindButtonGroup('vox-volume', flag('3d', '2d'), (volume) => editor.setVoxBrush({ volume }));
  const showFaceColor = bindButtonGroup('face-color', flag('palette', 'voxel'), (usePalette) => editor.setFaceBrush({ usePalette }));
  const showFaceConnect = bindButtonGroup('face-connect', flag('color', 'geometry'), (byColor) => editor.setFaceBrush({ byColor }));
  const showFaceNeighbors = bindButtonGroup('face-neighbors', (raw) => (raw === '4' ? 4 : raw === '8' ? 8 : undefined), (neighbors) => editor.setFaceBrush({ neighbors }));
  const showGeoShape = bindButtonGroup('geo-shape', oneOf(GEO_SHAPES), (shape) => editor.setGeoBrush({ shape }));
  const geoChecks = { project: element('geo-project', HTMLInputElement), fill: element('geo-fill', HTMLInputElement), even: element('geo-even', HTMLInputElement) };
  geoChecks.project.addEventListener('change', () => editor.setGeoBrush({ project: geoChecks.project.checked }));
  geoChecks.fill.addEventListener('change', () => editor.setGeoBrush({ fill: geoChecks.fill.checked }));
  geoChecks.even.addEventListener('change', () => editor.setGeoBrush({ even: geoChecks.even.checked }));
  const showRegionScope = bindButtonGroup('region-scope', flag('connected', 'color'), (connected) => editor.setRegionBrush({ connected }));
  const showRegionConnect = bindButtonGroup('region-connect', flag('color', 'geometry'), (byColor) => editor.setRegionBrush({ byColor }));
  const showRegionNeighbors = bindButtonGroup('region-neighbors', (raw) => (raw === '6' ? 6 : raw === '26' ? 26 : undefined), (neighbors) => editor.setRegionBrush({ neighbors }));
  const showMarquee = bindButtonGroup('marquee-mode', oneOf(MARQUEE_MODES), editor.setMarquee);
  const resizeTool = element('resize-tool', HTMLButtonElement);
  resizeTool.addEventListener('click', () => editor.setBrushType(state.brushType === 'resize' ? 'attach' : 'resize'));
  const optionSections = [...document.querySelectorAll<HTMLElement>('[data-brush-options]')];
  const regionOptions = [...document.querySelectorAll<HTMLElement>('[data-region-options]')];
  const marqueeOptions = element('marquee-options', HTMLElement);
  const transformOptions = element('transform-options', HTMLElement);
  const showTransform = bindButtonGroup('transform-tool', oneOf(TRANSFORM_TOOLS), (tool) => {
    editor.setTransformTool(tool);
    editor.status(TRANSFORM_HINTS[tool]);
  });
  const wrapOptions = element('wrap-options', HTMLElement);
  const wrapInputs = (['wrap-x', 'wrap-y', 'wrap-z'] as const).map((id) => element(id, HTMLInputElement));
  wrapInputs.forEach((input, axis) => input.addEventListener('change', () => isAxis(axis) && editor.setWrapSpacing(axis, input.valueAsNumber)));
  /** Brush-shaped actions: edits, and the marquee when it selects with the brush. */
  const isStroke = () =>
    state.brushType === 'attach' || state.brushType === 'erase' || state.brushType === 'paint' || (state.brushType === 'msel' && state.marquee === 'brush');

  const sync = () => {
    showMode(state.brushMode);
    showType(state.brushType);
    showMirror(state.mirror);
    showAxes(state.axes);
    voxSize.value = String(state.voxBrush.size);
    showStamp(state.voxBrush.shape);
    showVolume(state.voxBrush.volume);
    showFaceColor(state.faceBrush.usePalette);
    showFaceConnect(state.faceBrush.byColor);
    showFaceNeighbors(state.faceBrush.neighbors);
    showGeoShape(state.geoBrush.shape);
    geoChecks.project.checked = state.geoBrush.project;
    geoChecks.fill.checked = state.geoBrush.fill;
    geoChecks.even.checked = state.geoBrush.even;
    geoChecks.project.disabled = state.geoBrush.shape !== 'line';
    geoChecks.fill.disabled = state.geoBrush.shape === 'line';
    geoChecks.even.disabled = state.geoBrush.shape === 'line';
    showRegionScope(state.regionBrush.connected);
    showRegionConnect(state.regionBrush.byColor);
    showRegionNeighbors(state.regionBrush.neighbors);
    showMarquee(state.marquee);
    resizeTool.setAttribute('aria-pressed', String(state.brushType === 'resize'));
    optionSections.forEach((section) => (section.hidden = !isStroke() || section.dataset.brushOptions !== state.brushMode));
    regionOptions.forEach((section) => (section.hidden = state.brushType !== 'remove' && state.brushType !== 'replace' && state.brushType !== 'asel'));
    marqueeOptions.hidden = state.brushType !== 'msel';
    transformOptions.hidden = state.brushType !== 'xform';
    showTransform(state.transformTool);
    wrapOptions.hidden = state.transformTool !== 'wrap';
    wrapInputs.forEach((input, axis) => (input.value = String(state.wrapSpacing[axis])));
  };
  sync();
  editor.subscribe((event) => {
    if (event.type === 'tool' || event.type === 'document') sync();
  });
}
