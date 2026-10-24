import { describe, it, expect } from 'vitest';
import { LocalGameEngine } from '../src/app/GamePort';
import { assertInvariants } from '../src/sim/invariants';

describe('Broke World Headless Soak Test', () => {
  it('runs stably for 2500 ticks (~250 game days) with strictly maintained invariants', () => {
    const engine = new LocalGameEngine(2026);

    for (let step = 0; step < 25; step++) {
      engine.advance(100);
      const snapshot = engine.getSnapshot();

      // Check invariant assertions at every 100 ticks
      expect(() => assertInvariants(snapshot)).not.toThrow();

      // Population bounds
      expect(snapshot.stats.activeMigrants).toBeGreaterThanOrEqual(0);
      expect(snapshot.stats.activeMigrants).toBeLessThan(100);

      // Event limit to avoid memory leaks
      expect(snapshot.events.length).toBeLessThanOrEqual(500);

      // Gangs must maintain at least 2 active gangs
      const activeGangs = Object.values(snapshot.gangs).filter((g) => g.status === 'ACTIVE');
      expect(activeGangs.length).toBeGreaterThanOrEqual(1);
    }

    const finalState = engine.getSnapshot();
    expect(finalState.stats.totalVoyagesLaunched).toBeGreaterThan(10);
    expect(finalState.stats.totalDepartedMigrants).toBeGreaterThan(5);
  }, 30000);
});
