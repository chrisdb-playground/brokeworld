import Phaser from 'phaser';
import type { GamePort } from '../app/GamePort';
import { engine, scheduler } from '../app/state';
import type {
  ChumigrantState,
  GangState,
  LocationDef,
  RouteServiceState,
  VoyageState,
  WorldSnapshot,
} from '../sim/types';

export interface SceneSelectionEvents {
  onSelectLocation?: (location: LocationDef, snapshot: WorldSnapshot) => void;
  onSelectRoute?: (route: RouteServiceState, snapshot: WorldSnapshot) => void;
  onSelectGang?: (gang: GangState, snapshot: WorldSnapshot) => void;
  onSelectVoyage?: (voyage: VoyageState, snapshot: WorldSnapshot) => void;
  onSelectChum?: (chum: ChumigrantState, snapshot: WorldSnapshot) => void;
  onDeselectAll?: () => void;
}

export class ChumScene extends Phaser.Scene {
  private port!: GamePort;
  private eventsHandler: SceneSelectionEvents = {};
  private currentSnapshot!: WorldSnapshot;

  // Graphics layers
  private floorTile!: Phaser.GameObjects.TileSprite;
  private bgGfx!: Phaser.GameObjects.Graphics;
  private borderGfx!: Phaser.GameObjects.Graphics;
  private connectionsGfx!: Phaser.GameObjects.Graphics;
  private routesGfx!: Phaser.GameObjects.Graphics;
  private vehiclesContainer!: Phaser.GameObjects.Container;
  private nodesContainer!: Phaser.GameObjects.Container;
  private labelsContainer!: Phaser.GameObjects.Container;

  // Visual interactive caches
  private locationContainers: Map<string, Phaser.GameObjects.Container> = new Map();
  private routeHitZones: Map<string, Phaser.GameObjects.Zone> = new Map();
  private vehicleSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  // Camera panning
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private cameraStartX = 0;
  private cameraStartY = 0;

  // Multi-Gang Selection:
  // "it should be possible to select, view, multiple gangs."
  // "deselect to hide everything."
  private selectedGangIds: Set<string> = new Set();
  private selectedRouteId: string | null = null;
  private selectedLocationId: string | null = null;

  constructor() {
    super('ChumScene');
    this.port = engine;
    this.currentSnapshot = engine.getSnapshot();
  }

  setEventsHandler(events: SceneSelectionEvents) {
    this.eventsHandler = events;
  }

  init(data?: { port?: GamePort; events?: SceneSelectionEvents }) {
    if (data?.port) this.port = data.port;
    if (data?.events) this.eventsHandler = data.events;
    this.currentSnapshot = this.port.getSnapshot();
  }

  preload() {
    // Preload sandy floor background
    this.load.image('sandy_floor', '/sandy.png');

    // 4 machine tiles:
    // 1. Recruiter: 'crusher mk3' tile
    // 2. Depot: 'pressure tank mk1' tile
    // 3. HQ: 'logistics hub (roboport) mk1' tile
    // 4. Workshop: 'industrial press mk1' tile
    const nodeTiles = [
      {
        id: 'crusher',
        file: 'graphics/entity/crusher/crusher-mk3-hr-animation.png',
        icon: 'graphics/icons/crusher-mk3.png',
        w: 128,
        h: 138,
        f: 32,
      },
      {
        id: 'pressure-tank',
        file: 'graphics/entity/pressure-tank/pressure-tank-mk1-north-hr-animation.png',
        icon: 'graphics/icons/pressure-tank-mk1.png',
        w: 196,
        h: 200,
        f: 1,
      },
      {
        id: 'logistics-hub',
        file: 'graphics/entity/logistics-hub/logistics-hub-mk1-hr-animation.png',
        icon: 'graphics/icons/logistics-hub-mk1.png',
        w: 254,
        h: 236,
        f: 16,
      },
      {
        id: 'industrial-press',
        file: 'graphics/entity/industrial-press/industrial-press-mk1-north-hr-animation.png',
        icon: 'graphics/icons/industrial-press-mk1.png',
        w: 190,
        h: 198,
        f: 32,
      },
    ];

    for (const t of nodeTiles) {
      this.load.spritesheet(`tile_${t.id}`, '/' + t.file, {
        frameWidth: t.w,
        frameHeight: t.h,
        endFrame: t.f - 1,
      });
      this.load.image(`icon_${t.id}`, '/' + t.icon);
    }
  }

  create() {
    // 0. Sandy Floor / Background TileSprite
    this.floorTile = this.add.tileSprite(500, 360, 3600, 2400, 'sandy_floor').setDepth(0);

    // 1. Graphics layers in depth order
    this.bgGfx = this.add.graphics().setDepth(1);
    this.borderGfx = this.add.graphics().setDepth(2);
    this.labelsContainer = this.add.container(0, 0).setDepth(2.5);
    this.connectionsGfx = this.add.graphics().setDepth(3);
    this.routesGfx = this.add.graphics().setDepth(4);
    this.vehiclesContainer = this.add.container(0, 0).setDepth(5);
    this.nodesContainer = this.add.container(0, 0).setDepth(6);

    this.createStaticRegionLabels();
    this.setupCameraControls();

    // Subscribe to simulation updates
    this.port.subscribe((snapshot) => {
      this.currentSnapshot = snapshot;
      this.renderWorld(snapshot);
    });

    // Center camera on world center
    this.cameras.main.centerOn(500, 370);
    this.cameras.main.setZoom(1.05);

    // Initial render
    this.renderWorld(this.currentSnapshot);
  }

  update(_time: number, delta: number) {
    scheduler.update(delta);
  }

  private createStaticRegionLabels() {
    const textStyle = {
      fontFamily: 'Rajdhani, -apple-system, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#f8fafc',
      backgroundColor: '#0f172aee',
      padding: { x: 8, y: 4 },
    };

    // UK Label
    const ukText = this.add.text(40, 45, '🇬🇧 UNITED KINGDOM (UK) — FINAL DESTINATION', {
      ...textStyle,
      color: '#38bdf8',
    });
    this.labelsContainer.add(ukText);

    // Channel Border Label
    const channelText = this.add.text(500, 192, '🌊 ENGLISH CHANNEL MARITIME BORDER — PASSAGE TO UK', {
      ...textStyle,
      color: '#facc15',
    });
    channelText.setOrigin(0.5, 0);
    this.labelsContainer.add(channelText);

    // West Europe Label
    const eurText = this.add.text(40, 235, '🇪🇺 WEST EUROPE — TRANSIT & DESTINATION', {
      ...textStyle,
      color: '#4ade80',
    });
    this.labelsContainer.add(eurText);

    // Mediterranean Sea Border Label
    const medText = this.add.text(500, 492, '🌊 MEDITERRANEAN SEA BORDER — AFRICA ➔ EUROPE', {
      ...textStyle,
      color: '#facc15',
    });
    medText.setOrigin(0.5, 0);
    this.labelsContainer.add(medText);

    // North Africa Label
    const afrText = this.add.text(40, 535, '🌍 NORTH AFRICA — CHUMIGRANT ORIGINS', {
      ...textStyle,
      color: '#fb923c',
    });
    this.labelsContainer.add(afrText);
  }

  private setupCameraControls() {
    let pointerDownTime = 0;
    let pointerDownPos = { x: 0, y: 0 };

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown() || pointer.middleButtonDown()) {
        this.isDragging = true;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.cameraStartX = this.cameras.main.scrollX;
        this.cameraStartY = this.cameras.main.scrollY;
        pointerDownTime = Date.now();
        pointerDownPos = { x: pointer.x, y: pointer.y };
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        const zoom = this.cameras.main.zoom;
        this.cameras.main.scrollX = this.cameraStartX - (pointer.x - this.dragStartX) / zoom;
        this.cameras.main.scrollY = this.cameraStartY - (pointer.y - this.dragStartY) / zoom;
      }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.isDragging = false;

      // Click on empty ground deselects all gangs and hides everything
      const moved = Math.hypot(pointer.x - pointerDownPos.x, pointer.y - pointerDownPos.y);
      const duration = Date.now() - pointerDownTime;
      if (moved < 5 && duration < 300) {
        const hitObjects = this.input.hitTestPointer(pointer);
        if (hitObjects.length === 0) {
          this.setSelectedGangs(new Set());
          if (this.eventsHandler.onDeselectAll) {
            this.eventsHandler.onDeselectAll();
          }
        }
      }
    });

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _obj: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const zoomFactor = dy > 0 ? 0.9 : 1.12;
      const newZoom = Phaser.Math.Clamp(cam.zoom * zoomFactor, 0.4, 2.5);

      const mouseWorldX = (pointer.x - cam.width / 2) / cam.zoom + cam.midPoint.x;
      const mouseWorldY = (pointer.y - cam.height / 2) / cam.zoom + cam.midPoint.y;

      cam.setZoom(newZoom);
      cam.centerOn(mouseWorldX, mouseWorldY);
      const targetMidX = mouseWorldX - (pointer.x - cam.width / 2) / newZoom;
      const targetMidY = mouseWorldY - (pointer.y - cam.height / 2) / newZoom;
      cam.centerOn(targetMidX, targetMidY);
    });
  }

  /**
   * Gang Selection:
   * Multi-gang selection support.
   */
  setSelectedGangs(gangIds: Set<string>) {
    this.selectedGangIds = new Set(gangIds);
    this.selectedRouteId = null;
    this.renderWorld(this.currentSnapshot);
  }

  setSelectedGang(gangId: string | null) {
    if (gangId === null) {
      this.selectedGangIds.clear();
    } else {
      this.selectedGangIds = new Set([gangId]);
    }
    this.selectedRouteId = null;
    this.renderWorld(this.currentSnapshot);
  }

  toggleGang(gangId: string) {
    if (this.selectedGangIds.has(gangId)) {
      this.selectedGangIds.delete(gangId);
    } else {
      this.selectedGangIds.add(gangId);
    }
    this.selectedRouteId = null;
    this.renderWorld(this.currentSnapshot);
  }

  getSelectedGangs(): Set<string> {
    return this.selectedGangIds;
  }

  focusLocation(locId: string) {
    const loc = this.currentSnapshot.locations[locId];
    if (loc) {
      this.cameras.main.pan(loc.x, loc.y, 500, 'Cubic.easeOut');
    }
  }

  // ==================== RENDERING PIPELINE ====================
  renderWorld(snapshot: WorldSnapshot) {
    this.renderRegionsBackdrop(snapshot);
    this.renderPhysicalConnections(snapshot);
    this.renderLocations(snapshot);
    this.renderParallelRoutes(snapshot);
    this.renderVoyageVehicles(snapshot);
  }

  private renderRegionsBackdrop(_snapshot: WorldSnapshot) {
    const gfx = this.bgGfx;
    gfx.clear();

    const worldW = 1400;
    const startX = -200;

    // 1. UK Region (North: y: -100 to 205) - Oceanic Navy
    gfx.fillStyle(0x0c1b2e, 0.55);
    gfx.fillRect(startX, -100, worldW, 305);

    // 2. West Europe Region (Middle: y: 205 to 505) - Slate / Pine
    gfx.fillStyle(0x0d2222, 0.45);
    gfx.fillRect(startX, 205, worldW, 300);

    // 3. North Africa Region (South: y: 505 to 800) - Warm Clay / Amber
    gfx.fillStyle(0x291910, 0.55);
    gfx.fillRect(startX, 505, worldW, 295);

    // Subtle grid lines
    gfx.lineStyle(1, 0x0f172a, 0.25);
    for (let x = startX; x <= startX + worldW; x += 64) {
      gfx.lineBetween(x, -100, x, 750);
    }
    for (let y = -100; y <= 750; y += 64) {
      gfx.lineBetween(startX, y, startX + worldW, y);
    }

    // High-visibility Regional Maritime Borders
    const bgBorder = this.borderGfx;
    bgBorder.clear();

    // English Channel Border (y: 205)
    bgBorder.fillStyle(0x0284c7, 0.25);
    bgBorder.fillRect(startX, 195, worldW, 20);

    bgBorder.lineStyle(6, 0x090d16, 0.9);
    bgBorder.lineBetween(startX, 205, startX + worldW, 205);

    bgBorder.lineStyle(2.5, 0x38bdf8, 0.85);
    for (let x = startX; x < startX + worldW; x += 28) {
      bgBorder.lineBetween(x, 205, x + 18, 205);
    }

    // Mediterranean Sea Border (y: 505)
    bgBorder.fillStyle(0x0284c7, 0.25);
    bgBorder.fillRect(startX, 495, worldW, 20);

    bgBorder.lineStyle(6, 0x090d16, 0.9);
    bgBorder.lineBetween(startX, 505, startX + worldW, 505);

    bgBorder.lineStyle(2.5, 0xfacc15, 0.85);
    for (let x = startX; x < startX + worldW; x += 28) {
      bgBorder.lineBetween(x, 505, x + 18, 505);
    }
  }

  private renderPhysicalConnections(snapshot: WorldSnapshot) {
    const gfx = this.connectionsGfx;
    gfx.clear();

    // If no gang selected, connections are hidden
    if (this.selectedGangIds.size === 0) {
      return;
    }

    // Only draw connections belonging to selected gangs
    for (const conn of Object.values(snapshot.connections)) {
      const src = snapshot.locations[conn.sourceId];
      const tgt = snapshot.locations[conn.targetId];
      if (!src || !tgt) continue;
      if (!this.selectedGangIds.has(src.gangId) || !this.selectedGangIds.has(tgt.gangId)) continue;

      if (conn.mode === 'SEA') {
        gfx.lineStyle(2, 0x0284c7, 0.35);
      } else {
        gfx.lineStyle(2, 0x475569, 0.4);
      }
      gfx.lineBetween(src.x, src.y, tgt.x, tgt.y);
    }
  }

  /**
   * Locations Rendering:
   * "all nodes are owned by a single gang, can only be used by that gang"
   * "for gangs- i should be able to select the gang to see the gang's stuff, deselect to hide everything."
   */
  private renderLocations(snapshot: WorldSnapshot) {
    for (const loc of Object.values(snapshot.locations)) {
      let container = this.locationContainers.get(loc.id);
      if (!container) {
        container = this.createLocationNode(loc, snapshot);
        this.locationContainers.set(loc.id, container);
        this.nodesContainer.add(container);
      }

      // Visibility Rule:
      // Show nodes owned by ANY currently selected gang
      const isVisible = this.selectedGangIds.has(loc.gangId);
      container.setVisible(isVisible);

      if (isVisible) {
        this.updateLocationNode(container, loc, snapshot);
      }
    }
  }

  private createLocationNode(loc: LocationDef, snapshot: WorldSnapshot): Phaser.GameObjects.Container {
    const container = this.add.container(loc.x, loc.y);

    // Foundation Base Box
    const baseGfx = this.add.graphics();
    baseGfx.setName('baseGfx');
    container.add(baseGfx);

    // Animated machine tile from tiles-demo
    const tileKey = `tile_${loc.tileFamily}`;
    const animKey = `anim_${loc.tileFamily}`;

    if (this.textures.exists(tileKey)) {
      if (loc.tileFamily === 'crusher') {
        // Recruiter node: crusher mk3
        if (!this.anims.exists(animKey)) {
          this.anims.create({
            key: animKey,
            frames: this.anims.generateFrameNumbers(tileKey, { start: 0, end: 31 }),
            frameRate: 20,
            repeat: -1,
          });
        }
        const sprite = this.add.sprite(0, -6, tileKey);
        sprite.setScale(0.46);
        sprite.play(animKey);
        container.add(sprite);
      } else if (loc.tileFamily === 'logistics-hub') {
        // HQ node: logistics-hub mk1
        if (!this.anims.exists(animKey)) {
          this.anims.create({
            key: animKey,
            frames: this.anims.generateFrameNumbers(tileKey, { start: 0, end: 15 }),
            frameRate: 16,
            repeat: -1,
          });
        }
        const sprite = this.add.sprite(0, -6, tileKey);
        sprite.setScale(0.32);
        sprite.play(animKey);
        container.add(sprite);
      } else if (loc.tileFamily === 'industrial-press') {
        // Workshop node: industrial-press mk1
        if (!this.anims.exists(animKey)) {
          this.anims.create({
            key: animKey,
            frames: this.anims.generateFrameNumbers(tileKey, { start: 0, end: 31 }),
            frameRate: 20,
            repeat: -1,
          });
        }
        const sprite = this.add.sprite(0, -4, tileKey);
        sprite.setScale(0.35);
        sprite.play(animKey);
        container.add(sprite);
      } else {
        // Depot node: pressure-tank mk1 (1 frame)
        const sprite = this.add.sprite(0, -4, tileKey, 0);
        sprite.setScale(0.35);
        container.add(sprite);
      }
    } else if (this.textures.exists(`icon_${loc.tileFamily}`)) {
      const icon = this.add.image(0, -4, `icon_${loc.tileFamily}`);
      icon.setScale(0.7);
      container.add(icon);
    }

    // Nameplate Text
    const nameText = this.add.text(0, 44, loc.name, {
      fontFamily: 'Rajdhani, "Segoe UI", -apple-system, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#f8fafc',
      stroke: '#090d16',
      strokeThickness: 1.5,
      align: 'center',
    });
    nameText.setOrigin(0.5, 0);
    nameText.setResolution(2);
    container.add(nameText);

    // Badges / waiting chums count
    const badgeGfx = this.add.graphics();
    badgeGfx.setName('badgeGfx');
    container.add(badgeGfx);

    const countText = this.add.text(0, -46, '', {
      fontFamily: '"JetBrains Mono", Consolas, monospace',
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#38bdf8',
    });
    countText.setName('countText');
    countText.setOrigin(0.5, 0.5);
    countText.setResolution(2);
    container.add(countText);

    // Interactive Hit Zone
    const hitZone = this.add.zone(0, 0, 76, 76);
    hitZone.setInteractive({ cursor: 'pointer' });
    hitZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.selectedLocationId = loc.id;
      if (loc.gangId) {
        this.selectedGangIds.add(loc.gangId);
        this.renderWorld(this.currentSnapshot);
        const gang = this.currentSnapshot.gangs[loc.gangId];
        if (gang && this.eventsHandler.onSelectGang) {
          this.eventsHandler.onSelectGang(gang, this.currentSnapshot);
        }
      }
      if (this.eventsHandler.onSelectLocation) {
        this.eventsHandler.onSelectLocation(loc, this.currentSnapshot);
      }
    });
    container.add(hitZone);

    this.updateLocationNode(container, loc, snapshot);
    return container;
  }

  private updateLocationNode(
    container: Phaser.GameObjects.Container,
    loc: LocationDef,
    snapshot: WorldSnapshot
  ) {
    const baseGfx = container.getByName('baseGfx') as Phaser.GameObjects.Graphics;
    const badgeGfx = container.getByName('badgeGfx') as Phaser.GameObjects.Graphics;
    const countText = container.getByName('countText') as Phaser.GameObjects.Text;
    if (!baseGfx || !badgeGfx || !countText) return;

    baseGfx.clear();
    badgeGfx.clear();

    const gang = snapshot.gangs[loc.gangId];
    const strokeColor = gang ? gang.colorNum : 0x475569;

    baseGfx.fillStyle(0x0f172a, 0.95);
    baseGfx.fillRoundedRect(-36, -36, 72, 72, 8);
    baseGfx.lineStyle(2, strokeColor, 0.9);
    baseGfx.strokeRoundedRect(-36, -36, 72, 72, 8);

    if (loc.kind === 'HQ' && gang) {
      badgeGfx.fillStyle(gang.colorNum, 1);
      badgeGfx.fillCircle(28, -28, 12);
      badgeGfx.lineStyle(1.5, 0xffffff, 0.9);
      badgeGfx.strokeCircle(28, -28, 12);
    }

    if (loc.kind === 'RECRUITER') {
      // Waiting Chums at this Recruiter (crusher mk3)
      const chumsHere = Object.values(snapshot.chumigrants).filter(
        (c) => c.originId === loc.id && (c.status === 'WAITING' || c.status === 'RECRUITED')
      );

      if (chumsHere.length > 0) {
        countText.setText(`👤 ${chumsHere.length}`);
        badgeGfx.fillStyle(0x0f172a, 0.9);
        badgeGfx.fillRoundedRect(-24, -54, 48, 18, 4);
        badgeGfx.lineStyle(1.5, gang ? gang.colorNum : 0x38bdf8, 0.85);
        badgeGfx.strokeRoundedRect(-24, -54, 48, 18, 4);
      } else {
        countText.setText('');
      }
    } else if (loc.kind === 'DEPOT') {
      // Arrived Chums remaining safely in this Depot (pressure-tank mk1)
      const chumsHere = Object.values(snapshot.chumigrants).filter(
        (c) => c.originId === loc.id && c.status === 'ARRIVED'
      );

      if (chumsHere.length > 0) {
        countText.setText(`📦 ${chumsHere.length}`);
        badgeGfx.fillStyle(0x0f172a, 0.9);
        badgeGfx.fillRoundedRect(-24, -54, 48, 18, 4);
        badgeGfx.lineStyle(1.5, 0x10b981, 0.85);
        badgeGfx.strokeRoundedRect(-24, -54, 48, 18, 4);
      } else {
        countText.setText('');
      }
    } else {
      countText.setText('');
    }
  }

  /**
   * Route Services:
   * Recruiter -> Depot ONLY!
   * 1 route max between nodes.
   * Only rendered when owning gang is selected.
   */
  private renderParallelRoutes(snapshot: WorldSnapshot) {
    const gfx = this.routesGfx;
    gfx.clear();

    if (this.selectedGangIds.size === 0) {
      for (const zone of this.routeHitZones.values()) {
        zone.destroy();
      }
      this.routeHitZones.clear();
      return;
    }

    // Only render routes owned by ANY selected gang!
    const routesToRender = Object.values(snapshot.routes).filter(
      (r) => this.selectedGangIds.has(r.gangId) && (r.status === 'ACTIVE' || r.activeVoyageCount > 0)
    );

    // Clean old hit zones
    const activeRouteIds = new Set(routesToRender.map((r) => r.id));
    for (const [id, zone] of this.routeHitZones.entries()) {
      if (!activeRouteIds.has(id)) {
        zone.destroy();
        this.routeHitZones.delete(id);
      }
    }

    for (const route of routesToRender) {
      const src = snapshot.locations[route.sourceId];
      const tgt = snapshot.locations[route.targetId];
      if (!src || !tgt) continue;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) continue;

      const gang = snapshot.gangs[route.gangId];
      const isSelected = this.selectedRouteId === route.id;
      const color = gang ? gang.colorNum : 0x38bdf8;
      const alpha = isSelected ? 1.0 : 0.9;
      const lineWidth = isSelected ? 4.5 : 3.0;

      gfx.lineStyle(lineWidth, color, alpha);
      gfx.lineBetween(src.x, src.y, tgt.x, tgt.y);

      // Direction Arrow in middle
      const midX = (src.x + tgt.x) / 2;
      const midY = (src.y + tgt.y) / 2;
      const arrowAngle = Math.atan2(dy, dx);
      const arrowLen = 8;

      gfx.lineStyle(2, color, alpha);
      gfx.beginPath();
      gfx.moveTo(midX, midY);
      gfx.lineTo(
        midX - arrowLen * Math.cos(arrowAngle - Math.PI / 6),
        midY - arrowLen * Math.sin(arrowAngle - Math.PI / 6)
      );
      gfx.moveTo(midX, midY);
      gfx.lineTo(
        midX - arrowLen * Math.cos(arrowAngle + Math.PI / 6),
        midY - arrowLen * Math.sin(arrowAngle + Math.PI / 6)
      );
      gfx.strokePath();

      // Hit zone
      let zone = this.routeHitZones.get(route.id);
      if (!zone) {
        zone = this.add.zone(midX, midY, Math.max(dist, 40), 16);
        zone.setRotation(arrowAngle);
        zone.setInteractive({ cursor: 'pointer' });
        zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          pointer.event.stopPropagation();
          this.selectedRouteId = route.id;
          this.renderWorld(this.currentSnapshot);
          if (this.eventsHandler.onSelectRoute) {
            this.eventsHandler.onSelectRoute(route, this.currentSnapshot);
          }
        });
        this.routeHitZones.set(route.id, zone);
      } else {
        zone.setPosition(midX, midY);
        zone.setRotation(arrowAngle);
        zone.setSize(dist, 16);
      }
    }
  }

  /**
   * Voyage Vehicles:
   * Recruiter -> Depot ONLY.
   * Rendered when owning gang is selected.
   */
  private renderVoyageVehicles(snapshot: WorldSnapshot) {
    if (this.selectedGangIds.size === 0) {
      for (const container of this.vehicleSprites.values()) {
        container.destroy();
      }
      this.vehicleSprites.clear();
      return;
    }

    const activeVoyages = Object.values(snapshot.voyages).filter(
      (v) => v.status === 'IN_PROGRESS' && this.selectedGangIds.has(v.gangId)
    );
    const activeIds = new Set(activeVoyages.map((v) => v.id));

    // Remove finished vehicles
    for (const [id, container] of this.vehicleSprites.entries()) {
      if (!activeIds.has(id)) {
        container.destroy();
        this.vehicleSprites.delete(id);
      }
    }

    // Update active vehicles along their route line
    for (const voyage of activeVoyages) {
      const route = snapshot.routes[voyage.routeId];
      const gang = snapshot.gangs[voyage.gangId];
      const src = snapshot.locations[voyage.sourceId];
      const tgt = snapshot.locations[voyage.targetId];
      if (!route || !src || !tgt) continue;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const posX = src.x + dx * voyage.progress;
      const posY = src.y + dy * voyage.progress;
      const angle = Math.atan2(dy, dx);

      let container = this.vehicleSprites.get(voyage.id);
      if (!container) {
        container = this.createVehicleSprite(voyage, gang);
        this.vehicleSprites.set(voyage.id, container);
        this.vehiclesContainer.add(container);
      }

      container.setPosition(posX, posY);

      const body = container.getByName('vehicleBody') as Phaser.GameObjects.Graphics;
      if (body) {
        body.setRotation(angle);
      }

      const badge = container.getByName('passengerBadge') as Phaser.GameObjects.Text;
      if (badge) {
        badge.setText(`×${voyage.passengerIds.length}`);
      }
    }
  }

  private createVehicleSprite(voyage: VoyageState, gang?: GangState): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);

    const gfx = this.add.graphics();
    gfx.setName('vehicleBody');
    const color = gang ? gang.colorNum : 0x38bdf8;

    if (voyage.mode === 'BOAT') {
      gfx.fillStyle(color, 1);
      gfx.beginPath();
      gfx.moveTo(12, 0);
      gfx.lineTo(-8, -6);
      gfx.lineTo(-12, 0);
      gfx.lineTo(-8, 6);
      gfx.closePath();
      gfx.fillPath();
      gfx.lineStyle(1.5, 0xffffff, 0.9);
      gfx.strokePath();

      gfx.fillStyle(0x0f172a, 1);
      gfx.fillRoundedRect(-4, -3, 8, 6, 2);
    } else {
      gfx.fillStyle(color, 1);
      gfx.fillRoundedRect(-11, -6, 22, 12, 3);
      gfx.lineStyle(1.5, 0xffffff, 0.9);
      gfx.strokeRoundedRect(-11, -6, 22, 12, 3);

      gfx.fillStyle(0x0f172a, 1);
      gfx.fillRect(3, -4, 4, 8);
    }

    container.add(gfx);

    // Passenger count badge - upright, never rotated
    const badge = this.add.text(0, -15, `×${voyage.passengerIds.length}`, {
      fontFamily: '"JetBrains Mono", Consolas, monospace',
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#ffffff',
      backgroundColor: '#0f172a',
      padding: { x: 3, y: 1 },
    });
    badge.setName('passengerBadge');
    badge.setOrigin(0.5, 0.5);
    badge.setRotation(0);
    badge.setResolution(2);
    container.add(badge);

    const hit = this.add.zone(0, 0, 26, 26);
    hit.setInteractive({ cursor: 'pointer' });
    hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      if (this.eventsHandler.onSelectVoyage) {
        this.eventsHandler.onSelectVoyage(voyage, this.currentSnapshot);
      }
    });
    container.add(hit);

    return container;
  }
}
