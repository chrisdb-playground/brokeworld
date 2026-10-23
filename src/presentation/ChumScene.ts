import Phaser from 'phaser';
import type { GamePort } from '../app/GamePort';
import { engine, scheduler } from '../app/state';
import type {
  ChumigrantState,
  GangState,
  LocationDef,
  LocationKind,
  RegionId,
  RouteServiceState,
  VoyageState,
  WorldSnapshot,
} from '../sim/types';
import {
  BASE_HQ_INFLUENCE_RADIUS,
  REGION_BOUNDS,
  WATER_ZONES,
  getRegionForY,
  canPurchaseNode,
} from '../sim/influence';

export interface SceneSelectionEvents {
  onSelectLocation?: (location: LocationDef, snapshot: WorldSnapshot) => void;
  onSelectRoute?: (route: RouteServiceState, snapshot: WorldSnapshot) => void;
  onSelectGang?: (gang: GangState, snapshot: WorldSnapshot) => void;
  onSelectVoyage?: (voyage: VoyageState, snapshot: WorldSnapshot) => void;
  onSelectChum?: (chum: ChumigrantState, snapshot: WorldSnapshot) => void;
  onDeselectAll?: () => void;
  onCancelPlacement?: () => void;
  onInfluenceToggled?: (visible: boolean) => void;
}

/**
 * Mathematically draws a circular shape strictly clipped to a horizontal band [yMin, yMax].
 * RULE: "influence zones should not cross border"
 * Guarantees that neither fill nor stroke ever bleeds past regional borders or into water.
 */
function drawClippedCircle(
  gfx: Phaser.GameObjects.Graphics,
  xc: number,
  yc: number,
  r: number,
  yMin: number,
  yMax: number,
  isStroke = false
): void {
  if (r <= 0) return;
  // If entirely outside the vertical region band:
  if (yc + r <= yMin || yc - r >= yMax) {
    return;
  }

  // If entirely inside the region band (no clipping needed):
  if (yc - r >= yMin && yc + r <= yMax) {
    if (isStroke) {
      gfx.strokeCircle(xc, yc, r);
    } else {
      gfx.fillCircle(xc, yc, r);
    }
    return;
  }

  const topClipped = yc - r < yMin;
  const bottomClipped = yc + r > yMax;

  let topThetaRight = 0;
  let topThetaLeft = 0;
  if (topClipped) {
    const dy = yMin - yc;
    const sinVal = Math.min(1, Math.max(-1, dy / r));
    const asinVal = Math.asin(sinVal);
    topThetaRight = asinVal;
    topThetaLeft = -Math.PI - asinVal;
  }

  let bottomThetaRight = 0;
  let bottomThetaLeft = 0;
  if (bottomClipped) {
    const dy = yMax - yc;
    const sinVal = Math.min(1, Math.max(-1, dy / r));
    const asinVal = Math.asin(sinVal);
    bottomThetaRight = asinVal;
    bottomThetaLeft = Math.PI - asinVal;
  }

  const points: { x: number; y: number }[] = [];

  if (topClipped && !bottomClipped) {
    const startA = (topThetaRight + 2 * Math.PI) % (2 * Math.PI);
    const endA = (topThetaLeft + 2 * Math.PI) % (2 * Math.PI);
    const sweep = (endA - startA + 2 * Math.PI) % (2 * Math.PI);
    const steps = Math.max(16, Math.round(sweep * 8));
    for (let i = 0; i <= steps; i++) {
      const a = startA + (sweep * i) / steps;
      points.push({
        x: xc + r * Math.cos(a),
        y: Math.max(yMin, Math.min(yMax, yc + r * Math.sin(a))),
      });
    }
  } else if (!topClipped && bottomClipped) {
    const startA = bottomThetaLeft;
    const endA = (bottomThetaRight + 2 * Math.PI) % (2 * Math.PI);
    const sweep = (endA - startA + 2 * Math.PI) % (2 * Math.PI);
    const steps = Math.max(16, Math.round(sweep * 8));
    for (let i = 0; i <= steps; i++) {
      const a = startA + (sweep * i) / steps;
      points.push({
        x: xc + r * Math.cos(a),
        y: Math.max(yMin, Math.min(yMax, yc + r * Math.sin(a))),
      });
    }
  } else if (topClipped && bottomClipped) {
    const startR = (topThetaRight + 2 * Math.PI) % (2 * Math.PI);
    const endR = bottomThetaRight;
    const sweepR = (endR - startR + 2 * Math.PI) % (2 * Math.PI);
    const stepsR = Math.max(8, Math.round(sweepR * 8));
    for (let i = 0; i <= stepsR; i++) {
      const a = startR + (sweepR * i) / stepsR;
      points.push({
        x: xc + r * Math.cos(a),
        y: Math.max(yMin, Math.min(yMax, yc + r * Math.sin(a))),
      });
    }
    const startL = bottomThetaLeft;
    const endL = (topThetaLeft + 2 * Math.PI) % (2 * Math.PI);
    const sweepL = (endL - startL + 2 * Math.PI) % (2 * Math.PI);
    const stepsL = Math.max(8, Math.round(sweepL * 8));
    for (let i = 0; i <= stepsL; i++) {
      const a = startL + (sweepL * i) / stepsL;
      points.push({
        x: xc + r * Math.cos(a),
        y: Math.max(yMin, Math.min(yMax, yc + r * Math.sin(a))),
      });
    }
  }

  if (points.length < 3) return;

  gfx.beginPath();
  gfx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    gfx.lineTo(points[i].x, points[i].y);
  }
  gfx.closePath();

  if (isStroke) {
    gfx.strokePath();
  } else {
    gfx.fillPath();
  }
}

export class ChumScene extends Phaser.Scene {
  private port!: GamePort;
  private eventsHandler: SceneSelectionEvents = {};
  private currentSnapshot!: WorldSnapshot;

  // Graphics layers
  private floorTile!: Phaser.GameObjects.TileSprite;
  private channelWaterTile!: Phaser.GameObjects.TileSprite;
  private medWaterTile!: Phaser.GameObjects.TileSprite;
  private bgGfx!: Phaser.GameObjects.Graphics;
  private influenceGfxUk!: Phaser.GameObjects.Graphics;
  private influenceGfxEur!: Phaser.GameObjects.Graphics;
  private influenceGfxAfr!: Phaser.GameObjects.Graphics;
  private isInfluenceZoneVisible = true;
  private borderGfx!: Phaser.GameObjects.Graphics;
  private connectionsGfx!: Phaser.GameObjects.Graphics;
  private routesGfx!: Phaser.GameObjects.Graphics;
  private vehiclesContainer!: Phaser.GameObjects.Container;
  private nodesContainer!: Phaser.GameObjects.Container;
  private labelsContainer!: Phaser.GameObjects.Container;
  private placementGfx!: Phaser.GameObjects.Graphics;
  private placementMode: {
    gangId: string;
    kind: LocationKind;
    cost: number;
    region?: RegionId;
  } | null = null;

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
  private selectedGangIds: Set<string> = new Set();
  private selectedRouteId: string | null = null;
  private selectedLocationId: string | null = null;
  private selectedVoyageId: string | null = null;
  private justSelectedInteractiveObject = false;
  private lastHqSignature = '';
  private isSceneReady = false;

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

    // Default: select all active gangs so all nodes and routes are immediately visible
    for (const gang of Object.values(this.currentSnapshot.gangs)) {
      if (gang.status === 'ACTIVE') {
        this.selectedGangIds.add(gang.id);
      }
    }
  }

  preload() {
    // Preload sandy floor background and water tile
    this.load.image('sandy_floor', '/sandy.png');
    this.load.image('water_tile', '/water-tile.png');

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
    this.floorTile = this.add.tileSprite(600, 500, 4200, 3200, 'sandy_floor').setDepth(0);

    // 0.5. Water Tile Sprites separating regions
    // English Channel Water (y: 140 to 280, height: 140px, center: 210)
    this.channelWaterTile = this.add.tileSprite(600, 210, 4200, 140, 'water_tile').setDepth(0.5);
    this.channelWaterTile.setAlpha(0.92);

    // Mediterranean Sea Water (y: 660 to 860, height: 200px, center: 760)
    this.medWaterTile = this.add.tileSprite(600, 760, 4200, 200, 'water_tile').setDepth(0.5);
    this.medWaterTile.setAlpha(0.92);

    // 1. Graphics layers in depth order
    this.bgGfx = this.add.graphics().setDepth(1);

    // Influence Heatmap Layers (Depth 1.4, strictly masked per region)
    // Rule: "heat map stops at border."
    const worldW = 1800;
    const startX = -300;

    // UK Influence Mask (y: -100 to 160)
    this.influenceGfxUk = this.add.graphics().setDepth(1.4);
    const maskGfxUk = this.make.graphics();
    maskGfxUk.fillRect(startX, REGION_BOUNDS.UK.yMin, worldW, REGION_BOUNDS.UK.yMax - REGION_BOUNDS.UK.yMin);
    this.influenceGfxUk.setMask(new Phaser.Display.Masks.GeometryMask(this, maskGfxUk));

    // Europe Influence Mask (y: 215 to 485)
    this.influenceGfxEur = this.add.graphics().setDepth(1.4);
    const maskGfxEur = this.make.graphics();
    maskGfxEur.fillRect(startX, REGION_BOUNDS.EUROPE.yMin, worldW, REGION_BOUNDS.EUROPE.yMax - REGION_BOUNDS.EUROPE.yMin);
    this.influenceGfxEur.setMask(new Phaser.Display.Masks.GeometryMask(this, maskGfxEur));

    // Africa Influence Mask (y: 565 to 820)
    this.influenceGfxAfr = this.add.graphics().setDepth(1.4);
    const maskGfxAfr = this.make.graphics();
    maskGfxAfr.fillRect(startX, REGION_BOUNDS.AFRICA.yMin, worldW, REGION_BOUNDS.AFRICA.yMax - REGION_BOUNDS.AFRICA.yMin);
    this.influenceGfxAfr.setMask(new Phaser.Display.Masks.GeometryMask(this, maskGfxAfr));

    this.borderGfx = this.add.graphics().setDepth(2);
    this.labelsContainer = this.add.container(0, 0).setDepth(2.5);
    this.connectionsGfx = this.add.graphics().setDepth(3);
    this.routesGfx = this.add.graphics().setDepth(4);
    this.vehiclesContainer = this.add.container(0, 0).setDepth(5);
    this.nodesContainer = this.add.container(0, 0).setDepth(6);
    this.placementGfx = this.add.graphics().setDepth(10);

    this.createStaticRegionLabels();
    this.setupCameraControls();

    // Hotkey toggles for influence zones (I or H)
    this.input.keyboard?.on('keydown-I', () => {
      this.toggleInfluence();
    });
    this.input.keyboard?.on('keydown-H', () => {
      this.toggleInfluence();
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      this.cancelPlacementMode();
    });
    this.input.keyboard?.on('keydown-R', () => {
      scheduler.reset();
      const spdBtns = document.querySelectorAll<HTMLButtonElement>('.spd-btn[data-speed]');
      spdBtns.forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-speed') === '1');
      });
    });

    // Subscribe to simulation updates
    this.port.subscribe((snapshot) => {
      this.currentSnapshot = snapshot;
      this.renderWorld(snapshot);
    });

    // Center camera on world center for spacious multi-region layout
    this.cameras.main.centerOn(600, 500);
    this.cameras.main.setZoom(0.74);

    // Mark scene as ready
    this.isSceneReady = true;

    // Initial render (backdrop once, then dynamic layers)
    this.renderRegionsBackdrop();
    this.renderWorld(this.currentSnapshot);
  }

  update(_time: number, delta: number) {
    if (this.channelWaterTile) {
      this.channelWaterTile.tilePositionX += delta * 0.015;
    }
    if (this.medWaterTile) {
      this.medWaterTile.tilePositionX -= delta * 0.012;
    }
    scheduler.update(delta);
  }

  private createStaticRegionLabels() {
    this.labelsContainer.removeAll(true);

    const titleStyle = {
      fontFamily: 'Rajdhani, -apple-system, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#f8fafc',
      backgroundColor: '#0f172aee',
      padding: { x: 8, y: 4 },
    };

    const borderStyle = {
      fontFamily: 'Rajdhani, -apple-system, sans-serif',
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#f8fafc',
      padding: { x: 6, y: 3 },
    };

    // 1. UK Region Title
    this.labelsContainer.add(
      this.add.text(20, -10, '🇬🇧 UNITED KINGDOM (UK) — FINAL DESTINATION', {
        ...titleStyle,
        color: '#38bdf8',
      })
    );

    // 2. English Channel Borders (2 Sides: IN to UK, OUT of Europe)
    // Border IN to UK (North edge of channel at y = 140)
    const ukBorderText = this.add.text(420, 128, '▼ BORDER IN TO UK — DOVER MARITIME ENTRY', {
      ...borderStyle,
      color: '#38bdf8',
      backgroundColor: '#0c2a47ee',
    });
    ukBorderText.setOrigin(0.5, 1);
    this.labelsContainer.add(ukBorderText);

    // Center Channel Water Label
    const channelSeaText = this.add.text(420, 210, '🌊 ENGLISH CHANNEL MARITIME CORRIDOR — WATER PASSAGE TO UK', {
      ...borderStyle,
      fontSize: '11px',
      color: '#7dd3fc',
      backgroundColor: '#0369a199',
    });
    channelSeaText.setOrigin(0.5, 0.5);
    this.labelsContainer.add(channelSeaText);

    // Border OUT of Europe (South edge of channel at y = 280)
    const eurNorthBorderText = this.add.text(420, 292, '▲ BORDER OUT OF EUROPE — CHANNEL DEPARTURE PERIMETER', {
      ...borderStyle,
      color: '#4ade80',
      backgroundColor: '#064e3bee',
    });
    eurNorthBorderText.setOrigin(0.5, 0);
    this.labelsContainer.add(eurNorthBorderText);

    // 3. West Europe Region Title
    this.labelsContainer.add(
      this.add.text(20, 300, '🇪🇺 WEST EUROPE — TRANSIT & DESTINATION', {
        ...titleStyle,
        color: '#4ade80',
      })
    );

    // 4. Mediterranean Sea Borders (2 Sides: IN to Europe, OUT of Africa)
    // Border IN to Europe (North edge of Mediterranean at y = 660)
    const eurSouthBorderText = this.add.text(420, 648, '▼ BORDER IN TO EUROPE — MEDITERRANEAN ENTRY CHECKPOINT', {
      ...borderStyle,
      color: '#4ade80',
      backgroundColor: '#064e3bee',
    });
    eurSouthBorderText.setOrigin(0.5, 1);
    this.labelsContainer.add(eurSouthBorderText);

    // Center Mediterranean Sea Label
    const medSeaText = this.add.text(420, 760, '🌊 MEDITERRANEAN SEA WATERS — CROSS-BORDER BOAT CORRIDOR', {
      ...borderStyle,
      fontSize: '11px',
      color: '#fde047',
      backgroundColor: '#854d0e99',
    });
    medSeaText.setOrigin(0.5, 0.5);
    this.labelsContainer.add(medSeaText);

    // Border OUT of Africa (South edge of Mediterranean at y = 860)
    const afrBorderText = this.add.text(420, 872, '▲ BORDER OUT OF AFRICA — MARITIME DEPARTURE BORDER', {
      ...borderStyle,
      color: '#fb923c',
      backgroundColor: '#7c2d12ee',
    });
    afrBorderText.setOrigin(0.5, 0);
    this.labelsContainer.add(afrBorderText);

    // 5. North Africa Region Title
    this.labelsContainer.add(
      this.add.text(20, 880, '🌍 NORTH AFRICA — CHUMIGRANT ORIGINS', {
        ...titleStyle,
        color: '#fb923c',
      })
    );
  }

  private setupCameraControls() {
    let pointerDownTime = 0;
    let pointerDownPos = { x: 0, y: 0 };

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown() && this.placementMode) {
        this.cancelPlacementMode();
        return;
      }

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

      if (this.placementMode) {
        this.updatePlacementPreview(pointer);
      }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.isDragging = false;

      // If an interactive object (location, route, vehicle) was just clicked, do not deselect
      if (this.justSelectedInteractiveObject) {
        this.justSelectedInteractiveObject = false;
        return;
      }

      const moved = Math.hypot(pointer.x - pointerDownPos.x, pointer.y - pointerDownPos.y);

      // Handle interactive placement click
      if (this.placementMode && moved < 6) {
        this.executePlacementClick(pointer);
        return;
      }

      // Click on empty ground deselects current inspected entity (does NOT hide all gangs)
      const duration = Date.now() - pointerDownTime;
      if (moved < 5 && duration < 300) {
        this.selectedLocationId = null;
        this.selectedRouteId = null;
        this.selectedVoyageId = null;
        this.renderWorld(this.currentSnapshot);
        if (this.eventsHandler.onDeselectAll) {
          this.eventsHandler.onDeselectAll();
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

  toggleInfluence(): boolean {
    this.isInfluenceZoneVisible = !this.isInfluenceZoneVisible;
    this.lastHqSignature = '';
    this.renderWorld(this.currentSnapshot);
    if (this.eventsHandler.onInfluenceToggled) {
      this.eventsHandler.onInfluenceToggled(this.isInfluenceZoneVisible);
    }
    return this.isInfluenceZoneVisible;
  }

  setInfluenceVisible(visible: boolean): void {
    this.isInfluenceZoneVisible = visible;
    this.lastHqSignature = '';
    this.renderWorld(this.currentSnapshot);
    if (this.eventsHandler.onInfluenceToggled) {
      this.eventsHandler.onInfluenceToggled(this.isInfluenceZoneVisible);
    }
  }

  isInfluenceVisible(): boolean {
    return this.isInfluenceZoneVisible;
  }

  startPlacementMode(data: { gangId: string; kind: LocationKind; cost: number; region?: RegionId }): void {
    this.placementMode = data;
    this.placementGfx.clear();
  }

  cancelPlacementMode(): void {
    this.placementMode = null;
    this.placementGfx.clear();
    if (this.eventsHandler.onCancelPlacement) {
      this.eventsHandler.onCancelPlacement();
    }
  }

  isPlacementActive(): boolean {
    return this.placementMode !== null;
  }

  private updatePlacementPreview(pointer: Phaser.Input.Pointer) {
    if (!this.placementMode) {
      this.placementGfx.clear();
      return;
    }

    const cam = this.cameras.main;
    const worldX = Math.round((pointer.x - cam.width / 2) / cam.zoom + cam.midPoint.x);
    const worldY = Math.round((pointer.y - cam.height / 2) / cam.zoom + cam.midPoint.y);
    const region = getRegionForY(worldY);

    this.placementGfx.clear();

    const gang = this.currentSnapshot.gangs[this.placementMode.gangId];
    if (!gang) return;

    if (!region) {
      this.placementGfx.lineStyle(2, 0xef4444, 0.85);
      this.placementGfx.strokeCircle(worldX, worldY, 32);
      return;
    }

    const check = canPurchaseNode(
      this.currentSnapshot,
      this.placementMode.gangId,
      this.placementMode.kind,
      region,
      worldX,
      worldY
    );

    if (this.placementMode.kind === 'HQ') {
      const bounds = REGION_BOUNDS[region];
      this.placementGfx.lineStyle(2, check.allowed ? 0x22c55e : 0xef4444, 0.5);
      if (bounds) {
        drawClippedCircle(this.placementGfx, worldX, worldY, BASE_HQ_INFLUENCE_RADIUS, bounds.yMin, bounds.yMax, true);
      } else {
        this.placementGfx.strokeCircle(worldX, worldY, BASE_HQ_INFLUENCE_RADIUS);
      }
    }

    if (check.allowed) {
      this.placementGfx.fillStyle(0x10b981, 0.35);
      this.placementGfx.fillRoundedRect(worldX - 34, worldY - 34, 68, 68, 8);
      this.placementGfx.lineStyle(2.5, 0x34d399, 0.95);
      this.placementGfx.strokeRoundedRect(worldX - 34, worldY - 34, 68, 68, 8);
    } else {
      this.placementGfx.fillStyle(0xef4444, 0.3);
      this.placementGfx.fillRoundedRect(worldX - 34, worldY - 34, 68, 68, 8);
      this.placementGfx.lineStyle(2.5, 0xf87171, 0.95);
      this.placementGfx.strokeRoundedRect(worldX - 34, worldY - 34, 68, 68, 8);
    }
  }

  private executePlacementClick(pointer: Phaser.Input.Pointer) {
    if (!this.placementMode) return;

    const cam = this.cameras.main;
    const worldX = Math.round((pointer.x - cam.width / 2) / cam.zoom + cam.midPoint.x);
    const worldY = Math.round((pointer.y - cam.height / 2) / cam.zoom + cam.midPoint.y);
    const region = getRegionForY(worldY);

    if (!region) return;

    const check = canPurchaseNode(
      this.currentSnapshot,
      this.placementMode.gangId,
      this.placementMode.kind,
      region,
      worldX,
      worldY
    );

    if (check.allowed) {
      const mode = this.placementMode;
      this.cancelPlacementMode();

      this.port.dispatch({
        type: mode.kind === 'HQ' ? 'PURCHASE_HQ' : 'PURCHASE_NODE',
        payload: {
          gangId: mode.gangId,
          kind: mode.kind,
          region,
          x: worldX,
          y: worldY,
        },
      });

      scheduler.step();
    }
  }

  /**
   * Gang Selection:
   * Multi-gang selection support.
   */
  setSelectedGangs(gangIds: Set<string>) {
    this.selectedGangIds = new Set(gangIds);
    this.selectedRouteId = null;
    this.lastHqSignature = '';
    this.renderWorld(this.currentSnapshot);
  }

  setSelectedGang(gangId: string | null) {
    if (gangId === null) {
      this.selectedGangIds.clear();
    } else {
      this.selectedGangIds = new Set([gangId]);
    }
    this.selectedRouteId = null;
    this.lastHqSignature = '';
    this.renderWorld(this.currentSnapshot);
  }

  toggleGang(gangId: string) {
    if (this.selectedGangIds.has(gangId)) {
      this.selectedGangIds.delete(gangId);
    } else {
      this.selectedGangIds.add(gangId);
    }
    this.selectedRouteId = null;
    this.lastHqSignature = '';
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
    if (!this.isSceneReady || !this.bgGfx || !this.influenceGfxUk || !this.nodesContainer) {
      return;
    }
    if (snapshot.tick === 0) {
      this.lastHqSignature = '';
      this.cancelPlacementMode();
      this.selectedVoyageId = null;
      this.selectedRouteId = null;
      this.selectedLocationId = null;
    }
    this.renderInfluenceHeatmap(snapshot);
    this.renderPhysicalConnections(snapshot);
    this.renderLocations(snapshot);
    this.renderParallelRoutes(snapshot);
    this.renderVoyageVehicles(snapshot);
  }

  private renderInfluenceHeatmap(snapshot: WorldSnapshot) {
    const hqs = Object.values(snapshot.locations).filter((l) => l.kind === 'HQ');
    const hqSig = `${this.isInfluenceZoneVisible}|${Array.from(this.selectedGangIds).sort().join(',')}|${hqs.map((h) => `${h.id}:${h.x}:${h.y}:${h.gangId}:${Math.round(h.influenceRadius || 220)}`).sort().join(';')}`;

    if (hqSig === this.lastHqSignature) {
      return;
    }
    this.lastHqSignature = hqSig;

    this.influenceGfxUk.clear();
    this.influenceGfxEur.clear();
    this.influenceGfxAfr.clear();

    if (!this.isInfluenceZoneVisible) {
      return;
    }

    const gfxByRegion: Record<RegionId, Phaser.GameObjects.Graphics> = {
      UK: this.influenceGfxUk,
      EUROPE: this.influenceGfxEur,
      AFRICA: this.influenceGfxAfr,
    };

    const activeGangs = Object.values(snapshot.gangs).filter((g) => g.status === 'ACTIVE');

    for (const gang of activeGangs) {
      const isSelected = this.selectedGangIds.has(gang.id);
      const isAnySelected = this.selectedGangIds.size > 0;
      const alphaMultiplier = isSelected ? 1.0 : (isAnySelected ? 0.35 : 0.85);

      // Find all HQs for this gang
      const hqs = Object.values(snapshot.locations).filter(
        (l) => l.gangId === gang.id && l.kind === 'HQ'
      );

      // 1. Draw concentric dissipation rings for each HQ
      for (const hq of hqs) {
        const gfx = gfxByRegion[hq.region];
        if (!gfx) continue;

        const bounds = REGION_BOUNDS[hq.region];
        if (!bounds) continue;

        const radius = hq.influenceRadius || BASE_HQ_INFLUENCE_RADIUS;

        // "darker color - stronger influence - it dissipates with distance from hq"
        // 12 concentric steps creating smooth radial heat decay strictly clipped to region bounds
        const steps = 12;
        for (let i = steps; i >= 1; i--) {
          const r = (radius / steps) * i;
          const heatRatio = 1 - r / radius;
          const alpha = Math.pow(heatRatio, 1.35) * 0.44 * alphaMultiplier;

          if (alpha > 0.005) {
            gfx.fillStyle(gang.colorNum, alpha);
            drawClippedCircle(gfx, hq.x, hq.y, r, bounds.yMin, bounds.yMax, false);
          }
        }

        // Inner solid core (high intensity epicenter)
        gfx.fillStyle(gang.colorNum, 0.55 * alphaMultiplier);
        drawClippedCircle(gfx, hq.x, hq.y, 22, bounds.yMin, bounds.yMax, false);
        gfx.lineStyle(1.5, 0xffffff, 0.45 * alphaMultiplier);
        drawClippedCircle(gfx, hq.x, hq.y, 22, bounds.yMin, bounds.yMax, true);

        // Dynamic radar contour rings
        gfx.lineStyle(1.5, gang.colorNum, 0.65 * alphaMultiplier);
        drawClippedCircle(gfx, hq.x, hq.y, radius, bounds.yMin, bounds.yMax, true);

        gfx.lineStyle(1, 0xffffff, 0.2 * alphaMultiplier);
        drawClippedCircle(gfx, hq.x, hq.y, radius * 0.5, bounds.yMin, bounds.yMax, true);
      }

      // 2. Multi-HQ Synergy Rendering:
      // RULE: "2 hq influence zones, same gang, increase the influence"
      const regions: RegionId[] = ['UK', 'EUROPE', 'AFRICA'];
      for (const reg of regions) {
        const regHqs = hqs.filter((h) => h.region === reg);
        if (regHqs.length >= 2) {
          const gfx = gfxByRegion[reg];
          if (!gfx) continue;

          for (let i = 0; i < regHqs.length; i++) {
            for (let j = i + 1; j < regHqs.length; j++) {
              const hq1 = regHqs[i];
              const hq2 = regHqs[j];
              const r1 = hq1.influenceRadius || BASE_HQ_INFLUENCE_RADIUS;
              const r2 = hq2.influenceRadius || BASE_HQ_INFLUENCE_RADIUS;
              const dist = Math.hypot(hq1.x - hq2.x, hq1.y - hq2.y);

              // If influence zones overlap:
              if (dist < r1 + r2) {
                // Resonance conduit beam connecting the two HQs
                gfx.lineStyle(4, gang.colorNum, 0.45 * alphaMultiplier);
                gfx.lineBetween(hq1.x, hq1.y, hq2.x, hq2.y);

                gfx.lineStyle(1.5, 0xffffff, 0.75 * alphaMultiplier);
                gfx.lineBetween(hq1.x, hq1.y, hq2.x, hq2.y);

                // Overlap resonance core at midpoint
                const midX = (hq1.x + hq2.x) / 2;
                const midY = (hq1.y + hq2.y) / 2;
                gfx.fillStyle(0xffffff, 0.85 * alphaMultiplier);
                gfx.fillCircle(midX, midY, 6);
                gfx.lineStyle(2.5, gang.colorNum, 0.95 * alphaMultiplier);
                gfx.strokeCircle(midX, midY, 14);
                gfx.lineStyle(1, 0xffffff, 0.5 * alphaMultiplier);
                gfx.strokeCircle(midX, midY, 24);
              }
            }
          }
        }
      }
    }
  }

  private renderRegionsBackdrop(_snapshot?: WorldSnapshot) {
    if (!this.bgGfx || !this.borderGfx) return;
    const gfx = this.bgGfx;
    gfx.clear();

    const worldW = 1800;
    const startX = -300;

    // 1. UK Land Region (North: y: -100 to 160) - Oceanic Navy
    gfx.fillStyle(0x0c1b2e, 0.55);
    gfx.fillRect(startX, REGION_BOUNDS.UK.yMin, worldW, REGION_BOUNDS.UK.yMax - REGION_BOUNDS.UK.yMin);

    // 2. West Europe Land Region (Middle: y: 215 to 485) - Slate / Pine
    gfx.fillStyle(0x0d2222, 0.45);
    gfx.fillRect(startX, REGION_BOUNDS.EUROPE.yMin, worldW, REGION_BOUNDS.EUROPE.yMax - REGION_BOUNDS.EUROPE.yMin);

    // 3. North Africa Land Region (South: y: 565 to 820) - Warm Clay / Amber
    gfx.fillStyle(0x291910, 0.55);
    gfx.fillRect(startX, REGION_BOUNDS.AFRICA.yMin, worldW, REGION_BOUNDS.AFRICA.yMax - REGION_BOUNDS.AFRICA.yMin);

    // Subtle grid lines on land regions
    gfx.lineStyle(1, 0x0f172a, 0.25);
    for (let x = startX; x <= startX + worldW; x += 64) {
      gfx.lineBetween(x, REGION_BOUNDS.UK.yMin, x, REGION_BOUNDS.UK.yMax);
      gfx.lineBetween(x, REGION_BOUNDS.EUROPE.yMin, x, REGION_BOUNDS.EUROPE.yMax);
      gfx.lineBetween(x, REGION_BOUNDS.AFRICA.yMin, x, REGION_BOUNDS.AFRICA.yMax);
    }

    // High-visibility Regional 2-Sided Borders
    const bgBorder = this.borderGfx;
    bgBorder.clear();

    // ==========================================
    // CHANNEL BORDERS (2 SIDES: IN TO UK, OUT OF EUROPE)
    // ==========================================
    // North Side: Border IN to UK (y: 140)
    bgBorder.fillStyle(0x0c4a6e, 0.45);
    bgBorder.fillRect(startX, 134, worldW, 6);
    bgBorder.lineStyle(3, 0x0284c7, 0.95);
    bgBorder.lineBetween(startX, 140, startX + worldW, 140);
    // Dashed security stripe on UK side
    bgBorder.lineStyle(2, 0x38bdf8, 0.85);
    for (let x = startX; x < startX + worldW; x += 24) {
      bgBorder.lineBetween(x, 138, x + 14, 138);
    }
    // Water shoreline foam line (water side at y = 141)
    bgBorder.lineStyle(1.5, 0xbae6fd, 0.55);
    bgBorder.lineBetween(startX, 141, startX + worldW, 141);

    // South Side: Border OUT of Europe (y: 280)
    bgBorder.fillStyle(0x064e3b, 0.45);
    bgBorder.fillRect(startX, 280, worldW, 6);
    bgBorder.lineStyle(3, 0x059669, 0.95);
    bgBorder.lineBetween(startX, 280, startX + worldW, 280);
    // Dashed hazard stripe on European side
    bgBorder.lineStyle(2, 0x4ade80, 0.85);
    for (let x = startX; x < startX + worldW; x += 24) {
      bgBorder.lineBetween(x, 282, x + 14, 282);
    }
    // Water shoreline foam line (water side at y = 279)
    bgBorder.lineStyle(1.5, 0xa7f3d0, 0.55);
    bgBorder.lineBetween(startX, 279, startX + worldW, 279);

    // ==========================================
    // MEDITERRANEAN BORDERS (2 SIDES: IN TO EUROPE, OUT OF AFRICA)
    // ==========================================
    // North Side: Border IN to Europe (y: 660)
    bgBorder.fillStyle(0x064e3b, 0.45);
    bgBorder.fillRect(startX, 654, worldW, 6);
    bgBorder.lineStyle(3, 0x059669, 0.95);
    bgBorder.lineBetween(startX, 660, startX + worldW, 660);
    // Dashed Schengen security line
    bgBorder.lineStyle(2, 0x4ade80, 0.85);
    for (let x = startX; x < startX + worldW; x += 24) {
      bgBorder.lineBetween(x, 658, x + 14, 658);
    }
    // Shoreline foam line (water side at y = 661)
    bgBorder.lineStyle(1.5, 0xa7f3d0, 0.55);
    bgBorder.lineBetween(startX, 661, startX + worldW, 661);

    // South Side: Border OUT of Africa (y: 860)
    bgBorder.fillStyle(0x7c2d12, 0.45);
    bgBorder.fillRect(startX, 860, worldW, 6);
    bgBorder.lineStyle(3, 0xd97706, 0.95);
    bgBorder.lineBetween(startX, 860, startX + worldW, 860);
    // Dashed departure perimeter stripe
    bgBorder.lineStyle(2, 0xfb923c, 0.85);
    for (let x = startX; x < startX + worldW; x += 24) {
      bgBorder.lineBetween(x, 862, x + 14, 862);
    }
    // Shoreline foam line (water side at y = 859)
    bgBorder.lineStyle(1.5, 0xfde68a, 0.55);
    bgBorder.lineBetween(startX, 859, startX + worldW, 859);
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
    const currentLocIds = new Set(Object.keys(snapshot.locations));
    for (const [id, container] of this.locationContainers.entries()) {
      if (!currentLocIds.has(id)) {
        container.destroy();
        this.locationContainers.delete(id);
      }
    }

    for (const loc of Object.values(snapshot.locations)) {
      let container = this.locationContainers.get(loc.id);
      if (!container) {
        container = this.createLocationNode(loc, snapshot);
        this.locationContainers.set(loc.id, container);
        this.nodesContainer.add(container);
      }

      // Visibility Rule:
      // Show nodes owned by ANY currently selected gang, or unowned candidate nodes
      const isVisible = loc.gangId === 'NEUTRAL' || this.selectedGangIds.has(loc.gangId);
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
      if (pointer.leftButtonDown()) {
        this.justSelectedInteractiveObject = true;
        this.selectedLocationId = loc.id;
        this.selectedRouteId = null;
        this.selectedVoyageId = null;
        if (loc.gangId) {
          this.selectedGangIds.add(loc.gangId);
        }
        this.renderWorld(this.currentSnapshot);
        const gang = this.currentSnapshot.gangs[loc.gangId];
        if (gang && this.eventsHandler.onSelectGang) {
          this.eventsHandler.onSelectGang(gang, this.currentSnapshot);
        }
        if (this.eventsHandler.onSelectLocation) {
          this.eventsHandler.onSelectLocation(loc, this.currentSnapshot);
        }
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

    const isSelected = this.selectedLocationId === loc.id;
    const gang = snapshot.gangs[loc.gangId];
    const strokeColor = gang ? gang.colorNum : 0x475569;

    baseGfx.fillStyle(0x0f172a, 0.95);
    baseGfx.fillRoundedRect(-36, -36, 72, 72, 8);

    const isCandidate = loc.gangId === 'NEUTRAL';
    const isUnstaffed = !isCandidate && !loc.assignedHoodId;

    if (isSelected) {
      // High-contrast gold halo for selected node
      baseGfx.lineStyle(4, 0xfacc15, 1.0);
      baseGfx.strokeRoundedRect(-41, -41, 82, 82, 10);
      baseGfx.lineStyle(2, 0xffffff, 1.0);
      baseGfx.strokeRoundedRect(-36, -36, 72, 72, 8);
    } else if (isCandidate) {
      baseGfx.lineStyle(2, 0x64748b, 0.65);
      baseGfx.strokeRoundedRect(-36, -36, 72, 72, 8);
    } else {
      baseGfx.lineStyle(2, strokeColor, 0.9);
      baseGfx.strokeRoundedRect(-36, -36, 72, 72, 8);
    }

    if (isCandidate) {
      countText.setText(`$${loc.candidateCost || 1800}`);
      badgeGfx.fillStyle(0x0f172a, 0.9);
      badgeGfx.fillRoundedRect(-34, -54, 68, 18, 4);
      badgeGfx.lineStyle(1.5, 0x64748b, 0.85);
      badgeGfx.strokeRoundedRect(-34, -54, 68, 18, 4);
    } else if (isUnstaffed) {
      countText.setText('⚠️ UNSTAFFED');
      badgeGfx.fillStyle(0x451a03, 0.9);
      badgeGfx.fillRoundedRect(-44, -54, 88, 18, 4);
      badgeGfx.lineStyle(1.5, 0xf59e0b, 0.9);
      badgeGfx.strokeRoundedRect(-44, -54, 88, 18, 4);
    } else if (loc.kind === 'HQ' && gang) {
      badgeGfx.fillStyle(gang.colorNum, 1);
      badgeGfx.fillCircle(28, -28, 12);
      badgeGfx.lineStyle(1.5, 0xffffff, 0.9);
      badgeGfx.strokeCircle(28, -28, 12);

      const hqLabel = loc.isMainHq ? '⭐ MAIN' : '⚡ HQ';
      countText.setText(hqLabel);
      badgeGfx.fillStyle(0x0f172a, 0.9);
      badgeGfx.fillRoundedRect(-30, -54, 60, 18, 4);
      badgeGfx.lineStyle(1.5, gang.colorNum, 0.9);
      badgeGfx.strokeRoundedRect(-30, -54, 60, 18, 4);
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
    } else if (loc.kind === 'WORKSHOP') {
      // Arrived Chums stationed and working in this Workshop (industrial-press)
      const chumsHere = Object.values(snapshot.chumigrants).filter(
        (c) => c.originId === loc.id && c.status === 'ARRIVED'
      );

      if (chumsHere.length > 0) {
        countText.setText(`⚙️ ${chumsHere.length}`);
        badgeGfx.fillStyle(0x0f172a, 0.9);
        badgeGfx.fillRoundedRect(-24, -54, 48, 18, 4);
        badgeGfx.lineStyle(1.5, 0xf59e0b, 0.85);
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

      if (isSelected) {
        // High-contrast gold halo under selected route
        gfx.lineStyle(7, 0xfacc15, 0.85);
        gfx.lineBetween(src.x, src.y, tgt.x, tgt.y);
        gfx.lineStyle(3.5, 0xffffff, 1.0);
        gfx.lineBetween(src.x, src.y, tgt.x, tgt.y);
      } else {
        gfx.lineStyle(3.0, color, 0.9);
        gfx.lineBetween(src.x, src.y, tgt.x, tgt.y);
      }

      // Direction Arrow in middle
      const midX = (src.x + tgt.x) / 2;
      const midY = (src.y + tgt.y) / 2;
      const arrowAngle = Math.atan2(dy, dx);
      const arrowLen = 8;

      gfx.lineStyle(2, isSelected ? 0xffffff : color, 1.0);
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
        zone = this.add.zone(midX, midY, Math.max(dist, 40), 24);
        zone.setRotation(arrowAngle);
        zone.setInteractive({ cursor: 'pointer' });
        zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          if (pointer.leftButtonDown()) {
            this.justSelectedInteractiveObject = true;
            this.selectedRouteId = route.id;
            this.selectedLocationId = null;
            this.selectedVoyageId = null;
            this.renderWorld(this.currentSnapshot);
            if (this.eventsHandler.onSelectRoute) {
              this.eventsHandler.onSelectRoute(route, this.currentSnapshot);
            }
          }
        });
        this.routeHitZones.set(route.id, zone);
      } else {
        zone.setPosition(midX, midY);
        zone.setRotation(arrowAngle);
        zone.setSize(Math.max(dist, 40), 24);
        if (zone.input && zone.input.hitArea) {
          (zone.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, Math.max(dist, 40), 24);
        }
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

      const selectGfx = container.getByName('selectGfx') as Phaser.GameObjects.Graphics;
      if (selectGfx) {
        selectGfx.clear();
        if (this.selectedVoyageId === voyage.id) {
          selectGfx.lineStyle(2.5, 0xfacc15, 1.0);
          selectGfx.strokeCircle(0, 0, 18);
        }
      }

      const badge = container.getByName('passengerBadge') as Phaser.GameObjects.Text;
      if (badge) {
        badge.setText(`×${voyage.passengerIds.length}`);
      }
    }
  }

  private createVehicleSprite(voyage: VoyageState, gang?: GangState): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);

    const selectGfx = this.add.graphics();
    selectGfx.setName('selectGfx');
    container.add(selectGfx);

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

    const hit = this.add.zone(0, 0, 32, 32);
    hit.setInteractive({ cursor: 'pointer' });
    hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.justSelectedInteractiveObject = true;
        this.selectedVoyageId = voyage.id;
        this.selectedLocationId = null;
        this.selectedRouteId = null;
        this.renderWorld(this.currentSnapshot);
        if (this.eventsHandler.onSelectVoyage) {
          this.eventsHandler.onSelectVoyage(voyage, this.currentSnapshot);
        }
      }
    });
    container.add(hit);

    return container;
  }
}
