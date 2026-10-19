import { ENVIRONMENTS, PROJECTIONS } from '../format/render-settings.ts';
import type { RenderSettings } from '../format/render-settings.ts';
import type { Vec3 } from '../format/vox.ts';

type Read<T> = (settings: RenderSettings) => T;
type Write<T> = (settings: RenderSettings, value: T) => void;
type Common = { label: string; title?: string; when?: Read<boolean> };
type Field = Common &
  (
    | { kind: 'number'; min: number; max: number; step: number; get: Read<number>; set: Write<number> }
    | { kind: 'color'; get: Read<Vec3>; set: Write<Vec3> }
    | { kind: 'check'; get: Read<boolean>; set: Write<boolean> }
    | { kind: 'choice'; options: readonly (readonly [value: string, label: string])[]; get: Read<string>; set: Write<string> }
    | { kind: 'heading' }
  );

const heading = (label: string): Field => ({ kind: 'heading', label });
const environmentIs = (environment: RenderSettings['environment']) => (settings: RenderSettings) => settings.environment === environment;

/** MagicaVoxel's render panels (`config/ui/r_*.ui`), field by field, over the typed `rOBJ` settings. */
export const RENDER_PANELS = {
  light: [
    heading('Sol'),
    { kind: 'number', label: 'Altura', title: 'Ângulo do sol acima do horizonte', min: -90, max: 90, step: 1, get: (s) => s.sun.pitch, set: (s, v) => (s.sun.pitch = v) },
    { kind: 'number', label: 'Direção', title: 'Ângulo do sol em volta do eixo Z', min: 0, max: 360, step: 1, get: (s) => s.sun.yaw, set: (s, v) => (s.sun.yaw = v) },
    { kind: 'number', label: 'Área', title: 'Tamanho do sol: sombras mais suaves', min: 0, max: 1, step: 0.01, get: (s) => s.sun.area, set: (s, v) => (s.sun.area = v) },
    { kind: 'number', label: 'Intensidade', min: 0, max: 500, step: 0.05, get: (s) => s.sun.intensity, set: (s, v) => (s.sun.intensity = v) },
    { kind: 'color', label: 'Cor', get: (s) => s.sun.color, set: (s, v) => (s.sun.color = v) },
    { kind: 'check', label: 'Disco do sol visível', get: (s) => s.sun.disk, set: (s, v) => (s.sun.disk = v) },
    heading('Céu'),
    { kind: 'choice', label: 'Tipo', options: [['uniform', 'Uniforme'], ['atmosphere', 'Atmosfera'], ['ibl', 'Imagem (IBL)']], get: (s) => s.environment, set: (s, v) => (s.environment = ENVIRONMENTS.find((environment) => environment === v) ?? s.environment) },
    { kind: 'number', label: 'Intensidade', min: 0, max: 500, step: 0.05, when: environmentIs('uniform'), get: (s) => s.sky.intensity, set: (s, v) => (s.sky.intensity = v) },
    { kind: 'color', label: 'Cor', when: environmentIs('uniform'), get: (s) => s.sky.color, set: (s, v) => (s.sky.color = v) },
    { kind: 'number', label: 'Rayleigh', min: 0, max: 1, step: 0.01, when: environmentIs('atmosphere'), get: (s) => s.atmosphere.rayleigh, set: (s, v) => (s.atmosphere.rayleigh = v) },
    { kind: 'color', label: 'Cor Rayleigh', when: environmentIs('atmosphere'), get: (s) => s.atmosphere.rayleighColor, set: (s, v) => (s.atmosphere.rayleighColor = v) },
    { kind: 'number', label: 'Mie', min: 0, max: 1, step: 0.01, when: environmentIs('atmosphere'), get: (s) => s.atmosphere.mie, set: (s, v) => (s.atmosphere.mie = v) },
    { kind: 'color', label: 'Cor Mie', when: environmentIs('atmosphere'), get: (s) => s.atmosphere.mieColor, set: (s, v) => (s.atmosphere.mieColor = v) },
    { kind: 'number', label: 'Fase Mie', min: -0.9, max: 0.9, step: 0.01, when: environmentIs('atmosphere'), get: (s) => s.atmosphere.miePhase, set: (s, v) => (s.atmosphere.miePhase = v) },
    { kind: 'number', label: 'Ozônio', min: 0, max: 1, step: 0.01, when: environmentIs('atmosphere'), get: (s) => s.atmosphere.ozone, set: (s, v) => (s.atmosphere.ozone = v) },
    { kind: 'color', label: 'Cor ozônio', when: environmentIs('atmosphere'), get: (s) => s.atmosphere.ozoneColor, set: (s, v) => (s.atmosphere.ozoneColor = v) },
    { kind: 'number', label: 'Intensidade', min: 0, max: 500, step: 0.05, when: environmentIs('ibl'), get: (s) => s.ibl.intensity, set: (s, v) => (s.ibl.intensity = v) },
    { kind: 'number', label: 'Rotação', min: 0, max: 360, step: 1, when: environmentIs('ibl'), get: (s) => s.ibl.yaw, set: (s, v) => (s.ibl.yaw = v) },
  ],
  fog: [
    heading('Névoa'),
    { kind: 'number', label: 'Densidade', min: 0, max: 5000, step: 0.01, get: (s) => s.fog.density, set: (s, v) => (s.fog.density = v) },
    { kind: 'color', label: 'Cor', get: (s) => s.fog.color, set: (s, v) => (s.fog.color = v) },
    { kind: 'number', label: 'Fase', title: 'Espalhamento para frente (+) ou para trás (−)', min: -0.9, max: 0.9, step: 0.01, get: (s) => s.fog.phase, set: (s, v) => (s.fog.phase = v) },
  ],
  lens: [
    heading('Lente'),
    { kind: 'choice', label: 'Projeção', options: [['perspective', 'Perspectiva'], ['stereographic', 'Estereográfica'], ['panorama', 'Panorama']], get: (s) => s.lens.projection, set: (s, v) => (s.lens.projection = PROJECTIONS.find((projection) => projection === v) ?? s.lens.projection) },
    { kind: 'number', label: 'FOV', title: 'Campo de visão do render, separado do da câmera do editor', min: 1, max: 360, step: 1, get: (s) => s.lens.fov, set: (s, v) => (s.lens.fov = v) },
    { kind: 'number', label: 'Abertura', title: 'Profundidade de campo: 0 deixa tudo nítido', min: 0, max: 1, step: 0.01, get: (s) => s.lens.aperture, set: (s, v) => (s.lens.aperture = v) },
    { kind: 'number', label: 'Lâminas', title: 'Formato do desfoque: 0 é redondo', min: 0, max: 8, step: 1, get: (s) => s.lens.blades, set: (s, v) => (s.lens.blades = v) },
    { kind: 'number', label: 'Rotação', min: -180, max: 180, step: 1, get: (s) => s.lens.bladeRotation, set: (s, v) => (s.lens.bladeRotation = v) },
  ],
  film: [
    heading('Filme'),
    { kind: 'number', label: 'Exposição', min: 0, max: 30, step: 0.1, get: (s) => s.film.exposure, set: (s, v) => (s.film.exposure = v) },
    { kind: 'number', label: 'Vinheta', min: 0, max: 1, step: 0.01, get: (s) => s.film.vignette, set: (s, v) => (s.film.vignette = v) },
    { kind: 'check', label: 'ACES (tom fílmico)', get: (s) => s.film.aces, set: (s, v) => (s.film.aces = v) },
    { kind: 'number', label: 'Gama', min: 1, max: 5, step: 0.1, get: (s) => s.film.gamma, set: (s, v) => (s.film.gamma = v) },
  ],
  display: [
    { kind: 'check', label: 'Chão', title: 'Ctrl+U', get: (s) => s.show.ground, set: (s, v) => (s.show.ground = v) },
    { kind: 'color', label: 'Cor', get: (s) => s.ground.color, set: (s, v) => (s.ground.color = v) },
    { kind: 'number', label: 'Horizonte', title: 'O chão se mistura ao céu com a distância', min: 0, max: 100, step: 0.01, get: (s) => s.ground.horizon, set: (s, v) => (s.ground.horizon = v) },
    { kind: 'check', label: 'Grade', title: 'Ctrl+G', get: (s) => s.show.grid, set: (s, v) => (s.show.grid = v) },
    { kind: 'color', label: 'Cor', when: (s) => s.show.grid, get: (s) => s.grid.color, set: (s, v) => (s.grid.color = v) },
    { kind: 'number', label: 'Espaço', when: (s) => s.show.grid, min: 1, max: 1024, step: 1, get: (s) => s.grid.spacing, set: (s, v) => (s.grid.spacing = v) },
    { kind: 'number', label: 'Largura', when: (s) => s.show.grid, min: 0.01, max: 1, step: 0.01, get: (s) => s.grid.width, set: (s, v) => (s.grid.width = v) },
    { kind: 'check', label: 'Grade só no chão', when: (s) => s.show.grid, get: (s) => s.grid.groundOnly, set: (s, v) => (s.grid.groundOnly = v) },
    { kind: 'check', label: 'Arestas', title: 'Ctrl+E', get: (s) => s.show.edge, set: (s, v) => (s.show.edge = v) },
    { kind: 'color', label: 'Cor', when: (s) => s.show.edge, get: (s) => s.edge.color, set: (s, v) => (s.edge.color = v) },
    { kind: 'number', label: 'Largura', when: (s) => s.show.edge, min: 0.01, max: 5, step: 0.01, get: (s) => s.edge.width, set: (s, v) => (s.edge.width = v) },
    { kind: 'check', label: 'Cor de fundo', title: 'Ctrl+B: o fundo mostra uma cor em vez do céu', get: (s) => s.show.backgroundColor, set: (s, v) => (s.show.backgroundColor = v) },
    { kind: 'color', label: 'Fundo', when: (s) => s.show.backgroundColor, get: (s) => s.background.color, set: (s, v) => (s.background.color = v) },
    { kind: 'check', label: 'Fundo transparente', get: (s) => s.show.transparent, set: (s, v) => (s.show.transparent = v) },
    { kind: 'number', label: 'Escala X', title: 'Tamanho do voxel no render', min: 0, max: 10, step: 0.1, get: (s) => s.show.scale[0], set: (s, v) => (s.show.scale = [v, s.show.scale[1], s.show.scale[2]]) },
    { kind: 'number', label: 'Escala Y', min: 0, max: 100, step: 0.1, get: (s) => s.show.scale[1], set: (s, v) => (s.show.scale = [s.show.scale[0], v, s.show.scale[2]]) },
    { kind: 'number', label: 'Escala Z', min: 0, max: 100, step: 0.1, get: (s) => s.show.scale[2], set: (s, v) => (s.show.scale = [s.show.scale[0], s.show.scale[1], v]) },
  ],
  sample: [
    { kind: 'number', label: 'Difuso', title: 'Rebatimentos difusos', min: 0, max: 15, step: 1, get: (s) => s.bounce.diffuse, set: (s, v) => (s.bounce.diffuse = v) },
    { kind: 'number', label: 'Especular', title: 'Reflexões e refrações', min: 0, max: 15, step: 1, get: (s) => s.bounce.specular, set: (s, v) => (s.bounce.specular = v) },
    { kind: 'number', label: 'Espalhamento', title: 'Rebatimentos na névoa', min: 0, max: 15, step: 1, get: (s) => s.bounce.scatter, set: (s, v) => (s.bounce.scatter = v) },
    { kind: 'number', label: 'Energia', title: 'Limite de brilho por amostra (tira vaga-lumes)', min: 1, max: 5000, step: 1, get: (s) => s.bounce.energy, set: (s, v) => (s.bounce.energy = v) },
  ],
} satisfies Record<string, Field[]>;

const toHex = (color: Vec3) => `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex: string): Vec3 => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/**
 * Builds the fields into `container`; each edit hands a changed copy of the settings to `write`.
 * Returns the function that shows the current settings in the fields.
 */
export function buildRenderFields(container: HTMLElement, fields: Field[], read: () => RenderSettings, write: (next: RenderSettings) => void): () => void {
  const edit = (change: (draft: RenderSettings) => void) => {
    const draft = structuredClone(read());
    change(draft);
    write(draft);
  };
  const syncs = fields.map((field) => {
    if (field.kind === 'heading') {
      container.append(Object.assign(document.createElement('h3'), { textContent: field.label }));
      return () => undefined;
    }
    const row = document.createElement('label');
    row.className = field.kind === 'check' ? 'check' : 'control-row';
    if (field.title) row.title = field.title;
    const name = Object.assign(document.createElement('span'), { className: 'label', textContent: field.label });
    container.append(row);
    const show = () => (row.hidden = field.when ? !field.when(read()) : false);
    if (field.kind === 'check') {
      const input = Object.assign(document.createElement('input'), { type: 'checkbox' });
      row.append(input, ` ${field.label}`);
      input.addEventListener('change', () => edit((draft) => field.set(draft, input.checked)));
      return () => {
        input.checked = field.get(read());
        show();
      };
    }
    if (field.kind === 'choice') {
      const select = document.createElement('select');
      select.append(...field.options.map(([value, label]) => new Option(label, value)));
      row.append(name, select);
      select.addEventListener('change', () => edit((draft) => field.set(draft, select.value)));
      return () => {
        select.value = field.get(read());
        show();
      };
    }
    if (field.kind === 'color') {
      const input = Object.assign(document.createElement('input'), { type: 'color' });
      row.append(name, input);
      input.addEventListener('input', () => edit((draft) => field.set(draft, fromHex(input.value))));
      return () => {
        input.value = toHex(field.get(read()));
        show();
      };
    }
    const input = Object.assign(document.createElement('input'), { type: 'number', min: String(field.min), max: String(field.max), step: String(field.step) });
    row.append(name, input);
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) edit((draft) => field.set(draft, Math.min(Math.max(value, field.min), field.max)));
    });
    return () => {
      if (document.activeElement !== input) input.value = String(field.get(read()));
      show();
    };
  });
  return () => syncs.forEach((sync) => sync());
}
