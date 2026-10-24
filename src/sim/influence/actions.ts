import type {
  LocationDef,
  LocationKind,
  RegionId,
  RouteServiceState,
  SimEvent,
  WorldSnapshot,
} from '../types';
import type { SeededPrng } from '../rng';
import { hireHood } from '../hoods';
import { INITIAL_HQ_INFLUENCE_RADIUS, isPointInRegion } from './geometry';
import { getEffectiveInfluenceHeat } from './queries';

export interface InfluenceCheckResult {
  allowed: boolean;
  cost: number;
  reason?: string;
  heat: number;
}

let purchaseNodeSeq = 1;
let borderRouteSeq = 500;

export function resetPurchaseSeq(val = 1): void {
  purchaseNodeSeq = val;
}

/**
 * Validation check for purchasing a new Regional HQ.
 * Base cost: $4,000.
 */
export function canPurchaseHQ(
  state: WorldSnapshot,
  gangId: string,
  region: RegionId,
  x: number,
  y: number
): InfluenceCheckResult {
  const cost = 4000;
  const gang = state.gangs[gangId];
  if (!gang) {
    return { allowed: false, cost, reason: `Unknown gang ${gangId}`, heat: 0 };
  }
  if (gang.status !== 'ACTIVE') {
    return { allowed: false, cost, reason: `${gang.name} is bankrupt`, heat: 0 };
  }
  if (gang.cash < cost) {
    return {
      allowed: false,
      cost,
      reason: `Insufficient treasury. Requires $${cost}, gang has $${gang.cash}.`,
      heat: 0,
    };
  }

  if (!isPointInRegion(x, y, region)) {
    return {
      allowed: false,
      cost,
      reason: `Coordinates (${x}, ${y}) do not belong to region ${region}.`,
      heat: 0,
    };
  }

  // Minimum distance from existing nodes to prevent overlapping tile geometry
  for (const loc of Object.values(state.locations)) {
    if (Math.hypot(loc.x - x, loc.y - y) < 70) {
      return {
        allowed: false,
        cost,
        reason: `Too close to existing node ${loc.name} (minimum clearance 70px).`,
        heat: 0,
      };
    }
  }

  return { allowed: true, cost, heat: 1.0 };
}

/**
 * Validation check for purchasing an operational node (RECRUITER, DEPOT, WORKSHOP).
 * RULE: "we can only purchase nodes inside the heat map."
 * RULE: "therefore, to acquire nodes in a region we first need to purchase an hq in that region."
 */
export function canPurchaseNode(
  state: WorldSnapshot,
  gangId: string,
  kind: LocationKind,
  region: RegionId,
  x: number,
  y: number
): InfluenceCheckResult {
  const costs: Record<LocationKind, number> = {
    RECRUITER: 2500,
    DEPOT: 2000,
    WORKSHOP: 3500,
    CRIMINAL_ENTERPRISE: 3500,
    HQ: 4000,
  };
  const cost = costs[kind] || 2500;

  if (kind === 'HQ') {
    return canPurchaseHQ(state, gangId, region, x, y);
  }

  const gang = state.gangs[gangId];
  if (!gang) {
    return { allowed: false, cost, reason: `Unknown gang ${gangId}`, heat: 0 };
  }
  if (gang.status !== 'ACTIVE') {
    return { allowed: false, cost, reason: `${gang.name} is bankrupt`, heat: 0 };
  }
  if (gang.cash < cost) {
    return {
      allowed: false,
      cost,
      reason: `Insufficient cash. Requires $${cost}, gang has $${gang.cash}.`,
      heat: 0,
    };
  }

  if (!isPointInRegion(x, y, region)) {
    return {
      allowed: false,
      cost,
      reason: `Coordinates (${x}, ${y}) do not belong to region ${region}.`,
      heat: 0,
    };
  }

  // Regional kind validity checks
  if (kind === 'RECRUITER' && !['AFRICA', 'EUROPE'].includes(region)) {
    return { allowed: false, cost, reason: 'Recruiters can only be built in Africa or Europe.', heat: 0 };
  }
  if (kind === 'DEPOT' && !['EUROPE', 'UK'].includes(region)) {
    return { allowed: false, cost, reason: 'Depots can only be built in Europe or the UK.', heat: 0 };
  }
  if (kind === 'WORKSHOP' && region !== 'EUROPE') {
    return { allowed: false, cost, reason: 'Workshops can only be built in Europe.', heat: 0 };
  }

  // 1. Check if gang has any HQ in this region
  const hasHqInRegion = Object.values(state.locations).some(
    (loc) => loc.gangId === gangId && loc.kind === 'HQ' && loc.region === region
  );
  if (!hasHqInRegion) {
    return {
      allowed: false,
      cost,
      reason: `No gang HQ in ${region}. You must purchase an HQ in ${region} first!`,
      heat: 0,
    };
  }

  // 2. Check effective influence heat at target location
  const heat = getEffectiveInfluenceHeat(state, gangId, x, y);
  if (heat < 0.05) {
    return {
      allowed: false,
      cost,
      reason: `Location is outside ${gang.name}'s influence zone (heat: ${Math.round(heat * 100)}%). Must build inside HQ heat map!`,
      heat,
    };
  }

  // Clearance check
  for (const loc of Object.values(state.locations)) {
    if (Math.hypot(loc.x - x, loc.y - y) < 70) {
      return {
        allowed: false,
        cost,
        reason: `Too close to existing node ${loc.name} (minimum clearance 70px).`,
        heat,
      };
    }
  }

  return { allowed: true, cost, heat };
}

/**
 * Execute purchase of an HQ node.
 */
export function executePurchaseHQ(
  state: WorldSnapshot,
  gangId: string,
  region: RegionId,
  x: number,
  y: number,
  prng: SeededPrng,
  customName?: string,
  events?: SimEvent[]
): LocationDef {
  const check = canPurchaseHQ(state, gangId, region, x, y);
  if (!check.allowed) {
    throw new Error(`Cannot purchase HQ: ${check.reason}`);
  }

  const gang = state.gangs[gangId];
  gang.cash -= check.cost;

  const id = `HQ_${gangId}_${region}_${purchaseNodeSeq++}`;
  const name = customName || `${gang.name} ${region} Branch HQ`;

  const hqLoc: LocationDef = {
    id,
    name,
    region,
    x,
    y,
    tileFamily: 'logistics-hub',
    tileVariant: 'mk1',
    kind: 'HQ',
    gangId,
    isMainHq: false,
  };

  state.locations[id] = hqLoc;

  if (!gang.hqLocationIds) {
    gang.hqLocationIds = gang.hqLocationId ? [gang.hqLocationId] : [];
  }
  if (!gang.hqLocationIds.includes(id)) {
    gang.hqLocationIds.push(id);
  }

  // Register operation
  const opId = `OP_${id}`;
  state.operations[opId] = {
    id: opId,
    gangId,
    locationId: id,
    type: 'HQ',
    status: 'ACTIVE',
    openedTick: state.tick,
  };

  // Assign HQ Boss
  hireHood(
    state,
    gangId,
    'HQ_BOSS',
    { type: 'MANAGE_NODE', targetId: id, role: 'HQ_BOSS' },
    prng,
    events
  );

  const event: SimEvent = {
    id: `EVT_PURCHASE_${id}_${state.tick}`,
    tick: state.tick,
    type: 'OPERATION_OPENED',
    description: `${gang.name} established a new Regional HQ '${name}' in ${region} ($${check.cost}).`,
    importance: 'HIGH',
    gangId,
    locationId: id,
  };

  if (events) {
    events.push(event);
  }

  gang.recentDecisions.push({
    tick: state.tick,
    action: 'PURCHASE_HQ',
    reason: `Established new ${region} Regional HQ at (${x}, ${y}) to project influence.`,
  });

  return hqLoc;
}

/**
 * Execute purchase of an operational node (RECRUITER, DEPOT, WORKSHOP).
 */
export function executePurchaseNode(
  state: WorldSnapshot,
  gangId: string,
  kind: LocationKind,
  region: RegionId,
  x: number,
  y: number,
  prng: SeededPrng,
  customName?: string,
  events?: SimEvent[]
): LocationDef {
  if (kind === 'HQ') {
    return executePurchaseHQ(state, gangId, region, x, y, prng, customName, events);
  }

  const check = canPurchaseNode(state, gangId, kind, region, x, y);
  if (!check.allowed) {
    throw new Error(`Cannot purchase node: ${check.reason}`);
  }

  const gang = state.gangs[gangId];
  gang.cash -= check.cost;

  const id = `${kind}_${gangId}_${purchaseNodeSeq++}`;
  const defaultNames: Record<LocationKind, string> = {
    RECRUITER: `${gang.name} ${region} Recruiter`,
    DEPOT: `${gang.name} ${region} Depot`,
    WORKSHOP: `${gang.name} Workshop Annex`,
    CRIMINAL_ENTERPRISE: `${gang.name} Smuggling Front`,
    HQ: `${gang.name} HQ`,
  };
  const name = customName || defaultNames[kind];

  let tileFamily = 'crusher';
  let tileVariant = 'mk3';
  if (kind === 'DEPOT') {
    tileFamily = 'pressure-tank';
    tileVariant = 'mk1-north';
  } else if (kind === 'WORKSHOP') {
    tileFamily = 'industrial-press';
    tileVariant = 'mk1-north';
  }

  const loc: LocationDef = {
    id,
    name,
    region,
    x,
    y,
    tileFamily,
    tileVariant,
    kind,
    gangId,
  };

  state.locations[id] = loc;

  // Update gang asset registers
  if (kind === 'RECRUITER') {
    if (!gang.recruiterLocationIds) gang.recruiterLocationIds = [];
    gang.recruiterLocationIds.push(id);
  } else if (kind === 'DEPOT') {
    if (!gang.depotLocationIds) gang.depotLocationIds = [];
    gang.depotLocationIds.push(id);
  } else if (kind === 'WORKSHOP') {
    gang.workshopLocationId = id;
  }

  // Register operation
  const opType = kind === 'WORKSHOP' ? 'WORKSHOP' : (kind === 'RECRUITER' ? 'RECRUITER' : 'HQ');
  const opId = `OP_${id}`;
  state.operations[opId] = {
    id: opId,
    gangId,
    locationId: id,
    type: opType,
    status: 'ACTIVE',
    openedTick: state.tick,
  };

  // Staff with appropriate Hood
  if (kind === 'RECRUITER') {
    hireHood(
      state,
      gangId,
      'RECRUITER_MANAGER',
      { type: 'MANAGE_NODE', targetId: id, role: 'RECRUITER_MANAGER' },
      prng,
      events
    );
  } else if (kind === 'DEPOT') {
    hireHood(
      state,
      gangId,
      'DEPOT_GUARD',
      { type: 'MANAGE_NODE', targetId: id, role: 'DEPOT_GUARD' },
      prng,
      events
    );
  } else if (kind === 'WORKSHOP') {
    hireHood(
      state,
      gangId,
      'WORKSHOP_MECHANIC',
      { type: 'MANAGE_NODE', targetId: id, role: 'WORKSHOP_MECHANIC' },
      prng,
      events
    );
  }

  const event: SimEvent = {
    id: `EVT_PURCHASE_${id}_${state.tick}`,
    tick: state.tick,
    type: 'OPERATION_OPENED',
    description: `${gang.name} built ${kind} '${name}' in ${region} ($${check.cost}, Heat: ${Math.round(check.heat * 100)}%).`,
    importance: 'MEDIUM',
    gangId,
    locationId: id,
  };

  if (events) {
    events.push(event);
  }

  gang.recentDecisions.push({
    tick: state.tick,
    action: `PURCHASE_${kind}`,
    reason: `Constructed ${kind} at (${x}, ${y}) within HQ influence zone (${Math.round(check.heat * 100)}% heat).`,
  });

  return loc;
}

/**
 * Validation check for purchasing/claiming an unowned candidate node discovered by scouts.
 * RULE: "it should only be possible to buy nodes inside hq influence zone - unless it is a hq node."
 */
export function canClaimCandidateNode(
  state: WorldSnapshot,
  gangId: string,
  candidateId: string
): InfluenceCheckResult {
  const loc = state.locations[candidateId];
  if (!loc) {
    return { allowed: false, cost: 0, reason: `Candidate node ${candidateId} not found`, heat: 0 };
  }
  const gang = state.gangs[gangId];
  if (!gang) {
    return { allowed: false, cost: 0, reason: `Gang ${gangId} not found`, heat: 0 };
  }
  if (gang.status !== 'ACTIVE') {
    return { allowed: false, cost: 0, reason: `${gang.name} is bankrupt`, heat: 0 };
  }

  const cost = loc.candidateCost || (loc.kind === 'HQ' ? 2200 : (loc.kind === 'WORKSHOP' ? 2000 : (loc.kind === 'DEPOT' ? 1200 : 1500)));
  if (gang.cash < cost) {
    return {
      allowed: false,
      cost,
      reason: `Insufficient funds: requires $${cost}, gang has $${gang.cash}`,
      heat: 0,
    };
  }

  // If candidate is already claimed/owned by someone else
  if (loc.gangId && loc.gangId !== 'NEUTRAL' && loc.operationalStatus !== 'DISCOVERED_CANDIDATE') {
    return {
      allowed: false,
      cost,
      reason: `Site is already owned by ${state.gangs[loc.gangId]?.name || loc.gangId}`,
      heat: 0,
    };
  }

  // If it is an HQ node: allowed anywhere valid (initiates a new HQ influence zone)
  if (loc.kind === 'HQ') {
    return { allowed: true, cost, heat: 1.0 };
  }

  // Unless it is an HQ node, it can ONLY be bought inside the gang's HQ influence zone!
  // 1. Must have an HQ in the candidate's region
  const hasHqInRegion = Object.values(state.locations).some(
    (l) => l.gangId === gangId && l.kind === 'HQ' && l.region === loc.region
  );
  if (!hasHqInRegion) {
    return {
      allowed: false,
      cost,
      reason: `No gang HQ in ${loc.region}. You must purchase an HQ in ${loc.region} first!`,
      heat: 0,
    };
  }

  // 2. Must be inside the HQ influence zone (effective heat >= 0.05)
  const heat = getEffectiveInfluenceHeat(state, gangId, loc.x, loc.y);
  if (heat < 0.05) {
    return {
      allowed: false,
      cost,
      reason: `Location is outside ${gang.name}'s HQ influence zone (${Math.round(heat * 100)}% heat). Establish or expand an HQ nearby first!`,
      heat,
    };
  }

  return { allowed: true, cost, heat };
}

/**
 * Claim an unowned candidate node that has been scouted.
 * RULE: "it should only be possible to buy nodes inside hq influence zone - unless it is a hq node."
 */
export function executeClaimCandidateNode(
  state: WorldSnapshot,
  gangId: string,
  candidateId: string,
  prng: SeededPrng,
  events?: SimEvent[],
  bypassInfluenceCheck = false
): LocationDef {
  const loc = state.locations[candidateId];
  if (!loc) throw new Error(`Candidate node ${candidateId} not found`);
  const gang = state.gangs[gangId];
  if (!gang) throw new Error(`Gang ${gangId} not found`);

  if (!bypassInfluenceCheck) {
    const check = canClaimCandidateNode(state, gangId, candidateId);
    if (!check.allowed) {
      throw new Error(`Cannot claim node: ${check.reason}`);
    }
  }

  const cost = loc.candidateCost || (loc.kind === 'HQ' ? 2200 : (loc.kind === 'WORKSHOP' ? 2000 : (loc.kind === 'DEPOT' ? 1200 : 1500)));
  if (gang.cash < cost) throw new Error(`Insufficient funds: need $${cost}, has $${gang.cash}`);

  gang.cash -= cost;
  loc.gangId = gangId;
  loc.operationalStatus = 'ACTIVE';
  delete loc.expiresAtTick;

  if (loc.kind === 'HQ') {
    if (!gang.hqLocationIds) gang.hqLocationIds = gang.hqLocationId ? [gang.hqLocationId] : [];
    if (!gang.hqLocationIds.includes(loc.id)) gang.hqLocationIds.push(loc.id);
    loc.influenceRadius = INITIAL_HQ_INFLUENCE_RADIUS;
    hireHood(state, gangId, 'HQ_BOSS', { type: 'MANAGE_NODE', targetId: loc.id, role: 'HQ_BOSS' }, prng, events);
  } else if (loc.kind === 'RECRUITER') {
    if (!gang.recruiterLocationIds) gang.recruiterLocationIds = [];
    if (!gang.recruiterLocationIds.includes(loc.id)) gang.recruiterLocationIds.push(loc.id);
    hireHood(state, gangId, 'RECRUITER_MANAGER', { type: 'MANAGE_NODE', targetId: loc.id, role: 'RECRUITER_MANAGER' }, prng, events);
  } else if (loc.kind === 'DEPOT') {
    if (!gang.depotLocationIds) gang.depotLocationIds = [];
    if (!gang.depotLocationIds.includes(loc.id)) gang.depotLocationIds.push(loc.id);
    hireHood(state, gangId, 'DEPOT_GUARD', { type: 'MANAGE_NODE', targetId: loc.id, role: 'DEPOT_GUARD' }, prng, events);
  } else if (loc.kind === 'WORKSHOP') {
    gang.workshopLocationId = loc.id;
    hireHood(state, gangId, 'WORKSHOP_MECHANIC', { type: 'MANAGE_NODE', targetId: loc.id, role: 'WORKSHOP_MECHANIC' }, prng, events);
  }

  // Remove from discovered lists
  if (gang.discoveredNodeIds) {
    gang.discoveredNodeIds = gang.discoveredNodeIds.filter((id) => id !== loc.id);
  }

  const opId = `OP_${loc.id}`;
  state.operations[opId] = {
    id: opId,
    gangId,
    locationId: loc.id,
    type: loc.kind === 'WORKSHOP' ? 'WORKSHOP' : (loc.kind === 'RECRUITER' ? 'RECRUITER' : 'HQ'),
    status: 'ACTIVE',
    openedTick: state.tick,
  };

  if (events) {
    events.push({
      id: `EVT_PURCHASE_NODE_${loc.id}_${state.tick}`,
      tick: state.tick,
      type: 'NODE_PURCHASED',
      description: `${gang.name} acquired candidate node ${loc.name} (${loc.region}) for $${cost}.`,
      importance: 'MEDIUM',
      gangId,
      locationId: loc.id,
    });
  }

  return loc;
}

export function canPurchaseBorderRoute(
  state: WorldSnapshot,
  gangId: string,
  sourceRecruiterId: string,
  targetDepotId: string
): InfluenceCheckResult {
  const cost = 1000;
  const gang = state.gangs[gangId];
  if (!gang || gang.status !== 'ACTIVE') {
    return { allowed: false, cost, reason: 'Gang is not active', heat: 0 };
  }
  if (gang.cash < cost) {
    return { allowed: false, cost, reason: `Insufficient cash ($${gang.cash} < $${cost})`, heat: 0 };
  }

  const src = state.locations[sourceRecruiterId];
  const tgt = state.locations[targetDepotId];
  if (!src || !tgt) {
    return { allowed: false, cost, reason: 'Source or target node not found', heat: 0 };
  }
  if (src.gangId !== gangId || tgt.gangId !== gangId) {
    return { allowed: false, cost, reason: 'Both nodes must be owned by the gang', heat: 0 };
  }
  if (src.region === tgt.region) {
    return { allowed: false, cost: 0, reason: 'Intra-region routes are automatic and free', heat: 1 };
  }

  const existing = Object.values(state.routes).find(
    (r) => r.sourceId === src.id && r.targetId === tgt.id && r.gangId === gangId && r.status === 'ACTIVE'
  );
  if (existing) {
    return { allowed: false, cost, reason: 'Route already active', heat: 1 };
  }

  return { allowed: true, cost, heat: 1.0 };
}

export function executePurchaseBorderRoute(
  state: WorldSnapshot,
  gangId: string,
  sourceRecruiterId: string,
  targetDepotId: string,
  prng: SeededPrng,
  events?: SimEvent[]
): RouteServiceState {
  const check = canPurchaseBorderRoute(state, gangId, sourceRecruiterId, targetDepotId);
  if (!check.allowed) {
    throw new Error(`Cannot purchase border route: ${check.reason}`);
  }

  const gang = state.gangs[gangId];
  gang.cash -= check.cost;

  const src = state.locations[sourceRecruiterId];
  const tgt = state.locations[targetDepotId];
  const connId = `CONN_${src.id}_${tgt.id}`;
  const connKey = `CONN__${src.id}__${tgt.id}`;
  const routeId = `ROUTE_${gang.id}_${borderRouteSeq++}`;

  if (!state.connections[connId]) {
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    state.connections[connId] = {
      id: connId,
      sourceId: src.id,
      targetId: tgt.id,
      isCrossBorder: true,
      distance: Math.max(100, Math.round(Math.hypot(dx, dy))),
      mode: 'SEA',
    };
  }

  // Hire and assign a dedicated Voyage Skipper for this border route
  const skipper = hireHood(
    state,
    gangId,
    'VOYAGE_SKIPPER',
    { type: 'IDLE_HQ', targetId: gang.mainHqLocationId || gang.hqLocationId, role: 'VOYAGE_SKIPPER' },
    prng,
    events
  );

  const route: RouteServiceState = {
    id: routeId,
    gangId,
    connectionId: connId,
    sourceId: src.id,
    targetId: tgt.id,
    mode: 'BOAT',
    isCrossBorder: true,
    assignedSkipperHoodId: skipper.id,
    operationalStatus: 'ACTIVE',
    capacity: 4,
    price: 280,
    durationTicks: 45,
    reliability: 0.98,
    status: 'ACTIVE',
    totalPassengers: 0,
    revenue: 0,
    activeVoyageCount: 0,
  };

  state.routes[routeId] = route;
  state.stats.totalActiveRoutes++;

  // Remove from discoveredRouteIds and discoveredCandidateRoutes
  if (gang.discoveredRouteIds) {
    gang.discoveredRouteIds = gang.discoveredRouteIds.filter((k) => k !== connId && k !== connKey);
  }
  if (gang.discoveredCandidateRoutes) {
    gang.discoveredCandidateRoutes = gang.discoveredCandidateRoutes.filter(
      (cr) => !(cr.sourceId === src.id && cr.targetId === tgt.id)
    );
  }

  if (events) {
    events.push({
      id: `EVT_PURCHASE_ROUTE_${routeId}_${state.tick}`,
      tick: state.tick,
      type: 'ROUTE_PURCHASED',
      description: `${gang.name} chartered cross-border smuggling route from ${src.name} to ${tgt.name} ($${check.cost}, Skipper: ${skipper.name}).`,
      importance: 'HIGH',
      gangId,
    });
  }

  return route;
}
