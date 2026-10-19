import type { Editor } from '../editor/editor.ts';
import { isLayerHidden } from '../editor/layer-commands.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { isHidden } from '../scene/scene-graph.ts';
import { groupNode, groupOf, isUnder, parentMap, rootLevel } from '../scene/scene-tree.ts';
import { t } from '../i18n/i18n.ts';
import { element } from './dom.ts';

/** Indentation per group level, in pixels. */
const INDENT = 12;

/**
 * MagicaVoxel's scene outline: every object and group (hidden ones too) as a tree with collapsible
 * groups (`oexpand`), selection (Shift or Ctrl adds) and a visibility toggle per row.
 */
export function bindObjectsPanel(editor: Editor, commands: ObjectCommands): void {
  const list = element('object-list', HTMLUListElement);
  const collapsed = new Set<number>();

  const render = () => {
    const { vox, selection, level } = editor.state;
    const parents = parentMap(vox);
    const items: HTMLLIElement[] = [];

    const row = (transformId: number, depth: number, hiddenAbove: boolean) => {
      const transform = vox.nodes[transformId];
      if (transform?.kind !== 'transform') return;
      const group = groupOf(vox, transformId);
      const shape = vox.nodes[transform.child];
      const hidden = hiddenAbove || isHidden(transform.attrs) || isLayerHidden(vox, transform.layer);
      const label = transform.attrs.get('_name') ?? (group === null ? t('Objeto {id}', { id: transformId }) : t('Grupo {id}', { id: transformId }));
      const isAnimated = transform.keys.length > 1 || (shape?.kind === 'shape' && shape.keys.length > 1);

      const item = document.createElement('li');
      item.style.paddingLeft = `${depth * INDENT}px`;
      if (group !== null) {
        const open = !collapsed.has(transformId);
        const expand = Object.assign(document.createElement('button'), { type: 'button', className: 'expand', textContent: open ? '▾' : '▸' });
        expand.setAttribute('aria-expanded', String(open));
        expand.title = open ? t('Recolher {name}', { name: label }) : t('Expandir {name}', { name: label });
        expand.addEventListener('click', () => {
          if (open) collapsed.add(transformId);
          else collapsed.delete(transformId);
          render();
        });
        item.append(expand);
      }

      const name = Object.assign(document.createElement('button'), { type: 'button', className: 'object-name', textContent: label });
      name.setAttribute('aria-current', String(selection.some((id) => isUnder(parents, transformId, id))));
      name.dataset.hidden = String(hidden);
      name.dataset.group = String(group !== null);
      name.addEventListener('click', (event) => {
        const atLevel = parents.get(transformId) === (level ?? rootLevel(vox));
        if (!atLevel || (!event.shiftKey && !event.ctrlKey)) return editor.focusObject(transformId);
        const current = editor.state.selection;
        editor.setSelection(current.includes(transformId) ? current.filter((id) => id !== transformId) : [...current, transformId]);
      });
      if (isAnimated) name.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: '◆', title: t('Animado') }));

      const visibility = Object.assign(document.createElement('button'), { type: 'button', className: 'visibility', textContent: hidden ? '◌' : '●' });
      visibility.title = hidden ? t('Mostrar {name}', { name: label }) : t('Ocultar {name}', { name: label });
      visibility.setAttribute('aria-pressed', String(!hidden));
      visibility.addEventListener('click', () => commands.toggleHidden(transformId));

      item.append(name, visibility);
      items.push(item);
      if (group !== null && !collapsed.has(transformId)) groupNode(vox, group)?.children.forEach((child) => row(child, depth + 1, hidden));
    };

    const root = rootLevel(vox);
    if (root !== null) groupNode(vox, root)?.children.forEach((child) => row(child, 0, false));
    list.replaceChildren(...items);
  };

  editor.subscribe((event) => {
    if (event.type === 'document' || event.type === 'scene' || event.type === 'selection') render();
  });
}
