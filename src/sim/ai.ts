import type {
  GangState,
  RouteServiceState,
  SimEvent,
  WorldSnapshot,
} from './types';
import type { SeededPrng } from './rng';
import { ensureGangNodesStaffed, hireHood } from './hoods';
import { canClaimCandidateNode, executeClaimCandidateNode, executePurchaseBorderRoute } from './influence';
import {
  bootMigrant,
  assignMigrantToWorkshop,
  assignMigrantToCriminalEnterprise,
  forwardMigrantToRecruiter,
} from './depotActions';

export function processGangAI(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  // Gangs review operations periodically (every 40 ticks)
  if (state.tick % 40 !== 0) {
    return;
  }

  for (const gang of Object.values(state.gangs)) {
    if (gang.status !== 'ACTIVE' || gang.isAiDisabled) continue;

    // 1. Staff any unmanaged gang nodes or border routes with Hoods
    ensureGangNodesStaffed(state, gang, prng, events);

    // 2. Ensure active Scout Hood exists
    const gangScouts = Object.values(state.hoods).filter(
      (h) => h.gangId === gang.id && h.role === 'SCOUT'
    );
    if (gangScouts.length === 0 && gang.cash >= 400) {
      hireHood(
        state,
        gang.id,
        'SCOUT',
        { type: 'SCOUT_ZONE', targetId: gang.mainHqLocationId || gang.hqLocationId, role: 'SCOUT' },
        prng,
        events
      );
    }

    // 3. Upkeep / Bankruptcy check
    if (gang.cash < -6000) {
      gang.status = 'BANKRUPT';
      addDecision(gang, state.tick, 'BANKRUPTCY', 'Severe debt exceeded credit limit.');
      events.push({
        id: `EVT_BANKRUPT_${gang.id}_${state.tick}`,
        tick: state.tick,
        type: 'GANG_BANKRUPT',
        description: `${gang.name} collapsed under operational debts and declared bankruptcy!`,
        importance: 'HIGH',
        gangId: gang.id,
      });

      for (const r of Object.values(state.routes).filter((r) => r.gangId === gang.id)) {
        r.status = 'CLOSING';
      }
      continue;
    }

    // 4. Purchase Discovered Cross-Border Routes (Top Priority: Primary Revenue Generator!)
    const activeGangRoutes = Object.values(state.routes).filter(
      (r) => r.gangId === gang.id && r.status === 'ACTIVE' && r.isCrossBorder
    );
    if (gang.discoveredRouteIds && gang.discoveredRouteIds.length > 0) {
      const routeConnKey = gang.discoveredRouteIds[0];
      if (gang.cash >= 1000) {
        const parts = routeConnKey.replace('CONN__', '').replace('CONN_', '').split('__');
        if (parts.length === 2) {
          const [recId, depotId] = parts;
          const rec = state.locations[recId];
          const depot = state.locations[depotId];

          if (rec && depot && rec.gangId === gang.id && depot.gangId === gang.id && rec.region !== depot.region) {
            try {
              executePurchaseBorderRoute(state, gang.id, rec.id, depot.id, prng, events);
              addDecision(gang, state.tick, 'PURCHASE_ROUTE', `Established cross-border route from ${rec.name} to ${depot.name}.`);
            } catch {
              gang.discoveredRouteIds = gang.discoveredRouteIds.filter((k) => k !== routeConnKey);
            }
          } else {
            gang.discoveredRouteIds = gang.discoveredRouteIds.filter((k) => k !== routeConnKey);
          }
        } else {
          gang.discoveredRouteIds = gang.discoveredRouteIds.filter((k) => k !== routeConnKey);
        }
      }
    }

    // 5. Purchase Discovered Candidate Nodes
    // Strategic priority order: Home Recruiter -> Cross-region Forward HQ -> Destination Depot -> Intra-region nodes -> Workshop
    if (gang.discoveredNodeIds && gang.discoveredNodeIds.length > 0) {
      const candidates = gang.discoveredNodeIds
        .map((id) => state.locations[id])
        .filter((loc) => loc && loc.operationalStatus === 'DISCOVERED_CANDIDATE');

      const ownHqs = (gang.hqLocationIds || []).map((id) => state.locations[id]).filter(Boolean);
      const ownRegions = new Set(ownHqs.map((h) => h.region));
      const recCount = (gang.recruiterLocationIds || []).length;
      const depCount = (gang.depotLocationIds || []).length;
      const hasRoute = activeGangRoutes.length > 0;

      const getPriority = (cand: typeof candidates[0]): number => {
        // 1. First Recruiter in home region
        if (cand.kind === 'RECRUITER' && recCount === 0) return 1;

        // 2. Cross-region Forward HQ to expand influence across the border
        if (cand.kind === 'HQ' && !ownRegions.has(cand.region)) {
          // If we already have 2 regions, wait until we have an active route before expanding to a 3rd
          if (ownRegions.size >= 2 && !hasRoute) return 8;
          return recCount > 0 ? 2 : 4;
        }

        // 3. Depot in destination region (different region than home recruiter)
        if (cand.kind === 'DEPOT') {
          const hasCrossRec = (gang.recruiterLocationIds || []).some(
            (id) => state.locations[id]?.region !== cand.region
          );
          if (hasCrossRec) return 2;
          return depCount === 0 ? 3 : 6;
        }

        // 4. Secondary Recruiter
        if (cand.kind === 'RECRUITER') return 5;

        // 5. Workshop
        if (cand.kind === 'WORKSHOP') return !gang.workshopLocationId ? 7 : 9;

        // 6. Same-region HQ synergy
        if (cand.kind === 'HQ') return 8;

        return 10;
      };

      candidates.sort((a, b) => getPriority(a) - getPriority(b));

      // Always reserve money to purchase discovered routes if available
      const routeReserve = (gang.discoveredRouteIds && gang.discoveredRouteIds.length > 0) ? 1000 : 0;
      const safetyReserve = routeReserve + 300;

      for (const cand of candidates) {
        const check = canClaimCandidateNode(state, gang.id, cand.id);
        if (!check.allowed) continue;
        const cost = check.cost;
        if (gang.cash >= cost + safetyReserve) {
          try {
            executeClaimCandidateNode(state, gang.id, cand.id, prng, events);
            addDecision(gang, state.tick, `PURCHASE_${cand.kind}`, `Acquired ${cand.name} in ${cand.region} ($${cost}).`);
            break; // One purchase per cycle to stagger growth
          } catch {
            // Insufficient funds or invalid
          }
        }
      }
    }

    // 6. Autonomous Migrant Management (Depot forwarding, assignments, and releases)
    const gangDepots = Object.values(state.locations).filter(
      (l) => l.gangId === gang.id && l.kind === 'DEPOT'
    );
    for (const depot of gangDepots) {
      const occupants = Object.values(state.migrants).filter(
        (m) => m.originId === depot.id && (m.status === 'AT_DEPOT' || m.status === 'ARRIVED')
      );

      for (const migrant of occupants) {
        if (migrant.destinationReached || migrant.destinationId === depot.id) {
          // Reached final destination!
          if (migrant.goal === 'LEAVE' || migrant.goal === 'MARRY') {
            bootMigrant(state, migrant.id, events);
            addDecision(gang, state.tick, 'RELEASE_MIGRANT', `Released ${migrant.name} at destination (Goal ${migrant.goal} fulfilled).`);
          } else if (migrant.goal === 'WORK') {
            const ws = Object.values(state.locations).find(
              (l) => (l.kind === 'WORKSHOP' || l.kind === 'CRIMINAL_ENTERPRISE') && l.gangId === gang.id && l.region === depot.region
            );
            if (ws) {
              assignMigrantToWorkshop(state, migrant.id, ws.id, events);
              addDecision(gang, state.tick, 'ASSIGN_WORKSHOP', `Assigned ${migrant.name} to ${ws.name} (WORK goal fulfilled).`);
            }
          } else if (migrant.goal === 'CRIME') {
            const ce = Object.values(state.locations).find(
              (l) => (l.kind === 'CRIMINAL_ENTERPRISE' || l.kind === 'WORKSHOP') && l.gangId === gang.id && l.region === depot.region
            );
            if (ce) {
              assignMigrantToCriminalEnterprise(state, migrant.id, ce.id, events);
              addDecision(gang, state.tick, 'ASSIGN_CRIME', `Assigned ${migrant.name} to ${ce.name} (CRIME goal fulfilled).`);
            }
          }
        } else {
          // Intermediate depot: check if continuation recruiter exists in same region
          const nextRecruiter = Object.values(state.locations).find((l) => {
            if (l.kind !== 'RECRUITER' || l.gangId !== gang.id || l.region !== depot.region) return false;
            return Object.values(state.routes).some(
              (r) => r.gangId === gang.id && r.sourceId === l.id && r.status === 'ACTIVE'
            );
          });
          if (nextRecruiter) {
            forwardMigrantToRecruiter(state, migrant.id, nextRecruiter.id, events);
            addDecision(gang, state.tick, 'FORWARD_MIGRANT', `Forwarded ${migrant.name} to ${nextRecruiter.name} for onward travel.`);
          }
        }
      }
    }
  }

  // 4. Gang Revitalization if active gangs drop below 2
  const activeGangs = Object.values(state.gangs).filter((g) => g.status === 'ACTIVE');
  if (activeGangs.length < 2) {
    const backupSyndicates = [
      { id: 'GANG_ABYSSAL_TIDE', name: 'Abyssal Tide', color: '#a855f7', colorNum: 0xa855f7, emblem: '⬡', xOff: 1350 },
      { id: 'GANG_EMERALD_CORAL', name: 'Emerald Coral', color: '#10b981', colorNum: 0x10b981, emblem: '✿', xOff: 2850 },
    ];
    for (const synd of backupSyndicates) {
      if (!state.gangs[synd.id] || state.gangs[synd.id].status !== 'ACTIVE') {
        const hqId = `HQ_${synd.id}`;

        state.locations[hqId] = {
          id: hqId,
          name: `${synd.name} European HQ`,
          region: 'EUROPE',
          x: synd.xOff,
          y: 430,
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ',
          gangId: synd.id,
          isMainHq: true,
          operationalStatus: 'ACTIVE',
          influenceRadius: 220,
        };

        state.gangs[synd.id] = {
          id: synd.id,
          name: synd.name,
          color: synd.color,
          colorNum: synd.colorNum,
          emblem: synd.emblem,
          hqLocationId: hqId,
          mainHqLocationId: hqId,
          hqLocationIds: [hqId],
          workshopLocationId: undefined,
          recruiterLocationIds: [],
          depotLocationIds: [],
          cash: 10000,
          reputation: 75,
          status: 'ACTIVE',
          discoveredNodeIds: [],
          discoveredRouteIds: [],
          discoveredCandidateRoutes: [],
          wageBillTotal: 30,
          recentDecisions: [{ tick: state.tick, action: 'FOUND_GANG', reason: 'Chartered syndicate with European Main HQ.' }],
          stats: { recruitsTotal: 0, voyagesLaunched: 0, voyagesSuccessful: 0, voyagesDisrupted: 0, revenueTotal: 0 },
        };

        // Staff starting Main HQ with HQ Boss, and hire 1 starter Scout Hood
        hireHood(
          state,
          synd.id,
          'HQ_BOSS',
          { type: 'MANAGE_NODE', targetId: hqId, role: 'HQ_BOSS' },
          prng,
          events
        );
        hireHood(
          state,
          synd.id,
          'SCOUT',
          { type: 'SCOUT_ZONE', targetId: hqId, role: 'SCOUT' },
          prng,
          events
        );

        events.push({
          id: `EVT_FOUND_${synd.id}_${state.tick}`,
          tick: state.tick,
          type: 'GANG_FOUNDED',
          description: `${synd.name} chartered with single European Main HQ to build up gradually.`,
          importance: 'HIGH',
          gangId: synd.id,
        });
        break;
      }
    }
  }
}

function addDecision(gang: GangState, tick: number, action: string, reason: string) {
  gang.recentDecisions.unshift({ tick, action, reason });
  if (gang.recentDecisions.length > 5) {
    gang.recentDecisions.pop();
  }
}
