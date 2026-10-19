import type { ModelCommands } from '../editor/model-commands.ts';
import { element } from './dom.ts';

/** Model editor actions on the whole volume (MagicaVoxel's edit panel). */
export function bindModelPanel(models: ModelCommands): void {
  const actions: [string, () => void][] = [
    ['model-full', models.full],
    ['model-fill', models.fill],
    ['model-zero', models.zero],
  ];
  actions.forEach(([id, action]) => element(id, HTMLButtonElement).addEventListener('click', action));
}
