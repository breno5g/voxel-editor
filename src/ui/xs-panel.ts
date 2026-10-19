import type { Editor } from '../editor/editor.ts';
import type { ModelCommands } from '../editor/model-commands.ts';
import { createXsShader, EXAMPLE_SHADERS } from '../editor/xs-shader.ts';
import type { XsShader } from '../editor/xs-shader.ts';
import { createXsRunner } from '../render/xs-runner.ts';
import { t, tn } from '../i18n/i18n.ts';
import { element } from './dom.ts';

const STORAGE_KEY = 'voxel-editor:xs-shaders';

/** Loaded shader sources survive reloads (they are small text files); unreadable storage just starts empty. */
function storedShaders(): XsShader[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return [];
    return Object.entries(parsed).flatMap(([name, source]) => (typeof source === 'string' ? [createXsShader(name, source)] : []));
  } catch {
    return [];
  }
}

/** MagicaVoxel's XS shader panel and `xs <name> [args…]` console command: arguments come from each shader's header. */
export function bindXsPanel(editor: Editor, models: ModelCommands) {
  const { state } = editor;
  const runner = createXsRunner();
  const select = element('xs-shader', HTMLSelectElement);
  const argsContainer = element('xs-args', HTMLElement);
  const iterations = element('xs-iterations', HTMLInputElement);
  const fileInput = element('xs-input', HTMLInputElement);
  const library = new Map<string, XsShader>([...EXAMPLE_SHADERS, ...storedShaders()].map((shader) => [shader.name, shader]));
  let argInputs: HTMLInputElement[] = [];

  const save = () => {
    const custom = Object.fromEntries([...library.values()].filter((shader) => !EXAMPLE_SHADERS.includes(shader)).map((shader) => [shader.name, shader.source]));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
    } catch (error) {
      editor.fail(t('Não foi possível guardar os shaders'), error);
    }
  };

  const renderArgs = () => {
    const shader = library.get(select.value);
    argInputs = (shader?.args ?? []).map((arg) => Object.assign(document.createElement('input'), { type: 'number', min: String(arg.min), max: String(arg.max), step: String(arg.step), value: String(arg.value), title: t('{label} ({min} a {max})', { label: arg.label, min: arg.min, max: arg.max }) }));
    argsContainer.replaceChildren(
      ...argInputs.map((input, index) => {
        const row = Object.assign(document.createElement('label'), { className: 'control-row' });
        row.append(Object.assign(document.createElement('span'), { className: 'label', textContent: shader?.args[index].label ?? '', title: shader?.args[index].label ?? '' }), input);
        return row;
      }),
    );
  };

  const renderOptions = () => {
    const current = select.value;
    select.replaceChildren(...[...library.keys()].map((name) => Object.assign(document.createElement('option'), { value: name, textContent: name })));
    if (library.has(current)) select.value = current;
    renderArgs();
  };

  const run = (shader: XsShader, args: number[], passes: number, region: Uint8Array | null = null) => {
    try {
      models.apply(
        (model) =>
          runner.run(shader, model, {
            palette: state.vox.palette,
            color: state.color,
            colorSelection: state.paletteSelection,
            args,
            mirror: [Number(state.mirror[0]), Number(state.mirror[1]), Number(state.mirror[2])],
            axis: [Number(state.axes[0]), Number(state.axes[1]), Number(state.axes[2])],
            frame: state.frame - state.range[0],
            frameCount: state.range[1] - state.range[0] + 1,
            iterations: passes,
            random: Math.random,
          }),
        t('Shader {name} aplicado', { name: shader.name }),
        region,
      );
    } catch (error) {
      editor.fail(`Shader ${shader.name}`, error);
    }
  };

  /** The shader, arguments and iterations chosen in the panel, on the model, its selection, or `region`. */
  const runChosen = (region: Uint8Array | null = null) => {
    const shader = library.get(select.value);
    if (!shader) return editor.status(t('Escolha um shader XS no painel'), 'error');
    run(shader, argInputs.map((input) => input.valueAsNumber), Math.max(1, Math.round(iterations.valueAsNumber) || 1), region);
  };
  element('xs-run', HTMLButtonElement).addEventListener('click', () => runChosen());
  select.addEventListener('change', renderArgs);
  element('xs-open', HTMLButtonElement).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    for (const file of files) library.set(file.name.replace(/\.txt$/i, ''), createXsShader(file.name.replace(/\.txt$/i, ''), await file.text()));
    save();
    renderOptions();
    if (files[0]) select.value = files[0].name.replace(/\.txt$/i, '');
    renderArgs();
    editor.status(tn(files.length, '{n} shader carregado', '{n} shaders carregados'));
  });

  /** MagicaVoxel console: `xs [-n iterations] name args…`. */
  models.define('xs', (words) => {
    const passes = words[0] === '-n' ? Number(words[1]) : 1;
    const [name = '', ...values] = words[0] === '-n' ? words.slice(2) : words;
    const shader = library.get(name);
    if (!shader) return t('shader {name} não carregado ({loaded})', { name: name || '?', loaded: [...library.keys()].join(', ') });
    run(shader, shader.args.map((arg, index) => (values[index] === undefined ? arg.value : Number(values[index]))), Math.max(1, passes || 1));
  });

  renderOptions();
  return { runChosen };
}
