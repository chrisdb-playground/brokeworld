# Broke World — Autonomous Smuggler Simulation

Broke World is an autonomous, discrete-tick simulation and interactive visualizer modeling competitive migrant smuggling networks across three distinct geographical regions: North Africa, Western Europe, and the United Kingdom.

---

## 🚀 Quickstart

Run locally with standard Node tooling:

```bash
# Install dependencies (automatically imports sprites and audio assets from brokeworld-asset-pack1)
npm install

# Start local dev server
npm run dev

# Run full test suite (Vitest headless unit & soak tests)
npm test

# Build production bundle
npm run build
```

The web application runs on `http://localhost:5176/`.

---

## 🎮 Interactive Controls & Hotkeys

| Control | Input / Hotkey | Description |
| :--- | :--- | :--- |
| **Speed Controls** | `⏸`, `1×`, `5×`, `20×` | Adjust simulation speed multiplier. |
| **Step** | `⏯ Step` button | Advance the simulation by exactly 1 tick. |
| **Reset** | `🔄 Reset` button or **`R`** key | Resets world, accumulator, and simulation state back to Tick 0. |
| **Toggle Influence** | `🔥 Influence` button or **`I`** / **`H`** | Toggles regional HQ influence heat map overlay. |
| **Cancel Placement** | **`ESC`** or Right-Click | Cancels active building placement mode. |
| **Pan Camera** | Click & Drag | Pan around the map canvas. |
| **Zoom** | Mouse Scroll Wheel | Zoom in and out across the geographical map. |

---

## 🗺️ Map Architecture & Regional Hierarchy

The map is partitioned into three land masses separated by wide animated oceanic corridors with 2-sided directional border checkpoints:

- **🇬🇧 United Kingdom (`y = -150 to 140`)**: Final sanctuary destination for Migrants. Contains terminus Depots and forward HQs.
- **🌊 English Channel Corridor (`y = 140 to 280`, 140px tall)**:
  - North border (`y = 140`): `▼ BORDER IN TO UK — DOVER MARITIME ENTRY`
  - South border (`y = 280`): `▲ BORDER OUT OF EUROPE — CHANNEL DEPARTURE PERIMETER`
- **🇪🇺 West & Central Europe (`y = 280 to 660`)**: Central transit hub. Receives Mediterranean voyages in Depots; hosts Workshops and Channel departure Recruiters.
- **🌊 Mediterranean Sea Corridor (`y = 660 to 860`, 200px tall)**:
  - North border (`y = 660`): `▼ BORDER IN TO EUROPE — MEDITERRANEAN ENTRY CHECKPOINT`
  - South border (`y = 860`): `▲ BORDER OUT OF AFRICA — MARITIME DEPARTURE BORDER`
- **🌍 North Africa (`y = 860 to 1180`)**: Origin territory. Migrants spawn here seeking passage across the Mediterranean.

---

## 🏛️ Core Design Principles

1. **Single-Node Start & Gradual Expansion**:
   Gangs start with **only a single Main HQ** and an initial cash pot ($10,000). All candidate nodes across the world start unowned and are hidden until acquired or scouted.
2. **Influence Heat Map Gating**:
   HQ influence zones mathematically stop strictly at regional borders and water corridors. Operational nodes (Recruiters, Depots, Workshops) can only be acquired within an active gang heat map.
3. **Multi-HQ Synergy**:
   When multiple HQs of the same gang overlap within the same region, their influence zones reinforce each other, creating fortified regional hubs.
4. **"No Hood, No Action"**:
   Recruiters require a `RECRUITER_MANAGER`, voyages require a `VOYAGE_SKIPPER`, and expansion requires a `SCOUT` Hood.

---

## 📚 Complete Simulation Documentation

For detailed mathematical specifications and simulation rules, see the [`docs/sim/`](file:///c:/Users/Chris/src/playground/brokeworld/docs/sim/) directory:

- **[Simulation Architecture Overview](file:///c:/Users/Chris/src/playground/brokeworld/docs/sim/README.md)**
- **[Influence Zones & Territorial Expansion](file:///c:/Users/Chris/src/playground/brokeworld/docs/sim/influence.md)**
- **[Nodes & Infrastructure](file:///c:/Users/Chris/src/playground/brokeworld/docs/sim/nodes.md)**
- **[Gangs & Syndicate AI](file:///c:/Users/Chris/src/playground/brokeworld/docs/sim/gangs.md)**
- **[Hoods & Payroll](file:///c:/Users/Chris/src/playground/brokeworld/docs/sim/hoods.md)**
- **[Routes & Services](file:///c:/Users/Chris/src/playground/brokeworld/docs/sim/routes.md)**
- **[Voyages & Transport](file:///c:/Users/Chris/src/playground/brokeworld/docs/sim/voyages.md)**
- **[Migrants Lifecycle](file:///c:/Users/Chris/src/playground/brokeworld/docs/sim/migrants.md)**
- **[Simulation Invariants](file:///c:/Users/Chris/src/playground/brokeworld/docs/sim/invariants.md)**
