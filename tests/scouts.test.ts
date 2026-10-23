import { describe, it, expect } from 'vitest';
import { createPrng } from '../src/sim/rng';
import { processScouts } from '../src/sim/scouts';
import { createMockWorld, createMockGang, createMockLocation, createMockHood } from './factories';

describe('Scout Discovery System (Isolated Unit Tests)', () => {
  it('only runs scout checks on 30-tick cycles', () => {
    const prng = createPrng(42);
    const gang = createMockGang({ id: 'GANG_S' });
    const scout = createMockHood({ id: 'SCOUT_1', gangId: gang.id, role: 'SCOUT' });
    const candidate = createMockLocation({
      id: 'CAND_1',
      gangId: 'NEUTRAL',
      operationalStatus: 'DISCOVERED_CANDIDATE',
    });

    const world = createMockWorld({
      tick: 29, // Not a 30-tick cycle
      gangs: { [gang.id]: gang },
      hoods: { [scout.id]: scout },
      locations: { [candidate.id]: candidate },
    });

    const events: any[] = [];
    processScouts(world, prng, events);

    expect(gang.discoveredNodeIds?.length || 0).toBe(0);
    expect(events.length).toBe(0);
  });

  it('discovers candidate nodes within influence range on cycle tick', () => {
    const prng = createPrng(42);
    const gang = createMockGang({ id: 'GANG_S', cash: 5000 });
    const hq = createMockLocation({
      id: 'HQ_S',
      kind: 'HQ',
      gangId: gang.id,
      region: 'EUROPE',
      x: 200,
      y: 400,
      influenceRadius: 250,
    });
    gang.mainHqLocationId = hq.id;
    gang.hqLocationIds = [hq.id];

    const scout = createMockHood({
      id: 'SCOUT_1',
      gangId: gang.id,
      role: 'SCOUT',
      assignment: { type: 'SCOUT_ZONE', targetId: hq.id, role: 'SCOUT' },
    });

    // Place candidate within HQ influence zone (dist ~50px)
    const candidate = createMockLocation({
      id: 'CAND_REC_1',
      name: 'Port Candidate',
      kind: 'RECRUITER',
      gangId: 'NEUTRAL',
      region: 'EUROPE',
      x: 240,
      y: 430,
      operationalStatus: 'DISCOVERED_CANDIDATE',
      candidateCost: 1200,
    });

    const world = createMockWorld({
      tick: 30, // 30-tick cycle
      gangs: { [gang.id]: gang },
      locations: { [hq.id]: hq, [candidate.id]: candidate },
      hoods: { [scout.id]: scout },
    });

    const events: any[] = [];
    processScouts(world, prng, events);

    expect(gang.discoveredNodeIds).toContain(candidate.id);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('NODE_DISCOVERED');
    expect(events[0].locationId).toBe(candidate.id);
  });
});
