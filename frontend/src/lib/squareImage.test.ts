import { describe, expect, it } from 'vitest';
import { computeSquareCrop, isHeicFile } from './squareImage';

describe('isHeicFile', () => {
  it('detects by mime', () => {
    expect(isHeicFile({ type: 'image/heic', name: 'a' })).toBe(true);
    expect(isHeicFile({ type: 'image/HEIF', name: 'a' })).toBe(true);
  });
  it('detects by extension when mime is empty', () => {
    expect(isHeicFile({ type: '', name: 'IMG_1.HEIC' })).toBe(true);
    expect(isHeicFile({ type: '', name: 'IMG_1.heif' })).toBe(true);
  });
  it('rejects other images', () => {
    expect(isHeicFile({ type: 'image/jpeg', name: 'a.jpg' })).toBe(false);
    expect(isHeicFile({ type: '', name: '' })).toBe(false);
  });
});

describe('computeSquareCrop', () => {
  it('centers a landscape image', () => {
    expect(computeSquareCrop(400, 200)).toEqual({ sx: 100, sy: 0, size: 200, outSize: 200 });
  });
  it('centers a portrait image', () => {
    expect(computeSquareCrop(200, 500)).toEqual({ sx: 0, sy: 150, size: 200, outSize: 200 });
  });
  it('leaves a square alone', () => {
    expect(computeSquareCrop(300, 300)).toEqual({ sx: 0, sy: 0, size: 300, outSize: 300 });
  });
  it('caps output at max side', () => {
    expect(computeSquareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, size: 3000, outSize: 2048 });
    expect(computeSquareCrop(4000, 3000, 1000).outSize).toBe(1000);
  });
});
