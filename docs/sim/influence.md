# Simulation Rules: Influence Zones & Heat Map

The **Influence System** (implemented in [`src/sim/influence.ts`](file:///c:/Users/Chris/src/playground/chumworld/src/sim/influence.ts)) models regional territorial sovereignty, power projection, and expansion gating for all gangs in Chum World.

---

## ⚡ Core Rules & Mechanics

### 1. Distance Dissipation from HQ Center
Every gang HQ projects an area of influence (**Heat Map**):
- Influence heat is maximum ($1.0$, 100%) at the HQ coordinates $(x_{\text{hq}}, y_{\text{hq}})$ and dissipates linearly with Euclidean distance up to the HQ's influence radius $R$:
$$\text{heat}_{\text{raw}}(d) = \max\left(0, 1 - \frac{d}{R}\right), \quad d = \sqrt{(x - x_{\text{hq}})^2 + (y - y_{\text{hq}})^2}$$
- **Starting Radius**: $220\text{px}$ (`INITIAL_HQ_INFLUENCE_RADIUS`).
- **Base Standard Radius**: $260\text{px}$ (`BASE_HQ_INFLUENCE_RADIUS`).
- **Maximum Growth Cap**: $350\text{px}$ (`MAX_HQ_INFLUENCE_RADIUS`).

### 2. Strict Regional Border Cutoff (RULE: "heat map stops at border")
- **International and maritime borders act as absolute blockers for influence**:
  - An HQ situated in **Europe** projects zero influence into **North Africa** or the **United Kingdom**, even if Euclidean distance is $< 100\text{px}$.
  - Influence never crosses water corridors (English Channel or Mediterranean Sea).
  - Mathematically, if $(x, y)$ falls inside a water corridor or outside the HQ's region, heat is clamped strictly to `0.0`:
$$\text{heat}(x, y) = 0 \quad \text{if } \operatorname{region}(y) \ne \operatorname{region}(y_{\text{hq}})$$
- **Strategic Consequence**: To establish operations or acquire nodes in a region, a syndicate must first establish an HQ in that region.

### 3. Same-Gang Multi-HQ Synergy Resonant Boost
**RULE: "2 hq influence zones, same gang, increase the influence"**
When a syndicate establishes two or more HQs in the same region with overlapping radii, their influence zones reinforce each other:
1. Base diminishing-returns union:
$$\text{union} = h_1 + h_2 - (h_1 \times h_2)$$
2. Synergy resonance bonus:
$$\text{bonus} = 0.15 \times \min(h_1, h_2)$$
$$\text{heat}_{\text{synergy}} = \min(1.0, \text{union} + \text{bonus})$$
- Points positioned between two friendly HQs enjoy significantly elevated influence ($\ge 0.90$), creating fortified regional strongholds.

### 4. Rival Gang Pushback & Damped Overlap Buffer
**RULE: "rival gangs hq influence zones restrict each other but they can overlap slightly"**
- When rival gang influence zones meet, they restrict and push back competitor influence:
$$\text{heat}_{\text{eff}} = \max\left(0, h_{\text{own}} - \alpha \times h_{\text{rival,max}}\right), \quad \alpha = 0.65$$
- The damping factor $\alpha = 0.65$ allows a contested buffer zone near the midpoint where both gangs maintain positive, competing influence, but deep proximity to a rival HQ completely suppresses foreign influence.

### 5. Slow Growth Over Time
- Staffed, operational HQs with an active `HQ_BOSS` slowly expand their influence radius:
  - Every 20 ticks, $R \leftarrow \min(350, R + 1\text{px})$.
  - Unstaffed HQs do not grow.

---

## 🏗️ Gated Infrastructure Acquisition

All infrastructure acquisition in Chum World is strictly gated by the Influence System:

| Action | Cost | Regional Rule | Heat Map Rule | Clearance Rule |
| :--- | :--- | :--- | :--- | :--- |
| **`PURCHASE_HQ`** | $4,000 | Allowed in any region (`UK`, `EUROPE`, `AFRICA`) | Can be placed anywhere valid in region (initiates a new influence zone) | $\ge 70\text{px}$ from existing nodes |
| **`PURCHASE_NODE` (RECRUITER)** | $2,500 | `AFRICA` or `EUROPE` only | **Must be inside gang's active heat map** ($\text{heat} \ge 0.05$) | $\ge 70\text{px}$ from existing nodes |
| **`PURCHASE_NODE` (DEPOT)** | $2,000 | `EUROPE` or `UK` only | **Must be inside gang's active heat map** ($\text{heat} \ge 0.05$) | $\ge 70\text{px}$ from existing nodes |
| **`PURCHASE_NODE` (WORKSHOP)** | $3,500 | `EUROPE` only | **Must be inside gang's active heat map** ($\text{heat} \ge 0.05$) | $\ge 70\text{px}$ from existing nodes |
| **`CLAIM_CANDIDATE_NODE`** | Node's candidate cost ($1,200 – $2,200) | Matches node's region | Available once discovered by gang Scout Hood | Pre-cleared plot |

---

## 🗺️ Regional Boundaries & Water Corridors

The simulation environment is partitioned into three land masses separated by wide oceanic corridors:

```
Y = -150 ─────────────────────────────────────────────── Top of Map
         UNITED KINGDOM (UK) — Final Destination
Y =  140 ═══════════════════════════════════════════════ Border IN to UK
         ENGLISH CHANNEL WATER CORRIDOR (140px tall)
Y =  280 ═══════════════════════════════════════════════ Border OUT of Europe
         WEST & CENTRAL EUROPE — Transit & Destination
Y =  660 ═══════════════════════════════════════════════ Border IN to Europe
         MEDITERRANEAN SEA WATER CORRIDOR (200px tall)
Y =  860 ═══════════════════════════════════════════════ Border OUT of Africa
         NORTH AFRICA — Chumigrant Origins
Y = 1180 ─────────────────────────────────────────────── Bottom of Map
```

- **English Channel**: `yMin: 140, yMax: 280` (Height: 140px). Water tile animation with westward wave drift.
- **Mediterranean Sea**: `yMin: 660, yMax: 860` (Height: 200px). Water tile animation with eastward wave drift.
- **2-Sided Directional Borders**: Each corridor has explicit Entry (`ENTRY`) and Exit (`EXIT`) borders with distinct colorway markers.

---

## 👁️ Visual Representation & UI Controls

1. **Concentric Radial Heat Waves**:
   Rendered using 12 clipped concentric radial bands with smooth alpha falloff, strictly clipped to regional borders so no color bleeds into water or across frontiers.
2. **Interactive Toggle**:
   - HUD button: `🔥 Influence` in the top speed bar.
   - Hotkeys: `I` or `H` toggles heat map overlay visibility.
3. **Multi-Gang Focus**:
   When selecting specific gangs from the left legend, non-selected gangs' influence zones dim to $0.35$ opacity while selected gangs remain at full $1.0$ opacity.
