import { BRUSH_MODES, BRUSH_TYPES } from '../editor/editor.ts';
import type { Editor } from '../editor/editor.ts';
import { GEO_SHAPES, STAMP_SHAPES } from '../editor/brush-shapes.ts';
import { isAxis } from '../format/rotation.ts';
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
  const optionSections = [...document.querySelectorAll<HTMLElement>('[data-brush-options]')];

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
    optionSections.forEach((section) => (section.hidden = section.dataset.brushOptions !== state.brushMode));
  };
  sync();
  editor.subscribe((event) => {
    if (event.type === 'tool' || event.type === 'document') sync();
  });
}
