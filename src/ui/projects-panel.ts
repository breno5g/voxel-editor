import type { Editor } from '../editor/editor.ts';
import type { ProjectStore } from '../editor/project-store.ts';
import { element } from './dom.ts';

const KILOBYTE = 1024;

/** MagicaVoxel's project list, for documents kept in the browser. */
export function bindProjectsPanel(editor: Editor, projects: ProjectStore): void {
  const dialog = element('projects-dialog', HTMLDialogElement);
  const list = element('project-list', HTMLUListElement);
  const name = element('project-name', HTMLInputElement);
  const confirmDiscard = () => !editor.state.dirty || window.confirm('Há alterações não salvas. Descartar?');

  const guarded = (action: () => Promise<void>) => async () => {
    try {
      await action();
      await render();
    } catch (error) {
      editor.fail('Projetos', error);
    }
  };

  const button = (label: string, title: string, action: () => void) => {
    const control = Object.assign(document.createElement('button'), { type: 'button', textContent: label, title });
    control.addEventListener('click', action);
    return control;
  };

  async function render() {
    const entries = await projects.list();
    list.replaceChildren(
      ...entries.map((entry) => {
        const item = document.createElement('li');
        const label = document.createElement('span');
        label.append(entry.name, ' ', Object.assign(document.createElement('small'), { textContent: `${new Date(entry.savedAt).toLocaleString()} · ${Math.ceil(entry.bytes / KILOBYTE)} KB` }));
        const actions = Object.assign(document.createElement('div'), { className: 'segmented' });
        actions.append(
          button('Abrir', `Abrir ${entry.name}`, () => {
            if (!confirmDiscard()) return;
            void guarded(() => projects.open(entry.name))().then(() => dialog.close());
          }),
          button('Duplicar', `Duplicar ${entry.name}`, () => void guarded(() => projects.duplicate(entry.name))()),
          button('Apagar', `Apagar ${entry.name}`, () => {
            if (window.confirm(`Apagar ${entry.name} do navegador?`)) void guarded(() => projects.remove(entry.name))();
          }),
        );
        item.append(label, actions);
        return item;
      }),
    );
    if (entries.length === 0) list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Nenhum projeto salvo no navegador ainda.' }));
  }

  element('project-save', HTMLButtonElement).addEventListener('click', () => void guarded(() => projects.save(name.value || editor.state.fileName))());
  element('open-projects', HTMLButtonElement).addEventListener('click', () => {
    name.value = editor.state.fileName;
    dialog.showModal();
    void guarded(async () => undefined)();
  });
}
