# People Smuggler — Autonomous Chum World MVP

## 1. Goal
Create a **self-running, entertaining-to-watch toy-world** in Phaser 4. Cute, simple Chums contrast with the deadpan corporate/criminal setting. There is **no player-controlled gang** yet. The first success criterion: watch gangs compete, add/remove operations, recruit Chumigrants, launch animated vehicle voyages, and see occasional failures while the world remains comprehensible and stable.

Keep this as a simulation experiment, not a complete strategy game. Real-world trafficking processes, border evasion and exploitation mechanics are **not** simulated in this MVP.

## 2. World geography and ownership model
- Two fictional regions, Region A and Region B, drawn as contrasting areas with a highly visible border.
- Begin with 6–8 persistent geographical **locations** (3–4 per region), fixed positions for MVP. Locations may include towns, ports and border towns; give them memorable fictional names. Locations are *not gang-owned*.
- A **gang** has a distinctive colour, name, initial budget, one owned HQ operation placed at a location, and a simple operating strategy. Start with 3 gangs whose HQs occupy different locations. Gang births and bankruptcies can occur rarely after startup; choose a sensible lower and upper gang count.
- An **operation** is a gang-owned node at a location: `HQ` or `RECRUITER` for MVP. Multiple owners may operate at the same geographical location. Operations can open or close, but gang HQs persist until their gang dissolves.
- A **physical connection** is a geographical relationship between source and target locations (for MVP use a static set of possible connections, including at least two crossing the border). These connections are shared and neutral.
- A **route service** is a gang-owned directed operational link over one physical connection. It has distinct `routeId`, `ownerGangId`, origin/destination, transport mode, capacity, price, time, reliability, upkeep and state. Multiple services with identical endpoints MUST be allowed. Routes open/close dynamically. Treat each route as an individually inspectable and selectable object.
- Regions have an abstract `copPressure` value; it can vary slowly and affect the probability of an abstract journey disruption. Do not model enforcement tactics.

## 3. Explicit rule: single-hop voyages
A Chumigrant spawns at a geographical location, with a **directly reachable destination location** (select destination only from outgoing physical connections). They are willing to travel only there. A gang operating a recruiter at that location may sign them up; a voyage uses ONE available owned route whose origin and destination correspond to the Chumigrant's current location and desired destination.

**No graph pathfinding, no multi-leg itinerary, no intermediate nodes, no automatic transfers, no routing through HQ.** If no suitable route exists, the Chum waits or later leaves the world. A completed voyage finishes the Chum's migration objective and exits them from the active travel market; keep their history for inspection/events.

## 4. Autonomous loop
1. Chumigrants appear occasionally based on a target active population; have persistent ID, cute visual appearance, origin, direct destination, cash, patience, and status.
2. Each gang periodically evaluates demand, finances, existing recruiter coverage, and existing route capacity, then may open a recruiter or route, retire an unprofitable operation, or conserve cash. Decisions should be explainable and rate-limited.
3. Recruiters sign up Chumigrants at their location when compatible route services are available or expected; simple choice based on price/reputation/availability with bounded randomness. Gang operations compete to recruit the same population.
4. A gang launches a voyage when there is at least one recruited Chum for a matching route, capacity is available, and service cooldown permits. Each voyage has one vehicle with a type-specific graphic (van/boat), manifest, explicit origin and target, departure tick and duration. Vehicles move smoothly on screen along the corresponding link. Multiple voyages can coexist.
5. Most voyages arrive successfully. A small, configurable probability results in `DELAYED`, `CANCELLED`, or `INTERCEPTED` (abstract). On cancellation/interception passengers are returned to waiting / unavailable states, not deleted. Track outcome in histories, change gang finances/reputation accordingly.
6. Travelled Chums depart active population after success, creating room for new arrivals. Slow economic changes and occasional closures mean the map evolves, rather than exploding with new routes.

## 5. Default tuning targets (adjustable constants, not real-world estimates)
- 2 regions; 8 locations; 3 initial gangs; 24–40 Chumigrants at steady state.
- 1 game day = 1–2 real seconds at 1×, tunable; speed 1×, 5×, 20×, pause and step.
- New Chums every few simulated days on average, up to an active-population cap; spawn randomness should not create storms.
- Each gang reviews investments every 7 game days, with minimum 2–4 weeks between major expansions.
- Gang entry/exit rare: e.g. at most one gang birth or dissolution over several game-months; impose global cooldowns.
- Route open/close changes should be measured in weeks, not seconds. Upkeep and demand can drive decisions.
- Baseline voyage success target roughly 95–99% (tunable) so failure is notable; don't claim real-world rates.
- All prices, costs, income and durations are fictitious balancing parameters.

## 6. Route ownership visuals — a required centerpiece
- Each gang has a consistent high-contrast colour (also a unique icon/pattern for accessibility).
- Gang HQ: large emblem marker in owner's colour. Recruiters: smaller square/icon in owner's colour attached visually to their host location.
- **Gang-owned routes are visibly coloured lines with a distinct ownership pattern**, drawn over the neutral geographic connection.
- **Parallel route services MUST be individually visible and selectable**, even when they have identical source and destination. Render them as offset parallel curves / bundled lines, not on top of one another. Direction indicated with arrowheads, mode by dash/texture or a small boat/van icon. Width/opacity may encode capacity or utilization, but colour encodes owner.
- When 2+ services share the same connection, make their offsets stable (sort by route ID), preserve colours, and support pointer selection/highlight of exactly one service. Consider selection cycling from a compact popover if lines become too close.
- A vehicle on a voyage visibly travels **along its specific owning route's offset curve**, in its gang colour. Chums can be shown as tiny passengers or a `×N` badge, with a click-to-inspect manifest.
- Hover/click route: show owner, origin → destination, mode, capacity, active voyages, price, travel duration, reliability, finances and recent outcomes.
- Closing a route visibly removes that coloured line after any active voyage has resolved; no stranded invisible vehicles.
- Neutral physical connection remains visible when no gang owns a service; cross-border connections distinctly cross the border.
- Include a gang legend that can isolate/highlight a gang's HQ, recruiters, services and voyages without mutating simulation state.

## 7. Observability
- Inspect a Chum: origin, desired destination, recruiter, assigned gang, current state, voyage, short history.
- Inspect gang: HQ, cash, reputation, recruiters, routes, active voyages, last 3 AI decisions with reasons.
- Inspect location: region, present/queued Chums, gang recruiters, available routes.
- Inspect route: owner, explicit route ID, endpoints, ongoing voyages and performance.
- Inspect vehicle/voyage: gang, route ID, manifest, progress, outcome.
- Event feed: Chum spawned, gang founded/dissolved, recruiter opened/closed, route opened/closed, recruited, departed, arrived, delayed, intercepted. Filter clutter by prioritizing significant events and grouping minor repeats.
- HUD: active Chums, gangs, route services, voyages, completed voyages, failures; current simulation day and time speed.
- Show a brief visual pulse when a new route or operation is acquired; do not interrupt the simulation with modal dialogs.

## 8. Simulation architecture
Pure TypeScript under `src/sim/`:
- IDs, entities, seeded PRNG, world factory, gang AI policy, demand/spawn policy, recruitment, voyage scheduling/outcomes, slow world events, immutable snapshot DTOs.
- Use typed commands/events, even though there is no player control. Gang AI invokes the same simulation actions that a future player will eventually invoke.
- Fixed tick, documented update order: queued commands → gradual world events/spawns → gang decisions (on schedule) → recruitment/scheduling → voyage progress/outcomes → economics/reputation → history/event emission → snapshot.
- Keep the RNG separate from rendering so visuals don't influence game outcomes.
- Store voyage progress in sim-time; Phaser interpolates between snapshots for 60 FPS visual motion.
- No game mechanics, pricing or probabilities inside Phaser scenes.
- Design `GamePort` with `getSnapshot`, `dispatch(command)`, `advance(ticks)`, and `subscribe(listener)`; local implementation now; possible adapter later.

## 9. Tests and acceptance criteria
- Same seed and command stream produce equivalent states/events after N ticks.
- Multiple route services between identical directed endpoints coexist with unique IDs, independent owners and independent manifests.
- Deleting one route does not delete other parallel services or affect their voyages.
- Every gang with active status owns one HQ; dissolving a gang removes/archives its operations safely.
- Every voyage has precisely one route, one origin, one destination; passenger source and desired target match.
- Voyage success and failure have well-defined state transitions; nobody is silently dropped.
- After 10 simulated years, no negative population, invalid ownership, orphan journeys, runaway entity counts or unbounded memory growth (archive histories with sensible limits).
- In browser: distinguish 3 gangs by HQ symbols/colours; distinguish overlapping route services; inspect a single route; watch at least one vehicle cross the border; see a rare failed voyage; track ownership in inspector and legend.

## 10. Explicit non-goals
No player gang, production businesses, human-exploitation systems, coercion/debt, combat, playable cops, procedural terrain, realistic geography, pathfinding, multi-hop travel, multiplayer, cloud saves, React, API/backend, external asset pipeline or realistic border crossing methods. Use friendly primitive art first.
