import type { LocationDef, SimEvent, WorldSnapshot } from './types';
import type { SeededPrng } from './rng';
import { getEffectiveInfluenceHeat } from './influence';

/**
 * Process scouting actions for all active Scout hoods across gangs.
 * Scouts discover candidate nodes within their gang's influence zone
 * and cross-border route opportunities connecting owned recruiters and depots.
 */
export function processScouts(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  // Run scouting check every 30 ticks
  if (state.tick % 30 !== 0) return;

  const scouts = Object.values(state.hoods).filter((h) => h.role === 'SCOUT');

  for (const scout of scouts) {
    const gang = state.gangs[scout.gangId];
    if (!gang || gang.status !== 'ACTIVE') continue;

    if (!gang.discoveredNodeIds) {
      gang.discoveredNodeIds = [];
    }
    if (!gang.discoveredRouteIds) {
      gang.discoveredRouteIds = [];
    }

    // 1. Discover candidate nodes within gang's influence zone
    // Find unowned candidate nodes not yet discovered by this gang
    const candidateNodes = Object.values(state.locations).filter(
      (loc: LocationDef) =>
        loc.operationalStatus === 'DISCOVERED_CANDIDATE' &&
        loc.gangId !== gang.id &&
        !gang.discoveredNodeIds!.includes(loc.id)
    );

    for (const cand of candidateNodes) {
      // Must be in region where gang has presence (or candidate is an HQ for region expansion)
      const heat = getEffectiveInfluenceHeat(state, gang.id, cand.x, cand.y);
      const isEligibleHq = cand.kind === 'HQ'; // HQs can be scouted to expand into other regions

      if (heat >= 0.04 || isEligibleHq) {
        // Scout discovers this candidate node
        gang.discoveredNodeIds.push(cand.id);

        events.push({
          id: `EVT_DISC_NODE_${cand.id}_${gang.id}_${state.tick}`,
          tick: state.tick,
          type: 'NODE_DISCOVERED',
          description: `${scout.name} scouted candidate site: ${cand.name} (${cand.region}, $${cand.candidateCost || 1500}).`,
          importance: 'MEDIUM',
          gangId: gang.id,
          locationId: cand.id,
        });

        // Break after finding one node per scout per cycle to pace discovery
        break;
      }
    }

    // 2. Discover cross-border route corridors
    // If gang owns at least one Recruiter in Region A and one Depot in Region B
    const gangRecruiters = (gang.recruiterLocationIds || [])
      .map((id) => state.locations[id])
      .filter((loc) => loc && loc.gangId === gang.id);

    const gangDepots = (gang.depotLocationIds || [])
      .map((id) => state.locations[id])
      .filter((loc) => loc && loc.gangId === gang.id);

    for (const rec of gangRecruiters) {
      for (const depot of gangDepots) {
        // Cross-border pairs: Africa -> Europe, Europe -> UK
        const isCrossBorderPair =
          (rec.region === 'AFRICA' && depot.region === 'EUROPE') ||
          (rec.region === 'EUROPE' && depot.region === 'UK');

        if (!isCrossBorderPair) continue;

        const connKey = `CONN__${rec.id}__${depot.id}`;
        const hasExistingRoute = Object.values(state.routes).some(
          (r) => r.sourceId === rec.id && r.targetId === depot.id && r.gangId === gang.id
        );

        if (!hasExistingRoute && !gang.discoveredRouteIds.includes(connKey)) {
          // Scout discovers this route opportunity!
          gang.discoveredRouteIds.push(connKey);

          events.push({
            id: `EVT_DISC_ROUTE_${connKey}_${state.tick}`,
            tick: state.tick,
            type: 'ROUTE_DISCOVERED',
            description: `${scout.name} charted sea smuggling route from ${rec.name} to ${depot.name} ($1,200).`,
            importance: 'MEDIUM',
            gangId: gang.id,
          });
          break;
        }
      }
    }
  }
}
