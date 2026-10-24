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
  canClaimCandidateNode,
  executePurchaseHQ,
  executePurchaseNode,
  executeClaimCandidateNode,
} from '../src/sim/influence';

describe('HQ Influence Zones and Infrastructure Acquisition', () => {
  it('starts the sim with a single main HQ and builds up gradually (1 main HQ per gang)', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    const gangs = Object.values(state.gangs);
    expect(gangs.length).toBe(3);

    for (const gang of gangs) {
      expect(gang.hqLocationIds).toBeDefined();
      expect(gang.hqLocationIds!.length).toBe(1);

      const mainHq = state.locations[gang.mainHqLocationId || gang.hqLocationId];
      expect(mainHq).toBeDefined();
      expect(mainHq.isMainHq).toBe(true);
      expect(mainHq.tileFamily).toBe('logistics-hub');
    }
  });

  it('guarantees heat map strictly stops at regional borders', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    const neonEuropeHq = state.locations['HQ_NEON']; // x: 140, y: 430 (Europe: 280 to 660)
    expect(neonEuropeHq.region).toBe('EUROPE');

    // Point in UK (y = 100):
    // Distance to Europe HQ is 330px
    // And since y = 100 is in UK, raw influence from Europe must be 0!
    const rawInfluenceInUkFromEur = getRawGangInfluenceInRegion(state, 'GANG_NEON_GILL', 'UK', 140, 100);
    expect(rawInfluenceInUkFromEur).toBe(0);

    // Heat across Channel border in UK from European operations is strictly 0
    // Gang Neon only has Europe HQ initially, so UK heat is 0
    const heatAtUkBorder = getEffectiveInfluenceHeat(state, 'GANG_NEON_GILL', 140, 100);
    expect(heatAtUkBorder).toBe(0);

    // Create an isolated test state with an HQ near the Europe border for a test gang:
    const testState = {
      ...state,
      locations: {
        TEST_HQ: {
          id: 'TEST_HQ',
          name: 'Test HQ',
          region: 'EUROPE' as const,
          x: 400,
          y: 320, // Near Europe north border at y=280
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ' as const,
          gangId: 'TEST_GANG',
          influenceRadius: 260,
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

    // Y = 200 is in English Channel water (120px away from TEST_HQ at y=320, well within 260px radius)
    const heatInChannel = getEffectiveInfluenceHeat(testState, 'TEST_GANG', 400, 200);
    expect(heatInChannel).toBe(0); // Heat map strictly stops at border!

    // Y = 100 is in UK (220px away from TEST_HQ at y=320, within 260px radius)
    const heatInUk = getEffectiveInfluenceHeat(testState, 'TEST_GANG', 400, 100);
    expect(heatInUk).toBe(0); // Heat map strictly stops at border!

    // Y = 950 is in Africa
    const heatInAfrica = getEffectiveInfluenceHeat(testState, 'TEST_GANG', 400, 950);
    expect(heatInAfrica).toBe(0); // Heat map strictly stops at border!
  });

  it('dissipates influence with distance from HQ and restricts rival gangs with slight overlap', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    // Test Neon Europe HQ and Crimson Central HQ
    const neonHq = state.locations[state.gangs['GANG_NEON_GILL'].hqLocationId];
    const crimHq = state.locations[state.gangs['GANG_CRIMSON_CLAW'].hqLocationId];

    // At center of Neon HQ:
    const centerHeat = getEffectiveInfluenceHeat(state, 'GANG_NEON_GILL', neonHq.x, neonHq.y);
    expect(centerHeat).toBeGreaterThanOrEqual(0.95);

    // Heat dissipates with distance: 100px away towards the east
    const midHeat = getEffectiveInfluenceHeat(state, 'GANG_NEON_GILL', neonHq.x + 100, neonHq.y);
    expect(midHeat).toBeLessThan(centerHeat);
    expect(midHeat).toBeGreaterThan(0.4);

    // Far away (> 260px from Neon HQ, outside influence, at Crimson's epicenter):
    const farHeat = getEffectiveInfluenceHeat(state, 'GANG_NEON_GILL', crimHq.x, crimHq.y);
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
      x: 350,
      y: 430,
      tileFamily: 'logistics-hub',
      tileVariant: 'mk1',
      kind: 'HQ',
      gangId: 'GANG_ISOLATED',
    };

    // 1. Try to purchase a Recruiter in Africa where gang has NO HQ:
    const noHqCheck = canPurchaseNode(state, 'GANG_ISOLATED', 'RECRUITER', 'AFRICA', 300, 950);
    expect(noHqCheck.allowed).toBe(false);
    expect(noHqCheck.reason).toContain('No gang HQ in AFRICA');

    // 2. Try to purchase a node in Europe, but far outside the influence heat map (> 260px away):
    const outOfHeatCheck = canPurchaseNode(state, 'GANG_ISOLATED', 'RECRUITER', 'EUROPE', 1100, 430);
    expect(outOfHeatCheck.allowed).toBe(false);
    expect(outOfHeatCheck.reason).toContain('outside');

    // 3. Purchase inside the heat map (distance 80px from HQ):
    const validCheck = canPurchaseNode(state, 'GANG_ISOLATED', 'RECRUITER', 'EUROPE', 350, 510);
    expect(validCheck.allowed).toBe(true);
    expect(validCheck.heat).toBeGreaterThan(0.5);

    // Execute node purchase
    const newRecruiter = executePurchaseNode(state, 'GANG_ISOLATED', 'RECRUITER', 'EUROPE', 350, 510, prng);
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

    // Purchase an additional HQ in Europe at an open location (x: 80, y: 350)
    const hqCheck = canPurchaseHQ(state, gang.id, 'EUROPE', 80, 350);
    expect(hqCheck.allowed).toBe(true);

    const initialHqCount = gang.hqLocationIds!.length;
    const newHq = executePurchaseHQ(state, gang.id, 'EUROPE', 80, 350, prng, 'Neon North Europe HQ');

    expect(newHq).toBeDefined();
    expect(state.locations[newHq.id]).toBeDefined();
    expect(gang.hqLocationIds!.length).toBe(initialHqCount + 1);
    expect(gang.cash).toBe(10000 - hqCheck.cost - 150); // HQ cost + HQ Boss signing fee

    // Check that point (80, 350) now has strong influence heat
    const heatAtNewHq = getEffectiveInfluenceHeat(state, gang.id, 80, 350);
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

  it('increases influence when 2 HQ influence zones of the same gang overlap', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    // Setup a gang with two HQs in Europe:
    // HQ1 at (200, 300) and HQ2 at (360, 300) (distance = 160px < 260px radius)
    // Midway point is (280, 300):
    // Distance from HQ1 is 80px: raw heat1 = 1 - 80/260 = 0.692
    // Distance from HQ2 is 80px: raw heat2 = 1 - 80/260 = 0.692
    const dualHqState = {
      ...state,
      locations: {
        HQ_1: {
          id: 'HQ_1',
          name: 'HQ West',
          region: 'EUROPE' as const,
          x: 200,
          y: 300,
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ' as const,
          gangId: 'GANG_SYNERGY',
          influenceRadius: 260,
        },
        HQ_2: {
          id: 'HQ_2',
          name: 'HQ East',
          region: 'EUROPE' as const,
          x: 360,
          y: 300,
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ' as const,
          gangId: 'GANG_SYNERGY',
          influenceRadius: 260,
        },
      },
      gangs: {
        GANG_SYNERGY: {
          ...state.gangs['GANG_NEON_GILL'],
          id: 'GANG_SYNERGY',
          hqLocationIds: ['HQ_1', 'HQ_2'],
        },
      },
    };

    // Calculate influence with ONLY HQ_1:
    const stateWithOnlyHq1 = {
      ...dualHqState,
      locations: { HQ_1: dualHqState.locations.HQ_1 },
    };
    const heatWithOnlyHq1 = getRawGangInfluenceInRegion(stateWithOnlyHq1, 'GANG_SYNERGY', 'EUROPE', 280, 300);

    // Calculate influence with ONLY HQ_2:
    const stateWithOnlyHq2 = {
      ...dualHqState,
      locations: { HQ_2: dualHqState.locations.HQ_2 },
    };
    const heatWithOnlyHq2 = getRawGangInfluenceInRegion(stateWithOnlyHq2, 'GANG_SYNERGY', 'EUROPE', 280, 300);

    // Now calculate influence with BOTH HQs:
    const combinedHeat = getRawGangInfluenceInRegion(dualHqState, 'GANG_SYNERGY', 'EUROPE', 280, 300);

    // RULE: "2 hq influence zones, same gang, increase the influence"
    expect(heatWithOnlyHq1).toBeCloseTo(0.692, 2);
    expect(heatWithOnlyHq2).toBeCloseTo(0.692, 2);
    expect(combinedHeat).toBeGreaterThan(heatWithOnlyHq1);
    expect(combinedHeat).toBeGreaterThan(heatWithOnlyHq2);
    // With synergy boost, combined heat is > 0.9!
    expect(combinedHeat).toBeGreaterThan(0.9);
  });

  it('separates regions by water with 2-sided borders where HQ influence stops', () => {
    const prng = createPrng(1234);
    const state = createInitialWorld(prng);

    // Test gang with an HQ close to the Mediterranean border in Europe: (500, 630)
    const borderTestState = {
      ...state,
      locations: {
        BORDER_HQ: {
          id: 'BORDER_HQ',
          name: 'Border HQ',
          region: 'EUROPE' as const,
          x: 500,
          y: 630, // 30px away from Europe southern border at y=660
          tileFamily: 'logistics-hub',
          tileVariant: 'mk1',
          kind: 'HQ' as const,
          gangId: 'BORDER_GANG',
          influenceRadius: 260,
        },
      },
      gangs: {
        BORDER_GANG: {
          ...state.gangs['GANG_NEON_GILL'],
          id: 'BORDER_GANG',
          hqLocationIds: ['BORDER_HQ'],
        },
      },
    };

    // 1. Inside Europe near the border (y=645): heat is strong
    const heatInsideEurope = getEffectiveInfluenceHeat(borderTestState, 'BORDER_GANG', 500, 645);
    expect(heatInsideEurope).toBeGreaterThan(0.85);

    // 2. In the Mediterranean Sea water (between y=660 and y=860, e.g. y=750):
    // Strictly 0 because HQ influence stops at border!
    const heatInMedWater = getEffectiveInfluenceHeat(borderTestState, 'BORDER_GANG', 500, 750);
    expect(heatInMedWater).toBe(0);

    // 3. Across the water in Africa (e.g. y=950):
    // Even though Euclidean distance is 320px,
    // because it's past the border, influence is strictly 0!
    const heatInAfrica = getEffectiveInfluenceHeat(borderTestState, 'BORDER_GANG', 500, 950);
    expect(heatInAfrica).toBe(0);

    // 4. In the English Channel water (between y=140 and y=280, e.g. y=210):
    const heatInChannelWater = getEffectiveInfluenceHeat(borderTestState, 'BORDER_GANG', 500, 210);
    expect(heatInChannelWater).toBe(0);
  });

  it('strictly enforces: only possible to buy nodes inside HQ influence zone, unless it is an HQ node', () => {
    const prng = createPrng(9876);
    const state = createInitialWorld(prng);

    // Neon Gill only has a Main HQ in Europe (x: 600, y: 430, radius: 220)
    const neonGang = state.gangs['GANG_NEON_GILL'];
    neonGang.cash = 25000;

    // 1. Candidate nodes in Africa (where Neon Gill has NO HQ yet)
    state.locations['CAND_AFR_HQ'] = {
      id: 'CAND_AFR_HQ',
      name: 'Tripoli Coastal HQ Site',
      region: 'AFRICA',
      x: 600,
      y: 950,
      kind: 'HQ',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 2200,
    };
    state.locations['CAND_AFR_REC'] = {
      id: 'CAND_AFR_REC',
      name: 'Tripoli Outpost Recruiter',
      region: 'AFRICA',
      x: 650,
      y: 960, // 51px away from Tripoli HQ
      kind: 'RECRUITER',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1500,
    };

    // A. Recruiter in Africa CANNOT be bought before an HQ is established in Africa!
    const recCheckBeforeHq = canClaimCandidateNode(state, neonGang.id, 'CAND_AFR_REC');
    expect(recCheckBeforeHq.allowed).toBe(false);
    expect(recCheckBeforeHq.reason).toContain('No gang HQ in AFRICA');

    expect(() => {
      executeClaimCandidateNode(state, neonGang.id, 'CAND_AFR_REC', prng);
    }).toThrow(/Cannot claim node: No gang HQ in AFRICA/);

    // B. HQ in Africa CAN be bought even with 0 initial influence! ("unless it is a hq node")
    const hqCheck = canClaimCandidateNode(state, neonGang.id, 'CAND_AFR_HQ');
    expect(hqCheck.allowed).toBe(true);

    const claimedHq = executeClaimCandidateNode(state, neonGang.id, 'CAND_AFR_HQ', prng);
    expect(claimedHq).toBeDefined();
    expect(state.locations['CAND_AFR_HQ'].operationalStatus).toBe('ACTIVE');
    expect(state.locations['CAND_AFR_HQ'].gangId).toBe(neonGang.id);

    // C. Now that Tripoli HQ is claimed and active, the nearby Recruiter is inside the HQ influence zone!
    const recCheckAfterHq = canClaimCandidateNode(state, neonGang.id, 'CAND_AFR_REC');
    expect(recCheckAfterHq.allowed).toBe(true);
    expect(recCheckAfterHq.heat).toBeGreaterThan(0.7);

    const claimedRec = executeClaimCandidateNode(state, neonGang.id, 'CAND_AFR_REC', prng);
    expect(claimedRec).toBeDefined();
    expect(state.locations['CAND_AFR_REC'].gangId).toBe(neonGang.id);

    // 2. Candidate node far away outside HQ influence radius (e.g. 500px away from all HQs)
    state.locations['CAND_EUR_DISTANT_DEPOT'] = {
      id: 'CAND_EUR_DISTANT_DEPOT',
      name: 'Distant Alpine Depot Site',
      region: 'EUROPE',
      x: 1800, // 1200px away from Neon HQ at x: 600
      y: 430,
      kind: 'DEPOT',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1200,
    };

    const distantCheck = canClaimCandidateNode(state, neonGang.id, 'CAND_EUR_DISTANT_DEPOT');
    expect(distantCheck.allowed).toBe(false);
    expect(distantCheck.reason).toContain('outside');

    expect(() => {
      executeClaimCandidateNode(state, neonGang.id, 'CAND_EUR_DISTANT_DEPOT', prng);
    }).toThrow(/Cannot claim node: Location is outside/);

    // 3. Direct Placement: HQ node can be placed outside influence zone; non-HQ node cannot
    const hqDirectPlacement = canPurchaseNode(state, neonGang.id, 'HQ', 'UK', 600, 70);
    expect(hqDirectPlacement.allowed).toBe(true);

    const depotDirectOutside = canPurchaseNode(state, neonGang.id, 'DEPOT', 'UK', 600, 70);
    expect(depotDirectOutside.allowed).toBe(false);
    expect(depotDirectOutside.reason).toContain('No gang HQ in UK');
  });
});

