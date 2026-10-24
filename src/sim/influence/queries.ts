import type { LocationDef, RegionId, WorldSnapshot } from '../types';
import {
  BASE_HQ_INFLUENCE_RADIUS,
  INITIAL_HQ_INFLUENCE_RADIUS,
  MAX_HQ_INFLUENCE_RADIUS,
  RIVAL_RESTRICTION_FACTOR,
  combineHqHeats,
  getRawHqHeat,
  getRegionForY,
  isPointInRegion,
} from './geometry';

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
 * Slowly ticks up the influence radius of active staffed HQs over time.
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
 * Resolves the parent/closest HQ for a given location node.
 * Used for Geo View abstraction (grouping nodes and routes by closest HQ within influence zone).
 */
export function getClosestHqForNode(
  loc: LocationDef,
  locations: Record<string, LocationDef> | WorldSnapshot
): LocationDef | null {
  if (loc.kind === 'HQ') return loc;

  const locs = 'locations' in locations ? locations.locations : locations;
  const allHqs = Object.values(locs).filter((l) => l.kind === 'HQ');
  if (allHqs.length === 0) return null;

  // 1. Prefer HQs of the same gang in the same region
  if (loc.gangId && loc.gangId !== 'NEUTRAL') {
    const sameGangSameRegion = allHqs.filter(
      (h) => h.gangId === loc.gangId && h.region === loc.region
    );
    if (sameGangSameRegion.length > 0) {
      return findClosestHq(loc, sameGangSameRegion);
    }
  }

  // 2. Prefer any HQ in the same region (preserves geographic region abstraction in Geo View)
  const sameRegion = allHqs.filter((h) => h.region === loc.region);
  if (sameRegion.length > 0) {
    return findClosestHq(loc, sameRegion);
  }

  // 3. Fallback: prefer HQs of the same gang in any region
  if (loc.gangId && loc.gangId !== 'NEUTRAL') {
    const sameGang = allHqs.filter((h) => h.gangId === loc.gangId);
    if (sameGang.length > 0) {
      return findClosestHq(loc, sameGang);
    }
  }

  // 4. Fallback to closest overall HQ
  return findClosestHq(loc, allHqs);
}

function findClosestHq(loc: LocationDef, hqs: LocationDef[]): LocationDef {
  let closest = hqs[0];
  let minDist = Math.hypot(closest.x - loc.x, closest.y - loc.y);
  for (let i = 1; i < hqs.length; i++) {
    const dist = Math.hypot(hqs[i].x - loc.x, hqs[i].y - loc.y);
    if (dist < minDist) {
      minDist = dist;
      closest = hqs[i];
    }
  }
  return closest;
}
