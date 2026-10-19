import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { spriteModel } from '../format/sprite.ts';
import { element } from './dom.ts';

const isImage = (name: string) => /\.png$/i.test(name);

/** MagicaVoxel `i <png>` and "Import Sprites Animation" (`i ... | opack loop`): PNG images become upright one-voxel-deep objects. */
export function bindImportActions(editor: Editor, commands: ObjectCommands): void {
  const input = element('sprite-input', HTMLInputElement);
  let animate = false;

  const importSprites = async (files: File[], asAnimation: boolean) => {
    const images = files.filter((file) => isImage(file.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (images.length === 0) return;
    try {
      const models = await Promise.all(
        images.map(async (file) => {
          const bitmap = await createImageBitmap(file);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas 2D indisponível');
          context.drawImage(bitmap, 0, 0);
          return spriteModel(context.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height, editor.state.vox.palette);
        }),
      );
      if (editor.state.mode !== 'world') editor.setMode('world');
      commands.importModels(models, images.map((file) => file.name.replace(/\.png$/i, '')));
      if (asAnimation && models.length > 1) commands.packSelected(true);
    } catch (error) {
      editor.fail('Não foi possível importar as imagens', error);
    }
  };

  element('import-sprites', HTMLButtonElement).addEventListener('click', (event) => {
    animate = event.shiftKey;
    input.click();
  });
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    void importSprites(files, animate);
  });
  /** Images dropped outside the palette import as sprites; several at once with Shift make an animation. */
  window.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    const palette = document.getElementById('palette')?.closest('section');
    if (palette && event.target instanceof Node && palette.contains(event.target)) return;
    if (files.some((file) => isImage(file.name))) void importSprites(files, event.shiftKey);
  });
}
