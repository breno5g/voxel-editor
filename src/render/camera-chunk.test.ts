import { describe, expect, it } from 'vitest';
import { cameraAngles, cameraFromDict, cameraToDict, eyeDirection } from './camera-chunk.ts';

/** An `iso` slot from a file saved by MagicaVoxel 0.99.7. */
const ISO_SLOT = new Map([
  ['_mode', 'iso'],
  ['_focus', '120.339 -317.145 281.52'],
  ['_angle', '-35.2644 18.1314 0'],
  ['_radius', '2778.8'],
  ['_frustum', '75.5621'],
  ['_fov', '45'],
]);

describe('eyeDirection', () => {
  it('looks from the front (-y) at zero angles, like MagicaVoxel', () => {
    const [x, y, z] = eyeDirection(0, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(-1);
    expect(z).toBeCloseTo(0);
  });

  it('puts the eye above the focus for a negative pitch, as isometric slots do', () => {
    expect(eyeDirection(-35.2644, 0)[2]).toBeCloseTo(Math.sqrt(1 / 3), 3);
  });

  it('inverts to the same angles', () => {
    const [ax, ay] = cameraAngles(eyeDirection(-20, 140));
    expect(ax).toBeCloseTo(-20);
    expect(ay).toBeCloseTo(140);
  });
});

describe('rCAM slots', () => {
  it('reads an isometric slot with its visible half height', () => {
    const camera = cameraFromDict(ISO_SLOT);
    expect(camera?.mode).toBe('iso');
    expect(camera?.height).toBeCloseTo(75.5621);
    expect(camera && camera.position[2] - camera.target[2]).toBeGreaterThan(0);
  });

  it('writes back what it reads', () => {
    const camera = cameraFromDict(ISO_SLOT);
    const written = camera && cameraToDict(camera);
    expect(written?.get('_angle')).toBe('-35.2644 18.1314 0');
    expect(written?.get('_radius')).toBe('2778.8');
    expect(written?.get('_frustum')).toBe('75.5621');
    expect(written?.get('_focus')).toBe('120.339 -317.145 281.52');
  });

  it('treats MagicaVoxel empty slots as empty', () => {
    expect(cameraFromDict(new Map([['_mode', 'pers'], ['_focus', '0 0 0'], ['_angle', '0 0 0'], ['_radius', '0']]))).toBeNull();
  });
});
