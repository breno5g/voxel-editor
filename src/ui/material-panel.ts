import { MATERIAL_PARAMS, MATERIAL_TYPES, materialParam, materialType, MEDIA_TYPES } from '../editor/material-commands.ts';
import type { MaterialCommands, MaterialParam } from '../editor/material-commands.ts';
import type { Editor } from '../editor/editor.ts';
import { t } from '../i18n/i18n.ts';
import { bindButtonGroup, element } from './dom.ts';

const PARAM_KEYS = Object.keys(MATERIAL_PARAMS).filter((key): key is MaterialParam => key in MATERIAL_PARAMS);
/** Volumes (glass, blend, cloud) choose how their medium behaves. */
const MEDIA_OWNERS = new Set(['_glass', '_blend', '_media']);
const SLIDER_STEPS = 100;

/** MagicaVoxel's material panel for the current colour (or the palette selection): type, parameters, medium, reset/copy/paste. */
export function bindMaterialPanel(editor: Editor, materials: MaterialCommands): void {
  const { state } = editor;
  const panel = element('material-tools', HTMLElement);
  const toggle = element('material-tools-toggle', HTMLButtonElement);
  const title = element('material-title', HTMLElement);
  const media = element('material-media-row', HTMLElement);
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    toggle.setAttribute('aria-pressed', String(!panel.hidden));
  });

  const showType = bindButtonGroup('material-type', (raw) => MATERIAL_TYPES.find((type) => type === raw), materials.setMaterialType);
  const showMedia = bindButtonGroup('material-media', (raw) => MEDIA_TYPES.find((type) => type === raw), materials.setMediaType);
  element('material-reset', HTMLButtonElement).addEventListener('click', materials.resetMaterial);
  element('material-copy', HTMLButtonElement).addEventListener('click', materials.copyMaterial);
  element('material-paste', HTMLButtonElement).addEventListener('click', materials.pasteMaterial);

  const rows = PARAM_KEYS.map((key) => {
    const { label, title, min, max } = MATERIAL_PARAMS[key];
    const row = Object.assign(document.createElement('label'), { className: 'control-row slider-row' });
    const name = Object.assign(document.createElement('span'), { className: 'label', textContent: label, title });
    const slider = Object.assign(document.createElement('input'), { type: 'range', min: String(min), max: String(max), step: String((max - min) / SLIDER_STEPS) });
    slider.addEventListener('change', () => materials.setMaterialParam(key, slider.valueAsNumber));
    row.append(name, slider);
    return { key, row, slider };
  });
  element('material-params', HTMLElement).replaceChildren(...rows.map(({ row }) => row));

  const sync = () => {
    const attrs = materials.materialOf(state.color);
    const type = materialType(attrs);
    const count = state.paletteSelection.length;
    title.textContent = count > 1 ? t('Material de {count} cores (a cor {color} mostrada)', { count, color: state.color }) : t('Material da cor {color}', { color: state.color });
    showType(type);
    rows.forEach(({ key, row, slider }) => {
      row.hidden = !MATERIAL_PARAMS[key].types.some((owner) => owner === type);
      slider.value = String(materialParam(attrs, key));
    });
    media.hidden = !MEDIA_OWNERS.has(type);
    showMedia(MEDIA_TYPES.find((value) => value === attrs?.get('_media_type')) ?? '_absorb');
  };
  sync();
  editor.subscribe((event) => {
    if (event.type === 'document' || event.type === 'palette' || event.type === 'color') sync();
  });
}
