# Simulation Rules: Gangs & Syndicate AI

**Gangs** (represented by [`GangState`](file:///c:/Users/chris/src/playground/chumworld/src/sim/types.ts#L34-L55)) are autonomous criminal enterprises competing to control passenger transit corridors across Chum World.

Source code reference:
- Type definitions: [`GangState`](file:///c:/Users/chris/src/playground/chumworld/src/sim/types.ts#L34-L55)
- Syndicate creation: [`createWorld.ts`](file:///c:/Users/chris/src/playground/chumworld/src/sim/createWorld.ts#L245-L318)
- AI decision loop: [`ai.ts`](file:///c:/Users/chris/src/playground/chumworld/src/sim/ai.ts)

---

## 🏴 Active & Backup Syndicates

Each syndicate maintains a distinct brand identity, color scheme, emblem symbol, and operating territory:

| Gang ID | Name | Color | Hex | Emblem | Starting Main HQ | Starting Cash | Starting Rep |
| :--- | :--- | :--- | :---: | :---: | :--- | :---: | :---: |
| **`GANG_NEON_GILL`** | Neon Gill Syndicate | Cyan | `#06b6d4` | `✦` | `HQ_NEON` (West Europe) | `$10,000` | 75 / 100 |
| **`GANG_CRIMSON_CLAW`** | Crimson Claw | Red | `#ef4444` | `▲` | `HQ_CRIMSON` (Central Europe) | `$10,000` | 70 / 100 |
| **`GANG_AMBER_FIN`** | Amber Fin Cartel | Amber | `#f59e0b` | `◆` | `HQ_AMBER_AFRICA` (North Africa) | `$10,000` | 80 / 100 |

> **Single-Node Start Principle**: Gangs start with **only their single Main HQ** and an initial treasury pot. All other nodes and routes across the world start unowned and must be scouted, purchased, and built up gradually.

### Reserve Syndicates (Revitalization Pool)
If syndicate bankruptcies reduce the active gang count below 2, reserve syndicates are autonomously founded:
- **`GANG_ABYSSAL_TIDE`** (Abyssal Tide): Royal Purple (`#a855f7`, `⬡`)
- **`GANG_EMERALD_CORAL`** (Emerald Coral): Emerald Green (`#10b981`, `✿`)

---

## 🧠 Autonomous AI Decision Loop

Every gang periodically reviews its finances, staff, and expansion priorities in [`processGangAI()`](file:///c:/Users/chris/src/playground/chumworld/src/sim/ai.ts#L11).

### Evaluation Frequency
- **Review Period**: Evaluated every **40 ticks** (`tick % 40 === 0`), equivalent to 4 game days (~6 real seconds at 1× speed).
- Rate-limiting prevents rapid economic swings and gives players time to observe cause and effect.

```mermaid
graph TD
    A[Tick % 40 == 0] --> B[1. Ensure Nodes & Routes Staffed with Hoods]
    B --> C[2. Ensure Active Scout Hood Exists]
    C --> D{Treasury < -$6,000?}
    D -- Yes --> E[Declare BANKRUPT & Close Routes]
    D -- No --> F[3. Purchase Discovered Routes: Top Priority]
    F --> G[4. Purchase Discovered Candidate Nodes: By Priority]
    G --> H{Active Gangs < 2?}
    H -- Yes --> I[Revitalize: Found Backup Syndicate with 1 HQ]
    H -- No --> J[End AI Review]
```

---

## 💵 Economic Balance & Upkeep Formula

### 1. Fixed and Variable Operational Upkeep
Active syndicates pay wages and operational expenses:
$$\text{Wage Bill} = \$15 \times \text{number of active employed Hoods}$$
At start, each gang maintains 1 HQ Boss + 1 Scout Hood = **`$30`** base overhead.

### 2. Revenue Inflow
- Each time a Chumigrant signs a travel contract at an owned `RECRUITER` node, the ticket price ($270 to $350) is deposited directly into the gang's cash reserve:
  ```typescript
  gang.cash += route.price;
  gang.stats.revenueTotal += route.price;
  gang.stats.recruitsTotal += 1;
  ```

### 3. Insolvency & Bankruptcy Threshold
- If a gang's debts accumulate to **less than $-\$6,000$** (`gang.cash < -6000`):
  1. `gang.status = 'BANKRUPT'`.
  2. All active route services owned by the gang transition to `'CLOSING'`.
  3. High-importance event emitted: `GANG_BANKRUPT`.
  4. Decision logged in dossier: `"Severe debt exceeded credit limit."`.

---

## 🔄 Syndicate Revitalization Rule

To ensure the world remains vibrant and self-sustaining across long soak runs:
1. When active gangs drop below 2 (`activeGangs.length < 2`), the AI checks the reserve syndicate pool.
2. The AI provisions the newly activated syndicate with:
   - Starting treasury of **`$10,000`** and reputation of **`75`**.
   - A single `HQ` (Logistics Hub) in Europe (`isMainHq: true`).
   - 1 `HQ_BOSS` and 1 `SCOUT` Hood.
   - **Zero pre-built infrastructure**: The replacement gang starts from a single node and builds up gradually, just like the starting gangs.
3. The new syndicate begins scouting and competing in the travel market.

---

## 📈 Reputation Dynamics

Each gang tracks reputation on a scale of `0` to `100`:
- **Successful Voyage**: Gains **`+1`** reputation point (up to maximum 100).
- **Cancelled Voyage**: Loses **`-4`** reputation points (floor of 10).
- **Intercepted Voyage**: Loses **`-8`** reputation points (floor of 10).

Higher reputation strengthens syndicate prestige and public standing in the underworld hierarchy.

---

## 📖 Decision Journal & Observability

Every syndicate maintains a rolling journal of its last 5 strategic decisions in `gang.recentDecisions`:
```typescript
export interface GangDecision {
  tick: number;
  action: string;
  reason: string;
}
```
Inspecting any gang in the right-hand Inspector drawer displays this chronological audit log, allowing observers to see why a gang expanded, paid debts, or collapsed.
