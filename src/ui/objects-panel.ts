import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { listObjects } from '../scene/scene-graph.ts';
import { element } from './dom.ts';

/** Every object in the scene (hidden ones too), with selection and a visibility toggle. */
export function bindObjectsPanel(editor: Editor, commands: ObjectCommands): void {
  const list = element('object-list', HTMLUListElement);

  const render = () => {
    const { vox, selected } = editor.state;
    const items = listObjects(vox).map(({ transformId, shapeId, hidden }) => {
      const transform = vox.nodes[transformId];
      const shape = vox.nodes[shapeId];
      const label = transform.attrs.get('_name') ?? `Objeto ${transformId}`;
      const isAnimated = (transform.kind === 'transform' && transform.keys.length > 1) || (shape.kind === 'shape' && shape.keys.length > 1);

      const name = Object.assign(document.createElement('button'), { type: 'button', className: 'object-name', textContent: label });
      name.setAttribute('aria-current', String(transformId === selected));
      name.dataset.hidden = String(hidden);
      name.addEventListener('click', () => editor.select(transformId));
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
