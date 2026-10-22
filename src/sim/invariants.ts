import type { WorldSnapshot } from './types';

export function assertInvariants(state: WorldSnapshot): void {
  // 1. Only allowed location kinds: HQ, WORKSHOP, RECRUITER, DEPOT
  // and "all nodes are owned by a single gang"
  for (const loc of Object.values(state.locations)) {
    if (!['HQ', 'WORKSHOP', 'RECRUITER', 'DEPOT'].includes(loc.kind)) {
      throw new Error(`Invariant failed: invalid location kind '${loc.kind}' for ${loc.id}`);
    }
    if (!loc.gangId) {
      throw new Error(`Invariant failed: node ${loc.id} must be owned by a single gang`);
    }
    if (!['AFRICA', 'EUROPE', 'UK'].includes(loc.region)) {
      throw new Error(`Invariant failed: invalid region '${loc.region}' for ${loc.id}`);
    }
    if (loc.kind === 'RECRUITER' && loc.tileFamily !== 'crusher') {
      throw new Error(`Invariant failed: recruiter ${loc.id} must use 'crusher' tile, got ${loc.tileFamily}`);
    }
    if (loc.kind === 'DEPOT' && loc.tileFamily !== 'pressure-tank') {
      throw new Error(`Invariant failed: depot ${loc.id} must use 'pressure-tank' tile, got ${loc.tileFamily}`);
    }
    if (loc.kind === 'HQ' && loc.tileFamily !== 'logistics-hub') {
      throw new Error(`Invariant failed: HQ ${loc.id} must use 'logistics-hub' tile, got ${loc.tileFamily}`);
    }
    if (loc.kind === 'WORKSHOP' && loc.tileFamily !== 'industrial-press') {
      throw new Error(`Invariant failed: workshop ${loc.id} must use 'industrial-press' tile, got ${loc.tileFamily}`);
    }
  }

  // 2. Physical connections connect RECRUITER -> DEPOT (cross-border) OR DEPOT -> WORKSHOP (same-region)
  for (const conn of Object.values(state.connections)) {
    const src = state.locations[conn.sourceId];
    const tgt = state.locations[conn.targetId];
    if (!src || !tgt) {
      throw new Error(`Invariant failed: connection ${conn.id} missing endpoint`);
    }
    const isRecToDepot = src.kind === 'RECRUITER' && tgt.kind === 'DEPOT';
    const isDepotToWorkshop = src.kind === 'DEPOT' && tgt.kind === 'WORKSHOP';

    if (!isRecToDepot && !isDepotToWorkshop) {
      throw new Error(`Invariant failed: connection ${conn.id} must connect RECRUITER->DEPOT or DEPOT->WORKSHOP`);
    }
    if (isRecToDepot && !conn.isCrossBorder) {
      throw new Error(`Invariant failed: RECRUITER->DEPOT connection ${conn.id} must be cross-border`);
    }
    if (isDepotToWorkshop && (conn.isCrossBorder || src.region !== tgt.region)) {
      throw new Error(`Invariant failed: DEPOT->WORKSHOP connection ${conn.id} must be in the same region`);
    }
  }

  // 3. Routes: RECRUITER -> DEPOT or DEPOT -> WORKSHOP
  // "all nodes are owned by a single gang, can only be used by that gang"
  // "1 route max between nodes"
  const pairCounts = new Map<string, number>();

  for (const route of Object.values(state.routes)) {
    if (route.status === 'ACTIVE') {
      const src = state.locations[route.sourceId];
      const tgt = state.locations[route.targetId];
      if (!src || !tgt) {
        throw new Error(`Invariant failed: route ${route.id} missing endpoint`);
      }
      const isRecToDepot = src.kind === 'RECRUITER' && tgt.kind === 'DEPOT';
      const isDepotToWorkshop = src.kind === 'DEPOT' && tgt.kind === 'WORKSHOP';

      if (!isRecToDepot && !isDepotToWorkshop) {
        throw new Error(`Invariant failed: route ${route.id} must be RECRUITER->DEPOT or DEPOT->WORKSHOP only`);
      }
      if (isDepotToWorkshop && src.region !== tgt.region) {
        throw new Error(`Invariant failed: route ${route.id} DEPOT->WORKSHOP must be in the same region`);
      }
      if (src.gangId !== route.gangId || tgt.gangId !== route.gangId) {
        throw new Error(`Invariant failed: route ${route.id} nodes must be owned by the route's gang ${route.gangId}`);
      }

      // 1 route max between nodes check
      const pairKey = `${route.sourceId}__${route.targetId}`;
      const count = (pairCounts.get(pairKey) || 0) + 1;
      if (count > 1) {
        throw new Error(`Invariant failed: 1 route max between nodes violated on ${pairKey}`);
      }
      pairCounts.set(pairKey, count);
    }
  }

  // 4. Every voyage has valid route, and matches route endpoints
  for (const voyage of Object.values(state.voyages)) {
    if (voyage.status === 'IN_PROGRESS') {
      const route = state.routes[voyage.routeId];
      if (!route) {
        throw new Error(`Invariant failed: voyage ${voyage.id} has missing route ${voyage.routeId}`);
      }
      if (route.sourceId !== voyage.sourceId || route.targetId !== voyage.targetId) {
        throw new Error(`Invariant failed: voyage ${voyage.id} endpoints do not match route ${route.id}`);
      }
      const src = state.locations[voyage.sourceId];
      const tgt = state.locations[voyage.targetId];
      const isRecToDepot = src?.kind === 'RECRUITER' && tgt?.kind === 'DEPOT';
      const isDepotToWorkshop = src?.kind === 'DEPOT' && tgt?.kind === 'WORKSHOP';
      if (!isRecToDepot && !isDepotToWorkshop) {
        throw new Error(`Invariant failed: voyage ${voyage.id} must be RECRUITER->DEPOT or DEPOT->WORKSHOP only`);
      }
    }
  }

  // 5. Chumigrants: waiting are at RECRUITER nodes; arrived are at DEPOT or WORKSHOP nodes
  for (const chum of Object.values(state.chumigrants)) {
    if (chum.status === 'WAITING') {
      const loc = state.locations[chum.originId];
      if (!loc || loc.kind !== 'RECRUITER') {
        throw new Error(`Invariant failed: waiting chum ${chum.id} must be at a RECRUITER node`);
      }
    }
    if (chum.status === 'ARRIVED') {
      const loc = state.locations[chum.originId];
      if (!loc || (loc.kind !== 'DEPOT' && loc.kind !== 'WORKSHOP')) {
        throw new Error(`Invariant failed: arrived chum ${chum.id} must be at a DEPOT or WORKSHOP node`);
      }
    }
    if (chum.originRegion && !['AFRICA', 'EUROPE'].includes(chum.originRegion)) {
      throw new Error(`Invariant failed: chum ${chum.id} invalid originRegion ${chum.originRegion}`);
    }
    if (chum.desiredRegion && !['EUROPE', 'UK'].includes(chum.desiredRegion)) {
      throw new Error(`Invariant failed: chum ${chum.id} invalid desiredRegion ${chum.desiredRegion}`);
    }
  }

  // 6. No negative active population
  if (state.stats.activeChums < 0) {
    throw new Error(`Invariant failed: negative active chum count ${state.stats.activeChums}`);
  }

  // 7. Hoods validation
  if (!state.hoods || typeof state.hoods !== 'object') {
    throw new Error('Invariant failed: state.hoods must be a valid dictionary');
  }

  for (const hood of Object.values(state.hoods)) {
    const gang = state.gangs[hood.gangId];
    if (!gang) {
      throw new Error(`Invariant failed: hood ${hood.id} belongs to missing gang ${hood.gangId}`);
    }
    if (hood.assignment.type === 'MANAGE_NODE') {
      const loc = state.locations[hood.assignment.targetId];
      if (!loc) {
        throw new Error(`Invariant failed: hood ${hood.id} assigned to missing node ${hood.assignment.targetId}`);
      }
      if (loc.gangId !== hood.gangId) {
        throw new Error(`Invariant failed: hood ${hood.id} gang does not match assigned node ${loc.id}`);
      }
    }
    if (hood.assignment.type === 'PILOT_VOYAGE') {
      const v = state.voyages[hood.assignment.targetId];
      if (!v) {
        throw new Error(`Invariant failed: hood ${hood.id} assigned to missing voyage ${hood.assignment.targetId}`);
      }
      if (v.gangId !== hood.gangId) {
        throw new Error(`Invariant failed: hood ${hood.id} gang does not match voyage ${v.id}`);
      }
    }
  }

  // 8. Every in-progress voyage has an assigned Hood skipper
  for (const voyage of Object.values(state.voyages)) {
    if (voyage.status === 'IN_PROGRESS') {
      if (!voyage.captainHoodId || !state.hoods[voyage.captainHoodId]) {
        throw new Error(`Invariant failed: in-progress voyage ${voyage.id} must have an assigned Hood skipper`);
      }
      if (state.hoods[voyage.captainHoodId].gangId !== voyage.gangId) {
        throw new Error(`Invariant failed: voyage ${voyage.id} skipper gang does not match voyage gang`);
      }
    }
  }
}
