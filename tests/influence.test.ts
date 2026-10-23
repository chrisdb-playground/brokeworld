import { describe, it, expect } from 'vitest';
import { createPrng } from '../src/sim/rng';
import { createInitialWorld } from '../src/sim/createWorld';
import { tickWorld } from '../src/sim/tick';
import {
  BASE_HQ_INFLUENCE_RADIUS,
  getEffectiveInfluenceHeat,
  getRawGangInfluenceInRegion,
  canPurchaseHQ,
  canPurchaseNode,
  executePurchaseHQ,
  executePurchaseNode,
} from '../src/sim/influence';

describe('HQ Influence Zones and Infrastructure Acquisition', () => {
  it('starts the sim with a main HQ and an HQ in another region (2 HQs per gang)', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    const gangs = Object.values(state.gangs);
    expect(gangs.length).toBe(3);

    for (const gang of gangs) {
      expect(gang.hqLocationIds).toBeDefined();
      expect(gang.hqLocationIds!.length).toBe(2);

      const mainHq = state.locations[gang.mainHqLocationId || gang.hqLocationId];
      expect(mainHq).toBeDefined();
      expect(mainHq.isMainHq).toBe(true);
      expect(mainHq.tileFamily).toBe('logistics-hub');
    }
  });

  it('guarantees heat map strictly stops at regional borders', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    const neonEuropeHq = state.locations['HQ_NEON']; // x: 140, y: 250 (Europe: 205 to 505)
    expect(neonEuropeHq.region).toBe('EUROPE');

    // Point in UK just 60px north of Europe border: (140, 190)
    // Distance to Europe HQ is 60px (< 260px radius)
    // BUT since y = 190 is in UK, raw influence from Europe must be 0!
    const rawInfluenceInUkFromEur = getRawGangInfluenceInRegion(state, 'GANG_NEON_GILL', 'UK', 140, 240);
    expect(rawInfluenceInUkFromEur).toBe(0);

    // Heat across Channel border in UK from European operations is strictly 0
    const heatAtUkBorder = getEffectiveInfluenceHeat(state, 'GANG_NEON_GILL', 140, 195);
    // Note: Neon now has an HQ in UK at (200, 90). Distance from (140, 195) to (200, 90) is hypot(60, 105) = 120px < 260.
    // However, if we test a gang with no HQ in that region, effective heat is 0.
    // Create an isolated test state with only Europe HQ for a test gang:
    const testState = {
      ...state,
      locations: {
        TEST_HQ: {
          id: 'TEST_HQ',
          name: 'Test HQ',
          region: 'EUROPE' as const,
          x: 400,
          y: 250,
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ' as const,
          gangId: 'TEST_GANG',
        },
      },
      gangs: {
        TEST_GANG: {
          ...state.gangs['GANG_NEON_GILL'],
          id: 'TEST_GANG',
          hqLocationId: 'TEST_HQ',
          hqLocationIds: ['TEST_HQ'],
        },
      },
    };

    // Y = 200 is in UK (less than 50px away from TEST_HQ at y=250)
    const heatInUk = getEffectiveInfluenceHeat(testState, 'TEST_GANG', 400, 200);
    expect(heatInUk).toBe(0); // Heat map strictly stops at border!

    // Y = 510 is in Africa (less than 260px away from TEST_HQ)
    const heatInAfrica = getEffectiveInfluenceHeat(testState, 'TEST_GANG', 400, 510);
    expect(heatInAfrica).toBe(0); // Heat map strictly stops at border!
  });

  it('dissipates influence with distance from HQ and restricts rival gangs with slight overlap', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    // Test Neon Europe HQ at (140, 250) and Crimson Central HQ at (560, 250)
    // At center of Neon HQ:
    const centerHeat = getEffectiveInfluenceHeat(state, 'GANG_NEON_GILL', 140, 250);
    expect(centerHeat).toBeGreaterThanOrEqual(0.95);

    // Heat dissipates with distance: 100px away towards the east (240, 250)
    const midHeat = getEffectiveInfluenceHeat(state, 'GANG_NEON_GILL', 240, 250);
    expect(midHeat).toBeLessThan(centerHeat);
    expect(midHeat).toBeGreaterThan(0.4);

    // Far away (> 260px from Neon HQ, outside influence):
    const farHeat = getEffectiveInfluenceHeat(state, 'GANG_NEON_GILL', 560, 250); // Crimson's center!
    expect(farHeat).toBe(0); // Neon has 0 influence inside Crimson's epicenter

    // Test slight overlap behavior between two neighboring HQs:
    // Create two HQs spaced 320px apart (each with 260px radius)
    // Radius overlap zone is between x=100 and x=220
    const overlapState = {
      ...state,
      locations: {
        HQ_A: {
          id: 'HQ_A',
          name: 'HQ A',
          region: 'EUROPE' as const,
          x: 200,
          y: 350,
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ' as const,
          gangId: 'GANG_A',
        },
        HQ_B: {
          id: 'HQ_B',
          name: 'HQ B',
          region: 'EUROPE' as const,
          x: 480,
          y: 350,
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ' as const,
          gangId: 'GANG_B',
        },
      },
      gangs: {
        GANG_A: { ...state.gangs['GANG_NEON_GILL'], id: 'GANG_A', hqLocationIds: ['HQ_A'] },
        GANG_B: { ...state.gangs['GANG_CRIMSON_CLAW'], id: 'GANG_B', hqLocationIds: ['HQ_B'] },
      },
    };

    // Near the contested midway point x=340:
    // Distance to A is 140px (< 260), raw = 1 - 140/260 = 0.46
    // Distance to B is 140px (< 260), raw = 1 - 140/260 = 0.46
    // Both gangs restrict each other, but allow slight overlap:
    const heatA = getEffectiveInfluenceHeat(overlapState, 'GANG_A', 340, 350);
    const heatB = getEffectiveInfluenceHeat(overlapState, 'GANG_B', 340, 350);

    expect(heatA).toBeGreaterThan(0.1);
    expect(heatB).toBeGreaterThan(0.1);
    // Slight overlap confirmed: both hold positive contested presence at the boundary buffer!
    expect(Math.abs(heatA - heatB)).toBeLessThan(0.05);

    // Closer to A (x=240, 40px from A, 240px from B):
    const dominantA = getEffectiveInfluenceHeat(overlapState, 'GANG_A', 240, 350);
    const suppressedB = getEffectiveInfluenceHeat(overlapState, 'GANG_B', 240, 350);
    expect(dominantA).toBeGreaterThan(0.7);
    expect(suppressedB).toBe(0); // Suppressed by A
  });

  it('forbids purchasing nodes in a region without an HQ or outside the heat map', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    // Create an isolated gang with an HQ ONLY in Europe
    const isolatedGang = {
      ...state.gangs['GANG_NEON_GILL'],
      id: 'GANG_ISOLATED',
      hqLocationId: 'HQ_ISOLATED',
      hqLocationIds: ['HQ_ISOLATED'],
      cash: 20000,
    };
    state.gangs['GANG_ISOLATED'] = isolatedGang;
    state.locations['HQ_ISOLATED'] = {
      id: 'HQ_ISOLATED',
      name: 'Isolated European HQ',
      region: 'EUROPE',
      x: 300,
      y: 350,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'GANG_ISOLATED',
    };

    // 1. Try to purchase a Recruiter in Africa where gang has NO HQ:
    const noHqCheck = canPurchaseNode(state, 'GANG_ISOLATED', 'RECRUITER', 'AFRICA', 300, 650);
    expect(noHqCheck.allowed).toBe(false);
    expect(noHqCheck.reason).toContain('No gang HQ in AFRICA');

    // 2. Try to purchase a node in Europe, but far outside the influence heat map (> 260px away):
    const outOfHeatCheck = canPurchaseNode(state, 'GANG_ISOLATED', 'RECRUITER', 'EUROPE', 1100, 350);
    expect(outOfHeatCheck.allowed).toBe(false);
    expect(outOfHeatCheck.reason).toContain('outside');

    // 3. Purchase inside the heat map (distance 80px from HQ):
    const validCheck = canPurchaseNode(state, 'GANG_ISOLATED', 'RECRUITER', 'EUROPE', 380, 350);
    expect(validCheck.allowed).toBe(true);
    expect(validCheck.heat).toBeGreaterThan(0.5);

    // Execute node purchase
    const newRecruiter = executePurchaseNode(state, 'GANG_ISOLATED', 'RECRUITER', 'EUROPE', 380, 350, prng);
    expect(newRecruiter).toBeDefined();
    expect(newRecruiter.kind).toBe('RECRUITER');
    expect(state.locations[newRecruiter.id]).toBeDefined();
    expect(isolatedGang.cash).toBe(20000 - validCheck.cost - 150); // node cost + hood signing fee
    expect(newRecruiter.assignedHoodId).toBeDefined();
    expect(state.hoods[newRecruiter.assignedHoodId!].role).toBe('RECRUITER_MANAGER');
  });

  it('allows purchasing a new Regional HQ and establishing a new influence zone', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    const gang = state.gangs['GANG_NEON_GILL'];
    gang.cash = 10000;

    // Purchase an additional HQ in Europe at an open location (x: 80, y: 470)
    const hqCheck = canPurchaseHQ(state, gang.id, 'EUROPE', 80, 470);
    expect(hqCheck.allowed).toBe(true);

    const initialHqCount = gang.hqLocationIds!.length;
    const newHq = executePurchaseHQ(state, gang.id, 'EUROPE', 80, 470, prng, 'Neon South Europe HQ');

    expect(newHq).toBeDefined();
    expect(state.locations[newHq.id]).toBeDefined();
    expect(gang.hqLocationIds!.length).toBe(initialHqCount + 1);
    expect(gang.cash).toBe(10000 - hqCheck.cost - 150); // HQ cost + HQ Boss signing fee

    // Check that point (80, 470) now has strong influence heat
    const heatAtNewHq = getEffectiveInfluenceHeat(state, gang.id, 80, 470);
    expect(heatAtNewHq).toBeGreaterThanOrEqual(0.9);

    // HQ Boss was hired and assigned to manage this new HQ
    expect(newHq.assignedHoodId).toBeDefined();
    expect(state.hoods[newHq.assignedHoodId!].role).toBe('HQ_BOSS');
  });

  it('processes PURCHASE_HQ and PURCHASE_NODE commands via sim tickWorld', () => {
    const prng = createPrng(4321);
    let state = createInitialWorld(prng);

    const gang = state.gangs['GANG_CRIMSON_CLAW'];
    const startingCash = gang.cash;

    // Issue PURCHASE_HQ command
    state = tickWorld(state, prng, [
      {
        type: 'PURCHASE_HQ',
        payload: {
          gangId: gang.id,
          region: 'EUROPE',
          x: 400,
          y: 470,
          name: 'Crimson Forward Command',
        },
      },
    ]);

    expect(gang.cash).toBe(startingCash - 4000 - 150);
    const foundHq = Object.values(state.locations).find((l) => l.name === 'Crimson Forward Command');
    expect(foundHq).toBeDefined();
    expect(foundHq!.kind).toBe('HQ');
    expect(foundHq!.region).toBe('EUROPE');

    // Issue PURCHASE_NODE inside new HQ's influence zone
    state = tickWorld(state, prng, [
      {
        type: 'PURCHASE_NODE',
        payload: {
          gangId: gang.id,
          kind: 'DEPOT',
          region: 'EUROPE',
          x: 320,
          y: 470, // 80px away from new HQ at (400, 470), well within heat map and clears all nodes
          name: 'Crimson Mediterranean Depot',
        },
      },
    ]);

    const foundDepot = Object.values(state.locations).find((l) => l.name === 'Crimson Mediterranean Depot');
    expect(foundDepot).toBeDefined();
    expect(foundDepot!.kind).toBe('DEPOT');
    expect(gang.depotLocationIds).toContain(foundDepot!.id);
  });
});
