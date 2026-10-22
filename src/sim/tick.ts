import type { SimCommand, SimEvent, WorldSnapshot } from './types';
import type { SeededPrng } from './rng';
import { spawnChumigrants } from './spawner';
import { processRecruitment } from './recruitment';
import { processVoyages } from './voyages';
import { processGangAI } from './ai';
import { assertInvariants } from './invariants';

export function tickWorld(
  state: WorldSnapshot,
  prng: SeededPrng,
  commands: SimCommand[] = []
): WorldSnapshot {
  // 1. Advance tick
  state.tick += 1;

  const newEvents: SimEvent[] = [];

  // 2. Process commands (if any dispatched from UI/inspector)
  for (const cmd of commands) {
    handleCommand(state, cmd, newEvents);
  }

  // 3. Chumigrant Spawning (East Depots only)
  spawnChumigrants(state, prng, newEvents);

  // 4. Gang AI Decisions (reviews periodically)
  processGangAI(state, prng, newEvents);

  // 5. Recruitment at East Depots
  processRecruitment(state, prng, newEvents);

  // 6. Voyage Scheduling & Progress (cross-border Depot -> Depot)
  processVoyages(state, prng, newEvents);

  // 7. Event Log Maintenance (keep recent 100 events, no memory leaks)
  if (newEvents.length > 0) {
    state.events.unshift(...newEvents);
    if (state.events.length > 100) {
      state.events.length = 100;
    }
  }

  // 8. Update stats counts
  state.stats.totalActiveRoutes = Object.values(state.routes).filter((r) => r.status === 'ACTIVE').length;

  // 9. Check simulation invariants
  assertInvariants(state);

  return state;
}

function handleCommand(state: WorldSnapshot, cmd: SimCommand, events: SimEvent[]) {
  if (cmd.type === 'GANG_AID') {
    const payload = cmd.payload as { gangId: string; amount: number };
    const g = state.gangs[payload.gangId];
    if (g) {
      g.cash += payload.amount;
      events.push({
        id: `EVT_AID_${state.tick}`,
        tick: state.tick,
        type: 'OPERATION_OPENED',
        description: `Observer grant of $${payload.amount} disbursed to ${g.name}.`,
        importance: 'LOW',
        gangId: g.id,
      });
    }
  }
}
