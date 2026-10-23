import { describe, it, expect } from 'vitest';
import { createPrng } from '../src/sim/rng';
import { hireHood, processPayroll, HOOD_HIRING_COST, HOOD_WAGE_PER_CYCLE } from '../src/sim/hoods';
import { createMockWorld, createMockGang, createMockLocation, createMockHood } from './factories';

describe('Hoods System (Isolated Unit Tests)', () => {
  it('hires a hood, deducts hiring cost from gang, and assigns to node', () => {
    const prng = createPrng(100);
    const gang = createMockGang({ id: 'GANG_TEST', cash: 1000 });
    const loc = createMockLocation({
      id: 'REC_TEST',
      kind: 'RECRUITER',
      gangId: gang.id,
      assignedHoodId: undefined,
    });
    const world = createMockWorld({
      gangs: { [gang.id]: gang },
      locations: { [loc.id]: loc },
    });

    const events: any[] = [];
    const hood = hireHood(
      world,
      gang.id,
      'RECRUITER_MANAGER',
      { type: 'MANAGE_NODE', targetId: loc.id, role: 'RECRUITER_MANAGER' },
      prng,
      events
    );

    expect(hood).toBeDefined();
    expect(hood.gangId).toBe(gang.id);
    expect(hood.role).toBe('RECRUITER_MANAGER');
    expect(gang.cash).toBe(1000 - HOOD_HIRING_COST);
    expect(world.hoods[hood.id]).toBe(hood);
    expect(world.stats.totalHoodsEmployed).toBe(1);
    expect(loc.assignedHoodId).toBe(hood.id);
    expect(loc.operationalStatus).toBe('ACTIVE');
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('HOOD_HIRED');
  });

  it('deducts payroll only on tick cycle intervals (every 60 ticks)', () => {
    const gang = createMockGang({ id: 'GANG_PAY', cash: 2000 });
    const hood1 = createMockHood({ id: 'H1', gangId: gang.id });
    const hood2 = createMockHood({ id: 'H2', gangId: gang.id });

    // Tick 59 (not a payroll tick)
    const world59 = createMockWorld({
      tick: 59,
      gangs: { [gang.id]: gang },
      hoods: { [hood1.id]: hood1, [hood2.id]: hood2 },
    });
    processPayroll(world59);
    expect(gang.cash).toBe(2000);

    // Tick 60 (payroll tick!)
    const world60 = createMockWorld({
      tick: 60,
      gangs: { [gang.id]: gang },
      hoods: { [hood1.id]: hood1, [hood2.id]: hood2 },
    });
    const events: any[] = [];
    processPayroll(world60, events);

    const expectedPayroll = 2 * HOOD_WAGE_PER_CYCLE;
    expect(gang.cash).toBe(2000 - expectedPayroll);
    expect(gang.wageBillTotal).toBe(expectedPayroll);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('PAYROLL_PAID');
  });
});
