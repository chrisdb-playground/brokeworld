# Simulation Rules: Nodes & Locations

Nodes represent fixed geographical infrastructure points in the Chum World simulation. All operational facilities, recruitment hubs, and transport terminals are modeled as nodes.

Source code reference:
- Type definitions: [`LocationDef`](file:///c:/Users/chris/src/playground/chumworld/src/sim/types.ts#L7-L17) & [`OperationState`](file:///c:/Users/chris/src/playground/chumworld/src/sim/types.ts#L57-L64)
- World generator: [`createWorld.ts`](file:///c:/Users/chris/src/playground/chumworld/src/sim/createWorld.ts#L20-L224)
- Verification logic: [`invariants.ts`](file:///c:/Users/chris/src/playground/chumworld/src/sim/invariants.ts#L4-L28)

---

## 🏗️ Node Kinds & Specifications

Every node belongs to exactly one of four functional kinds, each bound to a specific visual tile family:

| Kind | Purpose | Tile Family | Default Variant | Permitted Regions | Can Recruit Chums? | Can Host Routes? |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| **`HQ`** | Central syndicate command post & regional influence emitter. | `logistics-hub` | `mk1` | `AFRICA`, `EUROPE`, `UK` | ❌ No | ❌ No |
| **`WORKSHOP`** | Fleet staging, mechanic shop & labor destination. | `industrial-press` | `mk1-north` | `EUROPE` | ❌ No | ✅ **Target Only** (from same-region Depot) |
| **`RECRUITER`** | Commercial origin depot where Chumigrants assemble and purchase passage. | `crusher` | `mk3` | `AFRICA`, `EUROPE` | ✅ **Yes** | ✅ **Source Only** (to Depot) |
| **`DEPOT`** | Safe-house terminal where voyages arrive and Chums assemble before workshop transfer. | `pressure-tank` | `mk1-north` | `EUROPE`, `UK` | ❌ No | ✅ **Target** (from Recruiter) & **Source** (to Workshop) |

### Visual Tile Family Mappings
Simulation invariant checks enforce that tile families correspond strictly to node kinds:
```typescript
if (loc.kind === 'RECRUITER' && loc.tileFamily !== 'crusher') throw new Error(...);
if (loc.kind === 'DEPOT' && loc.tileFamily !== 'pressure-tank') throw new Error(...);
if (loc.kind === 'HQ' && loc.tileFamily !== 'logistics-hub') throw new Error(...);
if (loc.kind === 'WORKSHOP' && loc.tileFamily !== 'industrial-press') throw new Error(...);
```

---

## 🔒 Gang Ownership Rules

1. **Strict Monopolistic Ownership**:
   Every node in the simulation contains a mandatory `gangId` property. Neutral or shared operational nodes are **strictly forbidden**.
2. **Owner-Exclusivity for Commercial Operations**:
   - Only the gang that owns a `RECRUITER` node may sign up Chums waiting at that location.
   - Only the gang that owns both the source `RECRUITER` and the destination `DEPOT` may operate a route connecting them. Foreign gangs cannot lease or route through competitor nodes.
3. **Single Main HQ Start & Gradual Expansion**:
   - Each active gang begins the simulation with **only a single Main HQ** in its home region:
     - `HQ_NEON` (Neon Gill Syndicate): West Europe (`140, 430`)
     - `HQ_CRIMSON` (Crimson Claw): Central Europe (`560, 430`)
     - `HQ_AMBER_AFRICA` (Amber Fin Cartel): North Africa (`980, 1000`)
   - All other operational nodes across the globe begin unowned (`gangId: 'NEUTRAL'`).
   - Additional regional branch HQs and nodes must be scouted and purchased ($4,000 for HQ) inside the gang's active influence zones.
4. **Map Canvas Visibility Rule**:
   - **Unowned / candidate nodes are NOT visible on the map canvas**: To keep the initial world uncluttered and authentic to the "start with a single node and expand" design, only owned nodes belonging to currently selected active gangs are rendered.
   - When a gang purchases or claims a node, it becomes visible with its gang colorway and halo.

---

## ⚡ HQ Influence Zones & The Heat Map

For full mathematical specifications, see **[Influence Zones & Heat Map Documentation](file:///c:/Users/Chris/src/playground/chumworld/docs/sim/influence.md)**.

1. **Influence Dissipation**:
   - Heat is $1.0$ (100%) at HQ epicenter and dissipates linearly with Euclidean distance up to radius $R$ (starting $220\text{px}$, base $260\text{px}$, max $350\text{px}$).
2. **Strict Regional Border Cutoff**:
   - Heat maps strictly stop at international borders and water corridors. Influence NEVER bleeds into oceanic straits or neighboring regions.
3. **Multi-HQ Synergy Boost**:
   - When 2+ HQs of the same gang overlap within the same region, their influence zones reinforce each other (`combineHqHeats`), boosting heat density.
4. **Rival Pushback with Slight Overlap**:
   - Competitor HQs restrict rival influence ($\alpha = 0.65$), creating a contested midpoint buffer.
5. **Acquisition Gating**:
   - Operational nodes (`RECRUITER`, `DEPOT`, `WORKSHOP`) can **only be purchased inside an active HQ heat map** ($\text{heat} \ge 0.05$).

---

## 🌍 Regional Hierarchy & Migration Flow

The world map is divided into three geographical landmasses separated by oceanic corridors:

| Region | Coordinates ($Y$-axis) | Role & Permitted Nodes |
| :--- | :--- | :--- |
| **`UK`** | `[-150, 140]` | Final destination sanctuary. Terminus `DEPOT` nodes and forward `HQ`s. |
| **English Channel (Water)** | `[140, 280]` (140px tall) | Oceanic strait. North border IN to UK (`y=140`); South border OUT of Europe (`y=280`). |
| **`EUROPE`** | `[280, 660]` | Central transit & destination hub. Receives Mediterranean voyages in `DEPOT`s; hosts `WORKSHOP`s and Channel departure `RECRUITER`s. |
| **Mediterranean Sea (Water)**| `[660, 860]` (200px tall) | Expansive marine corridor. North border IN to Europe (`y=660`); South border OUT of Africa (`y=860`). |
| **`AFRICA`** | `[860, 1180]` | Origin territory. Chums spawn here and depart via Mediterranean `RECRUITER`s. |

```mermaid
flowchart TD
    subgraph AFRICA ["1. AFRICA (Origin Only: y = 860 to 1180)"]
        A_REC["RECRUITER (Crusher mk3)\ne.g. Tripoli, Alexandria, Tangier"]
    end

    subgraph EUROPE ["2. EUROPE (Transit / Destination: y = 280 to 660)"]
        E_DEPOT["DEPOT (Pressure Tank mk1)\ne.g. Marseille, Barcelona, Genoa"]
        E_HQ["HQ (Logistics Hub mk1)"]
        E_WS["WORKSHOP (Industrial Press)"]
        E_REC["RECRUITER (Crusher mk3)\ne.g. Calais, Dunkirk, Cherbourg"]
    end

    subgraph UK ["3. UNITED KINGDOM (Final Sanctuary: y = -150 to 140)"]
        UK_DEPOT["DEPOT (Pressure Tank mk1)\ne.g. Dover, Thames, Portsmouth"]
    end

    A_REC -- "Mediterranean Sea Corridor (200px)" --> E_DEPOT
    E_REC -- "English Channel Corridor (140px)" --> UK_DEPOT
```

### Regional Role Constraints
- **`AFRICA`**: Origin territory. Contains `RECRUITER` nodes only. Chums spawn here seeking passage to `EUROPE` or `UK`.
- **`EUROPE`**: Central operating hub. Contains:
  - `DEPOT` nodes (receiving passengers crossing the Mediterranean from Africa).
  - Gang `HQ` and `WORKSHOP` nodes.
  - `RECRUITER` nodes (origin points for Channel crossings into the UK).
- **`UK`**: Final destination sanctuary. Contains `DEPOT` nodes only. Voyages terminate here.

---

## 🏠 The Depot Passenger Retention Rule

A foundational rule of Chum World is **passenger retention**:
- When a voyage successfully completes, passenger Chums are **not deleted** or despawned from the simulation.
- Instead, each Chum transitions to status `'ARRIVED'` and their `originId` is permanently set to the destination `DEPOT` node ID.
- The Chum remains safely housed inside the depot for the rest of the game session, archived in memory with their complete journey history.
- Inspection of any Depot node reveals the roster of all successfully resettled Chums residing within that facility.

---

## ⚡ Physical Connections Between Nodes

Physical connections ([`PhysicalConnectionDef`](file:///c:/Users/chris/src/playground/chumworld/src/sim/types.ts#L19-L26)) define underlying geographical travel corridors:
1. **Recruiter-to-Depot Only**: A physical connection can only be established from a `RECRUITER` node to a `DEPOT` node.
2. **Cross-Border Mandatory**: All active connections must have `isCrossBorder: true`. Intra-region domestic links do not exist in the MVP simulation.
3. **Transport Medium**: Mode is designated as `'SEA'` (e.g. Mediterranean or English Channel crossings) or `'LAND'` (e.g. cross-border van links).
