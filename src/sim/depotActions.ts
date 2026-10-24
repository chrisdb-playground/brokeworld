import type { SimEvent, WorldSnapshot } from './types';
import { BALANCE } from './balance';
import { updateRecruiterReputation } from './reputation';

/**
 * Boots a migrant from depot/gang control.
 * If goal is LEAVE and destination was reached, counts as successful fulfillment.
 * Otherwise counts as abandonment and penalizes recruiter reputation.
 */
export function bootMigrant(
  state: WorldSnapshot,
  migrantId: string,
  events?: SimEvent[]
): boolean {
  const migrant = state.migrants[migrantId];
  if (!migrant) return false;
  const currentLoc = state.locations[migrant.originId];
  if (!currentLoc || (currentLoc.kind !== 'DEPOT' && currentLoc.kind !== 'WORKSHOP')) {
    return false;
  }

  const reached = migrant.destinationReached || migrant.originId === migrant.destinationId;

  if (reached && migrant.goal === 'LEAVE') {
    migrant.goalFulfilled = true;
    migrant.happiness = Math.min(100, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_GOAL_FULFILLED);
    updateRecruiterReputation(
      state,
      migrant.originRecruiterId,
      BALANCE.REP_DELTA_LEAVE_COMPLETED,
      events,
      'Migrant reached sanctuary and completed LEAVE goal'
    );
    migrant.history.push(`[Tick ${state.tick}] Reached final destination ${currentLoc.name} and peacefully left gang control (Goal LEAVE fulfilled).`);
  } else if (reached && migrant.goal !== 'LEAVE') {
    migrant.happiness = Math.max(0, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) - 10);
    updateRecruiterReputation(
      state,
      migrant.originRecruiterId,
      BALANCE.REP_DELTA_BOOTED_UNFULFILLED,
      events,
      `Booted at destination without fulfilling goal (${migrant.goal || 'UNKNOWN'})`
    );
    migrant.history.push(`[Tick ${state.tick}] Released at ${currentLoc.name} with unfulfilled goal (${migrant.goal || 'NONE'}).`);
  } else {
    // Abandoned before destination!
    migrant.happiness = Math.max(0, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) - 20);
    updateRecruiterReputation(
      state,
      migrant.originRecruiterId,
      BALANCE.REP_DELTA_BOOTED_BEFORE_DEST,
      events,
      'Abandoned/booted before reaching destination'
    );
    migrant.history.push(`[Tick ${state.tick}] Abandoned and booted from ${currentLoc.name} before reaching final destination.`);
  }

  if (migrant.status === 'PROSPECT' || migrant.status === 'WAITING' || migrant.status === 'RECRUITED') {
    state.stats.activeMigrants = Math.max(0, state.stats.activeMigrants - 1);
    state.stats.totalDepartedMigrants++;
  }
  migrant.status = 'DEPARTED';
  migrant.recruitedByGangId = undefined;
  migrant.assignedRouteId = undefined;
  migrant.voyageId = undefined;

  if (events) {
    events.push({
      id: `EVT_BOOT_${migrant.id}_${state.tick}`,
      tick: state.tick,
      type: 'MIGRANT_BOOTED',
      description: `${migrant.name} was booted from ${currentLoc.name} (Destination reached: ${reached ? 'YES' : 'NO'}, Goal: ${migrant.goal || 'LEAVE'}).`,
      importance: 'LOW',
      locationId: currentLoc.id,
      gangId: currentLoc.gangId !== 'NEUTRAL' ? currentLoc.gangId : undefined,
    });
  }

  return true;
}

/**
 * Assigns a migrant residing in a depot to a workshop.
 * Destination fulfillment is a prerequisite for goal fulfillment.
 */
export function assignMigrantToWorkshop(
  state: WorldSnapshot,
  migrantId: string,
  targetWorkshopId?: string,
  events?: SimEvent[]
): boolean {
  const migrant = state.migrants[migrantId];
  if (!migrant) return false;
  const depot = state.locations[migrant.originId];
  if (!depot || depot.kind !== 'DEPOT') return false;

  // Find a suitable workshop owned by the same gang
  let workshop = targetWorkshopId ? state.locations[targetWorkshopId] : undefined;
  if (!workshop || (workshop.kind !== 'WORKSHOP' && workshop.kind !== 'CRIMINAL_ENTERPRISE') || workshop.gangId !== depot.gangId) {
    workshop = Object.values(state.locations).find(
      (l) => (l.kind === 'WORKSHOP' || l.kind === 'CRIMINAL_ENTERPRISE') && l.gangId === depot.gangId && l.region === depot.region
    );
  }

  if (!workshop) {
    // If no workshop in the same region, try any workshop owned by the gang
    workshop = Object.values(state.locations).find(
      (l) => (l.kind === 'WORKSHOP' || l.kind === 'CRIMINAL_ENTERPRISE') && l.gangId === depot.gangId
    );
  }

  if (!workshop) return false;

  migrant.originId = workshop.id;
  migrant.status = 'ARRIVED';

  // Check destination prerequisite
  const destMatches = migrant.destinationReached || workshop.id === migrant.destinationId || workshop.region === migrant.destinationRegion;

  if (destMatches && migrant.goal === 'WORK') {
    migrant.destinationReached = true;
    migrant.goalFulfilled = true;
    migrant.happiness = Math.min(100, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_GOAL_FULFILLED);
    updateRecruiterReputation(
      state,
      migrant.originRecruiterId,
      BALANCE.REP_DELTA_GOAL_FULFILLED,
      events,
      'Migrant reached destination and assigned to WORK'
    );
    migrant.history.push(`[Tick ${state.tick}] Assigned to duties at ${workshop.name} (Goal WORK fulfilled!).`);
  } else {
    // Contrary assignment or not at final destination: negative happiness impact
    migrant.happiness = Math.max(0, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_MISMATCH_ASSIGNMENT);
    migrant.history.push(`[Tick ${state.tick}] Assigned to ${workshop.name} (Contrary to desired goal ${migrant.goal || 'WORK'} or before destination).`);
  }

  if (events) {
    events.push({
      id: `EVT_ASSIGN_${migrant.id}_${state.tick}`,
      tick: state.tick,
      type: 'MIGRANT_ASSIGNED',
      description: `${migrant.name} assigned to ${workshop.name} (Goal fulfilled: ${migrant.goalFulfilled ? 'YES' : 'NO'}).`,
      importance: 'LOW',
      locationId: workshop.id,
      gangId: workshop.gangId,
    });
  }

  return true;
}

/**
 * Assigns a migrant residing in a depot to a criminal enterprise.
 */
export function assignMigrantToCriminalEnterprise(
  state: WorldSnapshot,
  migrantId: string,
  targetEnterpriseId?: string,
  events?: SimEvent[]
): boolean {
  const migrant = state.migrants[migrantId];
  if (!migrant) return false;
  const depot = state.locations[migrant.originId];
  if (!depot || depot.kind !== 'DEPOT') return false;

  let enterprise = targetEnterpriseId ? state.locations[targetEnterpriseId] : undefined;
  if (!enterprise || enterprise.gangId !== depot.gangId) {
    enterprise = Object.values(state.locations).find(
      (l) => (l.kind === 'CRIMINAL_ENTERPRISE' || l.kind === 'WORKSHOP') && l.gangId === depot.gangId && l.region === depot.region
    );
  }

  if (!enterprise) {
    enterprise = Object.values(state.locations).find(
      (l) => (l.kind === 'CRIMINAL_ENTERPRISE' || l.kind === 'WORKSHOP') && l.gangId === depot.gangId
    );
  }

  if (!enterprise) return false;

  migrant.originId = enterprise.id;
  migrant.status = 'ARRIVED';

  const destMatches = migrant.destinationReached || enterprise.id === migrant.destinationId || enterprise.region === migrant.destinationRegion;

  if (destMatches && migrant.goal === 'CRIME') {
    migrant.destinationReached = true;
    migrant.goalFulfilled = true;
    migrant.happiness = Math.min(100, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_GOAL_FULFILLED);
    updateRecruiterReputation(
      state,
      migrant.originRecruiterId,
      BALANCE.REP_DELTA_GOAL_FULFILLED,
      events,
      'Migrant reached destination and assigned to CRIME enterprise'
    );
    migrant.history.push(`[Tick ${state.tick}] Assigned to criminal syndicate operations at ${enterprise.name} (Goal CRIME fulfilled!).`);
  } else {
    migrant.happiness = Math.max(0, (migrant.happiness ?? BALANCE.INITIAL_MIGRANT_HAPPINESS) + BALANCE.HAPPY_MISMATCH_ASSIGNMENT);
    migrant.history.push(`[Tick ${state.tick}] Assigned to criminal enterprise at ${enterprise.name} (Contrary to desired goal ${migrant.goal || 'CRIME'}).`);
  }

  if (events) {
    events.push({
      id: `EVT_ASSIGN_CRIME_${migrant.id}_${state.tick}`,
      tick: state.tick,
      type: 'MIGRANT_ASSIGNED',
      description: `${migrant.name} assigned to criminal enterprise ${enterprise.name} (Goal fulfilled: ${migrant.goalFulfilled ? 'YES' : 'NO'}).`,
      importance: 'LOW',
      locationId: enterprise.id,
      gangId: enterprise.gangId,
    });
  }

  return true;
}

/**
 * Forwards a migrant from an intermediate depot to a recruiter for the next leg of their journey.
 * Preserves identity, destination, goal, happiness, original payment, and origin recruiter attribution.
 * Automatically marks the migrant as RECRUITED without collecting another payment.
 */
export function forwardMigrantToRecruiter(
  state: WorldSnapshot,
  migrantId: string,
  targetRecruiterId?: string,
  events?: SimEvent[]
): boolean {
  const migrant = state.migrants[migrantId];
  if (!migrant) return false;
  const depot = state.locations[migrant.originId];
  if (!depot || depot.kind !== 'DEPOT') return false;

  // Find a reachable recruiter owned by the gang in the same region
  let recruiter = targetRecruiterId ? state.locations[targetRecruiterId] : undefined;
  if (!recruiter || recruiter.kind !== 'RECRUITER' || recruiter.gangId !== depot.gangId || recruiter.region !== depot.region) {
    recruiter = Object.values(state.locations).find(
      (l) => l.kind === 'RECRUITER' && l.gangId === depot.gangId && l.region === depot.region && l.operationalStatus === 'ACTIVE'
    );
  }

  if (!recruiter) {
    // If no active recruiter in the same region, cannot forward
    return false;
  }

  migrant.originId = recruiter.id;
  migrant.status = 'RECRUITED';
  state.stats.activeMigrants++;
  state.stats.totalDepartedMigrants = Math.max(0, state.stats.totalDepartedMigrants - 1);
  migrant.assignedRouteId = undefined;
  migrant.voyageId = undefined;
  migrant.history.push(`[Tick ${state.tick}] Forwarded from ${depot.name} to ${recruiter.name} for the next leg of journey (Payment preserved, no additional fee).`);

  if (events) {
    events.push({
      id: `EVT_FWD_${migrant.id}_${state.tick}`,
      tick: state.tick,
      type: 'MIGRANT_TRANSFERRED',
      description: `${migrant.name} transferred to ${recruiter.name} to continue journey towards destination.`,
      importance: 'LOW',
      locationId: recruiter.id,
      gangId: recruiter.gangId,
    });
  }

  return true;
}

/**
 * Toggles lockdown on depots and production nodes.
 */
export function toggleLockdown(
  state: WorldSnapshot,
  locationId: string,
  events?: SimEvent[]
): boolean {
  const loc = state.locations[locationId];
  if (!loc || (loc.kind !== 'DEPOT' && loc.kind !== 'WORKSHOP' && loc.kind !== 'CRIMINAL_ENTERPRISE')) {
    return false;
  }

  loc.lockdown = !loc.lockdown;

  if (events) {
    events.push({
      id: `EVT_LOCKDOWN_${loc.id}_${state.tick}`,
      tick: state.tick,
      type: 'LOCKDOWN_TOGGLED',
      description: `${loc.name} lockdown is now ${loc.lockdown ? 'ENABLED 🔒' : 'DISABLED 🔓'}.`,
      importance: 'LOW',
      locationId: loc.id,
      gangId: loc.gangId !== 'NEUTRAL' ? loc.gangId : undefined,
    });
  }

  return true;
}
