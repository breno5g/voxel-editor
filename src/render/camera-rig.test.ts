import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { focusZoomExtent, focusZoomRadius, turnedTarget } from './camera-rig.ts';

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

describe('turnedTarget', () => {
  const eye = new THREE.Vector3(10, 0, 5);
  const target = new THREE.Vector3(20, 0, 5);

  it('turns the view about the eye, keeping the distance', () => {
    const turned = turnedTarget(eye, target, Math.PI / 2, 0);
    expect(turned.distanceTo(eye)).toBeCloseTo(10);
    expect(turned.x).toBeCloseTo(10);
    expect(turned.y).toBeCloseTo(-10);
  });

  it('pitches up and down without flipping over the vertical', () => {
    expect(turnedTarget(eye, target, 0, -0.5).z).toBeGreaterThan(5);
    expect(turnedTarget(eye, target, 0, 0.5).z).toBeLessThan(5);
    const straightUp = turnedTarget(eye, target, 0, -Math.PI);
    expect(straightUp.z).toBeLessThan(15);
    expect(straightUp.x).toBeGreaterThan(10);
  });
});

describe('focusZoomExtent', () => {
  it('scales the view extent linearly and never collapses it', () => {
    expect(focusZoomExtent(50, 0.1)).toBeCloseTo(45);
    expect(focusZoomExtent(50, -0.1)).toBeCloseTo(55);
    expect(focusZoomExtent(50, 2)).toBe(0.001);
  });
});
