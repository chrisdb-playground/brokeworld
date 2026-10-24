// Pure TypeScript Simulation Types (No Phaser/DOM dependencies)

export type RegionId = 'AFRICA' | 'EUROPE' | 'UK';

export type LocationKind = 'HQ' | 'WORKSHOP' | 'RECRUITER' | 'DEPOT' | 'CRIMINAL_ENTERPRISE';

export interface LocationDef {
  id: string;
  name: string;
  region: RegionId;
  x: number;
  y: number;
  tileFamily: 'crusher' | 'pressure-tank' | 'logistics-hub' | 'industrial-press' | string;
  tileVariant: string;
  kind: LocationKind;
  gangId: string; // If owned, gangId; if unowned candidate, 'NEUTRAL'
  assignedHoodId?: string; // Hood currently managing or stationed at this node
  isMainHq?: boolean; // True for gang's primary headquarters
  operationalStatus?: 'ACTIVE' | 'UNSTAFFED' | 'DISCOVERED_CANDIDATE';
  influenceRadius?: number; // Dynamic ticking influence radius for HQs
  candidateCost?: number; // Cost to purchase if unowned candidate
  discoveredByGangId?: string; // Gang whose scout dynamically discovered this candidate site
  createdAtTick?: number; // Tick when dynamically created by scout
  expiresAtTick?: number; // Tick when this unowned candidate node is removed if not purchased
  reputation?: number; // Recruiter reputation (0-100), belongs to recruiter node
  lockdown?: boolean; // Lockdown state for depots, workshops, criminal enterprises
}

export interface CandidateRouteOpportunity {
  id: string;
  gangId: string;
  sourceId: string; // RECRUITER node
  targetId: string; // DEPOT node
  charterCost: number;
  mode: 'BOAT' | 'VAN';
  isCrossBorder: boolean;
  createdAtTick: number;
  expiresAtTick: number;
}

export interface PhysicalConnectionDef {
  id: string;
  sourceId: string;
  targetId: string;
  isCrossBorder: boolean;
  distance: number;
  mode: 'LAND' | 'SEA';
}

export interface GangDecision {
  tick: number;
  action: string;
  reason: string;
}

export interface GangState {
  id: string;
  name: string;
  color: string;
  colorNum: number;
  emblem: string;
  hqLocationId: string; // Primary HQ location ID (backward compatible)
  mainHqLocationId?: string; // Main HQ location holding gang's Capo and reserve hoods
  hqLocationIds?: string[]; // All HQs owned by this gang across regions
  workshopLocationId?: string;
  recruiterLocationIds?: string[];
  depotLocationIds?: string[];
  cash: number;
  reputation: number; // 0 to 100
  status: 'ACTIVE' | 'BANKRUPT';
  recentDecisions: GangDecision[];
  discoveredNodeIds?: string[]; // Candidate nodes discovered by scouts
  discoveredRouteIds?: string[]; // Candidate border routes discovered by scouts
  discoveredCandidateRoutes?: CandidateRouteOpportunity[]; // Structured candidate routes with expiration
  wageBillTotal?: number; // Live calculated periodic payroll
  isAiDisabled?: boolean; // God mode override to pause autonomous AI decisions
  stats: {
    recruitsTotal: number;
    voyagesLaunched: number;
    voyagesSuccessful: number;
    voyagesDisrupted: number;
    revenueTotal: number;
  };
}

export interface OperationState {
  id: string;
  gangId: string;
  locationId: string;
  type: 'HQ' | 'WORKSHOP' | 'RECRUITER';
  status: 'ACTIVE' | 'CLOSED';
  openedTick: number;
}

export interface RouteServiceState {
  id: string;
  gangId: string;
  connectionId: string;
  sourceId: string; // RECRUITER node
  targetId: string; // DEPOT node
  mode: 'VAN' | 'BOAT';
  isCrossBorder?: boolean;
  assignedSkipperHoodId?: string;
  operationalStatus?: 'ACTIVE' | 'UNSTAFFED' | 'DISCOVERED_CANDIDATE';
  capacity: number;
  price: number;
  durationTicks: number;
  reliability: number;
  status: 'ACTIVE' | 'CLOSING';
  totalPassengers: number;
  revenue: number;
  activeVoyageCount: number;
}

export interface CorridorBundle {
  id: string; // e.g. CORRIDOR_{gangId}_{sourceHqId}_{targetHqId}
  gangId: string;
  sourceHqId: string;
  targetHqId: string;
  routes: RouteServiceState[];
  totalActiveVoyages: number;
  totalDelivered: number;
  totalRevenue: number;
  modes: Array<'BOAT' | 'VAN'>;
}

export interface MigrantAvatarSpec {
  skinTone: string;
  shirtColor: string;
  eyesType: 'dots' | 'sleepy' | 'wide' | 'winking';
  mouthType: 'smile' | 'neutral' | 'frown' | 'open';
  hairColor: string;
  hairStyle: 'bald' | 'short' | 'curly' | 'beanie';
  luggage: 'briefcase' | 'backpack' | 'bundle' | 'none';
}

export type MigrantGoal = 'LEAVE' | 'WORK' | 'CRIME' | 'MARRY';

export type MigrantStatus =
  | 'PROSPECT'
  | 'RECRUITED'
  | 'TRAVELLING'
  | 'AT_DEPOT'
  | 'ASSIGNED'
  | 'EXITED'
  | 'LOST'
  | 'WAITING'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'FAILED'
  | 'DEPARTED';

export interface MigrantState {
  id: string;
  name: string;
  originName: string; // Origin city/country (e.g. Tripoli, Alexandria, Calais)
  originRegion: RegionId; // 'AFRICA' | 'EUROPE'
  desiredRegion: 'EUROPE' | 'UK'; // Target destination region
  originId: string; // Current location node or vehicle
  destinationId?: string; // Desired final destination node ID
  destinationRegion?: RegionId; // Desired destination region
  goal?: MigrantGoal; // Desired activity after reaching destination: LEAVE | WORK | CRIME | MARRY
  happiness?: number; // Integer, 0-100
  offer?: number; // Upfront amount offered for transport all the way to final destination
  originRecruiterId?: string; // Recruiter where migrant first appeared
  destinationReached?: boolean; // Whether migrant has arrived at final destination
  goalFulfilled?: boolean; // Whether migrant goal has been fulfilled
  prospectExpiresTick?: number; // Tick when unaccepted prospect expires
  cash: number;
  patienceRemainingTicks: number;
  status: MigrantStatus;
  recruitedByGangId?: string;
  assignedRouteId?: string;
  voyageId?: string;
  avatar: MigrantAvatarSpec;
  history: string[];
}

export interface VoyageState {
  id: string;
  gangId: string;
  routeId: string;
  sourceId: string; // RECRUITER or DEPOT
  targetId: string; // DEPOT, WORKSHOP, or RECRUITER
  mode: 'VAN' | 'BOAT';
  passengerIds: string[];
  startTick: number;
  durationTicks: number;
  progress: number; // 0.0 to 1.0
  status: 'IN_PROGRESS' | 'SUCCESS' | 'DELAYED' | 'CANCELLED' | 'INTERCEPTED';
  captainHoodId?: string; // Hood currently skippering this voyage
}

export type HoodRole =
  | 'HQ_BOSS'
  | 'RECRUITER_MANAGER'
  | 'DEPOT_GUARD'
  | 'WORKSHOP_MECHANIC'
  | 'VOYAGE_SKIPPER'
  | 'SCOUT'
  | 'STANDBY';

export interface HoodAssignment {
  type: 'MANAGE_NODE' | 'PILOT_VOYAGE' | 'IDLE_HQ' | 'SCOUT_ZONE';
  targetId: string; // locationId, voyageId, or hqLocationId
  role: HoodRole;
}

export interface HoodState {
  id: string; // e.g. "HOOD_GANG_NEON_GILL_1"
  name: string; // e.g. "Capo Barnaby Sprat"
  gangId: string;
  role: HoodRole;
  assignment: HoodAssignment;
  currentTaskDescription: string;
  avatar: MigrantAvatarSpec;
  hiredTick: number;
  history: string[];
}

export interface SimEvent {
  id: string;
  tick: number;
  type:
    | 'MIGRANT_SPAWNED'
    | 'MIGRANT_RECRUITED'
    | 'MIGRANT_ARRIVED'
    | 'PROSPECT_SPAWNED'
    | 'PROSPECT_ACCEPTED'
    | 'PROSPECT_EXPIRED'
    | 'MIGRANT_TRANSFERRED'
    | 'MIGRANT_ASSIGNED'
    | 'MIGRANT_BOOTED'
    | 'MIGRANT_GOAL_FULFILLED'
    | 'RECRUITER_REP_CHANGED'
    | 'LOCKDOWN_TOGGLED'
    | 'VOYAGE_LAUNCHED'
    | 'VOYAGE_SUCCESS'
    | 'VOYAGE_DISRUPTED'
    | 'OPERATION_OPENED'
    | 'OPERATION_CLOSED'
    | 'ROUTE_OPENED'
    | 'ROUTE_CLOSED'
    | 'GANG_BANKRUPT'
    | 'GANG_FOUNDED'
    | 'HOOD_HIRED'
    | 'HOOD_ASSIGNED'
    | 'NODE_DISCOVERED'
    | 'ROUTE_DISCOVERED'
    | 'NODE_PURCHASED'
    | 'ROUTE_PURCHASED'
    | 'NODE_EXPIRED'
    | 'ROUTE_EXPIRED'
    | 'AREA_SCOUTED'
    | 'ROUTE_SEARCHED'
    | 'PAYROLL_PAID'
    | 'GOD_INTERVENTION';
  description: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  gangId?: string;
  locationId?: string;
}

export interface SimStats {
  activeMigrants: number;
  totalDepartedMigrants: number;
  totalVoyagesLaunched: number;
  totalVoyagesSuccess: number;
  totalVoyagesDisrupted: number;
  totalActiveRoutes: number;
  totalHoodsEmployed: number;
}

export interface WorldSnapshot {
  tick: number;
  seed: number;
  locations: Record<string, LocationDef>;
  connections: Record<string, PhysicalConnectionDef>;
  gangs: Record<string, GangState>;
  operations: Record<string, OperationState>;
  routes: Record<string, RouteServiceState>;
  migrants: Record<string, MigrantState>;
  voyages: Record<string, VoyageState>;
  hoods: Record<string, HoodState>;
  events: SimEvent[];
  stats: SimStats;
}

export interface SimCommand {
  type: string;
  payload?: unknown;
}
