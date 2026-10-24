import type { SimEvent, WorldSnapshot } from './types';
import { BALANCE } from './balance';

/**
 * Returns the numerical reputation of a recruiter node (0-100).
 * Ownership belongs to the recruiter node, persisting across gang ownership changes.
 */
export function getRecruiterReputation(state: WorldSnapshot, recruiterId: string): number {
  const loc = state.locations[recruiterId];
  if (!loc || loc.kind !== 'RECRUITER') {
    return BALANCE.INITIAL_RECRUITER_REPUTATION;
  }
  if (loc.reputation === undefined) {
    loc.reputation = BALANCE.INITIAL_RECRUITER_REPUTATION;
  }
  return loc.reputation;
}

/**
 * Modifies the recruiter's reputation in response to migrant journey outcomes.
 * The original recruiter node is responsible for the migrant's outcome,
 * even across multi-hop journeys.
 */
export function updateRecruiterReputation(
  state: WorldSnapshot,
  recruiterId: string | undefined,
  delta: number,
  events?: SimEvent[],
  reason?: string
): number {
  if (!recruiterId) return BALANCE.INITIAL_RECRUITER_REPUTATION;
  const loc = state.locations[recruiterId];
  if (!loc || loc.kind !== 'RECRUITER') return BALANCE.INITIAL_RECRUITER_REPUTATION;

  if (loc.reputation === undefined) {
    loc.reputation = BALANCE.INITIAL_RECRUITER_REPUTATION;
  }

  const prev = loc.reputation;
  loc.reputation = Math.max(0, Math.min(100, loc.reputation + delta));

  if (events && loc.reputation !== prev) {
    const sign = delta > 0 ? '+' : '';
    events.push({
      id: `EVT_REP_${loc.id}_${state.tick}_${Math.floor(Math.random() * 10000)}`,
      tick: state.tick,
      type: 'RECRUITER_REP_CHANGED',
      description: `${loc.name} reputation adjusted to ${loc.reputation}% (${sign}${delta}${reason ? `: ${reason}` : ''}).`,
      importance: Math.abs(delta) >= 10 ? 'MEDIUM' : 'LOW',
      locationId: loc.id,
      gangId: loc.gangId !== 'NEUTRAL' ? loc.gangId : undefined,
    });
  }

  return loc.reputation;
}
