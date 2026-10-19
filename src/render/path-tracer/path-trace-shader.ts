import { BRICK } from './scene-volume.ts';

/**
 * One path-traced sample per pixel, averaged into the accumulation buffer (`u_previous` holds the mean
 * of the `u_sample` samples so far). The scene is one world-space grid of palette indices walked with a
 * two-level DDA: empty 8³ bricks are skipped whole. Light comes from the sun (sampled directly, with an
 * angular radius), the sky (uniform, a cheap atmosphere, or an equirectangular HDR image) and emissive
 * voxels; uniform fog scatters with a Henyey-Greenstein phase.
 *
 * Radiance convention: `u_sunRadiance` is the sun's irradiance over π, so a white diffuse face turned to
 * the sun reflects exactly that, and a uniform sky of radiance L lights an open face with L.
 * Alpha is the pixel's scene coverage: primary rays that escape write 0 when the background is a flat
 * colour or transparent, and the display pass composites.
 */
/**
 * \`guide\` builds the denoiser's variant instead: each sample writes the first hit's albedo and normal
 * (into a second target), averaged like the image, and traces nothing further.
 */
export const pathTraceFragment = (shape: number, guide = false) => `#version 300 es
precision highp float;
precision highp int;
precision highp usampler3D;

uniform usampler3D u_volume;
uniform usampler3D u_bricks;
/** Smooth shapes (marching cubes, clay): occupancy, plain or blurred, filtered trilinearly; the surface is at 0.5. */
uniform highp sampler3D u_density;
uniform sampler2D u_palette;
uniform sampler2D u_materials;
uniform sampler2D u_ibl;
uniform sampler2D u_previous;
uniform ivec3 u_size;
uniform vec3 u_origin;
uniform vec3 u_scale;
uniform bool u_hasVolume;

uniform vec2 u_resolution;
uniform float u_sample;
uniform float u_seed;
uniform vec3 u_eye;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_forward;
uniform float u_tanHalf;
uniform bool u_orthographic;
uniform float u_orthoHeight;
uniform int u_projection;
uniform float u_aperture;
uniform float u_focus;
uniform float u_blades;
uniform float u_bladeRotation;

uniform vec3 u_sunDirection;
uniform vec3 u_sunRadiance;
/* The emitter face picked for this sample (MagicaVoxel's \`area_*\`): corner and edges in world space, the cell it
   belongs to, its radiance, and the density of picking a point there, per unit of area. */
uniform bool u_hasArea;
uniform vec3 u_areaCorner;
uniform vec3 u_areaEdgeU;
uniform vec3 u_areaEdgeV;
uniform vec3 u_areaNormal;
uniform ivec3 u_areaCell;
uniform vec3 u_areaRadiance;
uniform float u_areaDensity;
/** Total power of every area-light face: a face's density is its brightest channel over this. */
uniform float u_emitterPower;
uniform float u_sunCos;
uniform bool u_sunDisk;
uniform int u_environment;
uniform vec3 u_sky;
uniform float u_iblIntensity;
/** The film gamma, which also linearizes the palette. */
uniform float u_gamma;
/** MagicaVoxel's \`pt_mis_ggx\` and \`pt_mis_cloud\`: weigh sun samples against reflection and phase samples. */
uniform bool u_misReflect;
uniform bool u_misScatter;
uniform mat3 u_iblRotation;
uniform bool u_hasIbl;
uniform vec3 u_rayleigh;
uniform vec3 u_mie;
uniform float u_miePhase;
uniform vec3 u_ozone;

uniform float u_fogDensity;
uniform vec3 u_fogColor;
uniform float u_fogPhase;

uniform bool u_ground;
uniform vec3 u_groundColor;
uniform float u_horizon;
uniform bool u_flatBackground;
uniform bool u_edges;
uniform vec3 u_edgeColor;
uniform float u_edgeWidth;
uniform bool u_grid;
uniform vec3 u_gridColor;
uniform float u_gridSpacing;
uniform float u_gridWidth;
uniform bool u_gridGroundOnly;

uniform int u_diffuseBounces;
uniform int u_specularBounces;
uniform int u_scatterBounces;
uniform float u_energy;
uniform bool u_shadows;
/** \`pt_tr\`: glass tints the sunlight through it instead of blocking it. */
uniform bool u_translucentShadows;
/** \`pt_b_aa\`: jitter each sample inside its pixel. */
uniform bool u_antialias;
/** \`pt_px\`: light each voxel face as a whole, from its centre, for a pixel-art look. */
uniform bool u_pixelated;
/* MagicaVoxel \`pt_prim\` (numbered as VOXEL_SHAPES; one program per shape keeps other shapes' work out of the
   DDA loop) and \`pt_cell\`, the share of its cell a voxel fills. */
const int SHAPE = ${shape};
const bool GUIDE = ${guide};
uniform float u_cell;

layout(location = 0) out vec4 o_color;
${guide ? 'layout(location = 1) out vec4 o_normal;\nuniform sampler2D u_previousNormal;' : ''}

const float PI = 3.14159265359;
const int BRICK = ${BRICK};
const int MAX_STEPS = 1024;
const int MAX_DEPTH = 40;

uint g_state;
float random() {
  g_state = g_state * 747796405u + 2891336453u;
  uint word = ((g_state >> ((g_state >> 28u) + 4u)) ^ g_state) * 277803737u;
  return float((word >> 22u) ^ word) / 4294967295.0;
}

/** An orthonormal frame around a unit axis, for sampling directions around it. */
mat3 frameAround(vec3 axis) {
  vec3 tangent = normalize(abs(axis.z) < 0.999 ? cross(axis, vec3(0.0, 0.0, 1.0)) : cross(axis, vec3(1.0, 0.0, 0.0)));
  return mat3(tangent, cross(axis, tangent), axis);
}

/** A direction at cosine \`cosTheta\` from the axis, uniformly around it. */
vec3 around(vec3 axis, float cosTheta) {
  float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  float phi = 2.0 * PI * random();
  return normalize(frameAround(axis) * vec3(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta));
}

vec3 cosineHemisphere(vec3 normal) {
  return around(normal, sqrt(random()));
}

vec3 uniformSphere() {
  return around(vec3(0.0, 0.0, 1.0), 2.0 * random() - 1.0);
}

/** A direction inside the cone of half-angle acos(cosMax) around axis. */
vec3 cone(vec3 axis, float cosMax) {
  return around(axis, mix(1.0, cosMax, random()));
}

float phaseHG(float cosTheta, float g) {
  float denominator = 1.0 + g * g - 2.0 * g * cosTheta;
  return (1.0 - g * g) / (4.0 * PI * denominator * sqrt(denominator));
}

/** Henyey-Greenstein sample around the travel direction. */
vec3 henyeyGreenstein(vec3 direction, float g) {
  if (abs(g) < 0.001) return uniformSphere();
  float square = (1.0 - g * g) / (1.0 - g + 2.0 * g * random());
  return around(direction, clamp((1.0 + g * g - square * square) / (2.0 * g), -1.0, 1.0));
}

uint voxelAt(ivec3 cell) {
  return texelFetch(u_volume, cell, 0).r;
}

bool solid(ivec3 cell) {
  return all(greaterThanEqual(cell, ivec3(0))) && all(lessThan(cell, u_size)) && voxelAt(cell) != 0u;
}

bool brickFilled(ivec3 cell) {
  return texelFetch(u_bricks, cell / BRICK, 0).r != 0u;
}

struct Hit { float t; vec3 normal; uint color; ivec3 cell; };

const int SMOOTH_SAMPLES = 3;
const int SMOOTH_REFINES = 6;

float densityAt(vec3 point) {
  return texture(u_density, point / vec3(u_size)).r;
}

/** The first t in [from, to] where the density rises to 0.5, refined by bisection; -1 when it stays below. */
float smoothCrossing(vec3 origin, vec3 direction, float from, float to) {
  if (densityAt(origin + direction * from) >= 0.5) return from;
  float previous = from;
  for (int step = 1; step <= SMOOTH_SAMPLES; step++) {
    float t = mix(from, to, float(step) / float(SMOOTH_SAMPLES));
    if (densityAt(origin + direction * t) >= 0.5) {
      float low = previous;
      float high = t;
      for (int refine = 0; refine < SMOOTH_REFINES; refine++) {
        float middle = 0.5 * (low + high);
        if (densityAt(origin + direction * middle) >= 0.5) high = middle;
        else low = middle;
      }
      return high;
    }
    previous = t;
  }
  return -1.0;
}

/** A smooth-surface hit: the normal from the density gradient, the colour of the voxel it wraps. */
Hit smoothHit(vec3 point, float t) {
  const float e = 0.25;
  vec3 gradient = vec3(
    densityAt(point + vec3(e, 0.0, 0.0)) - densityAt(point - vec3(e, 0.0, 0.0)),
    densityAt(point + vec3(0.0, e, 0.0)) - densityAt(point - vec3(0.0, e, 0.0)),
    densityAt(point + vec3(0.0, 0.0, e)) - densityAt(point - vec3(0.0, 0.0, e)));
  Hit hit;
  hit.t = t;
  hit.normal = dot(gradient, gradient) > 0.0 ? -normalize(gradient) : vec3(0.0, 0.0, 1.0);
  hit.cell = ivec3(floor(point));
  for (int attempt = 0; attempt < 3 && !solid(hit.cell); attempt++) hit.cell = ivec3(floor(point - hit.normal * (0.5 + 0.5 * float(attempt))));
  hit.color = solid(hit.cell) ? voxelAt(hit.cell) : 0u;
  return hit;
}

/** Ray against the box [low, high]: entry t (or -1) and the face it enters through. */
float boxHit(vec3 origin, vec3 inverse, vec3 low, vec3 high, out vec3 normal) {
  vec3 t0 = (low - origin) * inverse;
  vec3 t1 = (high - origin) * inverse;
  vec3 tMin = min(t0, t1);
  vec3 tMax = max(t0, t1);
  float enter = max(max(tMin.x, tMin.y), tMin.z);
  float exit = min(min(tMax.x, tMax.y), tMax.z);
  normal = -sign(inverse) * vec3(equal(tMin, vec3(enter)));
  return enter <= exit && enter >= 0.0 ? enter : -1.0;
}

float sphereHit(vec3 origin, vec3 direction, vec3 center, float radius, out vec3 normal) {
  vec3 offset = origin - center;
  float a = dot(direction, direction);
  float b = dot(offset, direction);
  float discriminant = b * b - a * (dot(offset, offset) - radius * radius);
  if (discriminant < 0.0) return -1.0;
  float t = (-b - sqrt(discriminant)) / a;
  normal = normalize(offset + direction * t);
  return t >= 0.0 ? t : -1.0;
}

/** A vertical cylinder from \`low\` to \`high\` in z, side and caps. */
float cylinderHit(vec3 origin, vec3 direction, vec3 center, float radius, float low, float high, out vec3 normal) {
  float best = -1.0;
  vec2 offset = origin.xy - center.xy;
  float a = dot(direction.xy, direction.xy);
  float b = dot(offset, direction.xy);
  float discriminant = b * b - a * (dot(offset, offset) - radius * radius);
  if (a > 0.0 && discriminant >= 0.0) {
    float t = (-b - sqrt(discriminant)) / a;
    float z = origin.z + direction.z * t;
    if (t >= 0.0 && z >= low && z <= high) {
      best = t;
      normal = vec3(normalize(offset + direction.xy * t), 0.0);
    }
  }
  float capZ = direction.z < 0.0 ? high : low;
  float t = (capZ - origin.z) / direction.z;
  vec2 across = offset + direction.xy * t;
  if (t >= 0.0 && dot(across, across) <= radius * radius && (best < 0.0 || t < best)) {
    best = t;
    normal = vec3(0.0, 0.0, -sign(direction.z));
  }
  return best;
}

/** The voxel's shape inside its cell: a box of side \`u_cell\`, a sphere, a cylinder, or a brick with a stud. */
float primitiveHit(vec3 origin, vec3 direction, vec3 inverse, ivec3 cell, out vec3 normal) {
  vec3 center = vec3(cell) + 0.5;
  float extent = 0.5 * u_cell;
  if (SHAPE == 4) return sphereHit(origin, direction, center, extent, normal);
  if (SHAPE == 5) return cylinderHit(origin, direction, center, extent, center.z - extent, center.z + extent, normal);
  if (SHAPE == 1) {
    float stud = solid(cell + ivec3(0, 0, 1)) ? 0.0 : 0.2 * u_cell;
    vec3 studNormal;
    float body = boxHit(origin, inverse, center - extent, center + vec3(extent, extent, extent - stud), normal);
    float top = stud > 0.0 ? cylinderHit(origin, direction, center, 0.3 * u_cell, center.z + extent - stud, center.z + extent, studNormal) : -1.0;
    if (top >= 0.0 && (body < 0.0 || top < body)) {
      normal = studNormal;
      return top;
    }
    return body;
  }
  return boxHit(origin, inverse, center - extent, center + extent, normal);
}

/** The nearest voxel along the ray in volume coordinates (cells of size 1), or t < 0. */
Hit traceVolume(vec3 origin, vec3 direction) {
  Hit hit;
  hit.t = -1.0;
  if (!u_hasVolume) return hit;
  direction = mix(direction, vec3(1e-9), equal(direction, vec3(0.0)));
  vec3 inverse = 1.0 / direction;
  vec3 t0 = -origin * inverse;
  vec3 t1 = (vec3(u_size) - origin) * inverse;
  vec3 tNear = min(t0, t1);
  vec3 tFar = max(t0, t1);
  float tEnter = max(max(tNear.x, tNear.y), max(tNear.z, 0.0));
  float tExit = min(tFar.x, min(tFar.y, tFar.z));
  if (tEnter >= tExit) return hit;

  bool fullCubes = SHAPE == 0 && u_cell >= 1.0;
  bool smoothShape = SHAPE == 2 || SHAPE == 3;
  ivec3 stepDirection = ivec3(sign(direction));
  vec3 tDelta = abs(inverse);
  float t = tEnter;
  vec3 normal = -vec3(stepDirection) * vec3(equal(tNear, vec3(tEnter)));
  /* Cells advance in integers: recomputing them from far ray positions would lose the boundary to rounding. */
  ivec3 cell = clamp(ivec3(floor(origin + direction * tEnter)), ivec3(0), u_size - 1);
  for (int steps = 0; steps < MAX_STEPS; steps++) {
    ivec3 brickLow = (cell / BRICK) * BRICK;
    ivec3 brickHigh = min(brickLow + BRICK, u_size);
    if (!brickFilled(cell)) {
      vec3 exits = max((vec3(brickLow) - origin) * inverse, (vec3(brickHigh) - origin) * inverse);
      t = min(exits.x, min(exits.y, exits.z));
      if (t >= tExit) break;
      cell = clamp(ivec3(floor(origin + direction * t)), brickLow, brickHigh - 1);
      if (exits.x == t) { cell.x = stepDirection.x > 0 ? brickHigh.x : brickLow.x - 1; normal = vec3(-float(stepDirection.x), 0.0, 0.0); }
      else if (exits.y == t) { cell.y = stepDirection.y > 0 ? brickHigh.y : brickLow.y - 1; normal = vec3(0.0, -float(stepDirection.y), 0.0); }
      else { cell.z = stepDirection.z > 0 ? brickHigh.z : brickLow.z - 1; normal = vec3(0.0, 0.0, -float(stepDirection.z)); }
    } else {
      vec3 next = (vec3(cell) + max(vec3(stepDirection), vec3(0.0)) - origin) * inverse;
      for (int inner = 0; inner < BRICK * 3; inner++) {
        if (smoothShape) {
          float crossing = smoothCrossing(origin, direction, t, min(min(next.x, min(next.y, next.z)), tExit));
          if (crossing >= 0.0) {
            Hit surface = smoothHit(origin + direction * crossing, crossing);
            if (surface.color != 0u) return surface;
          }
        }
        uint color = smoothShape ? 0u : voxelAt(cell);
        vec3 shapeNormal = normal;
        float shapeT = color == 0u || fullCubes ? t : primitiveHit(origin, direction, inverse, cell, shapeNormal);
        if (color != 0u && shapeT >= 0.0) {
          hit.t = shapeT;
          hit.normal = shapeNormal;
          hit.color = color;
          hit.cell = cell;
          return hit;
        }
        if (next.x < next.y && next.x < next.z) { t = next.x; next.x += tDelta.x; cell.x += stepDirection.x; normal = vec3(-float(stepDirection.x), 0.0, 0.0); }
        else if (next.y < next.z) { t = next.y; next.y += tDelta.y; cell.y += stepDirection.y; normal = vec3(0.0, -float(stepDirection.y), 0.0); }
        else { t = next.z; next.z += tDelta.z; cell.z += stepDirection.z; normal = vec3(0.0, 0.0, -float(stepDirection.z)); }
        if (any(lessThan(cell, brickLow)) || any(greaterThanEqual(cell, brickHigh))) break;
      }
    }
    if (t >= tExit || any(lessThan(cell, ivec3(0))) || any(greaterThanEqual(cell, u_size))) break;
  }
  return hit;
}

vec3 iblSample(vec3 direction) {
  vec3 d = u_iblRotation * direction;
  vec2 uv = vec2(atan(d.y, d.x) / (2.0 * PI) + 0.5, acos(clamp(d.z, -1.0, 1.0)) / PI);
  return texture(u_ibl, uv).rgb * u_iblIntensity;
}

/** Air between the eye and the edge of the atmosphere, in atmospheres: 1 straight up, growing toward the horizon. */
float airMass(vec3 direction) {
  return 1.0 / (max(direction.z, 0.0) + 0.1);
}

/** Atmosphere extinction per air mass, as MagicaVoxel's \`k_ext\`: Rayleigh scatters, Mie also absorbs a tenth, ozone only absorbs. */
vec3 extinction() {
  return u_rayleigh + u_mie * 1.1 + u_ozone;
}

/** The sun's light after crossing \`depth\` of the air toward it: redder and dimmer as it sets. */
vec3 sunlightAt(float depth) {
  return u_environment == 1 ? u_sunRadiance * exp(-extinction() * airMass(u_sunDirection) * depth) : u_sunRadiance;
}

vec3 sunlight() {
  return sunlightAt(0.5);
}

// ponytail: single scattering in a uniform-density sky with MagicaVoxel's coefficients; its planet model is in the encoded shader.
/** Rayleigh blue overhead, a white Mie glow around the sun, both washing out toward the horizon. */
vec3 atmosphere(vec3 direction) {
  float cosSun = dot(direction, u_sunDirection);
  vec3 total = extinction();
  vec3 scattered = u_rayleigh * 3.0 / (16.0 * PI) * (1.0 + cosSun * cosSun) + u_mie * phaseHG(cosSun, u_miePhase);
  /* Air seen higher up is lit by sunlight that crossed less of the atmosphere: blue zenith over an orange sunset. */
  vec3 light = sunlightAt(0.5 * (1.0 - 0.8 * max(direction.z, 0.0)));
  return light * PI * scattered / max(total, vec3(1e-4)) * (1.0 - exp(-total * airMass(direction)));
}

vec3 sky(vec3 direction) {
  if (u_environment == 2 && u_hasIbl) return iblSample(direction);
  if (u_environment == 1) return atmosphere(direction);
  return u_sky;
}

/** The sun's solid angle; its radiance is its irradiance spread over it. */
float sunSolidAngle() {
  return 2.0 * PI * (1.0 - u_sunCos);
}

/**
 * What a ray leaving the scene sees. \`sunWeight\` is how much of the sun it may add: 0 where the sun was
 * sampled directly, a MIS weight after a glossy reflection, 1 after a mirror, the disk's visibility first.
 */
vec3 escape(vec3 direction, float sunWeight) {
  vec3 color = sky(direction);
  if (sunWeight > 0.0 && dot(direction, u_sunDirection) > u_sunCos) color += sunWeight * sunlight() * PI / max(sunSolidAngle(), 1e-6);
  return color;
}

/** The power heuristic's weight for a sample from the strategy with density \`chosen\` against \`other\`. */
float powerHeuristic(float chosen, float other) {
  /* As a ratio, so a point sun's huge density neither overflows nor turns the weight into NaN. */
  float ratio = min(other / max(chosen, 1e-30), 1e15);
  return 1.0 / (1.0 + ratio * ratio);
}

struct Surface { bool hit; float t; vec3 position; vec3 normal; uint color; ivec3 cell; bool ground; };

/** The nearest surface along a world-space ray: a voxel or the ground plane at z = 0. */
Surface traceScene(vec3 origin, vec3 direction) {
  Surface surface;
  surface.hit = false;
  surface.t = 1e30;
  surface.ground = false;
  Hit voxel = traceVolume((origin - u_origin) / u_scale, direction / u_scale);
  if (voxel.t >= 0.0) {
    surface.hit = true;
    surface.t = voxel.t;
    /* A ray starting inside a voxel (in a cloud, after scattering) has no entry face. */
    surface.normal = dot(voxel.normal, voxel.normal) > 0.0 ? normalize(voxel.normal / u_scale) : vec3(0.0);
    surface.color = voxel.color;
    surface.cell = voxel.cell;
  }
  /* A ray nudged just under the ground (leaving a voxel through its bottom face) is on it. */
  if (u_ground && (direction.z < 0.0 || origin.z < 0.0)) {
    float tGround = origin.z < 0.0 ? 0.0 : -origin.z / direction.z;
    if ((tGround > 1e-4 || origin.z < 0.0) && tGround < surface.t) {
      surface.hit = true;
      surface.t = tGround;
      surface.normal = vec3(0.0, 0.0, 1.0);
      surface.ground = true;
    }
  }
  surface.position = origin + direction * surface.t;
  if (surface.ground) surface.position.z = 0.0;
  return surface;
}

const int MAX_SHADOW_LAYERS = 8;
const int MAX_MEDIUM_STEPS = 256;
const int EMIT_KIND = 3;
const int MEDIA_KIND = 5;
const int MEDIA_ABSORB = 0;
const int MEDIA_EMIT = 2;

int kindOf(uint color) {
  return int(texelFetch(u_materials, ivec2(int(color), 0), 0).x + 0.5);
}

/** World distance from \`position\`, in media voxel \`cell\`, to where the ray leaves the run of media voxels. */
float mediumLength(vec3 position, vec3 direction, ivec3 cell) {
  vec3 origin = (position - u_origin) / u_scale;
  vec3 local = mix(direction / u_scale, vec3(1e-9), equal(direction, vec3(0.0)));
  vec3 inverse = 1.0 / local;
  ivec3 stepDirection = ivec3(sign(local));
  vec3 tDelta = abs(inverse);
  vec3 next = (vec3(cell) + max(vec3(stepDirection), vec3(0.0)) - origin) * inverse;
  float t = 0.0;
  for (int steps = 0; steps < MAX_MEDIUM_STEPS; steps++) {
    if (!solid(cell) || kindOf(voxelAt(cell)) != MEDIA_KIND) return t;
    t = min(next.x, min(next.y, next.z));
    if (next.x <= next.y && next.x <= next.z) { next.x += tDelta.x; cell.x += stepDirection.x; }
    else if (next.y <= next.z) { next.y += tDelta.y; cell.y += stepDirection.y; }
    else { next.z += tDelta.z; cell.z += stepDirection.z; }
  }
  return t;
}

// ponytail: \`_d\` read as extinction per voxel; MagicaVoxel's media density scale is unconfirmed.
/** A medium's extinction per world unit. */
float mediumDensity(vec4 extra) {
  return max(extra.z, 0.0) * 3.0 / (u_scale.x + u_scale.y + u_scale.z);
}

/**
 * How much light gets from \`origin\` along \`direction\` within \`reach\`: none past opaque voxels, tinted
 * through glass and media. Reaching the emitting \`target\` cell first counts as getting through.
 */
vec3 lightThrough(vec3 origin, vec3 direction, float reach, ivec3 target) {
  if (!u_shadows) return vec3(1.0);
  vec3 transmittance = vec3(1.0);
  for (int layer = 0; layer < MAX_SHADOW_LAYERS; layer++) {
    Surface surface = traceScene(origin, direction);
    if (!surface.hit || surface.t >= reach) return transmittance;
    if (surface.ground) return vec3(0.0);
    if (surface.cell == target) return transmittance;
    vec4 shape = texelFetch(u_materials, ivec2(int(surface.color), 0), 0);
    int kind = int(shape.x + 0.5);
    if (kind == MEDIA_KIND) {
      vec4 extra = texelFetch(u_materials, ivec2(int(surface.color), 1), 0);
      vec3 albedo = pow(texelFetch(u_palette, ivec2(int(surface.color), 0), 0).rgb, vec3(u_gamma));
      float span = mediumLength(surface.position, direction, surface.cell);
      transmittance *= exp(-mediumDensity(extra) * span * (int(shape.y + 0.5) == MEDIA_ABSORB ? 1.0 - albedo : vec3(1.0)));
      origin = surface.position + direction * (span + 2e-3);
      reach -= surface.t + span + 2e-3;
      continue;
    }
    if (!u_translucentShadows) return vec3(0.0);
    float transparency = kind == 2 || kind == 4 ? texelFetch(u_materials, ivec2(int(surface.color), 1), 0).x : 0.0;
    if (transparency <= 0.0) return vec3(0.0);
    transmittance *= transparency * pow(texelFetch(u_palette, ivec2(int(surface.color), 0), 0).rgb, vec3(u_gamma));
    float nudge = 2e-3 * max(max(u_scale.x, u_scale.y), max(u_scale.z, 1.0));
    origin = surface.position + direction * nudge;
    reach -= surface.t + nudge;
  }
  return vec3(0.0);
}

vec3 sunlightThrough(vec3 origin, vec3 direction) {
  return lightThrough(origin, direction, 1e30, ivec3(-1));
}

/** Distance (in voxels) from a point on a voxel face to the nearest border of that face lying on a geometric edge. */
float edgeDistance(ivec3 cell, vec3 normal, vec3 local) {
  ivec3 outward = ivec3(normal);
  ivec3 uAxis = abs(normal.x) > 0.5 ? ivec3(0, 1, 0) : ivec3(1, 0, 0);
  ivec3 vAxis = abs(normal.z) > 0.5 ? ivec3(0, 1, 0) : ivec3(0, 0, 1);
  vec3 inside = clamp(local - vec3(cell), 0.0, 1.0);
  vec2 uv = vec2(dot(inside, vec3(uAxis)), dot(inside, vec3(vAxis)));
  float nearest = 1e9;
  for (int side = 0; side < 4; side++) {
    ivec3 axis = side < 2 ? uAxis : vAxis;
    bool positive = (side & 1) == 1;
    ivec3 beside = cell + (positive ? axis : -axis);
    float coordinate = side < 2 ? uv.x : uv.y;
    if (!solid(beside) || solid(beside + outward)) nearest = min(nearest, positive ? 1.0 - coordinate : coordinate);
  }
  return nearest;
}

/** 1 within half a line width of a grid line on the plane spanned by two world coordinates. */
float gridLine(vec2 coordinates, float spacing, float width) {
  vec2 offset = abs(coordinates / spacing - round(coordinates / spacing)) * spacing;
  return step(min(offset.x, offset.y), width * 0.5);
}

/* GGX microfacets (Walter et al. 2007) for metal and blend reflections. */

float ggxDistribution(float nh, float alpha) {
  float a2 = alpha * alpha;
  float denominator = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * denominator * denominator);
}

/** Density over directions of a reflection sampled by its GGX half vector. */
float ggxDensity(vec3 normal, vec3 view, vec3 halfway, float alpha) {
  return ggxDistribution(max(dot(normal, halfway), 0.0), alpha) * max(dot(normal, halfway), 0.0) / max(4.0 * dot(view, halfway), 1e-6);
}

/** Density of a direction sampled uniformly over the sun's disk (a point sun is sampled exactly). */
float sunDensity() {
  return u_sunCos < 1.0 ? 1.0 / sunSolidAngle() : 1e30;
}

/** cos θ of a half vector drawn from the GGX distribution. */
float ggxCosTheta(float alpha) {
  float u = random();
  return sqrt((1.0 - u) / (1.0 + (alpha * alpha - 1.0) * u));
}

float smithG1(float cosine, float alpha) {
  float a2 = alpha * alpha;
  return 2.0 * cosine / (cosine + sqrt(a2 + (1.0 - a2) * cosine * cosine));
}

vec3 schlick(vec3 reflectance, float cosine) {
  return reflectance + (1.0 - reflectance) * pow(1.0 - cosine, 5.0);
}

/** Throughput of a reflection sampled by its half vector: F · G · (v·h) / ((n·v)(n·h)). */
vec3 ggxWeight(vec3 normal, vec3 view, vec3 light, vec3 halfway, float alpha, vec3 reflectance) {
  float nv = max(dot(normal, view), 1e-4);
  float nl = max(dot(normal, light), 1e-4);
  float nh = max(dot(normal, halfway), 1e-4);
  float vh = max(dot(view, halfway), 0.0);
  return schlick(reflectance, vh) * smithG1(nv, alpha) * smithG1(nl, alpha) * vh / (nv * nh);
}

/** Without MIS, lobes this narrow see the sun only by reflecting it, wider ones only by sampling it. */
bool mirrorLike(float alpha) {
  return alpha < 0.05;
}

/** Sunlight reflected toward \`view\` by a GGX lobe, sampled over the sun's disk and MIS-weighted. */
vec3 ggxSunlight(vec3 normal, vec3 view, float alpha, vec3 reflectance, vec3 origin) {
  vec3 light = cone(u_sunDirection, u_sunCos);
  float nl = dot(normal, light);
  float nv = dot(normal, view);
  if (nl <= 0.0 || nv <= 0.0) return vec3(0.0);
  vec3 halfway = normalize(view + light);
  vec3 brdf = schlick(reflectance, max(dot(view, halfway), 0.0)) * ggxDistribution(max(dot(normal, halfway), 0.0), alpha) * smithG1(nv, alpha) * smithG1(nl, alpha) / (4.0 * nv * nl);
  float weight = u_misReflect ? powerHeuristic(sunDensity(), ggxDensity(normal, view, halfway, alpha)) : float(!mirrorLike(alpha));
  return weight * brdf * nl * PI * sunlight() * sunlightThrough(origin, light);
}

/** How much of the sun a reflected ray may add when it escapes; the counterpart of \`ggxSunlight\`'s weight. */
float reflectedSunWeight(vec3 normal, vec3 view, vec3 halfway, float alpha) {
  return u_misReflect ? powerHeuristic(ggxDensity(normal, view, halfway, alpha), sunDensity()) : float(mirrorLike(alpha));
}

/** Sunlight a phase lobe at \`origin\` scatters back along \`direction\`, sampled over the sun's disk. */
vec3 phaseSunlight(vec3 origin, vec3 direction, float g) {
  vec3 light = cone(u_sunDirection, u_sunCos);
  float phase = phaseHG(dot(direction, light), g);
  float weight = u_misScatter ? powerHeuristic(sunDensity(), phase) : 1.0;
  return weight * phase * PI * sunlight() * sunlightThrough(origin, light);
}

/** Without \`u_misScatter\` the sun is only sampled directly; with it, a phase sample may hit it too. */
float scatteredSunWeight(vec3 direction, vec3 next, float g) {
  return u_misScatter ? powerHeuristic(phaseHG(dot(direction, next), g), sunDensity()) : 0.0;
}

/** Light a diffuse surface at \`origin\` gets from a point on this sample's emitter face, MIS-weighted against its cosine bounce. */
vec3 areaLight(vec3 origin, vec3 normal) {
  vec3 toLight = u_areaCorner + u_areaEdgeU * random() + u_areaEdgeV * random() - origin;
  float distanceSquared = dot(toLight, toLight);
  float distance = sqrt(distanceSquared);
  vec3 direction = toLight / distance;
  float cosSurface = dot(normal, direction);
  float cosLight = -dot(u_areaNormal, direction);
  if (cosSurface <= 0.0 || cosLight <= 0.0) return vec3(0.0);
  float lightDensity = u_areaDensity * distanceSquared / cosLight;
  float weight = powerHeuristic(lightDensity, cosSurface / PI);
  return weight * u_areaRadiance * cosSurface / (PI * lightDensity) * lightThrough(origin, direction, distance + 1e-3, u_areaCell);
}

/**
 * How bright an \`_emit\` voxel is along a ray: as it looks (\`_ldr\`) until the path bounces off something
 * diffuse or scatters, as it lights after. Hit right after a diffuse bounce (\`bounceDensity\`), an area light
 * is weighed against \`areaLight\`, which may have sampled it too.
 */
float emitterBrightness(vec4 shape, vec4 extra, Surface surface, vec3 direction, bool seen, float bounceDensity) {
  if (seen) return shape.y;
  if (bounceDensity <= 0.0 || shape.z < 0.5 || u_emitterPower <= 0.0) return extra.y;
  vec3 radiance = pow(texelFetch(u_palette, ivec2(int(surface.color), 0), 0).rgb, vec3(u_gamma)) * extra.y;
  float cosLight = max(abs(dot(direction, surface.normal)), 1e-4);
  float lightDensity = max(radiance.r, max(radiance.g, radiance.b)) / u_emitterPower * surface.t * surface.t / cosLight;
  return extra.y * powerHeuristic(bounceDensity, lightDensity);
}

/** The ray through pixel coordinates for the chosen projection, with depth of field. */
void cameraRay(vec2 pixel, out vec3 origin, out vec3 direction) {
  vec2 ndc = (pixel / u_resolution) * 2.0 - 1.0;
  float aspect = u_resolution.x / u_resolution.y;
  if (u_orthographic) {
    origin = u_eye + u_right * ndc.x * u_orthoHeight * aspect + u_up * ndc.y * u_orthoHeight;
    direction = u_forward;
    return;
  }
  origin = u_eye;
  if (u_projection == 2) {
    float theta = ndc.x * PI;
    float phi = ndc.y * PI * 0.5;
    direction = normalize(u_forward * cos(phi) * cos(theta) + u_right * cos(phi) * sin(theta) + u_up * sin(phi));
    return;
  }
  vec2 plane = vec2(ndc.x * aspect, ndc.y);
  if (u_projection == 1) {
    /* Stereographic: r = 2 tan(θ / 2), scaled so the frame's top edge sits at half the FOV. */
    float radius = length(plane) * 2.0 * tan(atan(u_tanHalf) * 0.5);
    float angle = 2.0 * atan(radius * 0.5);
    vec2 toward = radius > 0.0 ? normalize(plane) : vec2(0.0);
    direction = normalize(u_forward * cos(angle) + (u_right * toward.x + u_up * toward.y) * sin(angle));
  } else {
    direction = normalize(u_forward + (u_right * plane.x + u_up * plane.y) * u_tanHalf);
  }
  if (u_aperture <= 0.0 || u_focus <= 0.0) return;
  vec2 lens;
  if (u_blades >= 3.0) {
    float sector = floor(random() * u_blades);
    float from = sector / u_blades * 2.0 * PI + u_bladeRotation;
    float to = (sector + 1.0) / u_blades * 2.0 * PI + u_bladeRotation;
    float a = random();
    float b = random();
    if (a + b > 1.0) { a = 1.0 - a; b = 1.0 - b; }
    lens = vec2(cos(from), sin(from)) * a + vec2(cos(to), sin(to)) * b;
  } else {
    float phi = 2.0 * PI * random();
    lens = vec2(cos(phi), sin(phi)) * sqrt(random());
  }
  vec3 focusPoint = origin + direction * (u_focus / dot(direction, u_forward));
  origin += (u_right * lens.x + u_up * lens.y) * u_aperture;
  direction = normalize(focusPoint - origin);
}

${guide ? `/** The denoiser's guides: the first hit's albedo and normal, averaged over the samples so far. */
void accumulateGuide(vec3 albedo, vec3 normal) {
  float weight = 1.0 / (u_sample + 1.0);
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  o_color = u_sample < 0.5 ? vec4(albedo, 1.0) : mix(texelFetch(u_previous, pixel, 0), vec4(albedo, 1.0), weight);
  o_normal = u_sample < 0.5 ? vec4(normal, 1.0) : mix(texelFetch(u_previousNormal, pixel, 0), vec4(normal, 1.0), weight);
}
` : 'void accumulateGuide(vec3 albedo, vec3 normal) {}'}
void main() {
  g_state = (uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(u_sample) * 26699u + uint(u_seed)) | 1u;
  random();
  vec3 origin;
  vec3 direction;
  vec2 jitter = vec2(random(), random());
  cameraRay(gl_FragCoord.xy - 0.5 + (u_antialias ? jitter : vec2(0.5)), origin, direction);

  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  float coverage = 1.0;
  float sunWeight = u_sunDisk ? 1.0 : 0.0;
  int diffuse = 0;
  int specular = 0;
  int scatter = 0;
  /** The cosine density of the last bounce while the path has met nothing but empty space and media since; else 0. */
  float bounceDensity = 0.0;
  for (int depth = 0; depth < MAX_DEPTH; depth++) {
    Surface surface = traceScene(origin, direction);
    if (!GUIDE && u_fogDensity > 0.0 && scatter < u_scatterBounces) {
      float fogDistance = -log(max(random(), 1e-7)) / u_fogDensity;
      if (fogDistance < surface.t) {
        scatter++;
        origin += direction * fogDistance;
        throughput *= u_fogColor;
        radiance += throughput * phaseSunlight(origin, direction, u_fogPhase);
        bounceDensity = 0.0;
        vec3 next = henyeyGreenstein(direction, u_fogPhase);
        sunWeight = scatteredSunWeight(direction, next, u_fogPhase);
        direction = next;
        continue;
      }
    }
    if (GUIDE && !surface.hit) {
      accumulateGuide(vec3(0.0), vec3(0.0));
      return;
    }
    if (!surface.hit) {
      if (depth == 0 && u_flatBackground) coverage = 0.0;
      else radiance += throughput * escape(direction, sunWeight);
      break;
    }

    /* MagicaVoxel's horizon: the ground fades into the sky (or the flat background) with distance. */
    if (surface.ground && u_horizon > 0.0) {
      float fade = 1.0 - exp(-u_horizon * surface.t);
      if (depth == 0 && u_flatBackground) coverage = 1.0 - fade;
      else {
        radiance += throughput * fade * escape(direction, sunWeight);
        throughput *= 1.0 - fade;
      }
    }

    vec3 normal = surface.normal;
    vec3 albedo = u_groundColor;
    vec4 shape = vec4(0.0, 1.0, 0.0, 1.5);
    vec4 extra = vec4(0.0);
    if (!surface.ground) {
      albedo = pow(texelFetch(u_palette, ivec2(int(surface.color), 0), 0).rgb, vec3(u_gamma));
      shape = texelFetch(u_materials, ivec2(int(surface.color), 0), 0);
      extra = texelFetch(u_materials, ivec2(int(surface.color), 1), 0);
    }
    vec3 world = surface.position / u_scale;
    bool fullCubes = SHAPE == 0 && u_cell >= 1.0;
    if (u_edges && fullCubes && !surface.ground && edgeDistance(surface.cell, normal, (surface.position - u_origin) / u_scale) < u_edgeWidth * 0.5) albedo = u_edgeColor;
    if (u_grid && (surface.ground || !u_gridGroundOnly)) {
      vec2 plane = abs(normal.x) > 0.5 ? world.yz : abs(normal.y) > 0.5 ? world.xz : world.xy;
      albedo = mix(albedo, u_gridColor, gridLine(plane, max(u_gridSpacing, 1.0), u_gridWidth));
    }

    if (GUIDE) {
      accumulateGuide(albedo, normal);
      return;
    }
    int kind = int(shape.x + 0.5);
    float roughness = clamp(shape.y, 0.0, 1.0);
    float metalness = clamp(shape.z, 0.0, 1.0);
    float ior = max(shape.w, 1.0);
    float transparency = clamp(extra.x, 0.0, 1.0);
    if (kind == EMIT_KIND) radiance += throughput * albedo * emitterBrightness(shape, extra, surface, direction, diffuse == 0 && scatter == 0, bounceDensity);
    else if (kind != MEDIA_KIND) radiance += throughput * albedo * extra.y;

    /* Smooth surfaces sit on 8-bit density, so rays leave them with a wider gap. */
    float bias = (SHAPE == 2 || SHAPE == 3 ? 0.05 : 1e-3) * max(max(u_scale.x, u_scale.y), max(u_scale.z, 1.0));
    bool entering = dot(direction, normal) < 0.0;
    vec3 facing = entering ? normal : -normal;
    /* Media (clouds, smoke): absorbing ones tint by Beer–Lambert, emitting ones glow, scattering ones sample a
       free-flight distance and scatter with their own phase. */
    if (kind == MEDIA_KIND) {
      int mediaType = int(shape.y + 0.5);
      float density = mediumDensity(extra);
      float span = mediumLength(surface.position, direction, surface.cell);
      vec3 beyond = surface.position + direction * (span + bias * 2.0);
      if (mediaType == MEDIA_ABSORB || mediaType == MEDIA_EMIT) {
        float absorbed = 1.0 - exp(-density * span);
        if (mediaType == MEDIA_EMIT) radiance += throughput * albedo * max(extra.y, 1.0) * absorbed;
        throughput *= mediaType == MEDIA_EMIT ? vec3(1.0 - absorbed) : exp(-density * span * (1.0 - albedo));
        origin = beyond;
        continue;
      }
      float flight = -log(max(random(), 1e-7)) / max(density, 1e-6);
      if (flight >= span || scatter >= u_scatterBounces) {
        if (flight < span) throughput *= exp(-density * span);
        origin = beyond;
        continue;
      }
      scatter++;
      origin = surface.position + direction * flight;
      throughput *= albedo;
      radiance += throughput * phaseSunlight(origin, direction, shape.z);
      bounceDensity = 0.0;
      vec3 next = henyeyGreenstein(direction, shape.z);
      sunWeight = scatteredSunWeight(direction, next, shape.z);
      direction = next;
      continue;
    }
    if ((kind == 2 || kind == 4) && random() < transparency) {
      if (specular >= u_specularBounces) break;
      specular++;
      float eta = entering ? 1.0 / ior : ior;
      float cosIncident = -dot(direction, facing);
      float r0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
      float fresnel = r0 + (1.0 - r0) * pow(1.0 - cosIncident, 5.0);
      vec3 refracted = refract(direction, facing, eta);
      vec3 next = (random() < fresnel || dot(refracted, refracted) == 0.0) ? reflect(direction, facing) : refracted;
      if (roughness > 0.0) next = normalize(mix(next, cosineHemisphere(dot(next, facing) > 0.0 ? facing : -facing), roughness * roughness));
      throughput *= albedo;
      origin = surface.position + next * bias * 2.0;
      direction = next;
      sunWeight = 1.0;
      bounceDensity = 0.0;
      continue;
    }
    if ((kind == 1 || kind == 4) && random() < metalness + (1.0 - metalness) * clamp(extra.w, 0.0, 1.0) * 0.25) {
      if (specular >= u_specularBounces) break;
      specular++;
      vec3 view = -direction;
      vec3 reflectance = mix(vec3(0.04), albedo, metalness);
      float alpha = max(roughness * roughness, 1e-4);
      origin = surface.position + facing * bias;
      bounceDensity = 0.0;
      /* The sun reaches a reflection two ways, sampled directly and hit by the reflected ray; MIS weighs them. */
      radiance += throughput * ggxSunlight(facing, view, alpha, reflectance, origin);
      vec3 halfway = around(facing, ggxCosTheta(alpha));
      vec3 next = reflect(direction, halfway);
      if (dot(next, facing) <= 0.0 || dot(view, facing) <= 0.0) break;
      throughput *= ggxWeight(facing, view, next, halfway, alpha, reflectance);
      sunWeight = reflectedSunWeight(facing, view, halfway, alpha);
      direction = next;
      continue;
    }
    vec3 shadingPoint = u_pixelated && fullCubes && !surface.ground ? (vec3(surface.cell) + 0.5 + normal * 0.5) * u_scale + u_origin : surface.position;
    origin = shadingPoint + facing * bias;
    vec3 toSun = cone(u_sunDirection, u_sunCos);
    float cosSun = dot(toSun, facing);
    if (cosSun > 0.0) radiance += throughput * albedo * sunlightThrough(origin, toSun) * sunlight() * cosSun;
    if (u_hasArea) radiance += throughput * albedo * areaLight(origin, facing);
    if (diffuse >= u_diffuseBounces) break;
    diffuse++;
    throughput *= albedo;
    direction = cosineHemisphere(facing);
    bounceDensity = max(dot(direction, facing), 1e-4) / PI;
    sunWeight = 0.0;
    if (depth > 2) {
      float survive = max(throughput.r, max(throughput.g, throughput.b));
      if (random() > survive) break;
      throughput /= survive;
    }
  }
  radiance = min(radiance, vec3(u_energy));
  vec4 current = vec4(radiance * coverage, coverage);
  o_color = u_sample < 0.5 ? current : mix(texelFetch(u_previous, ivec2(gl_FragCoord.xy), 0), current, 1.0 / (u_sample + 1.0));
}
`;

/** Bloom works at 1/BLOOM_DOWNSAMPLE of the image size. */
export const BLOOM_DOWNSAMPLE = 4;

/** Bloom's bright pass: each texel averages its block of the image, keeping what the exposure lifts above the threshold. */
export const BLOOM_EXTRACT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_accumulation;
uniform float u_exposure;
uniform float u_threshold;
out vec4 o_color;

void main() {
  ivec2 size = textureSize(u_accumulation, 0);
  ivec2 base = ivec2(gl_FragCoord.xy) * ${BLOOM_DOWNSAMPLE};
  vec3 sum = vec3(0.0);
  for (int y = 0; y < ${BLOOM_DOWNSAMPLE}; y++) {
    for (int x = 0; x < ${BLOOM_DOWNSAMPLE}; x++) {
      vec3 color = texelFetch(u_accumulation, min(base + ivec2(x, y), size - 1), 0).rgb * u_exposure;
      sum += max(color - u_threshold, 0.0);
    }
  }
  o_color = vec4(sum / float(${BLOOM_DOWNSAMPLE * BLOOM_DOWNSAMPLE}), 1.0);
}
`;

/** One direction of a separable Gaussian blur; past 64 taps the taps spread out. */
export const BLOOM_BLUR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_direction;
uniform float u_radius;
out vec4 o_color;

void main() {
  vec2 size = vec2(textureSize(u_source, 0));
  vec2 uv = gl_FragCoord.xy / size;
  float taps = min(ceil(u_radius), 64.0);
  float stride = max(u_radius / 64.0, 1.0);
  float sigma = max(u_radius / 2.5, 0.5);
  vec3 sum = texture(u_source, uv).rgb;
  float total = 1.0;
  for (int index = 1; index <= 64; index++) {
    float tap = float(index);
    if (tap > taps) break;
    float distance = tap * stride;
    float weight = exp(-0.5 * distance * distance / (sigma * sigma));
    vec2 offset = u_direction * distance / size;
    sum += (texture(u_source, uv + offset).rgb + texture(u_source, uv - offset).rgb) * weight;
    total += 2.0 * weight;
  }
  o_color = vec4(sum / total, 1.0);
}
`;

/**
 * The accumulated mean to the screen (MagicaVoxel's film): exposure, ACES filmic tone mapping or plain
 * clamping, gamma and vignette, after adding the bloom. Pixels the scene does not cover show the flat background colour or stay
 * transparent; the colour is premultiplied by coverage.
 */
export const DISPLAY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_accumulation;
uniform sampler2D u_bloom;
uniform float u_bloomMix;
uniform vec2 u_resolution;
uniform float u_exposure;
uniform bool u_aces;
uniform float u_gamma;
uniform float u_vignette;
uniform bool u_transparent;
uniform vec3 u_background;
out vec4 o_color;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec4 sampled = texelFetch(u_accumulation, ivec2(gl_FragCoord.xy), 0);
  float coverage = sampled.a;
  vec3 color = coverage > 0.0 ? sampled.rgb / coverage * u_exposure : vec3(0.0);
  color += texture(u_bloom, gl_FragCoord.xy / u_resolution).rgb * u_bloomMix;
  /* MagicaVoxel scales by 0.6 ahead of the fitted curve (its \`aces\` uniform), as Narkowicz's fit expects. */
  color = u_aces ? aces(color * 0.6) : clamp(color, 0.0, 1.0);
  color = pow(color, vec3(1.0 / max(u_gamma, 0.1)));
  vec2 uv = gl_FragCoord.xy / u_resolution - 0.5;
  color *= clamp(1.0 - u_vignette * dot(uv, uv) * 2.0, 0.0, 1.0);
  o_color = u_transparent ? vec4(color * coverage, coverage) : vec4(color * coverage + u_background * (1.0 - coverage), 1.0);
}
`;

/**
 * One pass of an edge-avoiding à-trous wavelet filter (Dammertz et al. 2010): a 5×5 B3-spline whose taps
 * spread by \`u_step\` each pass, weighted down across changes of colour, normal and albedo. MagicaVoxel
 * denoises with Intel's OIDN; this is the browser's stand-in.
 */
export const DENOISE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_color;
uniform sampler2D u_albedo;
uniform sampler2D u_normal;
uniform int u_step;
uniform float u_colorSigma;
out vec4 o_color;

const float KERNEL[3] = float[3](0.375, 0.25, 0.0625);

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  ivec2 limit = textureSize(u_color, 0) - 1;
  vec4 center = texelFetch(u_color, pixel, 0);
  vec3 centerNormal = texelFetch(u_normal, pixel, 0).xyz;
  vec3 centerAlbedo = texelFetch(u_albedo, pixel, 0).rgb;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      ivec2 tap = clamp(pixel + ivec2(x, y) * u_step, ivec2(0), limit);
      vec4 color = texelFetch(u_color, tap, 0);
      vec3 normal = texelFetch(u_normal, tap, 0).xyz;
      vec3 albedo = texelFetch(u_albedo, tap, 0).rgb;
      vec3 colorStep = color.rgb - center.rgb;
      vec3 albedoStep = albedo - centerAlbedo;
      float normalWeight = dot(normal, normal) * dot(centerNormal, centerNormal) > 0.0 ? pow(max(dot(normalize(normal), normalize(centerNormal)), 0.0), 32.0) : float(dot(normal, normal) == dot(centerNormal, centerNormal));
      float weight = KERNEL[abs(x)] * KERNEL[abs(y)] * exp(-dot(colorStep, colorStep) / u_colorSigma) * exp(-dot(albedoStep, albedoStep) / 0.02) * normalWeight;
      sum += color * weight;
      total += weight;
    }
  }
  o_color = total > 0.0 ? sum / total : center;
}
`;
