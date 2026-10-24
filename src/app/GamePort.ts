import type { SimCommand, SimEvent, WorldSnapshot } from '../sim/types';
import { createPrng, type SeededPrng } from '../sim/rng';
import { createInitialWorld } from '../sim/createWorld';
import { tickWorld } from '../sim/tick';
import { handleCommand } from '../sim/commands';

export interface GamePort {
  getSnapshot(): WorldSnapshot;
  dispatch(command: SimCommand, immediate?: boolean): void;
  advance(ticks?: number): WorldSnapshot;
  subscribe(listener: (snapshot: WorldSnapshot) => void): () => void;
  reset(seed?: number): void;
}

export class LocalGameEngine implements GamePort {
  private state: WorldSnapshot;
  private prng: SeededPrng;
  private listeners: Set<(snapshot: WorldSnapshot) => void> = new Set();
  private pendingCommands: SimCommand[] = [];

  constructor(initialSeed = 1337) {
    this.prng = createPrng(initialSeed);
    this.state = createInitialWorld(this.prng);
  }

  getSnapshot(): WorldSnapshot {
    return this.state;
  }

  dispatch(command: SimCommand, immediate: boolean = false): void {
    if (immediate) {
      const newEvts: SimEvent[] = [];
      handleCommand(this.state, command, newEvts, this.prng);
      if (newEvts.length > 0) {
        this.state.events.unshift(...newEvts);
        if (this.state.events.length > 500) {
          this.state.events.length = 500;
        }
      }
      this.notify();
    } else {
      this.pendingCommands.push(command);
    }
  }

  advance(ticks = 1): WorldSnapshot {
    for (let i = 0; i < ticks; i++) {
      const cmds = [...this.pendingCommands];
      this.pendingCommands = [];
      this.state = tickWorld(this.state, this.prng, cmds);
    }
    this.notify();
    return this.state;
  }

  subscribe(listener: (snapshot: WorldSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  reset(seed?: number): void {
    const nextSeed = seed !== undefined ? seed : (this.state ? this.state.seed : 1337);
    this.prng = createPrng(nextSeed);
    this.state = createInitialWorld(this.prng);
    this.pendingCommands = [];
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (e) {
        console.error('Error in GamePort subscriber:', e);
      }
    }
  }
}
