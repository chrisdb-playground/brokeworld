# Antigravity build sequence

Implement in thin, running slices; keep the app playable after each.

1. **Foundation:** Vite, Phaser 4, TypeScript, Vitest; pure seeded sim; two-region backdrop and 8 static locations; pause/speed/step, world stats. Test determinism.
2. **Gangs:** three independently coloured gangs, one HQ each; periodic decisions to establish recruiter operations. Render ownership markers, gang inspector and AI decision rationale.
3. **Routes:** gang-owned route services across shared physical connections, creation/retirement logic; **parallel services visually separated and independently selectable**; neutral connections remain visible. Implement route inspector/legend. Test parallel route invariants.
4. **Migrants:** population spawns with one adjacent desired destination; gang recruiters compete for them, queues appear; Migrant inspector and history.
5. **Voyages:** gang AI schedules direct one-link voyages with passenger manifests and coloured vehicle animations along service-specific curves; success completes objective; rare abstract disruption; event feed. Test state transitions.
6. **Balance + observation:** cash, upkeep, fare revenue, reputation, slow gang churn, stable state after long headless soak; improve HUD and visual feedback. No content scope creep.

At each milestone: `npm test`, run the browser, inspect visuals, and record issues. Prefer simple primitive sprites. Add generated art only after the sim is watchable.

## First Antigravity prompt

Read AGENTS.md and SPEC.md completely. Implement the autonomous observer-only MVP in IMPLEMENTATION.md, in milestones, respecting simulation/presentation separation. Start by making the game launch and showing the two regions, 8 locations and three coloured gang HQs. Prioritize working state transitions, colour-coded selectable parallel route services, and smooth one-hop vehicle voyages. Do not implement a player economy or realistic smuggling details. Use simple original placeholder art. Add seeded headless tests and a soak test. Keep each milestone runnable and report actual test results.
