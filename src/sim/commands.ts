import type { SimCommand, SimEvent, WorldSnapshot, LocationKind, RegionId } from './types';
import type { SeededPrng } from './rng';
import { hireHood } from './hoods';
import {
  executePurchaseHQ,
  executePurchaseNode,
  executeClaimCandidateNode,
  executePurchaseBorderRoute,
} from './influence';
import { scoutAreaForNodes, scoutSearchForRoutes } from './scouts';

/**
 * Handle user/agent interactive commands dispatched to the simulation engine.
 */
export function handleCommand(
  state: WorldSnapshot,
  cmd: SimCommand,
  events: SimEvent[],
  prng: SeededPrng
): void {
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
      region: RegionId;
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
      kind: LocationKind;
      region: RegionId;
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
  } else if (cmd.type === 'SCOUT_AREA') {
    const payload = cmd.payload as {
      gangId: string;
      region?: RegionId;
      x?: number;
      y?: number;
    };
    const center = payload.x !== undefined && payload.y !== undefined ? { x: payload.x, y: payload.y } : undefined;
    scoutAreaForNodes(state, payload.gangId, prng, payload.region, center, events);
  } else if (cmd.type === 'SEARCH_ROUTES') {
    const payload = cmd.payload as {
      gangId: string;
    };
    scoutSearchForRoutes(state, payload.gangId, prng, events);
  }
}
