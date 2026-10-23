# Simulation Rules: Invariants & Safety Guarantees

In Broke World, **invariants** are strict, non-negotiable structural and logical assertions that must remain true after every single simulation tick.

Source code reference:
- Implementation: [`invariants.ts`](file:///c:/Users/chris/src/playground/brokeworld/src/sim/invariants.ts)
- Tick execution: [`tick.ts`](file:///c:/Users/chris/src/playground/brokeworld/src/sim/tick.ts#L48)
- Soak test suite: [`soak.test.ts`](file:///c:/Users/chris/src/playground/brokeworld/tests/soak.test.ts)

---

## 🛡️ Formal Simulation Invariant Contract

The function [`assertInvariants(state: WorldSnapshot)`](file:///c:/Users/chris/src/playground/brokeworld/src/sim/invariants.ts#L3) runs on every discrete tick. If any of the following conditions fail, execution halts immediately with a descriptive error.

### 1. Location & Node Invariants
- **Permitted Kinds**: Location kinds must belong strictly to `['HQ', 'WORKSHOP', 'RECRUITER', 'DEPOT']`.
- **Mandatory Gang Ownership**: Every node must have a non-empty `gangId`. Neutral or unowned operational nodes trigger an invariant failure.
- **Valid Regions**: Region must belong strictly to `['AFRICA', 'EUROPE', 'UK']`.
- **Tile Family Enforcement**:
  - Kind `'RECRUITER'` $\rightarrow$ tileFamily `'crusher'` (Crusher mk3).
  - Kind `'DEPOT'` $\rightarrow$ tileFamily `'pressure-tank'` (Pressure Tank mk1).
  - Kind `'HQ'` $\rightarrow$ tileFamily `'logistics-hub'` (Logistics Hub mk1).
  - Kind `'WORKSHOP'` $\rightarrow$ tileFamily `'industrial-press'` (Industrial Press mk1).

### 2. Physical Connection Invariants
- **Endpoint Types**: Source must be a `RECRUITER` and target must be a `DEPOT`.
- **Cross-Border Guarantee**: All physical connections must have `isCrossBorder: true`. Domestic internal connections are prohibited.

### 3. Route Service Invariants
- **Strict Directionality**: Routes must operate from a `RECRUITER` to a `DEPOT` only.
- **Identical Gang Ownership**: Both endpoint nodes must share the same owner as the route:
  $$\operatorname{src}.\text{gangId} = \operatorname{route}.\text{gangId} = \operatorname{tgt}.\text{gangId}$$
- **1 Route Max Between Nodes**: At most one active route service can connect any specific source and target node pair:
  $$\operatorname{count}\left(\operatorname{route} \mid \text{sourceId} = A \land \text{targetId} = B \land \text{status} = \text{'ACTIVE'}\right) \le 1$$

### 4. Voyage Invariants
- **Valid Route Reference**: Every in-progress voyage must point to an existing, valid route ID in `state.routes`.
- **Matching Endpoints**: The voyage's `sourceId` and `targetId` must match the referenced route's endpoints exactly.
- **Directional Integrity**: Voyage source must be a `RECRUITER` and target must be a `DEPOT`.

### 5. Migrant State & Placement Invariants
- **Waiting Placement**: Any Migrant with `status === 'WAITING'` must be physically located at a `RECRUITER` node.
- **Arrived Placement**: Any Migrant with `status === 'ARRIVED'` must be physically located at a `DEPOT` node.
- **Regional Boundaries**:
  - `originRegion` must be in `['AFRICA', 'EUROPE']`.
  - `desiredRegion` must be in `['EUROPE', 'UK']`.

### 6. Population & Memory Bounds
- **Non-Negative Population**: `state.stats.activeMigrants >= 0`. Active population can never drop below zero.
- **Event Buffer Truncation**: Event logs are bounded to a maximum of **100 events** (`state.events.length <= 100`) to guarantee zero memory leakage across thousands of ticks.

---

## 🧪 Soak Testing & Verification Standards

Simulation stability is verified by continuous soak testing ([`soak.test.ts`](file:///c:/Users/chris/src/playground/brokeworld/tests/soak.test.ts)):

1. **Headless Execution**:
   The simulation runs headless for **2,500+ ticks** (~250 game days) without browser or DOM dependencies.
2. **Periodic Audit**:
   `assertInvariants(snapshot)` is evaluated at every 100-tick milestone.
3. **Syndicate Viability**:
   Verifies that the world never collapses to zero active gangs, and that arrivals and voyages continue to process smoothly without deadlocks.
