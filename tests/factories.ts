import type {
  WorldSnapshot,
  GangState,
  LocationDef,
  RouteServiceState,
  MigrantState,
  HoodState,
  VoyageState,
  PhysicalConnectionDef,
  MigrantAvatarSpec,
  SimStats,
  RegionId,
  LocationKind,
} from '../src/sim/types';

export function createMockAvatar(overrides?: Partial<MigrantAvatarSpec>): MigrantAvatarSpec {
  return {
    skinTone: '#fcd34d',
    shirtColor: '#38bdf8',
    eyesType: 'dots',
    mouthType: 'smile',
    hairColor: '#1e293b',
    hairStyle: 'short',
    luggage: 'backpack',
    ...overrides,
  };
}

export function createMockGang(overrides?: Partial<GangState>): GangState {
  const id = overrides?.id || 'GANG_MOCK';
  return {
    id,
    name: overrides?.name || 'Mock Gang Syndicate',
    color: overrides?.color || '#06b6d4',
    colorNum: overrides?.colorNum || 0x06b6d4,
    emblem: '🐟',
    hqLocationId: overrides?.hqLocationId || `HQ_${id}`,
    mainHqLocationId: overrides?.mainHqLocationId || `HQ_${id}`,
    hqLocationIds: overrides?.hqLocationIds || [`HQ_${id}`],
    recruiterLocationIds: [],
    depotLocationIds: [],
    cash: overrides?.cash ?? 10000,
    reputation: overrides?.reputation ?? 50,
    status: overrides?.status || 'ACTIVE',
    recentDecisions: [],
    discoveredNodeIds: [],
    discoveredRouteIds: [],
    wageBillTotal: 0,
    stats: {
      recruitsTotal: 0,
      voyagesLaunched: 0,
      voyagesSuccessful: 0,
      voyagesDisrupted: 0,
      revenueTotal: 0,
      ...overrides?.stats,
    },
    ...overrides,
  };
}

export function createMockLocation(overrides?: Partial<LocationDef>): LocationDef {
  const id = overrides?.id || 'LOC_MOCK';
  const region: RegionId = overrides?.region || 'EUROPE';
  const kind: LocationKind = overrides?.kind || 'HQ';
  return {
    id,
    name: overrides?.name || `Mock ${kind} Location`,
    region,
    x: overrides?.x ?? 200,
    y: overrides?.y ?? 400,
    tileFamily: overrides?.tileFamily || 'logistics-hub',
    tileVariant: overrides?.tileVariant || 'mk1',
    kind,
    gangId: overrides?.gangId || 'GANG_MOCK',
    operationalStatus: overrides?.operationalStatus || 'ACTIVE',
    influenceRadius: kind === 'HQ' ? (overrides?.influenceRadius ?? 220) : undefined,
    ...overrides,
  };
}

export function createMockConnection(overrides?: Partial<PhysicalConnectionDef>): PhysicalConnectionDef {
  const sourceId = overrides?.sourceId || 'SRC_LOC';
  const targetId = overrides?.targetId || 'TGT_LOC';
  return {
    id: overrides?.id || `CONN_${sourceId}_${targetId}`,
    sourceId,
    targetId,
    isCrossBorder: overrides?.isCrossBorder ?? false,
    distance: overrides?.distance ?? 100,
    mode: overrides?.mode || 'LAND',
    ...overrides,
  };
}

export function createMockRoute(overrides?: Partial<RouteServiceState>): RouteServiceState {
  const sourceId = overrides?.sourceId || 'REC_MOCK';
  const targetId = overrides?.targetId || 'DEP_MOCK';
  return {
    id: overrides?.id || `ROUTE_${sourceId}_${targetId}`,
    gangId: overrides?.gangId || 'GANG_MOCK',
    connectionId: overrides?.connectionId || `CONN_${sourceId}_${targetId}`,
    sourceId,
    targetId,
    mode: overrides?.mode || 'BOAT',
    isCrossBorder: overrides?.isCrossBorder ?? false,
    operationalStatus: overrides?.operationalStatus || 'ACTIVE',
    capacity: overrides?.capacity ?? 4,
    price: overrides?.price ?? 1200,
    durationTicks: overrides?.durationTicks ?? 40,
    reliability: overrides?.reliability ?? 0.95,
    status: overrides?.status || 'ACTIVE',
    totalPassengers: overrides?.totalPassengers ?? 0,
    revenue: overrides?.revenue ?? 0,
    activeVoyageCount: overrides?.activeVoyageCount ?? 0,
    ...overrides,
  };
}

export function createMockMigrant(overrides?: Partial<MigrantState>): MigrantState {
  const id = overrides?.id || 'MIGRANT_MOCK_1';
  return {
    id,
    name: overrides?.name || 'Mock Migrant',
    originName: overrides?.originName || 'Tripoli',
    originRegion: overrides?.originRegion || 'AFRICA',
    desiredRegion: overrides?.desiredRegion || 'EUROPE',
    originId: overrides?.originId || 'REC_MOCK',
    cash: overrides?.cash ?? 2500,
    patienceRemainingTicks: overrides?.patienceRemainingTicks ?? 150,
    status: overrides?.status || 'WAITING',
    avatar: createMockAvatar(overrides?.avatar),
    history: overrides?.history || ['[Tick 0] Arrived seeking transport.'],
    ...overrides,
  };
}


export function createMockHood(overrides?: Partial<HoodState>): HoodState {
  const id = overrides?.id || 'HOOD_MOCK_1';
  const gangId = overrides?.gangId || 'GANG_MOCK';
  return {
    id,
    name: overrides?.name || 'Mock Hood Operator',
    gangId,
    role: overrides?.role || 'RECRUITER_MANAGER',
    assignment: overrides?.assignment || {
      type: 'MANAGE_NODE',
      targetId: 'REC_MOCK',
      role: 'RECRUITER_MANAGER',
    },
    currentTaskDescription: overrides?.currentTaskDescription || 'Managing node operations',
    avatar: createMockAvatar(overrides?.avatar),
    hiredTick: overrides?.hiredTick ?? 0,
    history: overrides?.history || ['[Tick 0] Recruited by gang.'],
    ...overrides,
  };
}

export function createMockVoyage(overrides?: Partial<VoyageState>): VoyageState {
  const id = overrides?.id || 'VOYAGE_MOCK_1';
  return {
    id,
    gangId: overrides?.gangId || 'GANG_MOCK',
    routeId: overrides?.routeId || 'ROUTE_MOCK',
    sourceId: overrides?.sourceId || 'REC_MOCK',
    targetId: overrides?.targetId || 'DEP_MOCK',
    mode: overrides?.mode || 'BOAT',
    passengerIds: overrides?.passengerIds || [],
    startTick: overrides?.startTick ?? 0,
    durationTicks: overrides?.durationTicks ?? 40,
    progress: overrides?.progress ?? 0,
    status: overrides?.status || 'IN_PROGRESS',
    captainHoodId: overrides?.captainHoodId || 'HOOD_SKIPPER_1',
    ...overrides,
  };
}

export function createMockStats(overrides?: Partial<SimStats>): SimStats {
  return {
    activeMigrants: 0,
    totalDepartedMigrants: 0,
    totalVoyagesLaunched: 0,
    totalVoyagesSuccess: 0,
    totalVoyagesDisrupted: 0,
    totalActiveRoutes: 0,
    totalHoodsEmployed: 0,
    ...overrides,
  };
}

export function createMockWorld(overrides?: Partial<WorldSnapshot>): WorldSnapshot {
  return {
    tick: overrides?.tick ?? 0,
    seed: overrides?.seed ?? 1337,
    locations: overrides?.locations ?? {},
    connections: overrides?.connections ?? {},
    gangs: overrides?.gangs ?? {},
    operations: overrides?.operations ?? {},
    routes: overrides?.routes ?? {},
    migrants: overrides?.migrants ?? {},
    voyages: overrides?.voyages ?? {},
    hoods: overrides?.hoods ?? {},
    events: overrides?.events ?? [],
    stats: createMockStats(overrides?.stats),
    ...overrides,
  };
}
