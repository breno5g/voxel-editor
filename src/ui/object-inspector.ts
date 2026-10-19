import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { isAxis } from '../format/rotation.ts';
import { evaluateShape, isLooping } from '../scene/keyframes.ts';
import { element } from './dom.ts';

/** Name, size, rotation, mirroring and lifecycle of the selected object. Disabled without a selection. */
export function bindObjectInspector(editor: Editor, commands: ObjectCommands): void {
  const { state } = editor;
  const inspector = element('inspector', HTMLFieldSetElement);
  const name = element('object-name', HTMLInputElement);
  const size = [element('size-x', HTMLInputElement), element('size-y', HTMLInputElement), element('size-z', HTMLInputElement)];

  const applySize = () => commands.resizeSelected([size[0].valueAsNumber, size[1].valueAsNumber, size[2].valueAsNumber]);
  element('apply-size', HTMLButtonElement).addEventListener('click', applySize);
  size.forEach((input) => input.addEventListener('keydown', (event) => event.key === 'Enter' && applySize()));
  name.addEventListener('change', () => commands.renameSelected(name.value));
  element('shrink-object', HTMLButtonElement).addEventListener('click', commands.shrinkSelected);
  element('duplicate-object', HTMLButtonElement).addEventListener('click', () => commands.duplicateSelected());
  element('delete-object', HTMLButtonElement).addEventListener('click', commands.deleteSelected);

  inspector.querySelectorAll<HTMLButtonElement>('[data-rotate]').forEach((button) =>
    button.addEventListener('click', (event) => {
      const axis = Number(button.dataset.rotate);
      if (isAxis(axis)) commands.rotateSelected(axis, event.shiftKey ? -1 : 1);
    }),
  );
  inspector.querySelectorAll<HTMLButtonElement>('[data-mirror]').forEach((button) =>
    button.addEventListener('click', () => {
      const axis = Number(button.dataset.mirror);
      if (isAxis(axis)) commands.mirrorSelected(axis);
    }),
  );

  const sync = () => {
    const transform = state.selected === null ? undefined : state.vox.nodes[state.selected];
    const shape = transform?.kind === 'transform' ? state.vox.nodes[transform.child] : undefined;
    inspector.disabled = shape?.kind !== 'shape';
    if (transform?.kind !== 'transform' || shape?.kind !== 'shape') return;
    if (document.activeElement !== name) name.value = transform.attrs.get('_name') ?? '';
    const model = state.vox.models[evaluateShape(shape.keys, state.frame, isLooping(shape.attrs))];
    model?.size.forEach((axis, i) => {
      if (document.activeElement !== size[i]) size[i].value = String(axis);
    });
  };

  editor.subscribe((event) => {
    if (event.type === 'document' || event.type === 'scene' || event.type === 'selection' || event.type === 'frame') sync();
  });
}
