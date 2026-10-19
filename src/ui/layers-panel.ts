import type { Editor } from '../editor/editor.ts';
import { isLayerHidden, LAYER_COUNT, layerColor, layerName } from '../editor/layer-commands.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { element } from './dom.ts';

const DEFAULT_LAYER_COLOR = '#808080';

/** MagicaVoxel's layer bar: eight layer buttons, then name, colour and actions of the current layer. */
export function bindLayersPanel(editor: Editor, commands: ObjectCommands): void {
  const { state } = editor;
  const list = element('layer-list', HTMLElement);
  const name = element('layer-name', HTMLInputElement);
  const color = element('layer-color', HTMLInputElement);
  const visible = element('layer-visible', HTMLButtonElement);

  const buttons = Array.from({ length: LAYER_COUNT }, (_unused, id) => {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: String(id) });
    button.addEventListener('click', () => commands.useLayer(id));
    return button;
  });
  list.replaceChildren(...buttons);

  name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commands.renameLayer(state.layer, name.value);
  });
  name.addEventListener('change', () => commands.renameLayer(state.layer, name.value));
  color.addEventListener('change', () => commands.setLayerColor(state.layer, color.value));
  visible.addEventListener('click', () => commands.toggleLayerVisible(state.layer));
  element('layer-select', HTMLButtonElement).addEventListener('click', () => commands.selectLayer(state.layer));
  element('layer-sort', HTMLButtonElement).addEventListener('click', commands.sortLayers);

  const sync = () => {
    buttons.forEach((button, id) => {
      button.setAttribute('aria-pressed', String(id === state.layer));
      button.title = `${layerName(state.vox, id)}${isLayerHidden(state.vox, id) ? ' (oculta)' : ''}`;
      button.dataset.hidden = String(isLayerHidden(state.vox, id));
      button.style.borderBottomColor = layerColor(state.vox, id) ?? 'transparent';
    });
    if (document.activeElement !== name) name.value = layerName(state.vox, state.layer);
    color.value = layerColor(state.vox, state.layer) ?? DEFAULT_LAYER_COLOR;
    visible.textContent = isLayerHidden(state.vox, state.layer) ? 'Mostrar' : 'Ocultar';
  };
  sync();
  editor.subscribe((event) => {
    if (event.type === 'document' || event.type === 'scene' || event.type === 'tool') sync();
  });
}
