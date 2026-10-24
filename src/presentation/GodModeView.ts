import type { GamePort } from '../app/GamePort';
import type { GangState, LocationKind, RegionId, WorldSnapshot } from '../sim/types';

export class GodModeView {
  private container: HTMLElement;
  private port: GamePort;
  private currentSnapshot: WorldSnapshot | null = null;
  private selectedGangId: string | null = null;

  constructor(parent: HTMLElement, port: GamePort) {
    this.port = port;
    this.container = document.createElement('div');
    this.container.id = 'tab-god-view';
    this.container.className = 'full-tab-view tab-god-container';
    this.container.style.display = 'none';
    parent.appendChild(this.container);

    this.mount();
  }

  private mount() {
    this.container.innerHTML = `
      <div class="tab-header-banner banner-god">
        <div class="tab-header-title-box">
          <div class="tab-header-title">👑 DIVINE INTERVENTION PROTOCOL // GOD MODE CONSOLE</div>
          <div class="tab-header-sub">Puppet gang decisions, disburse illicit grants, force regional scouting, and alter simulation parameters.</div>
        </div>
        <div class="tab-header-stats">
          <div class="stat-pill"><span class="stat-lbl">PROTOCOL:</span> <span class="stat-val text-amber">OVERRIDE ACTIVE</span></div>
        </div>
      </div>

      <!-- GLOBAL GOD INTERVENTIONS BAR -->
      <div class="god-global-bar">
        <div class="global-bar-title">GLOBAL DIVINE DECREES:</div>
        <div class="global-buttons-row">
          <button id="god-btn-global-stimulus" class="btn-god-global" title="Disburse $10,000 cash grant to every active syndicate">
            <span>💰 Universal Stimulus (+$10,000 All)</span>
          </button>
          <button id="god-btn-global-migrants" class="btn-god-global" title="Spawn 25 high-budget migrants across all active recruiter networks">
            <span>👥 Global Migrant Rush (+25 Migrants)</span>
          </button>
          <button id="god-btn-global-sweep" class="btn-god-global btn-god-danger" title="Trigger international coast guard crackdown across all waters">
            <span>🚨 Border Patrol Crackdown (Sweep Waters)</span>
          </button>
          <button id="god-btn-global-teleport" class="btn-god-global btn-god-gold" title="Instant deliver all voyages currently at sea across all gangs">
            <span>🚀 Deliver All Active Voyages</span>
          </button>
        </div>
      </div>

      <!-- MAIN SPLIT WORKSPACE -->
      <div class="god-workspace-split">
        <!-- LEFT: GANG SELECTOR ROSTER -->
        <div class="god-gang-roster">
          <div class="god-panel-title">SELECT SYNDICATE TO PUPPET</div>
          <div id="god-gangs-list" class="god-gangs-list"></div>
        </div>

        <!-- RIGHT: SELECTED GANG CONTROL DECK -->
        <div id="god-control-deck" class="god-control-deck">
          <div class="god-empty-state">
            <span class="empty-icon">👑</span>
            <div class="empty-title">Select a syndicate from the left roster</div>
            <div class="empty-sub">Choose a gang to inspect its operations, grant funds, or dictate directives.</div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    this.container.querySelector('#god-btn-global-stimulus')?.addEventListener('click', () => {
      this.port.dispatch({ type: 'GLOBAL_AID', payload: { amount: 10000 } }, true);
      this.render();
    });

    this.container.querySelector('#god-btn-global-migrants')?.addEventListener('click', () => {
      this.port.dispatch({ type: 'SPAWN_MIGRANTS', payload: { count: 25 } }, true);
      this.render();
    });

    this.container.querySelector('#god-btn-global-sweep')?.addEventListener('click', () => {
      this.port.dispatch({ type: 'TRIGGER_RAID', payload: {} }, true);
      this.render();
    });

    this.container.querySelector('#god-btn-global-teleport')?.addEventListener('click', () => {
      this.port.dispatch({ type: 'FAST_FORWARD_VOYAGES', payload: {} }, true);
      this.render();
    });

    // Delegate actions on the control deck
    const deck = this.container.querySelector('#god-control-deck');
    deck?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLButtonElement>('button[data-god-action]');
      if (!btn || !this.selectedGangId) return;

      const action = btn.getAttribute('data-god-action');
      const gangId = this.selectedGangId;

      switch (action) {
        case 'grant-cash': {
          const amount = parseInt(btn.getAttribute('data-amount') || '1000', 10);
          this.port.dispatch({ type: 'GANG_AID', payload: { gangId, amount } }, true);
          this.render();
          break;
        }
        case 'set-cash': {
          const cash = parseInt(btn.getAttribute('data-cash') || '0', 10);
          this.port.dispatch({ type: 'SET_GANG_CASH', payload: { gangId, cash } }, true);
          this.render();
          break;
        }
        case 'custom-cash': {
          const input = this.container.querySelector<HTMLInputElement>('#god-custom-cash-input');
          if (input) {
            const val = parseInt(input.value, 10);
            if (!isNaN(val)) {
              this.port.dispatch({ type: 'GANG_AID', payload: { gangId, amount: val } }, true);
              input.value = '';
              this.render();
            }
          }
          break;
        }
        case 'toggle-ai': {
          const gang = this.currentSnapshot?.gangs[gangId];
          if (gang) {
            const newEnabled = !!gang.isAiDisabled;
            this.port.dispatch({ type: 'TOGGLE_GANG_AI', payload: { gangId, enabled: newEnabled } }, true);
            this.render();
          }
          break;
        }
        case 'scout-region': {
          const region = btn.getAttribute('data-region') as RegionId;
          this.port.dispatch({ type: 'SCOUT_AREA', payload: { gangId, region } }, true);
          this.render();
          break;
        }
        case 'search-routes': {
          this.port.dispatch({ type: 'SEARCH_ROUTES', payload: { gangId } }, true);
          this.render();
          break;
        }
        case 'hire-scout': {
          this.port.dispatch({ type: 'HIRE_SCOUT', payload: { gangId } }, true);
          this.render();
          break;
        }
        case 'claim-all': {
          this.port.dispatch({ type: 'CLAIM_ALL_CANDIDATES', payload: { gangId, free: true } }, true);
          this.render();
          break;
        }
        case 'charter-all': {
          this.port.dispatch({ type: 'CHARTER_ALL_ROUTES', payload: { gangId, free: true } }, true);
          this.render();
          break;
        }
        case 'claim-single': {
          const candId = btn.getAttribute('data-candidate-id');
          if (candId) {
            this.port.dispatch({ type: 'CLAIM_CANDIDATE_NODE', payload: { gangId, candidateId: candId } }, true);
            this.render();
          }
          break;
        }
        case 'spawn-migrants': {
          const count = parseInt(btn.getAttribute('data-count') || '10', 10);
          this.port.dispatch({ type: 'SPAWN_MIGRANTS', payload: { gangId, count } }, true);
          this.render();
          break;
        }
        case 'fast-forward-voyages': {
          this.port.dispatch({ type: 'FAST_FORWARD_VOYAGES', payload: { gangId } }, true);
          this.render();
          break;
        }
        case 'trigger-raid': {
          this.port.dispatch({ type: 'TRIGGER_RAID', payload: { gangId } }, true);
          this.render();
          break;
        }
        case 'quick-build': {
          const kind = btn.getAttribute('data-kind') as LocationKind;
          const region = btn.getAttribute('data-region') as RegionId;
          const gang = this.currentSnapshot?.gangs[gangId];
          if (gang) {
            // Find appropriate coordinates based on region
            const x = region === 'AFRICA' ? 600 : region === 'EUROPE' ? 2100 : 3600;
            const y = region === 'AFRICA' ? 950 : region === 'EUROPE' ? 450 : 120;
            this.port.dispatch({
              type: 'PURCHASE_NODE',
              payload: { gangId, kind, region, x, y, name: `God ${kind}` },
            }, true);
            this.render();
          }
          break;
        }
      }
    });
  }

  show() {
    this.container.style.display = 'flex';
    // Default to first active gang if none selected
    if (!this.selectedGangId && this.currentSnapshot) {
      const firstActive = Object.values(this.currentSnapshot.gangs).find((g) => g.status === 'ACTIVE');
      if (firstActive) {
        this.selectedGangId = firstActive.id;
      }
    }
    this.render();
  }

  hide() {
    this.container.style.display = 'none';
  }

  isVisible(): boolean {
    return this.container.style.display !== 'none';
  }

  update(snapshot: WorldSnapshot) {
    this.currentSnapshot = snapshot;
    if (this.isVisible()) {
      this.render();
    }
  }

  selectGang(gangId: string) {
    this.selectedGangId = gangId;
    this.render();
  }

  private render() {
    if (!this.currentSnapshot) return;

    // Render left roster
    const roster = this.container.querySelector('#god-gangs-list');
    if (roster) {
      let rosterHtml = '';
      for (const gang of Object.values(this.currentSnapshot.gangs)) {
        const isSelected = gang.id === this.selectedGangId;
        const isPuppeted = !!gang.isAiDisabled;
        const cashClass = gang.cash >= 0 ? 'text-green' : 'text-red';

        // Count gang assets
        const nodeCount = Object.values(this.currentSnapshot.locations).filter((l) => l.gangId === gang.id && l.operationalStatus === 'ACTIVE').length;
        const routeCount = Object.values(this.currentSnapshot.routes).filter((r) => r.gangId === gang.id && r.status === 'ACTIVE').length;
        const scoutCount = Object.values(this.currentSnapshot.hoods).filter((h) => h.gangId === gang.id && h.role === 'SCOUT').length;

        rosterHtml += `
          <div class="god-gang-card ${isSelected ? 'active' : ''} ${gang.status === 'BANKRUPT' ? 'card-bankrupt' : ''}" data-gang-id="${gang.id}" style="border-left-color: ${gang.color}">
            <div class="god-card-header">
              <div class="god-gang-name" style="color: ${gang.color}">
                <span class="god-emblem">${gang.emblem}</span>
                <span>${gang.name}</span>
              </div>
              <span class="god-status-tag ${gang.status === 'BANKRUPT' ? 'tag-danger' : 'tag-active'}">${gang.status}</span>
            </div>

            <div class="god-card-metrics">
              <div class="card-metric">
                <span class="m-lbl">TREASURY</span>
                <span class="m-val ${cashClass}">$${gang.cash.toLocaleString()}</span>
              </div>
              <div class="card-metric">
                <span class="m-lbl">NODES</span>
                <span class="m-val">${nodeCount}</span>
              </div>
              <div class="card-metric">
                <span class="m-lbl">ROUTES</span>
                <span class="m-val">${routeCount}</span>
              </div>
              <div class="card-metric">
                <span class="m-lbl">SCOUTS</span>
                <span class="m-val">${scoutCount}</span>
              </div>
            </div>

            <div class="god-card-footer">
              <span class="autonomy-pill ${isPuppeted ? 'pill-puppet' : 'pill-auto'}">
                ${isPuppeted ? '👤 MANUAL PUPPET' : '🤖 AUTONOMOUS AI'}
              </span>
              <button class="btn-select-puppet ${isSelected ? 'btn-selected' : ''}">
                ${isSelected ? '▶ Controlling' : 'Select'}
              </button>
            </div>
          </div>
        `;
      }
      roster.innerHTML = rosterHtml;

      // Click card to select
      roster.querySelectorAll<HTMLElement>('.god-gang-card').forEach((card) => {
        card.addEventListener('click', () => {
          const gId = card.getAttribute('data-gang-id');
          if (gId) this.selectGang(gId);
        });
      });
    }

    // Render right control deck
    const deck = this.container.querySelector('#god-control-deck');
    if (!deck) return;

    if (!this.selectedGangId || !this.currentSnapshot.gangs[this.selectedGangId]) {
      deck.innerHTML = `
        <div class="god-empty-state">
          <span class="empty-icon">👑</span>
          <div class="empty-title">Select a syndicate from the left roster</div>
          <div class="empty-sub">Choose a gang to inspect its operations, grant funds, or dictate directives.</div>
        </div>
      `;
      return;
    }

    const gang = this.currentSnapshot.gangs[this.selectedGangId];
    const isPuppeted = !!gang.isAiDisabled;
    const cashClass = gang.cash >= 0 ? 'text-green' : 'text-red';

    // Find candidate nodes and routes discovered by this gang
    const candidateNodes = Object.values(this.currentSnapshot.locations).filter(
      (l) => l.operationalStatus === 'DISCOVERED_CANDIDATE' && l.discoveredByGangId === gang.id
    );
    const candidateRoutes = gang.discoveredCandidateRoutes || [];
    const activeVoyages = Object.values(this.currentSnapshot.voyages).filter(
      (v) => v.gangId === gang.id && v.status === 'IN_PROGRESS'
    );

    deck.innerHTML = `
      <!-- DECK HEADER -->
      <div class="deck-header" style="border-bottom: 2px solid ${gang.color}">
        <div class="deck-gang-info">
          <span class="deck-emblem">${gang.emblem}</span>
          <div>
            <div class="deck-gang-title" style="color: ${gang.color}">${gang.name} — COMMAND DECK</div>
            <div class="deck-gang-sub">Headquarters ID: ${gang.mainHqLocationId || gang.hqLocationId} | Underworld Rep: ${gang.reputation}%</div>
          </div>
        </div>
        <div class="deck-header-actions">
          <button class="btn-god-toggle-ai ${isPuppeted ? 'puppeted' : ''}" data-god-action="toggle-ai" title="Toggle autonomous AI. When paused, the gang will only make moves directed by you!">
            <span>${isPuppeted ? '👤 PUPPET MODE (AI PAUSED)' : '🤖 AUTONOMOUS AI (ACTIVE)'}</span>
            <span class="toggle-sub">${isPuppeted ? 'Click to re-enable AI' : 'Click to puppet manually'}</span>
          </button>
        </div>
      </div>

      <!-- DECK BODY (GRID OF COMMAND CARDS) -->
      <div class="deck-grid">
        <!-- 1. TREASURY & INTERVENTIONS -->
        <div class="deck-card">
          <div class="deck-card-title">💵 TREASURY & FINANCIAL INTERVENTIONS</div>
          <div class="deck-card-desc">Inject capital, clear debt, or bankrupt rival syndicates.</div>

          <div class="live-balance-box">
            <span class="bal-label">CURRENT TREASURY:</span>
            <span class="bal-val ${cashClass}">$${gang.cash.toLocaleString()}</span>
          </div>

          <div class="btn-action-group">
            <div class="action-row-title">DIRECT GRANTS (GIFT CASH):</div>
            <div class="btn-grid-4">
              <button class="btn-god-action btn-god-cash" data-god-action="grant-cash" data-amount="1000">+$1,000</button>
              <button class="btn-god-action btn-god-cash" data-god-action="grant-cash" data-amount="5000">+$5,000</button>
              <button class="btn-god-action btn-god-cash" data-god-action="grant-cash" data-amount="25000">+$25,000</button>
              <button class="btn-god-action btn-god-cash btn-god-gold" data-god-action="grant-cash" data-amount="100000">+$100,000</button>
            </div>
          </div>

          <div class="btn-action-group">
            <div class="action-row-title">CUSTOM ADJUSTMENTS & PENALTIES:</div>
            <div class="btn-grid-3">
              <button class="btn-god-action" data-god-action="set-cash" data-cash="10000">Bailout ($10k)</button>
              <button class="btn-god-action btn-god-warning" data-god-action="grant-cash" data-amount="-5000">-$5,000</button>
              <button class="btn-god-action btn-god-danger" data-god-action="set-cash" data-cash="0">Set to $0</button>
            </div>
            <div class="custom-cash-row">
              <input type="number" id="god-custom-cash-input" class="ev-input custom-input" placeholder="Custom amount (e.g. 50000)" />
              <button class="btn-god-action btn-primary" data-god-action="custom-cash">Grant Custom</button>
            </div>
          </div>
        </div>

        <!-- 2. SCOUTING & EXPANSION DIRECTIVES -->
        <div class="deck-card">
          <div class="deck-card-title">🧭 SCOUTING & TERRITORIAL DIRECTIVES</div>
          <div class="deck-card-desc">Dispatch scouts to chart new territories, even with zero initial influence.</div>

          <div class="btn-action-group">
            <div class="action-row-title">ORDER REGIONAL RECONNAISSANCE:</div>
            <div class="btn-grid-2">
              <button class="btn-god-action btn-god-scout" data-god-action="scout-region" data-region="AFRICA">
                🌍 Scout Africa (Recruiters & HQs)
              </button>
              <button class="btn-god-action btn-god-scout" data-god-action="scout-region" data-region="EUROPE">
                🇪🇺 Scout Europe (Corridors & HQs)
              </button>
              <button class="btn-god-action btn-god-scout" data-god-action="scout-region" data-region="UK">
                🇬🇧 Scout UK (Depots & HQs)
              </button>
              <button class="btn-god-action btn-god-scout" data-god-action="search-routes">
                🌊 Search Maritime Routes
              </button>
            </div>
          </div>

          <div class="btn-action-group">
            <div class="action-row-title">PERSONNEL & EXPANSION SHORTCUTS:</div>
            <div class="btn-grid-2">
              <button class="btn-god-action" data-god-action="hire-scout">
                🕵️ Hire Dedicated Scout ($0)
              </button>
              <button class="btn-god-action btn-god-gold" data-god-action="claim-all" ${candidateNodes.length === 0 ? 'disabled' : ''}>
                ⚡ Claim All Candidates (${candidateNodes.length})
              </button>
              <button class="btn-god-action btn-god-gold" data-god-action="charter-all" ${candidateRoutes.length === 0 ? 'disabled' : ''}>
                ⚡ Charter All Routes (${candidateRoutes.length})
              </button>
            </div>
          </div>
        </div>

        <!-- 3. HUMAN CARGO & FLEET CONTROL -->
        <div class="deck-card">
          <div class="deck-card-title">👥 HUMAN CARGO & VOYAGE LOGISTICS</div>
          <div class="deck-card-desc">Inject customers into recruiter queues and control passages.</div>

          <div class="btn-action-group">
            <div class="action-row-title">MIGRANT INJECTION:</div>
            <div class="btn-grid-2">
              <button class="btn-god-action btn-god-migrant" data-god-action="spawn-migrants" data-count="10">
                👥 Inject +10 VIP Migrants
              </button>
              <button class="btn-god-action btn-god-migrant" data-god-action="spawn-migrants" data-count="50">
                👥 Inject +50 Mass Surge
              </button>
            </div>
          </div>

          <div class="btn-action-group">
            <div class="action-row-title">VOYAGE MANIPULATION (ACTIVE: ${activeVoyages.length}):</div>
            <div class="btn-grid-2">
              <button class="btn-god-action btn-god-gold" data-god-action="fast-forward-voyages" ${activeVoyages.length === 0 ? 'disabled' : ''}>
                🚀 Divine Teleport (Instant Deliver)
              </button>
              <button class="btn-god-action btn-god-danger" data-god-action="trigger-raid" ${activeVoyages.length === 0 ? 'disabled' : ''}>
                🚨 Trigger Coast Guard Raid
              </button>
            </div>
          </div>
        </div>

        <!-- 4. ACTIVE DISCOVERED CANDIDATES -->
        <div class="deck-card">
          <div class="deck-card-title">⏳ DISCOVERED BLUEPRINTS (${candidateNodes.length + candidateRoutes.length})</div>
          <div class="deck-card-desc">Sites and maritime passages charted by scouts, waiting to be claimed.</div>

          <div class="candidate-scroll-list">
            ${this.renderCandidateList(candidateNodes, candidateRoutes)}
          </div>
        </div>
      </div>
    `;
  }

  private renderCandidateList(nodes: any[], routes: any[]): string {
    if (nodes.length === 0 && routes.length === 0) {
      return `
        <div class="candidate-empty-box">
          <span class="empty-icon">🧭</span>
          <div>No active candidate sites or routes for this syndicate.</div>
          <div class="empty-sub">Use 'Order Regional Reconnaissance' above to find new opportunities!</div>
        </div>
      `;
    }

    let items = '';
    for (const node of nodes) {
      const remainingTicks = Math.max(0, (node.expiresAtTick || 0) - (this.currentSnapshot?.tick || 0));
      items += `
        <div class="cand-row-item">
          <div class="cand-info">
            <span class="cand-badge badge-node">${node.kind}</span>
            <span class="cand-name">${node.name} (${node.region})</span>
            <span class="cand-timer">⏳ ${remainingTicks}t</span>
          </div>
          <button class="btn-claim-mini" data-god-action="claim-single" data-candidate-id="${node.id}">
            Instant Claim ($0)
          </button>
        </div>
      `;
    }

    for (const cr of routes) {
      const remainingTicks = Math.max(0, (cr.expiresAtTick || 0) - (this.currentSnapshot?.tick || 0));
      items += `
        <div class="cand-row-item">
          <div class="cand-info">
            <span class="cand-badge badge-route">${cr.mode} ROUTE</span>
            <span class="cand-name">${cr.sourceName} ➔ ${cr.targetName}</span>
            <span class="cand-timer">⏳ ${remainingTicks}t</span>
          </div>
          <button class="btn-claim-mini" data-god-action="charter-all">
            Instant Charter
          </button>
        </div>
      `;
    }

    return items;
  }
}
