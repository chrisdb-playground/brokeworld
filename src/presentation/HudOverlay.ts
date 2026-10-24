import type { GamePort } from '../app/GamePort';
import type { TickScheduler } from '../app/TickScheduler';
import type {
  CandidateRouteOpportunity,
  CorridorBundle,
  GangState,
  LocationDef,
  LocationKind,
  MigrantState,
  RegionId,
  RouteServiceState,
  VoyageState,
  WorldSnapshot,
} from '../sim/types';
import {
  getEffectiveInfluenceHeat,
  getNodeHeatMultiplier,
  getHqSynergyInfo,
  canClaimCandidateNode,
  getClosestHqForNode,
} from '../sim/influence';
import { MigrantRenderer } from './MigrantRenderer';
import { EventLogView } from './EventLogView';
import { GodModeView } from './GodModeView';

export interface HudOverlayCallbacks {
  onSelectGang?: (gangId: string | null) => void;
  onSelectGangs?: (gangIds: Set<string>) => void;
  onFocusLocation?: (locId: string) => void;
  onSelectRoute?: (routeId: string) => void;
  onToggleInfluence?: () => boolean;
  onStartPlacement?: (data: { gangId: string; kind: LocationKind; cost: number; region?: RegionId }) => void;
  onCancelPlacement?: () => void;
  onSwitchToGeoView?: () => void;
  onSwitchToRegionView?: (hqId: string) => void;
}

export class HudOverlay {
  private port: GamePort;
  private scheduler: TickScheduler;
  private onSelectGangCallback?: (gangId: string | null) => void;
  private onSelectGangsCallback?: (gangIds: Set<string>) => void;
  private onFocusLocation?: (locId: string) => void;
  private onSelectRouteCallback?: (routeId: string) => void;
  private onToggleInfluenceCallback?: () => boolean;
  private onStartPlacementCallback?: (data: { gangId: string; kind: LocationKind; cost: number; region?: RegionId }) => void;
  private onCancelPlacementCallback?: () => void;
  private onSwitchToGeoViewCallback?: () => void;
  private onSwitchToRegionViewCallback?: (hqId: string) => void;

  private currentSnapshot!: WorldSnapshot;
  private selectedEntityType: 'MIGRANT' | 'GANG' | 'LOCATION' | 'ROUTE' | 'VOYAGE' | 'CORRIDOR_BUNDLE' | null = null;
  private selectedEntityId: string | null = null;
  private selectedCorridorBundle: CorridorBundle | null = null;
  private currentViewMode: 'GEO' | 'REGION' = 'GEO';
  private activeRegionHq: LocationDef | null = null;
  private selectedGangIds: Set<string> = new Set();
  private isInfluenceVisible = true;
  private lastInspectorKey: string | null = null;
  private lastEventCount = -1;
  private lastEventFirstTick = -1;

  private activeTab: 'world' | 'events' | 'god' = 'world';
  private eventLogView!: EventLogView;
  private godModeView!: GodModeView;
  private prospectSortMode: 'offer' | 'expiry' | 'happiness' | 'goal' = 'offer';

  // Persistent DOM cache for gang cards to prevent recreating DOM on each sim tick
  private gangCardElements: Map<string, HTMLElement> = new Map();

  constructor(
    port: GamePort,
    scheduler: TickScheduler,
    callbacks: HudOverlayCallbacks
  ) {
    this.port = port;
    this.scheduler = scheduler;
    this.onSelectGangCallback = callbacks.onSelectGang;
    this.onSelectGangsCallback = callbacks.onSelectGangs;
    this.onFocusLocation = callbacks.onFocusLocation;
    this.onSelectRouteCallback = callbacks.onSelectRoute;
    this.onToggleInfluenceCallback = callbacks.onToggleInfluence;
    this.onStartPlacementCallback = callbacks.onStartPlacement;
    this.onCancelPlacementCallback = callbacks.onCancelPlacement;
    this.onSwitchToGeoViewCallback = callbacks.onSwitchToGeoView;
    this.onSwitchToRegionViewCallback = callbacks.onSwitchToRegionView;

    // Initialize with all active gangs selected so all assets are visible on launch
    const initialSnapshot = this.port.getSnapshot();
    if (initialSnapshot) {
      this.currentSnapshot = initialSnapshot;
      for (const gang of Object.values(initialSnapshot.gangs)) {
        if (gang.status === 'ACTIVE') {
          this.selectedGangIds.add(gang.id);
        }
      }
    }

    this.mountDom();
    if (this.currentSnapshot) {
      this.update(this.currentSnapshot);
    }

    this.port.subscribe((snapshot) => {
      this.currentSnapshot = snapshot;
      this.update(snapshot);
    });
  }

  setViewMode(mode: 'GEO' | 'REGION', regionHq?: LocationDef | null): void {
    this.currentViewMode = mode;
    this.activeRegionHq = regionHq || null;
    this.updateViewModeUI();
  }

  selectCorridorBundle(bundle: CorridorBundle): void {
    this.selectedEntityType = 'CORRIDOR_BUNDLE';
    this.selectedEntityId = bundle.id;
    this.selectedCorridorBundle = bundle;
    this.renderInspector();
  }

  private updateViewModeUI(): void {
    const geoBtn = document.getElementById('btn-geo-view');
    const sep = document.getElementById('hud-view-separator');
    const regionBtn = document.getElementById('btn-region-view');
    const regionLabel = document.getElementById('hud-active-region-label');

    if (this.currentViewMode === 'GEO') {
      if (geoBtn) {
        geoBtn.classList.add('active');
        geoBtn.innerHTML = '<span class="btn-icon">🌐</span><span class="btn-label">GEO VIEW</span>';
      }
      if (sep) sep.style.display = 'none';
      if (regionBtn) {
        regionBtn.style.display = 'none';
        regionBtn.classList.remove('active');
      }
    } else {
      if (geoBtn) {
        geoBtn.classList.remove('active');
        geoBtn.innerHTML = '<span class="btn-icon">← 🌐</span><span class="btn-label">GEO VIEW</span>';
      }
      if (sep) sep.style.display = 'inline-block';
      if (regionBtn) {
        regionBtn.style.display = 'inline-flex';
        regionBtn.classList.add('active');
      }
      if (regionLabel && this.activeRegionHq) {
        const flag = this.activeRegionHq.region === 'UK' ? '🇬🇧' : this.activeRegionHq.region === 'AFRICA' ? '🌍' : '🇪🇺';
        regionLabel.textContent = `${flag} ${this.activeRegionHq.name}`;
      }
    }
  }

  selectLocation(loc: LocationDef) {
    this.selectedEntityType = 'LOCATION';
    this.selectedEntityId = loc.id;
    this.renderInspector();
  }

  selectRoute(route: RouteServiceState) {
    this.selectedEntityType = 'ROUTE';
    this.selectedEntityId = route.id;
    this.renderInspector();
  }

  selectGang(gang: GangState) {
    this.selectedGangIds.add(gang.id);
    this.selectedEntityType = 'GANG';
    this.selectedEntityId = gang.id;
    this.notifyGangSelection();
    this.renderInspector();
  }

  toggleGang(gangId: string) {
    if (this.selectedGangIds.has(gangId)) {
      this.selectedGangIds.delete(gangId);
      if (this.selectedEntityType === 'GANG' && this.selectedEntityId === gangId) {
        if (this.selectedGangIds.size > 0) {
          const nextGangId = Array.from(this.selectedGangIds)[0];
          this.selectedEntityId = nextGangId;
          this.renderInspector();
        } else {
          this.deselectEntity();
        }
      }
    } else {
      this.selectedGangIds.add(gangId);
      this.selectedEntityType = 'GANG';
      this.selectedEntityId = gangId;
      this.renderInspector();
    }
    this.notifyGangSelection();
  }

  selectAllGangs() {
    if (!this.currentSnapshot) return;
    for (const gang of Object.values(this.currentSnapshot.gangs)) {
      this.selectedGangIds.add(gang.id);
    }
    this.notifyGangSelection();
  }

  deselectGang() {
    this.deselectAllGangs();
  }

  deselectAllGangs() {
    this.selectedGangIds.clear();
    this.deselectEntity();
    this.notifyGangSelection();
  }

  deselectEntity() {
    this.selectedEntityType = null;
    this.selectedEntityId = null;
    this.lastInspectorKey = null;
    document.getElementById('hud-inspector')?.classList.add('collapsed');
  }

  private notifyGangSelection() {
    if (this.onSelectGangsCallback) {
      this.onSelectGangsCallback(new Set(this.selectedGangIds));
    } else if (this.onSelectGangCallback) {
      this.onSelectGangCallback(this.selectedGangIds.size === 1 ? Array.from(this.selectedGangIds)[0] : null);
    }
    this.updateSelectionBar();
  }

  selectVoyage(voyage: VoyageState) {
    this.selectedEntityType = 'VOYAGE';
    this.selectedEntityId = voyage.id;
    this.renderInspector();
  }

  selectMigrant(migrant: MigrantState) {
    this.selectedEntityType = 'MIGRANT';
    this.selectedEntityId = migrant.id;
    this.renderInspector();
  }

  private mountDom() {
    const root = document.getElementById('hud-root');
    if (!root) return;

    root.innerHTML = `
      <!-- TOP HUD BAR -->
      <div class="hud-top-bar">
        <div class="brand-badge">
          <span class="brand-icon">🐟</span>
          <div>
            <div class="brand-name">BROKE WORLD</div>
            <div class="brand-sub">AUTONOMOUS SMUGGLER SIMULATOR</div>
          </div>
        </div>

        <!-- VIEW MODE NAVIGATION (2 Discrete Zoom Levels: GEO vs REGION) -->
        <div class="view-mode-bar" id="hud-view-mode-bar">
          <button class="view-mode-btn active" id="btn-geo-view" title="Strategic Macro Overview (Key 4 or Click)">
            <span class="btn-icon">🌐</span>
            <span class="btn-label" id="btn-geo-label">GEO VIEW</span>
          </button>
          <span class="view-mode-sep" id="hud-view-separator" style="display: none;">/</span>
          <button class="view-mode-btn region-btn" id="btn-region-view" style="display: none;" title="Current Regional Operations Detail">
            <span class="btn-icon">📍</span>
            <span class="btn-label" id="hud-active-region-label">REGION VIEW</span>
          </button>
        </div>

        <!-- NAVIGATION TABS -->
        <nav class="hud-tabs">
          <button class="hud-tab active" data-tab="world" title="World Map Operations (Key M)">
            <span class="tab-icon">🗺️</span>
            <span class="tab-label">WORLD MAP</span>
          </button>
          <button class="hud-tab" data-tab="events" title="Full Operations Event Chronicle (Key L)">
            <span class="tab-icon">📜</span>
            <span class="tab-label">EVENT LOG</span>
            <span id="tab-events-badge" class="tab-badge" style="display: none;">0</span>
          </button>
          <button class="hud-tab" data-tab="god" title="Divine Intervention & Syndicate Puppeteering (Key G)">
            <span class="tab-icon">👑</span>
            <span class="tab-label">GOD MODE</span>
          </button>
        </nav>

        <!-- SIM CLOCK & CONTROLS (Ticks only, no day unit) -->
        <div class="time-controls">
          <div class="tick-chip">
            <span class="tick-label">TICK</span>
            <span id="hud-tick" class="tick-val">0</span>
          </div>
          <div id="hud-pause-indicator" class="pause-chip" style="display: none;">
            <span>⏸ PAUSED</span>
          </div>
          <div class="seed-chip" title="Active PRNG Seed">
            <span class="seed-label">SEED</span>
            <span id="hud-seed" class="seed-val">...</span>
          </div>
          <div class="speed-btns">
            <button class="spd-btn" data-speed="0" title="Pause / Unpause (Space)">⏸</button>
            <button class="spd-btn active" data-speed="1" title="Speed 1x (Key 1)">1×</button>
            <button class="spd-btn" data-speed="5" title="Speed 5x (Key 2)">5×</button>
            <button class="spd-btn" data-speed="20" title="Speed 20x (Key 3)">20×</button>
            <button class="spd-btn" id="btn-step" title="Step 1 Tick (Key S)">⏯ Step</button>
            <button class="spd-btn" id="btn-reset" title="Reset Simulation with Same Seed (R)">🔄 Reset</button>
            <button class="spd-btn" id="btn-random-seed" title="Roll New Random Seed & Restart">🎲 Random Seed</button>
            <button class="spd-btn active" id="btn-toggle-influence" title="Toggle HQ Influence Zones (I)">🔥 Influence</button>
          </div>
        </div>

        <!-- METRICS -->
        <div class="metrics-bar">
          <div class="metric-item">
            <span class="m-label">ACTIVE MIGRANTS</span>
            <span class="m-val" id="m-migrants">0</span>
          </div>
          <div class="metric-item">
            <span class="m-label">ROUTES</span>
            <span class="m-val" id="m-routes">0</span>
          </div>
          <div class="metric-item">
            <span class="m-label">ACTIVE VOYAGES</span>
            <span class="m-val" id="m-voyages">0</span>
          </div>
          <div class="metric-item">
            <span class="m-label">ARRIVALS (IN DEPOTS)</span>
            <span class="m-val text-green" id="m-success">0</span>
          </div>
          <div class="metric-item">
            <span class="m-label">DISRUPTIONS</span>
            <span class="m-val text-red" id="m-disrupted">0</span>
          </div>
        </div>
      </div>

      <!-- LEFT SIDEBAR: GANG LEGEND & EVENT FEED -->
      <div class="hud-left-panel">
        <div class="panel-section">
          <div class="section-title">GANGS & ASSETS (MULTI-SELECT)</div>
          <div class="gang-selection-bar">
            <span id="gang-sel-status">All gang assets hidden. Click gangs to view:</span>
            <div class="gang-sel-controls">
              <button id="btn-select-all" class="btn-gang-action">👁 Select All</button>
              <button id="btn-deselect-gang" class="btn-gang-action btn-danger">✕ Hide All</button>
              <button id="btn-influence-toggle" class="btn-gang-action">🔥 Influence: ON</button>
            </div>
          </div>
          <div id="gangs-legend" class="gangs-legend-list"></div>
        </div>

        <div class="panel-section flex-grow">
          <div class="section-title-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <div class="section-title" style="margin-bottom: 0;">EVENT LOG</div>
            <button id="btn-open-event-log" class="btn-link-action" style="background: none; border: none; color: #38bdf8; font-family: 'JetBrains Mono', monospace; font-size: 10px; cursor: pointer; text-decoration: underline;" title="Open Full-Screen Event Log (L)">↗ Full Screen</button>
          </div>
          <div id="event-feed" class="event-feed-list"></div>
        </div>
      </div>

      <!-- RIGHT DRAWER: MULTI-ENTITY INSPECTOR -->
      <div id="hud-inspector" class="hud-inspector-card collapsed">
        <div class="inspector-header">
          <div id="insp-header-title">INSPECTOR</div>
          <button id="close-insp" class="btn-close">✕</button>
        </div>
        <div id="insp-content" class="inspector-content"></div>
      </div>
    `;

    // Instantiate full-screen tab views
    this.eventLogView = new EventLogView(root, (unread) => this.updateEventBadge(unread));
    this.godModeView = new GodModeView(root, this.port);

    // Hook up tab navigation buttons
    root.querySelectorAll<HTMLButtonElement>('.hud-tab[data-tab]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const tab = tabBtn.getAttribute('data-tab') as 'world' | 'events' | 'god';
        this.setActiveTab(tab);
        tabBtn.blur();
      });
    });

    root.querySelector('#btn-open-event-log')?.addEventListener('click', () => {
      this.setActiveTab('events');
    });

    // Hook up View Mode switcher buttons (GEO vs REGION)
    root.querySelector('#btn-geo-view')?.addEventListener('click', (e) => {
      if (this.onSwitchToGeoViewCallback) {
        this.onSwitchToGeoViewCallback();
      }
      (e.currentTarget as HTMLElement)?.blur();
    });

    root.querySelector('#btn-region-view')?.addEventListener('click', (e) => {
      if (this.activeRegionHq && this.onSwitchToRegionViewCallback) {
        this.onSwitchToRegionViewCallback(this.activeRegionHq.id);
      }
      (e.currentTarget as HTMLElement)?.blur();
    });

    // Hook up time control buttons
    const spdBtns = root.querySelectorAll<HTMLButtonElement>('.spd-btn[data-speed]');
    spdBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const spd = parseFloat(btn.getAttribute('data-speed') || '1');
        if (spd === 0) {
          this.togglePause();
        } else {
          this.scheduler.setTimeScale(spd);
          this.updateSpeedUI();
        }
        btn.blur();
      });
    });

    root.querySelector('#btn-step')?.addEventListener('click', (e) => {
      this.scheduler.step();
      (e.currentTarget as HTMLElement)?.blur();
    });

    root.querySelector('#btn-reset')?.addEventListener('click', (e) => {
      this.scheduler.reset();
      this.deselectEntity();
      this.updateSpeedUI();
      (e.currentTarget as HTMLElement)?.blur();
    });

    root.querySelector('#btn-random-seed')?.addEventListener('click', (e) => {
      const newSeed = Math.floor(Math.random() * 900000) + 100000;
      this.scheduler.reset(newSeed);
      this.deselectEntity();
      this.updateSpeedUI();
      (e.currentTarget as HTMLElement)?.blur();
    });

    const toggleInfluenceAction = () => {
      if (this.onToggleInfluenceCallback) {
        this.isInfluenceVisible = this.onToggleInfluenceCallback();
        const topBtn = document.getElementById('btn-toggle-influence');
        const altBtn = document.getElementById('btn-influence-toggle');
        if (topBtn) {
          topBtn.classList.toggle('active', this.isInfluenceVisible);
          topBtn.textContent = this.isInfluenceVisible ? '🔥 Influence' : '💤 Influence Off';
        }
        if (altBtn) {
          altBtn.textContent = this.isInfluenceVisible ? '🔥 Influence: ON' : '💤 Influence: OFF';
        }
      }
    };

    root.querySelector('#btn-toggle-influence')?.addEventListener('click', toggleInfluenceAction);
    root.querySelector('#btn-influence-toggle')?.addEventListener('click', toggleInfluenceAction);

    root.querySelector('#btn-select-all')?.addEventListener('click', () => {
      this.selectAllGangs();
    });

    root.querySelector('#btn-deselect-gang')?.addEventListener('click', () => {
      this.deselectAllGangs();
    });

    root.querySelector('#close-insp')?.addEventListener('click', () => {
      this.deselectEntity();
    });

    const inspContent = root.querySelector('#insp-content');
    if (inspContent) {
      inspContent.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const buildBtn = target.closest<HTMLButtonElement>('.btn-build-action');
        if (buildBtn) {
          e.stopPropagation();
          const gId = buildBtn.getAttribute('data-gang-id');
          const kind = buildBtn.getAttribute('data-kind') as LocationKind;
          const cost = parseInt(buildBtn.getAttribute('data-cost') || '2500', 10);
          if (gId && kind && this.onStartPlacementCallback) {
            this.onStartPlacementCallback({ gangId: gId, kind, cost });
          }
          return;
        }

        const scoutAreaBtn = target.closest<HTMLButtonElement>('.btn-scout-area');
        if (scoutAreaBtn) {
          e.stopPropagation();
          const gId = scoutAreaBtn.getAttribute('data-gang-id');
          const reg = scoutAreaBtn.getAttribute('data-region') as RegionId | undefined;
          if (gId) {
            this.port.dispatch({ type: 'SCOUT_AREA', payload: { gangId: gId, region: reg || undefined } });
            setTimeout(() => this.renderInspector(), 50);
          }
          return;
        }

        const searchRoutesBtn = target.closest<HTMLButtonElement>('.btn-search-routes');
        if (searchRoutesBtn) {
          e.stopPropagation();
          const gId = searchRoutesBtn.getAttribute('data-gang-id');
          if (gId) {
            this.port.dispatch({ type: 'SEARCH_ROUTES', payload: { gangId: gId } });
            setTimeout(() => this.renderInspector(), 50);
          }
          return;
        }

        const hireScoutBtn = target.closest<HTMLButtonElement>('.btn-hire-scout');
        if (hireScoutBtn) {
          e.stopPropagation();
          const gId = hireScoutBtn.getAttribute('data-gang-id');
          if (gId) {
            this.port.dispatch({ type: 'HIRE_SCOUT', payload: { gangId: gId } });
            setTimeout(() => this.renderInspector(), 50);
          }
          return;
        }

        const claimBtn = target.closest<HTMLButtonElement>('.btn-claim-candidate');
        if (claimBtn) {
          e.stopPropagation();
          const gId = claimBtn.getAttribute('data-gang-id');
          const candId = claimBtn.getAttribute('data-candidate-id');
          if (gId && candId) {
            this.port.dispatch({ type: 'CLAIM_CANDIDATE_NODE', payload: { gangId: gId, candidateId: candId } });
            setTimeout(() => this.renderInspector(), 50);
          }
          return;
        }

        const charterBtn = target.closest<HTMLButtonElement>('.btn-charter-route');
        if (charterBtn) {
          e.stopPropagation();
          const gId = charterBtn.getAttribute('data-gang-id');
          const srcId = charterBtn.getAttribute('data-src-id');
          const tgtId = charterBtn.getAttribute('data-tgt-id');
          if (gId && srcId && tgtId) {
            this.port.dispatch({
              type: 'PURCHASE_BORDER_ROUTE',
              payload: { gangId: gId, sourceRecruiterId: srcId, targetDepotId: tgtId },
            });
            setTimeout(() => this.renderInspector(), 50);
          }
          return;
        }

        const lockdownBtn = target.closest<HTMLButtonElement>('.btn-toggle-lockdown');
        if (lockdownBtn) {
          e.stopPropagation();
          const locId = lockdownBtn.getAttribute('data-location-id');
          if (locId) {
            this.port.dispatch({ type: 'TOGGLE_LOCKDOWN', payload: { locationId: locId } });
            setTimeout(() => this.renderInspector(), 30);
          }
          return;
        }

        const acceptProspectBtn = target.closest<HTMLButtonElement>('.btn-accept-prospect');
        if (acceptProspectBtn) {
          e.stopPropagation();
          const rId = acceptProspectBtn.getAttribute('data-recruiter-id');
          const mId = acceptProspectBtn.getAttribute('data-migrant-id');
          if (rId && mId) {
            this.port.dispatch({ type: 'ACCEPT_PROSPECT', payload: { recruiterId: rId, migrantId: mId } });
            setTimeout(() => this.renderInspector(), 30);
          }
          return;
        }

        const sortBtn = target.closest<HTMLButtonElement>('.btn-sort-prospects');
        if (sortBtn) {
          e.stopPropagation();
          const mode = sortBtn.getAttribute('data-sort-mode') as 'offer' | 'expiry' | 'happiness' | 'goal';
          if (mode) {
            this.prospectSortMode = mode;
            this.renderInspector();
          }
          return;
        }

        const depotActionBtn = target.closest<HTMLButtonElement>('.btn-depot-action');
        if (depotActionBtn) {
          e.stopPropagation();
          const depId = depotActionBtn.getAttribute('data-depot-id');
          const mId = depotActionBtn.getAttribute('data-migrant-id');
          const act = depotActionBtn.getAttribute('data-action');
          if (depId && mId && act) {
            if (act === 'boot') {
              this.port.dispatch({ type: 'BOOT_MIGRANT', payload: { depotId: depId, migrantId: mId } });
            } else if (act === 'workshop') {
              this.port.dispatch({ type: 'ASSIGN_MIGRANT_WORKSHOP', payload: { depotId: depId, migrantId: mId } });
            } else if (act === 'crime') {
              this.port.dispatch({ type: 'ASSIGN_MIGRANT_CRIME', payload: { depotId: depId, migrantId: mId } });
            } else if (act === 'forward') {
              this.port.dispatch({ type: 'FORWARD_MIGRANT', payload: { depotId: depId, migrantId: mId } });
            }
            setTimeout(() => this.renderInspector(), 30);
          }
          return;
        }

        const migrantRow = target.closest<HTMLElement>('.migrant-row-item');
        if (migrantRow) {
          e.stopPropagation();
          const cid = migrantRow.getAttribute('data-migrant-id');
          if (cid && this.currentSnapshot) {
            const migrant = this.currentSnapshot.migrants[cid];
            if (migrant) this.selectMigrant(migrant);
          }
          return;
        }

        const routeRow = target.closest<HTMLElement>('.route-row-item');
        if (routeRow) {
          e.stopPropagation();
          const rid = routeRow.getAttribute('data-route-id');
          if (rid && this.currentSnapshot) {
            const route = this.currentSnapshot.routes[rid];
            if (route) {
              this.selectRoute(route);
              if (this.onSelectRouteCallback) {
                this.onSelectRouteCallback(rid);
              }
            }
          }
          return;
        }

        const btnZoomRegion = target.closest<HTMLElement>('.btn-zoom-region, .btn-zoom-region-action');
        if (btnZoomRegion) {
          e.stopPropagation();
          const hqId = btnZoomRegion.getAttribute('data-hq-id');
          if (hqId && this.onSwitchToRegionViewCallback) {
            this.onSwitchToRegionViewCallback(hqId);
          }
          return;
        }

        const btnInspectBundledRoute = target.closest<HTMLElement>('.btn-inspect-bundled-route, .attached-route-card[data-route-id]');
        if (btnInspectBundledRoute) {
          e.stopPropagation();
          const rId = btnInspectBundledRoute.getAttribute('data-route-id');
          if (rId && this.currentSnapshot) {
            const route = this.currentSnapshot.routes[rId];
            if (route) {
              this.selectRoute(route);
              if (this.onSelectRouteCallback) {
                this.onSelectRouteCallback(rId);
              }
            }
          }
          return;
        }
      });
    }

    this.setupKeyboardShortcuts();
    this.updateSpeedUI();
  }

  public updateSpeedUI(): void {
    const isPaused = this.scheduler.isPaused();
    const currentSpeed = this.scheduler.getTimeScale();
    const spdBtns = document.querySelectorAll<HTMLButtonElement>('.spd-btn[data-speed]');
    spdBtns.forEach((b) => {
      const spdVal = parseFloat(b.getAttribute('data-speed') || '1');
      if (isPaused) {
        b.classList.toggle('active', spdVal === 0);
      } else {
        b.classList.toggle('active', spdVal === currentSpeed);
      }
    });

    const pauseIndicator = document.getElementById('hud-pause-indicator');
    if (pauseIndicator) {
      pauseIndicator.style.display = isPaused ? 'inline-flex' : 'none';
    }
  }

  public togglePause(): void {
    this.scheduler.togglePause();
    this.updateSpeedUI();
  }

  public setActiveTab(tab: 'world' | 'events' | 'god'): void {
    this.activeTab = tab;

    const tabBtns = document.querySelectorAll<HTMLButtonElement>('.hud-tab[data-tab]');
    tabBtns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tab));

    const leftPanel = document.querySelector<HTMLElement>('.hud-left-panel');
    const inspector = document.querySelector<HTMLElement>('#hud-inspector');

    if (tab === 'world') {
      this.eventLogView.hide();
      this.godModeView.hide();
      if (leftPanel) leftPanel.style.display = 'flex';
      if (inspector && this.selectedEntityType) {
        inspector.classList.remove('collapsed');
      }
    } else if (tab === 'events') {
      if (leftPanel) leftPanel.style.display = 'none';
      if (inspector) inspector.classList.add('collapsed');
      this.godModeView.hide();
      this.eventLogView.show();
    } else if (tab === 'god') {
      if (leftPanel) leftPanel.style.display = 'none';
      if (inspector) inspector.classList.add('collapsed');
      this.eventLogView.hide();
      this.godModeView.show();
    }
  }

  private updateEventBadge(unread: number): void {
    const badge = document.getElementById('tab-events-badge');
    if (badge) {
      if (unread > 0) {
        badge.textContent = `${unread > 99 ? '99+' : unread}`;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  private setupKeyboardShortcuts(): void {
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }

        if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          e.stopPropagation();
          if (document.activeElement && document.activeElement !== document.body) {
            (document.activeElement as HTMLElement).blur();
          }
          this.togglePause();
          return;
        }

        if (e.key === '1') {
          this.scheduler.setTimeScale(1);
          this.updateSpeedUI();
        } else if (e.key === '2') {
          this.scheduler.setTimeScale(5);
          this.updateSpeedUI();
        } else if (e.key === '3') {
          this.scheduler.setTimeScale(20);
          this.updateSpeedUI();
        } else if (e.key === 's' || e.key === 'S') {
          this.scheduler.step();
        } else if (e.key === 'm' || e.key === 'M') {
          this.setActiveTab('world');
        } else if (e.key === 'l' || e.key === 'L') {
          this.setActiveTab('events');
        } else if (e.key === 'g' || e.key === 'G') {
          this.setActiveTab('god');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const next = this.activeTab === 'world' ? 'events' : this.activeTab === 'events' ? 'god' : 'world';
          this.setActiveTab(next);
        }
      },
      { capture: true }
    );
  }

  private update(snapshot: WorldSnapshot) {
    // Propagate to full-screen tab views
    this.eventLogView.update(snapshot);
    this.godModeView.update(snapshot);

    // Top Bar Stats (Ticks only)
    const tickEl = document.getElementById('hud-tick');
    if (tickEl) tickEl.textContent = `${snapshot.tick}`;

    const seedEl = document.getElementById('hud-seed');
    if (seedEl) seedEl.textContent = `${snapshot.seed}`;

    const migrantsEl = document.getElementById('m-migrants');
    const routesEl = document.getElementById('m-routes');
    const voyagesEl = document.getElementById('m-voyages');
    const succEl = document.getElementById('m-success');
    const disrEl = document.getElementById('m-disrupted');

    const arrivedCount = Object.values(snapshot.migrants).filter((c) => c.status === 'ARRIVED').length;
    if (migrantsEl) migrantsEl.textContent = `${snapshot.stats.activeMigrants}`;
    if (routesEl) routesEl.textContent = `${snapshot.stats.totalActiveRoutes}`;
    if (voyagesEl) voyagesEl.textContent = `${Object.values(snapshot.voyages).filter((v) => v.status === 'IN_PROGRESS').length}`;
    if (succEl) succEl.textContent = `${arrivedCount}`;
    if (disrEl) disrEl.textContent = `${snapshot.stats.totalVoyagesDisrupted}`;

    // Render Gangs Legend (efficiently updates existing DOM cards)
    this.renderGangsLegend(snapshot);

    // Render Event Feed
    this.renderEventFeed(snapshot);

    // Update Inspector if open
    if (this.selectedEntityType && this.selectedEntityId) {
      this.renderInspector();
    }
  }

  private updateSelectionBar() {
    const statusEl = document.getElementById('gang-sel-status');
    if (!statusEl) return;

    if (this.selectedGangIds.size === 0) {
      statusEl.textContent = 'All gang assets hidden. Click gangs to reveal routes & ops:';
    } else if (this.selectedGangIds.size === 1) {
      const gId = Array.from(this.selectedGangIds)[0];
      const gang = this.currentSnapshot?.gangs[gId];
      statusEl.innerHTML = `Viewing <b style="color: ${gang?.color || '#fff'}">${gang?.name || 'Gang'}</b> assets`;
    } else {
      statusEl.innerHTML = `Viewing <b>${this.selectedGangIds.size} Gangs</b> simultaneously`;
    }
  }

  private renderGangsLegend(snapshot: WorldSnapshot) {
    const list = document.getElementById('gangs-legend');
    if (!list) return;

    for (const gang of Object.values(snapshot.gangs)) {
      const isSelected = this.selectedGangIds.has(gang.id);
      const hqLoc = snapshot.locations[gang.hqLocationId];
      const activeRoutes = Object.values(snapshot.routes).filter((r) => r.gangId === gang.id && r.status === 'ACTIVE').length;

      let card = this.gangCardElements.get(gang.id);
      if (!card) {
        card = document.createElement('div');
        card.id = `gang-card-${gang.id}`;
        card.className = 'gang-card';
        card.style.borderLeftColor = gang.color;

        card.innerHTML = `
          <div class="gang-card-top">
            <div class="gang-title" style="color: ${gang.color}">
              <span>${gang.emblem}</span> ${gang.name}
            </div>
            <span class="gang-badge" id="badge-${gang.id}"></span>
          </div>
          <div class="gang-stats-grid">
            <div>HQ: <b id="hq-${gang.id}">${hqLoc?.name || 'HQ'}</b></div>
            <div>CASH: <b id="cash-${gang.id}">$${gang.cash}</b></div>
            <div>REP: <b id="rep-${gang.id}">${gang.reputation}/100</b></div>
            <div>ROUTES: <b id="routes-${gang.id}">${activeRoutes} Cross-Border</b></div>
          </div>
        `;

        // Attach persistent click listener once!
        card.addEventListener('click', () => {
          this.toggleGang(gang.id);
          const targetLocId = gang.mainHqLocationId || gang.hqLocationId;
          if (this.onFocusLocation && targetLocId) {
            this.onFocusLocation(targetLocId);
          }
        });

        list.appendChild(card);
        this.gangCardElements.set(gang.id, card);
      }

      // Update classes & visual state without wiping innerHTML
      card.className = `gang-card ${isSelected ? 'active-selected' : ''} ${gang.status === 'BANKRUPT' ? 'bankrupt' : ''}`;
      if (isSelected) {
        card.style.borderColor = gang.color;
        card.style.boxShadow = `0 0 12px ${gang.color}44`;
      } else {
        card.style.borderColor = '';
        card.style.boxShadow = '';
      }

      const badgeEl = card.querySelector(`#badge-${gang.id}`) as HTMLElement;
      if (badgeEl) {
        badgeEl.style.background = `${gang.color}22`;
        badgeEl.style.color = gang.color;
        badgeEl.textContent = isSelected ? 'VIEWING' : (gang.status === 'BANKRUPT' ? 'BANKRUPT' : 'HIDDEN');
      }

      const cashEl = card.querySelector(`#cash-${gang.id}`);
      if (cashEl) {
        cashEl.className = gang.cash < 0 ? 'text-red' : 'text-green';
        cashEl.textContent = `$${gang.cash}`;
      }

      const repEl = card.querySelector(`#rep-${gang.id}`);
      if (repEl) repEl.textContent = `${gang.reputation}/100`;

      const routesEl = card.querySelector(`#routes-${gang.id}`);
      if (routesEl) routesEl.textContent = `${activeRoutes} Cross-Border`;
    }

    this.updateSelectionBar();
  }

  private renderEventFeed(snapshot: WorldSnapshot) {
    const feed = document.getElementById('event-feed');
    if (!feed) return;

    const events = snapshot.events.slice(0, 30);
    const firstEvt = events[0];
    const firstTick = firstEvt ? firstEvt.tick : -1;

    // Skip DOM recreation if no new events arrived
    if (events.length === this.lastEventCount && firstTick === this.lastEventFirstTick) {
      return;
    }

    this.lastEventCount = events.length;
    this.lastEventFirstTick = firstTick;

    const wasScrolledToTop = feed.scrollTop === 0;

    feed.innerHTML = '';
    for (const evt of events) {
      const item = document.createElement('div');
      item.className = `event-item imp-${evt.importance.toLowerCase()}`;
      item.innerHTML = `
        <span class="evt-tick">[Tick ${evt.tick}]</span>
        <span class="evt-desc">${evt.description}</span>
      `;
      feed.appendChild(item);
    }

    if (wasScrolledToTop) {
      feed.scrollTop = 0;
    }
  }

  private renderInspector() {
    const card = document.getElementById('hud-inspector');
    const title = document.getElementById('insp-header-title');
    const content = document.getElementById('insp-content');
    if (!card || !title || !content || !this.currentSnapshot) return;

    if (!this.selectedEntityType || !this.selectedEntityId) {
      card.classList.add('collapsed');
      this.lastInspectorKey = null;
      return;
    }

    let stateKey = '';
    if (this.selectedEntityType === 'GANG') {
      const g = this.currentSnapshot.gangs[this.selectedEntityId];
      if (g) {
        stateKey = `:${g.discoveredNodeIds?.length || 0}:${g.discoveredRouteIds?.length || 0}:${Object.values(this.currentSnapshot.hoods || {}).filter(h => h.gangId === g.id).length}`;
      }
    } else if (this.selectedEntityType === 'LOCATION') {
      const l = this.currentSnapshot.locations[this.selectedEntityId];
      if (l) {
        const migrantsAtLoc = Object.values(this.currentSnapshot.migrants).filter(
          (c) => c.originId === l.id
        );
        const sig = migrantsAtLoc.map((m) => `${m.id}:${m.status}:${m.happiness}:${m.destinationReached}:${m.goalFulfilled}`).join(';');
        stateKey = `:${l.operationalStatus}:${l.gangId}:${l.assignedHoodId || 'none'}:${l.lockdown ? 1 : 0}:${l.reputation ?? 50}:${this.prospectSortMode}:${sig}`;
      }
    } else if (this.selectedEntityType === 'VOYAGE') {
      const v = this.currentSnapshot.voyages[this.selectedEntityId];
      if (v) {
        stateKey = `:${v.passengerIds.join(',')}:${v.status}`;
      }
    } else if (this.selectedEntityType === 'MIGRANT') {
      const m = this.currentSnapshot.migrants[this.selectedEntityId];
      if (m) {
        stateKey = `:${m.status}:${m.happiness}:${m.destinationReached}:${m.goalFulfilled}:${m.originId || ''}`;
      }
    } else if (this.selectedEntityType === 'CORRIDOR_BUNDLE') {
      const b = this.selectedCorridorBundle;
      if (b) {
        stateKey = `:${b.routes.length}:${b.totalActiveVoyages}:${b.totalDelivered}:${b.totalRevenue}`;
      }
    }

    const currentKey = `${this.selectedEntityType}:${this.selectedEntityId}${stateKey}`;

    card.classList.remove('collapsed');

    // Only rebuild DOM template structure when the selected entity or operational state changes
    if (this.lastInspectorKey !== currentKey) {
      this.lastInspectorKey = currentKey;
      this.buildInspectorStructure(title, content);
    }

    // Always update dynamic values in-place without destroying DOM elements or listeners
    this.updateInspectorValues(content);
  }

  private buildInspectorStructure(title: HTMLElement, content: HTMLElement) {
    if (this.selectedEntityType === 'MIGRANT') {
      const migrant = this.currentSnapshot.migrants[this.selectedEntityId!];
      if (!migrant) return;

      title.textContent = `MIGRANT INSPECTOR`;
      const origin = this.currentSnapshot.locations[migrant.originId];
      const gang = migrant.recruitedByGangId ? this.currentSnapshot.gangs[migrant.recruitedByGangId] : null;
      const originRecruiter = migrant.originRecruiterId ? this.currentSnapshot.locations[migrant.originRecruiterId] : origin;
      const destLoc = migrant.destinationId ? this.currentSnapshot.locations[migrant.destinationId] : null;
      const destName = destLoc ? `${destLoc.name} (${destLoc.region})` : (migrant.destinationRegion || migrant.desiredRegion || 'Europe');
      const happiness = migrant.happiness ?? 50;
      const happyColor = happiness >= 70 ? '#10b981' : happiness >= 40 ? '#f59e0b' : '#ef4444';

      content.innerHTML = `
        <div class="inspector-migrant-hero">
          <div class="migrant-avatar-box">
            ${MigrantRenderer.generateSvg(migrant, 95)}
          </div>
          <div class="migrant-hero-info">
            <h3>${migrant.name}</h3>
            <span class="status-pill status-${migrant.status.toLowerCase()}" id="insp-migrant-status">${migrant.status}</span>
            <div class="hero-sub">Upfront Offer: <b class="text-green" id="insp-migrant-offer">$${migrant.offer ?? migrant.cash ?? 0}</b></div>
            <div class="hero-sub">Patience: <b id="insp-migrant-patience">${migrant.patienceRemainingTicks} ticks</b></div>
          </div>
        </div>

        <div class="migrant-happiness-bar-card">
          <div class="happiness-header">
            <span>HAPPINESS STAT</span>
            <b id="insp-migrant-happiness" style="color: ${happyColor};">${happiness} / 100</b>
          </div>
          <div class="happiness-bar-track">
            <div class="happiness-bar-fill" style="width: ${happiness}%; background: ${happyColor};"></div>
          </div>
        </div>

        <div class="insp-grid">
          <div class="insp-row">
            <span class="lbl">FINAL DESTINATION</span>
            <span class="val highlight">${destName} ${migrant.destinationReached ? '<span class="dest-badge reached">🏁 Reached</span>' : '<span class="dest-badge enroute">➡️ En Route</span>'}</span>
          </div>
          <div class="insp-row">
            <span class="lbl">LIFE GOAL</span>
            <span class="val"><span class="goal-tag goal-${(migrant.goal || 'leave').toLowerCase()}">${migrant.goal || 'LEAVE'}</span> ${migrant.goalFulfilled ? '<span class="fulfilled-badge">✅ Fulfilled</span>' : '<span class="pending-badge">⏳ Pending</span>'}</span>
          </div>
          <div class="insp-row">
            <span class="lbl">ORIGIN RECRUITER</span>
            <span class="val">${originRecruiter?.name || 'Recruiter'} (★ ${originRecruiter?.reputation ?? 50}/100)</span>
          </div>
          <div class="insp-row">
            <span class="lbl">CURRENT LOCATION</span>
            <span class="val" id="insp-migrant-node">${origin?.name || 'In Transit'} (${origin?.region || 'Europe'})</span>
          </div>
          <div class="insp-row">
            <span class="lbl">RESPONSIBLE GANG</span>
            <span class="val" id="insp-migrant-gang" style="color: ${gang ? gang.color : '#94a3b8'}">
              ${gang ? `${gang.emblem} ${gang.name}` : 'Independent'}
            </span>
          </div>
          <div class="insp-row">
            <span class="lbl">ASSIGNED ROUTE</span>
            <span class="val" id="insp-migrant-route">${migrant.assignedRouteId || 'None yet'}</span>
          </div>
        </div>

        <div class="insp-subhead">MIGRATION HISTORY</div>
        <div class="history-list" id="insp-migrant-history">
          ${migrant.history.map((h) => `<div class="history-item">${h}</div>`).join('')}
        </div>
      `;
    } else if (this.selectedEntityType === 'GANG') {
      const gang = this.currentSnapshot.gangs[this.selectedEntityId!];
      if (!gang) return;

      title.textContent = `GANG DOSSIER`;
      const hqs = (gang.hqLocationIds || [gang.hqLocationId])
        .map((id) => this.currentSnapshot.locations[id])
        .filter(Boolean);
      const ws = gang.workshopLocationId ? this.currentSnapshot.locations[gang.workshopLocationId] : null;
      const routes = Object.values(this.currentSnapshot.routes).filter((r) => r.gangId === gang.id);

      const recruiters = (gang.recruiterLocationIds || []).map((id) => this.currentSnapshot.locations[id]?.name).filter(Boolean);
      const depots = (gang.depotLocationIds || []).map((id) => this.currentSnapshot.locations[id]?.name).filter(Boolean);
      const gangHoods = Object.values(this.currentSnapshot.hoods || {}).filter((h) => h.gangId === gang.id);
      const wageBill = gang.wageBillTotal ?? (gangHoods.length * 15);

      const candidateNodes = (gang.discoveredNodeIds || [])
        .map((id) => this.currentSnapshot.locations[id])
        .filter((l) => l && (l.operationalStatus === 'DISCOVERED_CANDIDATE' || l.gangId === 'NEUTRAL' || !l.gangId));

      const discoveredCorridors = (gang.discoveredRouteIds || [])
        .map((routeKey) => {
          const parts = routeKey.split('__');
          const src = this.currentSnapshot.locations[parts[1]];
          const tgt = this.currentSnapshot.locations[parts[2]];
          return { key: routeKey, src, tgt };
        })
        .filter((item) => item.src && item.tgt);
      const uncharteredCorridors = discoveredCorridors.filter((item) => {
        return !Object.values(this.currentSnapshot.routes).some(
          (r) => r.gangId === gang.id && r.sourceId === item.src.id && r.targetId === item.tgt.id
        );
      });

      const candidateRoutes = (gang.discoveredCandidateRoutes && gang.discoveredCandidateRoutes.length > 0)
        ? gang.discoveredCandidateRoutes.map((cr) => ({
            key: cr.id,
            src: this.currentSnapshot.locations[cr.sourceId],
            tgt: this.currentSnapshot.locations[cr.targetId],
            cost: cr.charterCost,
            expiresAtTick: cr.expiresAtTick,
          })).filter((item) => item.src && item.tgt)
        : uncharteredCorridors.map((c) => ({
            key: c.key,
            src: c.src,
            tgt: c.tgt,
            cost: 1200,
            expiresAtTick: undefined as number | undefined,
          }));

      content.innerHTML = `
        <div class="gang-header-banner" style="border-left: 4px solid ${gang.color}">
          <h2 style="color: ${gang.color}">${gang.emblem} ${gang.name}</h2>
          <span class="status-pill status-${gang.status.toLowerCase()}" id="insp-gang-status">${gang.status}</span>
        </div>

        <div class="insp-grid">
          <div class="insp-row">
            <span class="lbl">REGIONAL HQS</span>
            <span class="val" id="insp-gang-hqs" style="font-size: 11px; line-height: 1.4;">
              ${hqs.map((h) => `• ${h.name} (${h.region})${h.isMainHq ? ' ⭐' : ''}`).join('<br>')}
            </span>
          </div>
          <div class="insp-row"><span class="lbl">WORKSHOP</span><span class="val">${ws?.name || 'Workshop'}</span></div>
          <div class="insp-row"><span class="lbl">RECRUITERS</span><span class="val" id="insp-gang-rec-list">${recruiters.join(', ') || 'None'}</span></div>
          <div class="insp-row"><span class="lbl">DEPOTS</span><span class="val" id="insp-gang-dep-list">${depots.join(', ') || 'None'}</span></div>
          <div class="insp-row"><span class="lbl">TREASURY</span><span class="val" id="insp-gang-cash">$${gang.cash}</span></div>
          <div class="insp-row"><span class="lbl">PAYROLL WAGES</span><span class="val text-amber" id="insp-gang-payroll">$${wageBill} / cycle (60 ticks)</span></div>
          <div class="insp-row"><span class="lbl">REPUTATION</span><span class="val" id="insp-gang-rep">${gang.reputation} / 100</span></div>
          <div class="insp-row"><span class="lbl">TOTAL RECRUITS</span><span class="val" id="insp-gang-recruits">${gang.stats.recruitsTotal} Migrants</span></div>
          <div class="insp-row"><span class="lbl">SUCCESSFUL VOYAGES</span><span class="val text-green" id="insp-gang-succ">${gang.stats.voyagesSuccessful}</span></div>
          <div class="insp-row"><span class="lbl">DISRUPTED VOYAGES</span><span class="val text-red" id="insp-gang-disr">${gang.stats.voyagesDisrupted}</span></div>
          <div class="insp-row"><span class="lbl">ACTIVE ROUTES</span><span class="val" id="insp-gang-routes">${routes.filter((r) => r.status === 'ACTIVE').length}</span></div>
        </div>

        <div class="insp-subhead">SCOUTING OPERATIONS</div>
        <div class="scout-actions-bar" style="display: flex; gap: 5px; margin: 6px 0; flex-wrap: wrap;">
          <button class="btn-scout-area" data-gang-id="${gang.id}" data-region="AFRICA" style="flex: 1; min-width: 90px; background: #c2410c; color: #fff; padding: 7px 6px; border-radius: 4px; border: none; cursor: pointer; font-weight: bold; font-size: 11px;">
            🌍 Scout Africa
          </button>
          <button class="btn-scout-area" data-gang-id="${gang.id}" data-region="EUROPE" style="flex: 1; min-width: 90px; background: #0284c7; color: #fff; padding: 7px 6px; border-radius: 4px; border: none; cursor: pointer; font-weight: bold; font-size: 11px;">
            🇪🇺 Scout Europe
          </button>
          <button class="btn-scout-area" data-gang-id="${gang.id}" data-region="UK" style="flex: 1; min-width: 90px; background: #4f46e5; color: #fff; padding: 7px 6px; border-radius: 4px; border: none; cursor: pointer; font-weight: bold; font-size: 11px;">
            🇬🇧 Scout UK
          </button>
          <button class="btn-search-routes" data-gang-id="${gang.id}" style="flex: 1; min-width: 130px; background: #059669; color: #fff; padding: 7px 8px; border-radius: 4px; border: none; cursor: pointer; font-weight: bold; font-size: 11px;">
            🧭 Search Sea Routes
          </button>
        </div>
        <div class="build-hint" style="margin-bottom: 8px;">
          💡 Scouts can explore any region with 0% influence to discover new Regional HQ sites & establish influence across borders!
        </div>

        <div class="insp-subhead">SCOUT DISCOVERIES: CANDIDATE SITES (${candidateNodes.length})</div>
        <div class="discovery-list" id="insp-gang-candidate-nodes">
          ${candidateNodes.map((c) => {
            const cost = c.candidateCost || 1500;
            const check = canClaimCandidateNode(this.currentSnapshot, gang.id, c.id);
            const remaining = c.expiresAtTick !== undefined ? Math.max(0, c.expiresAtTick - this.currentSnapshot.tick) : null;
            const timerBadge = remaining !== null ? `<span style="color:#f59e0b;font-weight:bold;margin-left:4px;">⏳ ${remaining}t</span>` : '';
            return `
              <div class="discovery-item">
                <div class="discovery-info">
                  <div class="discovery-title">📍 ${c.name} (${c.region})</div>
                  <div class="discovery-sub">
                    ${c.kind} • Acquisition: $${cost}${timerBadge}
                    ${!check.allowed && c.kind !== 'HQ' && gang.cash >= cost ? `<span class="tag-outside-zone" style="color:#f87171;font-weight:bold;margin-left:6px;">⛔ Outside HQ Zone</span>` : ''}
                  </div>
                </div>
                <button class="btn-claim-candidate" data-gang-id="${gang.id}" data-candidate-id="${c.id}" ${check.allowed ? '' : 'disabled'} title="${check.allowed ? `Claim ${c.name}` : check.reason}">
                  Claim ($${cost})
                </button>
              </div>
            `;
          }).join('')}
          ${candidateNodes.length === 0 ? '<div class="discovery-empty">Scouts exploring... Click "Scout Area" above to charter potential sites dynamically.</div>' : ''}
        </div>

        <div class="insp-subhead">SCOUT DISCOVERIES: SEA CORRIDORS (${candidateRoutes.length})</div>
        <div class="discovery-list" id="insp-gang-candidate-routes">
          ${candidateRoutes.map((c) => {
            const cost = c.cost || 1000;
            const canAfford = gang.cash >= cost;
            const remaining = c.expiresAtTick !== undefined ? Math.max(0, c.expiresAtTick - this.currentSnapshot.tick) : null;
            const timerBadge = remaining !== null ? `<span style="color:#f59e0b;font-weight:bold;margin-left:4px;">⏳ ${remaining}t</span>` : '';
            return `
              <div class="discovery-item">
                <div class="discovery-info">
                  <div class="discovery-title">🌊 ${c.src.name} ➔ ${c.tgt.name}</div>
                  <div class="discovery-sub">Cross-Border Sea Route • Charter: $${cost}${timerBadge}</div>
                </div>
                <button class="btn-charter-route" data-gang-id="${gang.id}" data-src-id="${c.src.id}" data-tgt-id="${c.tgt.id}" ${canAfford ? '' : 'disabled'}>
                  Charter ($${cost})
                </button>
              </div>
            `;
          }).join('')}
          ${candidateRoutes.length === 0 ? '<div class="discovery-empty">No active candidate sea corridors. Click "Search Routes" to chart routes.</div>' : ''}
        </div>

        <div class="insp-subhead">PURCHASE INFRASTRUCTURE</div>
        <div class="build-controls-grid">
          <button class="btn-build-action btn-build-hq" data-gang-id="${gang.id}" data-kind="HQ" data-cost="4000">
            🏰 Buy Regional HQ <b>$4,000</b>
          </button>
          <button class="btn-build-action" data-gang-id="${gang.id}" data-kind="RECRUITER" data-cost="2500">
            🏭 Buy Recruiter <b>$2,500</b>
          </button>
          <button class="btn-build-action" data-gang-id="${gang.id}" data-kind="DEPOT" data-cost="2000">
            ⛽ Buy Depot <b>$2,000</b>
          </button>
          <button class="btn-build-action" data-gang-id="${gang.id}" data-kind="WORKSHOP" data-cost="3500">
            🔧 Buy Workshop <b>$3,500</b>
          </button>
        </div>
        <div class="build-hint">
          💡 Click button above, then click map inside HQ heat map to place node. (Right-click or ESC to cancel).
        </div>

        <div class="insp-subhead">EMPLOYED HOODS (${gangHoods.length})</div>
        <div class="hood-hire-bar">
          <button class="btn-hire-scout" data-gang-id="${gang.id}" ${gang.cash < 150 ? 'disabled' : ''}>
            🕵️ Hire Scout Hood <b>$150</b>
          </button>
        </div>
        <div class="hoods-scroll-list" id="insp-gang-hoods" style="margin-top: 8px;">
          ${gangHoods.map((h) => `
            <div class="hood-card">
              <div class="hood-card-header">
                <div class="hood-mini-avatar">${MigrantRenderer.generateSvg({ avatar: h.avatar, name: h.name }, 38)}</div>
                <div class="hood-info">
                  <div class="hood-name">${h.name}</div>
                  <span class="hood-role-tag role-${h.role.toLowerCase()}">${h.role.replace(/_/g, ' ')}</span>
                </div>
              </div>
              <div class="hood-task-box">
                <span class="hood-task-dot">●</span>
                <span class="hood-task-text" id="hood-task-${h.id}">${h.currentTaskDescription}</span>
              </div>
            </div>
          `).join('')}
          ${gangHoods.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No Hoods employed yet.</div>' : ''}
        </div>

        <div class="insp-subhead">RECENT AI DECISIONS</div>
        <div class="history-list" id="insp-gang-decisions">
          ${gang.recentDecisions.map((d) => `
            <div class="history-item">
              <b>[Tick ${d.tick}] ${d.action}:</b> ${d.reason}
            </div>
          `).join('')}
        </div>
      `;
    } else if (this.selectedEntityType === 'LOCATION') {
      const loc = this.currentSnapshot.locations[this.selectedEntityId!];
      if (!loc) return;

      title.textContent = `LOCATION DOSSIER`;
      const isCandidate = loc.operationalStatus === 'DISCOVERED_CANDIDATE' || loc.gangId === 'NEUTRAL' || !loc.gangId;
      const isUnstaffed = !isCandidate && (loc.operationalStatus === 'UNSTAFFED' || !loc.assignedHoodId);

      const prospectsList = Object.values(this.currentSnapshot.migrants).filter(
        (c) => c.originId === loc.id && (c.status === 'PROSPECT' || c.status === 'WAITING')
      );
      const sortedProspects = [...prospectsList].sort((a, b) => {
        if (this.prospectSortMode === 'offer') {
          return (b.offer ?? b.cash ?? 0) - (a.offer ?? a.cash ?? 0);
        }
        if (this.prospectSortMode === 'expiry') {
          const aExp = a.prospectExpiresTick ?? Infinity;
          const bExp = b.prospectExpiresTick ?? Infinity;
          return aExp - bExp;
        }
        if (this.prospectSortMode === 'happiness') {
          return (b.happiness ?? 50) - (a.happiness ?? 50);
        }
        if (this.prospectSortMode === 'goal') {
          return (a.goal || '').localeCompare(b.goal || '');
        }
        return 0;
      });

      const recruitedMigrants = Object.values(this.currentSnapshot.migrants).filter(
        (c) => c.originId === loc.id && c.status === 'RECRUITED'
      );

      const depotOccupants = Object.values(this.currentSnapshot.migrants).filter(
        (c) => c.originId === loc.id && (c.status === 'ARRIVED' || c.status === 'AT_DEPOT')
      );

      const stationedWorkers = Object.values(this.currentSnapshot.migrants).filter(
        (c) => c.originId === loc.id && (c.status === 'ASSIGNED' || c.status === 'ARRIVED')
      );

      const outgoingRoutes = Object.values(this.currentSnapshot.routes).filter(
        (r) => r.sourceId === loc.id
      );
      const incomingRoutes = Object.values(this.currentSnapshot.routes).filter(
        (r) => r.targetId === loc.id
      );
      const allAttachedRoutes = [...outgoingRoutes, ...incomingRoutes];

      // Attached Candidate Sea Corridors (discovered by scouts)
      const attachedCandidateRoutes: Array<{
        route: CandidateRouteOpportunity;
        gang: GangState;
        isOutgoing: boolean;
        otherLoc: LocationDef | undefined;
      }> = [];
      for (const g of Object.values(this.currentSnapshot.gangs)) {
        if (g.status === 'ACTIVE' && g.discoveredCandidateRoutes) {
          for (const cr of g.discoveredCandidateRoutes) {
            if (cr.sourceId === loc.id) {
              attachedCandidateRoutes.push({
                route: cr,
                gang: g,
                isOutgoing: true,
                otherLoc: this.currentSnapshot.locations[cr.targetId],
              });
            } else if (cr.targetId === loc.id) {
              attachedCandidateRoutes.push({
                route: cr,
                gang: g,
                isOutgoing: false,
                otherLoc: this.currentSnapshot.locations[cr.sourceId],
              });
            }
          }
        }
      }

      const gang = (loc.gangId && loc.gangId !== 'NEUTRAL') ? this.currentSnapshot.gangs[loc.gangId] : null;
      const gangHoods = gang
        ? Object.values(this.currentSnapshot.hoods || {}).filter((h) => h.gangId === gang.id)
        : [];
      const assignedHood = loc.assignedHoodId ? this.currentSnapshot.hoods[loc.assignedHoodId] : null;

      const effectiveHeat = gang ? getEffectiveInfluenceHeat(this.currentSnapshot, gang.id, loc.x, loc.y) : 0;
      const heatPct = Math.round(effectiveHeat * 100);
      const multiplier = getNodeHeatMultiplier(effectiveHeat);
      const synergy = gang ? getHqSynergyInfo(this.currentSnapshot, gang.id, loc.x, loc.y) : null;

      const candidateCost = loc.candidateCost || 1500;
      const discoveringGangs = isCandidate
        ? Object.values(this.currentSnapshot.gangs).filter(
            (g) => g.status === 'ACTIVE' && (
              (g.discoveredNodeIds || []).includes(loc.id) ||
              loc.discoveredByGangId === g.id ||
              this.selectedGangIds.has(g.id)
            )
          )
        : [];

      content.innerHTML = `
        <div class="location-banner">
          <h2>${loc.name}</h2>
          <span class="region-pill">Region ${loc.region} • ${loc.kind} (${loc.tileFamily})</span>
        </div>

        ${loc.kind === 'HQ' ? `
          <button class="btn-zoom-region-action" data-hq-id="${loc.id}" style="width: 100%; margin: 8px 0 12px 0; padding: 8px 12px; background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.6); color: #38bdf8; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: bold; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease;">
            <span>📍</span>
            <span>CENTER ON ${loc.name.toUpperCase()} (REGION VIEW)</span>
          </button>
        ` : ''}

        ${isCandidate ? `
          <div class="candidate-banner">
            <div class="candidate-title">🔍 UNCLAIMED CANDIDATE SITE</div>
            <div class="candidate-sub">Scouted node ready to be claimed and staffed by a syndicate.</div>
          </div>
        ` : ''}

        ${isUnstaffed ? `
          <div class="unstaffed-alert">
            <span class="alert-icon">⚠️</span>
            <div class="alert-text">
              <b>UNSTAFFED ASSET</b><br>
              Operations halted. Requires an assigned Hood to manage throughput.
            </div>
          </div>
        ` : ''}

        <div class="insp-grid">
          ${gang ? `<div class="insp-row"><span class="lbl">OWNING GANG</span><span class="val" style="color: ${gang.color}">${gang.emblem} ${gang.name}</span></div>` : ''}
          ${isCandidate ? `<div class="insp-row"><span class="lbl">ACQUISITION COST</span><span class="val text-green">$${candidateCost}</span></div>` : ''}
          <div class="insp-row"><span class="lbl">INFLUENCE HEAT</span><span class="val highlight" id="insp-loc-heat">${heatPct}% (${multiplier}x Stats Multiplier)</span></div>
          ${synergy && synergy.isSynergized ? `
            <div class="insp-row"><span class="lbl">DUAL HQ SYNERGY</span><span class="val text-green" style="font-weight: bold;">⚡ Reinforced (+${synergy.contributingHqCount} HQs)</span></div>
          ` : ''}
          ${loc.kind === 'HQ' ? `
            <div class="insp-row"><span class="lbl">HQ STATUS</span><span class="val highlight">${loc.isMainHq ? '⭐ Primary Gang HQ (Holds Reserves)' : 'Regional Command Post'}</span></div>
            <div class="insp-row"><span class="lbl">INFLUENCE ZONE</span><span class="val highlight">${Math.round(loc.influenceRadius || 650)}px Radius (Expanding)</span></div>
          ` : ''}
          ${assignedHood ? `
            <div class="insp-row"><span class="lbl">MANAGING HOOD</span><span class="val highlight">${assignedHood.name}</span></div>
            <div class="insp-row"><span class="lbl">DUTY</span><span class="val" style="font-size: 10px; color: #cbd5e1;">${assignedHood.role.replace(/_/g, ' ')}</span></div>
          ` : ''}
          ${loc.kind === 'RECRUITER' ? `
            <div class="insp-row"><span class="lbl">PROSPECTS MARKET</span><span class="val highlight" id="insp-loc-waiting">${prospectsList.length}</span></div>
            <div class="insp-row"><span class="lbl">RECRUITED AWAITING</span><span class="val text-green">${recruitedMigrants.length}</span></div>
            <div class="insp-row"><span class="lbl">OUTGOING ROUTES</span><span class="val" id="insp-loc-out">${outgoingRoutes.length}</span></div>
          ` : ''}
          ${loc.kind === 'DEPOT' ? `
            <div class="insp-row"><span class="lbl">MIGRANTS IN DEPOT</span><span class="val text-green" id="insp-loc-depot">${depotOccupants.length}</span></div>
            <div class="insp-row"><span class="lbl">INCOMING ROUTES</span><span class="val" id="insp-loc-in">${incomingRoutes.length}</span></div>
            <div class="insp-row"><span class="lbl">OUTGOING ROUTES</span><span class="val" id="insp-loc-out">${outgoingRoutes.length}</span></div>
          ` : ''}
          ${(loc.kind === 'WORKSHOP' || loc.kind === 'CRIMINAL_ENTERPRISE') ? `
            <div class="insp-row"><span class="lbl">ASSIGNED WORKERS</span><span class="val text-amber" id="insp-loc-ws">${stationedWorkers.length}</span></div>
            <div class="insp-row"><span class="lbl">INCOMING ROUTES</span><span class="val" id="insp-loc-in">${incomingRoutes.length}</span></div>
          ` : ''}
        </div>

        <div class="insp-subhead" style="display: flex; justify-content: space-between; align-items: center;">
          <span>ATTACHED ROUTES (${allAttachedRoutes.length})</span>
          ${allAttachedRoutes.length > 0 ? '<span style="font-size: 10px; color: var(--text-dim); font-weight: normal; text-transform: none;">Click route to inspect</span>' : ''}
        </div>
        <div class="attached-routes-list" id="insp-attached-routes">
          ${allAttachedRoutes.map((r) => {
            const isOutgoing = r.sourceId === loc.id;
            const otherLocId = isOutgoing ? r.targetId : r.sourceId;
            const otherLoc = this.currentSnapshot.locations[otherLocId];
            const otherName = otherLoc ? otherLoc.name : otherLocId;
            const otherRegion = otherLoc ? otherLoc.region : '';
            const rGang = this.currentSnapshot.gangs[r.gangId];
            const skipper = r.assignedSkipperHoodId ? this.currentSnapshot.hoods[r.assignedSkipperHoodId] : null;
            const isBoat = r.mode === 'BOAT';
            const modeIcon = isBoat ? '🚤' : '🚐';
            const modeName = isBoat ? (r.isCrossBorder ? 'Sea Corridor' : 'Boat Route') : 'Overland Van';

            return `
              <div class="attached-route-card route-row-item" data-route-id="${r.id}" style="border-left: 3px solid ${rGang?.color || '#38bdf8'}; cursor: pointer;">
                <div class="attached-route-top">
                  <div class="route-dir-col">
                    <span class="route-dir-badge ${isOutgoing ? 'outgoing' : 'incoming'}">
                      ${isOutgoing ? '↗ OUTGOING' : '↘ INCOMING'}
                    </span>
                    <span class="route-mode-badge">${modeIcon} ${modeName}</span>
                  </div>
                  <div class="route-gang-tag" style="color: ${rGang?.color || '#38bdf8'};">
                    ${rGang ? `${rGang.emblem} ${rGang.name}` : r.gangId}
                  </div>
                </div>

                <div class="attached-route-path">
                  <span class="route-endpoint this-node">${loc.name}</span>
                  <span class="route-arrow">${isOutgoing ? '➔' : '⬅'}</span>
                  <span class="route-endpoint target-node">${otherName} <small class="target-region-pill">${otherRegion}</small></span>
                </div>

                <div class="attached-route-specs-grid">
                  <div class="route-spec-item">
                    <span class="spec-k">FARE</span>
                    <span class="spec-v text-green">$${r.price}</span>
                  </div>
                  <div class="route-spec-item">
                    <span class="spec-k">CAPACITY</span>
                    <span class="spec-v">${r.capacity}</span>
                  </div>
                  <div class="route-spec-item">
                    <span class="spec-k">DURATION</span>
                    <span class="spec-v">${r.durationTicks}t</span>
                  </div>
                  <div class="route-spec-item">
                    <span class="spec-k">RELIABILITY</span>
                    <span class="spec-v" id="route-${r.id}-rel">${Math.round(r.reliability * 100)}%</span>
                  </div>
                  <div class="route-spec-item">
                    <span class="spec-k">ACTIVE RUNS</span>
                    <span class="spec-v highlight" id="route-${r.id}-active">${r.activeVoyageCount}</span>
                  </div>
                  <div class="route-spec-item">
                    <span class="spec-k">DELIVERED</span>
                    <span class="spec-v" id="route-${r.id}-carried">${r.totalPassengers}</span>
                  </div>
                  <div class="route-spec-item">
                    <span class="spec-k">REVENUE</span>
                    <span class="spec-v text-green" id="route-${r.id}-rev">$${r.revenue}</span>
                  </div>
                  <div class="route-spec-item">
                    <span class="spec-k">SKIPPER</span>
                    <span class="spec-v" id="route-${r.id}-skipper">${skipper ? skipper.name : '<span style="color:#ef4444;">Unstaffed</span>'}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}

          ${attachedCandidateRoutes.map(({ route: cr, gang: crGang, isOutgoing, otherLoc }) => {
            const cost = cr.charterCost || 1000;
            const canAfford = crGang.cash >= cost;
            const remaining = cr.expiresAtTick !== undefined ? Math.max(0, cr.expiresAtTick - this.currentSnapshot.tick) : null;
            const timerBadge = remaining !== null ? `<span style="color:#f59e0b;font-weight:bold;margin-left:4px;">⏳ ${remaining}t</span>` : '';
            return `
              <div class="attached-route-card candidate-route-card" style="border-left: 3px dashed ${crGang.color};">
                <div class="attached-route-top">
                  <div class="route-dir-col">
                    <span class="route-dir-badge candidate">
                      🔍 CANDIDATE SEA CORRIDOR
                    </span>
                    ${timerBadge}
                  </div>
                  <div class="route-gang-tag" style="color: ${crGang.color};">
                    ${crGang.emblem} ${crGang.name}
                  </div>
                </div>
                <div class="attached-route-path">
                  <span class="route-endpoint this-node">${loc.name}</span>
                  <span class="route-arrow">${isOutgoing ? '➔' : '⬅'}</span>
                  <span class="route-endpoint target-node">${otherLoc ? otherLoc.name : (isOutgoing ? cr.targetId : cr.sourceId)} <small class="target-region-pill">${otherLoc ? otherLoc.region : ''}</small></span>
                </div>
                <div class="candidate-route-actions" style="margin-top: 6px; display: flex; justify-content: flex-end;">
                  <button class="btn-charter-route" data-gang-id="${crGang.id}" data-src-id="${cr.sourceId}" data-tgt-id="${cr.targetId}" ${canAfford ? '' : 'disabled'}>
                    Charter Sea Corridor ($${cost})
                  </button>
                </div>
              </div>
            `;
          }).join('')}

          ${allAttachedRoutes.length === 0 && attachedCandidateRoutes.length === 0 ? `
            <div class="attached-routes-empty">
              No transport routes currently connected to this node. Establish border routes from Recruiters to Depots to connect services.
            </div>
          ` : ''}
        </div>

        ${loc.kind === 'RECRUITER' ? `
          <div class="recruiter-reputation-card">
            <div class="rep-header">
              <span class="rep-label">RECRUITER REPUTATION</span>
              <span class="rep-score text-cyan">★ ${loc.reputation ?? 50} / 100</span>
            </div>
            <div class="rep-bar-track">
              <div class="rep-bar-fill" style="width: ${loc.reputation ?? 50}%;"></div>
            </div>
            <div class="rep-desc">Recruiter reputation drives prospect volume and upfront monetary offers. Outcomes impact this node permanently.</div>
          </div>

          <div class="prospects-section-header">
            <div class="insp-subhead" style="margin: 0;">PROSPECTS MARKET (${prospectsList.length})</div>
            <div class="prospect-sort-bar">
              <span class="sort-lbl">Sort:</span>
              <button class="btn-sort-prospects ${this.prospectSortMode === 'offer' ? 'active' : ''}" data-sort-mode="offer">💰 Offer</button>
              <button class="btn-sort-prospects ${this.prospectSortMode === 'expiry' ? 'active' : ''}" data-sort-mode="expiry">⏳ Expiry</button>
              <button class="btn-sort-prospects ${this.prospectSortMode === 'happiness' ? 'active' : ''}" data-sort-mode="happiness">😊 Happy</button>
              <button class="btn-sort-prospects ${this.prospectSortMode === 'goal' ? 'active' : ''}" data-sort-mode="goal">🎯 Goal</button>
            </div>
          </div>

          <div class="prospects-scroll-list">
            ${sortedProspects.map((p) => {
              const dest = p.destinationId ? this.currentSnapshot.locations[p.destinationId] : null;
              const destStr = dest ? `${dest.name}` : (p.destinationRegion || p.desiredRegion || 'Europe');
              const ticksLeft = p.prospectExpiresTick !== undefined ? Math.max(0, p.prospectExpiresTick - this.currentSnapshot.tick) : null;
              const happy = p.happiness ?? 50;
              const happyColor = happy >= 70 ? '#10b981' : happy >= 40 ? '#f59e0b' : '#ef4444';
              return `
                <div class="prospect-card-item">
                  <div class="prospect-main-row migrant-row-item" data-migrant-id="${p.id}" style="cursor: pointer;">
                    <div class="migrant-mini-avatar">${MigrantRenderer.generateSvg(p, 36)}</div>
                    <div class="prospect-info">
                      <div class="prospect-name">${p.name}</div>
                      <div class="prospect-details">
                        <span>🎯 <b class="goal-tag goal-${(p.goal || 'leave').toLowerCase()}">${p.goal || 'LEAVE'}</b></span>
                        <span>➔ <b>${destStr}</b></span>
                      </div>
                    </div>
                    <div class="prospect-offer-box">
                      <div class="prospect-offer-val text-green">$${p.offer ?? p.cash ?? 0}</div>
                      <div class="prospect-sub-stats">
                        <span style="color: ${happyColor}; font-weight: bold;">😊 ${happy}</span>
                        ${ticksLeft !== null ? `<span class="text-amber">⏳ ${ticksLeft}t</span>` : ''}
                      </div>
                    </div>
                  </div>
                  <div class="prospect-actions-row">
                    <button class="btn-accept-prospect" data-recruiter-id="${loc.id}" data-migrant-id="${p.id}">
                      Accept Prospect ($${p.offer ?? p.cash ?? 0})
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
            ${sortedProspects.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No active prospects. New prospects generate over time.</div>' : ''}
          </div>

          <div class="insp-subhead">RECRUITED MIGRANTS AWAITING VOYAGE (${recruitedMigrants.length})</div>
          <div class="migrants-scroll-list">
            ${recruitedMigrants.map((c) => {
              const dest = c.destinationId ? this.currentSnapshot.locations[c.destinationId] : null;
              const destStr = dest ? `${dest.name}` : (c.destinationRegion || c.desiredRegion || 'Europe');
              return `
                <div class="migrant-row-item" data-migrant-id="${c.id}">
                  <div class="migrant-mini-avatar">${MigrantRenderer.generateSvg(c, 36)}</div>
                  <div class="migrant-mini-info">
                    <div class="c-name">${c.name}</div>
                    <div class="c-dest">Dest: <b>${destStr}</b> • Goal: <b>${c.goal || 'LEAVE'}</b></div>
                  </div>
                  <span class="c-status" style="background:#a855f722;color:#c084fc">RECRUITED</span>
                </div>
              `;
            }).join('')}
            ${recruitedMigrants.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No recruited migrants waiting for transport.</div>' : ''}
          </div>
        ` : ''}

        ${loc.kind === 'DEPOT' ? `
          <div class="lockdown-panel">
            <button class="btn-toggle-lockdown ${loc.lockdown ? 'locked' : 'unlocked'}" data-location-id="${loc.id}">
              ${loc.lockdown ? '🔒 LOCKDOWN: ACTIVE' : '🔓 LOCKDOWN: OFF'}
            </button>
            <div class="lockdown-desc">
              ${loc.lockdown
                ? '⚠️ Lockdown active: Voluntary departures blocked. Occupants suffer periodic happiness decay.'
                : 'Free status: Normal syndicate operations and voluntary departures permitted.'}
            </div>
          </div>

          <div class="insp-subhead">DEPOT OCCUPANTS (${depotOccupants.length})</div>
          <div class="depot-occupants-list">
            ${depotOccupants.map((m) => {
              const dest = m.destinationId ? this.currentSnapshot.locations[m.destinationId] : null;
              const destStr = dest ? `${dest.name}` : (m.destinationRegion || m.desiredRegion || 'Europe');
              const happy = m.happiness ?? 50;
              const happyColor = happy >= 70 ? '#10b981' : happy >= 40 ? '#f59e0b' : '#ef4444';
              return `
                <div class="depot-occupant-card">
                  <div class="occupant-main-row migrant-row-item" data-migrant-id="${m.id}" style="cursor: pointer; flex: 1;">
                    <div class="migrant-mini-avatar">${MigrantRenderer.generateSvg(m, 36)}</div>
                    <div class="occupant-info">
                      <div class="c-name">${m.name}</div>
                      <div class="occupant-journey-line">
                        <span>➔ <b>${destStr}</b> ${m.destinationReached ? '<span class="dest-badge reached">🏁 Reached</span>' : '<span class="dest-badge enroute">➡️ En Route</span>'}</span>
                      </div>
                      <div class="occupant-goal-line">
                        <span>🎯 <b class="goal-tag goal-${(m.goal || 'leave').toLowerCase()}">${m.goal || 'LEAVE'}</b> ${m.goalFulfilled ? '<span class="fulfilled-badge">✅ Fulfilled</span>' : ''}</span>
                        <span style="color: ${happyColor}; font-weight: bold;">😊 ${happy}</span>
                      </div>
                    </div>
                  </div>
                  <div class="depot-actions-row">
                    <button class="btn-depot-action btn-depot-boot" data-depot-id="${loc.id}" data-migrant-id="${m.id}" data-action="boot" title="Boot migrant from gang control (completes LEAVE if at destination, otherwise abandonment penalty)">
                      🚪 Boot
                    </button>
                    <button class="btn-depot-action btn-depot-workshop" data-depot-id="${loc.id}" data-migrant-id="${m.id}" data-action="workshop" title="Assign to local workshop (fulfills WORK if destination reached)">
                      🔧 Workshop
                    </button>
                    <button class="btn-depot-action btn-depot-crime" data-depot-id="${loc.id}" data-migrant-id="${m.id}" data-action="crime" title="Assign to criminal enterprise (fulfills CRIME if destination reached)">
                      🦹 Crime
                    </button>
                    <button class="btn-depot-action btn-depot-forward" data-depot-id="${loc.id}" data-migrant-id="${m.id}" data-action="forward" title="Forward to recruiter for next hop (no fee)">
                      🔄 Forward
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
            ${depotOccupants.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No migrants currently in depot.</div>' : ''}
          </div>
        ` : ''}

        ${(loc.kind === 'WORKSHOP' || loc.kind === 'CRIMINAL_ENTERPRISE') ? `
          <div class="lockdown-panel">
            <button class="btn-toggle-lockdown ${loc.lockdown ? 'locked' : 'unlocked'}" data-location-id="${loc.id}">
              ${loc.lockdown ? '🔒 LOCKDOWN: ACTIVE' : '🔓 LOCKDOWN: OFF'}
            </button>
            <div class="lockdown-desc">
              ${loc.lockdown
                ? '⚠️ Lockdown active: Voluntary departures blocked. Workers suffer periodic happiness decay.'
                : 'Free status: Normal facility operations permitted.'}
            </div>
          </div>

          <div class="insp-subhead">ASSIGNED WORKFORCE (${stationedWorkers.length})</div>
          <div class="migrants-scroll-list">
            ${stationedWorkers.map((c) => {
              const happy = c.happiness ?? 50;
              const happyColor = happy >= 70 ? '#10b981' : happy >= 40 ? '#f59e0b' : '#ef4444';
              return `
                <div class="migrant-row-item" data-migrant-id="${c.id}">
                  <div class="migrant-mini-avatar">${MigrantRenderer.generateSvg(c, 36)}</div>
                  <div class="migrant-mini-info">
                    <div class="c-name">${c.name}</div>
                    <div class="c-dest">
                      Goal: <b class="goal-tag goal-${(c.goal || 'work').toLowerCase()}">${c.goal || 'WORK'}</b>
                      ${c.goalFulfilled ? '<span class="fulfilled-badge">✅ Fulfilled</span>' : ''}
                      • <span style="color: ${happyColor};">😊 ${happy}</span>
                    </div>
                  </div>
                  <span class="c-status" style="background:#f59e0b22;color:#fbbf24">ASSIGNED</span>
                </div>
              `;
            }).join('')}
            ${stationedWorkers.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No migrants currently stationed here.</div>' : ''}
          </div>
        ` : ''}

        ${isCandidate ? `
          <div class="insp-subhead">CLAIM CANDIDATE SITE ($${candidateCost})</div>
          <div class="candidate-claim-box">
            ${discoveringGangs.map((g) => {
              const check = canClaimCandidateNode(this.currentSnapshot, g.id, loc.id);
              const canAfford = g.cash >= candidateCost;
              return `
                <div class="candidate-claim-row" style="margin-bottom: 6px;">
                  <button class="btn-claim-candidate" data-gang-id="${g.id}" data-candidate-id="${loc.id}" ${check.allowed ? '' : 'disabled'} style="border-left: 3px solid ${g.color}; width: 100%;" title="${check.allowed ? `Claim ${loc.name} for ${g.name}` : check.reason}">
                    Claim for <b>${g.name}</b> ($${candidateCost})
                  </button>
                  ${!check.allowed ? `
                    <div class="candidate-claim-blocked-hint">
                      ${!canAfford ? '⚠️ Insufficient Funds' : `⛔ ${check.reason}`}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
            ${discoveringGangs.length === 0 ? '<div class="candidate-notice">Not yet scouted by any active gang syndicate.</div>' : ''}
          </div>
        ` : ''}

        ${loc.kind === 'HQ' ? `
          <div class="insp-subhead">EMPLOYED HOODS (${gangHoods.length})</div>
          <div class="hoods-scroll-list">
            ${gangHoods.map((h) => `
              <div class="hood-card">
                <div class="hood-card-header">
                  <div class="hood-mini-avatar">${MigrantRenderer.generateSvg({ avatar: h.avatar, name: h.name }, 38)}</div>
                  <div class="hood-info">
                    <div class="hood-name">${h.name}</div>
                    <span class="hood-role-tag role-${h.role.toLowerCase()}">${h.role.replace(/_/g, ' ')}</span>
                  </div>
                </div>
                <div class="hood-task-box">
                  <span class="hood-task-dot">●</span>
                  <span class="hood-task-text" id="hood-task-${h.id}">${h.currentTaskDescription}</span>
                </div>
              </div>
            `).join('')}
            ${gangHoods.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No Hoods employed yet.</div>' : ''}
          </div>
        ` : ''}
      `;
    } else if (this.selectedEntityType === 'ROUTE') {
      const route = this.currentSnapshot.routes[this.selectedEntityId!];
      if (!route) return;

      const gang = this.currentSnapshot.gangs[route.gangId];
      const src = this.currentSnapshot.locations[route.sourceId];
      const tgt = this.currentSnapshot.locations[route.targetId];
      const srcHq = src ? getClosestHqForNode(src, this.currentSnapshot) : null;
      const tgtHq = tgt ? getClosestHqForNode(tgt, this.currentSnapshot) : null;

      title.textContent = `ROUTE SERVICE`;
      content.innerHTML = `
        <div class="route-banner" style="border-left: 4px solid ${gang?.color || '#38bdf8'}">
          <h2>${src?.name} → ${tgt?.name}</h2>
          <span style="color: ${gang?.color}">${gang?.name}</span>
        </div>

        <div class="route-zoom-actions" style="display: flex; gap: 8px; margin: 8px 0 12px 0;">
          ${srcHq ? `
            <button class="btn-zoom-region" data-hq-id="${srcHq.id}" style="flex: 1; padding: 6px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 4px; color: #38bdf8; font-size: 10px; font-weight: bold; cursor: pointer;">
              📍 Zoom: ${srcHq.name}
            </button>
          ` : ''}
          ${tgtHq && tgtHq.id !== srcHq?.id ? `
            <button class="btn-zoom-region" data-hq-id="${tgtHq.id}" style="flex: 1; padding: 6px; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 4px; color: #4ade80; font-size: 10px; font-weight: bold; cursor: pointer;">
              📍 Zoom: ${tgtHq.name}
            </button>
          ` : ''}
        </div>

        <div class="insp-grid">
          <div class="insp-row"><span class="lbl">TRANSPORT MODE</span><span class="val">${route.mode}</span></div>
          <div class="insp-row"><span class="lbl">FARE PRICE</span><span class="val highlight">$${route.price}</span></div>
          <div class="insp-row"><span class="lbl">CAPACITY</span><span class="val">${route.capacity} Migrants</span></div>
          <div class="insp-row"><span class="lbl">DURATION</span><span class="val">${route.durationTicks} ticks</span></div>
          <div class="insp-row"><span class="lbl">RELIABILITY</span><span class="val" id="insp-route-rel">${Math.round(route.reliability * 100)}%</span></div>
          <div class="insp-row"><span class="lbl">TOTAL CARRIED</span><span class="val" id="insp-route-carried">${route.totalPassengers} Migrants</span></div>
          <div class="insp-row"><span class="lbl">TOTAL REVENUE</span><span class="val text-green" id="insp-route-rev">$${route.revenue}</span></div>
          <div class="insp-row"><span class="lbl">STATUS</span><span class="val" id="insp-route-status">${route.status}</span></div>
        </div>
      `;
    } else if (this.selectedEntityType === 'CORRIDOR_BUNDLE') {
      const bundle = this.selectedCorridorBundle;
      if (!bundle) return;

      const gang = this.currentSnapshot.gangs[bundle.gangId];
      const srcHq = this.currentSnapshot.locations[bundle.sourceHqId];
      const tgtHq = this.currentSnapshot.locations[bundle.targetHqId];
      if (!srcHq || !tgtHq) return;

      title.textContent = `TRUNK CORRIDOR DOSSIER`;

      const isSea = bundle.modes.includes('BOAT');
      const modeLabel = isSea ? '🚢 Cross-Border Sea Corridor' : '🚐 Regional Transit Corridor';

      content.innerHTML = `
        <div class="bundle-banner" style="border-left: 4px solid ${gang?.color || '#38bdf8'}; background: rgba(15, 23, 42, 0.7); padding: 12px; border-radius: 6px; margin-bottom: 10px;">
          <div class="bundle-banner-top" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span class="bundle-mode-tag" style="font-size: 10px; color: #38bdf8; font-family: 'JetBrains Mono', monospace; font-weight: bold;">${modeLabel}</span>
            <span class="bundle-gang-name" style="color: ${gang?.color || '#fff'}; font-weight: bold; font-size: 11px;">${gang?.emblem || '✦'} ${gang?.name || ''}</span>
          </div>
          <h2 class="bundle-title" style="font-size: 15px; font-weight: bold; color: #fff; margin: 4px 0;">${srcHq.name} ➔ ${tgtHq.name}</h2>
          <div class="bundle-sub" style="font-size: 11px; color: #94a3b8;">Strategic Trunk Line bundling ${bundle.routes.length} route ${bundle.routes.length === 1 ? 'service' : 'services'} between influence zones.</div>
        </div>

        <div class="corridor-zoom-actions" style="display: flex; gap: 8px; margin: 8px 0 12px 0;">
          <button class="btn-zoom-region" data-hq-id="${srcHq.id}" style="flex: 1; padding: 7px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 6px; color: #38bdf8; font-weight: bold; cursor: pointer; font-size: 11px;">
            📍 Zoom: ${srcHq.name}
          </button>
          <button class="btn-zoom-region" data-hq-id="${tgtHq.id}" style="flex: 1; padding: 7px; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 6px; color: #4ade80; font-weight: bold; cursor: pointer; font-size: 11px;">
            📍 Zoom: ${tgtHq.name}
          </button>
        </div>

        <div class="insp-grid">
          <div class="insp-row">
            <span class="lbl">BUNDLED ROUTES</span>
            <span class="val highlight">${bundle.routes.length} Corridors</span>
          </div>
          <div class="insp-row">
            <span class="lbl">ACTIVE VOYAGES</span>
            <span class="val highlight" id="insp-bundle-voyages">${bundle.totalActiveVoyages} Vehicles</span>
          </div>
          <div class="insp-row">
            <span class="lbl">TOTAL DELIVERED</span>
            <span class="val text-green" id="insp-bundle-delivered">${bundle.totalDelivered} Migrants</span>
          </div>
          <div class="insp-row">
            <span class="lbl">COMBINED REVENUE</span>
            <span class="val text-green" id="insp-bundle-revenue">$${bundle.totalRevenue}</span>
          </div>
        </div>

        <div class="insp-subhead" style="margin-top: 14px;">BUNDLED ROUTE SERVICES (${bundle.routes.length})</div>
        <div class="attached-routes-list" style="margin-top: 6px;">
          ${bundle.routes.map((r) => {
            const rSrc = this.currentSnapshot.locations[r.sourceId];
            const rTgt = this.currentSnapshot.locations[r.targetId];
            const skipper = r.assignedSkipperHoodId ? this.currentSnapshot.hoods[r.assignedSkipperHoodId] : null;
            return `
              <div class="attached-route-card" data-route-id="${r.id}" style="border-left: 3px solid ${gang?.color || '#38bdf8'};">
                <div class="attached-route-top">
                  <span class="route-mode-badge mode-${r.mode.toLowerCase()}">${r.mode === 'BOAT' ? '🚢 BOAT' : '🚐 VAN'}</span>
                  <span class="route-price-tag text-green">$${r.price}</span>
                </div>
                <div class="attached-route-path">
                  <span class="route-endpoint">${rSrc?.name || r.sourceId}</span>
                  <span class="route-arrow">➔</span>
                  <span class="route-endpoint">${rTgt?.name || r.targetId}</span>
                </div>
                <div class="attached-route-specs">
                  <div class="route-spec-item">
                    <span class="spec-k">RUNS</span>
                    <span class="spec-v highlight">${r.activeVoyageCount}</span>
                  </div>
                  <div class="route-spec-item">
                    <span class="spec-k">DELIVERED</span>
                    <span class="spec-v">${r.totalPassengers}</span>
                  </div>
                  <div class="route-spec-item">
                    <span class="spec-k">REVENUE</span>
                    <span class="spec-v text-green">$${r.revenue}</span>
                  </div>
                  <div class="route-spec-item">
                    <span class="spec-k">SKIPPER</span>
                    <span class="spec-v">${skipper ? skipper.name : '<span style="color:#ef4444;">Unstaffed</span>'}</span>
                  </div>
                </div>
                <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
                  <button class="btn-inspect-bundled-route" data-route-id="${r.id}" style="padding: 4px 8px; background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.5); color: #38bdf8; border-radius: 4px; font-size: 10px; cursor: pointer;">
                    🔍 Inspect Route
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else if (this.selectedEntityType === 'VOYAGE') {
      const voyage = this.currentSnapshot.voyages[this.selectedEntityId!];
      if (!voyage) return;

      const gang = this.currentSnapshot.gangs[voyage.gangId];
      const src = this.currentSnapshot.locations[voyage.sourceId];
      const tgt = this.currentSnapshot.locations[voyage.targetId];
      const passengers = voyage.passengerIds.map((pid) => this.currentSnapshot.migrants[pid]).filter(Boolean);
      const captainHood = voyage.captainHoodId ? this.currentSnapshot.hoods[voyage.captainHoodId] : null;

      title.textContent = `ACTIVE VOYAGE`;
      content.innerHTML = `
        <div class="voyage-banner" style="border-left: 4px solid ${gang?.color || '#38bdf8'}">
          <h2>${voyage.mode}: ${src?.name} → ${tgt?.name}</h2>
          <span style="color: ${gang?.color}">${gang?.name}</span>
        </div>

        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" id="insp-voyage-bar" style="width: ${Math.round(voyage.progress * 100)}%; background: ${gang?.color || '#38bdf8'}"></div>
        </div>
        <div class="progress-label" id="insp-voyage-label">PROGRESS: ${Math.round(voyage.progress * 100)}%</div>

        ${captainHood ? `
          <div class="insp-grid" style="margin-top: 8px;">
            <div class="insp-row">
              <span class="lbl">VOYAGE SKIPPER</span>
              <span class="val highlight">${captainHood.name}</span>
            </div>
            <div class="insp-row">
              <span class="lbl">STATUS</span>
              <span class="val" id="insp-voyage-skipper-task" style="font-size: 10px; color: #22d3ee;">${captainHood.currentTaskDescription}</span>
            </div>
          </div>
        ` : ''}

        <div class="insp-subhead">PASSENGERS ON BOARD (${passengers.length})</div>
        <div class="migrants-scroll-list">
          ${passengers.map((c) => {
            const dest = c.destinationId ? this.currentSnapshot.locations[c.destinationId] : null;
            const destStr = dest ? `${dest.name}` : (c.destinationRegion || c.desiredRegion || 'Europe');
            const happy = c.happiness ?? 50;
            const happyColor = happy >= 70 ? '#10b981' : happy >= 40 ? '#f59e0b' : '#ef4444';
            return `
              <div class="migrant-row-item" data-migrant-id="${c.id}">
                <div class="migrant-mini-avatar">${MigrantRenderer.generateSvg(c, 36)}</div>
                <div class="migrant-mini-info">
                  <div class="c-name">${c.name}</div>
                  <div class="c-dest">Dest: <b>${destStr}</b> • Goal: <b>${c.goal || 'LEAVE'}</b> • <span style="color: ${happyColor}; font-weight: bold;">😊 ${happy}</span></div>
                </div>
              </div>
            `;
          }).join('')}
          ${passengers.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No passengers currently on board.</div>' : ''}
        </div>
      `;
    }
  }

  private updateInspectorValues(content: HTMLElement) {
    if (this.selectedEntityType === 'CORRIDOR_BUNDLE') {
      const bundle = this.selectedCorridorBundle;
      if (!bundle) return;
      const vEl = content.querySelector('#insp-bundle-voyages');
      if (vEl) vEl.textContent = `${bundle.totalActiveVoyages} Vehicles`;
      const dEl = content.querySelector('#insp-bundle-delivered');
      if (dEl) dEl.textContent = `${bundle.totalDelivered} Migrants`;
      const rEl = content.querySelector('#insp-bundle-revenue');
      if (rEl) rEl.textContent = `$${bundle.totalRevenue}`;
      return;
    }
    if (this.selectedEntityType === 'MIGRANT') {
      const migrant = this.currentSnapshot.migrants[this.selectedEntityId!];
      if (!migrant) return;

      const statusEl = content.querySelector('#insp-migrant-status');
      if (statusEl) {
        statusEl.className = `status-pill status-${migrant.status.toLowerCase()}`;
        statusEl.textContent = migrant.status;
      }
      const cashEl = content.querySelector('#insp-migrant-cash');
      if (cashEl) cashEl.textContent = `$${migrant.cash}`;
      const patEl = content.querySelector('#insp-migrant-patience');
      if (patEl) patEl.textContent = `${migrant.patienceRemainingTicks} ticks`;
      const origin = this.currentSnapshot.locations[migrant.originId];
      const nodeEl = content.querySelector('#insp-migrant-node');
      if (nodeEl) nodeEl.textContent = `${origin?.name || 'Recruiter'} (${origin?.region || 'Europe'})`;
      const routeEl = content.querySelector('#insp-migrant-route');
      if (routeEl) routeEl.textContent = migrant.assignedRouteId || 'None yet';
    } else if (this.selectedEntityType === 'GANG') {
      const gang = this.currentSnapshot.gangs[this.selectedEntityId!];
      if (!gang) return;

      const routes = Object.values(this.currentSnapshot.routes).filter((r) => r.gangId === gang.id);
      const gangHoods = Object.values(this.currentSnapshot.hoods || {}).filter((h) => h.gangId === gang.id);

      const statusEl = content.querySelector('#insp-gang-status');
      if (statusEl) {
        statusEl.className = `status-pill status-${gang.status.toLowerCase()}`;
        statusEl.textContent = gang.status;
      }
      const cashEl = content.querySelector('#insp-gang-cash');
      if (cashEl) {
        cashEl.className = gang.cash < 0 ? 'val text-red' : 'val text-green';
        cashEl.textContent = `$${gang.cash}`;
      }
      const wageBill = gang.wageBillTotal ?? (gangHoods.length * 15);
      const payrollEl = content.querySelector('#insp-gang-payroll');
      if (payrollEl) payrollEl.textContent = `$${wageBill} / cycle (60 ticks)`;

      const repEl = content.querySelector('#insp-gang-rep');
      if (repEl) repEl.textContent = `${gang.reputation} / 100`;
      const recEl = content.querySelector('#insp-gang-recruits');
      if (recEl) recEl.textContent = `${gang.stats.recruitsTotal} Migrants`;
      const succEl = content.querySelector('#insp-gang-succ');
      if (succEl) succEl.textContent = `${gang.stats.voyagesSuccessful}`;
      const disrEl = content.querySelector('#insp-gang-disr');
      if (disrEl) disrEl.textContent = `${gang.stats.voyagesDisrupted}`;
      const routesEl = content.querySelector('#insp-gang-routes');
      if (routesEl) routesEl.textContent = `${routes.filter((r) => r.status === 'ACTIVE').length}`;

      for (const h of gangHoods) {
        const taskEl = content.querySelector(`#hood-task-${h.id}`);
        if (taskEl && taskEl.textContent !== h.currentTaskDescription) {
          taskEl.textContent = h.currentTaskDescription;
        }
      }

      const hireScoutBtn = content.querySelector<HTMLButtonElement>('.btn-hire-scout');
      if (hireScoutBtn) {
        hireScoutBtn.disabled = gang.cash < 150;
      }

      content.querySelectorAll<HTMLButtonElement>('.btn-claim-candidate').forEach((btn) => {
        const candId = btn.getAttribute('data-candidate-id');
        const gId = btn.getAttribute('data-gang-id') || gang.id;
        if (candId && gId) {
          const check = canClaimCandidateNode(this.currentSnapshot, gId, candId);
          btn.disabled = !check.allowed;
          btn.title = check.allowed ? 'Claim candidate site' : (check.reason || 'Cannot claim site');
        }
      });

      content.querySelectorAll<HTMLButtonElement>('.btn-charter-route').forEach((btn) => {
        btn.disabled = gang.cash < 1200;
      });

      content.querySelectorAll<HTMLButtonElement>('.btn-build-action').forEach((btn) => {
        const cost = parseInt(btn.getAttribute('data-cost') || '0', 10);
        if (gang.cash < cost) {
          btn.style.opacity = '0.5';
          btn.style.pointerEvents = 'none';
        } else {
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
        }
      });
    } else if (this.selectedEntityType === 'LOCATION') {
      const loc = this.currentSnapshot.locations[this.selectedEntityId!];
      if (!loc) return;

      const effectiveHeat = (loc.gangId && loc.gangId !== 'NEUTRAL')
        ? getEffectiveInfluenceHeat(this.currentSnapshot, loc.gangId, loc.x, loc.y)
        : 0;
      const heatPct = Math.round(effectiveHeat * 100);
      const multiplier = getNodeHeatMultiplier(effectiveHeat);

      const heatEl = content.querySelector('#insp-loc-heat');
      if (heatEl) heatEl.textContent = `${heatPct}% (${multiplier}x Stats Multiplier)`;

      const migrantsPresent = Object.values(this.currentSnapshot.migrants).filter(
        (c) => c.originId === loc.id && (c.status === 'WAITING' || c.status === 'RECRUITED')
      );
      const migrantsInDepot = Object.values(this.currentSnapshot.migrants).filter(
        (c) => c.originId === loc.id && c.status === 'ARRIVED'
      );
      const outgoingRoutes = Object.values(this.currentSnapshot.routes).filter(
        (r) => r.sourceId === loc.id && r.status === 'ACTIVE'
      );
      const incomingRoutes = Object.values(this.currentSnapshot.routes).filter(
        (r) => r.targetId === loc.id && r.status === 'ACTIVE'
      );

      const waitEl = content.querySelector('#insp-loc-waiting');
      if (waitEl) waitEl.textContent = `${migrantsPresent.length}`;
      const depotEl = content.querySelector('#insp-loc-depot');
      if (depotEl) depotEl.textContent = `${migrantsInDepot.length}`;
      const wsEl = content.querySelector('#insp-loc-ws');
      if (wsEl) wsEl.textContent = `${migrantsInDepot.length}`;
      const outEl = content.querySelector('#insp-loc-out');
      if (outEl) outEl.textContent = `${outgoingRoutes.length}`;
      const inEl = content.querySelector('#insp-loc-in');
      if (inEl) inEl.textContent = `${incomingRoutes.length}`;

      const allRoutes = [...outgoingRoutes, ...incomingRoutes];
      allRoutes.forEach((r) => {
        const relEl = content.querySelector(`#route-${r.id}-rel`);
        if (relEl) relEl.textContent = `${Math.round(r.reliability * 100)}%`;
        const actEl = content.querySelector(`#route-${r.id}-active`);
        if (actEl) actEl.textContent = `${r.activeVoyageCount}`;
        const carEl = content.querySelector(`#route-${r.id}-carried`);
        if (carEl) carEl.textContent = `${r.totalPassengers}`;
        const revEl = content.querySelector(`#route-${r.id}-rev`);
        if (revEl) revEl.textContent = `$${r.revenue}`;
        const skipperEl = content.querySelector(`#route-${r.id}-skipper`);
        if (skipperEl) {
          const skipper = r.assignedSkipperHoodId ? this.currentSnapshot.hoods[r.assignedSkipperHoodId] : null;
          skipperEl.innerHTML = skipper ? skipper.name : '<span style="color:#ef4444;">Unstaffed</span>';
        }
      });

      content.querySelectorAll<HTMLButtonElement>('.btn-claim-candidate').forEach((btn) => {
        const candId = btn.getAttribute('data-candidate-id');
        const gId = btn.getAttribute('data-gang-id');
        if (candId && gId) {
          const check = canClaimCandidateNode(this.currentSnapshot, gId, candId);
          btn.disabled = !check.allowed;
          btn.title = check.allowed ? 'Claim candidate site' : (check.reason || 'Cannot claim site');
        }
      });


    } else if (this.selectedEntityType === 'ROUTE') {
      const route = this.currentSnapshot.routes[this.selectedEntityId!];
      if (!route) return;

      const relEl = content.querySelector('#insp-route-rel');
      if (relEl) relEl.textContent = `${Math.round(route.reliability * 100)}%`;
      const carEl = content.querySelector('#insp-route-carried');
      if (carEl) carEl.textContent = `${route.totalPassengers} Migrants`;
      const revEl = content.querySelector('#insp-route-rev');
      if (revEl) revEl.textContent = `$${route.revenue}`;
      const statEl = content.querySelector('#insp-route-status');
      if (statEl) statEl.textContent = route.status;
    } else if (this.selectedEntityType === 'VOYAGE') {
      const voyage = this.currentSnapshot.voyages[this.selectedEntityId!];
      if (!voyage) return;

      const pct = Math.round(voyage.progress * 100);
      const barEl = content.querySelector('#insp-voyage-bar') as HTMLElement;
      if (barEl) barEl.style.width = `${pct}%`;
      const lblEl = content.querySelector('#insp-voyage-label');
      if (lblEl) lblEl.textContent = `PROGRESS: ${pct}%`;
      const skipperEl = content.querySelector('#insp-voyage-skipper-task');
      if (skipperEl && voyage.captainHoodId) {
        const hood = this.currentSnapshot.hoods[voyage.captainHoodId];
        if (hood) skipperEl.textContent = hood.currentTaskDescription;
      }
    }
  }
}
