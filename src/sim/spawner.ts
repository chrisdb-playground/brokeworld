import type { ChumigrantState, SimEvent, WorldSnapshot } from './types';
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

const AFRICA_ORIGINS = [
  'Tripoli', 'Tangier', 'Alexandria', 'Tunis', 'Algiers', 'Casablanca', 'Benghazi', 'Agadir'
];

const EUROPE_ORIGINS = [
  'Calais', 'Marseille', 'Paris', 'Dunkirk', 'Lyon', 'Rotterdam', 'Bordeaux'
];

const SKIN_TONES = ['#fed7aa', '#fef08a', '#cbd5e1', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#fed7aa'];
const SHIRT_COLORS = ['#94a3b8', '#38bdf8', '#fb923c', '#4ade80', '#818cf8', '#f472b6', '#facc15'];
const HAIR_COLORS = ['#0f172a', '#78350f', '#d97706', '#94a3b8', '#b91c1c'];
const EYE_TYPES: ChumigrantState['avatar']['eyesType'][] = ['dots', 'sleepy', 'wide', 'winking'];
const MOUTH_TYPES: ChumigrantState['avatar']['mouthType'][] = ['smile', 'neutral', 'open', 'smile'];
const HAIR_STYLES: ChumigrantState['avatar']['hairStyle'][] = ['bald', 'short', 'curly', 'beanie'];
const LUGGAGE_TYPES: ChumigrantState['avatar']['luggage'][] = ['briefcase', 'backpack', 'bundle', 'none'];

let chumSeq = 1;

export function resetChumSeq(val = 1) {
  chumSeq = val;
}

export function spawnChumigrants(
  state: WorldSnapshot,
  prng: SeededPrng,
  events: SimEvent[]
): void {
  const activeChums = Object.values(state.chumigrants).filter(
    (c) => c.status === 'WAITING' || c.status === 'RECRUITED' || c.status === 'IN_TRANSIT'
  );

  // Target population 24–36 active Chums
  const targetPop = 30;
  if (activeChums.length >= targetPop) {
    return;
  }

  // Rate-limit spawns
  if (!prng.chance(0.3)) {
    return;
  }

  // Spawn in Africa (70%) or Europe (30%)
  const spawnInAfrica = prng.chance(0.7);

  let recNode;
  let originName: string;
  let originRegion: 'AFRICA' | 'EUROPE';
  let desiredRegion: 'EUROPE' | 'UK';

  if (spawnInAfrica) {
    const africaRecruiters = Object.values(state.locations).filter(
      (l) => l.kind === 'RECRUITER' && l.region === 'AFRICA'
    );
    if (africaRecruiters.length === 0) return;
    recNode = prng.pick(africaRecruiters);
    originName = prng.pick(AFRICA_ORIGINS);
    originRegion = 'AFRICA';
    // Africa chums want to get to Europe or UK
    desiredRegion = prng.chance(0.5) ? 'EUROPE' : 'UK';
  } else {
    const europeRecruiters = Object.values(state.locations).filter(
      (l) => l.kind === 'RECRUITER' && l.region === 'EUROPE'
    );
    if (europeRecruiters.length === 0) return;
    recNode = prng.pick(europeRecruiters);
    originName = prng.pick(EUROPE_ORIGINS);
    originRegion = 'EUROPE';
    // Europe chums want to get to UK
    desiredRegion = 'UK';
  }

  const id = `CHUM_${chumSeq++}`;
  const firstName = prng.pick(FIRST_NAMES);
  const lastName = prng.pick(LAST_NAMES);
  const name = `${firstName} ${lastName}`;

  const chum: ChumigrantState = {
    id,
    name,
    originName,
    originRegion,
    desiredRegion,
    originId: recNode.id,
    cash: prng.nextInt(250, 750),
    patienceRemainingTicks: prng.nextInt(1500, 3000),
    status: 'WAITING',
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
      `[Tick ${state.tick}] Originated in ${originName} (${originRegion}), arrived at ${recNode.name} seeking passage to ${desiredRegion}.`,
    ],
  };

  state.chumigrants[id] = chum;
  state.stats.activeChums++;

  events.push({
    id: `EVT_SPAWN_${id}`,
    tick: state.tick,
    type: 'CHUM_SPAWNED',
    description: `${name} (${originName}, ${originRegion}) appeared at ${recNode.name} seeking passage to ${desiredRegion}.`,
    importance: 'LOW',
    locationId: recNode.id,
  });
}
