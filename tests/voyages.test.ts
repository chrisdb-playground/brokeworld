import { describe, it, expect } from 'vitest';
import { createPrng } from '../src/sim/rng';
import { processVoyages, resetVoyageSeq } from '../src/sim/voyages';
import {
  createMockWorld,
  createMockGang,
  createMockLocation,
  createMockRoute,
  createMockChum,
  createMockHood,
  createMockVoyage,
} from './factories';

describe('Voyage System (Isolated Unit Tests)', () => {
  it('advances progress smoothly for in-flight voyages', () => {
    resetVoyageSeq(1);
    const prng = createPrng(123);
    const gang = createMockGang({ id: 'GANG_V' });
    const rec = createMockLocation({ id: 'REC_1', kind: 'RECRUITER', gangId: gang.id });
    const dep = createMockLocation({ id: 'DEP_1', kind: 'DEPOT', gangId: gang.id });
    const route = createMockRoute({ id: 'ROUTE_1', gangId: gang.id, sourceId: rec.id, targetId: dep.id, durationTicks: 40 });
    const skipper = createMockHood({
      id: 'SKIPPER_1',
      gangId: gang.id,
      role: 'VOYAGE_SKIPPER',
      assignment: { type: 'PILOT_VOYAGE', targetId: 'VOYAGE_1', role: 'VOYAGE_SKIPPER' },
    });
    const voyage = createMockVoyage({
      id: 'VOYAGE_1',
      gangId: gang.id,
      routeId: route.id,
      sourceId: rec.id,
      targetId: dep.id,
      durationTicks: 40,
      startTick: 10,
      status: 'IN_PROGRESS',
      captainHoodId: skipper.id,
    });

    const world = createMockWorld({
      tick: 30, // 20 ticks elapsed out of 40 => 0.5 (50%)
      gangs: { [gang.id]: gang },
      locations: { [rec.id]: rec, [dep.id]: dep },
      routes: { [route.id]: route },
      hoods: { [skipper.id]: skipper },
      voyages: { [voyage.id]: voyage },
    });

    const events: any[] = [];
    processVoyages(world, prng, events);

    expect(voyage.progress).toBe(0.5);
    expect(voyage.status).toBe('IN_PROGRESS');
    expect(skipper.currentTaskDescription).toContain('50%');
  });

  it('resolves successful voyage when progress reaches 100%, updating passengers to ARRIVED', () => {
    resetVoyageSeq(1);
    const prng = createPrng(42);
    const gang = createMockGang({ id: 'GANG_V' });
    const rec = createMockLocation({ id: 'REC_1', kind: 'RECRUITER', gangId: gang.id });
    const dep = createMockLocation({ id: 'DEP_1', kind: 'DEPOT', gangId: gang.id });
    const route = createMockRoute({
      id: 'ROUTE_1',
      gangId: gang.id,
      sourceId: rec.id,
      targetId: dep.id,
      durationTicks: 40,
      reliability: 1.0, // Guaranteed 100% success for this test
      activeVoyageCount: 1,
    });
    const chum = createMockChum({
      id: 'PASSENGER_1',
      originId: rec.id,
      status: 'IN_TRANSIT',
      voyageId: 'VOYAGE_DONE',
    });
    const skipper = createMockHood({
      id: 'SKIPPER_1',
      gangId: gang.id,
      role: 'VOYAGE_SKIPPER',
      assignment: { type: 'PILOT_VOYAGE', targetId: 'VOYAGE_DONE', role: 'VOYAGE_SKIPPER' },
    });
    const voyage = createMockVoyage({
      id: 'VOYAGE_DONE',
      gangId: gang.id,
      routeId: route.id,
      sourceId: rec.id,
      targetId: dep.id,
      durationTicks: 40,
      startTick: 0,
      progress: 0.98,
      status: 'IN_PROGRESS',
      passengerIds: [chum.id],
      captainHoodId: skipper.id,
    });

    const world = createMockWorld({
      tick: 40, // 40 ticks elapsed out of 40 => 1.0
      gangs: { [gang.id]: gang },
      locations: { [rec.id]: rec, [dep.id]: dep },
      routes: { [route.id]: route },
      hoods: { [skipper.id]: skipper },
      chumigrants: { [chum.id]: chum },
      voyages: { [voyage.id]: voyage },
    });

    const events: any[] = [];
    processVoyages(world, prng, events);

    expect(voyage.progress).toBe(1.0);
    expect(voyage.status).toBe('SUCCESS');
    expect(chum.status).toBe('ARRIVED');
    expect(chum.originId).toBe(dep.id);
    expect(route.activeVoyageCount).toBe(0);
    expect(world.stats.totalVoyagesSuccess).toBe(1);
    expect(events.some((e) => e.type === 'VOYAGE_SUCCESS')).toBe(true);
  });
});
