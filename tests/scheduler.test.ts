import { describe, it, expect, vi } from 'vitest';
import { TickScheduler } from '../src/app/TickScheduler';
import type { GamePort } from '../src/app/GamePort';

describe('TickScheduler Unit Tests', () => {
  function createMockPort(): GamePort {
    return {
      advance: vi.fn(),
      reset: vi.fn(),
      dispatch: vi.fn(),
      subscribe: vi.fn(),
      getSnapshot: vi.fn() as any,
    };
  }

  it('initializes at timeScale 1.0 (unpaused)', () => {
    const port = createMockPort();
    const scheduler = new TickScheduler(port);

    expect(scheduler.getTimeScale()).toBe(1.0);
    expect(scheduler.isPaused()).toBe(false);
  });

  it('toggles pause on and off with spacebar logic, preserving previous speed', () => {
    const port = createMockPort();
    const scheduler = new TickScheduler(port);

    // Initial: 1x speed
    expect(scheduler.getTimeScale()).toBe(1.0);

    // First toggle: pauses simulation
    const pausedScale = scheduler.togglePause();
    expect(pausedScale).toBe(0);
    expect(scheduler.getTimeScale()).toBe(0);
    expect(scheduler.isPaused()).toBe(true);

    // Second toggle: unpauses and restores previous 1.0 speed
    const resumedScale = scheduler.togglePause();
    expect(resumedScale).toBe(1.0);
    expect(scheduler.getTimeScale()).toBe(1.0);
    expect(scheduler.isPaused()).toBe(false);
  });

  it('restores custom timeScale (e.g. 5x or 20x) when unpausing', () => {
    const port = createMockPort();
    const scheduler = new TickScheduler(port);

    scheduler.setTimeScale(5.0);
    expect(scheduler.getTimeScale()).toBe(5.0);

    // Toggle pause
    scheduler.togglePause();
    expect(scheduler.isPaused()).toBe(true);
    expect(scheduler.getTimeScale()).toBe(0);

    // Toggle unpause: should restore 5.0
    scheduler.togglePause();
    expect(scheduler.isPaused()).toBe(false);
    expect(scheduler.getTimeScale()).toBe(5.0);
  });

  it('does not advance port ticks when paused', () => {
    const port = createMockPort();
    const scheduler = new TickScheduler(port);

    scheduler.togglePause();
    expect(scheduler.isPaused()).toBe(true);

    scheduler.update(500);
    expect(port.advance).not.toHaveBeenCalled();
  });

  it('advances port ticks when active', () => {
    const port = createMockPort();
    const scheduler = new TickScheduler(port);

    // 150ms interval per tick => 300ms should trigger 2 ticks
    scheduler.update(300);
    expect(port.advance).toHaveBeenCalledWith(1);
    expect(port.advance).toHaveBeenCalledTimes(2);
  });

  it('allows manual step() even when paused', () => {
    const port = createMockPort();
    const scheduler = new TickScheduler(port);

    scheduler.togglePause();
    expect(scheduler.isPaused()).toBe(true);

    scheduler.step();
    expect(port.advance).toHaveBeenCalledWith(1);
    expect(port.advance).toHaveBeenCalledTimes(1);
  });

  it('resets timeScale to 1.0 and clears pause state on reset', () => {
    const port = createMockPort();
    const scheduler = new TickScheduler(port);

    scheduler.setTimeScale(20.0);
    scheduler.togglePause();
    expect(scheduler.isPaused()).toBe(true);

    scheduler.reset();
    expect(scheduler.getTimeScale()).toBe(1.0);
    expect(scheduler.isPaused()).toBe(false);
    expect(port.reset).toHaveBeenCalled();
  });
});
