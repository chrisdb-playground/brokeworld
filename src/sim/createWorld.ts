import type {
  LocationDef,
  PhysicalConnectionDef,
  GangState,
  OperationState,
  RouteServiceState,
  WorldSnapshot,
} from './types';
import type { SeededPrng } from './rng';
import { ensureGangNodesStaffed, hireHood, resetHoodSeq } from './hoods';

export function createInitialWorld(prng: SeededPrng): WorldSnapshot {
  resetHoodSeq(1);
  const seed = prng.getSeed();

  // 1. Locations in 3 Regions (AFRICA, EUROPE, UK)
  // All nodes are owned by a single gang
  // Recruiter: crusher mk3
  // Depot: pressure-tank mk1
  // HQ: logistics-hub mk1
  // Workshop: industrial-press mk1
  const locations: Record<string, LocationDef> = {
    // === GANG NEON GILL ===
    HQ_NEON: {
      id: 'HQ_NEON',
      name: 'Neon European HQ',
      region: 'EUROPE',
      x: 120,
      y: 340,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'GANG_NEON_GILL',
    },
    WORKSHOP_NEON: {
      id: 'WORKSHOP_NEON',
      name: 'Neon Workshop',
      region: 'EUROPE',
      x: 120,
      y: 440,
      tileFamily: 'industrial-press',
      tileVariant: 'mk1-north',
      kind: 'WORKSHOP',
      gangId: 'GANG_NEON_GILL',
    },
    REC_NEON_AFRICA: {
      id: 'REC_NEON_AFRICA',
      name: 'Neon Tripoli Recruiter',
      region: 'AFRICA',
      x: 200,
      y: 620,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'GANG_NEON_GILL',
    },
    DEPOT_NEON_EUROPE: {
      id: 'DEPOT_NEON_EUROPE',
      name: 'Neon Marseille Depot',
      region: 'EUROPE',
      x: 200,
      y: 410,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'GANG_NEON_GILL',
    },
    REC_NEON_EUROPE: {
      id: 'REC_NEON_EUROPE',
      name: 'Neon Calais Recruiter',
      region: 'EUROPE',
      x: 260,
      y: 260,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'GANG_NEON_GILL',
    },
    DEPOT_NEON_UK: {
      id: 'DEPOT_NEON_UK',
      name: 'Neon Dover Depot',
      region: 'UK',
      x: 260,
      y: 120,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'GANG_NEON_GILL',
    },

    // === GANG CRIMSON CLAW ===
    HQ_CRIMSON: {
      id: 'HQ_CRIMSON',
      name: 'Crimson Central HQ',
      region: 'EUROPE',
      x: 400,
      y: 340,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'GANG_CRIMSON_CLAW',
    },
    WORKSHOP_CRIMSON: {
      id: 'WORKSHOP_CRIMSON',
      name: 'Crimson Workshop',
      region: 'EUROPE',
      x: 400,
      y: 440,
      tileFamily: 'industrial-press',
      tileVariant: 'mk1-north',
      kind: 'WORKSHOP',
      gangId: 'GANG_CRIMSON_CLAW',
    },
    REC_CRIMSON_AFRICA: {
      id: 'REC_CRIMSON_AFRICA',
      name: 'Crimson Tangier Recruiter',
      region: 'AFRICA',
      x: 500,
      y: 620,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'GANG_CRIMSON_CLAW',
    },
    DEPOT_CRIMSON_EUROPE: {
      id: 'DEPOT_CRIMSON_EUROPE',
      name: 'Crimson Madrid Depot',
      region: 'EUROPE',
      x: 500,
      y: 410,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'GANG_CRIMSON_CLAW',
    },
    REC_CRIMSON_EUROPE: {
      id: 'REC_CRIMSON_EUROPE',
      name: 'Crimson Dunkirk Recruiter',
      region: 'EUROPE',
      x: 540,
      y: 260,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'GANG_CRIMSON_CLAW',
    },
    DEPOT_CRIMSON_UK: {
      id: 'DEPOT_CRIMSON_UK',
      name: 'Crimson Folkestone Depot',
      region: 'UK',
      x: 540,
      y: 120,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'GANG_CRIMSON_CLAW',
    },

    // === GANG AMBER FIN ===
    HQ_AMBER: {
      id: 'HQ_AMBER',
      name: 'Amber Maritime HQ',
      region: 'EUROPE',
      x: 900,
      y: 340,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'GANG_AMBER_FIN',
    },
    WORKSHOP_AMBER: {
      id: 'WORKSHOP_AMBER',
      name: 'Amber Workshop',
      region: 'EUROPE',
      x: 900,
      y: 440,
      tileFamily: 'industrial-press',
      tileVariant: 'mk1-north',
      kind: 'WORKSHOP',
      gangId: 'GANG_AMBER_FIN',
    },
    REC_AMBER_AFRICA: {
      id: 'REC_AMBER_AFRICA',
      name: 'Amber Alexandria Recruiter',
      region: 'AFRICA',
      x: 800,
      y: 620,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'GANG_AMBER_FIN',
    },
    DEPOT_AMBER_EUROPE: {
      id: 'DEPOT_AMBER_EUROPE',
      name: 'Amber Genoa Depot',
      region: 'EUROPE',
      x: 800,
      y: 410,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'GANG_AMBER_FIN',
    },
    REC_AMBER_EUROPE: {
      id: 'REC_AMBER_EUROPE',
      name: 'Amber Cherbourg Recruiter',
      region: 'EUROPE',
      x: 780,
      y: 260,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'GANG_AMBER_FIN',
    },
    DEPOT_AMBER_UK: {
      id: 'DEPOT_AMBER_UK',
      name: 'Amber Portsmouth Depot',
      region: 'UK',
      x: 780,
      y: 120,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'GANG_AMBER_FIN',
    },
  };

  // 2. Physical Connections (RECRUITER -> DEPOT cross-border only)
  const connectionsList: PhysicalConnectionDef[] = [
    // Africa to Europe
    { id: 'CONN_NEON_AFR_EUR', sourceId: 'REC_NEON_AFRICA', targetId: 'DEPOT_NEON_EUROPE', isCrossBorder: true, distance: 380, mode: 'SEA' },
    { id: 'CONN_CRIMSON_AFR_EUR', sourceId: 'REC_CRIMSON_AFRICA', targetId: 'DEPOT_CRIMSON_EUROPE', isCrossBorder: true, distance: 380, mode: 'SEA' },
    { id: 'CONN_AMBER_AFR_EUR', sourceId: 'REC_AMBER_AFRICA', targetId: 'DEPOT_AMBER_EUROPE', isCrossBorder: true, distance: 380, mode: 'SEA' },

    // Europe to UK
    { id: 'CONN_NEON_EUR_UK', sourceId: 'REC_NEON_EUROPE', targetId: 'DEPOT_NEON_UK', isCrossBorder: true, distance: 220, mode: 'SEA' },
    { id: 'CONN_CRIMSON_EUR_UK', sourceId: 'REC_CRIMSON_EUROPE', targetId: 'DEPOT_CRIMSON_UK', isCrossBorder: true, distance: 220, mode: 'SEA' },
    { id: 'CONN_AMBER_EUR_UK', sourceId: 'REC_AMBER_EUROPE', targetId: 'DEPOT_AMBER_UK', isCrossBorder: true, distance: 220, mode: 'SEA' },
  ];

  const connections: Record<string, PhysicalConnectionDef> = {};
  for (const c of connectionsList) {
    connections[c.id] = c;
  }

  // 3. Gangs
  const gangs: Record<string, GangState> = {
    GANG_NEON_GILL: {
      id: 'GANG_NEON_GILL',
      name: 'Neon Gill Syndicate',
      color: '#06b6d4',
      colorNum: 0x06b6d4,
      emblem: '✦',
      hqLocationId: 'HQ_NEON',
      workshopLocationId: 'WORKSHOP_NEON',
      recruiterLocationIds: ['REC_NEON_AFRICA', 'REC_NEON_EUROPE'],
      depotLocationIds: ['DEPOT_NEON_EUROPE', 'DEPOT_NEON_UK'],
      cash: 18000,
      reputation: 75,
      status: 'ACTIVE',
      recentDecisions: [
        { tick: 0, action: 'FOUND_GANG', reason: 'Established Mediterranean and Channel smuggling operations.' },
      ],
      stats: {
        recruitsTotal: 0,
        voyagesLaunched: 0,
        voyagesSuccessful: 0,
        voyagesDisrupted: 0,
        revenueTotal: 0,
      },
    },
    GANG_CRIMSON_CLAW: {
      id: 'GANG_CRIMSON_CLAW',
      name: 'Crimson Claw',
      color: '#ef4444',
      colorNum: 0xef4444,
      emblem: '▲',
      hqLocationId: 'HQ_CRIMSON',
      workshopLocationId: 'WORKSHOP_CRIMSON',
      recruiterLocationIds: ['REC_CRIMSON_AFRICA', 'REC_CRIMSON_EUROPE'],
      depotLocationIds: ['DEPOT_CRIMSON_EUROPE', 'DEPOT_CRIMSON_UK'],
      cash: 19000,
      reputation: 70,
      status: 'ACTIVE',
      recentDecisions: [
        { tick: 0, action: 'FOUND_GANG', reason: 'Secured Tangier and Dunkirk cross-border routes.' },
      ],
      stats: {
        recruitsTotal: 0,
        voyagesLaunched: 0,
        voyagesSuccessful: 0,
        voyagesDisrupted: 0,
        revenueTotal: 0,
      },
    },
    GANG_AMBER_FIN: {
      id: 'GANG_AMBER_FIN',
      name: 'Amber Fin Cartel',
      color: '#f59e0b',
      colorNum: 0xf59e0b,
      emblem: '◆',
      hqLocationId: 'HQ_AMBER',
      workshopLocationId: 'WORKSHOP_AMBER',
      recruiterLocationIds: ['REC_AMBER_AFRICA', 'REC_AMBER_EUROPE'],
      depotLocationIds: ['DEPOT_AMBER_EUROPE', 'DEPOT_AMBER_UK'],
      cash: 20000,
      reputation: 80,
      status: 'ACTIVE',
      recentDecisions: [
        { tick: 0, action: 'FOUND_GANG', reason: 'Secured Mediterranean deepwater and Portsmouth sea routes.' },
      ],
      stats: {
        recruitsTotal: 0,
        voyagesLaunched: 0,
        voyagesSuccessful: 0,
        voyagesDisrupted: 0,
        revenueTotal: 0,
      },
    },
  };

  // 4. Initial Operations
  const operations: Record<string, OperationState> = {
    OP_HQ_NEON: { id: 'OP_HQ_NEON', gangId: 'GANG_NEON_GILL', locationId: 'HQ_NEON', type: 'HQ', status: 'ACTIVE', openedTick: 0 },
    OP_WS_NEON: { id: 'OP_WS_NEON', gangId: 'GANG_NEON_GILL', locationId: 'WORKSHOP_NEON', type: 'WORKSHOP', status: 'ACTIVE', openedTick: 0 },
    OP_REC_NEON_AFR: { id: 'OP_REC_NEON_AFR', gangId: 'GANG_NEON_GILL', locationId: 'REC_NEON_AFRICA', type: 'RECRUITER', status: 'ACTIVE', openedTick: 0 },
    OP_REC_NEON_EUR: { id: 'OP_REC_NEON_EUR', gangId: 'GANG_NEON_GILL', locationId: 'REC_NEON_EUROPE', type: 'RECRUITER', status: 'ACTIVE', openedTick: 0 },

    OP_HQ_CRIMSON: { id: 'OP_HQ_CRIMSON', gangId: 'GANG_CRIMSON_CLAW', locationId: 'HQ_CRIMSON', type: 'HQ', status: 'ACTIVE', openedTick: 0 },
    OP_WS_CRIMSON: { id: 'OP_WS_CRIMSON', gangId: 'GANG_CRIMSON_CLAW', locationId: 'WORKSHOP_CRIMSON', type: 'WORKSHOP', status: 'ACTIVE', openedTick: 0 },
    OP_REC_CRIM_AFR: { id: 'OP_REC_CRIM_AFR', gangId: 'GANG_CRIMSON_CLAW', locationId: 'REC_CRIMSON_AFRICA', type: 'RECRUITER', status: 'ACTIVE', openedTick: 0 },
    OP_REC_CRIM_EUR: { id: 'OP_REC_CRIM_EUR', gangId: 'GANG_CRIMSON_CLAW', locationId: 'REC_CRIMSON_EUROPE', type: 'RECRUITER', status: 'ACTIVE', openedTick: 0 },

    OP_HQ_AMBER: { id: 'OP_HQ_AMBER', gangId: 'GANG_AMBER_FIN', locationId: 'HQ_AMBER', type: 'HQ', status: 'ACTIVE', openedTick: 0 },
    OP_WS_AMBER: { id: 'OP_WS_AMBER', gangId: 'GANG_AMBER_FIN', locationId: 'WORKSHOP_AMBER', type: 'WORKSHOP', status: 'ACTIVE', openedTick: 0 },
    OP_REC_AMB_AFR: { id: 'OP_REC_AMB_AFR', gangId: 'GANG_AMBER_FIN', locationId: 'REC_AMBER_AFRICA', type: 'RECRUITER', status: 'ACTIVE', openedTick: 0 },
    OP_REC_AMB_EUR: { id: 'OP_REC_AMB_EUR', gangId: 'GANG_AMBER_FIN', locationId: 'REC_AMBER_EUROPE', type: 'RECRUITER', status: 'ACTIVE', openedTick: 0 },
  };

  // 5. Routes: 1 route max between nodes, Recruiter -> Depot ONLY
  const routes: Record<string, RouteServiceState> = {
    ROUTE_NEON_AFR_EUR: {
      id: 'ROUTE_NEON_AFR_EUR',
      gangId: 'GANG_NEON_GILL',
      connectionId: 'CONN_NEON_AFR_EUR',
      sourceId: 'REC_NEON_AFRICA',
      targetId: 'DEPOT_NEON_EUROPE',
      mode: 'BOAT',
      capacity: 4,
      price: 340,
      durationTicks: 70,
      reliability: 0.98,
      status: 'ACTIVE',
      totalPassengers: 0,
      revenue: 0,
      activeVoyageCount: 0,
    },
    ROUTE_NEON_EUR_UK: {
      id: 'ROUTE_NEON_EUR_UK',
      gangId: 'GANG_NEON_GILL',
      connectionId: 'CONN_NEON_EUR_UK',
      sourceId: 'REC_NEON_EUROPE',
      targetId: 'DEPOT_NEON_UK',
      mode: 'BOAT',
      capacity: 4,
      price: 280,
      durationTicks: 55,
      reliability: 0.98,
      status: 'ACTIVE',
      totalPassengers: 0,
      revenue: 0,
      activeVoyageCount: 0,
    },

    ROUTE_CRIMSON_AFR_EUR: {
      id: 'ROUTE_CRIMSON_AFR_EUR',
      gangId: 'GANG_CRIMSON_CLAW',
      connectionId: 'CONN_CRIMSON_AFR_EUR',
      sourceId: 'REC_CRIMSON_AFRICA',
      targetId: 'DEPOT_CRIMSON_EUROPE',
      mode: 'BOAT',
      capacity: 5,
      price: 310,
      durationTicks: 65,
      reliability: 0.96,
      status: 'ACTIVE',
      totalPassengers: 0,
      revenue: 0,
      activeVoyageCount: 0,
    },
    ROUTE_CRIMSON_EUR_UK: {
      id: 'ROUTE_CRIMSON_EUR_UK',
      gangId: 'GANG_CRIMSON_CLAW',
      connectionId: 'CONN_CRIMSON_EUR_UK',
      sourceId: 'REC_CRIMSON_EUROPE',
      targetId: 'DEPOT_CRIMSON_UK',
      mode: 'BOAT',
      capacity: 5,
      price: 270,
      durationTicks: 50,
      reliability: 0.96,
      status: 'ACTIVE',
      totalPassengers: 0,
      revenue: 0,
      activeVoyageCount: 0,
    },

    ROUTE_AMBER_AFR_EUR: {
      id: 'ROUTE_AMBER_AFR_EUR',
      gangId: 'GANG_AMBER_FIN',
      connectionId: 'CONN_AMBER_AFR_EUR',
      sourceId: 'REC_AMBER_AFRICA',
      targetId: 'DEPOT_AMBER_EUROPE',
      mode: 'BOAT',
      capacity: 6,
      price: 350,
      durationTicks: 75,
      reliability: 0.97,
      status: 'ACTIVE',
      totalPassengers: 0,
      revenue: 0,
      activeVoyageCount: 0,
    },
    ROUTE_AMBER_EUR_UK: {
      id: 'ROUTE_AMBER_EUR_UK',
      gangId: 'GANG_AMBER_FIN',
      connectionId: 'CONN_AMBER_EUR_UK',
      sourceId: 'REC_AMBER_EUROPE',
      targetId: 'DEPOT_AMBER_UK',
      mode: 'BOAT',
      capacity: 6,
      price: 290,
      durationTicks: 60,
      reliability: 0.97,
      status: 'ACTIVE',
      totalPassengers: 0,
      revenue: 0,
      activeVoyageCount: 0,
    },
  };

  const snapshot: WorldSnapshot = {
    tick: 0,
    seed,
    locations,
    connections,
    gangs,
    operations,
    routes,
    chumigrants: {},
    voyages: {},
    hoods: {},
    events: [
      {
        id: 'EVT_INIT_0',
        tick: 0,
        type: 'GANG_FOUNDED',
        description: 'Chum World initialized with 3 regions: North Africa, West Europe, and United Kingdom.',
        importance: 'HIGH',
      },
    ],
    stats: {
      activeChums: 0,
      totalDepartedChums: 0,
      totalVoyagesLaunched: 0,
      totalVoyagesSuccess: 0,
      totalVoyagesDisrupted: 0,
      totalActiveRoutes: Object.keys(routes).length,
      totalHoodsEmployed: 0,
    },
  };

  // Staff all gang nodes with Hoods & hire 1 reserve skipper at HQ
  for (const gang of Object.values(snapshot.gangs)) {
    ensureGangNodesStaffed(snapshot, gang, prng);
    hireHood(
      snapshot,
      gang.id,
      'STANDBY',
      { type: 'IDLE_HQ', targetId: gang.hqLocationId, role: 'STANDBY' },
      prng
    );
  }

  snapshot.stats.totalHoodsEmployed = Object.keys(snapshot.hoods).length;

  return snapshot;
}
