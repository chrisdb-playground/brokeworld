// Pure TypeScript Simulation Types (No Phaser/DOM dependencies)

export type RegionId = 'AFRICA' | 'EUROPE' | 'UK';

export type LocationKind = 'HQ' | 'WORKSHOP' | 'RECRUITER' | 'DEPOT';

export interface LocationDef {
  id: string;
  name: string;
  region: RegionId;
  x: number;
  y: number;
  tileFamily: 'crusher' | 'pressure-tank' | 'logistics-hub' | 'industrial-press' | string;
  tileVariant: string;
  kind: LocationKind;
  gangId: string; // All nodes are owned by a single gang
  assignedHoodId?: string; // Hood currently managing or stationed at this node
  isMainHq?: boolean; // True for gang's primary headquarters
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
  capacity: number;
  price: number;
  durationTicks: number;
  reliability: number;
  status: 'ACTIVE' | 'CLOSING';
  totalPassengers: number;
  revenue: number;
  activeVoyageCount: number;
}

export interface ChumAvatarSpec {
  skinTone: string;
  shirtColor: string;
  eyesType: 'dots' | 'sleepy' | 'wide' | 'winking';
  mouthType: 'smile' | 'neutral' | 'frown' | 'open';
  hairColor: string;
  hairStyle: 'bald' | 'short' | 'curly' | 'beanie';
  luggage: 'briefcase' | 'backpack' | 'bundle' | 'none';
}

export interface ChumigrantState {
  id: string;
  name: string;
  originName: string; // Origin city/country (e.g. Tripoli, Alexandria, Calais)
  originRegion: RegionId; // 'AFRICA' | 'EUROPE'
  desiredRegion: 'EUROPE' | 'UK'; // Target destination region
  originId: string; // Recruiter node where chum is currently waiting
  cash: number;
  patienceRemainingTicks: number;
  status: 'WAITING' | 'RECRUITED' | 'IN_TRANSIT' | 'ARRIVED' | 'FAILED' | 'DEPARTED';
  recruitedByGangId?: string;
  assignedRouteId?: string;
  voyageId?: string;
  avatar: ChumAvatarSpec;
  history: string[];
}

export interface VoyageState {
  id: string;
  gangId: string;
  routeId: string;
  sourceId: string; // RECRUITER
  targetId: string; // DEPOT
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
  | 'STANDBY';

export interface HoodAssignment {
  type: 'MANAGE_NODE' | 'PILOT_VOYAGE' | 'IDLE_HQ';
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
  avatar: ChumAvatarSpec;
  hiredTick: number;
  history: string[];
}

export interface SimEvent {
  id: string;
  tick: number;
  type:
    | 'CHUM_SPAWNED'
    | 'CHUM_RECRUITED'
    | 'CHUM_ARRIVED'
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
    | 'HOOD_ASSIGNED';
  description: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  gangId?: string;
  locationId?: string;
}

export interface SimStats {
  activeChums: number;
  totalDepartedChums: number;
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
  chumigrants: Record<string, ChumigrantState>;
  voyages: Record<string, VoyageState>;
  hoods: Record<string, HoodState>;
  events: SimEvent[];
  stats: SimStats;
}

export interface SimCommand {
  type: string;
  payload?: unknown;
}
