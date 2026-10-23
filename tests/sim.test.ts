import { describe, it, expect } from 'vitest';
import { createPrng } from '../src/sim/rng';
import { createInitialWorld } from '../src/sim/createWorld';
import { tickWorld } from '../src/sim/tick';
import { processRecruitment } from '../src/sim/recruitment';
import { LocalGameEngine } from '../src/app/GamePort';
import { executeClaimCandidateNode, executePurchaseBorderRoute } from '../src/sim/influence';

describe('Chum World Simulation Core', () => {
  it('is completely deterministic across runs with the same seed', () => {
    const prng1 = createPrng(42);
    const prng2 = createPrng(42);

    let state1 = createInitialWorld(prng1);
    let state2 = createInitialWorld(prng2);

    for (let i = 0; i < 150; i++) {
      state1 = tickWorld(state1, prng1);
      state2 = tickWorld(state2, prng2);
    }

    expect(state1.tick).toBe(state2.tick);
    expect(state1.stats.activeChums).toBe(state2.stats.activeChums);
    expect(state1.stats.totalVoyagesLaunched).toBe(state2.stats.totalVoyagesLaunched);
    expect(Object.keys(state1.routes).length).toBe(Object.keys(state2.routes).length);
  });

  it('enforces that all nodes are owned by a single gang and 1 route max between nodes', () => {
    const engine = new LocalGameEngine(99);
    const state = engine.getSnapshot();

    // Check all nodes have owner gang or neutral candidate
    for (const loc of Object.values(state.locations)) {
      expect(loc.gangId).toBeDefined();
      if (loc.gangId !== 'NEUTRAL') {
        expect(state.gangs[loc.gangId]).toBeDefined();
      }
      expect(['AFRICA', 'EUROPE', 'UK']).toContain(loc.region);
    }

    // Check routes connect nodes owned by the same gang
    const pairCounts = new Map<string, number>();
    for (const route of Object.values(state.routes)) {
      const src = state.locations[route.sourceId];
      const tgt = state.locations[route.targetId];
      expect(src.gangId).toBe(route.gangId);
      expect(tgt.gangId).toBe(route.gangId);

      const key = `${route.sourceId}__${route.targetId}`;
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }

    // 1 route max between nodes
    for (const count of pairCounts.values()) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it('guarantees Chumigrants have origins, appear at Recruiters, and routes connect 3 regions', () => {
    const engine = new LocalGameEngine(777);
    engine.advance(300);
    const state = engine.getSnapshot();

    for (const chum of Object.values(state.chumigrants)) {
      expect(chum.originName).toBeDefined();
      expect(chum.originName.length).toBeGreaterThan(0);
      expect(['AFRICA', 'EUROPE']).toContain(chum.originRegion);
      expect(['EUROPE', 'UK']).toContain(chum.desiredRegion);

      if (chum.status === 'WAITING' || chum.status === 'RECRUITED') {
        const origin = state.locations[chum.originId];
        expect(origin).toBeDefined();
        expect(origin.kind).toBe('RECRUITER');
        expect(origin.tileFamily).toBe('crusher');
        expect(['AFRICA', 'EUROPE']).toContain(origin.region);
      }
    }

    for (const route of Object.values(state.routes)) {
      const src = state.locations[route.sourceId];
      const tgt = state.locations[route.targetId];
      const isRecToDepot = src.kind === 'RECRUITER' && tgt.kind === 'DEPOT';
      const isDepotToWorkshop = src.kind === 'DEPOT' && tgt.kind === 'WORKSHOP';

      expect(isRecToDepot || isDepotToWorkshop).toBe(true);
      if (isRecToDepot) {
        expect(src.tileFamily).toBe('crusher');
        expect(tgt.tileFamily).toBe('pressure-tank');
        expect(['AFRICA', 'EUROPE']).toContain(src.region);
        expect(['EUROPE', 'UK']).toContain(tgt.region);
      } else {
        expect(src.tileFamily).toBe('pressure-tank');
        expect(tgt.tileFamily).toBe('industrial-press');
        expect(src.region).toBe(tgt.region);
        expect(route.mode).toBe('VAN');
      }
    }
  });

  it('leaves chumigrants remaining in the depot when a voyage completes', () => {
    const prng = createPrng(888);
    const state = createInitialWorld(prng);

    // Claim recruiter and depot, and establish border route
    const rec = executeClaimCandidateNode(state, 'GANG_NEON_GILL', 'CAND_REC_NEON_AFR', prng);
    const depot = executeClaimCandidateNode(state, 'GANG_NEON_GILL', 'CAND_DEPOT_NEON_EUR', prng);
    const afrRoute = executePurchaseBorderRoute(state, 'GANG_NEON_GILL', rec.id, depot.id, prng);
    expect(afrRoute).toBeDefined();

    // Create a Chum from Tripoli
    const chum = {
      id: 'CHUM_DEPOT_BOUND',
      name: 'Farouk Fin',
      originName: 'Tripoli',
      originRegion: 'AFRICA' as const,
      desiredRegion: 'EUROPE' as const,
      originId: afrRoute.sourceId,
      cash: 800,
      patienceRemainingTicks: 3000,
      status: 'RECRUITED' as const,
      recruitedByGangId: afrRoute.gangId,
      assignedRouteId: afrRoute.id,
      avatar: {
        skinTone: '#fed7aa',
        shirtColor: '#94a3b8',
        eyesType: 'wide' as const,
        mouthType: 'smile' as const,
        hairColor: '#000',
        hairStyle: 'short' as const,
        luggage: 'backpack' as const,
      },
      history: ['Originated in Tripoli'],
    };
    state.chumigrants[chum.id] = chum;
    state.stats.activeChums = 1;

    const testChum = state.chumigrants['CHUM_DEPOT_BOUND'];

    // Advance until first voyage completes
    for (let i = 0; i < 100; i++) {
      tickWorld(state, prng);
      if (testChum.status === 'ARRIVED') {
        break;
      }
    }

    expect(testChum).toBeDefined();
    // Rule: "when a voyage completes the chumigrants remain in the depot, just leave them there"
    expect(testChum.status).toBe('ARRIVED');
    const loc = state.locations[testChum.originId];
    expect(loc).toBeDefined();
    expect(loc.kind).toBe('DEPOT');
    expect(loc.id).toBe(afrRoute.targetId);
  });

  it('never silently drops passengers on voyage cancellation or interception', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    const rec = executeClaimCandidateNode(state, 'GANG_NEON_GILL', 'CAND_REC_NEON_AFR', prng);
    const depot = executeClaimCandidateNode(state, 'GANG_NEON_GILL', 'CAND_DEPOT_NEON_EUR', prng);
    const route = executePurchaseBorderRoute(state, 'GANG_NEON_GILL', rec.id, depot.id, prng);
    const chum = {
      id: 'CHUM_TEST_1',
      name: 'Testy Chum',
      originName: 'Tangier',
      originRegion: 'AFRICA' as const,
      desiredRegion: 'EUROPE' as const,
      originId: route.sourceId,
      cash: 500,
      patienceRemainingTicks: 1000,
      status: 'RECRUITED' as const,
      recruitedByGangId: route.gangId,
      assignedRouteId: route.id,
      avatar: {
        skinTone: '#fed7aa',
        shirtColor: '#94a3b8',
        eyesType: 'dots' as const,
        mouthType: 'smile' as const,
        hairColor: '#000',
        hairStyle: 'bald' as const,
        luggage: 'briefcase' as const,
      },
      history: [],
    };
    state.chumigrants[chum.id] = chum;
    state.stats.activeChums = 1;

    // Advance simulation until voyage launches and resolves
    for (let i = 0; i < 200; i++) {
      tickWorld(state, prng);
    }

    const passenger = state.chumigrants['CHUM_TEST_1'];
    expect(passenger).toBeDefined();
    expect(['WAITING', 'ARRIVED', 'DEPARTED']).toContain(passenger.status);
    expect(passenger.history.length).toBeGreaterThan(0);
  });

  it('employs Hoods to manage all gang nodes and pilot voyages', () => {
    const prng = createPrng(999);
    const state = createInitialWorld(prng);

    // Gangs start with 2 HQs + 1 Scout = 3 hoods per gang (9 total)
    expect(Object.keys(state.hoods).length).toBe(9);

    for (const gang of Object.values(state.gangs)) {
      const gangHoods = Object.values(state.hoods).filter((h) => h.gangId === gang.id);
      expect(gangHoods.length).toBe(3);

      // Check HQ has an assigned boss Hood
      const hq = state.locations[gang.hqLocationId];
      expect(hq.assignedHoodId).toBeDefined();
      expect(state.hoods[hq.assignedHoodId!].role).toBe('HQ_BOSS');
      expect(state.hoods[hq.assignedHoodId!].currentTaskDescription).toContain('Directing syndicate operations');

      // Check gang has an active Scout Hood
      const scout = gangHoods.find((h) => h.role === 'SCOUT');
      expect(scout).toBeDefined();
    }
  });

  it('blocks recruitment if a recruiter has no assigned managing Hood', () => {
    const prng = createPrng(555);
    const state = createInitialWorld(prng);

    const recLoc = executeClaimCandidateNode(state, 'GANG_NEON_GILL', 'CAND_REC_NEON_AFR', prng);
    const depotLoc = executeClaimCandidateNode(state, 'GANG_NEON_GILL', 'CAND_DEPOT_NEON_EUR', prng);
    executePurchaseBorderRoute(state, 'GANG_NEON_GILL', recLoc.id, depotLoc.id, prng);

    // Detach the managing Hood from this recruiter
    const oldHoodId = recLoc.assignedHoodId;
    recLoc.assignedHoodId = undefined;
    if (oldHoodId && state.hoods[oldHoodId]) {
      state.hoods[oldHoodId].assignment = { type: 'IDLE_HQ', targetId: 'HQ_NEON', role: 'STANDBY' };
    }

    // Add a waiting Chum at this unstaffed recruiter with plenty of cash
    const chumId = 'CHUM_UNSTAFFED_TEST';
    state.chumigrants[chumId] = {
      id: chumId,
      name: 'Unstaffed Pip',
      originName: 'Tripoli',
      originRegion: 'AFRICA',
      desiredRegion: 'EUROPE',
      originId: recLoc.id,
      cash: 1000,
      patienceRemainingTicks: 100,
      status: 'WAITING',
      avatar: {
        skinTone: '#fed7aa',
        shirtColor: '#94a3b8',
        eyesType: 'dots',
        mouthType: 'smile',
        hairColor: '#000',
        hairStyle: 'bald',
        luggage: 'none',
      },
      history: [],
    };

    // Run recruitment - recruitment should be blocked because node has no managing Hood!
    processRecruitment(state, prng, []);

    expect(state.chumigrants[chumId].status).toBe('WAITING');
    expect(state.chumigrants[chumId].recruitedByGangId).toBeUndefined();
  });

  it('establishes routes between depots and workshops in the same region and transfers chums via van voyages', () => {
    const prng = createPrng(4242);
    const state = createInitialWorld(prng);

    // Claim European depot and workshop for Neon Gill
    const depLoc = executeClaimCandidateNode(state, 'GANG_NEON_GILL', 'CAND_DEPOT_NEON_EUR', prng);
    const wsLoc = executeClaimCandidateNode(state, 'GANG_NEON_GILL', 'CAND_WS_NEON', prng);

    // Advance 1 tick to establish automatic intra-region route
    tickWorld(state, prng);

    const depWsRoute = Object.values(state.routes).find(
      (r) =>
        r.gangId === 'GANG_NEON_GILL' &&
        state.locations[r.sourceId]?.kind === 'DEPOT' &&
        state.locations[r.targetId]?.kind === 'WORKSHOP'
    );
    expect(depWsRoute).toBeDefined();
    expect(depWsRoute!.mode).toBe('VAN');
    const src = state.locations[depWsRoute!.sourceId];
    const tgt = state.locations[depWsRoute!.targetId];
    expect(src.region).toBe(tgt.region);

    // Populate Neon Depot with 6 arrived Chums
    const depRoute = depWsRoute!;

    for (let i = 1; i <= 6; i++) {
      const cid = `CHUM_DEPOT_TEST_${i}`;
      state.chumigrants[cid] = {
        id: cid,
        name: `Depot Chum ${i}`,
        originName: 'Tripoli',
        originRegion: 'AFRICA',
        desiredRegion: 'EUROPE',
        originId: depRoute.sourceId,
        cash: 500,
        patienceRemainingTicks: 5000,
        status: 'ARRIVED',
        avatar: {
          skinTone: '#fed7aa',
          shirtColor: '#38bdf8',
          eyesType: 'dots',
          mouthType: 'smile',
          hairColor: '#000',
          hairStyle: 'bald',
          luggage: 'backpack',
        },
        history: ['Arrived in depot'],
      };
    }

    // Advance ticks until the seeded PRNG decides to launch a van voyage from Depot to Workshop
    let voyageLaunched = false;
    for (let tick = 0; tick < 50; tick++) {
      tickWorld(state, prng, []);
      const vanVoyages = Object.values(state.voyages).filter(
        (v) => v.routeId === depRoute.id && (v.status === 'IN_PROGRESS' || v.status === 'SUCCESS')
      );
      if (vanVoyages.length > 0) {
        voyageLaunched = true;
        const v = vanVoyages[0];
        expect(v.mode).toBe('VAN');
        expect(v.passengerIds.length).toBeGreaterThanOrEqual(1);
        expect(v.passengerIds.length).toBeLessThanOrEqual(depRoute.capacity);
        expect(v.captainHoodId).toBeDefined();
        break;
      }
    }
    expect(voyageLaunched).toBe(true);

    // Continue running until voyage completes
    for (let tick = 0; tick < 60; tick++) {
      tickWorld(state, prng, []);
    }

    // Verify that at least one Chum has now arrived at the Workshop!
    const arrivedAtWorkshop = Object.values(state.chumigrants).filter(
      (c) => c.originId === depRoute.targetId && c.status === 'ARRIVED'
    );
    expect(arrivedAtWorkshop.length).toBeGreaterThanOrEqual(1);
    expect(state.locations[arrivedAtWorkshop[0].originId].kind).toBe('WORKSHOP');
  });
});

