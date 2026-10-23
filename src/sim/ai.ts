import type {
  GangState,
  RouteServiceState,
  SimEvent,
  WorldSnapshot,
} from './types';
import type { SeededPrng } from './rng';
import { ensureGangNodesStaffed, hireHood } from './hoods';
import { executeClaimCandidateNode, executePurchaseBorderRoute } from './influence';

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
    if (gang.status !== 'ACTIVE') continue;

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

    // 4. Purchase Discovered Candidate Nodes
    // Priority order: Recruiter -> Depot -> Workshop -> Regional HQ
    if (gang.discoveredNodeIds && gang.discoveredNodeIds.length > 0) {
      const candidates = gang.discoveredNodeIds
        .map((id) => state.locations[id])
        .filter((loc) => loc && loc.operationalStatus === 'DISCOVERED_CANDIDATE');

      // Sort by strategic priority
      const kindPriority: Record<string, number> = {
        RECRUITER: (gang.recruiterLocationIds || []).length === 0 ? 1 : 3,
        DEPOT: (gang.depotLocationIds || []).length === 0 ? 2 : 4,
        WORKSHOP: !gang.workshopLocationId ? 5 : 8,
        HQ: 6,
      };

      candidates.sort((a, b) => (kindPriority[a.kind] || 9) - (kindPriority[b.kind] || 9));

      for (const cand of candidates) {
        const cost = cand.candidateCost || (cand.kind === 'HQ' ? 3500 : (cand.kind === 'WORKSHOP' ? 2500 : (cand.kind === 'DEPOT' ? 1500 : 1800)));
        // Retain $500 safety reserve for payroll
        if (gang.cash >= cost + 500) {
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

    // 5. Purchase Discovered Cross-Border Routes
    if (gang.discoveredRouteIds && gang.discoveredRouteIds.length > 0 && gang.cash >= 1600) {
      const routeConnKey = gang.discoveredRouteIds[0];
      const parts = routeConnKey.replace('CONN__', '').split('__');
      if (parts.length === 2) {
        const [recId, depotId] = parts;
        const rec = state.locations[recId];
        const depot = state.locations[depotId];

        if (rec && depot && rec.gangId === gang.id && depot.gangId === gang.id && rec.region !== depot.region) {
          try {
            executePurchaseBorderRoute(state, gang.id, rec.id, depot.id, prng, events);
            addDecision(gang, state.tick, 'PURCHASE_ROUTE', `Established cross-border route from ${rec.name} to ${depot.name}.`);
          } catch {
            // Skip if conditions not met
          }
        }
      }
    }
  }

  // 4. Gang Revitalization if active gangs drop below 2
  const activeGangs = Object.values(state.gangs).filter((g) => g.status === 'ACTIVE');
  if (activeGangs.length < 2) {
    const backupSyndicates = [
      { id: 'GANG_ABYSSAL_TIDE', name: 'Abyssal Tide', color: '#a855f7', colorNum: 0xa855f7, emblem: '⬡', xOff: 350 },
      { id: 'GANG_EMERALD_CORAL', name: 'Emerald Coral', color: '#10b981', colorNum: 0x10b981, emblem: '✿', xOff: 650 },
    ];
    for (const synd of backupSyndicates) {
      if (!state.gangs[synd.id] || state.gangs[synd.id].status !== 'ACTIVE') {
        const hqId = `HQ_${synd.id}`;
        const wsId = `WORKSHOP_${synd.id}`;
        const recAfrId = `REC_${synd.id}_AFRICA`;
        const depotEurId = `DEPOT_${synd.id}_EUROPE`;
        const recEurId = `REC_${synd.id}_EUROPE`;
        const depotUkId = `DEPOT_${synd.id}_UK`;

        const hqAfrId = `HQ_${synd.id}_AFRICA`;
        const hqUkId = `HQ_${synd.id}_UK`;

        state.locations[hqId] = {
          id: hqId,
          name: `${synd.name} European HQ`,
          region: 'EUROPE',
          x: synd.xOff,
          y: 250,
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ',
          gangId: synd.id,
          isMainHq: true,
        };

        state.locations[hqAfrId] = {
          id: hqAfrId,
          name: `${synd.name} Africa HQ`,
          region: 'AFRICA',
          x: synd.xOff + 80,
          y: 640,
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ',
          gangId: synd.id,
          isMainHq: false,
        };

        state.locations[hqUkId] = {
          id: hqUkId,
          name: `${synd.name} UK HQ`,
          region: 'UK',
          x: synd.xOff - 20,
          y: 90,
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ',
          gangId: synd.id,
          isMainHq: false,
        };

        state.locations[wsId] = {
          id: wsId,
          name: `${synd.name} Workshop`,
          region: 'EUROPE',
          x: synd.xOff - 80,
          y: 370,
          tileFamily: 'industrial-press',
          tileVariant: 'mk1-north',
          kind: 'WORKSHOP',
          gangId: synd.id,
        };

        state.locations[recAfrId] = {
          id: recAfrId,
          name: `${synd.name} Africa Recruiter`,
          region: 'AFRICA',
          x: synd.xOff,
          y: 650,
          tileFamily: 'crusher',
          tileVariant: 'mk3',
          kind: 'RECRUITER',
          gangId: synd.id,
        };

        state.locations[depotEurId] = {
          id: depotEurId,
          name: `${synd.name} Europe Depot`,
          region: 'EUROPE',
          x: synd.xOff + 20,
          y: 440,
          tileFamily: 'pressure-tank',
          tileVariant: 'mk1-north',
          kind: 'DEPOT',
          gangId: synd.id,
        };

        state.locations[recEurId] = {
          id: recEurId,
          name: `${synd.name} Europe Recruiter`,
          region: 'EUROPE',
          x: synd.xOff + 120,
          y: 280,
          tileFamily: 'crusher',
          tileVariant: 'mk3',
          kind: 'RECRUITER',
          gangId: synd.id,
        };

        state.locations[depotUkId] = {
          id: depotUkId,
          name: `${synd.name} UK Depot`,
          region: 'UK',
          x: synd.xOff + 100,
          y: 90,
          tileFamily: 'pressure-tank',
          tileVariant: 'mk1-north',
          kind: 'DEPOT',
          gangId: synd.id,
        };

        state.gangs[synd.id] = {
          id: synd.id,
          name: synd.name,
          color: synd.color,
          colorNum: synd.colorNum,
          emblem: synd.emblem,
          hqLocationId: hqId,
          mainHqLocationId: hqId,
          hqLocationIds: [hqId, hqAfrId, hqUkId],
          workshopLocationId: wsId,
          recruiterLocationIds: [recAfrId, recEurId],
          depotLocationIds: [depotEurId, depotUkId],
          cash: 18000,
          reputation: 75,
          status: 'ACTIVE',
          recentDecisions: [{ tick: state.tick, action: 'FOUND_GANG', reason: 'Formed complete 3-region network with regional HQs.' }],
          stats: { recruitsTotal: 0, voyagesLaunched: 0, voyagesSuccessful: 0, voyagesDisrupted: 0, revenueTotal: 0 },
        };

        // Routes: Africa -> Europe, Europe -> UK
        const routesToCreate = [
          { rId: `ROUTE_${synd.id}_AFR_EUR`, cId: `CONN_${recAfrId}_${depotEurId}`, src: recAfrId, tgt: depotEurId },
          { rId: `ROUTE_${synd.id}_EUR_UK`, cId: `CONN_${recEurId}_${depotUkId}`, src: recEurId, tgt: depotUkId },
        ];

        for (const rc of routesToCreate) {
          state.connections[rc.cId] = {
            id: rc.cId,
            sourceId: rc.src,
            targetId: rc.tgt,
            isCrossBorder: true,
            distance: 350,
            mode: 'SEA',
          };

          state.routes[rc.rId] = {
            id: rc.rId,
            gangId: synd.id,
            connectionId: rc.cId,
            sourceId: rc.src,
            targetId: rc.tgt,
            mode: 'BOAT',
            capacity: 5,
            price: 320,
            durationTicks: 65,
            reliability: 0.97,
            status: 'ACTIVE',
            totalPassengers: 0,
            revenue: 0,
            activeVoyageCount: 0,
          };
          state.stats.totalActiveRoutes++;
        }

        // Staff newly founded syndicate with Hoods
        ensureGangNodesStaffed(state, state.gangs[synd.id], prng, events);
        hireHood(
          state,
          synd.id,
          'STANDBY',
          { type: 'IDLE_HQ', targetId: hqId, role: 'STANDBY' },
          prng,
          events
        );

        events.push({
          id: `EVT_FOUND_${synd.id}_${state.tick}`,
          tick: state.tick,
          type: 'GANG_FOUNDED',
          description: `${synd.name} formed with complete 3-region network!`,
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
