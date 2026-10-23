import type {
  ChumAvatarSpec,
  GangState,
  HoodAssignment,
  HoodRole,
  HoodState,
  LocationDef,
  SimEvent,
  VoyageState,
  WorldSnapshot,
} from './types';
import type { SeededPrng } from './rng';

const FIRST_NAMES = [
  'Barnaby', 'Pip', 'Pebble', 'Nori', 'Ollie', 'Caspian', 'Bubbles', 'Finley',
  'Shelly', 'Clawdia', 'Rusty', 'Ziggy', 'Milo', 'Toby', 'Penny', 'Coral',
  'Marina', 'Gulliver', 'Otto', 'Skipper', 'Kelp', 'Breezy', 'Waffles', 'Finn'
];

const LAST_NAMES = [
  'Gill', 'Fin', 'McSquid', 'Clam', 'Sprat', 'Brine', 'Barnacle', 'Flounder',
  'Pike', 'Wrasse', 'Cod', 'Perch', 'Trout', 'Roe', 'Minnow', 'Whiting',
  'Goby', 'Pollock', 'Skate', 'Shad', 'Scallop', 'Dory', 'Hake', 'Bass'
];

const ROLE_TITLES: Record<HoodRole, string[]> = {
  HQ_BOSS: ['Boss', 'Don', 'Capo', 'Chief'],
  RECRUITER_MANAGER: ['Agent', 'Broker', 'Barker', 'Recruiter'],
  DEPOT_GUARD: ['Warden', 'Quartermaster', 'Handler', 'Overseer'],
  WORKSHOP_MECHANIC: ['Mechanic', 'Engineer', 'Wrench', 'Greaser'],
  VOYAGE_SKIPPER: ['Skipper', 'Captain', 'Helmsman', 'Pilot'],
  SCOUT: ['Scout', 'Lookout', 'Pathfinder', 'Tracker', 'Spotter'],
  STANDBY: ['Operative', 'Enforcer', 'Hood', 'Bruiser'],
};

export const HOOD_HIRING_COST = 150;
export const HOOD_WAGE_PER_CYCLE = 15;

const SKIN_TONES = ['#fed7aa', '#fef08a', '#cbd5e1', '#fbcfe8', '#bfdbfe', '#bbf7d0'];
const HAIR_COLORS = ['#0f172a', '#78350f', '#d97706', '#94a3b8', '#b91c1c'];
const EYE_TYPES: ChumAvatarSpec['eyesType'][] = ['dots', 'winking', 'wide', 'sleepy'];
const MOUTH_TYPES: ChumAvatarSpec['mouthType'][] = ['neutral', 'smile', 'open'];
const HAIR_STYLES: ChumAvatarSpec['hairStyle'][] = ['beanie', 'short', 'curly', 'bald'];
const LUGGAGE_TYPES: ChumAvatarSpec['luggage'][] = ['briefcase', 'bundle', 'backpack', 'none'];

let hoodSeq = 1;

export function resetHoodSeq(val = 1) {
  hoodSeq = val;
}

export function generateHoodName(role: HoodRole, prng: SeededPrng): string {
  const titles = ROLE_TITLES[role] || ['Hood'];
  const title = prng.pick(titles);
  const first = prng.pick(FIRST_NAMES);
  const last = prng.pick(LAST_NAMES);
  return `${title} ${first} ${last}`;
}

export function generateHoodAvatar(gangColor: string, prng: SeededPrng): ChumAvatarSpec {
  return {
    skinTone: prng.pick(SKIN_TONES),
    shirtColor: gangColor, // Hoods always wear their gang's distinct colors!
    hairColor: prng.pick(HAIR_COLORS),
    hairStyle: prng.pick(HAIR_STYLES),
    eyesType: prng.pick(EYE_TYPES),
    mouthType: prng.pick(MOUTH_TYPES),
    luggage: prng.pick(LUGGAGE_TYPES),
  };
}

export function describeHoodTask(
  role: HoodRole,
  assignment: HoodAssignment,
  state: WorldSnapshot
): string {
  if (assignment.type === 'MANAGE_NODE') {
    const loc = state.locations[assignment.targetId];
    const locName = loc ? loc.name : 'assigned location';
    switch (role) {
      case 'HQ_BOSS':
        return `Directing syndicate operations at ${locName}`;
      case 'RECRUITER_MANAGER':
        return `Signing up Chums and managing intake at ${locName}`;
      case 'DEPOT_GUARD':
        return `Securing safehouse and housing arrivals at ${locName}`;
      case 'WORKSHOP_MECHANIC':
        return `Maintaining smuggling fleet and gear at ${locName}`;
      default:
        return `Managing operations at ${locName}`;
    }
  }

  if (assignment.type === 'PILOT_VOYAGE') {
    const voyage = state.voyages[assignment.targetId];
    if (voyage) {
      const tgt = state.locations[voyage.targetId];
      const pct = Math.round(voyage.progress * 100);
      return `Skippering ${voyage.mode.toLowerCase()} voyage to ${tgt?.name || 'depot'} (${pct}%)`;
    }
    return 'Skippering voyage in transit';
  }

  if (assignment.type === 'SCOUT_ZONE') {
    const loc = state.locations[assignment.targetId];
    return `Scouting regional terrain around ${loc?.name || 'HQ'} for candidate nodes and routes`;
  }

  if (assignment.type === 'IDLE_HQ') {
    const hq = state.locations[assignment.targetId];
    return `Standing by at ${hq?.name || 'HQ'} ready for dispatch`;
  }

  if (role === 'SCOUT') {
    return 'Scouting territory for candidate nodes and cross-border routes';
  }

  return 'Standing by for syndicate orders';
}

/**
 * Hire a new Hood for a gang with a standard signing fee
 */
export function hireHood(
  state: WorldSnapshot,
  gangId: string,
  role: HoodRole,
  assignment: HoodAssignment,
  prng: SeededPrng,
  events?: SimEvent[]
): HoodState {
  const gang = state.gangs[gangId];
  if (gang) {
    gang.cash -= HOOD_HIRING_COST;
  }
  const gangColor = gang ? gang.color : '#38bdf8';
  const id = `HOOD_${gangId}_${hoodSeq++}`;
  const name = generateHoodName(role, prng);
  const avatar = generateHoodAvatar(gangColor, prng);

  const taskDesc = describeHoodTask(role, assignment, state);

  const hood: HoodState = {
    id,
    name,
    gangId,
    role,
    assignment,
    currentTaskDescription: taskDesc,
    avatar,
    hiredTick: state.tick,
    history: [`[Tick ${state.tick}] Hired by ${gang?.name || 'Gang'} as ${role.replace('_', ' ')}: ${taskDesc}.`],
  };

  state.hoods[id] = hood;
  state.stats.totalHoodsEmployed = (state.stats.totalHoodsEmployed || 0) + 1;

  // Bind to target if it's a node
  if (assignment.type === 'MANAGE_NODE') {
    const loc = state.locations[assignment.targetId];
    if (loc) {
      loc.assignedHoodId = hood.id;
      loc.operationalStatus = 'ACTIVE';
    }
  }

  if (events) {
    events.push({
      id: `EVT_HOOD_${id}`,
      tick: state.tick,
      type: 'HOOD_HIRED',
      description: `${gang?.name || 'Gang'} employed Hood ${name} (${role.replace('_', ' ')}) for $${HOOD_HIRING_COST} to ${taskDesc}.`,
      importance: 'LOW',
      gangId,
    });
  }

  return hood;
}

/**
 * Assign an existing or hired Hood to a Voyage
 */
export function assignHoodToVoyage(
  hood: HoodState,
  voyage: VoyageState,
  state: WorldSnapshot
): void {
  hood.role = 'VOYAGE_SKIPPER';
  hood.assignment = {
    type: 'PILOT_VOYAGE',
    targetId: voyage.id,
    role: 'VOYAGE_SKIPPER',
  };
  hood.currentTaskDescription = describeHoodTask('VOYAGE_SKIPPER', hood.assignment, state);
  voyage.captainHoodId = hood.id;
  hood.history.push(`[Tick ${state.tick}] Assigned as captain of voyage ${voyage.id} to ${state.locations[voyage.targetId]?.name || 'depot'}.`);
}

/**
 * Release a Hood from a completed or disrupted Voyage back to HQ
 */
export function releaseHoodFromVoyage(
  hood: HoodState,
  gang: GangState | undefined,
  state: WorldSnapshot
): void {
  const hqId =
    gang?.mainHqLocationId ||
    gang?.hqLocationId ||
    Object.values(state.locations).find((l) => l.gangId === hood.gangId && l.kind === 'HQ')?.id ||
    '';
  hood.role = 'STANDBY';
  hood.assignment = {
    type: 'IDLE_HQ',
    targetId: hqId,
    role: 'STANDBY',
  };
  hood.currentTaskDescription = describeHoodTask('STANDBY', hood.assignment, state);
  hood.history.push(`[Tick ${state.tick}] Completed voyage duties and returned to HQ on standby.`);
}

/**
 * Process periodic wage deductions for all employed hoods
 */
export function processPayroll(state: WorldSnapshot, events?: SimEvent[]): void {
  if (state.tick % 60 !== 0) return;

  for (const gang of Object.values(state.gangs)) {
    if (gang.status !== 'ACTIVE') continue;
    const gangHoods = Object.values(state.hoods).filter((h) => h.gangId === gang.id);
    const wageBill = gangHoods.length * HOOD_WAGE_PER_CYCLE;
    gang.wageBillTotal = wageBill;
    gang.cash -= wageBill;

    if (events && gangHoods.length > 0) {
      events.push({
        id: `EVT_PAYROLL_${gang.id}_${state.tick}`,
        tick: state.tick,
        type: 'PAYROLL_PAID',
        description: `${gang.name} paid $${wageBill} in payroll to ${gangHoods.length} Hoods ($${HOOD_WAGE_PER_CYCLE}/hood).`,
        importance: 'LOW',
        gangId: gang.id,
      });
    }
  }
}

/**
 * Ensure all nodes of a gang have assigned hoods to manage them.
 * Rule: "a gang must employee hood to do anything- run voyages, manage nodes, recruiters, workshops, whatever."
 */
export function ensureGangNodesStaffed(
  state: WorldSnapshot,
  gang: GangState,
  prng: SeededPrng,
  events?: SimEvent[]
): void {
  // 1. Staff all regional HQs
  const hqIds =
    gang.hqLocationIds && gang.hqLocationIds.length > 0
      ? gang.hqLocationIds
      : [gang.hqLocationId];

  for (const hqId of hqIds) {
    const hq = state.locations[hqId];
    if (hq && (!hq.assignedHoodId || !state.hoods[hq.assignedHoodId])) {
      const existingHood = Object.values(state.hoods).find(
        (h) => h.gangId === gang.id && h.assignment.type === 'MANAGE_NODE' && h.assignment.targetId === hq.id
      );
      if (existingHood) {
        hq.assignedHoodId = existingHood.id;
        hq.operationalStatus = 'ACTIVE';
      } else {
        hireHood(state, gang.id, 'HQ_BOSS', { type: 'MANAGE_NODE', targetId: hq.id, role: 'HQ_BOSS' }, prng, events);
      }
    }
  }

  // 2. Staff Workshop
  if (gang.workshopLocationId) {
    const ws = state.locations[gang.workshopLocationId];
    if (ws && (!ws.assignedHoodId || !state.hoods[ws.assignedHoodId])) {
      const existingHood = Object.values(state.hoods).find(
        (h) => h.gangId === gang.id && h.assignment.type === 'MANAGE_NODE' && h.assignment.targetId === ws.id
      );
      if (existingHood) {
        ws.assignedHoodId = existingHood.id;
        ws.operationalStatus = 'ACTIVE';
      } else {
        hireHood(state, gang.id, 'WORKSHOP_MECHANIC', { type: 'MANAGE_NODE', targetId: ws.id, role: 'WORKSHOP_MECHANIC' }, prng, events);
      }
    }
  }

  // 3. Staff Recruiters
  for (const recId of gang.recruiterLocationIds || []) {
    const rec = state.locations[recId];
    if (rec && (!rec.assignedHoodId || !state.hoods[rec.assignedHoodId])) {
      const existingHood = Object.values(state.hoods).find(
        (h) => h.gangId === gang.id && h.assignment.type === 'MANAGE_NODE' && h.assignment.targetId === rec.id
      );
      if (existingHood) {
        rec.assignedHoodId = existingHood.id;
        rec.operationalStatus = 'ACTIVE';
      } else {
        hireHood(state, gang.id, 'RECRUITER_MANAGER', { type: 'MANAGE_NODE', targetId: rec.id, role: 'RECRUITER_MANAGER' }, prng, events);
      }
    }
  }

  // 4. Staff Depots
  for (const depotId of gang.depotLocationIds || []) {
    const depot = state.locations[depotId];
    if (depot && (!depot.assignedHoodId || !state.hoods[depot.assignedHoodId])) {
      const existingHood = Object.values(state.hoods).find(
        (h) => h.gangId === gang.id && h.assignment.type === 'MANAGE_NODE' && h.assignment.targetId === depot.id
      );
      if (existingHood) {
        depot.assignedHoodId = existingHood.id;
        depot.operationalStatus = 'ACTIVE';
      } else {
        hireHood(state, gang.id, 'DEPOT_GUARD', { type: 'MANAGE_NODE', targetId: depot.id, role: 'DEPOT_GUARD' }, prng, events);
      }
    }
  }

  // 5. Staff Cross-Border Routes
  for (const route of Object.values(state.routes)) {
    if (route.gangId === gang.id && route.status === 'ACTIVE' && route.isCrossBorder) {
      if (!route.assignedSkipperHoodId || !state.hoods[route.assignedSkipperHoodId]) {
        const existingSkipper = Object.values(state.hoods).find(
          (h) => h.gangId === gang.id && (h.role === 'VOYAGE_SKIPPER' || h.role === 'STANDBY') && h.assignment.type === 'IDLE_HQ'
        );
        if (existingSkipper) {
          route.assignedSkipperHoodId = existingSkipper.id;
          route.operationalStatus = 'ACTIVE';
        } else {
          const newSkipper = hireHood(
            state,
            gang.id,
            'VOYAGE_SKIPPER',
            { type: 'IDLE_HQ', targetId: gang.mainHqLocationId || gang.hqLocationId, role: 'VOYAGE_SKIPPER' },
            prng,
            events
          );
          route.assignedSkipperHoodId = newSkipper.id;
          route.operationalStatus = 'ACTIVE';
        }
      }
    }
  }
}
