import type { MigrantGoal, MigrantState, SimEvent, WorldSnapshot, LocationDef } from './types';
import type { SeededPrng } from './rng';
import { BALANCE } from './balance';
import { getRecruiterReputation } from './reputation';

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

const AFRICA_ORIGINS = [
  'Tripoli', 'Tangier', 'Alexandria', 'Tunis', 'Algiers', 'Casablanca', 'Benghazi', 'Agadir'
];

const EUROPE_ORIGINS = [
  'Calais', 'Marseille', 'Paris', 'Dunkirk', 'Lyon', 'Rotterdam', 'Bordeaux'
];

const SKIN_TONES = ['#fed7aa', '#fef08a', '#cbd5e1', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#fed7aa'];
const SHIRT_COLORS = ['#94a3b8', '#38bdf8', '#fb923c', '#4ade80', '#818cf8', '#f472b6', '#facc15'];
const HAIR_COLORS = ['#0f172a', '#78350f', '#d97706', '#94a3b8', '#b91c1c'];
const EYE_TYPES: MigrantState['avatar']['eyesType'][] = ['dots', 'sleepy', 'wide', 'winking'];
const MOUTH_TYPES: MigrantState['avatar']['mouthType'][] = ['smile', 'neutral', 'open', 'smile'];
const HAIR_STYLES: MigrantState['avatar']['hairStyle'][] = ['bald', 'short', 'curly', 'beanie'];
const LUGGAGE_TYPES: MigrantState['avatar']['luggage'][] = ['briefcase', 'backpack', 'bundle', 'none'];

let migrantSeq = 1;

export function resetMigrantSeq(val = 1) {
  migrantSeq = val;
}

/**
 * Finds depots reachable through the active or candidate route network from this recruiter.
 * Prevents generating impossible journeys.
 */
function getReachableDepots(state: WorldSnapshot, recNode: LocationDef): { depot: LocationDef; hops: number }[] {
  const reachable: { depot: LocationDef; hops: number }[] = [];
  const visitedDepots = new Set<string>();

  // Direct 1-hop routes from this recruiter
  const directRoutes = Object.values(state.routes).filter(
    (r) => r.sourceId === recNode.id && r.status === 'ACTIVE'
  );

  for (const route of directRoutes) {
    const tgt = state.locations[route.targetId];
    if (tgt && tgt.kind === 'DEPOT') {
      reachable.push({ depot: tgt, hops: 1 });
      visitedDepots.add(tgt.id);

      // If this depot is in Europe, find continuation routes to UK
      if (tgt.region === 'EUROPE') {
        const europeRecruiters = Object.values(state.locations).filter(
          (l) => l.kind === 'RECRUITER' && l.region === 'EUROPE' && l.gangId === tgt.gangId && l.operationalStatus === 'ACTIVE'
        );
        for (const eurRec of europeRecruiters) {
          const ukRoutes = Object.values(state.routes).filter(
            (r) => r.sourceId === eurRec.id && r.status === 'ACTIVE'
          );
          for (const ukR of ukRoutes) {
            const ukDep = state.locations[ukR.targetId];
            if (ukDep && ukDep.kind === 'DEPOT' && !visitedDepots.has(ukDep.id)) {
              reachable.push({ depot: ukDep, hops: 2 });
              visitedDepots.add(ukDep.id);
            }
          }
        }
      }
    }
  }

  // If no active routes exist yet from this recruiter, fall back to any depots in the target regions
  if (reachable.length === 0) {
    const targetRegions = recNode.region === 'AFRICA' ? ['EUROPE', 'UK'] : ['UK'];
    const fallbackDepots = Object.values(state.locations).filter(
      (l) => l.kind === 'DEPOT' && targetRegions.includes(l.region)
    );
    for (const dep of fallbackDepots) {
      const hops = recNode.region === 'AFRICA' && dep.region === 'UK' ? 2 : 1;
      reachable.push({ depot: dep, hops });
    }
  }

  return reachable;
}

export function spawnMigrants(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  const activeMigrants = Object.values(state.migrants).filter(
    (c) =>
      c.status === 'PROSPECT' ||
      c.status === 'WAITING' ||
      c.status === 'RECRUITED' ||
      c.status === 'TRAVELLING' ||
      c.status === 'IN_TRANSIT'
  );

  // Target population 24–36 active Migrants
  if (activeMigrants.length >= BALANCE.TARGET_POPULATION) {
    return;
  }

  // Rate-limit spawns
  if (!prng.chance(BALANCE.PROSPECT_SPAWN_CHANCE)) {
    return;
  }

  // Spawn in Africa (70%) or Europe (30%)
  const spawnInAfrica = prng.chance(0.7);

  let recNode: LocationDef | undefined;
  let originName: string;
  let originRegion: 'AFRICA' | 'EUROPE';

  if (spawnInAfrica) {
    const africaRecruiters = Object.values(state.locations).filter(
      (l) => l.kind === 'RECRUITER' && l.region === 'AFRICA' && l.operationalStatus === 'ACTIVE' && l.gangId !== 'NEUTRAL'
    );
    if (africaRecruiters.length === 0) return;
    recNode = prng.pick(africaRecruiters);
    originName = prng.pick(AFRICA_ORIGINS);
    originRegion = 'AFRICA';
  } else {
    const europeRecruiters = Object.values(state.locations).filter(
      (l) => l.kind === 'RECRUITER' && l.region === 'EUROPE' && l.operationalStatus === 'ACTIVE' && l.gangId !== 'NEUTRAL'
    );
    if (europeRecruiters.length === 0) return;
    recNode = prng.pick(europeRecruiters);
    originName = prng.pick(EUROPE_ORIGINS);
    originRegion = 'EUROPE';
  }

  if (!recNode) return;

  // Reachable destinations check: avoid generating impossible journeys
  const reachableDepots = getReachableDepots(state, recNode);
  let destDepot: LocationDef;
  let hops = 1;

  if (reachableDepots.length > 0) {
    const picked = prng.pick(reachableDepots);
    destDepot = picked.depot;
    hops = picked.hops;
  } else {
    // Default fallback placeholder depot
    const fallbackId = originRegion === 'AFRICA' ? 'DEP_FALLBACK_EUR' : 'DEP_FALLBACK_UK';
    destDepot = {
      id: fallbackId,
      name: originRegion === 'AFRICA' ? 'Marseille Harbor Depot' : 'Dover Coastal Depot',
      region: originRegion === 'AFRICA' ? 'EUROPE' : 'UK',
      x: 600,
      y: 400,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1',
      kind: 'DEPOT',
      gangId: recNode.gangId,
    };
    hops = 1;
  }

  const desiredRegion: 'EUROPE' | 'UK' = destDepot.region === 'UK' ? 'UK' : 'EUROPE';

  // Goal assignment: LEAVE (35%), WORK (35%), CRIME (20%), MARRY (10%)
  const goalRoll = prng.next();
  const goal: MigrantGoal =
    goalRoll < 0.35 ? 'LEAVE' : goalRoll < 0.70 ? 'WORK' : goalRoll < 0.88 ? 'CRIME' : 'MARRY';

  // Monetary offer: influenced by journey hops and recruiter reputation
  const recruiterRep = getRecruiterReputation(state, recNode.id);
  const repMultiplier = 0.7 + (recruiterRep / 100) * 0.6; // 0.7x (at 0 rep) to 1.3x (at 100 rep)
  const baseOffer = hops === 1
    ? prng.nextInt(BALANCE.BASE_OFFER_1_HOP_MIN, BALANCE.BASE_OFFER_1_HOP_MAX)
    : prng.nextInt(BALANCE.BASE_OFFER_2_HOP_MIN, BALANCE.BASE_OFFER_2_HOP_MAX);
  const offer = Math.round(baseOffer * repMultiplier);

  // Initial happiness (0-100) with small variation
  const happiness = Math.max(20, Math.min(100, BALANCE.INITIAL_MIGRANT_HAPPINESS + prng.nextInt(-10, 10)));

  // Prospect expiration time
  const prospectExpiresTick = state.tick + prng.nextInt(BALANCE.PROSPECT_EXPIRY_MIN_TICKS, BALANCE.PROSPECT_EXPIRY_MAX_TICKS);

  const id = `MIGRANT_${migrantSeq++}`;
  const firstName = prng.pick(FIRST_NAMES);
  const lastName = prng.pick(LAST_NAMES);
  const name = `${firstName} ${lastName}`;

  const migrant: MigrantState = {
    id,
    name,
    originName,
    originRegion,
    desiredRegion,
    originId: recNode.id,
    destinationId: destDepot.id,
    destinationRegion: destDepot.region,
    goal,
    happiness,
    offer,
    originRecruiterId: recNode.id,
    destinationReached: false,
    goalFulfilled: false,
    prospectExpiresTick,
    cash: offer,
    patienceRemainingTicks: prospectExpiresTick - state.tick,
    status: 'PROSPECT',
    avatar: {
      skinTone: prng.pick(SKIN_TONES),
      shirtColor: prng.pick(SHIRT_COLORS),
      hairColor: prng.pick(HAIR_COLORS),
      eyesType: prng.pick(EYE_TYPES),
      mouthType: prng.pick(MOUTH_TYPES),
      hairStyle: prng.pick(HAIR_STYLES),
      luggage: prng.pick(LUGGAGE_TYPES),
    },
    history: [
      `[Tick ${state.tick}] Originated in ${originName} (${originRegion}), arrived at ${recNode.name} as a prospect offering $${offer} to reach ${destDepot.name} (Goal: ${goal}).`,
    ],
  };

  state.migrants[id] = migrant;
  state.stats.activeMigrants++;

  events.push({
    id: `EVT_PROSPECT_${id}`,
    tick: state.tick,
    type: 'PROSPECT_SPAWNED',
    description: `Prospect ${name} appeared at ${recNode.name} offering $${offer} to reach ${destDepot.name} (${goal}).`,
    importance: 'LOW',
    locationId: recNode.id,
  });
}
