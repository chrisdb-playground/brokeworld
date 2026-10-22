import type { RouteServiceState, SimEvent, VoyageState, WorldSnapshot } from './types';
import type { SeededPrng } from './rng';
import { assignHoodToVoyage, hireHood, releaseHoodFromVoyage } from './hoods';

let voyageSeq = 1;

export function resetVoyageSeq(val = 1) {
  voyageSeq = val;
}

export function establishDepotWorkshopRoutes(
  state: WorldSnapshot,
  events?: SimEvent[]
): void {
  for (const gang of Object.values(state.gangs)) {
    if (gang.status !== 'ACTIVE') continue;

    const gangDepots = Object.values(state.locations).filter(
      (l) => l.gangId === gang.id && l.kind === 'DEPOT'
    );
    const gangWorkshops = Object.values(state.locations).filter(
      (l) => l.gangId === gang.id && l.kind === 'WORKSHOP'
    );

    for (const depot of gangDepots) {
      for (const workshop of gangWorkshops) {
        if (depot.region === workshop.region) {
          const existingRoute = Object.values(state.routes).find(
            (r) => r.sourceId === depot.id && r.targetId === workshop.id && r.status === 'ACTIVE'
          );

          if (!existingRoute) {
            const connId = `CONN_${depot.id}_${workshop.id}`;
            const routeId = `ROUTE_${depot.id}_${workshop.id}`;

            if (!state.connections[connId]) {
              const dx = workshop.x - depot.x;
              const dy = workshop.y - depot.y;
              state.connections[connId] = {
                id: connId,
                sourceId: depot.id,
                targetId: workshop.id,
                isCrossBorder: false,
                distance: Math.max(30, Math.round(Math.hypot(dx, dy))),
                mode: 'LAND',
              };
            }

            state.routes[routeId] = {
              id: routeId,
              gangId: gang.id,
              connectionId: connId,
              sourceId: depot.id,
              targetId: workshop.id,
              mode: 'VAN',
              capacity: 4,
              price: 0,
              durationTicks: 35,
              reliability: 0.99,
              status: 'ACTIVE',
              totalPassengers: 0,
              revenue: 0,
              activeVoyageCount: 0,
            };
            state.stats.totalActiveRoutes++;

            if (events) {
              events.push({
                id: `EVT_OPEN_R_${routeId}`,
                tick: state.tick,
                type: 'ROUTE_OPENED',
                description: `${gang.name} established overland van route from ${depot.name} to ${workshop.name}.`,
                importance: 'MEDIUM',
                gangId: gang.id,
              });
            }
          }
        }
      }
    }
  }
}

export function processVoyages(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  // Ensure all same-region depot-to-workshop routes are active
  establishDepotWorkshopRoutes(state, events);

  // 1. Launch new voyages for routes
  for (const route of Object.values(state.routes)) {
    if (route.status !== 'ACTIVE') continue;

    // Limit concurrent voyages per route service to 2
    if (route.activeVoyageCount >= 2) continue;

    const srcLoc = state.locations[route.sourceId];
    const tgtLoc = state.locations[route.targetId];
    if (!srcLoc || !tgtLoc) continue;

    let manifestPassengers: typeof state.chumigrants[string][] = [];

    if (srcLoc.kind === 'RECRUITER' && tgtLoc.kind === 'DEPOT') {
      // Find recruited chums waiting for this specific route
      const passengers = Object.values(state.chumigrants).filter(
        (c) => c.status === 'RECRUITED' && c.assignedRouteId === route.id
      );

      if (passengers.length === 0) continue;

      // Batch up to route capacity
      manifestPassengers = passengers.slice(0, route.capacity);
    } else if (srcLoc.kind === 'DEPOT' && tgtLoc.kind === 'WORKSHOP') {
      // Find arrived Chumigrants currently residing in this depot
      const chumsInDepot = Object.values(state.chumigrants).filter(
        (c) => c.status === 'ARRIVED' && c.originId === route.sourceId
      );

      if (chumsInDepot.length === 0) continue;

      // Rule: "randomly decided if chumigrants in depot can ben sent to workshop. if yes for a bunch of chumigrants, create a voyage from depot to workshop."
      // Seeded random decision: 20% chance per tick when chums reside in depot
      if (!prng.chance(0.20)) continue;

      // Seeded random batch size for "a bunch of chumigrants" (1 to capacity)
      const bunchSize = prng.nextInt(1, Math.min(chumsInDepot.length, route.capacity));
      const candidates = [...chumsInDepot];
      manifestPassengers = [];
      for (let i = 0; i < bunchSize; i++) {
        const pickedIdx = prng.nextInt(0, candidates.length - 1);
        manifestPassengers.push(candidates.splice(pickedIdx, 1)[0]);
      }
    } else {
      continue;
    }

    if (manifestPassengers.length === 0) continue;

    const passengerIds = manifestPassengers.map((p) => p.id);
    const voyageId = `VOYAGE_${voyageSeq++}`;
    const gang = state.gangs[route.gangId];

    const voyage: VoyageState = {
      id: voyageId,
      gangId: route.gangId,
      routeId: route.id,
      sourceId: route.sourceId,
      targetId: route.targetId,
      mode: route.mode,
      passengerIds,
      startTick: state.tick,
      durationTicks: route.durationTicks,
      progress: 0.0,
      status: 'IN_PROGRESS',
    };

    // Rule: "a gang must employee hood to do anything- run voyages, manage nodes, recruiters, workshops, whatever."
    // Rule: "for now gangs just hire hoods no money for now."
    // Find an idle standby Hood for this gang, or hire a new Hood skipper/driver
    let skipperHood = Object.values(state.hoods).find(
      (h) => h.gangId === route.gangId && h.assignment.type === 'IDLE_HQ'
    );

    if (!skipperHood) {
      skipperHood = hireHood(
        state,
        route.gangId,
        'VOYAGE_SKIPPER',
        { type: 'PILOT_VOYAGE', targetId: voyageId, role: 'VOYAGE_SKIPPER' },
        prng,
        events
      );
    } else {
      assignHoodToVoyage(skipperHood, voyage, state);
    }
    voyage.captainHoodId = skipperHood.id;

    state.voyages[voyageId] = voyage;
    route.activeVoyageCount++;
    if (gang) {
      gang.stats.voyagesLaunched++;
    }
    state.stats.totalVoyagesLaunched++;

    const isVan = route.mode === 'VAN';
    const driverTitle = isVan ? 'Driver' : 'Skipper';
    const voyageType = isVan ? 'van transfer' : 'voyage';

    // Update passengers to IN_TRANSIT
    for (const p of manifestPassengers) {
      p.status = 'IN_TRANSIT';
      p.voyageId = voyageId;
      p.assignedRouteId = route.id;
      p.history.push(
        `[Tick ${state.tick}] Boarded ${route.mode.toLowerCase()} ${voyageType} to ${tgtLoc.name} (${driverTitle}: ${skipperHood.name}).`
      );
    }

    events.push({
      id: `EVT_LAUNCH_${voyageId}`,
      tick: state.tick,
      type: 'VOYAGE_LAUNCHED',
      description: `${gang?.name || 'Gang'} launched ${route.mode.toLowerCase()} ${voyageType} (${passengerIds.length} Chums, ${driverTitle}: ${skipperHood.name}) from ${srcLoc.name} to ${tgtLoc.name}.`,
      importance: 'LOW',
      gangId: route.gangId,
      locationId: route.sourceId,
    });
  }

  // 2. Advance and resolve in-progress voyages
  const activeVoyages = Object.values(state.voyages).filter((v) => v.status === 'IN_PROGRESS');

  for (const voyage of activeVoyages) {
    const elapsed = state.tick - voyage.startTick;
    voyage.progress = Math.min(1.0, elapsed / voyage.durationTicks);

    // Update assigned Hood's current task description with live progress percentage
    if (voyage.captainHoodId && state.hoods[voyage.captainHoodId]) {
      const hood = state.hoods[voyage.captainHoodId];
      const tgt = state.locations[voyage.targetId];
      const pct = Math.round(voyage.progress * 100);
      const isVan = voyage.mode === 'VAN';
      const verb = isVan ? 'Driving' : 'Skippering';
      const destType = tgt?.kind === 'WORKSHOP' ? 'workshop' : 'depot';
      hood.currentTaskDescription = `${verb} ${voyage.mode.toLowerCase()} to ${tgt?.name || destType} (${pct}%)`;
    }

    if (voyage.progress >= 1.0) {
      resolveVoyage(state, voyage, prng, events);
    }
  }
}

function resolveVoyage(
  state: WorldSnapshot,
  voyage: VoyageState,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  const route = state.routes[voyage.routeId];
  const gang = state.gangs[voyage.gangId];
  const targetLoc = state.locations[voyage.targetId];
  const srcLoc = state.locations[voyage.sourceId];
  const isWorkshop = targetLoc?.kind === 'WORKSHOP';
  const isFromDepot = srcLoc?.kind === 'DEPOT';

  // Base failure chance from route reliability (~1% to 3%)
  const baseReliability = route ? route.reliability : 0.98;
  const failureChance = 1 - baseReliability;
  const isFailed = prng.chance(failureChance);

  if (route) {
    route.activeVoyageCount = Math.max(0, route.activeVoyageCount - 1);
  }

  if (!isFailed) {
    // SUCCESS - arrived at target Depot or Workshop!
    voyage.status = 'SUCCESS';
    if (gang) {
      gang.stats.voyagesSuccessful++;
      gang.reputation = Math.min(100, gang.reputation + 1);
    }
    if (route) {
      route.totalPassengers += voyage.passengerIds.length;
    }
    state.stats.totalVoyagesSuccess++;

    for (const pid of voyage.passengerIds) {
      const chum = state.chumigrants[pid];
      if (chum) {
        chum.status = 'ARRIVED';
        chum.originId = voyage.targetId;
        chum.recruitedByGangId = undefined;
        chum.assignedRouteId = undefined;
        chum.voyageId = undefined;

        if (!isWorkshop) {
          // Cross-border Recruiter -> Depot arrival
          state.stats.activeChums--;
          state.stats.totalDepartedChums++;
          chum.history.push(
            `[Tick ${state.tick}] Completed voyage from ${srcLoc?.name || 'recruiter'} and arrived at ${targetLoc?.name || 'depot'} (${targetLoc?.region}). Remaining in depot.`
          );
        } else {
          // Intra-region Depot -> Workshop arrival
          chum.history.push(
            `[Tick ${state.tick}] Completed van transfer from ${srcLoc?.name || 'depot'} and arrived at ${targetLoc?.name || 'workshop'} (${targetLoc?.region}). Assigned to workshop duties.`
          );
        }

        events.push({
          id: `EVT_ARR_${chum.id}_${state.tick}`,
          tick: state.tick,
          type: 'CHUM_ARRIVED',
          description: isWorkshop
            ? `${chum.name} arrived at ${targetLoc?.name || 'workshop'} to start work.`
            : `${chum.name} arrived at ${targetLoc?.name || 'depot'} and settled into the depot.`,
          importance: 'LOW',
          gangId: voyage.gangId,
          locationId: voyage.targetId,
        });
      }
    }

    events.push({
      id: `EVT_SUCC_${voyage.id}`,
      tick: state.tick,
      type: 'VOYAGE_SUCCESS',
      description: isWorkshop
        ? `Van convoy arrived safely at ${targetLoc?.name || 'workshop'} (${voyage.passengerIds.length} Chums delivered to workshop).`
        : `Voyage arrived safely at ${targetLoc?.name || 'depot'} (${voyage.passengerIds.length} Chums safely housed in depot).`,
      importance: 'MEDIUM',
      gangId: voyage.gangId,
      locationId: voyage.targetId,
    });
  } else {
    // DISRUPTED: CANCELLED OR INTERCEPTED
    const isIntercepted = prng.chance(0.6);
    voyage.status = isIntercepted ? 'INTERCEPTED' : 'CANCELLED';

    if (gang) {
      gang.stats.voyagesDisrupted++;
      gang.reputation = Math.max(10, gang.reputation - (isIntercepted ? 8 : 4));
    }
    state.stats.totalVoyagesDisrupted++;

    for (const pid of voyage.passengerIds) {
      const chum = state.chumigrants[pid];
      if (chum) {
        if (isFromDepot) {
          // Depot -> Workshop failure: safely returned to Depot as ARRIVED
          chum.status = 'ARRIVED';
          chum.originId = voyage.sourceId;
          chum.recruitedByGangId = undefined;
          chum.assignedRouteId = undefined;
          chum.voyageId = undefined;
          chum.history.push(
            `[Tick ${state.tick}] Workshop transfer was ${voyage.status.toLowerCase()}! Returned safely to ${srcLoc?.name || 'depot'}.`
          );
        } else {
          // Recruiter -> Depot failure: returned to recruiter as WAITING
          chum.status = 'WAITING';
          chum.recruitedByGangId = undefined;
          chum.assignedRouteId = undefined;
          chum.voyageId = undefined;
          chum.patienceRemainingTicks = Math.max(300, chum.patienceRemainingTicks - 200);
          chum.history.push(
            `[Tick ${state.tick}] Voyage was ${voyage.status.toLowerCase()}! Returned to waiting at ${srcLoc?.name || 'recruiter'}.`
          );
        }
      }
    }

    events.push({
      id: `EVT_DISR_${voyage.id}`,
      tick: state.tick,
      type: 'VOYAGE_DISRUPTED',
      description: isFromDepot
        ? `Van transfer from ${srcLoc?.name || 'depot'} to ${targetLoc?.name || 'workshop'} was ${voyage.status}! Passengers returned to depot.`
        : `Voyage from ${srcLoc?.name || 'recruiter'} to ${targetLoc?.name || 'depot'} was ${voyage.status}! Passengers returned to recruiter.`,
      importance: 'HIGH',
      gangId: voyage.gangId,
      locationId: voyage.sourceId,
    });
  }

  // Release the captain Hood back to HQ standby
  if (voyage.captainHoodId && state.hoods[voyage.captainHoodId]) {
    releaseHoodFromVoyage(state.hoods[voyage.captainHoodId], gang, state);
  }
}
