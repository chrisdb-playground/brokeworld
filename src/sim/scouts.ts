import type {
  CandidateRouteOpportunity,
  LocationDef,
  LocationKind,
  RegionId,
  SimEvent,
  WorldSnapshot,
} from './types';
import type { SeededPrng } from './rng';
import { isPointInWater } from './influence/geometry';

let candidateNodeSeq = 1;
let candidateRouteSeq = 1;

export function resetScoutSeq(val = 1): void {
  candidateNodeSeq = val;
  candidateRouteSeq = val;
}

const REGION_NODE_NAMES: Record<RegionId, Record<LocationKind, string[]>> = {
  AFRICA: {
    RECRUITER: [
      'Tripoli Coastal Pier Recruiter',
      'Tangier Kasbah Transit Recruiter',
      'Alexandria Delta Recruiter',
      'Benghazi Shoreline Recruiter',
      'Tunis Harbor Recruiter',
      'Algiers Coastal Recruiter',
    ],
    DEPOT: ['Tripoli Supply Depot', 'Alexandria Coastal Depot'],
    WORKSHOP: ['Atlas Transit Workshop'],
    HQ: [
      'Tripoli Safehouse Citadel HQ',
      'Tangier Kasbah Citadel HQ',
      'Alexandria Citadel HQ',
      'Tunis Harbor Citadel HQ',
    ],
  },
  EUROPE: {
    RECRUITER: [
      'Calais Channel Recruiter',
      'Dunkirk Coastal Recruiter',
      'Cherbourg Peninsula Recruiter',
      'Ostend Marine Recruiter',
    ],
    DEPOT: [
      'Marseille Deepwater Depot',
      'Barcelona Coastal Depot',
      'Genoa Port Depot',
      'Rotterdam Canal Depot',
      'Bordeaux River Depot',
    ],
    WORKSHOP: [
      'Rhone Heavy Press Workshop',
      'Pyrenees Transit Workshop',
      'Lombardy Smuggling Fleet Workshop',
      'Ardennes Mechanical Annex',
      'Seine Industrial Press Workshop',
    ],
    HQ: [
      'Marseille Maritime HQ',
      'Rotterdam Safehouse HQ',
      'Lyon Central Command HQ',
      'Barcelona Coastal Safehouse HQ',
    ],
  },
  UK: {
    RECRUITER: ['London Channel Pier Recruiter'],
    DEPOT: [
      'Dover White Cliffs Depot',
      'Thames Estuary Depot',
      'Portsmouth Marine Depot',
      'Folkestone Harbor Depot',
      'Hastings Estuary Depot',
    ],
    WORKSHOP: ['Midlands Smuggling Assembly Workshop'],
    HQ: [
      'Dover Harbour Safehouse HQ',
      'London Thameside Citadel HQ',
      'Portsmouth Solent HQ',
    ],
  },
};

/**
 * Dynamically scouts an area and generates a cluster of 2 to 4 candidate nodes.
 * The gang may purchase these candidate sites for a limited time (180 ticks).
 * If not purchased within that time, the nodes are removed from the world.
 */
export function scoutAreaForNodes(
  state: WorldSnapshot,
  gangId: string,
  prng: SeededPrng,
  targetRegion?: RegionId,
  centerPos?: { x: number; y: number },
  events?: SimEvent[]
): LocationDef[] {
  const gang = state.gangs[gangId];
  if (!gang || gang.status !== 'ACTIVE') return [];

  if (!gang.discoveredNodeIds) {
    gang.discoveredNodeIds = [];
  }

  // 1. Determine target region if not specified
  let region: RegionId = targetRegion || 'EUROPE';
  if (!targetRegion) {
    const ownHqs = (gang.hqLocationIds || []).map((id) => state.locations[id]).filter(Boolean);
    const recCount = (gang.recruiterLocationIds || []).length;
    const depCount = (gang.depotLocationIds || []).length;

    if (recCount === 0) {
      // Need a starting recruiter: 50% Africa, 50% home region
      region = prng.chance(0.5) ? 'AFRICA' : (ownHqs[0]?.region || 'EUROPE');
    } else if (depCount === 0) {
      // Need destination depot: Europe or UK
      const rec = state.locations[gang.recruiterLocationIds![0]];
      region = rec?.region === 'AFRICA' ? 'EUROPE' : 'UK';
    } else {
      // Expand: rotate through regions
      const candidates: RegionId[] = ['AFRICA', 'EUROPE', 'UK'];
      region = prng.pick(candidates);
    }
  }

  // 2. Determine base center X from gang's sector or centerPos
  let baseX = centerPos?.x;
  if (baseX === undefined) {
    const mainHq = gang.mainHqLocationId ? state.locations[gang.mainHqLocationId] : null;
    if (mainHq) {
      baseX = mainHq.x;
    } else if (gangId === 'GANG_NEON_GILL') {
      baseX = 600;
    } else if (gangId === 'GANG_CRIMSON_CLAW') {
      baseX = 2100;
    } else if (gangId === 'GANG_AMBER_FIN') {
      baseX = 3600;
    } else {
      baseX = 1200;
    }
  }

  // 3. Determine bunch size: 2 to 4 nodes
  const bunchSize = prng.nextInt(2, 4);
  const createdNodes: LocationDef[] = [];

  // Available kinds for this region
  const allowedKinds: LocationKind[] =
    region === 'AFRICA'
      ? ['RECRUITER', 'HQ']
      : region === 'UK'
      ? ['DEPOT', 'HQ']
      : ['DEPOT', 'RECRUITER', 'WORKSHOP', 'HQ'];

  const hasHqInRegion = (gang.hqLocationIds || []).some(
    (id) => state.locations[id]?.region === region
  );

  for (let i = 0; i < bunchSize; i++) {
    // If the gang has no HQ in this region, guarantee that the first node is an HQ candidate site
    // so the gang can establish a new Regional HQ and build out a new influence zone!
    const kind = (!hasHqInRegion && i === 0) ? 'HQ' : prng.pick(allowedKinds);
    const namePool = REGION_NODE_NAMES[region][kind] || [`${gang.name} ${region} ${kind}`];
    const baseName = prng.pick(namePool);
    const nodeName = `${baseName} #${candidateNodeSeq}`;

    let tileFamily = 'crusher';
    let tileVariant = 'mk3';
    let cost = 1500;

    if (kind === 'DEPOT') {
      tileFamily = 'pressure-tank';
      tileVariant = 'mk1-north';
      cost = 1200;
    } else if (kind === 'WORKSHOP') {
      tileFamily = 'industrial-press';
      tileVariant = 'mk1-north';
      cost = 2000;
    } else if (kind === 'HQ') {
      tileFamily = 'logistics-hub';
      tileVariant = 'mk1';
      cost = 2200;
    }

    // Determine Y coordinate in valid region band
    let y = 450;
    if (region === 'AFRICA') {
      y = prng.nextInt(920, 1080);
    } else if (region === 'EUROPE') {
      if (kind === 'RECRUITER') {
        y = prng.nextInt(320, 390); // North European coast for Channel crossing
      } else {
        y = prng.nextInt(470, 610); // Central / South Europe
      }
    } else if (region === 'UK') {
      y = prng.nextInt(30, 110);
    }

    // Avoid water
    if (isPointInWater(y)) {
      y = region === 'AFRICA' ? 950 : region === 'UK' ? 70 : 430;
    }

    // Determine X with spread and clearance check
    let x = baseX + prng.nextInt(-220, 220);

    // Clearance check (minimum 80px from any existing location)
    let safe = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const tooClose = Object.values(state.locations).some(
        (loc) => Math.hypot(loc.x - x, loc.y - y) < 80
      );
      if (!tooClose) {
        safe = true;
        break;
      }
      x = baseX + prng.nextInt(-320, 320);
      y += prng.nextInt(-25, 25);
    }

    if (!safe) {
      x += (i + 1) * 95;
    }

    const nodeId = `CAND_NODE_${gangId}_${candidateNodeSeq++}`;
    const candidateNode: LocationDef = {
      id: nodeId,
      name: nodeName,
      region,
      x,
      y,
      tileFamily,
      tileVariant,
      kind,
      gangId: 'NEUTRAL',
      discoveredByGangId: gangId,
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: cost,
      createdAtTick: state.tick,
      expiresAtTick: state.tick + 180, // Dynamic node removed if not purchased within 180 ticks
    };

    state.locations[nodeId] = candidateNode;
    gang.discoveredNodeIds.push(nodeId);
    createdNodes.push(candidateNode);

    if (events) {
      events.push({
        id: `EVT_DISC_${nodeId}_${state.tick}`,
        tick: state.tick,
        type: 'NODE_DISCOVERED',
        description: `Scout chartered candidate site: ${candidateNode.name} (${region}, $${cost}). Available for 180 ticks.`,
        importance: 'MEDIUM',
        gangId,
        locationId: nodeId,
      });
    }
  }

  if (events && createdNodes.length > 0) {
    events.push({
      id: `EVT_SCOUT_AREA_${gangId}_${state.tick}`,
      tick: state.tick,
      type: 'AREA_SCOUTED',
      description: `${gang.name} scout explored ${region} and uncovered ${createdNodes.length} potential node sites! Sites will expire if not leased.`,
      importance: 'HIGH',
      gangId,
    });
  }

  return createdNodes;
}

/**
 * Searches for potential cross-border smuggling routes connecting owned Recruiter and Depot nodes.
 * The gang may purchase/charter these candidate routes for a limited time (180 ticks).
 * If not chartered, the routes expire and are removed.
 */
export function scoutSearchForRoutes(
  state: WorldSnapshot,
  gangId: string,
  prng: SeededPrng,
  events?: SimEvent[]
): CandidateRouteOpportunity[] {
  const gang = state.gangs[gangId];
  if (!gang || gang.status !== 'ACTIVE') return [];

  if (!gang.discoveredCandidateRoutes) {
    gang.discoveredCandidateRoutes = [];
  }
  if (!gang.discoveredRouteIds) {
    gang.discoveredRouteIds = [];
  }

  const gangRecruiters = (gang.recruiterLocationIds || [])
    .map((id) => state.locations[id])
    .filter((loc) => loc && loc.gangId === gang.id && loc.operationalStatus === 'ACTIVE');

  const gangDepots = (gang.depotLocationIds || [])
    .map((id) => state.locations[id])
    .filter((loc) => loc && loc.gangId === gang.id && loc.operationalStatus === 'ACTIVE');

  const discoveredRoutes: CandidateRouteOpportunity[] = [];

  for (const rec of gangRecruiters) {
    for (const depot of gangDepots) {
      // Cross-border corridors: Africa -> Europe, Europe -> UK
      const isCrossBorder =
        (rec.region === 'AFRICA' && depot.region === 'EUROPE') ||
        (rec.region === 'EUROPE' && depot.region === 'UK');

      if (!isCrossBorder) continue;

      const connKey = `CONN__${rec.id}__${depot.id}`;

      // Check if already chartered or already a candidate
      const hasActiveRoute = Object.values(state.routes).some(
        (r) => r.sourceId === rec.id && r.targetId === depot.id && r.gangId === gang.id && r.status === 'ACTIVE'
      );
      const hasCandidateRoute = gang.discoveredCandidateRoutes.some(
        (cr) => cr.sourceId === rec.id && cr.targetId === depot.id
      );

      if (!hasActiveRoute && !hasCandidateRoute) {
        const candRoute: CandidateRouteOpportunity = {
          id: `CAND_ROUTE_${gang.id}_${candidateRouteSeq++}`,
          gangId: gang.id,
          sourceId: rec.id,
          targetId: depot.id,
          charterCost: 1000,
          mode: 'BOAT',
          isCrossBorder: true,
          createdAtTick: state.tick,
          expiresAtTick: state.tick + 180,
        };

        gang.discoveredCandidateRoutes.push(candRoute);
        if (!gang.discoveredRouteIds.includes(connKey)) {
          gang.discoveredRouteIds.push(connKey);
        }
        discoveredRoutes.push(candRoute);

        if (events) {
          events.push({
            id: `EVT_DISC_ROUTE_${candRoute.id}_${state.tick}`,
            tick: state.tick,
            type: 'ROUTE_DISCOVERED',
            description: `Scout charted candidate sea route: ${rec.name} ➔ ${depot.name} ($1,000). Available for 180 ticks.`,
            importance: 'MEDIUM',
            gangId: gang.id,
          });
        }
      }
    }
  }

  if (events && discoveredRoutes.length > 0) {
    events.push({
      id: `EVT_ROUTE_SEARCHED_${gangId}_${state.tick}`,
      tick: state.tick,
      type: 'ROUTE_SEARCHED',
      description: `${gang.name} scouts identified ${discoveredRoutes.length} new smuggling sea corridor(s)!`,
      importance: 'HIGH',
      gangId,
    });
  }

  return discoveredRoutes;
}

/**
 * Checks all unowned candidate nodes and candidate routes.
 * If not purchased before expiresAtTick, the nodes and routes are removed from the world.
 */
export function processCandidateExpirations(
  state: WorldSnapshot,
  events: SimEvent[]
): void {
  // 1. Expire unowned candidate nodes
  for (const loc of Object.values(state.locations)) {
    if (loc.operationalStatus === 'DISCOVERED_CANDIDATE') {
      if (loc.expiresAtTick !== undefined && state.tick >= loc.expiresAtTick) {
        // Node expired without purchase! Clean up waiting migrants and remove it.
        for (const m of Object.values(state.migrants)) {
          if (m.originId === loc.id && (m.status === 'WAITING' || m.status === 'RECRUITED')) {
            m.status = 'DEPARTED';
            state.stats.activeMigrants = Math.max(0, state.stats.activeMigrants - 1);
            state.stats.totalDepartedMigrants++;
          }
        }

        delete state.locations[loc.id];

        // Clean up from all gang discoveredNodeIds
        for (const gang of Object.values(state.gangs)) {
          if (gang.discoveredNodeIds) {
            gang.discoveredNodeIds = gang.discoveredNodeIds.filter((id) => id !== loc.id);
          }
        }

        events.push({
          id: `EVT_EXP_NODE_${loc.id}_${state.tick}`,
          tick: state.tick,
          type: 'NODE_EXPIRED',
          description: `Candidate site '${loc.name}' expired without purchase and closed down.`,
          importance: 'LOW',
          gangId: loc.discoveredByGangId,
          locationId: loc.id,
        });
      }
    }
  }

  // 2. Expire unchartered candidate routes
  for (const gang of Object.values(state.gangs)) {
    if (gang.discoveredCandidateRoutes && gang.discoveredCandidateRoutes.length > 0) {
      const remaining: CandidateRouteOpportunity[] = [];
      for (const cr of gang.discoveredCandidateRoutes) {
        if (state.tick >= cr.expiresAtTick) {
          const src = state.locations[cr.sourceId];
          const tgt = state.locations[cr.targetId];
          const connKey = `CONN__${cr.sourceId}__${cr.targetId}`;

          if (gang.discoveredRouteIds) {
            gang.discoveredRouteIds = gang.discoveredRouteIds.filter((k) => k !== connKey && k !== cr.id);
          }

          events.push({
            id: `EVT_EXP_ROUTE_${cr.id}_${state.tick}`,
            tick: state.tick,
            type: 'ROUTE_EXPIRED',
            description: `Smuggling route opportunity between ${src?.name || 'Recruiter'} and ${tgt?.name || 'Depot'} expired without charter.`,
            importance: 'LOW',
            gangId: gang.id,
          });
        } else {
          remaining.push(cr);
        }
      }
      gang.discoveredCandidateRoutes = remaining;
    }
  }
}

/**
 * Main scout processing loop.
 * Periodically expires unpurchased candidate nodes/routes, and directs active Scout Hoods
 * to dynamically scout areas for nodes and routes.
 */
export function processScouts(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  // Always check expirations every tick to cleanly clean up dead candidate sites
  processCandidateExpirations(state, events);

  // Scouts run active scouting sweeps every 30 ticks
  if (state.tick % 30 !== 0) return;

  const scouts = Object.values(state.hoods).filter((h) => h.role === 'SCOUT');

  for (const scout of scouts) {
    const gang = state.gangs[scout.gangId];
    if (!gang || gang.status !== 'ACTIVE') continue;

    if (!gang.discoveredNodeIds) gang.discoveredNodeIds = [];
    if (!gang.discoveredRouteIds) gang.discoveredRouteIds = [];
    if (!gang.discoveredCandidateRoutes) gang.discoveredCandidateRoutes = [];

    // Filter candidate nodes currently alive for this gang
    const aliveCandidateNodes = gang.discoveredNodeIds
      .map((id) => state.locations[id])
      .filter((l) => l && l.operationalStatus === 'DISCOVERED_CANDIDATE');

    const recCount = (gang.recruiterLocationIds || []).length;
    const depCount = (gang.depotLocationIds || []).length;
    const hasActiveRoutes = Object.values(state.routes).some(
      (r) => r.gangId === gang.id && r.status === 'ACTIVE'
    );

    // Scout logic:
    // 1. If gang has 0 recruiters or 0 depots, scout an area to generate nodes!
    if (aliveCandidateNodes.length < 3 || recCount === 0 || depCount === 0) {
      let targetRegion: RegionId = 'EUROPE';
      if (recCount === 0) {
        // Look for recruiters: home region or Africa
        targetRegion = prng.chance(0.5) ? 'AFRICA' : 'EUROPE';
      } else if (depCount === 0) {
        // Look for depots: Europe or UK
        const rec = state.locations[gang.recruiterLocationIds![0]];
        targetRegion = rec?.region === 'AFRICA' ? 'EUROPE' : 'UK';
      } else {
        // Expand
        targetRegion = prng.pick(['AFRICA', 'EUROPE', 'UK'] as RegionId[]);
      }

      scoutAreaForNodes(state, gang.id, prng, targetRegion, undefined, events);
    }

    // 2. If gang has owned recruiters and depots, search for routes!
    if (recCount > 0 && depCount > 0) {
      scoutSearchForRoutes(state, gang.id, prng, events);
    }
  }
}
