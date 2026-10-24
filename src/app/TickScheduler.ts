import type { GamePort } from './GamePort';

export class TickScheduler {
  private port: GamePort;
  private timeScale: number = 1.0; // 0 = paused, 1 = 1x, 5 = 5x, 20 = 20x
  private previousTimeScale: number = 1.0;
  private tickIntervalMs: number = 150; // 150ms per tick => 1.5 seconds per game day
  private accumulatorMs: number = 0;

  constructor(port: GamePort) {
    this.port = port;
  }

  setTimeScale(scale: number): void {
    const valid = Math.max(0, scale);
    if (valid > 0) {
      this.previousTimeScale = valid;
    }
    this.timeScale = valid;
  }

  getTimeScale(): number {
    return this.timeScale;
  }

  getPreviousTimeScale(): number {
    return this.previousTimeScale;
  }

  togglePause(): number {
    if (this.timeScale > 0) {
      this.previousTimeScale = this.timeScale;
      this.timeScale = 0;
    } else {
      this.timeScale = this.previousTimeScale > 0 ? this.previousTimeScale : 1.0;
    }
    return this.timeScale;
  }

  isPaused(): boolean {
    return this.timeScale <= 0;
  }

  step(): void {
    this.port.advance(1);
  }

  reset(seed?: number): void {
    this.accumulatorMs = 0;
    this.timeScale = 1.0;
    this.previousTimeScale = 1.0;
    this.port.reset(seed);
  }

  update(deltaMs: number): void {
    if (this.timeScale <= 0) return;

    this.accumulatorMs += deltaMs * this.timeScale;
    // Cap accumulator to avoid spiral of death on long lag spikes
    if (this.accumulatorMs > 1500) {
      this.accumulatorMs = 1500;
    }

    while (this.accumulatorMs >= this.tickIntervalMs) {
      this.port.advance(1);
      this.accumulatorMs -= this.tickIntervalMs;
    }
  }
}
