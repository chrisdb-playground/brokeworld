# People Smuggler — Agent instructions

Build the autonomous observational MVP described by SPEC.md. Prioritize a running, watchable simulation over polish. Do not expand scope without a compelling technical necessity.

## Non-negotiable architecture
- Phaser 4 + TypeScript + Vite only. No React, backend, API, Rust, Python, or database.
- `src/sim/` is pure TypeScript: **no imports from Phaser, DOM, or browser APIs**. It owns every entity, economic rule, event, random draw and game tick.
- `src/presentation/` contains Phaser scenes, sprites, map interaction, animations and inspection UI. It only reads immutable snapshots / events and dispatches typed commands.
- `src/app/` contains the local adapter (`GamePort`), clock controller, and snapshot synchronization. No gameplay rules here.
- A deterministic seeded PRNG is passed to the simulation. No `Math.random()` in simulation code.
- Simulate at fixed time steps. Rendering frames never advance state based on frame rate.
- Use stable IDs for all entities and journeys. Preserve histories for departed / dissolved entities.
- Add automated headless tests with Vitest for business logic and invariants.

## Core invariants
- Exactly two regions separated by a visible border in the MVP.
- Every active gang owns exactly one HQ node. HQ moves are out of scope.
- Physical connections are separate from gang-owned *route services*. Many route services can share the same ordered pair of nodes, including different services from the same or different gangs.
- Each voyage uses **exactly one** route service and goes from its source to its target. **No multi-hop journeys and no auto-transfers.**
- A Chumigrant wants to travel to one destination node. It only boards a service if that service's target matches its desired destination, in the MVP.
- Ownership is clearly visible in the map and inspectors, including when several routes overlap.
- Gangs, operations, Chumigrants and routes appear / disappear gradually. No rapid oscillation or mass random churn.
- Chum cops are abstract as regional pressure; no police units or tactical enforcement modelling.
- Voyage failures are rare and have explicit outcomes. A failed journey never silently deletes its Chums.
- Observer mode: no player gang or player purchasing actions yet. Play/pause/speed/inspect only.

## Delivery standards
- The app must launch with `npm install && npm run dev`.
- Include `npm test` and a headless soak test command.
- Default initial seed and a UI seed override/restart for reproducibility.
- Keep art placeholder-friendly; simple shapes are acceptable; no external sprite service required.
- Do not claim a feature is done unless it runs and relevant tests pass.
