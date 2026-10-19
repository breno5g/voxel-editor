import type { Dict, Vec3 } from './vox.ts';

/** `_env _mode`: what lights the scene besides the sun. */
export const ENVIRONMENTS = ['uniform', 'atmosphere', 'ibl'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
/** `_lens _proj`: perspective, stereographic, panorama. */
export const PROJECTIONS = ['perspective', 'stereographic', 'panorama'] as const;
export type Projection = (typeof PROJECTIONS)[number];

/** MagicaVoxel's renderer settings (its `rOBJ` chunks); colours are 0–255, angles in degrees. */
export type RenderSettings = {
  bounce: { diffuse: number; specular: number; scatter: number; energy: number };
  environment: Environment;
  sun: { intensity: number; color: Vec3; pitch: number; yaw: number; area: number; disk: boolean };
  sky: { intensity: number; color: Vec3 };
  ibl: { path: string; intensity: number; pitch: number; yaw: number };
  atmosphere: { rayleigh: number; rayleighColor: Vec3; mie: number; mieColor: Vec3; miePhase: number; ozone: number; ozoneColor: Vec3 };
  fog: { density: number; color: Vec3; phase: number };
  lens: { projection: Projection; fov: number; aperture: number; blades: number; bladeRotation: number };
  film: { exposure: number; vignette: number; aces: boolean; gamma: number };
  bloom: { mix: number; scale: number; aspect: number; threshold: number };
  ground: { color: Vec3; horizon: number };
  background: { color: Vec3 };
  edge: { color: Vec3; width: number };
  grid: { color: Vec3; spacing: number; width: number; groundOnly: boolean };
  show: { ground: boolean; grid: boolean; edge: boolean; backgroundColor: boolean; transparent: boolean; scale: Vec3; cell: number };
};

/** The rOBJ chunks of a new MagicaVoxel 0.99.7 document (from its sample files). */
export const DEFAULT_RENDER_OBJECTS: readonly [string, string][][] = [
  [['_type', '_bounce'], ['_diffuse', '2'], ['_specular', '5'], ['_scatter', '5'], ['_energy', '3']],
  [['_type', '_env'], ['_mode', '0']],
  [['_type', '_inf'], ['_i', '0.6'], ['_k', '255 255 255'], ['_angle', '50 50'], ['_area', '0.07'], ['_disk', '0']],
  [['_type', '_uni'], ['_i', '0.7'], ['_k', '255 255 255']],
  [['_type', '_ibl'], ['_path', ''], ['_i', '1'], ['_angle', '0 0']],
  [['_type', '_atm'], ['_ray_d', '0.4'], ['_ray_k', '45 104 255'], ['_mie_d', '0.4'], ['_mie_k', '255 255 255'], ['_mie_g', '0.85'], ['_o3_d', '0'], ['_o3_k', '105 255 110']],
  [['_type', '_fog_uni'], ['_d', '0'], ['_k', '255 255 255'], ['_g', '0']],
  [['_type', '_lens'], ['_proj', '0'], ['_fov', '45'], ['_aperture', '0.25'], ['_blade_n', '0'], ['_blade_r', '0']],
  [['_type', '_film'], ['_expo', '1'], ['_vig', '0'], ['_aces', '1'], ['_gam', '2.2']],
  [['_type', '_bloom'], ['_mix', '0.5'], ['_scale', '0'], ['_aspect', '0'], ['_threshold', '1']],
  [['_type', '_ground'], ['_color', '80 80 80'], ['_hor', '0.1']],
  [['_type', '_bg'], ['_color', '0 0 0']],
  [['_type', '_edge'], ['_color', '0 0 0'], ['_width', '0.2']],
  [['_type', '_grid'], ['_color', '0 0 0'], ['_spacing', '1'], ['_width', '0.05'], ['_display', '0']],
  [['_type', '_setting'], ['_ground', '1'], ['_grid', '0'], ['_edge', '0'], ['_bg_c', '0'], ['_bg_a', '0'], ['_scale', '1 1 1'], ['_cell', '1']],
];

const numbers = (text: string | undefined) => (text ?? '').trim().split(/\s+/).map(Number);
const vec3 = (text: string | undefined, fallback: Vec3): Vec3 => {
  const values = numbers(text);
  return values.length === 3 && values.every(Number.isFinite) ? [values[0], values[1], values[2]] : fallback;
};
const format = (value: number) => String(Number(value.toPrecision(6)));
const formatVec3 = (values: Vec3) => values.map(format).join(' ');
const flag = (value: boolean) => (value ? '1' : '0');

/** The file's rOBJ dictionaries, each laid over MagicaVoxel's defaults for its `_type`. */
function byType(objects: readonly Dict[]) {
  const merged = new Map(DEFAULT_RENDER_OBJECTS.map((entries) => [entries[0][1], new Map(entries)]));
  objects.forEach((attrs) => {
    const type = attrs.get('_type');
    if (type) merged.set(type, new Map([...(merged.get(type) ?? []), ...attrs]));
  });
  return (type: string) => {
    const attrs = merged.get(type) ?? new Map<string, string>();
    const defaults = new Map(DEFAULT_RENDER_OBJECTS.find((entries) => entries[0][1] === type) ?? []);
    const number = (key: string) => {
      const value = Number(attrs.get(key));
      return Number.isFinite(value) ? value : Number(defaults.get(key) ?? 0);
    };
    return { attrs, number, color: (key: string) => vec3(attrs.get(key), vec3(defaults.get(key), [0, 0, 0])), flag: (key: string) => number(key) !== 0 };
  };
}

export function readRenderSettings(objects: readonly Dict[]): RenderSettings {
  const of = byType(objects);
  const [sun, sky, ibl, atm, fog, lens, film, bloom, ground, edge, grid, show] = ['_inf', '_uni', '_ibl', '_atm', '_fog_uni', '_lens', '_film', '_bloom', '_ground', '_edge', '_grid', '_setting'].map(of);
  const bounce = of('_bounce');
  const [sunPitch = 50, sunYaw = 50] = numbers(sun.attrs.get('_angle'));
  /** Older files store the IBL turn as `_rot`, a fraction of a full turn. */
  const iblAngle = ibl.attrs.has('_rot') ? [0, ibl.number('_rot') * 360] : numbers(ibl.attrs.get('_angle'));
  return {
    bounce: { diffuse: bounce.number('_diffuse'), specular: bounce.number('_specular'), scatter: bounce.number('_scatter'), energy: bounce.number('_energy') },
    environment: ENVIRONMENTS[of('_env').number('_mode')] ?? 'uniform',
    sun: { intensity: sun.number('_i'), color: sun.color('_k'), pitch: sunPitch, yaw: sunYaw, area: sun.number('_area'), disk: sun.flag('_disk') },
    sky: { intensity: sky.number('_i'), color: sky.color('_k') },
    ibl: { path: ibl.attrs.get('_path') ?? '', intensity: ibl.number('_i'), pitch: iblAngle[0] ?? 0, yaw: iblAngle[1] ?? 0 },
    atmosphere: {
      rayleigh: atm.number('_ray_d'),
      rayleighColor: atm.color('_ray_k'),
      mie: atm.number('_mie_d'),
      mieColor: atm.color('_mie_k'),
      miePhase: atm.number('_mie_g'),
      ozone: atm.number('_o3_d'),
      ozoneColor: atm.color('_o3_k'),
    },
    fog: { density: fog.number('_d'), color: fog.color('_k'), phase: fog.number('_g') },
    lens: { projection: PROJECTIONS[lens.number('_proj')] ?? 'perspective', fov: lens.number('_fov'), aperture: lens.number('_aperture'), blades: lens.number('_blade_n'), bladeRotation: lens.number('_blade_r') },
    film: { exposure: film.number('_expo'), vignette: film.number('_vig'), aces: film.flag('_aces'), gamma: film.number('_gam') },
    bloom: { mix: bloom.number('_mix'), scale: bloom.number('_scale'), aspect: bloom.number('_aspect'), threshold: bloom.number('_threshold') },
    ground: { color: ground.color('_color'), horizon: ground.number('_hor') },
    background: { color: of('_bg').color('_color') },
    edge: { color: edge.color('_color'), width: edge.number('_width') },
    grid: { color: grid.color('_color'), spacing: grid.number('_spacing'), width: grid.number('_width'), groundOnly: grid.flag('_display') },
    show: { ground: show.flag('_ground'), grid: show.flag('_grid'), edge: show.flag('_edge'), backgroundColor: show.flag('_bg_c'), transparent: show.flag('_bg_a'), scale: show.color('_scale'), cell: show.number('_cell') },
  };
}

/** `settings` as rOBJ dictionaries: the file's own entries are updated in place, so keys this editor does not know survive. */
export function writeRenderSettings(objects: readonly Dict[], settings: RenderSettings): Dict[] {
  const { sun, sky, ibl, atmosphere, fog, lens, film, bloom, ground, edge, grid, show, bounce } = settings;
  const values: Record<string, Record<string, string>> = {
    _bounce: { _diffuse: format(bounce.diffuse), _specular: format(bounce.specular), _scatter: format(bounce.scatter), _energy: format(bounce.energy) },
    _env: { _mode: String(ENVIRONMENTS.indexOf(settings.environment)) },
    _inf: { _i: format(sun.intensity), _k: formatVec3(sun.color), _angle: `${format(sun.pitch)} ${format(sun.yaw)}`, _area: format(sun.area), _disk: flag(sun.disk) },
    _uni: { _i: format(sky.intensity), _k: formatVec3(sky.color) },
    _ibl: { _path: ibl.path, _i: format(ibl.intensity), _angle: `${format(ibl.pitch)} ${format(ibl.yaw)}` },
    _atm: {
      _ray_d: format(atmosphere.rayleigh),
      _ray_k: formatVec3(atmosphere.rayleighColor),
      _mie_d: format(atmosphere.mie),
      _mie_k: formatVec3(atmosphere.mieColor),
      _mie_g: format(atmosphere.miePhase),
      _o3_d: format(atmosphere.ozone),
      _o3_k: formatVec3(atmosphere.ozoneColor),
    },
    _fog_uni: { _d: format(fog.density), _k: formatVec3(fog.color), _g: format(fog.phase) },
    _lens: { _proj: String(PROJECTIONS.indexOf(lens.projection)), _fov: format(lens.fov), _aperture: format(lens.aperture), _blade_n: format(lens.blades), _blade_r: format(lens.bladeRotation) },
    _film: { _expo: format(film.exposure), _vig: format(film.vignette), _aces: flag(film.aces), _gam: format(film.gamma) },
    _bloom: { _mix: format(bloom.mix), _scale: format(bloom.scale), _aspect: format(bloom.aspect), _threshold: format(bloom.threshold) },
    _ground: { _color: formatVec3(ground.color), _hor: format(ground.horizon) },
    _bg: { _color: formatVec3(settings.background.color) },
    _edge: { _color: formatVec3(edge.color), _width: format(edge.width) },
    _grid: { _color: formatVec3(grid.color), _spacing: format(grid.spacing), _width: format(grid.width), _display: flag(grid.groundOnly) },
    _setting: { _ground: flag(show.ground), _grid: flag(show.grid), _edge: flag(show.edge), _bg_c: flag(show.backgroundColor), _bg_a: flag(show.transparent), _scale: formatVec3(show.scale), _cell: format(show.cell) },
  };
  const written = objects.map((attrs) => {
    const update = values[attrs.get('_type') ?? ''];
    if (!update) return new Map(attrs);
    const next = new Map(attrs);
    Object.entries(update).forEach(([key, value]) => next.set(key, value));
    if (attrs.get('_type') === '_ibl') next.delete('_rot');
    return next;
  });
  const present = new Set(objects.map((attrs) => attrs.get('_type')));
  DEFAULT_RENDER_OBJECTS.forEach((entries) => {
    const type = entries[0][1];
    if (!present.has(type)) written.push(new Map([['_type', type], ...Object.entries(values[type] ?? {})]));
  });
  return written;
}
