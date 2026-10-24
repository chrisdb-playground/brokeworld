import type { RouteServiceState, SimEvent, VoyageState, WorldSnapshot } from './types';
import type { SeededPrng } from './rng';
import { assignHoodToVoyage, hireHood, releaseHoodFromVoyage } from './hoods';
import { BALANCE } from './balance';
import { updateRecruiterReputation } from './reputation';

let voyageSeq = 1;

export function resetVoyageSeq(val = 1) {
  voyageSeq = val;
}

/**
 * Establishes intra-region overland van routes for gangs:
 * 1. Depot -> Workshop (for employment)
 * 2. Depot -> Recruiter (for multi-hop transfers to next border crossing)
 */
export function establishDepotTransferRoutes(
  state: WorldSnapshot,
  events?: SimEvent[]
): void {
  for (const gang of Object.values(state.gangs)) {
    if (gang.status !== 'ACTIVE') continue;

    const gangDepots = Object.values(state.locations).filter(
      (l) => l.gangId === gang.id && l.kind === 'DEPOT'
    );
    const gangWorkshops = Object.values(state.locations).filter(
      (l) => l.gangId === gang.id && (l.kind === 'WORKSHOP' || l.kind === 'CRIMINAL_ENTERPRISE')
    );

    // Depot -> Workshop routes
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

// Retain alias for existing imports
export const establishDepotWorkshopRoutes = establishDepotTransferRoutes;

export function processVoyages(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  // Ensure all same-region depot-to-workshop and depot-to-recruiter routes are active
  establishDepotTransferRoutes(state, events);

  // 1. Launch new voyages for routes
  for (const route of Object.values(state.routes)) {
    if (route.status !== 'ACTIVE') continue;

    // Limit concurrent voyages per route service to 2
    if (route.activeVoyageCount >= 2) continue;

    const srcLoc = state.locations[route.sourceId];
    const tgtLoc = state.locations[route.targetId];
    if (!srcLoc || !tgtLoc) continue;

    // Node staffing check: both nodes must have an assigned active Hood
    if (!srcLoc.assignedHoodId || !state.hoods[srcLoc.assignedHoodId]) continue;
    if (!tgtLoc.assignedHoodId || !state.hoods[tgtLoc.assignedHoodId]) continue;

    // Cross-border route staffing check: must have an assigned skipper
    if (route.isCrossBorder) {
      if (!route.assignedSkipperHoodId || !state.hoods[route.assignedSkipperHoodId]) {
        continue;
      }
    }

    let manifestPassengers: typeof state.migrants[string][] = [];

    if (srcLoc.kind === 'RECRUITER' && tgtLoc.kind === 'DEPOT') {
      // Find recruited migrants waiting for this specific route or heading toward target depot/region
      const passengers = Object.values(state.migrants).filter((c) => {
        if (c.status !== 'RECRUITED') return false;
        if (c.originId !== srcLoc.id) return false;
        if (c.assignedRouteId && c.assignedRouteId === route.id) return true;
        // Check route suitability: destination matches target depot or destination region matches
        if (c.destinationId === tgtLoc.id) return true;
        if (tgtLoc.region === c.desiredRegion) return true;
        if (c.desiredRegion === 'UK' && tgtLoc.region === 'EUROPE') return true;
        return false;
      });

      if (passengers.length === 0) continue;

      // Batch up to route capacity
      manifestPassengers = passengers.slice(0, route.capacity);
    } else if (srcLoc.kind === 'DEPOT' && (tgtLoc.kind === 'WORKSHOP' || tgtLoc.kind === 'CRIMINAL_ENTERPRISE')) {
      // Find arrived Migrants currently residing in this depot seeking work or assignment
      const migrantsInDepot = Object.values(state.migrants).filter(
        (c) => (c.status === 'AT_DEPOT' || c.status === 'ARRIVED') && c.originId === route.sourceId
      );

      if (migrantsInDepot.length === 0) continue;

      // Prioritize migrants whose goal is WORK or CRIME
      const goalMatched = migrantsInDepot.filter((c) => c.goal === 'WORK' || c.goal === 'CRIME');
      const candidates = goalMatched.length > 0 ? goalMatched : migrantsInDepot;

      if (!prng.chance(0.20)) continue;

      const bunchSize = prng.nextInt(1, Math.min(candidates.length, route.capacity));
      const pool = [...candidates];
      manifestPassengers = [];
      for (let i = 0; i < bunchSize; i++) {
        const pickedIdx = prng.nextInt(0, pool.length - 1);
        manifestPassengers.push(pool.splice(pickedIdx, 1)[0]);
      }
    } else if (srcLoc.kind === 'DEPOT' && tgtLoc.kind === 'RECRUITER') {
      // Multi-hop transfer: Migrants in intermediate depot needing to reach next recruiter
      const migrantsInDepot = Object.values(state.migrants).filter(
        (c) => (c.status === 'AT_DEPOT' || c.status === 'ARRIVED') && c.originId === route.sourceId && !c.destinationReached
      );

      if (migrantsInDepot.length === 0) continue;

      // Filter migrants whose desired destination requires this recruiter (e.g. UK destination from Europe recruiter)
      const needingTransfer = migrantsInDepot.filter((c) => {
        if (c.destinationReached) return false;
        if (c.desiredRegion === 'UK' && tgtLoc.region === 'EUROPE') return true;
        if (c.destinationRegion && c.destinationRegion !== srcLoc.region) return true;
        return false;
      });

      if (needingTransfer.length === 0) continue;

      const bunchSize = Math.min(needingTransfer.length, route.capacity);
      manifestPassengers = needingTransfer.slice(0, bunchSize);
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

    // Staff voyage with Hood skipper / driver
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

    // Update passengers to TRAVELLING / IN_TRANSIT
    for (const p of manifestPassengers) {
      p.status = 'TRAVELLING';
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
      description: `${gang?.name || 'Gang'} launched ${route.mode.toLowerCase()} ${voyageType} (${passengerIds.length} Migrants, ${driverTitle}: ${skipperHood.name}) from ${srcLoc.name} to ${tgtLoc.name}.`,
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
      const destType = tgt?.kind === 'WORKSHOP' ? 'workshop' : tgt?.kind === 'RECRUITER' ? 'recruiter' : 'depot';
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
  const isWorkshop = targetLoc?.kind === 'WORKSHOP' || targetLoc?.kind === 'CRIMINAL_ENTERPRISE';
  const isRecruiterTransfer = targetLoc?.kind === 'RECRUITER';
  const isFromDepot = srcLoc?.kind === 'DEPOT';

  // Base failure chance from route reliability (~1% to 3%)
  const baseReliability = route ? route.reliability : 0.98;
  const failureChance = 1 - baseReliability;
  const isFailed = prng.chance(failureChance);

  if (route) {
    route.activeVoyageCount = Math.max(0, route.activeVoyageCount - 1);
  }

  if (!isFailed) {
    // SUCCESS - arrived at target Depot, Recruiter, or Workshop!
    voyage.status = 'SUCCESS';
    const payoutPerPassenger = isWorkshop ? 120 : (isRecruiterTransfer ? 0 : 380);
    const totalPayout = voyage.passengerIds.length * payoutPerPassenger;

    if (gang && totalPayout > 0) {
      gang.cash += totalPayout;
      gang.stats.revenueTotal += totalPayout;
      gang.stats.voyagesSuccessful++;
      gang.reputation = Math.min(100, gang.reputation + 1);

      // Successful voyage expands HQ influence in source and target regions
      for (const loc of Object.values(state.locations)) {
        if (loc.gangId === gang.id && loc.kind === 'HQ') {
          if (loc.region === srcLoc?.region || loc.region === targetLoc?.region) {
            loc.influenceRadius = Math.min(320, (loc.influenceRadius || 140) + 5);
          }
        }
      }
    } else if (gang) {
      gang.stats.voyagesSuccessful++;
    }

    if (route) {
      route.totalPassengers += voyage.passengerIds.length;
      route.revenue += totalPayout;
    }
    state.stats.totalVoyagesSuccess++;

    for (const pid of voyage.passengerIds) {
      const migrant = state.migrants[pid];
      if (!migrant) continue;

      migrant.assignedRouteId = undefined;
      migrant.voyageId = undefined;

      if (isRecruiterTransfer) {
        // Arrived at intermediate recruiter for continuation voyage (no second payment!)
        migrant.status = 'RECRUITED';
        migrant.originId = voyage.targetId;
        migrant.happiness = Math.min(100, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_PROGRESS_HOP);
        migrant.history.push(
          `[Tick ${state.tick}] Completed van transfer from ${srcLoc?.name || 'depot'} to ${targetLoc?.name || 'recruiter'}. Registered as recruit for onward journey.`
        );

        events.push({
          id: `EVT_ARR_REC_${migrant.id}_${state.tick}`,
          tick: state.tick,
          type: 'MIGRANT_TRANSFERRED',
          description: `${migrant.name} arrived at ${targetLoc?.name || 'recruiter'} ready for next voyage.`,
          importance: 'LOW',
          gangId: voyage.gangId,
          locationId: voyage.targetId,
        });
      } else if (isWorkshop) {
        // Arrived at Workshop or Criminal Enterprise
        migrant.status = 'ARRIVED';
        migrant.originId = voyage.targetId;

        const isDestReached = migrant.destinationReached || migrant.destinationId === targetLoc.id || targetLoc.region === migrant.destinationRegion;

        if (isDestReached && (migrant.goal === 'WORK' || (targetLoc.kind === 'CRIMINAL_ENTERPRISE' && migrant.goal === 'CRIME'))) {
          migrant.destinationReached = true;
          migrant.goalFulfilled = true;
          migrant.happiness = Math.min(100, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_GOAL_FULFILLED);
          updateRecruiterReputation(state, migrant.originRecruiterId, BALANCE.REP_DELTA_GOAL_FULFILLED, events, 'Arrived at destination and fulfilled employment goal');
          migrant.history.push(`[Tick ${state.tick}] Delivered to ${targetLoc.name} (${targetLoc.region}). Goal ${migrant.goal} successfully fulfilled.`);
        } else {
          migrant.happiness = Math.max(0, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_MISMATCH_ASSIGNMENT);
          migrant.history.push(`[Tick ${state.tick}] Delivered to ${targetLoc.name}. Assigned contrary to desired goal or before destination.`);
        }

        events.push({
          id: `EVT_ARR_WS_${migrant.id}_${state.tick}`,
          tick: state.tick,
          type: 'MIGRANT_ARRIVED',
          description: `${migrant.name} arrived at ${targetLoc?.name || 'workshop'} to start work (Goal fulfilled: ${migrant.goalFulfilled ? 'YES' : 'NO'}).`,
          importance: 'LOW',
          gangId: voyage.gangId,
          locationId: voyage.targetId,
        });
      } else {
        // Arrived at Depot
        migrant.status = 'ARRIVED';
        migrant.originId = voyage.targetId;
        state.stats.activeMigrants = Math.max(0, state.stats.activeMigrants - 1);
        state.stats.totalDepartedMigrants++;

        // Check if migrant reached their specified destination
        const isFinal = migrant.destinationId === targetLoc.id || (targetLoc.region === migrant.destinationRegion && (migrant.destinationId === targetLoc.id || !state.locations[migrant.destinationId || '']));

        if (isFinal) {
          migrant.destinationReached = true;
          migrant.happiness = Math.min(100, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_DESTINATION_REACHED);
          migrant.history.push(
            `[Tick ${state.tick}] Reached final destination depot ${targetLoc.name} (${targetLoc.region}). Awaiting goal fulfillment or release.`
          );
        } else {
          // Intermediate depot arrival!
          migrant.destinationReached = false;
          migrant.happiness = Math.min(100, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_PROGRESS_HOP);
          migrant.history.push(
            `[Tick ${state.tick}] Reached intermediate depot ${targetLoc.name} (${targetLoc.region}). Continuing onward journey.`
          );
        }

        events.push({
          id: `EVT_ARR_${migrant.id}_${state.tick}`,
          tick: state.tick,
          type: 'MIGRANT_ARRIVED',
          description: `${migrant.name} arrived at ${targetLoc?.name || 'depot'} (Destination reached: ${migrant.destinationReached ? 'YES' : 'NO'}).`,
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
        ? `Van convoy arrived safely at ${targetLoc?.name || 'workshop'} (${voyage.passengerIds.length} Migrants delivered).`
        : isRecruiterTransfer
        ? `Overland transfer arrived safely at ${targetLoc?.name || 'recruiter'} (${voyage.passengerIds.length} Migrants forwarded).`
        : `Voyage arrived safely at ${targetLoc?.name || 'depot'} (${voyage.passengerIds.length} Migrants safely housed in depot).`,
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
      const migrant = state.migrants[pid];
      if (!migrant) continue;

      migrant.assignedRouteId = undefined;
      migrant.voyageId = undefined;
      migrant.happiness = Math.max(0, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_VOYAGE_DISRUPTED);

      if (isFromDepot) {
        // Returned safely to Depot as AT_DEPOT
        migrant.status = 'AT_DEPOT';
        migrant.originId = voyage.sourceId;
        migrant.history.push(
          `[Tick ${state.tick}] Transfer was ${voyage.status.toLowerCase()}! Returned safely to ${srcLoc?.name || 'depot'}.`
        );
      } else {
        // Returned to recruiter as RECRUITED
        migrant.status = 'RECRUITED';
        migrant.originId = voyage.sourceId;
        migrant.patienceRemainingTicks = Math.max(300, migrant.patienceRemainingTicks - 200);
        migrant.history.push(
          `[Tick ${state.tick}] Voyage was ${voyage.status.toLowerCase()}! Returned to waiting at ${srcLoc?.name || 'recruiter'}.`
        );
      }
    }

    events.push({
      id: `EVT_DISR_${voyage.id}`,
      tick: state.tick,
      type: 'VOYAGE_DISRUPTED',
      description: isFromDepot
        ? `Van transfer from ${srcLoc?.name || 'depot'} to ${targetLoc?.name || 'node'} was ${voyage.status}! Passengers returned to depot.`
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
