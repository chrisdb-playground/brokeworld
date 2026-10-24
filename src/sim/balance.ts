// Centralized Balancing Constants for Broke World
// All balancing numbers, rates, and deltas are defined here to avoid duplication.

export const BALANCE = {
  // Recruiter Reputation
  INITIAL_RECRUITER_REPUTATION: 60,
  REP_DELTA_GOAL_FULFILLED: 12,       // Significant increase when reaching destination and fulfilling goal
  REP_DELTA_LEAVE_COMPLETED: 10,      // Increase when migrant voluntarily completes LEAVE goal at destination
  REP_DELTA_BOOTED_BEFORE_DEST: -10,  // Decrease when booted/abandoned before destination
  REP_DELTA_BOOTED_UNFULFILLED: -5,   // Decrease when booted at destination with unfulfilled goal
  REP_DELTA_MIGRANT_LOST: -20,        // Significant decrease when migrant is lost/intercepted catastrophically

  // Prospect Generation & Spawning
  TARGET_POPULATION: 30,
  PROSPECT_SPAWN_CHANCE: 0.35,
  PROSPECT_EXPIRY_MIN_TICKS: 350,
  PROSPECT_EXPIRY_MAX_TICKS: 850,

  // Monetary Offers
  BASE_OFFER_1_HOP_MIN: 800,
  BASE_OFFER_1_HOP_MAX: 1200,
  BASE_OFFER_2_HOP_MIN: 1800,
  BASE_OFFER_2_HOP_MAX: 2600,

  // Happiness (0-100 scale)
  INITIAL_MIGRANT_HAPPINESS: 65,
  HAPPY_PROGRESS_HOP: 10,             // Progress toward destination (intermediate arrival)
  HAPPY_DESTINATION_REACHED: 20,      // Arrival at final destination node
  HAPPY_GOAL_FULFILLED: 25,           // Fulfillment of goal at destination
  HAPPY_MISMATCH_ASSIGNMENT: -15,     // Assignment contrary to migrant goal or before destination
  HAPPY_VOYAGE_DISRUPTED: -20,        // Disrupted/failed voyage
  HAPPY_WAITING_DECAY_INTERVAL: 40,   // Decay happiness while waiting
  HAPPY_WAITING_DECAY_AMOUNT: 1,
  HAPPY_LOCKDOWN_PENALTY_INTERVAL: 20,// Decay happiness while confined under lockdown
  HAPPY_LOCKDOWN_PENALTY_AMOUNT: 1,
};
