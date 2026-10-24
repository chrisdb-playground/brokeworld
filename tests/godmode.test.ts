import { describe, it, expect } from 'vitest';
import { createPrng } from '../src/sim/rng';
import { handleCommand } from '../src/sim/commands';
import { createMockGang, createMockLocation, createMockWorld } from './factories';
import type { SimEvent, VoyageState } from '../src/sim/types';

describe('God Mode Commands Unit Tests', () => {
  it('grants and drains gang cash via GANG_AID and SET_GANG_CASH', () => {
    const prng = createPrng(1);
    const gang = createMockGang({ id: 'GANG_GOD', cash: 2000 });
    const world = createMockWorld({ gangs: { [gang.id]: gang } });
    const events: SimEvent[] = [];

    // 1. Grant cash
    handleCommand(world, { type: 'GANG_AID', payload: { gangId: gang.id, amount: 5000 } }, events, prng);
    expect(gang.cash).toBe(7000);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('GOD_INTERVENTION');

    // 2. Set exact cash
    handleCommand(world, { type: 'SET_GANG_CASH', payload: { gangId: gang.id, cash: 50000 } }, events, prng);
    expect(gang.cash).toBe(50000);

    // 3. Bankrupt gang with 0 cash
    handleCommand(world, { type: 'SET_GANG_CASH', payload: { gangId: gang.id, cash: 0 } }, events, prng);
    expect(gang.cash).toBe(0);
  });

  it('toggles gang AI autonomy via TOGGLE_GANG_AI', () => {
    const prng = createPrng(2);
    const gang = createMockGang({ id: 'GANG_AI', isAiDisabled: false });
    const world = createMockWorld({ gangs: { [gang.id]: gang } });
    const events: SimEvent[] = [];

    // Pause AI
    handleCommand(world, { type: 'TOGGLE_GANG_AI', payload: { gangId: gang.id, enabled: false } }, events, prng);
    expect(gang.isAiDisabled).toBe(true);

    // Re-enable AI
    handleCommand(world, { type: 'TOGGLE_GANG_AI', payload: { gangId: gang.id, enabled: true } }, events, prng);
    expect(gang.isAiDisabled).toBe(false);
  });

  it('alters gang underworld reputation via SET_GANG_REPUTATION', () => {
    const prng = createPrng(3);
    const gang = createMockGang({ id: 'GANG_REP', reputation: 50 });
    const world = createMockWorld({ gangs: { [gang.id]: gang } });
    const events: SimEvent[] = [];

    handleCommand(world, { type: 'SET_GANG_REPUTATION', payload: { gangId: gang.id, reputation: 95 } }, events, prng);
    expect(gang.reputation).toBe(95);

    // Clamps to 100
    handleCommand(world, { type: 'SET_GANG_REPUTATION', payload: { gangId: gang.id, reputation: 150 } }, events, prng);
    expect(gang.reputation).toBe(100);
  });

  it('spawns high-budget migrants directly via SPAWN_MIGRANTS', () => {
    const prng = createPrng(4);
    const gang = createMockGang({ id: 'GANG_SPAWN' });
    const rec = createMockLocation({ id: 'LOC_REC', kind: 'RECRUITER', gangId: gang.id, region: 'AFRICA', operationalStatus: 'ACTIVE' });
    gang.recruiterLocationIds = [rec.id];

    const world = createMockWorld({
      gangs: { [gang.id]: gang },
      locations: { [rec.id]: rec },
    });
    const events: SimEvent[] = [];

    handleCommand(world, { type: 'SPAWN_MIGRANTS', payload: { gangId: gang.id, count: 5 } }, events, prng);
    expect(Object.keys(world.migrants).length).toBe(5);
    expect(world.stats.activeMigrants).toBe(5);

    const firstMigrant = Object.values(world.migrants)[0];
    expect(firstMigrant.cash).toBeGreaterThan(2000);
    expect(firstMigrant.status).toBe('WAITING');
  });

  it('instant delivers voyages via FAST_FORWARD_VOYAGES', () => {
    const prng = createPrng(5);
    const gang = createMockGang({ id: 'GANG_VOY', cash: 1000 });
    const voyage: VoyageState = {
      id: 'VOY_1',
      gangId: gang.id,
      routeId: 'ROUTE_1',
      sourceId: 'LOC_1',
      targetId: 'LOC_2',
      mode: 'BOAT',
      passengerIds: [],
      startTick: 10,
      durationTicks: 20,
      progress: 0.5,
      status: 'IN_PROGRESS',
    };

    const world = createMockWorld({
      gangs: { [gang.id]: gang },
      voyages: { [voyage.id]: voyage },
    });
    const events: SimEvent[] = [];

    handleCommand(world, { type: 'FAST_FORWARD_VOYAGES', payload: { gangId: gang.id } }, events, prng);
    expect(voyage.status).toBe('SUCCESS');
    expect(voyage.progress).toBe(1.0);
    expect(gang.cash).toBe(1500); // 1000 + 500 min payout
    expect(gang.stats.voyagesSuccessful).toBe(1);
    expect(world.stats.totalVoyagesSuccess).toBe(1);
  });

  it('triggers raid disruptions via TRIGGER_RAID', () => {
    const prng = createPrng(6);
    const gang = createMockGang({ id: 'GANG_RAID', reputation: 50 });
    const voyage: VoyageState = {
      id: 'VOY_RAID',
      gangId: gang.id,
      routeId: 'ROUTE_1',
      sourceId: 'LOC_1',
      targetId: 'LOC_2',
      mode: 'BOAT',
      passengerIds: [],
      startTick: 10,
      durationTicks: 20,
      progress: 0.3,
      status: 'IN_PROGRESS',
    };

    const world = createMockWorld({
      gangs: { [gang.id]: gang },
      voyages: { [voyage.id]: voyage },
    });
    const events: SimEvent[] = [];

    handleCommand(world, { type: 'TRIGGER_RAID', payload: { gangId: gang.id } }, events, prng);
    expect(voyage.status).toBe('INTERCEPTED');
    expect(gang.stats.voyagesDisrupted).toBe(1);
    expect(world.stats.totalVoyagesDisrupted).toBe(1);
    expect(gang.reputation).toBe(35); // 50 - 15
  });

  it('disburses universal stimulus to all gangs via GLOBAL_AID', () => {
    const prng = createPrng(7);
    const gang1 = createMockGang({ id: 'G1', cash: 1000 });
    const gang2 = createMockGang({ id: 'G2', cash: 2000 });
    const world = createMockWorld({
      gangs: { [gang1.id]: gang1, [gang2.id]: gang2 },
    });
    const events: SimEvent[] = [];

    handleCommand(world, { type: 'GLOBAL_AID', payload: { amount: 10000 } }, events, prng);
    expect(gang1.cash).toBe(11000);
    expect(gang2.cash).toBe(12000);
  });
});
