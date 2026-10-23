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
  UK: { yMin: -100, yMax: 160 },
  EUROPE: { yMin: 215, yMax: 485 },
  AFRICA: { yMin: 565, yMax: 820 },
};

export interface BorderSideDef {
  name: string;
  y: number;
  type: 'EXIT' | 'ENTRY';
  fromRegion: RegionId;
  toRegion: RegionId;
  label: string;
}

export interface WaterZoneDef {
  id: string;
  name: string;
  yMin: number;
  yMax: number;
  northBorder: BorderSideDef;
  southBorder: BorderSideDef;
}

export const WATER_ZONES: WaterZoneDef[] = [
  {
    id: 'ENGLISH_CHANNEL',
    name: 'English Channel',
    yMin: 160,
    yMax: 215,
    northBorder: {
      name: 'UK Channel Perimeter',
      y: 160,
      type: 'ENTRY',
      fromRegion: 'EUROPE',
      toRegion: 'UK',
      label: 'BORDER IN TO UK',
    },
    southBorder: {
      name: 'Europe Channel Perimeter',
      y: 215,
      type: 'EXIT',
      fromRegion: 'EUROPE',
      toRegion: 'UK',
      label: 'BORDER OUT OF EUROPE',
    },
  },
  {
    id: 'MEDITERRANEAN_SEA',
    name: 'Mediterranean Sea',
    yMin: 485,
    yMax: 565,
    northBorder: {
      name: 'European Mediterranean Coast',
      y: 485,
      type: 'ENTRY',
      fromRegion: 'AFRICA',
      toRegion: 'EUROPE',
      label: 'BORDER IN TO EUROPE',
    },
    southBorder: {
      name: 'North Africa Maritime Coast',
      y: 565,
      type: 'EXIT',
      fromRegion: 'AFRICA',
      toRegion: 'EUROPE',
      label: 'BORDER OUT OF AFRICA',
    },
  },
];

export const BASE_HQ_INFLUENCE_RADIUS = 260; // Base influence radius in px
export const INITIAL_HQ_INFLUENCE_RADIUS = 220; // Starting influence radius for fresh HQs
export const MAX_HQ_INFLUENCE_RADIUS = 350; // Maximum capped influence radius
export const RIVAL_RESTRICTION_FACTOR = 0.65; // Overlap damping: allows slight overlap buffer between rival HQs

export interface InfluenceCheckResult {
  allowed: boolean;
  cost: number;
  reason?: string;
  heat: number;
}

export function isPointInWater(y: number): boolean {
  return WATER_ZONES.some((w) => y >= w.yMin && y <= w.yMax);
}

export function getRegionForY(y: number): RegionId | null {
  if (y >= REGION_BOUNDS.UK.yMin && y <= REGION_BOUNDS.UK.yMax) {
    return 'UK';
  }
  if (y >= REGION_BOUNDS.EUROPE.yMin && y <= REGION_BOUNDS.EUROPE.yMax) {
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
 * Combines influence heats from multiple HQs belonging to the same gang.
 * RULE: "2 hq influence zones, same gang, increase the influence"
 * When multiple HQs project influence into the same area, they reinforce each other!
 */
export function combineHqHeats(heats: number[]): number {
  const activeHeats = heats.filter((h) => h > 0);
  if (activeHeats.length === 0) return 0;
  if (activeHeats.length === 1) return activeHeats[0];

  let combined = 0;
  for (const h of activeHeats) {
    if (combined === 0) {
      combined = h;
    } else {
      // Diminishing returns union + synergy resonance bonus
      const union = combined + h - combined * h;
      const synergyBonus = 0.15 * Math.min(combined, h);
      combined = Math.min(1.0, union + synergyBonus);
    }
  }
  return Math.min(1.0, Math.round(combined * 1000) / 1000);
}

/**
 * Returns raw influence of a gang in a specific region at point (x, y).
 * RULE: "heat map stops at border."
 * If point (x, y) is not in the specified region, influence is strictly 0.
 * RULE: "2 hq influence zones, same gang, increase the influence"
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

  // Find all HQs for this gang in this region and collect raw heats
  const hqHeats: number[] = [];
  for (const loc of Object.values(state.locations)) {
    if (loc.gangId === gangId && loc.kind === 'HQ' && loc.region === region) {
      const hqRadius = loc.influenceRadius || radius;
      const h = getRawHqHeat(loc.x, loc.y, x, y, hqRadius);
      if (h > 0) {
        hqHeats.push(h);
      }
    }
  }

  return combineHqHeats(hqHeats);
}

/**
 * Query helper to see if a point is reinforced by 2+ HQs of the same gang.
 */
export function getHqSynergyInfo(
  state: WorldSnapshot,
  gangId: string,
  x: number,
  y: number
): { isSynergized: boolean; contributingHqCount: number; hqNames: string[] } {
  const region = getRegionForY(y);
  if (!region) return { isSynergized: false, contributingHqCount: 0, hqNames: [] };

  const contributing: string[] = [];
  for (const loc of Object.values(state.locations)) {
    if (loc.gangId === gangId && loc.kind === 'HQ' && loc.region === region) {
      const r = loc.influenceRadius || BASE_HQ_INFLUENCE_RADIUS;
      if (getRawHqHeat(loc.x, loc.y, x, y, r) > 0) {
        contributing.push(loc.name);
      }
    }
  }

  return {
    isSynergized: contributing.length >= 2,
    contributingHqCount: contributing.length,
    hqNames: contributing,
  };
}

/**
 * Slowly ticks up the influence radius of active staffed HQs over time
 */
export function tickInfluenceGrowth(state: WorldSnapshot): void {
  // Slowly tick up HQ influence radius every 20 ticks
  if (state.tick % 20 !== 0) return;

  for (const loc of Object.values(state.locations)) {
    if (loc.kind === 'HQ' && loc.gangId !== 'NEUTRAL') {
      // Must be staffed to project expanding influence
      if (loc.assignedHoodId && state.hoods[loc.assignedHoodId]) {
        const curRadius = loc.influenceRadius || INITIAL_HQ_INFLUENCE_RADIUS;
        if (curRadius < MAX_HQ_INFLUENCE_RADIUS) {
          loc.influenceRadius = Math.min(MAX_HQ_INFLUENCE_RADIUS, curRadius + 1);
        }
      }
    }
  }
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

/**
 * Claim an unowned candidate node that has been scouted
 */
export function executeClaimCandidateNode(
  state: WorldSnapshot,
  gangId: string,
  candidateId: string,
  prng: SeededPrng,
  events?: SimEvent[]
): LocationDef {
  const loc = state.locations[candidateId];
  if (!loc) throw new Error(`Candidate node ${candidateId} not found`);
  const gang = state.gangs[gangId];
  if (!gang) throw new Error(`Gang ${gangId} not found`);

  const cost = loc.candidateCost || (loc.kind === 'HQ' ? 2200 : (loc.kind === 'WORKSHOP' ? 2000 : (loc.kind === 'DEPOT' ? 1200 : 1500)));
  if (gang.cash < cost) throw new Error(`Insufficient funds: need $${cost}, has $${gang.cash}`);

  gang.cash -= cost;
  loc.gangId = gangId;
  loc.operationalStatus = 'ACTIVE';

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

let borderRouteSeq = 500;

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
): import('./types').RouteServiceState {
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

  const route: import('./types').RouteServiceState = {
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

  // Remove from discoveredRouteIds
  if (gang.discoveredRouteIds) {
    gang.discoveredRouteIds = gang.discoveredRouteIds.filter((k) => k !== connId && k !== connKey);
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

