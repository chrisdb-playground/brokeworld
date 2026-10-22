import type {
  GangState,
  RouteServiceState,
  SimEvent,
  WorldSnapshot,
} from './types';
import type { SeededPrng } from './rng';
import { ensureGangNodesStaffed, hireHood } from './hoods';

let routeSeq = 100;

export function processGangAI(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  // Gangs review operations periodically (every 60 ticks)
  if (state.tick % 60 !== 0) {
    return;
  }

  for (const gang of Object.values(state.gangs)) {
    if (gang.status !== 'ACTIVE') continue;

    // Staff any unmanaged gang nodes with Hoods
    ensureGangNodesStaffed(state, gang, prng, events);

    const gangRoutes = Object.values(state.routes).filter(
      (r: RouteServiceState) => r.gangId === gang.id && r.status === 'ACTIVE'
    );

    // 1. Upkeep costs
    const totalUpkeep = 45 + gangRoutes.length * 30;
    gang.cash -= totalUpkeep;

    // 2. Bankruptcy check
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

      for (const r of gangRoutes) {
        r.status = 'CLOSING';
      }
      continue;
    }

    // 3. Establish cross-border route if missing:
    // Rule: "all nodes are owned by a single gang, can only be used by that gang"
    // Rule: "voyages are recruiter-> depot only, not depot->"
    // Rule: "1 route max between nodes"
    const recIds = gang.recruiterLocationIds || [];
    const depotIds = gang.depotLocationIds || [];
    if (gangRoutes.length < recIds.length && recIds.length > 0 && depotIds.length > 0) {
      for (let i = 0; i < recIds.length; i++) {
        const recId = recIds[i];
        const depotId = depotIds[i] || depotIds[0];
        const rec = state.locations[recId];
        const depot = state.locations[depotId];
        if (rec && depot) {
          const existingRoute = Object.values(state.routes).find(
            (r) => r.sourceId === rec.id && r.targetId === depot.id && r.status === 'ACTIVE'
          );

          if (!existingRoute && gang.cash >= 1500) {
            gang.cash -= 1200;
            const routeId = `ROUTE_${gang.id}_${routeSeq++}`;
            const connId = `CONN_${rec.id}_${depot.id}`;
            if (!state.connections[connId]) {
              state.connections[connId] = {
                id: connId,
                sourceId: rec.id,
                targetId: depot.id,
                isCrossBorder: true,
                distance: 300,
                mode: 'SEA',
              };
            }

            state.routes[routeId] = {
              id: routeId,
              gangId: gang.id,
              connectionId: connId,
              sourceId: rec.id,
              targetId: depot.id,
              mode: 'BOAT',
              capacity: 4,
              price: 310,
              durationTicks: 65,
              reliability: 0.98,
              status: 'ACTIVE',
              totalPassengers: 0,
              revenue: 0,
              activeVoyageCount: 0,
            };
            state.stats.totalActiveRoutes++;

            addDecision(
              gang,
              state.tick,
              'REESTABLISH_ROUTE',
              `Restored operational link from ${rec.name} to ${depot.name}.`
            );

            events.push({
              id: `EVT_OPEN_R_${routeId}`,
              tick: state.tick,
              type: 'ROUTE_OPENED',
              description: `${gang.name} restored cross-border route from ${rec.name} to ${depot.name}.`,
              importance: 'MEDIUM',
              gangId: gang.id,
            });
            break;
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

        state.locations[hqId] = {
          id: hqId,
          name: `${synd.name} HQ`,
          region: 'EUROPE',
          x: synd.xOff,
          y: 340,
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ',
          gangId: synd.id,
        };

        state.locations[wsId] = {
          id: wsId,
          name: `${synd.name} Workshop`,
          region: 'EUROPE',
          x: synd.xOff,
          y: 440,
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
          y: 620,
          tileFamily: 'crusher',
          tileVariant: 'mk3',
          kind: 'RECRUITER',
          gangId: synd.id,
        };

        state.locations[depotEurId] = {
          id: depotEurId,
          name: `${synd.name} Europe Depot`,
          region: 'EUROPE',
          x: synd.xOff,
          y: 410,
          tileFamily: 'pressure-tank',
          tileVariant: 'mk1-north',
          kind: 'DEPOT',
          gangId: synd.id,
        };

        state.locations[recEurId] = {
          id: recEurId,
          name: `${synd.name} Europe Recruiter`,
          region: 'EUROPE',
          x: synd.xOff + 40,
          y: 260,
          tileFamily: 'crusher',
          tileVariant: 'mk3',
          kind: 'RECRUITER',
          gangId: synd.id,
        };

        state.locations[depotUkId] = {
          id: depotUkId,
          name: `${synd.name} UK Depot`,
          region: 'UK',
          x: synd.xOff + 40,
          y: 120,
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
          workshopLocationId: wsId,
          recruiterLocationIds: [recAfrId, recEurId],
          depotLocationIds: [depotEurId, depotUkId],
          cash: 18000,
          reputation: 75,
          status: 'ACTIVE',
          recentDecisions: [{ tick: state.tick, action: 'FOUND_GANG', reason: 'Formed complete 3-region network.' }],
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
