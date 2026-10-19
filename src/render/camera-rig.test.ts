import { describe, expect, it } from 'vitest';
import { focusZoomExtent, focusZoomRadius } from './camera-rig.ts';

describe('focusZoomRadius', () => {
  it('scales the radius plus one, like MagicaVoxel', () => {
    expect(focusZoomRadius(99, 0.1)).toBeCloseTo(100 * Math.exp(-0.1) - 1);
    expect(focusZoomRadius(99, -0.1)).toBeCloseTo(100 * Math.exp(0.1) - 1);
  });

  it('reaches the focus in a few steps instead of slowing down', () => {
    let radius = 2;
    for (let step = 0; step < 15; step++) radius = focusZoomRadius(radius, 0.1);
    expect(radius).toBe(0.001);
  });
});

describe('focusZoomExtent', () => {
  it('scales the view extent linearly and never collapses it', () => {
    expect(focusZoomExtent(50, 0.1)).toBeCloseTo(45);
    expect(focusZoomExtent(50, -0.1)).toBeCloseTo(55);
    expect(focusZoomExtent(50, 2)).toBe(0.001);
  });
});
