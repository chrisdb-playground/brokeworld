import type { RouteServiceState, SimEvent, WorldSnapshot } from './types';
import type { SeededPrng } from './rng';

export function processRecruitment(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  const waitingChums = Object.values(state.chumigrants).filter((c) => c.status === 'WAITING');

  for (const chum of waitingChums) {
    // Check patience
    chum.patienceRemainingTicks -= 1;
    if (chum.patienceRemainingTicks <= 0) {
      chum.status = 'DEPARTED';
      state.stats.activeChums--;
      state.stats.totalDepartedChums++;
      chum.history.push(`[Tick ${state.tick}] Grew tired of waiting and departed ${state.locations[chum.originId]?.name || 'recruiter'}.`);
      continue;
    }

    const recNode = state.locations[chum.originId];
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
      if (tgtDepot.region === chum.desiredRegion) return true;
      if (chum.desiredRegion === 'UK' && tgtDepot.region === 'EUROPE') return true;
      return false;
    });

    if (!route) continue;

    if (chum.cash >= route.price) {
      // Sign up with owning gang
      chum.status = 'RECRUITED';
      chum.recruitedByGangId = gang.id;
      chum.assignedRouteId = route.id;

      chum.cash -= route.price;
      gang.cash += route.price;
      gang.stats.recruitsTotal++;
      gang.stats.revenueTotal += route.price;
      route.revenue += route.price;

      chum.avatar.shirtColor = gang.color;

      chum.history.push(
        `[Tick ${state.tick}] Signed up with ${gang.name} at ${recNode.name} for voyage to ${state.locations[route.targetId]?.name} ($${route.price}).`
      );

      events.push({
        id: `EVT_REC_${chum.id}_${state.tick}`,
        tick: state.tick,
        type: 'CHUM_RECRUITED',
        description: `${chum.name} signed up with ${gang.name} at ${recNode.name} for $${route.price}.`,
        importance: 'LOW',
        gangId: gang.id,
        locationId: chum.originId,
      });
    }
  }
}
