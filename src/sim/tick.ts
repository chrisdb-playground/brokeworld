import type { SimCommand, SimEvent, WorldSnapshot } from './types';
import type { SeededPrng } from './rng';
import { spawnChumigrants } from './spawner';
import { processRecruitment } from './recruitment';
import { processVoyages } from './voyages';
import { processGangAI } from './ai';
import { processScouts } from './scouts';
import { processPayroll, hireHood } from './hoods';
import { assertInvariants } from './invariants';

import {
  executePurchaseHQ,
  executePurchaseNode,
  executeClaimCandidateNode,
  executePurchaseBorderRoute,
  tickInfluenceGrowth,
} from './influence';

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
    handleCommand(state, cmd, newEvents, prng);
  }

  // 3. Scout Hoods Discovery (active scouts discover candidate sites & route opportunities)
  processScouts(state, prng, newEvents);

  // 4. Periodic Payroll (hood wages deducted every 60 ticks)
  processPayroll(state, newEvents);

  // 5. Dynamic Influence Ticking (HQ radius expands over time)
  tickInfluenceGrowth(state);

  // 6. Chumigrant Spawning
  spawnChumigrants(state, prng, newEvents);

  // 7. Gang AI Decisions (reviews operations, hires scouts, buys nodes & routes)
  processGangAI(state, prng, newEvents);

  // 8. Recruitment at East & West Recruiters
  processRecruitment(state, prng, newEvents);

  // 9. Voyage Scheduling & Progress (cross-border and intra-region)
  processVoyages(state, prng, newEvents);

  // 10. Event Log Maintenance (keep recent 100 events, no memory leaks)
  if (newEvents.length > 0) {
    state.events.unshift(...newEvents);
    if (state.events.length > 100) {
      state.events.length = 100;
    }
  }

  // 11. Update stats counts
  state.stats.totalActiveRoutes = Object.values(state.routes).filter((r) => r.status === 'ACTIVE').length;

  // 12. Check simulation invariants
  assertInvariants(state);

  return state;
}

function handleCommand(
  state: WorldSnapshot,
  cmd: SimCommand,
  events: SimEvent[],
  prng: SeededPrng
) {
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
  } else if (cmd.type === 'PURCHASE_HQ') {
    const payload = cmd.payload as {
      gangId: string;
      region: import('./types').RegionId;
      x: number;
      y: number;
      name?: string;
    };
    try {
      executePurchaseHQ(state, payload.gangId, payload.region, payload.x, payload.y, prng, payload.name, events);
    } catch (err: unknown) {
      events.push({
        id: `EVT_ERR_PURCHASE_HQ_${state.tick}`,
        tick: state.tick,
        type: 'OPERATION_CLOSED',
        description: `Failed to purchase HQ for ${payload.gangId}: ${err instanceof Error ? err.message : String(err)}`,
        importance: 'LOW',
        gangId: payload.gangId,
      });
    }
  } else if (cmd.type === 'PURCHASE_NODE') {
    const payload = cmd.payload as {
      gangId: string;
      kind: import('./types').LocationKind;
      region: import('./types').RegionId;
      x: number;
      y: number;
      name?: string;
    };
    try {
      executePurchaseNode(state, payload.gangId, payload.kind, payload.region, payload.x, payload.y, prng, payload.name, events);
    } catch (err: unknown) {
      events.push({
        id: `EVT_ERR_PURCHASE_NODE_${state.tick}`,
        tick: state.tick,
        type: 'OPERATION_CLOSED',
        description: `Failed to purchase ${payload.kind} for ${payload.gangId}: ${err instanceof Error ? err.message : String(err)}`,
        importance: 'LOW',
        gangId: payload.gangId,
      });
    }
  } else if (cmd.type === 'CLAIM_CANDIDATE_NODE') {
    const payload = cmd.payload as {
      gangId: string;
      candidateId: string;
    };
    try {
      executeClaimCandidateNode(state, payload.gangId, payload.candidateId, prng, events);
    } catch (err: unknown) {
      events.push({
        id: `EVT_ERR_CLAIM_${state.tick}`,
        tick: state.tick,
        type: 'OPERATION_CLOSED',
        description: `Failed to claim candidate ${payload.candidateId}: ${err instanceof Error ? err.message : String(err)}`,
        importance: 'LOW',
        gangId: payload.gangId,
      });
    }
  } else if (cmd.type === 'PURCHASE_BORDER_ROUTE') {
    const payload = cmd.payload as {
      gangId: string;
      sourceRecruiterId: string;
      targetDepotId: string;
    };
    try {
      executePurchaseBorderRoute(state, payload.gangId, payload.sourceRecruiterId, payload.targetDepotId, prng, events);
    } catch (err: unknown) {
      events.push({
        id: `EVT_ERR_PURCHASE_ROUTE_${state.tick}`,
        tick: state.tick,
        type: 'OPERATION_CLOSED',
        description: `Failed to purchase border route: ${err instanceof Error ? err.message : String(err)}`,
        importance: 'LOW',
        gangId: payload.gangId,
      });
    }
  } else if (cmd.type === 'HIRE_SCOUT') {
    const payload = cmd.payload as {
      gangId: string;
    };
    const gang = state.gangs[payload.gangId];
    if (gang && gang.status === 'ACTIVE') {
      hireHood(
        state,
        gang.id,
        'SCOUT',
        { type: 'SCOUT_ZONE', targetId: gang.mainHqLocationId || gang.hqLocationId, role: 'SCOUT' },
        prng,
        events
      );
    }
  }
}
