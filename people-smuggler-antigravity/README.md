# People Smuggler: Broke World Simulator

**Autonomous, observer-only first prototype.** Phaser 4 + TypeScript, with pure TypeScript simulation kept strictly separate from graphics/UI.

Read in order:
1. `AGENTS.md` — binding engineering constraints.
2. `SPEC.md` — complete gameplay and presentation requirements.
3. `IMPLEMENTATION.md` — milestones and paste-ready Antigravity prompt.

The central design features are competing gangs with their own HQs, dynamic recruiter and route-service ownership, multiple visible/selectable gang services on a single connection, Migrants with one directly adjacent destination, one-hop animated voyages, rare failures and abstract cops.

The world must operate without player input.
