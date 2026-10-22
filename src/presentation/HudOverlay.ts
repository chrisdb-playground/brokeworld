import type { GamePort } from '../app/GamePort';
import type { TickScheduler } from '../app/TickScheduler';
import type {
  ChumigrantState,
  GangState,
  LocationDef,
  RouteServiceState,
  VoyageState,
  WorldSnapshot,
} from '../sim/types';
import { ChumRenderer } from './ChumRenderer';

export interface HudOverlayCallbacks {
  onSelectGang?: (gangId: string | null) => void;
  onSelectGangs?: (gangIds: Set<string>) => void;
  onFocusLocation?: (locId: string) => void;
}

export class HudOverlay {
  private port: GamePort;
  private scheduler: TickScheduler;
  private onSelectGangCallback?: (gangId: string | null) => void;
  private onSelectGangsCallback?: (gangIds: Set<string>) => void;
  private onFocusLocation?: (locId: string) => void;

  private currentSnapshot!: WorldSnapshot;
  private selectedEntityType: 'CHUM' | 'GANG' | 'LOCATION' | 'ROUTE' | 'VOYAGE' | null = null;
  private selectedEntityId: string | null = null;
  private selectedGangIds: Set<string> = new Set();

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

    this.mountDom();
    this.port.subscribe((snapshot) => {
      this.currentSnapshot = snapshot;
      this.update(snapshot);
    });
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
          this.selectedEntityType = null;
          this.selectedEntityId = null;
          document.getElementById('hud-inspector')?.classList.add('collapsed');
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
    this.selectedEntityType = null;
    this.selectedEntityId = null;
    this.notifyGangSelection();
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

  selectChum(chum: ChumigrantState) {
    this.selectedEntityType = 'CHUM';
    this.selectedEntityId = chum.id;
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
            <div class="brand-name">CHUM WORLD</div>
            <div class="brand-sub">AUTONOMOUS SMUGGLER SIMULATOR</div>
          </div>
        </div>

        <!-- SIM CLOCK & CONTROLS (Ticks only, no day unit) -->
        <div class="time-controls">
          <div class="tick-chip">
            <span class="tick-label">TICK</span>
            <span id="hud-tick" class="tick-val">0</span>
          </div>
          <div class="speed-btns">
            <button class="spd-btn" data-speed="0">⏸</button>
            <button class="spd-btn active" data-speed="1">1×</button>
            <button class="spd-btn" data-speed="5">5×</button>
            <button class="spd-btn" data-speed="20">20×</button>
            <button class="spd-btn" id="btn-step">⏯ Step</button>
          </div>
        </div>

        <!-- METRICS -->
        <div class="metrics-bar">
          <div class="metric-item">
            <span class="m-label">ACTIVE CHUMS</span>
            <span class="m-val" id="m-chums">0</span>
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
            </div>
          </div>
          <div id="gangs-legend" class="gangs-legend-list"></div>
        </div>

        <div class="panel-section flex-grow">
          <div class="section-title">EVENT LOG</div>
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

    // Hook up time control buttons
    const spdBtns = root.querySelectorAll<HTMLButtonElement>('.spd-btn[data-speed]');
    spdBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        spdBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const spd = parseFloat(btn.getAttribute('data-speed') || '1');
        this.scheduler.setTimeScale(spd);
      });
    });

    root.querySelector('#btn-step')?.addEventListener('click', () => {
      this.scheduler.step();
    });

    root.querySelector('#btn-select-all')?.addEventListener('click', () => {
      this.selectAllGangs();
    });

    root.querySelector('#btn-deselect-gang')?.addEventListener('click', () => {
      this.deselectAllGangs();
    });

    root.querySelector('#close-insp')?.addEventListener('click', () => {
      this.selectedEntityType = null;
      this.selectedEntityId = null;
      document.getElementById('hud-inspector')?.classList.add('collapsed');
    });
  }

  private update(snapshot: WorldSnapshot) {
    // Top Bar Stats (Ticks only)
    const tickEl = document.getElementById('hud-tick');
    if (tickEl) tickEl.textContent = `${snapshot.tick}`;

    const chumsEl = document.getElementById('m-chums');
    const routesEl = document.getElementById('m-routes');
    const voyagesEl = document.getElementById('m-voyages');
    const succEl = document.getElementById('m-success');
    const disrEl = document.getElementById('m-disrupted');

    const arrivedCount = Object.values(snapshot.chumigrants).filter((c) => c.status === 'ARRIVED').length;
    if (chumsEl) chumsEl.textContent = `${snapshot.stats.activeChums}`;
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

    feed.innerHTML = '';
    const events = snapshot.events.slice(0, 30);
    for (const evt of events) {
      const item = document.createElement('div');
      item.className = `event-item imp-${evt.importance.toLowerCase()}`;
      item.innerHTML = `
        <span class="evt-tick">[Tick ${evt.tick}]</span>
        <span class="evt-desc">${evt.description}</span>
      `;
      feed.appendChild(item);
    }
  }

  private renderInspector() {
    const card = document.getElementById('hud-inspector');
    const title = document.getElementById('insp-header-title');
    const content = document.getElementById('insp-content');
    if (!card || !title || !content || !this.currentSnapshot) return;

    card.classList.remove('collapsed');

    if (this.selectedEntityType === 'CHUM') {
      const chum = this.currentSnapshot.chumigrants[this.selectedEntityId!];
      if (!chum) return;

      title.textContent = `CHUMIGRANT INSPECTOR`;
      const origin = this.currentSnapshot.locations[chum.originId];
      const gang = chum.recruitedByGangId ? this.currentSnapshot.gangs[chum.recruitedByGangId] : null;

      content.innerHTML = `
        <div class="inspector-chum-hero">
          <div class="chum-avatar-box">
            ${ChumRenderer.generateSvg(chum, 95)}
          </div>
          <div class="chum-hero-info">
            <h3>${chum.name}</h3>
            <span class="status-pill status-${chum.status.toLowerCase()}">${chum.status}</span>
            <div class="hero-sub">Cash: <b>$${chum.cash}</b></div>
            <div class="hero-sub">Patience: <b>${chum.patienceRemainingTicks} ticks</b></div>
          </div>
        </div>

        <div class="insp-grid">
          <div class="insp-row">
            <span class="lbl">ORIGIN CITY</span>
            <span class="val highlight">${chum.originName} (${chum.originRegion})</span>
          </div>
          <div class="insp-row">
            <span class="lbl">DESIRED GOAL</span>
            <span class="val highlight">${chum.desiredRegion === 'UK' ? '🇬🇧 United Kingdom' : '🇪🇺 West Europe'}</span>
          </div>
          <div class="insp-row">
            <span class="lbl">CURRENT NODE</span>
            <span class="val">${origin?.name || 'Recruiter'} (${origin?.region || 'Europe'})</span>
          </div>
          <div class="insp-row">
            <span class="lbl">RECRUITING GANG</span>
            <span class="val" style="color: ${gang ? gang.color : '#94a3b8'}">
              ${gang ? `${gang.emblem} ${gang.name}` : 'Waiting for passage'}
            </span>
          </div>
          <div class="insp-row">
            <span class="lbl">ASSIGNED ROUTE</span>
            <span class="val">${chum.assignedRouteId || 'None yet'}</span>
          </div>
        </div>

        <div class="insp-subhead">MIGRATION HISTORY</div>
        <div class="history-list">
          ${chum.history.map((h) => `<div class="history-item">${h}</div>`).join('')}
        </div>
      `;
    } else if (this.selectedEntityType === 'GANG') {
      const gang = this.currentSnapshot.gangs[this.selectedEntityId!];
      if (!gang) return;

      title.textContent = `GANG DOSSIER`;
      const hq = this.currentSnapshot.locations[gang.hqLocationId];
      const ws = gang.workshopLocationId ? this.currentSnapshot.locations[gang.workshopLocationId] : null;
      const routes = Object.values(this.currentSnapshot.routes).filter((r) => r.gangId === gang.id);

      const recruiters = (gang.recruiterLocationIds || []).map((id) => this.currentSnapshot.locations[id]?.name).filter(Boolean);
      const depots = (gang.depotLocationIds || []).map((id) => this.currentSnapshot.locations[id]?.name).filter(Boolean);
      const gangHoods = Object.values(this.currentSnapshot.hoods || {}).filter((h) => h.gangId === gang.id);

      content.innerHTML = `
        <div class="gang-header-banner" style="border-left: 4px solid ${gang.color}">
          <h2 style="color: ${gang.color}">${gang.emblem} ${gang.name}</h2>
          <span class="status-pill status-${gang.status.toLowerCase()}">${gang.status}</span>
        </div>

        <div class="insp-grid">
          <div class="insp-row"><span class="lbl">HEADQUARTERS</span><span class="val">${hq?.name || 'HQ'}</span></div>
          <div class="insp-row"><span class="lbl">WORKSHOP</span><span class="val">${ws?.name || 'Workshop'}</span></div>
          <div class="insp-row"><span class="lbl">RECRUITERS</span><span class="val">${recruiters.join(', ') || 'None'}</span></div>
          <div class="insp-row"><span class="lbl">DEPOTS</span><span class="val">${depots.join(', ') || 'None'}</span></div>
          <div class="insp-row"><span class="lbl">TREASURY</span><span class="val">$${gang.cash}</span></div>
          <div class="insp-row"><span class="lbl">REPUTATION</span><span class="val">${gang.reputation} / 100</span></div>
          <div class="insp-row"><span class="lbl">TOTAL RECRUITS</span><span class="val">${gang.stats.recruitsTotal} Chums</span></div>
          <div class="insp-row"><span class="lbl">SUCCESSFUL VOYAGES</span><span class="val text-green">${gang.stats.voyagesSuccessful}</span></div>
          <div class="insp-row"><span class="lbl">DISRUPTED VOYAGES</span><span class="val text-red">${gang.stats.voyagesDisrupted}</span></div>
          <div class="insp-row"><span class="lbl">ACTIVE ROUTES</span><span class="val">${routes.filter((r) => r.status === 'ACTIVE').length}</span></div>
        </div>

        <div class="insp-subhead">EMPLOYED CHUM HOODS (${gangHoods.length})</div>
        <div class="hoods-scroll-list">
          ${gangHoods.map((h) => `
            <div class="hood-card">
              <div class="hood-card-header">
                <div class="hood-mini-avatar">${ChumRenderer.generateSvg({ avatar: h.avatar, name: h.name }, 38)}</div>
                <div class="hood-info">
                  <div class="hood-name">${h.name}</div>
                  <span class="hood-role-tag role-${h.role.toLowerCase()}">${h.role.replace(/_/g, ' ')}</span>
                </div>
              </div>
              <div class="hood-task-box">
                <span class="hood-task-dot">●</span>
                <span class="hood-task-text">${h.currentTaskDescription}</span>
              </div>
            </div>
          `).join('')}
          ${gangHoods.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No Hoods employed yet.</div>' : ''}
        </div>

        <div class="insp-subhead">RECENT AI DECISIONS</div>
        <div class="history-list">
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
      const chumsPresent = Object.values(this.currentSnapshot.chumigrants).filter(
        (c) => c.originId === loc.id && (c.status === 'WAITING' || c.status === 'RECRUITED')
      );
      const chumsInDepot = Object.values(this.currentSnapshot.chumigrants).filter(
        (c) => c.originId === loc.id && c.status === 'ARRIVED'
      );
      const outgoingRoutes = Object.values(this.currentSnapshot.routes).filter(
        (r) => r.sourceId === loc.id && r.status === 'ACTIVE'
      );
      const incomingRoutes = Object.values(this.currentSnapshot.routes).filter(
        (r) => r.targetId === loc.id && r.status === 'ACTIVE'
      );
      const gang = loc.gangId ? this.currentSnapshot.gangs[loc.gangId] : null;
      const gangHoods = loc.gangId
        ? Object.values(this.currentSnapshot.hoods || {}).filter((h) => h.gangId === loc.gangId)
        : [];
      const assignedHood = loc.assignedHoodId ? this.currentSnapshot.hoods[loc.assignedHoodId] : null;

      content.innerHTML = `
        <div class="location-banner">
          <h2>${loc.name}</h2>
          <span class="region-pill">Region ${loc.region} • ${loc.kind} (${loc.tileFamily})</span>
        </div>

        <div class="insp-grid">
          ${gang ? `<div class="insp-row"><span class="lbl">OWNING GANG</span><span class="val" style="color: ${gang.color}">${gang.emblem} ${gang.name}</span></div>` : ''}
          ${assignedHood ? `
            <div class="insp-row"><span class="lbl">MANAGING HOOD</span><span class="val highlight">${assignedHood.name}</span></div>
            <div class="insp-row"><span class="lbl">DUTY</span><span class="val" style="font-size: 10px; color: #cbd5e1;">${assignedHood.role.replace(/_/g, ' ')}</span></div>
          ` : ''}
          ${loc.kind === 'RECRUITER' ? `
            <div class="insp-row"><span class="lbl">WAITING CHUMS</span><span class="val highlight">${chumsPresent.length}</span></div>
            <div class="insp-row"><span class="lbl">OUTGOING ROUTES</span><span class="val">${outgoingRoutes.length}</span></div>
          ` : ''}
          ${loc.kind === 'DEPOT' ? `
            <div class="insp-row"><span class="lbl">CHUMS IN DEPOT</span><span class="val text-green">${chumsInDepot.length}</span></div>
            <div class="insp-row"><span class="lbl">INCOMING ROUTES</span><span class="val">${incomingRoutes.length}</span></div>
            <div class="insp-row"><span class="lbl">OUTGOING ROUTES</span><span class="val">${outgoingRoutes.length}</span></div>
          ` : ''}
          ${loc.kind === 'WORKSHOP' ? `
            <div class="insp-row"><span class="lbl">CHUMS AT WORKSHOP</span><span class="val text-amber">${chumsInDepot.length}</span></div>
            <div class="insp-row"><span class="lbl">INCOMING ROUTES</span><span class="val">${incomingRoutes.length}</span></div>
          ` : ''}
        </div>

        ${loc.kind === 'HQ' ? `
          <div class="insp-subhead">EMPLOYED CHUM HOODS (${gangHoods.length})</div>
          <div class="hoods-scroll-list">
            ${gangHoods.map((h) => `
              <div class="hood-card">
                <div class="hood-card-header">
                  <div class="hood-mini-avatar">${ChumRenderer.generateSvg({ avatar: h.avatar, name: h.name }, 38)}</div>
                  <div class="hood-info">
                    <div class="hood-name">${h.name}</div>
                    <span class="hood-role-tag role-${h.role.toLowerCase()}">${h.role.replace(/_/g, ' ')}</span>
                  </div>
                </div>
                <div class="hood-task-box">
                  <span class="hood-task-dot">●</span>
                  <span class="hood-task-text">${h.currentTaskDescription}</span>
                </div>
              </div>
            `).join('')}
            ${gangHoods.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No Hoods employed yet.</div>' : ''}
          </div>
        ` : ''}

        ${loc.kind === 'RECRUITER' ? `
          <div class="insp-subhead">WAITING CHUMIGRANTS (${chumsPresent.length})</div>
          <div class="chums-scroll-list">
            ${chumsPresent.map((c) => `
              <div class="chum-row-item" data-chum-id="${c.id}">
                <div class="chum-mini-avatar">${ChumRenderer.generateSvg(c, 36)}</div>
                <div class="chum-mini-info">
                  <div class="c-name">${c.name} (${c.originName})</div>
                  <div class="c-dest">Destination: <b>${c.desiredRegion}</b></div>
                </div>
                <span class="c-status">${c.status}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${loc.kind === 'DEPOT' ? `
          <div class="insp-subhead">CHUMIGRANTS HOUSED IN DEPOT (${chumsInDepot.length})</div>
          <div class="chums-scroll-list">
            ${chumsInDepot.map((c) => `
              <div class="chum-row-item" data-chum-id="${c.id}">
                <div class="chum-mini-avatar">${ChumRenderer.generateSvg(c, 36)}</div>
                <div class="chum-mini-info">
                  <div class="c-name">${c.name} (${c.originName})</div>
                  <div class="c-dest">Status: <b class="text-green">Housed in Depot</b></div>
                </div>
                <span class="c-status" style="background:#10b98122;color:#34d399">ARRIVED</span>
              </div>
            `).join('')}
            ${chumsInDepot.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No chumigrants in depot yet.</div>' : ''}
          </div>
        ` : ''}

        ${loc.kind === 'WORKSHOP' ? `
          <div class="insp-subhead">CHUMIGRANTS STATIONED AT WORKSHOP (${chumsInDepot.length})</div>
          <div class="chums-scroll-list">
            ${chumsInDepot.map((c) => `
              <div class="chum-row-item" data-chum-id="${c.id}">
                <div class="chum-mini-avatar">${ChumRenderer.generateSvg(c, 36)}</div>
                <div class="chum-mini-info">
                  <div class="c-name">${c.name} (${c.originName})</div>
                  <div class="c-dest">Status: <b class="text-amber">Working in Workshop</b></div>
                </div>
                <span class="c-status" style="background:#f59e0b22;color:#fbbf24">ARRIVED</span>
              </div>
            `).join('')}
            ${chumsInDepot.length === 0 ? '<div style="color:#64748b;font-size:11px;padding:8px 4px;">No chumigrants stationed at workshop yet.</div>' : ''}
          </div>
        ` : ''}
      `;

      content.querySelectorAll<HTMLElement>('.chum-row-item').forEach((row) => {
        row.addEventListener('click', () => {
          const cid = row.getAttribute('data-chum-id');
          const chum = this.currentSnapshot.chumigrants[cid!];
          if (chum) this.selectChum(chum);
        });
      });
    } else if (this.selectedEntityType === 'ROUTE') {
      const route = this.currentSnapshot.routes[this.selectedEntityId!];
      if (!route) return;

      const gang = this.currentSnapshot.gangs[route.gangId];
      const src = this.currentSnapshot.locations[route.sourceId];
      const tgt = this.currentSnapshot.locations[route.targetId];

      title.textContent = `ROUTE SERVICE`;
      content.innerHTML = `
        <div class="route-banner" style="border-left: 4px solid ${gang?.color || '#38bdf8'}">
          <h2>${src?.name} → ${tgt?.name}</h2>
          <span style="color: ${gang?.color}">${gang?.name}</span>
        </div>

        <div class="insp-grid">
          <div class="insp-row"><span class="lbl">TRANSPORT MODE</span><span class="val">${route.mode}</span></div>
          <div class="insp-row"><span class="lbl">FARE PRICE</span><span class="val highlight">$${route.price}</span></div>
          <div class="insp-row"><span class="lbl">CAPACITY</span><span class="val">${route.capacity} Chums</span></div>
          <div class="insp-row"><span class="lbl">DURATION</span><span class="val">${route.durationTicks} ticks</span></div>
          <div class="insp-row"><span class="lbl">RELIABILITY</span><span class="val">${Math.round(route.reliability * 100)}%</span></div>
          <div class="insp-row"><span class="lbl">TOTAL CARRIED</span><span class="val">${route.totalPassengers} Chums</span></div>
          <div class="insp-row"><span class="lbl">TOTAL REVENUE</span><span class="val text-green">$${route.revenue}</span></div>
          <div class="insp-row"><span class="lbl">STATUS</span><span class="val">${route.status}</span></div>
        </div>
      `;
    } else if (this.selectedEntityType === 'VOYAGE') {
      const voyage = this.currentSnapshot.voyages[this.selectedEntityId!];
      if (!voyage) return;

      const gang = this.currentSnapshot.gangs[voyage.gangId];
      const src = this.currentSnapshot.locations[voyage.sourceId];
      const tgt = this.currentSnapshot.locations[voyage.targetId];
      const passengers = voyage.passengerIds.map((pid) => this.currentSnapshot.chumigrants[pid]).filter(Boolean);
      const captainHood = voyage.captainHoodId ? this.currentSnapshot.hoods[voyage.captainHoodId] : null;

      title.textContent = `ACTIVE VOYAGE`;
      content.innerHTML = `
        <div class="voyage-banner" style="border-left: 4px solid ${gang?.color || '#38bdf8'}">
          <h2>${voyage.mode}: ${src?.name} → ${tgt?.name}</h2>
          <span style="color: ${gang?.color}">${gang?.name}</span>
        </div>

        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width: ${Math.round(voyage.progress * 100)}%; background: ${gang?.color || '#38bdf8'}"></div>
        </div>
        <div class="progress-label">PROGRESS: ${Math.round(voyage.progress * 100)}%</div>

        ${captainHood ? `
          <div class="insp-grid" style="margin-top: 8px;">
            <div class="insp-row">
              <span class="lbl">VOYAGE SKIPPER</span>
              <span class="val highlight">${captainHood.name}</span>
            </div>
            <div class="insp-row">
              <span class="lbl">STATUS</span>
              <span class="val" style="font-size: 10px; color: #22d3ee;">${captainHood.currentTaskDescription}</span>
            </div>
          </div>
        ` : ''}

        <div class="insp-subhead">PASSENGERS ON BOARD (${passengers.length})</div>
        <div class="chums-scroll-list">
          ${passengers.map((c) => `
            <div class="chum-row-item" data-chum-id="${c.id}">
              <div class="chum-mini-avatar">${ChumRenderer.generateSvg(c, 36)}</div>
              <div class="chum-mini-info">
                <div class="c-name">${c.name} (${c.originName})</div>
                <div class="c-dest">Target: <b>${c.desiredRegion}</b></div>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      content.querySelectorAll<HTMLElement>('.chum-row-item').forEach((row) => {
        row.addEventListener('click', () => {
          const cid = row.getAttribute('data-chum-id');
          const chum = this.currentSnapshot.chumigrants[cid!];
          if (chum) this.selectChum(chum);
        });
      });
    }
  }
}
