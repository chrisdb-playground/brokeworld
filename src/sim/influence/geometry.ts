import type { RegionId } from '../types';

export const REGION_BOUNDS: Record<RegionId, { yMin: number; yMax: number }> = {
  UK: { yMin: -700, yMax: 200 },       // height: 900px (~3x original 290px)
  EUROPE: { yMin: 400, yMax: 1600 },   // height: 1200px (~3x original 380px)
  AFRICA: { yMin: 1850, yMax: 2850 },  // height: 1000px (~3x original 320px)
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
    yMin: 200,
    yMax: 400,
    northBorder: {
      name: 'UK Channel Perimeter',
      y: 200,
      type: 'ENTRY',
      fromRegion: 'EUROPE',
      toRegion: 'UK',
      label: 'BORDER IN TO UK',
    },
    southBorder: {
      name: 'Europe Channel Perimeter',
      y: 400,
      type: 'EXIT',
      fromRegion: 'EUROPE',
      toRegion: 'UK',
      label: 'BORDER OUT OF EUROPE',
    },
  },
  {
    id: 'MEDITERRANEAN_SEA',
    name: 'Mediterranean Sea',
    yMin: 1600,
    yMax: 1850,
    northBorder: {
      name: 'European Mediterranean Coast',
      y: 1600,
      type: 'ENTRY',
      fromRegion: 'AFRICA',
      toRegion: 'EUROPE',
      label: 'BORDER IN TO EUROPE',
    },
    southBorder: {
      name: 'North Africa Maritime Coast',
      y: 1850,
      type: 'EXIT',
      fromRegion: 'AFRICA',
      toRegion: 'EUROPE',
      label: 'BORDER OUT OF AFRICA',
    },
  },
];

export const BASE_HQ_INFLUENCE_RADIUS = 800; // Base influence radius in px
export const INITIAL_HQ_INFLUENCE_RADIUS = 700; // Starting influence radius for fresh HQs
export const MAX_HQ_INFLUENCE_RADIUS = 1200; // Maximum capped influence radius
export const RIVAL_RESTRICTION_FACTOR = 0.65; // Overlap damping: allows slight overlap buffer between rival HQs

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
 * When multiple HQs project influence into the same area, they reinforce each other.
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
      const union = combined + h - combined * h;
      const synergyBonus = 0.15 * Math.min(combined, h);
      combined = Math.min(1.0, union + synergyBonus);
    }
  }
  return Math.min(1.0, Math.round(combined * 1000) / 1000);
}

/**
 * Stats / performance multiplier based on heat (distance from HQ).
 */
export function getNodeHeatMultiplier(heat: number): number {
  return Math.round((1.0 + 0.5 * Math.min(1.0, Math.max(0, heat))) * 100) / 100;
}
