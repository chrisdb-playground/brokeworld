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
import { acceptProspect } from './recruitment';
import {
  bootMigrant,
  assignMigrantToWorkshop,
  assignMigrantToCriminalEnterprise,
  forwardMigrantToRecruiter,
  toggleLockdown,
} from './depotActions';

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
        type: 'GOD_INTERVENTION',
        description: `Observer grant of $${payload.amount} disbursed to ${g.name}.`,
        importance: 'HIGH',
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
  } else if (cmd.type === 'SET_GANG_CASH') {
    const payload = cmd.payload as { gangId: string; cash: number };
    const g = state.gangs[payload.gangId];
    if (g) {
      g.cash = payload.cash;
      if (g.cash >= 0 && g.status === 'BANKRUPT') {
        g.status = 'ACTIVE';
      }
      events.push({
        id: `EVT_SET_CASH_${state.tick}_${Math.floor(prng.next() * 10000)}`,
        tick: state.tick,
        type: 'GOD_INTERVENTION',
        description: `👑 God Mode: Set ${g.name} treasury directly to $${payload.cash.toLocaleString()}.`,
        importance: 'HIGH',
        gangId: g.id,
      });
    }
  } else if (cmd.type === 'SET_GANG_REPUTATION') {
    const payload = cmd.payload as { gangId: string; reputation: number };
    const g = state.gangs[payload.gangId];
    if (g) {
      g.reputation = Math.max(0, Math.min(100, payload.reputation));
      events.push({
        id: `EVT_SET_REP_${state.tick}_${Math.floor(prng.next() * 10000)}`,
        tick: state.tick,
        type: 'GOD_INTERVENTION',
        description: `👑 God Mode: Altered ${g.name} underworld reputation to ${g.reputation}%.`,
        importance: 'MEDIUM',
        gangId: g.id,
      });
    }
  } else if (cmd.type === 'TOGGLE_GANG_AI') {
    const payload = cmd.payload as { gangId: string; enabled: boolean };
    const g = state.gangs[payload.gangId];
    if (g) {
      g.isAiDisabled = !payload.enabled;
      events.push({
        id: `EVT_AI_${state.tick}_${Math.floor(prng.next() * 10000)}`,
        tick: state.tick,
        type: 'GOD_INTERVENTION',
        description: `👑 God Mode: Autonomous AI for ${g.name} set to ${payload.enabled ? 'ENABLED' : 'PAUSED (MANUAL PUPPET)'}.`,
        importance: 'HIGH',
        gangId: g.id,
      });
    }
  } else if (cmd.type === 'CLAIM_ALL_CANDIDATES') {
    const payload = cmd.payload as { gangId: string; free?: boolean };
    const g = state.gangs[payload.gangId];
    if (g) {
      const candidates = Object.values(state.locations).filter(
        (l) => l.operationalStatus === 'DISCOVERED_CANDIDATE' && l.discoveredByGangId === g.id
      );
      // Process HQ candidates first so their influence zones cover neighboring candidates
      candidates.sort((a, b) => (a.kind === 'HQ' ? -1 : (b.kind === 'HQ' ? 1 : 0)));
      let claimed = 0;
      for (const cand of candidates) {
        try {
          if (payload.free) {
            g.cash += 5000;
          }
          executeClaimCandidateNode(state, g.id, cand.id, prng, events);
          claimed++;
        } catch {
          // continue
        }
      }
      events.push({
        id: `EVT_CLAIM_ALL_${state.tick}_${Math.floor(prng.next() * 10000)}`,
        tick: state.tick,
        type: 'GOD_INTERVENTION',
        description: `👑 God Mode: Auto-claimed ${claimed} candidate node(s) for ${g.name}.`,
        importance: 'HIGH',
        gangId: g.id,
      });
    }
  } else if (cmd.type === 'CHARTER_ALL_ROUTES') {
    const payload = cmd.payload as { gangId: string; free?: boolean };
    const g = state.gangs[payload.gangId];
    if (g && g.discoveredCandidateRoutes) {
      let chartered = 0;
      const routes = [...g.discoveredCandidateRoutes];
      for (const cr of routes) {
        try {
          if (payload.free) {
            g.cash += 5000;
          }
          executePurchaseBorderRoute(state, g.id, cr.sourceId, cr.targetId, prng, events);
          chartered++;
        } catch {
          // continue
        }
      }
      events.push({
        id: `EVT_CHARTER_ALL_${state.tick}_${Math.floor(prng.next() * 10000)}`,
        tick: state.tick,
        type: 'GOD_INTERVENTION',
        description: `👑 God Mode: Auto-chartered ${chartered} candidate border route(s) for ${g.name}.`,
        importance: 'HIGH',
        gangId: g.id,
      });
    }
  } else if (cmd.type === 'SPAWN_MIGRANTS') {
    const payload = cmd.payload as { gangId?: string; count?: number };
    const count = Math.max(1, payload.count || 10);
    let targets: string[] = [];
    if (payload.gangId && state.gangs[payload.gangId]) {
      const g = state.gangs[payload.gangId];
      targets = g.recruiterLocationIds || [];
    }
    if (targets.length === 0) {
      targets = Object.values(state.locations)
        .filter((l) => l.kind === 'RECRUITER' && l.operationalStatus === 'ACTIVE')
        .map((l) => l.id);
    }
    if (targets.length > 0) {
      for (let i = 0; i < count; i++) {
        const locId = targets[i % targets.length];
        const loc = state.locations[locId];
        const migrantId = `MIG_GOD_${state.tick}_${i}_${Math.floor(prng.next() * 1000)}`;
        state.migrants[migrantId] = {
          id: migrantId,
          name: `VIP Traveler #${Math.floor(prng.next() * 900) + 100}`,
          originName: loc.region === 'AFRICA' ? 'Tripoli Hub' : 'Calais Staging',
          originRegion: loc.region,
          desiredRegion: loc.region === 'AFRICA' ? 'EUROPE' : 'UK',
          originId: locId,
          cash: Math.floor(prng.next() * 2000) + 2500,
          patienceRemainingTicks: 250,
          status: 'WAITING',
          avatar: {
            skinTone: '#f5d0b0',
            shirtColor: '#38bdf8',
            eyesType: 'dots',
            mouthType: 'smile',
            hairColor: '#1e293b',
            hairStyle: 'short',
            luggage: 'briefcase',
          },
          history: [`Spawned by God Mode divine grant at tick ${state.tick}`],
        };
        state.stats.activeMigrants += 1;
      }
      events.push({
        id: `EVT_MIG_GOD_${state.tick}_${Math.floor(prng.next() * 10000)}`,
        tick: state.tick,
        type: 'GOD_INTERVENTION',
        description: `👑 God Mode: Injected +${count} high-budget migrants into recruiter networks!`,
        importance: 'HIGH',
        gangId: payload.gangId,
      });
    }
  } else if (cmd.type === 'FAST_FORWARD_VOYAGES') {
    const payload = cmd.payload as { gangId?: string };
    let deliveredCount = 0;
    let totalRevenue = 0;
    for (const voyage of Object.values(state.voyages)) {
      if (voyage.status !== 'IN_PROGRESS') continue;
      if (payload.gangId && voyage.gangId !== payload.gangId) continue;
      voyage.status = 'SUCCESS';
      voyage.progress = 1.0;
      state.stats.totalVoyagesSuccess += 1;
      const payout = Math.max(500, voyage.passengerIds.length * 380);
      const gang = state.gangs[voyage.gangId];
      if (gang) {
        gang.stats.voyagesSuccessful += 1;
        gang.cash += payout;
        gang.stats.revenueTotal += payout;
        totalRevenue += payout;
      }
      for (const mId of voyage.passengerIds) {
        const m = state.migrants[mId];
        if (m) {
          m.status = 'ARRIVED';
          m.originId = voyage.targetId;
          m.history.push(`Instant delivered by Divine Intervention at tick ${state.tick}`);
          state.stats.activeMigrants = Math.max(0, state.stats.activeMigrants - 1);
        }
      }
      deliveredCount++;
    }
    events.push({
      id: `EVT_FF_VOYAGES_${state.tick}_${Math.floor(prng.next() * 10000)}`,
      tick: state.tick,
      type: 'GOD_INTERVENTION',
      description: `👑 God Mode: Teleported ${deliveredCount} active voyages to destination ($${totalRevenue.toLocaleString()} revenue awarded)!`,
      importance: 'HIGH',
      gangId: payload.gangId,
    });
  } else if (cmd.type === 'TRIGGER_RAID') {
    const payload = cmd.payload as { gangId?: string };
    let raidedCount = 0;
    for (const voyage of Object.values(state.voyages)) {
      if (voyage.status !== 'IN_PROGRESS') continue;
      if (payload.gangId && voyage.gangId !== payload.gangId) continue;
      voyage.status = 'INTERCEPTED';
      state.stats.totalVoyagesDisrupted += 1;
      const gang = state.gangs[voyage.gangId];
      if (gang) {
        gang.stats.voyagesDisrupted += 1;
        gang.reputation = Math.max(0, gang.reputation - 15);
      }
      for (const mId of voyage.passengerIds) {
        const m = state.migrants[mId];
        if (m) {
          m.status = 'FAILED';
          m.history.push(`Disrupted in police crackdown at tick ${state.tick}`);
          state.stats.activeMigrants = Math.max(0, state.stats.activeMigrants - 1);
        }
      }
      raidedCount++;
    }
    events.push({
      id: `EVT_RAID_${state.tick}_${Math.floor(prng.next() * 10000)}`,
      tick: state.tick,
      type: 'GOD_INTERVENTION',
      description: `🚨 God Mode: Triggered border crackdown! Disrupted ${raidedCount} active voyages.`,
      importance: 'HIGH',
      gangId: payload.gangId,
    });
  } else if (cmd.type === 'GLOBAL_AID') {
    const payload = cmd.payload as { amount?: number };
    const amt = payload.amount || 10000;
    for (const gang of Object.values(state.gangs)) {
      if (gang.status === 'ACTIVE') {
        gang.cash += amt;
      }
    }
    events.push({
      id: `EVT_GLOBAL_AID_${state.tick}_${Math.floor(prng.next() * 10000)}`,
      tick: state.tick,
      type: 'GOD_INTERVENTION',
      description: `👑 God Mode: Disbursed universal stimulus of +$${amt.toLocaleString()} to all active syndicates!`,
      importance: 'HIGH',
    });
  } else if (cmd.type === 'ACCEPT_PROSPECT') {
    const payload = cmd.payload as { migrantId: string };
    acceptProspect(state, payload.migrantId, events);
  } else if (cmd.type === 'BOOT_MIGRANT') {
    const payload = cmd.payload as { migrantId: string };
    bootMigrant(state, payload.migrantId, events);
  } else if (cmd.type === 'ASSIGN_MIGRANT_WORKSHOP') {
    const payload = cmd.payload as { migrantId: string; workshopId?: string };
    assignMigrantToWorkshop(state, payload.migrantId, payload.workshopId, events);
  } else if (cmd.type === 'ASSIGN_MIGRANT_CRIME') {
    const payload = cmd.payload as { migrantId: string; enterpriseId?: string };
    assignMigrantToCriminalEnterprise(state, payload.migrantId, payload.enterpriseId, events);
  } else if (cmd.type === 'FORWARD_MIGRANT') {
    const payload = cmd.payload as { migrantId: string; recruiterId?: string };
    forwardMigrantToRecruiter(state, payload.migrantId, payload.recruiterId, events);
  } else if (cmd.type === 'TOGGLE_LOCKDOWN') {
    const payload = cmd.payload as { locationId: string };
    toggleLockdown(state, payload.locationId, events);
  }
}
