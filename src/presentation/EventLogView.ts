import type { SimEvent, WorldSnapshot } from '../sim/types';

export class EventLogView {
  private container: HTMLElement;
  private currentSnapshot: WorldSnapshot | null = null;
  private searchQuery: string = '';
  private selectedGangFilter: string = 'ALL';
  private selectedCategoryFilter: string = 'ALL';
  private selectedSeverityFilter: string = 'ALL';
  private autoScroll: boolean = true;
  private newestFirst: boolean = true;
  private unreadCount: number = 0;
  private lastViewedTick: number = 0;
  private onUnreadCountChanged?: (count: number) => void;

  constructor(parent: HTMLElement, onUnreadCountChanged?: (count: number) => void) {
    this.onUnreadCountChanged = onUnreadCountChanged;
    this.container = document.createElement('div');
    this.container.id = 'tab-events-view';
    this.container.className = 'full-tab-view tab-events-container';
    this.container.style.display = 'none';
    parent.appendChild(this.container);

    this.mount();
  }

  private mount() {
    this.container.innerHTML = `
      <div class="tab-header-banner">
        <div class="tab-header-title-box">
          <div class="tab-header-title">📜 OPERATIONS EVENT CHRONICLE</div>
          <div class="tab-header-sub">Chronological black-ops intelligence feed, border disruptions, and syndicate activities.</div>
        </div>
        <div class="tab-header-stats">
          <div class="stat-pill"><span class="stat-lbl">TOTAL EVENTS:</span> <span id="ev-total-count" class="stat-val">0</span></div>
          <div class="stat-pill"><span class="stat-lbl">SHOWING:</span> <span id="ev-showing-count" class="stat-val text-cyan">0</span></div>
        </div>
      </div>

      <!-- FILTER TOOLBAR -->
      <div class="events-toolbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" id="ev-search-input" class="ev-input" placeholder="Search event descriptions, gangs, locations..." />
          <button id="ev-search-clear" class="btn-icon-clear" title="Clear Search">✕</button>
        </div>

        <div class="filter-group">
          <label class="filter-lbl">GANG:</label>
          <select id="ev-gang-select" class="ev-select">
            <option value="ALL">All Gangs</option>
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-lbl">SEVERITY:</label>
          <select id="ev-severity-select" class="ev-select">
            <option value="ALL">All Severities</option>
            <option value="HIGH">High Priority</option>
            <option value="MEDIUM">Medium Priority</option>
            <option value="LOW">Low Priority</option>
          </select>
        </div>

        <div class="category-pills">
          <button class="cat-pill active" data-cat="ALL">All</button>
          <button class="cat-pill" data-cat="GOD">👑 God Mode</button>
          <button class="cat-pill" data-cat="DISRUPTIONS">🚨 Disruptions</button>
          <button class="cat-pill" data-cat="ARRIVALS">✅ Arrivals</button>
          <button class="cat-pill" data-cat="SCOUTING">🧭 Scouting</button>
          <button class="cat-pill" data-cat="INFRASTRUCTURE">🏗️ Assets</button>
          <button class="cat-pill" data-cat="FINANCE">💰 Cash/Wages</button>
        </div>

        <div class="toolbar-actions">
          <button id="ev-btn-sort" class="btn-action-tool" title="Toggle Newest/Oldest First">
            <span id="ev-sort-label">⬇ Newest First</span>
          </button>
          <button id="ev-btn-autoscroll" class="btn-action-tool active" title="Toggle Auto-Scroll">
            <span>🔒 Auto-Scroll: ON</span>
          </button>
          <button id="ev-btn-copy" class="btn-action-tool" title="Copy Filtered Events as JSON">
            <span>📋 Copy JSON</span>
          </button>
        </div>
      </div>

      <!-- MAIN EVENT STREAM TABLE -->
      <div class="events-table-wrapper">
        <div class="events-table-header">
          <div class="col-tick">TICK</div>
          <div class="col-type">TYPE / SEVERITY</div>
          <div class="col-gang">SYNDICATE</div>
          <div class="col-desc">DESCRIPTION & METADATA</div>
        </div>
        <div id="events-table-body" class="events-table-body"></div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    const searchInput = this.container.querySelector<HTMLInputElement>('#ev-search-input');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.render();
    });

    this.container.querySelector('#ev-search-clear')?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      this.searchQuery = '';
      this.render();
    });

    this.container.querySelector<HTMLSelectElement>('#ev-gang-select')?.addEventListener('change', (e) => {
      this.selectedGangFilter = (e.target as HTMLSelectElement).value;
      this.render();
    });

    this.container.querySelector<HTMLSelectElement>('#ev-severity-select')?.addEventListener('change', (e) => {
      this.selectedSeverityFilter = (e.target as HTMLSelectElement).value;
      this.render();
    });

    const catPills = this.container.querySelectorAll<HTMLButtonElement>('.cat-pill');
    catPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        catPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.selectedCategoryFilter = pill.getAttribute('data-cat') || 'ALL';
        this.render();
      });
    });

    const sortBtn = this.container.querySelector<HTMLButtonElement>('#ev-btn-sort');
    sortBtn?.addEventListener('click', () => {
      this.newestFirst = !this.newestFirst;
      const lbl = this.container.querySelector('#ev-sort-label');
      if (lbl) lbl.textContent = this.newestFirst ? '⬇ Newest First' : '⬆ Oldest First';
      this.render();
    });

    const autoScrollBtn = this.container.querySelector<HTMLButtonElement>('#ev-btn-autoscroll');
    autoScrollBtn?.addEventListener('click', () => {
      this.autoScroll = !this.autoScroll;
      autoScrollBtn.classList.toggle('active', this.autoScroll);
      autoScrollBtn.innerHTML = `<span>${this.autoScroll ? '🔒 Auto-Scroll: ON' : '🔓 Auto-Scroll: OFF'}</span>`;
    });

    this.container.querySelector('#ev-btn-copy')?.addEventListener('click', () => {
      if (!this.currentSnapshot) return;
      const filtered = this.getFilteredEvents(this.currentSnapshot.events);
      navigator.clipboard?.writeText(JSON.stringify(filtered, null, 2)).then(() => {
        const copyBtn = this.container.querySelector<HTMLButtonElement>('#ev-btn-copy');
        if (copyBtn) {
          const orig = copyBtn.innerHTML;
          copyBtn.innerHTML = '<span>✅ Copied!</span>';
          setTimeout(() => { copyBtn.innerHTML = orig; }, 1500);
        }
      });
    });
  }

  show() {
    this.container.style.display = 'flex';
    this.unreadCount = 0;
    if (this.currentSnapshot) {
      this.lastViewedTick = this.currentSnapshot.tick;
    }
    if (this.onUnreadCountChanged) {
      this.onUnreadCountChanged(0);
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

    // Track unread events if tab is hidden
    if (!this.isVisible()) {
      const newEvts = snapshot.events.filter((e) => e.tick > this.lastViewedTick);
      if (newEvts.length !== this.unreadCount) {
        this.unreadCount = newEvts.length;
        if (this.onUnreadCountChanged) {
          this.onUnreadCountChanged(this.unreadCount);
        }
      }
    } else {
      this.lastViewedTick = snapshot.tick;
      this.render();
    }
  }

  private getFilteredEvents(events: SimEvent[]): SimEvent[] {
    let list = [...events];

    if (this.searchQuery) {
      list = list.filter((e) =>
        e.description.toLowerCase().includes(this.searchQuery) ||
        e.type.toLowerCase().includes(this.searchQuery) ||
        (e.gangId && e.gangId.toLowerCase().includes(this.searchQuery))
      );
    }

    if (this.selectedGangFilter !== 'ALL') {
      list = list.filter((e) => e.gangId === this.selectedGangFilter);
    }

    if (this.selectedSeverityFilter !== 'ALL') {
      list = list.filter((e) => e.importance === this.selectedSeverityFilter);
    }

    if (this.selectedCategoryFilter !== 'ALL') {
      switch (this.selectedCategoryFilter) {
        case 'GOD':
          list = list.filter((e) => e.type === 'GOD_INTERVENTION');
          break;
        case 'DISRUPTIONS':
          list = list.filter((e) => e.type === 'VOYAGE_DISRUPTED' || e.type === 'GANG_BANKRUPT' || e.type === 'OPERATION_CLOSED');
          break;
        case 'ARRIVALS':
          list = list.filter((e) => e.type === 'VOYAGE_SUCCESS' || e.type === 'MIGRANT_ARRIVED');
          break;
        case 'SCOUTING':
          list = list.filter((e) => e.type === 'AREA_SCOUTED' || e.type === 'ROUTE_SEARCHED' || e.type === 'NODE_DISCOVERED' || e.type === 'ROUTE_DISCOVERED');
          break;
        case 'INFRASTRUCTURE':
          list = list.filter((e) => e.type === 'NODE_PURCHASED' || e.type === 'ROUTE_PURCHASED' || e.type === 'OPERATION_OPENED' || e.type === 'ROUTE_OPENED');
          break;
        case 'FINANCE':
          list = list.filter((e) => e.type === 'PAYROLL_PAID' || e.type === 'GOD_INTERVENTION');
          break;
      }
    }

    if (!this.newestFirst) {
      list.reverse();
    }

    return list;
  }

  private render() {
    if (!this.currentSnapshot) return;

    // Update gang select options if needed
    const gangSelect = this.container.querySelector<HTMLSelectElement>('#ev-gang-select');
    if (gangSelect && gangSelect.options.length <= 1) {
      for (const gang of Object.values(this.currentSnapshot.gangs)) {
        const opt = document.createElement('option');
        opt.value = gang.id;
        opt.textContent = `${gang.emblem} ${gang.name}`;
        gangSelect.appendChild(opt);
      }
    }

    const filtered = this.getFilteredEvents(this.currentSnapshot.events);

    const totalEl = this.container.querySelector('#ev-total-count');
    const showingEl = this.container.querySelector('#ev-showing-count');
    if (totalEl) totalEl.textContent = `${this.currentSnapshot.events.length}`;
    if (showingEl) showingEl.textContent = `${filtered.length}`;

    const body = this.container.querySelector<HTMLElement>('#events-table-body');
    if (!body) return;

    if (filtered.length === 0) {
      body.innerHTML = `
        <div class="events-empty-state">
          <span class="empty-icon">📭</span>
          <div class="empty-title">No events match active filters</div>
          <div class="empty-sub">Try broadening search terms or switching category filter.</div>
        </div>
      `;
      return;
    }

    let html = '';
    for (const ev of filtered) {
      const gang = ev.gangId && this.currentSnapshot.gangs[ev.gangId] ? this.currentSnapshot.gangs[ev.gangId] : null;
      const gangName = gang ? `${gang.emblem} ${gang.name}` : (ev.gangId || 'SYSTEM');
      const gangColor = gang ? gang.color : '#64748b';

      let typeBadgeClass = 'tag-default';
      let typeIcon = 'ℹ️';

      switch (ev.type) {
        case 'GOD_INTERVENTION':
          typeBadgeClass = 'tag-god';
          typeIcon = '👑';
          break;
        case 'VOYAGE_DISRUPTED':
          typeBadgeClass = 'tag-danger';
          typeIcon = '🚨';
          break;
        case 'VOYAGE_SUCCESS':
        case 'MIGRANT_ARRIVED':
          typeBadgeClass = 'tag-success';
          typeIcon = '✅';
          break;
        case 'AREA_SCOUTED':
        case 'ROUTE_SEARCHED':
        case 'NODE_DISCOVERED':
        case 'ROUTE_DISCOVERED':
          typeBadgeClass = 'tag-cyan';
          typeIcon = '🧭';
          break;
        case 'NODE_PURCHASED':
        case 'ROUTE_PURCHASED':
        case 'OPERATION_OPENED':
          typeBadgeClass = 'tag-purple';
          typeIcon = '🏗️';
          break;
        case 'PAYROLL_PAID':
          typeBadgeClass = 'tag-amber';
          typeIcon = '💰';
          break;
        case 'GANG_BANKRUPT':
          typeBadgeClass = 'tag-danger';
          typeIcon = '💀';
          break;
      }

      const importanceDot = ev.importance === 'HIGH' ? '<span class="dot-high" title="High Priority">●</span>' : '';

      html += `
        <div class="event-row importance-${ev.importance.toLowerCase()} ${ev.type === 'GOD_INTERVENTION' ? 'row-god' : ''}">
          <div class="col-tick">
            <span class="tick-badge">TICK ${ev.tick}</span>
          </div>
          <div class="col-type">
            <span class="type-tag ${typeBadgeClass}">${typeIcon} ${ev.type} ${importanceDot}</span>
          </div>
          <div class="col-gang">
            <span class="gang-pill" style="border-left: 3px solid ${gangColor}; color: ${gangColor};">
              ${gangName}
            </span>
          </div>
          <div class="col-desc">
            <div class="event-desc-text">${this.formatDescription(ev.description)}</div>
          </div>
        </div>
      `;
    }

    body.innerHTML = html;

    if (this.autoScroll && this.newestFirst) {
      body.scrollTop = 0;
    } else if (this.autoScroll && !this.newestFirst) {
      body.scrollTop = body.scrollHeight;
    }
  }

  private formatDescription(desc: string): string {
    // Highlight dollar amounts, percentages, and locations
    return desc
      .replace(/(\$[\d,]+)/g, '<strong class="hl-cash">$1</strong>')
      .replace(/(\d+%\s*heat|\d+%\s*risk)/gi, '<strong class="hl-stat">$1</strong>');
  }
}
