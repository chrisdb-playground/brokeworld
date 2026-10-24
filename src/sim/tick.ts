import type { SimCommand, SimEvent, WorldSnapshot } from './types';
import type { SeededPrng } from './rng';
import { spawnMigrants } from './spawner';
import { processRecruitment } from './recruitment';
import { processVoyages } from './voyages';
import { processGangAI } from './ai';
import { processScouts } from './scouts';
import { processPayroll } from './hoods';
import { assertInvariants } from './invariants';
import { tickInfluenceGrowth } from './influence';
import { handleCommand } from './commands';

/**
 * Main simulation step function.
 * Orchestrates pure chronological subsystems and updates the simulation state.
 */
export function tickWorld(
  state: WorldSnapshot,
  prng: SeededPrng,
  commands: SimCommand[] = []
): WorldSnapshot {
  // 1. Advance tick
  state.tick += 1;

  const newEvents: SimEvent[] = [];

  // 2. Process external commands (e.g. from UI inspector, AI commands)
  for (const cmd of commands) {
    handleCommand(state, cmd, newEvents, prng);
  }

  // 3. Scout Hoods Discovery (discover candidate sites & route opportunities)
  processScouts(state, prng, newEvents);

  // 4. Periodic Payroll (hood wages deducted every 60 ticks)
  processPayroll(state, newEvents);

  // 5. Dynamic Influence Ticking (HQ radius expands over time)
  tickInfluenceGrowth(state);

  // 6. Migrant Spawning
  spawnMigrants(state, prng, newEvents);

  // 7. Gang AI Decisions (reviews operations, hires scouts, buys nodes & routes)
  processGangAI(state, prng, newEvents);

  // 8. Recruitment at East & West Recruiters
  processRecruitment(state, prng, newEvents);

  // 9. Voyage Scheduling & Progress (cross-border and intra-region)
  processVoyages(state, prng, newEvents);

  // 10. Event Log Maintenance (keep recent 500 events for full-screen event log)
  if (newEvents.length > 0) {
    state.events.unshift(...newEvents);
    if (state.events.length > 500) {
      state.events.length = 500;
    }
  }

  // 11. Update stats counts
  state.stats.totalActiveRoutes = Object.values(state.routes).filter((r) => r.status === 'ACTIVE').length;

  // 12. Check simulation invariants
  assertInvariants(state);

  return state;
}
