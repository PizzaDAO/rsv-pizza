import { describe, it, expect } from 'vitest';
import { calculateWaves } from './waveAlgorithm';

describe('calculateWaves', () => {
  const partyStart = new Date('2026-06-15T18:00:00Z');

  describe('short parties (< 1.5 hours)', () => {
    it('returns single wave for 1-hour party', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 1,
        totalGuests: 20,
      });

      expect(waves).toHaveLength(1);
      expect(waves[0].label).toBe('Single Wave');
      expect(waves[0].guestAllocation).toBe(20);
      expect(waves[0].weight).toBe(1.0);
    });

    it('returns single wave for exactly 1-hour party', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 1.0,
        totalGuests: 10,
      });

      expect(waves).toHaveLength(1);
    });

    it('single wave arrives 5 min before party start', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 1,
        totalGuests: 20,
      });

      const expectedArrival = new Date(partyStart.getTime() - 5 * 60000);
      expect(waves[0].arrivalTime.getTime()).toBe(expectedArrival.getTime());
    });
  });

  describe('multi-wave parties', () => {
    it('returns multiple waves for 3-hour party', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 3,
        totalGuests: 40,
      });

      expect(waves.length).toBeGreaterThan(1);
    });

    it('first wave arrives 5 min before party start', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 4,
        totalGuests: 50,
      });

      const expectedFirstWave = new Date(partyStart.getTime() - 5 * 60000);
      expect(waves[0].arrivalTime.getTime()).toBe(expectedFirstWave.getTime());
    });

    it('wave spacing is between 45 and 60 minutes', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 4,
        totalGuests: 50,
      });

      for (let i = 1; i < waves.length; i++) {
        const spacingMinutes =
          (waves[i].arrivalTime.getTime() - waves[i - 1].arrivalTime.getTime()) / 60000;
        expect(spacingMinutes).toBeGreaterThanOrEqual(44); // Allow small rounding
        expect(spacingMinutes).toBeLessThanOrEqual(61); // Allow small rounding
      }
    });

    it('first wave gets 1.5x weight', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 4,
        totalGuests: 50,
      });

      expect(waves[0].weight).toBe(1.5);
      // Other waves should have weight 1.0
      for (let i = 1; i < waves.length; i++) {
        expect(waves[i].weight).toBe(1.0);
      }
    });

    it('first wave allocation is higher than other waves', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 4,
        totalGuests: 100,
      });

      // First wave should get more guests than average
      const avgAllocation = 100 / waves.length;
      expect(waves[0].guestAllocation).toBeGreaterThan(avgAllocation);
    });

    it('total allocation equals totalGuests', () => {
      const totalGuests = 75;
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 4,
        totalGuests,
      });

      const totalAllocated = waves.reduce((sum, w) => sum + w.guestAllocation, 0);
      expect(totalAllocated).toBe(totalGuests);
    });

    it('total allocation equals totalGuests for odd numbers', () => {
      const totalGuests = 37;
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 3,
        totalGuests,
      });

      const totalAllocated = waves.reduce((sum, w) => sum + w.guestAllocation, 0);
      expect(totalAllocated).toBe(totalGuests);
    });
  });

  describe('wave IDs and labels', () => {
    it('assigns sequential IDs', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 4,
        totalGuests: 50,
      });

      waves.forEach((wave, i) => {
        expect(wave.id).toBe(`wave-${i + 1}`);
      });
    });

    it('first wave has "Party Start" in label for multi-wave', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 4,
        totalGuests: 50,
      });

      expect(waves[0].label).toContain('Party Start');
    });
  });

  describe('edge cases', () => {
    it('handles very long party (8 hours)', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 8,
        totalGuests: 100,
      });

      expect(waves.length).toBeGreaterThan(2);
      const totalAllocated = waves.reduce((sum, w) => sum + w.guestAllocation, 0);
      expect(totalAllocated).toBe(100);
    });

    it('handles party with 1 guest', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 3,
        totalGuests: 1,
      });

      const totalAllocated = waves.reduce((sum, w) => sum + w.guestAllocation, 0);
      expect(totalAllocated).toBe(1);
    });

    it('handles exactly 1.5 hour party (boundary)', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 1.5,
        totalGuests: 20,
      });

      // 1.5 is NOT < SHORT_PARTY_THRESHOLD_HOURS (1.5), so it gets multiple waves
      expect(waves.length).toBeGreaterThanOrEqual(2);
      const totalAllocated = waves.reduce((sum, w) => sum + w.guestAllocation, 0);
      expect(totalAllocated).toBe(20);
    });

    it('handles 2-hour party (just above threshold)', () => {
      const waves = calculateWaves({
        partyStartTime: partyStart,
        durationHours: 2,
        totalGuests: 30,
      });

      // Should have at least 2 waves
      expect(waves.length).toBeGreaterThanOrEqual(2);
    });
  });
});
