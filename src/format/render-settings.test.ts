import { describe, expect, it } from 'vitest';
import { DEFAULT_RENDER_OBJECTS, readRenderSettings, writeRenderSettings } from './render-settings.ts';

describe('render settings', () => {
  it('reads MagicaVoxel defaults when the file has no rOBJ', () => {
    const settings = readRenderSettings([]);
    expect(settings.sun).toEqual({ intensity: 0.6, color: [255, 255, 255], pitch: 50, yaw: 50, area: 0.07, disk: false });
    expect(settings.environment).toBe('uniform');
    expect(settings.show.ground).toBe(true);
    expect(settings.lens.fov).toBe(45);
  });

  it('reads a saved file, including the old IBL rotation', () => {
    const settings = readRenderSettings([
      new Map([['_type', '_env'], ['_mode', '2']]),
      new Map([['_type', '_ibl'], ['_path', 'sky.hdr'], ['_i', '1'], ['_rot', '0.5']]),
      new Map([['_type', '_ground'], ['_color', '245 183 85'], ['_hor', '0.1']]),
    ]);
    expect(settings.environment).toBe('ibl');
    expect(settings.ibl).toEqual({ path: 'sky.hdr', intensity: 1, pitch: 0, yaw: 180 });
    expect(settings.ground.color).toEqual([245, 183, 85]);
  });

  it('writes changes into the file entries and keeps unknown keys', () => {
    const objects = [new Map([['_type', '_inf'], ['_i', '0.6'], ['_extra', 'kept']])];
    const settings = readRenderSettings(objects);
    const written = writeRenderSettings(objects, { ...settings, sun: { ...settings.sun, intensity: 1.25 } });
    expect(written[0].get('_i')).toBe('1.25');
    expect(written[0].get('_extra')).toBe('kept');
    expect(written).toHaveLength(DEFAULT_RENDER_OBJECTS.length);
    expect(readRenderSettings(written)).toEqual({ ...settings, sun: { ...settings.sun, intensity: 1.25 } });
  });
});
