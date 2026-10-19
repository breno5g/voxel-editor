import { COMPONENT_LABELS } from '../editor/component-commands.ts';
import type { ComponentCommands } from '../editor/component-commands.ts';
import type { Editor } from '../editor/editor.ts';
import { COMPONENTS } from '../format/components.ts';
import type { Component } from '../format/components.ts';
import { parseVox } from '../format/vox-reader.ts';
import { downloadBlob, element } from './dom.ts';

const STORAGE_KEY = 'voxel-editor:saved-components';

/** The `save_*` switches are a per-browser preference, like MagicaVoxel's config. */
function storedChoices(): Map<Component, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const entries = new Map(typeof parsed === 'object' && parsed !== null ? Object.entries(parsed) : []);
    return new Map(COMPONENTS.flatMap((component): [Component, boolean][] => {
      const saved = entries.get(component);
      return typeof saved === 'boolean' ? [[component, saved]] : [];
    }));
  } catch {
    return new Map();
  }
}

/** MagicaVoxel's File panel rows: import (`i_comp`), export (`o_comp`) and "Save in the File" per component. */
export function bindComponentsPanel(editor: Editor, components: ComponentCommands): void {
  const { state } = editor;
  const list = element('component-list', HTMLUListElement);
  const input = element('component-input', HTMLInputElement);
  let importing: Component | null = null;

  storedChoices().forEach((saved, component) => editor.setSavedComponent(component, saved));

  const button = (label: string, title: string, action: () => void) => {
    const control = Object.assign(document.createElement('button'), { type: 'button', textContent: label, title });
    control.addEventListener('click', action);
    return control;
  };

  list.replaceChildren(
    ...COMPONENTS.map((component) => {
      const item = document.createElement('li');
      const label = COMPONENT_LABELS[component];
      const saved = Object.assign(document.createElement('input'), { type: 'checkbox', checked: state.savedComponents[component], title: `Salvar ${label.toLowerCase()} no arquivo` });
      saved.addEventListener('change', () => {
        editor.setSavedComponent(component, saved.checked);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state.savedComponents));
        } catch (error) {
          editor.fail('Não foi possível guardar a escolha', error);
        }
      });
      const check = Object.assign(document.createElement('label'), { className: 'check' });
      check.append(saved, ' Salvar');
      const actions = Object.assign(document.createElement('div'), { className: 'segmented' });
      actions.append(
        button('Importar', `Trazer ${label.toLowerCase()} de outro .vox`, () => {
          importing = component;
          input.click();
        }),
        button('Exportar', `Baixar um .vox só com ${label.toLowerCase()}`, () => {
          const base = state.fileName.replace(/\.vox$/i, '');
          downloadBlob(new Blob([components.exportComponent(component)], { type: 'application/octet-stream' }), `${base}-${component}.vox`);
        }),
      );
      item.append(Object.assign(document.createElement('span'), { textContent: label }), check, actions);
      return item;
    }),
  );

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !importing) return;
    try {
      components.importComponent(importing, parseVox(new Uint8Array(await file.arrayBuffer())));
    } catch (error) {
      editor.fail(`Não foi possível ler ${file.name}`, error);
    }
  });
}
