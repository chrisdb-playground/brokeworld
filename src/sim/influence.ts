import type {
  LocationDef,
  LocationKind,
  RegionId,
  SimEvent,
  WorldSnapshot,
} from './types';
import type { SeededPrng } from './rng';
import { hireHood } from './hoods';

export const REGION_BOUNDS: Record<RegionId, { yMin: number; yMax: number }> = {
  UK: { yMin: -100, yMax: 205 },
  EUROPE: { yMin: 205, yMax: 505 },
  AFRICA: { yMin: 505, yMax: 800 },
};

export const BASE_HQ_INFLUENCE_RADIUS = 260; // Base influence radius in px
export const RIVAL_RESTRICTION_FACTOR = 0.65; // Overlap damping: allows slight overlap buffer between rival HQs

export interface InfluenceCheckResult {
  allowed: boolean;
  cost: number;
  reason?: string;
  heat: number;
}

export function getRegionForY(y: number): RegionId | null {
  if (y >= REGION_BOUNDS.UK.yMin && y < REGION_BOUNDS.UK.yMax) {
    return 'UK';
  }
  if (y >= REGION_BOUNDS.EUROPE.yMin && y < REGION_BOUNDS.EUROPE.yMax) {
    return 'EUROPE';
  }
  if (y >= REGION_BOUNDS.AFRICA.yMin && y <= REGION_BOUNDS.AFRICA.yMax) {
    return 'AFRICA';
  }
  return null;
}

export function isPointInRegion(x: number, y: number, region: RegionId): boolean {
  const bounds = REGION_BOUNDS[region];
  if (!bounds) return false;
  return y >= bounds.yMin && y <= bounds.yMax;
}

/**
 * Raw Euclidean distance-based falloff from an HQ center.
 * Dissipates linearly from 1.0 at center to 0.0 at radius.
 */
export function getRawHqHeat(
  hqX: number,
  hqY: number,
  x: number,
  y: number,
  radius = BASE_HQ_INFLUENCE_RADIUS
): number {
  const dx = x - hqX;
  const dy = y - hqY;
  const dist = Math.hypot(dx, dy);
  if (dist >= radius) return 0;
  return 1 - dist / radius;
}

/**
 * Returns raw influence of a gang in a specific region at point (x, y).
 * RULE: "heat map stops at border."
 * If point (x, y) is not in the specified region, influence is strictly 0.
 */
export function getRawGangInfluenceInRegion(
  state: WorldSnapshot,
  gangId: string,
  region: RegionId,
  x: number,
  y: number,
  radius = BASE_HQ_INFLUENCE_RADIUS
): number {
  if (!isPointInRegion(x, y, region)) {
    return 0;
  }

  // Find all HQs for this gang in this region
  let maxRawHeat = 0;
  for (const loc of Object.values(state.locations)) {
    if (loc.gangId === gangId && loc.kind === 'HQ' && loc.region === region) {
      const h = getRawHqHeat(loc.x, loc.y, x, y, radius);
      if (h > maxRawHeat) {
        maxRawHeat = h;
      }
    }
  }

  return maxRawHeat;
}

/**
 * Computes effective influence heat of a gang at (x, y), factoring in:
 * 1. Region border cutoff (heat map strictly stops at border)
 * 2. Distance dissipation from HQ
 * 3. Rival restriction with slight overlap:
 *    "rival gangs hq influence zones restrict each other but they can overlap slightly."
 */
export function getEffectiveInfluenceHeat(
  state: WorldSnapshot,
  gangId: string,
  x: number,
  y: number,
  radius = BASE_HQ_INFLUENCE_RADIUS
): number {
  const region = getRegionForY(y);
  if (!region) return 0;

  const rawOwn = getRawGangInfluenceInRegion(state, gangId, region, x, y, radius);
  if (rawOwn <= 0) return 0;

  // Find max rival raw influence in the same region
  let maxRivalRaw = 0;
  for (const rival of Object.values(state.gangs)) {
    if (rival.id === gangId || rival.status !== 'ACTIVE') continue;
    const rRaw = getRawGangInfluenceInRegion(state, rival.id, region, x, y, radius);
    if (rRaw > maxRivalRaw) {
      maxRivalRaw = rRaw;
    }
  }

  // Damped restriction: when both are moderate they overlap slightly;
  // when rival dominates it pushes own presence down to 0.
  const effective = Math.max(0, rawOwn - RIVAL_RESTRICTION_FACTOR * maxRivalRaw);
  return Math.round(effective * 1000) / 1000;
}

/**
 * Stats / performance multiplier based on heat (distance from HQ).
 * "later on nodes will get a stats multiplier based on 'heat' (distance from hq)."
 */
export function getNodeHeatMultiplier(heat: number): number {
  // Base 1.0, scales up to 1.5 at maximum heat
  return Math.round((1.0 + 0.5 * Math.min(1.0, Math.max(0, heat))) * 100) / 100;
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
 * RULE: "therefore, to aquire nodes in a region we first need to purchase a hq in that region."
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

let purchaseNodeSeq = 1;

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
