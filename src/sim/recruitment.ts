import type { RouteServiceState, SimEvent, WorldSnapshot } from './types';
import type { SeededPrng } from './rng';

export function processRecruitment(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  const waitingMigrants = Object.values(state.migrants).filter((c) => c.status === 'WAITING');

  for (const migrant of waitingMigrants) {
    // Check patience
    migrant.patienceRemainingTicks -= 1;
    if (migrant.patienceRemainingTicks <= 0) {
      migrant.status = 'DEPARTED';
      state.stats.activeMigrants--;
      state.stats.totalDepartedMigrants++;
      migrant.history.push(`[Tick ${state.tick}] Grew tired of waiting and departed ${state.locations[migrant.originId]?.name || 'recruiter'}.`);
      continue;
    }

    const recNode = state.locations[migrant.originId];
    if (!recNode || recNode.kind !== 'RECRUITER') continue;

    // Rule: "all nodes are owned by a single gang, can only be used by that gang"
    const gang = state.gangs[recNode.gangId];
    if (!gang || gang.status !== 'ACTIVE') continue;

    // Rule: "a gang must employee hood to do anything- run voyages, manage nodes, recruiters, workshops, whatever."
    const managingHoodId = recNode.assignedHoodId;
    const hasManagingHood = managingHoodId && state.hoods[managingHoodId]
      ? state.hoods[managingHoodId].gangId === gang.id
      : Object.values(state.hoods).some(
          (h) => h.gangId === gang.id && h.assignment.type === 'MANAGE_NODE' && h.assignment.targetId === recNode.id
        );
    if (!hasManagingHood) continue;

    // Find the gang's active route from this Recruiter to Depot that moves towards desiredRegion
    const route = Object.values(state.routes).find((r: RouteServiceState) => {
      if (r.gangId !== gang.id || r.sourceId !== recNode.id || r.status !== 'ACTIVE') return false;
      const tgtDepot = state.locations[r.targetId];
      if (!tgtDepot) return false;
      if (tgtDepot.region === migrant.desiredRegion) return true;
      if (migrant.desiredRegion === 'UK' && tgtDepot.region === 'EUROPE') return true;
      return false;
    });

    if (!route) continue;

    if (migrant.cash >= route.price) {
      // Sign up with owning gang
      migrant.status = 'RECRUITED';
      migrant.recruitedByGangId = gang.id;
      migrant.assignedRouteId = route.id;

      migrant.cash -= route.price;
      gang.cash += route.price;
      gang.stats.recruitsTotal++;
      gang.stats.revenueTotal += route.price;
      route.revenue += route.price;

      migrant.avatar.shirtColor = gang.color;

      migrant.history.push(
        `[Tick ${state.tick}] Signed up with ${gang.name} at ${recNode.name} for voyage to ${state.locations[route.targetId]?.name} ($${route.price}).`
      );

      events.push({
        id: `EVT_REC_${migrant.id}_${state.tick}`,
        tick: state.tick,
        type: 'MIGRANT_RECRUITED',
        description: `${migrant.name} signed up with ${gang.name} at ${recNode.name} for $${route.price}.`,
        importance: 'LOW',
        gangId: gang.id,
        locationId: migrant.originId,
      });
    }
  }
}
