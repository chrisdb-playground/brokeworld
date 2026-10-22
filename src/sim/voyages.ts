import type { RouteServiceState, SimEvent, VoyageState, WorldSnapshot } from './types';
import type { SeededPrng } from './rng';
import { assignHoodToVoyage, hireHood, releaseHoodFromVoyage } from './hoods';

let voyageSeq = 1;

export function resetVoyageSeq(val = 1) {
  voyageSeq = val;
}

export function processVoyages(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  // 1. Launch new voyages for routes with recruited passengers
  for (const route of Object.values(state.routes)) {
    if (route.status !== 'ACTIVE') continue;

    // Limit concurrent voyages per route service to 2
    if (route.activeVoyageCount >= 2) continue;

    // Find recruited chums waiting for this specific route
    const passengers = Object.values(state.chumigrants).filter(
      (c) => c.status === 'RECRUITED' && c.assignedRouteId === route.id
    );

    if (passengers.length === 0) continue;

    // Batch up to route capacity
    const manifestPassengers = passengers.slice(0, route.capacity);
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
    // Find an idle standby Hood for this gang, or hire a new Hood skipper
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

    // Update passengers to IN_TRANSIT
    for (const p of manifestPassengers) {
      p.status = 'IN_TRANSIT';
      p.voyageId = voyageId;
      p.history.push(
        `[Tick ${state.tick}] Boarded ${route.mode.toLowerCase()} on voyage West to ${state.locations[route.targetId]?.name} (Captain: ${skipperHood.name}).`
      );
    }

    events.push({
      id: `EVT_LAUNCH_${voyageId}`,
      tick: state.tick,
      type: 'VOYAGE_LAUNCHED',
      description: `${gang?.name || 'Gang'} launched ${route.mode.toLowerCase()} voyage (${passengerIds.length} Chums, Skipper: ${skipperHood.name}) from ${state.locations[route.sourceId]?.name} to ${state.locations[route.targetId]?.name}.`,
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
      hood.currentTaskDescription = `Skippering ${voyage.mode.toLowerCase()} voyage to ${tgt?.name || 'depot'} (${pct}%)`;
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

  // Base failure chance from route reliability (~2% to 4%)
  const baseReliability = route ? route.reliability : 0.97;
  const failureChance = 1 - baseReliability;
  const isFailed = prng.chance(failureChance);

  if (route) {
    route.activeVoyageCount = Math.max(0, route.activeVoyageCount - 1);
  }

  if (!isFailed) {
    // SUCCESS - arrived at target Depot!
    voyage.status = 'SUCCESS';
    if (gang) {
      gang.stats.voyagesSuccessful++;
      gang.reputation = Math.min(100, gang.reputation + 1);
    }
    if (route) {
      route.totalPassengers += voyage.passengerIds.length;
    }
    state.stats.totalVoyagesSuccess++;

    const targetLoc = state.locations[voyage.targetId];

    for (const pid of voyage.passengerIds) {
      const chum = state.chumigrants[pid];
      if (chum) {
        // Rule: "when a voyage completes the chumigrants remain in the depot, just leave them there"
        chum.status = 'ARRIVED';
        chum.originId = voyage.targetId;
        chum.recruitedByGangId = undefined;
        chum.assignedRouteId = undefined;
        chum.voyageId = undefined;
        state.stats.activeChums--;
        state.stats.totalDepartedChums++;
        chum.history.push(
          `[Tick ${state.tick}] Completed voyage from ${state.locations[voyage.sourceId]?.name || 'recruiter'} and arrived at ${targetLoc?.name || 'depot'} (${targetLoc?.region}). Remaining in depot.`
        );

        events.push({
          id: `EVT_ARR_${chum.id}_${state.tick}`,
          tick: state.tick,
          type: 'CHUM_ARRIVED',
          description: `${chum.name} arrived at ${targetLoc?.name || 'depot'} and settled into the depot.`,
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
      description: `Voyage arrived safely at ${targetLoc?.name || 'depot'} (${voyage.passengerIds.length} Chums safely housed in depot).`,
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

    // Passengers are safely returned to WAITING at source recruiter
    for (const pid of voyage.passengerIds) {
      const chum = state.chumigrants[pid];
      if (chum) {
        chum.status = 'WAITING';
        chum.recruitedByGangId = undefined;
        chum.assignedRouteId = undefined;
        chum.voyageId = undefined;
        chum.patienceRemainingTicks = Math.max(300, chum.patienceRemainingTicks - 200);
        chum.history.push(
          `[Tick ${state.tick}] Voyage was ${voyage.status.toLowerCase()}! Returned to waiting at ${state.locations[voyage.sourceId]?.name}.`
        );
      }
    }

    events.push({
      id: `EVT_DISR_${voyage.id}`,
      tick: state.tick,
      type: 'VOYAGE_DISRUPTED',
      description: `Voyage from ${state.locations[voyage.sourceId]?.name} to ${state.locations[voyage.targetId]?.name} was ${voyage.status}! Passengers returned to recruiter.`,
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
