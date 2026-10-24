import type { RouteServiceState, SimEvent, WorldSnapshot } from './types';
import type { SeededPrng } from './rng';

/**
 * Accepts a prospect at a recruiter node, collecting their full upfront offer once.
 * Preserves migrant identity and makes them available for voyage assignment.
 */
export function acceptProspect(
  state: WorldSnapshot,
  migrantId: string,
  events?: SimEvent[]
): boolean {
  const migrant = state.migrants[migrantId];
  if (!migrant || (migrant.status !== 'PROSPECT' && migrant.status !== 'WAITING')) {
    return false;
  }

  const recNode = state.locations[migrant.originId];
  if (!recNode || recNode.kind !== 'RECRUITER') return false;

  const gang = state.gangs[recNode.gangId];
  if (!gang || gang.status !== 'ACTIVE') return false;

  // A gang must employ a Hood to manage the node
  const managingHoodId = recNode.assignedHoodId;
  const hasManagingHood = managingHoodId && state.hoods[managingHoodId]
    ? state.hoods[managingHoodId].gangId === gang.id
    : Object.values(state.hoods).some(
        (h) => h.gangId === gang.id && h.assignment.type === 'MANAGE_NODE' && h.assignment.targetId === recNode.id
      );
  if (!hasManagingHood) return false;

  // Upfront payment collected in full once
  const payment = migrant.offer !== undefined ? migrant.offer : (migrant.cash || 1000);
  gang.cash += payment;
  gang.stats.revenueTotal += payment;
  gang.stats.recruitsTotal++;

  migrant.status = 'RECRUITED';
  migrant.recruitedByGangId = gang.id;
  migrant.avatar.shirtColor = gang.color;

  const destLoc = migrant.destinationId ? state.locations[migrant.destinationId] : null;
  const destName = destLoc ? destLoc.name : (migrant.desiredRegion || 'destination');

  migrant.history.push(
    `[Tick ${state.tick}] Accepted as recruit by ${gang.name} at ${recNode.name} with full upfront payment of $${payment} towards ${destName}.`
  );

  if (events) {
    events.push({
      id: `EVT_REC_${migrant.id}_${state.tick}`,
      tick: state.tick,
      type: 'MIGRANT_RECRUITED',
      description: `Prospect ${migrant.name} accepted by ${gang.name} at ${recNode.name} (Upfront offer $${payment} collected in full).`,
      importance: 'LOW',
      gangId: gang.id,
      locationId: recNode.id,
    });
  }

  return true;
}

export function processRecruitment(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  const waitingOrProspects = Object.values(state.migrants).filter(
    (c) => c.status === 'PROSPECT' || c.status === 'WAITING'
  );

  for (const migrant of waitingOrProspects) {
    // Check patience / expiration time
    migrant.patienceRemainingTicks -= 1;
    const isExpired =
      migrant.patienceRemainingTicks <= 0 ||
      (migrant.prospectExpiresTick !== undefined && state.tick >= migrant.prospectExpiresTick);

    if (isExpired) {
      migrant.status = 'DEPARTED';
      state.stats.activeMigrants = Math.max(0, state.stats.activeMigrants - 1);
      state.stats.totalDepartedMigrants++;
      migrant.history.push(
        `[Tick ${state.tick}] Grew tired of waiting and departed ${state.locations[migrant.originId]?.name || 'recruiter'}.`
      );
      events.push({
        id: `EVT_EXP_${migrant.id}_${state.tick}`,
        tick: state.tick,
        type: 'PROSPECT_EXPIRED',
        description: `Prospect ${migrant.name} expired at ${state.locations[migrant.originId]?.name || 'recruiter'} without gang acceptance.`,
        importance: 'LOW',
        locationId: migrant.originId,
      });
      continue;
    }

    const recNode = state.locations[migrant.originId];
    if (!recNode || recNode.kind !== 'RECRUITER') continue;

    const gang = state.gangs[recNode.gangId];
    if (!gang || gang.status !== 'ACTIVE') continue;

    const managingHoodId = recNode.assignedHoodId;
    const hasManagingHood = managingHoodId && state.hoods[managingHoodId]
      ? state.hoods[managingHoodId].gangId === gang.id
      : Object.values(state.hoods).some(
          (h) => h.gangId === gang.id && h.assignment.type === 'MANAGE_NODE' && h.assignment.targetId === recNode.id
        );
    if (!hasManagingHood) continue;

    // Check if gang has active route from this recruiter moving towards desired region
    const matchingRoute = Object.values(state.routes).find((r: RouteServiceState) => {
      if (r.gangId !== gang.id || r.sourceId !== recNode.id || r.status !== 'ACTIVE') return false;
      const tgtDepot = state.locations[r.targetId];
      if (!tgtDepot) return false;
      if (tgtDepot.id === migrant.destinationId) return true;
      if (tgtDepot.region === migrant.desiredRegion) return true;
      if (migrant.desiredRegion === 'UK' && tgtDepot.region === 'EUROPE') return true;
      return false;
    });

    // Backward compatibility for legacy tests with WAITING migrants and explicit route price checks
    if (migrant.status === 'WAITING' && migrant.offer === undefined) {
      if (!matchingRoute) continue;
      if (migrant.cash >= matchingRoute.price) {
        migrant.offer = matchingRoute.price;
        migrant.assignedRouteId = matchingRoute.id;
        matchingRoute.revenue += matchingRoute.price;
        migrant.cash -= matchingRoute.price;
        acceptProspect(state, migrant.id, events);
      }
      continue;
    }

    // Autonomous AI Gang: Accepts prospects if route is operational and gang AI is enabled
    if (matchingRoute && !gang.isAiDisabled) {
      // Don't overwhelm: batch accept up to route capacity + 2
      const alreadyRecruited = Object.values(state.migrants).filter(
        (m) => m.originId === recNode.id && m.status === 'RECRUITED'
      ).length;

      if (alreadyRecruited < (matchingRoute.capacity * 2)) {
        acceptProspect(state, migrant.id, events);
      }
    }
  }
}
