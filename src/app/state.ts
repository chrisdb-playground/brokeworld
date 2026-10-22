import { LocalGameEngine } from './GamePort';
import { TickScheduler } from './TickScheduler';

export const engine = new LocalGameEngine(2026);
export const scheduler = new TickScheduler(engine);
