import type {
  LocationDef,
  PhysicalConnectionDef,
  GangState,
  OperationState,
  RouteServiceState,
  WorldSnapshot,
} from './types';
import type { SeededPrng } from './rng';
import { hireHood, resetHoodSeq } from './hoods';

export function createInitialWorld(prng: SeededPrng): WorldSnapshot {
  resetHoodSeq(1);
  const seed = prng.getSeed();

  // 1. Initial Starting World:
  // Gangs start with a pot of money ($8,000) and ONLY their single Main HQ in their home region.
  // All other locations in the world start as unowned candidate nodes ('DISCOVERED_CANDIDATE', 'NEUTRAL')
  // waiting to be scouted by Scout Hoods and purchased gradually.
  const locations: Record<string, LocationDef> = {
    // === GANG NEON GILL (Starts Europe with Main HQ) ===
    HQ_NEON: {
      id: 'HQ_NEON',
      name: 'Neon European HQ',
      region: 'EUROPE',
      x: 140,
      y: 430,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'GANG_NEON_GILL',
      isMainHq: true,
      operationalStatus: 'ACTIVE',
      influenceRadius: 220,
    },

    // === GANG CRIMSON CLAW (Starts Europe with Main HQ) ===
    HQ_CRIMSON: {
      id: 'HQ_CRIMSON',
      name: 'Crimson Central HQ',
      region: 'EUROPE',
      x: 560,
      y: 430,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'GANG_CRIMSON_CLAW',
      isMainHq: true,
      operationalStatus: 'ACTIVE',
      influenceRadius: 220,
    },

    // === GANG AMBER FIN (Starts Africa with Main HQ) ===
    HQ_AMBER_AFRICA: {
      id: 'HQ_AMBER_AFRICA',
      name: 'Amber Alexandria Citadel HQ',
      region: 'AFRICA',
      x: 980,
      y: 1000,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'GANG_AMBER_FIN',
      isMainHq: true,
      operationalStatus: 'ACTIVE',
      influenceRadius: 220,
    },

    // ==========================================
    // CANDIDATE UNOWNED NODES (For Scouting & Purchase)
    // ==========================================
    // Candidate Regional HQs:
    CAND_HQ_NEON_AFR: {
      id: 'CAND_HQ_NEON_AFR',
      name: 'Tripoli Safehouse HQ Site',
      region: 'AFRICA',
      x: 260,
      y: 1000,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 2200,
    },
    CAND_HQ_CRIM_UK: {
      id: 'CAND_HQ_CRIM_UK',
      name: 'London Thameside HQ Site',
      region: 'UK',
      x: 620,
      y: 70,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 2200,
    },
    CAND_HQ_AMB_EUR: {
      id: 'CAND_HQ_AMB_EUR',
      name: 'Marseille Maritime HQ Site',
      region: 'EUROPE',
      x: 1000,
      y: 430,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 2200,
    },

    // ==========================================
    // CANDIDATE UNOWNED NODES (For Scouting & Purchase)
    // ==========================================
    // Region West:
    CAND_REC_NEON_AFR: {
      id: 'CAND_REC_NEON_AFR',
      name: 'Tripoli Coastal Pier Recruiter',
      region: 'AFRICA',
      x: 160,
      y: 930,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1500,
    },
    CAND_DEPOT_NEON_EUR: {
      id: 'CAND_DEPOT_NEON_EUR',
      name: 'Marseille Deepwater Depot',
      region: 'EUROPE',
      x: 220,
      y: 590,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1200,
    },
    CAND_WS_NEON: {
      id: 'CAND_WS_NEON',
      name: 'Rhone Heavy Machine Workshop',
      region: 'EUROPE',
      x: 80,
      y: 510,
      tileFamily: 'industrial-press',
      tileVariant: 'mk1-north',
      kind: 'WORKSHOP',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 2000,
    },
    CAND_REC_NEON_EUR: {
      id: 'CAND_REC_NEON_EUR',
      name: 'Calais Channel Recruiter',
      region: 'EUROPE',
      x: 320,
      y: 350,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1500,
    },
    CAND_DEPOT_NEON_UK: {
      id: 'CAND_DEPOT_NEON_UK',
      name: 'Dover White Cliffs Depot',
      region: 'UK',
      x: 300,
      y: 70,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1200,
    },
    CAND_HQ_NEON_UK: {
      id: 'CAND_HQ_NEON_UK',
      name: 'Dover Harbour Safehouse HQ',
      region: 'UK',
      x: 200,
      y: 70,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 2200,
    },

    // Region Central:
    CAND_REC_CRIM_AFR: {
      id: 'CAND_REC_CRIM_AFR',
      name: 'Tangier Strait Recruiter',
      region: 'AFRICA',
      x: 620,
      y: 930,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1500,
    },
    CAND_DEPOT_CRIM_EUR: {
      id: 'CAND_DEPOT_CRIM_EUR',
      name: 'Barcelona Coastal Depot',
      region: 'EUROPE',
      x: 500,
      y: 590,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1200,
    },
    CAND_WS_CRIMSON: {
      id: 'CAND_WS_CRIMSON',
      name: 'Pyrenees Transit Workshop',
      region: 'EUROPE',
      x: 620,
      y: 510,
      tileFamily: 'industrial-press',
      tileVariant: 'mk1-north',
      kind: 'WORKSHOP',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 2000,
    },
    CAND_REC_CRIM_EUR: {
      id: 'CAND_REC_CRIM_EUR',
      name: 'Dunkirk Coast Recruiter',
      region: 'EUROPE',
      x: 660,
      y: 350,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1500,
    },
    CAND_DEPOT_CRIM_UK: {
      id: 'CAND_DEPOT_CRIM_UK',
      name: 'Thames Estuary Depot',
      region: 'UK',
      x: 700,
      y: 70,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1200,
    },
    CAND_HQ_CRIM_AFR: {
      id: 'CAND_HQ_CRIM_AFR',
      name: 'Tangier Kasbah HQ Site',
      region: 'AFRICA',
      x: 720,
      y: 1000,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 2200,
    },

    // Region East:
    CAND_REC_AMB_AFR: {
      id: 'CAND_REC_AMB_AFR',
      name: 'Alexandria Delta Recruiter',
      region: 'AFRICA',
      x: 1080,
      y: 930,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1500,
    },
    CAND_DEPOT_AMB_EUR: {
      id: 'CAND_DEPOT_AMB_EUR',
      name: 'Genoa Port Depot',
      region: 'EUROPE',
      x: 980,
      y: 590,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1200,
    },
    CAND_WS_AMBER: {
      id: 'CAND_WS_AMBER',
      name: 'Lombardy Smuggling Fleet Workshop',
      region: 'EUROPE',
      x: 1140,
      y: 510,
      tileFamily: 'industrial-press',
      tileVariant: 'mk1-north',
      kind: 'WORKSHOP',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 2000,
    },
    CAND_REC_AMB_EUR: {
      id: 'CAND_REC_AMB_EUR',
      name: 'Cherbourg Peninsula Recruiter',
      region: 'EUROPE',
      x: 880,
      y: 350,
      tileFamily: 'crusher',
      tileVariant: 'mk3',
      kind: 'RECRUITER',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1500,
    },
    CAND_DEPOT_AMB_UK: {
      id: 'CAND_DEPOT_AMB_UK',
      name: 'Portsmouth Marine Depot',
      region: 'UK',
      x: 900,
      y: 70,
      tileFamily: 'pressure-tank',
      tileVariant: 'mk1-north',
      kind: 'DEPOT',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1200,
    },
    CAND_HQ_AMB_UK: {
      id: 'CAND_HQ_AMB_UK',
      name: 'Portsmouth Solent HQ Site',
      region: 'UK',
      x: 1000,
      y: 70,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 2200,
    },
  };

  // 2. Gangs start with a pot of money ($10,000), 1 single Main HQ, and 0 pre-owned candidate nodes/routes
  const gangs: Record<string, GangState> = {
    GANG_NEON_GILL: {
      id: 'GANG_NEON_GILL',
      name: 'Neon Gill Syndicate',
      color: '#06b6d4',
      colorNum: 0x06b6d4,
      emblem: '✦',
      hqLocationId: 'HQ_NEON',
      mainHqLocationId: 'HQ_NEON',
      hqLocationIds: ['HQ_NEON'],
      workshopLocationId: undefined,
      recruiterLocationIds: [],
      depotLocationIds: [],
      cash: 10000,
      reputation: 75,
      status: 'ACTIVE',
      discoveredNodeIds: [],
      discoveredRouteIds: [],
      wageBillTotal: 30,
      recentDecisions: [
        { tick: 0, action: 'FOUND_GANG', reason: 'Chartered syndicate with European Main HQ.' },
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
      mainHqLocationId: 'HQ_CRIMSON',
      hqLocationIds: ['HQ_CRIMSON'],
      workshopLocationId: undefined,
      recruiterLocationIds: [],
      depotLocationIds: [],
      cash: 10000,
      reputation: 70,
      status: 'ACTIVE',
      discoveredNodeIds: [],
      discoveredRouteIds: [],
      wageBillTotal: 30,
      recentDecisions: [
        { tick: 0, action: 'FOUND_GANG', reason: 'Chartered syndicate with Central European Main HQ.' },
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
      hqLocationId: 'HQ_AMBER_AFRICA',
      mainHqLocationId: 'HQ_AMBER_AFRICA',
      hqLocationIds: ['HQ_AMBER_AFRICA'],
      workshopLocationId: undefined,
      recruiterLocationIds: [],
      depotLocationIds: [],
      cash: 10000,
      reputation: 80,
      status: 'ACTIVE',
      discoveredNodeIds: [],
      discoveredRouteIds: [],
      wageBillTotal: 30,
      recentDecisions: [
        { tick: 0, action: 'FOUND_GANG', reason: 'Chartered cartel with Alexandria Citadel Main HQ.' },
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

  // 3. Initial Operations: 1 Main HQ per gang
  const operations: Record<string, OperationState> = {
    OP_HQ_NEON: { id: 'OP_HQ_NEON', gangId: 'GANG_NEON_GILL', locationId: 'HQ_NEON', type: 'HQ', status: 'ACTIVE', openedTick: 0 },
    OP_HQ_CRIMSON: { id: 'OP_HQ_CRIMSON', gangId: 'GANG_CRIMSON_CLAW', locationId: 'HQ_CRIMSON', type: 'HQ', status: 'ACTIVE', openedTick: 0 },
    OP_HQ_AMB_AFR: { id: 'OP_HQ_AMB_AFR', gangId: 'GANG_AMBER_FIN', locationId: 'HQ_AMBER_AFRICA', type: 'HQ', status: 'ACTIVE', openedTick: 0 },
  };

  const connections: Record<string, PhysicalConnectionDef> = {};
  const routes: Record<string, RouteServiceState> = {};

  const snapshot: WorldSnapshot = {
    tick: 0,
    seed,
    locations,
    connections,
    gangs,
    operations,
    routes,
    migrants: {},
    voyages: {},
    hoods: {},
    events: [
      {
        id: 'EVT_INIT_0',
        tick: 0,
        type: 'GANG_FOUNDED',
        description: 'Broke World initialized. Gangs start with a single Main HQ and Scout Hood to build up gradually.',
        importance: 'HIGH',
      },
    ],
    stats: {
      activeMigrants: 0,
      totalDepartedMigrants: 0,
      totalVoyagesLaunched: 0,
      totalVoyagesSuccess: 0,
      totalVoyagesDisrupted: 0,
      totalActiveRoutes: 0,
      totalHoodsEmployed: 0,
    },
  };

  // Staff each starting HQ with an HQ Boss, and hire 1 starter Scout Hood per gang
  for (const gang of Object.values(snapshot.gangs)) {
    for (const hqId of gang.hqLocationIds || [gang.hqLocationId]) {
      hireHood(
        snapshot,
        gang.id,
        'HQ_BOSS',
        { type: 'MANAGE_NODE', targetId: hqId, role: 'HQ_BOSS' },
        prng
      );
    }

    // 1 Starter Scout Hood stationed at Main HQ
    hireHood(
      snapshot,
      gang.id,
      'SCOUT',
      { type: 'SCOUT_ZONE', targetId: gang.mainHqLocationId || gang.hqLocationId, role: 'SCOUT' },
      prng
    );
  }

  snapshot.stats.totalHoodsEmployed = Object.keys(snapshot.hoods).length;

  return snapshot;
}
