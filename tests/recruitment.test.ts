import { describe, it, expect } from 'vitest';
import { createPrng } from '../src/sim/rng';
import { processRecruitment } from '../src/sim/recruitment';
import {
  createMockWorld,
  createMockGang,
  createMockLocation,
  createMockRoute,
  createMockMigrant,
  createMockHood,
} from './factories';

describe('Recruitment System (Isolated Unit Tests)', () => {
  it('decrements patience and marks Migrant as DEPARTED when patience reaches 0', () => {
    const prng = createPrng(42);
    const migrant = createMockMigrant({
      id: 'MIGRANT_1',
      patienceRemainingTicks: 1,
      status: 'WAITING',
    });
    const world = createMockWorld({
      migrants: { [migrant.id]: migrant },
      stats: { activeMigrants: 1, totalDepartedMigrants: 0, totalVoyagesLaunched: 0, totalVoyagesSuccess: 0, totalVoyagesDisrupted: 0, totalActiveRoutes: 0, totalHoodsEmployed: 0 },
    });

    const events: any[] = [];
    processRecruitment(world, prng, events);

    expect(migrant.status).toBe('DEPARTED');
    expect(world.stats.activeMigrants).toBe(0);
    expect(world.stats.totalDepartedMigrants).toBe(1);
    expect(migrant.history.some((h) => h.includes('Grew tired of waiting'))).toBe(true);
  });

  it('does NOT recruit if recruiter node has no managing hood assigned', () => {
    const prng = createPrng(42);
    const gang = createMockGang({ id: 'GANG_NEON' });
    const rec = createMockLocation({
      id: 'REC_AFRICA',
      kind: 'RECRUITER',
      gangId: gang.id,
      region: 'AFRICA',
      assignedHoodId: undefined,
    });
    const dep = createMockLocation({
      id: 'DEP_EUR',
      kind: 'DEPOT',
      gangId: gang.id,
      region: 'EUROPE',
    });
    const route = createMockRoute({
      gangId: gang.id,
      sourceId: rec.id,
      targetId: dep.id,
      price: 1000,
      status: 'ACTIVE',
    });
    const migrant = createMockMigrant({
      originId: rec.id,
      desiredRegion: 'EUROPE',
      cash: 2000,
      status: 'WAITING',
    });

    const world = createMockWorld({
      gangs: { [gang.id]: gang },
      locations: { [rec.id]: rec, [dep.id]: dep },
      routes: { [route.id]: route },
      migrants: { [migrant.id]: migrant },
      hoods: {}, // No hoods in the world
    });

    const events: any[] = [];
    processRecruitment(world, prng, events);

    expect(migrant.status).toBe('WAITING');
    expect(migrant.recruitedByGangId).toBeUndefined();
  });

  it('successfully recruits eligible migrant when staffed and matching route exists', () => {
    const prng = createPrng(42);
    const gang = createMockGang({ id: 'GANG_CRIMSON', cash: 5000, color: '#ef4444' });
    const hood = createMockHood({
      id: 'HOOD_MANAGER_1',
      gangId: gang.id,
      role: 'RECRUITER_MANAGER',
      assignment: { type: 'MANAGE_NODE', targetId: 'REC_1', role: 'RECRUITER_MANAGER' },
    });
    const rec = createMockLocation({
      id: 'REC_1',
      kind: 'RECRUITER',
      gangId: gang.id,
      region: 'AFRICA',
      assignedHoodId: hood.id,
    });
    const dep = createMockLocation({
      id: 'DEP_1',
      kind: 'DEPOT',
      gangId: gang.id,
      region: 'EUROPE',
    });
    const route = createMockRoute({
      id: 'ROUTE_SEA_1',
      gangId: gang.id,
      sourceId: rec.id,
      targetId: dep.id,
      price: 1500,
      status: 'ACTIVE',
    });
    const migrant = createMockMigrant({
      id: 'MIGRANT_SEEKER',
      originId: rec.id,
      desiredRegion: 'EUROPE',
      cash: 3000,
      status: 'WAITING',
    });

    const world = createMockWorld({
      gangs: { [gang.id]: gang },
      locations: { [rec.id]: rec, [dep.id]: dep },
      routes: { [route.id]: route },
      hoods: { [hood.id]: hood },
      migrants: { [migrant.id]: migrant },
    });

    const events: any[] = [];
    processRecruitment(world, prng, events);

    expect(migrant.status).toBe('RECRUITED');
    expect(migrant.recruitedByGangId).toBe(gang.id);
    expect(migrant.assignedRouteId).toBe(route.id);
    expect(migrant.cash).toBe(1500); // 3000 - 1500
    expect(gang.cash).toBe(6500); // 5000 + 1500
    expect(gang.stats.recruitsTotal).toBe(1);
    expect(gang.stats.revenueTotal).toBe(1500);
    expect(route.revenue).toBe(1500);
    expect(migrant.avatar.shirtColor).toBe('#ef4444');
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('MIGRANT_RECRUITED');
  });

  it('rejects recruitment if migrant has insufficient funds for the route', () => {
    const prng = createPrng(42);
    const gang = createMockGang({ id: 'GANG_AMBER' });
    const hood = createMockHood({
      id: 'HOOD_1',
      gangId: gang.id,
      assignment: { type: 'MANAGE_NODE', targetId: 'REC_1', role: 'RECRUITER_MANAGER' },
    });
    const rec = createMockLocation({ id: 'REC_1', kind: 'RECRUITER', gangId: gang.id, region: 'AFRICA', assignedHoodId: hood.id });
    const dep = createMockLocation({ id: 'DEP_1', kind: 'DEPOT', gangId: gang.id, region: 'EUROPE' });
    const route = createMockRoute({ gangId: gang.id, sourceId: rec.id, targetId: dep.id, price: 2000, status: 'ACTIVE' });
    const migrant = createMockMigrant({ originId: rec.id, desiredRegion: 'EUROPE', cash: 500, status: 'WAITING' });

    const world = createMockWorld({
      gangs: { [gang.id]: gang },
      locations: { [rec.id]: rec, [dep.id]: dep },
      routes: { [route.id]: route },
      hoods: { [hood.id]: hood },
      migrants: { [migrant.id]: migrant },
    });

    const events: any[] = [];
    processRecruitment(world, prng, events);

    expect(migrant.status).toBe('WAITING');
    expect(migrant.cash).toBe(500);
    expect(gang.cash).toBe(gang.cash);
  });
});
