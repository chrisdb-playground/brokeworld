import { describe, it, expect } from 'vitest';
import { createPrng } from '../src/sim/rng';
import { spawnMigrants } from '../src/sim/spawner';
import { acceptProspect } from '../src/sim/recruitment';
import {
  bootMigrant,
  assignMigrantToWorkshop,
  assignMigrantToCriminalEnterprise,
  forwardMigrantToRecruiter,
  toggleLockdown,
} from '../src/sim/depotActions';
import { getRecruiterReputation, updateRecruiterReputation } from '../src/sim/reputation';
import { BALANCE } from '../src/sim/balance';
import {
  createMockWorld,
  createMockGang,
  createMockLocation,
  createMockRoute,
  createMockMigrant,
  createMockHood,
} from './factories';
import type { SimEvent } from '../src/sim/types';

describe('Broke World V2 Specification Tests', () => {
  describe('1. Prospect Generation & Attributes', () => {
    it('spawns prospects with persistent destination, goal, happiness, and expiration', () => {
      const prng = createPrng(42);
      const gang = createMockGang({ id: 'GANG_TEST' });
      const hood = createMockHood({
        id: 'HOOD_1',
        gangId: gang.id,
        assignment: { type: 'MANAGE_NODE', targetId: 'REC_1', role: 'RECRUITER_MANAGER' },
      });
      const rec = createMockLocation({
        id: 'REC_1',
        kind: 'RECRUITER',
        region: 'AFRICA',
        gangId: gang.id,
        assignedHoodId: hood.id,
        reputation: 80,
      });
      const dep = createMockLocation({
        id: 'DEP_1',
        kind: 'DEPOT',
        region: 'EUROPE',
        gangId: gang.id,
      });
      const route = createMockRoute({ id: 'R1', sourceId: rec.id, targetId: dep.id, gangId: gang.id, status: 'ACTIVE' });

      const world = createMockWorld({
        gangs: { [gang.id]: gang },
        hoods: { [hood.id]: hood },
        locations: { [rec.id]: rec, [dep.id]: dep },
        routes: { [route.id]: route },
        migrants: {},
        stats: { activeMigrants: 0, totalDepartedMigrants: 0, totalVoyagesLaunched: 0, totalVoyagesSuccess: 0, totalVoyagesDisrupted: 0, totalActiveRoutes: 1, totalHoodsEmployed: 1 },
      });

      const events: SimEvent[] = [];
      // Run spawner until a prospect is generated
      for (let i = 0; i < 50; i++) {
        spawnMigrants(world, prng, events);
        if (Object.keys(world.migrants).length > 0) break;
      }

      const prospects = Object.values(world.migrants);
      expect(prospects.length).toBeGreaterThan(0);

      const p = prospects[0];
      expect(p.status).toBe('PROSPECT');
      expect(p.originRecruiterId).toBe(rec.id);
      expect(['LEAVE', 'WORK', 'CRIME', 'MARRY']).toContain(p.goal);
      expect(p.happiness).toBeGreaterThanOrEqual(0);
      expect(p.happiness).toBeLessThanOrEqual(100);
      expect(p.offer).toBeGreaterThan(0);
      expect(p.destinationId).toBe(dep.id);
      expect(p.destinationReached).toBe(false);
      expect(p.goalFulfilled).toBe(false);
      expect(p.prospectExpiresTick).toBeGreaterThan(world.tick);
    });
  });

  describe('2. Upfront Payment & Single Charge', () => {
    it('acceptProspect collects upfront payment into gang cash exactly once', () => {
      const gang = createMockGang({ id: 'GANG_A', cash: 1000 });
      const hood = createMockHood({
        id: 'HOOD_A',
        gangId: gang.id,
        assignment: { type: 'MANAGE_NODE', targetId: 'REC_1', role: 'RECRUITER_MANAGER' },
      });
      const rec = createMockLocation({
        id: 'REC_1',
        kind: 'RECRUITER',
        gangId: gang.id,
        region: 'AFRICA',
        assignedHoodId: hood.id,
      });
      const migrant = createMockMigrant({
        id: 'M_1',
        originId: rec.id,
        originRecruiterId: rec.id,
        status: 'PROSPECT',
        offer: 650,
      });

      const world = createMockWorld({
        gangs: { [gang.id]: gang },
        hoods: { [hood.id]: hood },
        locations: { [rec.id]: rec },
        migrants: { [migrant.id]: migrant },
      });

      const events: SimEvent[] = [];
      const ok = acceptProspect(world, migrant.id, events);

      expect(ok).toBe(true);
      expect(migrant.status).toBe('RECRUITED');
      expect(migrant.recruitedByGangId).toBe(gang.id);
      expect(gang.cash).toBe(1650); // 1000 + 650
      expect(events.some((e) => e.type === 'MIGRANT_RECRUITED')).toBe(true);

      // Attempting to accept again should fail and not collect extra cash
      const okAgain = acceptProspect(world, migrant.id, events);
      expect(okAgain).toBe(false);
      expect(gang.cash).toBe(1650);
    });
  });

  describe('3. Multi-Hop Journeys & Forwarding', () => {
    it('migrant reaches intermediate depot: destinationReached is false; forwarding preserves attributes without charging again', () => {
      const gang = createMockGang({ id: 'GANG_A', cash: 5000 });
      const rec1 = createMockLocation({ id: 'REC_1', kind: 'RECRUITER', region: 'AFRICA', gangId: gang.id });
      const dep1 = createMockLocation({ id: 'DEP_1', kind: 'DEPOT', region: 'EUROPE', gangId: gang.id });
      const rec2 = createMockLocation({ id: 'REC_2', kind: 'RECRUITER', region: 'EUROPE', gangId: gang.id, operationalStatus: 'ACTIVE' });
      const finalDest = createMockLocation({ id: 'WS_LONDON', kind: 'WORKSHOP', region: 'UK', gangId: gang.id });

      const migrant = createMockMigrant({
        id: 'M_JOURNEY',
        originId: dep1.id, // currently at DEP_1
        originRecruiterId: rec1.id,
        destinationId: finalDest.id,
        destinationRegion: 'UK',
        goal: 'WORK',
        status: 'ARRIVED',

        happiness: 60,
        offer: 1200,
        destinationReached: false,
        goalFulfilled: false,
      });

      const world = createMockWorld({
        gangs: { [gang.id]: gang },
        locations: { [rec1.id]: rec1, [dep1.id]: dep1, [rec2.id]: rec2, [finalDest.id]: finalDest },
        migrants: { [migrant.id]: migrant },
      });

      const events: SimEvent[] = [];

      // Forward from intermediate depot to recruiter in same region (REC_2)
      const fwdOk = forwardMigrantToRecruiter(world, migrant.id, rec2.id, events);
      expect(fwdOk).toBe(true);

      // Check preserved state
      expect(migrant.status).toBe('RECRUITED');
      expect(migrant.originId).toBe(rec2.id);
      expect(migrant.originRecruiterId).toBe(rec1.id); // original recruiter retained!
      expect(migrant.destinationId).toBe(finalDest.id); // original destination retained!
      expect(migrant.goal).toBe('WORK');
      expect(migrant.offer).toBe(1200);
      expect(gang.cash).toBe(5000); // NO SECOND PAYMENT CHARGED
      expect(events.some((e) => e.type === 'MIGRANT_TRANSFERRED')).toBe(true);
    });
  });

  describe('4. Goal Fulfillment Requires Destination First', () => {
    it('assigning WORK migrant to workshop BEFORE destination does NOT fulfill goal', () => {
      const gang = createMockGang({ id: 'GANG_A' });
      const depIntermediate = createMockLocation({ id: 'DEP_CALAIS', kind: 'DEPOT', region: 'EUROPE', gangId: gang.id });
      const wsIntermediate = createMockLocation({ id: 'WS_CALAIS', kind: 'WORKSHOP', region: 'EUROPE', gangId: gang.id });
      const destLondon = createMockLocation({ id: 'WS_LONDON', kind: 'WORKSHOP', region: 'UK', gangId: gang.id });

      const migrant = createMockMigrant({
        id: 'M_WORKER',
        status: 'ARRIVED',
        originId: depIntermediate.id,

        destinationId: destLondon.id, // Target is London!
        destinationRegion: 'UK',
        goal: 'WORK',
        happiness: 50,
        destinationReached: false,
        goalFulfilled: false,
      });

      const world = createMockWorld({
        gangs: { [gang.id]: gang },
        locations: { [depIntermediate.id]: depIntermediate, [wsIntermediate.id]: wsIntermediate, [destLondon.id]: destLondon },
        migrants: { [migrant.id]: migrant },
      });

      const events: SimEvent[] = [];
      const ok = assignMigrantToWorkshop(world, migrant.id, wsIntermediate.id, events);

      expect(ok).toBe(true);
      expect(migrant.originId).toBe(wsIntermediate.id);
      expect(migrant.destinationReached).toBe(false);
      expect(migrant.goalFulfilled).toBe(false); // NOT fulfilled!
      expect(migrant.happiness).toBeLessThan(50); // Penalty for premature assignment contrary to journey
    });

    it('assigning WORK migrant to workshop AT final destination fulfills goal and increases happiness', () => {
      const gang = createMockGang({ id: 'GANG_A' });
      const depLondon = createMockLocation({ id: 'DEP_LONDON', kind: 'DEPOT', region: 'UK', gangId: gang.id });
      const wsLondon = createMockLocation({ id: 'WS_LONDON', kind: 'WORKSHOP', region: 'UK', gangId: gang.id });

      const migrant = createMockMigrant({
        id: 'M_WORKER_DEST',
        status: 'ARRIVED',
        originId: depLondon.id,

        destinationId: wsLondon.id, // Target is this workshop!
        destinationRegion: 'UK',
        goal: 'WORK',
        happiness: 50,
        destinationReached: false,
        goalFulfilled: false,
      });

      const world = createMockWorld({
        gangs: { [gang.id]: gang },
        locations: { [depLondon.id]: depLondon, [wsLondon.id]: wsLondon },
        migrants: { [migrant.id]: migrant },
      });

      const events: SimEvent[] = [];
      const ok = assignMigrantToWorkshop(world, migrant.id, wsLondon.id, events);

      expect(ok).toBe(true);
      expect(migrant.originId).toBe(wsLondon.id);
      expect(migrant.destinationReached).toBe(true);
      expect(migrant.goalFulfilled).toBe(true); // FULFILLED!
      expect(migrant.happiness).toBeGreaterThan(50); // Boosted!
      expect(events.some((e) => e.type === 'MIGRANT_ASSIGNED')).toBe(true);
    });

    it('booting LEAVE migrant at destination fulfills LEAVE goal and awards recruiter reputation', () => {
      const gang = createMockGang({ id: 'GANG_A' });
      const rec = createMockLocation({ id: 'REC_ORIGIN', kind: 'RECRUITER', region: 'AFRICA', gangId: gang.id, reputation: 50 });
      const depDest = createMockLocation({ id: 'DEP_DEST', kind: 'DEPOT', region: 'UK', gangId: gang.id });

      const migrant = createMockMigrant({
        id: 'M_LEAVE_DEST',
        originRecruiterId: rec.id,
        status: 'ARRIVED',
        originId: depDest.id, // at destination depot

        destinationId: depDest.id,
        destinationReached: true,
        goal: 'LEAVE',
        happiness: 60,
        goalFulfilled: false,
      });

      const world = createMockWorld({
        gangs: { [gang.id]: gang },
        locations: { [rec.id]: rec, [depDest.id]: depDest },
        migrants: { [migrant.id]: migrant },
      });

      const events: SimEvent[] = [];
      const ok = bootMigrant(world, migrant.id, events);

      expect(ok).toBe(true);
      expect(migrant.status).toBe('DEPARTED');
      expect(migrant.goalFulfilled).toBe(true);
      expect(rec.reputation).toBeGreaterThan(50); // Gained reputation!
      expect(events.some((e) => e.type === 'RECRUITER_REP_CHANGED')).toBe(true);
    });

    it('booting migrant BEFORE reaching destination penalizes recruiter reputation', () => {
      const gang = createMockGang({ id: 'GANG_A' });
      const rec = createMockLocation({ id: 'REC_ORIGIN', kind: 'RECRUITER', region: 'AFRICA', gangId: gang.id, reputation: 50 });
      const depInter = createMockLocation({ id: 'DEP_INTER', kind: 'DEPOT', region: 'EUROPE', gangId: gang.id });
      const finalDest = createMockLocation({ id: 'DEP_DEST', kind: 'DEPOT', region: 'UK', gangId: gang.id });

      const migrant = createMockMigrant({
        id: 'M_ABANDONED',
        originRecruiterId: rec.id,
        status: 'ARRIVED',
        originId: depInter.id,

        destinationId: finalDest.id,
        destinationReached: false,
        goal: 'LEAVE',
        happiness: 50,
      });

      const world = createMockWorld({
        gangs: { [gang.id]: gang },
        locations: { [rec.id]: rec, [depInter.id]: depInter, [finalDest.id]: finalDest },
        migrants: { [migrant.id]: migrant },
      });

      const events: SimEvent[] = [];
      const ok = bootMigrant(world, migrant.id, events);

      expect(ok).toBe(true);
      expect(migrant.status).toBe('DEPARTED');
      expect(rec.reputation).toBeLessThan(50); // Reputation penalty!
      expect(events.some((e) => e.type === 'RECRUITER_REP_CHANGED')).toBe(true);
    });
  });

  describe('5. Lockdown Functionality', () => {
    it('toggleLockdown correctly changes lockdown state on depots and production nodes', () => {
      const dep = createMockLocation({ id: 'DEP_LOCK', kind: 'DEPOT', lockdown: false });
      const world = createMockWorld({
        locations: { [dep.id]: dep },
      });

      const events: SimEvent[] = [];
      const state1 = toggleLockdown(world, dep.id, events);
      expect(state1).toBe(true);
      expect(dep.lockdown).toBe(true);
      expect(events.some((e) => e.type === 'LOCKDOWN_TOGGLED')).toBe(true);

      const state2 = toggleLockdown(world, dep.id, events);
      expect(state2).toBe(true);
      expect(dep.lockdown).toBe(false);
    });
  });

  describe('6. Recruiter Reputation Bounding', () => {
    it('clamps recruiter reputation strictly between 0 and 100', () => {
      const rec = createMockLocation({ id: 'REC_BOUNDS', kind: 'RECRUITER', reputation: 95 });
      const world = createMockWorld({ locations: { [rec.id]: rec } });
      const events: SimEvent[] = [];

      updateRecruiterReputation(world, rec.id, 20, events, 'Big bonus');
      expect(rec.reputation).toBe(100);

      updateRecruiterReputation(world, rec.id, -150, events, 'Huge penalty');
      expect(rec.reputation).toBe(0);
    });
  });
});
