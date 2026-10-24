import { describe, it, expect } from 'vitest';
import { createPrng } from '../src/sim/rng';
import {
  processScouts,
  scoutAreaForNodes,
  scoutSearchForRoutes,
  processCandidateExpirations,
  resetScoutSeq,
} from '../src/sim/scouts';
import {
  createMockWorld,
  createMockGang,
  createMockLocation,
  createMockHood,
} from './factories';

describe('Scout Discovery & Dynamic Node/Route System', () => {
  it('only runs scout sweeps on 30-tick cycles', () => {
    resetScoutSeq(1);
    const prng = createPrng(42);
    const gang = createMockGang({ id: 'GANG_S' });
    const scout = createMockHood({ id: 'SCOUT_1', gangId: gang.id, role: 'SCOUT' });

    const world = createMockWorld({
      tick: 29, // Not a 30-tick cycle
      gangs: { [gang.id]: gang },
      hoods: { [scout.id]: scout },
      locations: {},
    });

    const events: any[] = [];
    processScouts(world, prng, events);

    expect(gang.discoveredNodeIds?.length || 0).toBe(0);
    expect(events.length).toBe(0);
  });

  it('dynamically creates a cluster of candidate nodes with expiration timers on scouting cycle', () => {
    resetScoutSeq(100);
    const prng = createPrng(42);
    const gang = createMockGang({ id: 'GANG_S', cash: 5000 });
    const hq = createMockLocation({
      id: 'HQ_S',
      kind: 'HQ',
      gangId: gang.id,
      region: 'EUROPE',
      x: 600,
      y: 1000,
      influenceRadius: 700,
    });
    gang.mainHqLocationId = hq.id;
    gang.hqLocationIds = [hq.id];

    const scout = createMockHood({
      id: 'SCOUT_1',
      gangId: gang.id,
      role: 'SCOUT',
      assignment: { type: 'SCOUT_ZONE', targetId: hq.id, role: 'SCOUT' },
    });

    const world = createMockWorld({
      tick: 30, // 30-tick cycle
      gangs: { [gang.id]: gang },
      locations: { [hq.id]: hq },
      hoods: { [scout.id]: scout },
    });

    const events: any[] = [];
    processScouts(world, prng, events);

    // Scout dynamically generates 3 to 5 candidate nodes!
    expect(gang.discoveredNodeIds?.length).toBeGreaterThanOrEqual(2);
    expect(gang.discoveredNodeIds?.length).toBeLessThanOrEqual(5);

    for (const candId of gang.discoveredNodeIds!) {
      const node = world.locations[candId];
      expect(node).toBeDefined();
      expect(node.operationalStatus).toBe('DISCOVERED_CANDIDATE');
      expect(node.gangId).toBe('NEUTRAL');
      expect(node.discoveredByGangId).toBe(gang.id);
      expect(node.candidateCost).toBeGreaterThanOrEqual(1000);
      expect(node.expiresAtTick).toBe(world.tick + 240);
    }

    const discEvents = events.filter((e) => e.type === 'NODE_DISCOVERED');
    expect(discEvents.length).toBe(gang.discoveredNodeIds!.length);
  });

  it('removes candidate nodes dynamically if they expire without being purchased', () => {
    resetScoutSeq(200);
    const prng = createPrng(99);
    const gang = createMockGang({ id: 'GANG_EXP', cash: 5000 });

    const world = createMockWorld({
      tick: 50,
      gangs: { [gang.id]: gang },
      locations: {},
    });

    const created = scoutAreaForNodes(world, gang.id, prng, 'EUROPE', { x: 600, y: 1000 });
    expect(created.length).toBeGreaterThanOrEqual(2);

    const firstNodeId = created[0].id;
    expect(world.locations[firstNodeId]).toBeDefined();
    expect(gang.discoveredNodeIds).toContain(firstNodeId);

    // Fast-forward ticks to expiration
    world.tick = created[0].expiresAtTick!;

    const events: any[] = [];
    processCandidateExpirations(world, events);

    // The expired nodes must be removed from locations and discoveredNodeIds!
    expect(world.locations[firstNodeId]).toBeUndefined();
    expect(gang.discoveredNodeIds).not.toContain(firstNodeId);

    const expiredEvent = events.find((e) => e.type === 'NODE_EXPIRED' && e.locationId === firstNodeId);
    expect(expiredEvent).toBeDefined();
  });

  it('dynamically charts routes between owned recruiters and depots, and removes unchartered routes on expiry', () => {
    resetScoutSeq(300);
    const prng = createPrng(123);
    const gang = createMockGang({ id: 'GANG_R', cash: 5000 });

    const rec = createMockLocation({
      id: 'REC_AFR',
      kind: 'RECRUITER',
      gangId: gang.id,
      region: 'AFRICA',
      operationalStatus: 'ACTIVE',
    });
    const depot = createMockLocation({
      id: 'DEPOT_EUR',
      kind: 'DEPOT',
      gangId: gang.id,
      region: 'EUROPE',
      operationalStatus: 'ACTIVE',
    });

    gang.recruiterLocationIds = [rec.id];
    gang.depotLocationIds = [depot.id];

    const world = createMockWorld({
      tick: 30,
      gangs: { [gang.id]: gang },
      locations: { [rec.id]: rec, [depot.id]: depot },
    });

    const events: any[] = [];
    const routes = scoutSearchForRoutes(world, gang.id, prng, events);

    expect(routes.length).toBe(1);
    expect(routes[0].sourceId).toBe(rec.id);
    expect(routes[0].targetId).toBe(depot.id);
    expect(routes[0].charterCost).toBe(1000);
    expect(routes[0].expiresAtTick).toBe(world.tick + 240);
    expect(gang.discoveredCandidateRoutes).toHaveLength(1);

    // Advance to expiration tick
    world.tick = routes[0].expiresAtTick;

    const expEvents: any[] = [];
    processCandidateExpirations(world, expEvents);

    // Route should expire and be removed
    expect(gang.discoveredCandidateRoutes).toHaveLength(0);
    expect(gang.discoveredRouteIds).not.toContain(`CONN__${rec.id}__${depot.id}`);
    expect(expEvents.some((e) => e.type === 'ROUTE_EXPIRED')).toBe(true);
  });
});
