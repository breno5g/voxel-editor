import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { listObjects } from '../scene/scene-graph.ts';
import { isUnder, parentMap, rootLevel } from '../scene/scene-tree.ts';
import { element } from './dom.ts';

/** Every object in the scene (hidden ones too), with selection (Shift or Ctrl adds) and a visibility toggle. */
export function bindObjectsPanel(editor: Editor, commands: ObjectCommands): void {
  const list = element('object-list', HTMLUListElement);

  const render = () => {
    const { vox, selection } = editor.state;
    const parents = parentMap(vox);
    const items = listObjects(vox).map(({ transformId, shapeId, hidden }) => {
      const transform = vox.nodes[transformId];
      const shape = vox.nodes[shapeId];
      const label = transform.attrs.get('_name') ?? `Objeto ${transformId}`;
      const isAnimated = (transform.kind === 'transform' && transform.keys.length > 1) || (shape.kind === 'shape' && shape.keys.length > 1);

      const name = Object.assign(document.createElement('button'), { type: 'button', className: 'object-name', textContent: label });
      name.setAttribute('aria-current', String(selection.some((id) => isUnder(parents, transformId, id))));
      name.dataset.hidden = String(hidden);
      name.addEventListener('click', (event) => {
        if (!event.shiftKey && !event.ctrlKey) return editor.focusObject(transformId);
        const { selection: current } = editor.state;
        if (parents.get(transformId) !== (editor.state.level ?? rootLevel(vox))) return editor.focusObject(transformId);
        editor.setSelection(current.includes(transformId) ? current.filter((id) => id !== transformId) : [...current, transformId]);
      });
      if (isAnimated) name.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: '◆', title: 'Animado' }));

      const visibility = Object.assign(document.createElement('button'), { type: 'button', className: 'visibility', textContent: hidden ? '◌' : '●' });
      visibility.title = hidden ? `Mostrar ${label}` : `Ocultar ${label}`;
      visibility.setAttribute('aria-pressed', String(!hidden));
      visibility.addEventListener('click', () => commands.toggleHidden(transformId));

      const item = document.createElement('li');
      item.append(name, visibility);
      return item;
    });
    list.replaceChildren(...items);
  };

  editor.subscribe((event) => {
    if (event.type === 'document' || event.type === 'scene' || event.type === 'selection') render();
  });
}
