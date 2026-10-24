import Phaser from 'phaser';
import type { GamePort } from '../app/GamePort';
import { engine, scheduler } from '../app/state';
import type {
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
  BASE_HQ_INFLUENCE_RADIUS,
  REGION_BOUNDS,
  WATER_ZONES,
  getRegionForY,
  canPurchaseNode,
  getClosestHqForNode,
} from '../sim/influence';

export interface SceneSelectionEvents {
  onSelectLocation?: (location: LocationDef, snapshot: WorldSnapshot) => void;
  onSelectRoute?: (route: RouteServiceState, snapshot: WorldSnapshot) => void;
  onSelectCorridorBundle?: (bundle: CorridorBundle, snapshot: WorldSnapshot) => void;
  onSelectGang?: (gang: GangState, snapshot: WorldSnapshot) => void;
  onSelectVoyage?: (voyage: VoyageState, snapshot: WorldSnapshot) => void;
  onSelectMigrant?: (migrant: MigrantState, snapshot: WorldSnapshot) => void;
  onViewModeChanged?: (mode: 'GEO' | 'REGION', regionHq?: LocationDef | null) => void;
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

function getRegionalNodeSpriteKey(loc: LocationDef): string {
  if (loc.kind === 'HQ') {
    if (loc.region === 'UK') return 'uk_hq';
    if (loc.region === 'AFRICA') return 'morrocan_hq';
    return 'french_hq';
  }
  if (loc.kind === 'RECRUITER') {
    if (loc.region === 'UK') return 'uk_recruiter';
    if (loc.region === 'AFRICA') return 'morrocan_recruiter';
    return 'french_recruiter';
  }
  if (loc.kind === 'DEPOT') {
    if (loc.region === 'UK') return 'uk_depot';
    return 'france_workshop'; // Marseille Transit Depot
  }
  if (loc.kind === 'WORKSHOP' || loc.kind === 'CRIMINAL_ENTERPRISE') {
    return 'france_workshop';
  }
  return `tile_${loc.tileFamily}`;
}

function getRegionalNodeSpriteScale(key: string): number {
  switch (key) {
    case 'uk_hq':
      return 0.084;
    case 'french_hq':
    case 'morrocan_hq':
      return 0.082;
    case 'uk_recruiter':
    case 'french_recruiter':
    case 'morrocan_recruiter':
      return 0.078;
    case 'uk_depot':
    case 'france_workshop':
      return 0.078;
    default:
      return 0.35;
  }
}

export class BrokeScene extends Phaser.Scene {
  private port!: GamePort;
  private eventsHandler: SceneSelectionEvents = {};
  private currentSnapshot!: WorldSnapshot;

  // Graphics layers
  private floorTile!: Phaser.GameObjects.TileSprite;
  private ukFloorTile!: Phaser.GameObjects.TileSprite;
  private europeFloorTile!: Phaser.GameObjects.TileSprite;
  private africaFloorTile!: Phaser.GameObjects.TileSprite;
  private channelWaterTile!: Phaser.GameObjects.TileSprite;
  private medWaterTile!: Phaser.GameObjects.TileSprite;
  private bgGfx!: Phaser.GameObjects.Graphics;
  private regionCropGfx!: Phaser.GameObjects.Graphics;
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
  private selectedCorridorBundleId: string | null = null;

  // 2 Discrete Levels of Zoom: GEO (Macro Strategic Overview) vs REGION (Micro Regional Operations)
  private viewMode: 'GEO' | 'REGION' = 'GEO';
  private activeRegionHqId: string | null = null;
  private corridorBundles: Map<string, CorridorBundle> = new Map();
  private trunkRouteHitZones: Map<string, Phaser.GameObjects.Zone> = new Map();
  private trunkRouteBadges: Map<string, Phaser.GameObjects.Container> = new Map();
  private corridorLineCoords: Map<string, { x1: number; y1: number; x2: number; y2: number }> = new Map();

  private justSelectedInteractiveObject = false;
  private lastHqSignature = '';
  private lastBackdropSignature = '';
  private isSceneReady = false;

  constructor() {
    super('BrokeScene');
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
    // Preload regional floor background and water tiles
    this.load.image('uk_floor', '/uk_floor.png');
    this.load.image('french_floor', '/french_floor_tile.png');
    this.load.image('sandy_floor', '/sandy.png');
    this.load.image('water_tile', '/water-tile.png');

    // Preload regional buildings
    this.load.image('uk_hq', '/uk_hq.png');
    this.load.image('uk_recruiter', '/uk_recruiter.png');
    this.load.image('uk_depot', '/uk_depot.png');
    this.load.image('french_hq', '/french_hq.png');
    this.load.image('french_recruiter', '/french_recruiter.png');
    this.load.image('france_workshop', '/france_workshop.png');
    this.load.image('morrocan_hq', '/morrocan_hq.png');
    this.load.image('morrocan_recruiter', '/morrocan_recruiter.png');

    // Preload voyage vehicles
    this.load.image('voyage_boat', '/broke_world_voyage_boat.png');
    this.load.image('voyage_van', '/broke_world_voyage_van.png');

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
    // 0. Base dark foundation backdrop
    this.floorTile = this.add.tileSprite(2100, 1100, 6400, 6000, 'sandy_floor').setDepth(0);
    this.floorTile.setAlpha(0.15);

    // 0.1 Regional Floor Tiles (3x tall regions)
    // UK Region Floor (y: -700 to 200, height: 900, center: -250)
    this.ukFloorTile = this.add.tileSprite(2100, -250, 6400, 900, 'uk_floor').setDepth(0.1);

    // Europe (France) Region Floor (y: 400 to 1600, height: 1200, center: 1000)
    this.europeFloorTile = this.add.tileSprite(2100, 1000, 6400, 1200, 'french_floor').setDepth(0.1);
    this.europeFloorTile.setTileScale(0.25, 0.25);

    // North Africa Region Floor (y: 1850 to 2850, height: 1000, center: 2350)
    this.africaFloorTile = this.add.tileSprite(2100, 2350, 6400, 1000, 'sandy_floor').setDepth(0.1);
    this.africaFloorTile.setTileScale(0.35, 0.35);

    // 0.5. Water Tile Sprites separating regions
    // English Channel Water (y: 200 to 400, height: 200px, center: 300)
    this.channelWaterTile = this.add.tileSprite(2100, 300, 6400, 200, 'water_tile').setDepth(0.5);
    this.channelWaterTile.setAlpha(0.92);

    // Mediterranean Sea Water (y: 1600 to 1850, height: 250px, center: 1725)
    this.medWaterTile = this.add.tileSprite(2100, 1725, 6400, 250, 'water_tile').setDepth(0.5);
    this.medWaterTile.setAlpha(0.92);

    // 1. Graphics layers in depth order
    this.bgGfx = this.add.graphics().setDepth(1);

    // Influence Heatmap Layers (Depth 1.4, strictly masked per region)
    // Rule: "heat map stops at border."
    const worldW = 4600;
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

    this.regionCropGfx = this.add.graphics().setDepth(1.8);
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
      const pauseIndicator = document.getElementById('hud-pause-indicator');
      if (pauseIndicator) pauseIndicator.style.display = 'none';
    });

    // Subscribe to simulation updates
    this.port.subscribe((snapshot) => {
      this.currentSnapshot = snapshot;
      this.renderWorld(snapshot);
    });

    // Center camera on world center for spacious multi-region layout
    this.cameras.main.centerOn(2100, 1100);
    this.cameras.main.setZoom(0.30);

    // Mark scene as ready
    this.isSceneReady = true;

    // Ensure graphics are redrawn on focus, resize, or visibility change
    this.game.events.on('focus', () => {
      if (this.isSceneReady && this.currentSnapshot) {
        this.renderRegionsBackdrop();
        this.renderWorld(this.currentSnapshot);
      }
    });
    window.addEventListener('focus', () => {
      if (this.isSceneReady && this.currentSnapshot) {
        this.renderRegionsBackdrop();
        this.renderWorld(this.currentSnapshot);
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isSceneReady && this.currentSnapshot) {
        this.renderRegionsBackdrop();
        this.renderWorld(this.currentSnapshot);
      }
    });
    this.scale.on('resize', () => {
      if (this.isSceneReady && this.currentSnapshot) {
        this.renderRegionsBackdrop();
        this.renderWorld(this.currentSnapshot);
      }
    });

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
    this.updateStaticRegionLabels('GEO', null);
  }

  private updateStaticRegionLabels(mode: 'GEO' | 'REGION', activeHq?: LocationDef | null) {
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

    if (mode === 'REGION' && activeHq) {
      // In REGION View: only show focused header for the active operational theatre; crop other regions!
      const flag = activeHq.region === 'UK' ? '🇬🇧' : activeHq.region === 'AFRICA' ? '🌍' : '🇪🇺';
      const color = activeHq.region === 'UK' ? '#38bdf8' : activeHq.region === 'AFRICA' ? '#fb923c' : '#4ade80';
      const bounds = REGION_BOUNDS[activeHq.region];

      this.labelsContainer.add(
        this.add.text(activeHq.x, bounds.yMin - 16, `${flag} ${activeHq.name.toUpperCase()} — LOCAL OPERATIONAL THEATRE`, {
          ...titleStyle,
          color,
          fontSize: '13px',
        }).setOrigin(0.5, 1)
      );

      // Local border checkpoint indicators
      if (activeHq.region === 'UK') {
        this.labelsContainer.add(
          this.add.text(activeHq.x, 190, '▼ BORDER IN TO UK — DOVER MARITIME ENTRY', {
            ...borderStyle,
            color: '#38bdf8',
            backgroundColor: '#0c2a47ee',
          }).setOrigin(0.5, 1)
        );
      } else if (activeHq.region === 'EUROPE') {
        this.labelsContainer.add(
          this.add.text(activeHq.x, 410, '▲ BORDER OUT OF EUROPE — CHANNEL DEPARTURE PERIMETER', {
            ...borderStyle,
            color: '#4ade80',
            backgroundColor: '#064e3bee',
          }).setOrigin(0.5, 0)
        );
        this.labelsContainer.add(
          this.add.text(activeHq.x, 1590, '▼ BORDER IN TO EUROPE — MEDITERRANEAN ENTRY CHECKPOINT', {
            ...borderStyle,
            color: '#4ade80',
            backgroundColor: '#064e3bee',
          }).setOrigin(0.5, 1)
        );
      } else if (activeHq.region === 'AFRICA') {
        this.labelsContainer.add(
          this.add.text(activeHq.x, 1860, '▲ BORDER OUT OF AFRICA — MARITIME DEPARTURE BORDER', {
            ...borderStyle,
            color: '#fb923c',
            backgroundColor: '#7c2d12ee',
          }).setOrigin(0.5, 0)
        );
      }
      return;
    }

    // Render region & border labels across the 3 main longitudinal sectors (West, Central, East)
    const sectorXs = [
      { x: 600, name: 'WEST SECTOR (NEON)' },
      { x: 2100, name: 'CENTRAL SECTOR (CRIMSON)' },
      { x: 3600, name: 'EAST SECTOR (AMBER)' },
    ];

    for (const sec of sectorXs) {
      // 1. UK Region Title
      this.labelsContainer.add(
        this.add.text(sec.x, -550, `🇬🇧 UNITED KINGDOM — ${sec.name}`, {
          ...titleStyle,
          color: '#38bdf8',
        }).setOrigin(0.5, 0)
      );

      // 2. English Channel Borders (2 Sides: IN to UK, OUT of Europe)
      const ukBorderText = this.add.text(sec.x, 190, '▼ BORDER IN TO UK — DOVER MARITIME ENTRY', {
        ...borderStyle,
        color: '#38bdf8',
        backgroundColor: '#0c2a47ee',
      }).setOrigin(0.5, 1);
      this.labelsContainer.add(ukBorderText);

      const channelSeaText = this.add.text(sec.x, 300, '🌊 ENGLISH CHANNEL MARITIME CORRIDOR', {
        ...borderStyle,
        fontSize: '11px',
        color: '#7dd3fc',
        backgroundColor: '#0369a199',
      }).setOrigin(0.5, 0.5);
      this.labelsContainer.add(channelSeaText);

      const eurNorthBorderText = this.add.text(sec.x, 410, '▲ BORDER OUT OF EUROPE — CHANNEL DEPARTURE PERIMETER', {
        ...borderStyle,
        color: '#4ade80',
        backgroundColor: '#064e3bee',
      }).setOrigin(0.5, 0);
      this.labelsContainer.add(eurNorthBorderText);

      // 3. West Europe Region Title
      this.labelsContainer.add(
        this.add.text(sec.x, 430, `🇪🇺 EUROPEAN CORRIDOR — ${sec.name}`, {
          ...titleStyle,
          color: '#4ade80',
        }).setOrigin(0.5, 0)
      );

      // 4. Mediterranean Sea Borders (2 Sides: IN to Europe, OUT of Africa)
      const eurSouthBorderText = this.add.text(sec.x, 1590, '▼ BORDER IN TO EUROPE — MEDITERRANEAN ENTRY CHECKPOINT', {
        ...borderStyle,
        color: '#4ade80',
        backgroundColor: '#064e3bee',
      }).setOrigin(0.5, 1);
      this.labelsContainer.add(eurSouthBorderText);

      const medSeaText = this.add.text(sec.x, 1725, '🌊 MEDITERRANEAN SEA WATERS — CROSS-BORDER BOAT CORRIDOR', {
        ...borderStyle,
        fontSize: '11px',
        color: '#fde047',
        backgroundColor: '#854d0e99',
      }).setOrigin(0.5, 0.5);
      this.labelsContainer.add(medSeaText);

      const afrBorderText = this.add.text(sec.x, 1860, '▲ BORDER OUT OF AFRICA — MARITIME DEPARTURE BORDER', {
        ...borderStyle,
        color: '#fb923c',
        backgroundColor: '#7c2d12ee',
      }).setOrigin(0.5, 0);
      this.labelsContainer.add(afrBorderText);

      // 5. North Africa Region Title
      this.labelsContainer.add(
        this.add.text(sec.x, 1880, `🌍 NORTH AFRICA — ${sec.name}`, {
          ...titleStyle,
          color: '#fb923c',
        }).setOrigin(0.5, 0)
      );
    }
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
        this.selectedCorridorBundleId = null;
        this.renderWorld(this.currentSnapshot);
        if (this.eventsHandler.onDeselectAll) {
          this.eventsHandler.onDeselectAll();
        }
      }
    });

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _obj: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const zoomFactor = dy > 0 ? 0.90 : 1.12;

      if (this.viewMode === 'REGION') {
        const nextZoom = cam.zoom * zoomFactor;
        // User zooming out in Region View: if zoom drops below threshold, smoothly exit to Geo View!
        if (nextZoom < 0.40) {
          this.switchToGeoView();
          return;
        }
        const newZoom = Phaser.Math.Clamp(nextZoom, 0.42, 1.40);
        this.applyZoomAtPointer(cam, pointer, newZoom);
      } else {
        // Geo View: strategic macro zoom with limited clamping
        const nextZoom = cam.zoom * zoomFactor;
        const newZoom = Phaser.Math.Clamp(nextZoom, 0.18, 0.45);
        this.applyZoomAtPointer(cam, pointer, newZoom);
      }
    });
  }

  private applyZoomAtPointer(
    cam: Phaser.Cameras.Scene2D.Camera,
    pointer: Phaser.Input.Pointer,
    newZoom: number
  ) {
    const mouseWorldX = (pointer.x - cam.width / 2) / cam.zoom + cam.midPoint.x;
    const mouseWorldY = (pointer.y - cam.height / 2) / cam.zoom + cam.midPoint.y;

    cam.setZoom(newZoom);
    cam.centerOn(mouseWorldX, mouseWorldY);
    const targetMidX = mouseWorldX - (pointer.x - cam.width / 2) / newZoom;
    const targetMidY = mouseWorldY - (pointer.y - cam.height / 2) / newZoom;
    cam.centerOn(targetMidX, targetMidY);
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
      if (loc.kind === 'HQ') {
        this.switchToRegionView(loc.id);
      } else {
        this.cameras.main.pan(loc.x, loc.y, 500, 'Cubic.easeOut');
      }
    }
  }

  selectRoute(routeId: string) {
    this.selectedRouteId = routeId;
    this.selectedLocationId = null;
    this.selectedVoyageId = null;
    if (this.currentSnapshot) {
      const route = this.currentSnapshot.routes[routeId];
      if (route) {
        const src = this.currentSnapshot.locations[route.sourceId];
        const tgt = this.currentSnapshot.locations[route.targetId];
        if (src && tgt) {
          this.cameras.main.pan((src.x + tgt.x) / 2, (src.y + tgt.y) / 2, 500, 'Cubic.easeOut');
        }
      }
      this.renderWorld(this.currentSnapshot);
    }
  }

  getViewMode(): 'GEO' | 'REGION' {
    return this.viewMode;
  }

  getActiveRegionHqId(): string | null {
    return this.activeRegionHqId;
  }

  switchToGeoView(): void {
    this.viewMode = 'GEO';
    this.activeRegionHqId = null;
    this.selectedCorridorBundleId = null;
    this.selectedRouteId = null;
    this.selectedLocationId = null;
    this.selectedVoyageId = null;
    this.lastBackdropSignature = '';

    // Clean previous graphics, hit zones, and vehicles to prevent ghosting
    this.routesGfx.clear();
    this.connectionsGfx.clear();
    this.cleanupTrunkHitZones();
    for (const zone of this.routeHitZones.values()) {
      zone.destroy();
    }
    this.routeHitZones.clear();
    for (const sprite of this.vehicleSprites.values()) {
      sprite.destroy();
    }
    this.vehicleSprites.clear();

    this.cameras.main.removeBounds();
    this.cameras.main.pan(2100, 1100, 500, 'Cubic.easeOut');
    this.cameras.main.zoomTo(0.30, 500, 'Cubic.easeOut');
    this.renderWorld(this.currentSnapshot);
    if (this.eventsHandler.onViewModeChanged) {
      this.eventsHandler.onViewModeChanged('GEO', null);
    }
  }

  switchToRegionView(hqId: string): void {
    const hq = this.currentSnapshot.locations[hqId];
    if (!hq || hq.kind !== 'HQ') return;

    this.viewMode = 'REGION';
    this.activeRegionHqId = hqId;
    this.selectedCorridorBundleId = null;
    this.selectedRouteId = null;
    this.selectedLocationId = hqId;
    this.lastBackdropSignature = '';

    // Clean previous graphics, hit zones, and vehicles to prevent ghosting
    this.routesGfx.clear();
    this.connectionsGfx.clear();
    this.cleanupTrunkHitZones();
    for (const zone of this.routeHitZones.values()) {
      zone.destroy();
    }
    this.routeHitZones.clear();
    for (const sprite of this.vehicleSprites.values()) {
      sprite.destroy();
    }
    this.vehicleSprites.clear();

    // Auto-select this HQ's gang so its nodes and operations are immediately visible
    if (hq.gangId && !this.selectedGangIds.has(hq.gangId)) {
      this.selectedGangIds.add(hq.gangId);
    }

    const radius = hq.influenceRadius || BASE_HQ_INFLUENCE_RADIUS;
    const cropRadius = Math.round(radius * 1.45);
    const bounds = REGION_BOUNDS[hq.region];

    // Constrain camera scrolling tightly to this HQ's local operational theatre
    const minX = hq.x - cropRadius - 120;
    const maxX = hq.x + cropRadius + 120;
    const minY = bounds ? bounds.yMin - 80 : hq.y - cropRadius - 80;
    const maxY = bounds ? bounds.yMax + 80 : hq.y + cropRadius + 80;
    this.cameras.main.setBounds(minX, minY, maxX - minX, maxY - minY);

    // Pan and zoom centered DIRECTLY on THIS HQ:
    this.cameras.main.pan(hq.x, hq.y, 500, 'Cubic.easeOut');
    this.cameras.main.zoomTo(0.65, 500, 'Cubic.easeOut');
    this.renderWorld(this.currentSnapshot);

    const gang = this.currentSnapshot.gangs[hq.gangId];
    if (gang && this.eventsHandler.onSelectGang) {
      this.eventsHandler.onSelectGang(gang, this.currentSnapshot);
    }
    if (this.eventsHandler.onSelectLocation) {
      this.eventsHandler.onSelectLocation(hq, this.currentSnapshot);
    }
    if (this.eventsHandler.onViewModeChanged) {
      this.eventsHandler.onViewModeChanged('REGION', hq);
    }
  }

  selectCorridorBundle(bundleId: string): void {
    this.selectedCorridorBundleId = bundleId;
    this.selectedRouteId = null;
    this.selectedLocationId = null;
    this.selectedVoyageId = null;
    const bundle = this.corridorBundles.get(bundleId);
    if (bundle && this.eventsHandler.onSelectCorridorBundle) {
      this.eventsHandler.onSelectCorridorBundle(bundle, this.currentSnapshot);
    }
    this.renderWorld(this.currentSnapshot);
  }

  // ==================== RENDERING PIPELINE ====================
  renderWorld(snapshot: WorldSnapshot) {
    if (!this.isSceneReady || !this.bgGfx || !this.influenceGfxUk || !this.nodesContainer) {
      return;
    }
    if (snapshot.tick === 0) {
      this.lastHqSignature = '';
      this.lastBackdropSignature = '';
      this.cancelPlacementMode();
      this.selectedVoyageId = null;
      this.selectedRouteId = null;
      this.selectedLocationId = null;
    }
    const backdropSig = `${this.viewMode}|${this.activeRegionHqId}`;
    if (backdropSig !== this.lastBackdropSignature) {
      this.lastBackdropSignature = backdropSig;
      this.renderRegionsBackdrop(snapshot);
    }
    this.renderInfluenceHeatmap(snapshot);
    this.renderPhysicalConnections(snapshot);
    this.renderLocations(snapshot);
    this.renderParallelRoutes(snapshot);
    this.renderVoyageVehicles(snapshot);
  }

  private renderInfluenceHeatmap(snapshot: WorldSnapshot) {
    const hqs = Object.values(snapshot.locations).filter((l) => l.kind === 'HQ');
    const hqSig = `${this.viewMode}|${this.activeRegionHqId}|${this.isInfluenceZoneVisible}|${Array.from(this.selectedGangIds).sort().join(',')}|${hqs.map((h) => `${h.id}:${h.x}:${h.y}:${h.gangId}:${Math.round(h.influenceRadius || 220)}`).sort().join(';')}`;

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
    const activeHq = this.viewMode === 'REGION' && this.activeRegionHqId ? snapshot.locations[this.activeRegionHqId] : null;

    for (const gang of activeGangs) {
      const isSelected = this.selectedGangIds.has(gang.id);
      const isAnySelected = this.selectedGangIds.size > 0;
      const alphaMultiplier = isSelected ? 1.0 : (isAnySelected ? 0.35 : 0.85);

      // Find all HQs for this gang
      const gangHqs = Object.values(snapshot.locations).filter(
        (l) => l.gangId === gang.id && l.kind === 'HQ'
      );

      // 1. Draw concentric dissipation rings for each HQ
      for (const hq of gangHqs) {
        // In Region View: crop other regions' heatmaps! Only render for active operational theatre
        if (activeHq && (hq.region !== activeHq.region || Math.hypot(hq.x - activeHq.x, hq.y - activeHq.y) > (hq.influenceRadius || BASE_HQ_INFLUENCE_RADIUS) * 2)) {
          continue;
        }
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
        if (activeHq && reg !== activeHq.region) continue;
        const regHqs = gangHqs.filter((h) => h.region === reg);
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

  private renderRegionsBackdrop(snapshot?: WorldSnapshot) {
    if (!this.bgGfx || !this.borderGfx || !this.regionCropGfx) return;
    const gfx = this.bgGfx;
    const bgBorder = this.borderGfx;
    gfx.clear();
    bgBorder.clear();
    this.regionCropGfx.clear();

    const worldW = 4600;
    const startX = -300;

    const snap = snapshot || this.currentSnapshot;
    const activeHq = this.viewMode === 'REGION' && this.activeRegionHqId && snap ? snap.locations[this.activeRegionHqId] : null;

    if (this.viewMode === 'GEO' || !activeHq) {
      // GEO VIEW: Show all regions, floors, borders, and labels across the globe
      this.floorTile.setVisible(true);
      this.ukFloorTile.setVisible(true);
      this.europeFloorTile.setVisible(true);
      this.africaFloorTile.setVisible(true);
      this.channelWaterTile.setVisible(true);
      this.medWaterTile.setVisible(true);

      // Land Region atmospheric tints
      gfx.fillStyle(0x0c1b2e, 0.22);
      gfx.fillRect(startX, REGION_BOUNDS.UK.yMin, worldW, REGION_BOUNDS.UK.yMax - REGION_BOUNDS.UK.yMin);
      gfx.fillStyle(0x0d2222, 0.18);
      gfx.fillRect(startX, REGION_BOUNDS.EUROPE.yMin, worldW, REGION_BOUNDS.EUROPE.yMax - REGION_BOUNDS.EUROPE.yMin);
      gfx.fillStyle(0x291910, 0.22);
      gfx.fillRect(startX, REGION_BOUNDS.AFRICA.yMin, worldW, REGION_BOUNDS.AFRICA.yMax - REGION_BOUNDS.AFRICA.yMin);

      // Subtle grid lines
      gfx.lineStyle(1, 0x0f172a, 0.25);
      for (let x = startX; x <= startX + worldW; x += 64) {
        gfx.lineBetween(x, REGION_BOUNDS.UK.yMin, x, REGION_BOUNDS.UK.yMax);
        gfx.lineBetween(x, REGION_BOUNDS.EUROPE.yMin, x, REGION_BOUNDS.EUROPE.yMax);
        gfx.lineBetween(x, REGION_BOUNDS.AFRICA.yMin, x, REGION_BOUNDS.AFRICA.yMax);
      }

      // Full-length Channel and Mediterranean borders
      this.drawFullChannelBorders(startX, worldW);
      this.drawFullMediterraneanBorders(startX, worldW);
      this.updateStaticRegionLabels('GEO', null);
    } else {
      // REGION VIEW: CROP OUT OTHER REGIONS! Only show local operational theatre around active HQ
      this.floorTile.setVisible(false);
      this.ukFloorTile.setVisible(activeHq.region === 'UK');
      this.europeFloorTile.setVisible(activeHq.region === 'EUROPE');
      this.africaFloorTile.setVisible(activeHq.region === 'AFRICA');
      this.channelWaterTile.setVisible(activeHq.region === 'UK' || activeHq.region === 'EUROPE');
      this.medWaterTile.setVisible(activeHq.region === 'EUROPE' || activeHq.region === 'AFRICA');

      const bounds = REGION_BOUNDS[activeHq.region];
      const radius = activeHq.influenceRadius || BASE_HQ_INFLUENCE_RADIUS;
      const cropRadius = Math.round(radius * 1.45);

      const localLeft = activeHq.x - cropRadius;
      const localRight = activeHq.x + cropRadius;
      const localW = cropRadius * 2;
      const yMin = bounds.yMin;
      const yMax = bounds.yMax;
      const yHeight = yMax - yMin;

      // Local land tint
      const regColor = activeHq.region === 'UK' ? 0x0c1b2e : activeHq.region === 'EUROPE' ? 0x0d2222 : 0x291910;
      gfx.fillStyle(regColor, 0.35);
      gfx.fillRect(localLeft, yMin, localW, yHeight);

      // Local grid lines within operational bounds
      gfx.lineStyle(1, 0x1e293b, 0.35);
      for (let x = localLeft; x <= localRight; x += 64) {
        gfx.lineBetween(x, yMin, x, yMax);
      }

      // Local maritime borders if adjacent to sea
      if (activeHq.region === 'UK') {
        this.drawLocalBorderLine(localLeft, localRight, 200, 0x0284c7, 0x38bdf8, 198);
      } else if (activeHq.region === 'EUROPE') {
        this.drawLocalBorderLine(localLeft, localRight, 400, 0x059669, 0x4ade80, 402);
        this.drawLocalBorderLine(localLeft, localRight, 1600, 0x059669, 0x4ade80, 1598);
      } else if (activeHq.region === 'AFRICA') {
        this.drawLocalBorderLine(localLeft, localRight, 1850, 0xd97706, 0xfb923c, 1852);
      }

      // DARK VOID CROP MASK (regionCropGfx at depth 1.8)
      // Crop out other regions & crop stuff beyond local operational bounds
      const bigW = 8000;
      const bigH = 8000;
      this.regionCropGfx.fillStyle(0x080c14, 0.98);
      // West void
      this.regionCropGfx.fillRect(localLeft - bigW, -4000, bigW, bigH * 2);
      // East void
      this.regionCropGfx.fillRect(localRight, -4000, bigW, bigH * 2);
      // North void (other regions above)
      this.regionCropGfx.fillRect(localLeft - 200, yMin - bigH, localW + 400, bigH);
      // South void (other regions below)
      this.regionCropGfx.fillRect(localLeft - 200, yMax, localW + 400, bigH);

      // Operational theatre perimeter frame
      this.regionCropGfx.lineStyle(2, 0x334155, 0.85);
      this.regionCropGfx.strokeRect(localLeft, yMin, localW, yHeight);

      // Horizon crop circle strictly clipped to region bounds
      this.regionCropGfx.lineStyle(1.5, 0x475569, 0.5);
      drawClippedCircle(this.regionCropGfx, activeHq.x, activeHq.y, cropRadius, bounds.yMin, bounds.yMax, true);

      // Core influence boundary line strictly clipped to region bounds (delimits full color core vs greyscale periphery)
      this.regionCropGfx.lineStyle(1.5, 0x64748b, 0.7);
      drawClippedCircle(this.regionCropGfx, activeHq.x, activeHq.y, radius, bounds.yMin, bounds.yMax, true);

      this.updateStaticRegionLabels('REGION', activeHq);
    }
  }

  private drawLocalBorderLine(
    startX: number,
    endX: number,
    y: number,
    solidColor: number,
    stripeColor: number,
    stripeY: number
  ) {
    const bgBorder = this.borderGfx;
    const w = endX - startX;
    bgBorder.fillStyle(solidColor, 0.45);
    bgBorder.fillRect(startX, y - 3, w, 6);
    bgBorder.lineStyle(3, solidColor, 0.95);
    bgBorder.lineBetween(startX, y, endX, y);
    bgBorder.lineStyle(2, stripeColor, 0.85);
    for (let x = startX; x < endX; x += 24) {
      bgBorder.lineBetween(x, stripeY, Math.min(x + 14, endX), stripeY);
    }
  }

  private drawFullChannelBorders(startX: number, worldW: number) {
    const bgBorder = this.borderGfx;
    bgBorder.fillStyle(0x0c4a6e, 0.45);
    bgBorder.fillRect(startX, 194, worldW, 6);
    bgBorder.lineStyle(3, 0x0284c7, 0.95);
    bgBorder.lineBetween(startX, 200, startX + worldW, 200);
    bgBorder.lineStyle(2, 0x38bdf8, 0.85);
    for (let x = startX; x < startX + worldW; x += 24) {
      bgBorder.lineBetween(x, 198, x + 14, 198);
    }
    bgBorder.lineStyle(1.5, 0xbae6fd, 0.55);
    bgBorder.lineBetween(startX, 201, startX + worldW, 201);

    bgBorder.fillStyle(0x064e3b, 0.45);
    bgBorder.fillRect(startX, 400, worldW, 6);
    bgBorder.lineStyle(3, 0x059669, 0.95);
    bgBorder.lineBetween(startX, 400, startX + worldW, 400);
    bgBorder.lineStyle(2, 0x4ade80, 0.85);
    for (let x = startX; x < startX + worldW; x += 24) {
      bgBorder.lineBetween(x, 402, x + 14, 402);
    }
    bgBorder.lineStyle(1.5, 0xa7f3d0, 0.55);
    bgBorder.lineBetween(startX, 399, startX + worldW, 399);
  }

  private drawFullMediterraneanBorders(startX: number, worldW: number) {
    const bgBorder = this.borderGfx;
    bgBorder.fillStyle(0x064e3b, 0.45);
    bgBorder.fillRect(startX, 1594, worldW, 6);
    bgBorder.lineStyle(3, 0x059669, 0.95);
    bgBorder.lineBetween(startX, 1600, startX + worldW, 1600);
    bgBorder.lineStyle(2, 0x4ade80, 0.85);
    for (let x = startX; x < startX + worldW; x += 24) {
      bgBorder.lineBetween(x, 1598, x + 14, 1598);
    }
    bgBorder.lineStyle(1.5, 0xa7f3d0, 0.55);
    bgBorder.lineBetween(startX, 1601, startX + worldW, 1601);

    bgBorder.fillStyle(0x7c2d12, 0.45);
    bgBorder.fillRect(startX, 1850, worldW, 6);
    bgBorder.lineStyle(3, 0xd97706, 0.95);
    bgBorder.lineBetween(startX, 1850, startX + worldW, 1850);
    bgBorder.lineStyle(2, 0xfb923c, 0.85);
    for (let x = startX; x < startX + worldW; x += 24) {
      bgBorder.lineBetween(x, 1852, x + 14, 1852);
    }
    bgBorder.lineStyle(1.5, 0xfde68a, 0.55);
    bgBorder.lineBetween(startX, 1849, startX + worldW, 1849);
  }

  private renderPhysicalConnections(snapshot: WorldSnapshot) {
    const gfx = this.connectionsGfx;
    gfx.clear();

    // Discrete Zoom View: Regional physical connections are hidden in GEO View
    if (this.viewMode === 'GEO') {
      return;
    }

    // If no gang selected, connections are hidden
    if (this.selectedGangIds.size === 0) {
      return;
    }

    const activeHq = this.viewMode === 'REGION' && this.activeRegionHqId ? snapshot.locations[this.activeRegionHqId] : null;
    const radius = activeHq ? (activeHq.influenceRadius || BASE_HQ_INFLUENCE_RADIUS) : 0;
    const cropRadius = Math.round(radius * 1.45);

    // Only draw connections belonging to selected gangs
    for (const conn of Object.values(snapshot.connections)) {
      const src = snapshot.locations[conn.sourceId];
      const tgt = snapshot.locations[conn.targetId];
      if (!src || !tgt) continue;
      if (!this.selectedGangIds.has(src.gangId) || !this.selectedGangIds.has(tgt.gangId)) continue;

      if (activeHq) {
        // Crop out connections belonging to other regions
        if (src.region !== activeHq.region && tgt.region !== activeHq.region) continue;
        const srcDist = Math.hypot(src.x - activeHq.x, src.y - activeHq.y);
        const tgtDist = Math.hypot(tgt.x - activeHq.x, tgt.y - activeHq.y);
        // Crop connections too far beyond influence zone
        if (srcDist > cropRadius && tgtDist > cropRadius) continue;

        const isPeriphery = srcDist > radius || tgtDist > radius;
        if (isPeriphery) {
          // Greyscale periphery connection
          gfx.lineStyle(1.5, 0x475569, 0.25);
        } else if (conn.mode === 'SEA') {
          gfx.lineStyle(2, 0x0284c7, 0.35);
        } else {
          gfx.lineStyle(2, 0x475569, 0.4);
        }
      } else {
        if (conn.mode === 'SEA') {
          gfx.lineStyle(2, 0x0284c7, 0.35);
        } else {
          gfx.lineStyle(2, 0x475569, 0.4);
        }
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

    const activeHq = this.activeRegionHqId ? snapshot.locations[this.activeRegionHqId] : null;

    for (const loc of Object.values(snapshot.locations)) {
      let container = this.locationContainers.get(loc.id);
      if (!container) {
        container = this.createLocationNode(loc, snapshot);
        this.locationContainers.set(loc.id, container);
        this.nodesContainer.add(container);
      }

      // Discrete Zoom View Level Rules:
      // 1. GEO View: ONLY show HQ nodes! All operational and candidate nodes are abstracted into HQs.
      if (this.viewMode === 'GEO') {
        const isHq = loc.kind === 'HQ';
        const isHqVisible = isHq && (this.selectedGangIds.has(loc.gangId) || this.selectedGangIds.size === 0);
        container.setVisible(isHqVisible);

        const hitZone = container.list.find((obj) => obj instanceof Phaser.GameObjects.Zone) as Phaser.GameObjects.Zone | undefined;
        if (hitZone && hitZone.input) {
          hitZone.input.enabled = isHqVisible;
        }

        if (isHqVisible) {
          this.updateLocationNode(container, loc, snapshot, false);
        }
        continue;
      }

      // 2. REGION View: Show detailed nodes belonging to active HQ
      // Crop out other regions!
      if (!activeHq || loc.region !== activeHq.region) {
        container.setVisible(false);
        const hitZone = container.list.find((obj) => obj instanceof Phaser.GameObjects.Zone) as Phaser.GameObjects.Zone | undefined;
        if (hitZone && hitZone.input) {
          hitZone.input.enabled = false;
        }
        continue;
      }

      const radius = activeHq.influenceRadius || BASE_HQ_INFLUENCE_RADIUS;
      const cropRadius = Math.round(radius * 1.45);
      const dist = Math.hypot(loc.x - activeHq.x, loc.y - activeHq.y);

      // Crop stuff too far beyond the influence zone of selected HQ
      if (dist > cropRadius) {
        container.setVisible(false);
        const hitZone = container.list.find((obj) => obj instanceof Phaser.GameObjects.Zone) as Phaser.GameObjects.Zone | undefined;
        if (hitZone && hitZone.input) {
          hitZone.input.enabled = false;
        }
        continue;
      }

      // Inside active region theatre: show owned nodes and candidate sites (prospects)
      const isCandidate = loc.operationalStatus === 'DISCOVERED_CANDIDATE';
      const isOwned = loc.gangId !== 'NEUTRAL' && !isCandidate;
      const isCandidateVisible = isCandidate && (!loc.discoveredByGangId || this.selectedGangIds.has(loc.discoveredByGangId) || this.selectedGangIds.size === 0);
      const isOwnedVisible = isOwned && this.selectedGangIds.has(loc.gangId);
      const isVisible = isOwnedVisible || isCandidateVisible;
      container.setVisible(isVisible);

      const hitZone = container.list.find((obj) => obj instanceof Phaser.GameObjects.Zone) as Phaser.GameObjects.Zone | undefined;
      if (hitZone && hitZone.input) {
        hitZone.input.enabled = isVisible;
      }

      if (isVisible) {
        const isBeyondInfluence = dist > radius;
        this.updateLocationNode(container, loc, snapshot, isBeyondInfluence);
      }
    }
  }

  private createLocationNode(loc: LocationDef, snapshot: WorldSnapshot): Phaser.GameObjects.Container {
    const container = this.add.container(loc.x, loc.y);

    // Foundation Base Box
    const baseGfx = this.add.graphics();
    baseGfx.setName('baseGfx');
    container.add(baseGfx);

    // Regional illustrated building sprite with fallback to animated machine tile
    const spriteKey = getRegionalNodeSpriteKey(loc);
    if (this.textures.exists(spriteKey)) {
      const scale = getRegionalNodeSpriteScale(spriteKey);
      const sprite = this.add.sprite(0, -6, spriteKey);
      sprite.setName('nodeSprite');
      sprite.setScale(scale);
      sprite.setOrigin(0.5, 0.65);
      container.add(sprite);
    } else {
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
          sprite.setName('nodeSprite');
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
          sprite.setName('nodeSprite');
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
          sprite.setName('nodeSprite');
          sprite.setScale(0.35);
          sprite.play(animKey);
          container.add(sprite);
        } else {
          // Depot node: pressure-tank mk1 (1 frame)
          const sprite = this.add.sprite(0, -4, tileKey, 0);
          sprite.setName('nodeSprite');
          sprite.setScale(0.35);
          container.add(sprite);
        }
      } else if (this.textures.exists(`icon_${loc.tileFamily}`)) {
        const icon = this.add.image(0, -4, `icon_${loc.tileFamily}`);
        icon.setName('nodeIcon');
        icon.setScale(0.7);
        container.add(icon);
      }
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
    nameText.setName('nameText');
    nameText.setOrigin(0.5, 0);
    nameText.setResolution(2);
    container.add(nameText);

    // Badges / waiting migrants count
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
    const hitZone = this.add.zone(0, 0, 96, 96);
    hitZone.setInteractive(
      new Phaser.Geom.Rectangle(-48, -48, 96, 96),
      Phaser.Geom.Rectangle.Contains
    );
    if (hitZone.input) {
      hitZone.input.cursor = 'pointer';
    }
    hitZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.justSelectedInteractiveObject = true;
        this.isDragging = false;
        this.selectedLocationId = loc.id;
        this.selectedRouteId = null;
        this.selectedVoyageId = null;
        this.selectedCorridorBundleId = null;
        if (loc.gangId) {
          this.selectedGangIds.add(loc.gangId);
        }

        // Clicking an HQ: ALWAYS go to regional view FOR THAT HQ, centered on it!
        if (loc.kind === 'HQ') {
          this.switchToRegionView(loc.id);
        } else {
          this.renderWorld(this.currentSnapshot);
        }
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

    this.updateLocationNode(container, loc, snapshot, false);
    return container;
  }

  private updateLocationNode(
    container: Phaser.GameObjects.Container,
    loc: LocationDef,
    snapshot: WorldSnapshot,
    isBeyondInfluence = false
  ) {
    const baseGfx = container.getByName('baseGfx') as Phaser.GameObjects.Graphics;
    const badgeGfx = container.getByName('badgeGfx') as Phaser.GameObjects.Graphics;
    const countText = container.getByName('countText') as Phaser.GameObjects.Text;
    const sprite = (container.getByName('nodeSprite') || container.list.find((obj) => obj instanceof Phaser.GameObjects.Sprite)) as Phaser.GameObjects.Sprite | undefined;
    const nameText = (container.getByName('nameText') || container.list.find((obj) => obj instanceof Phaser.GameObjects.Text && obj.name !== 'countText')) as Phaser.GameObjects.Text | undefined;

    if (!baseGfx || !badgeGfx || !countText) return;

    baseGfx.clear();
    badgeGfx.clear();

    const isSelected = this.selectedLocationId === loc.id;
    const gang = snapshot.gangs[loc.gangId];
    const isCandidate = loc.operationalStatus === 'DISCOVERED_CANDIDATE' || loc.gangId === 'NEUTRAL';
    const isUnstaffed = !isCandidate && !loc.assignedHoodId;

    // Sprite greyscale tint
    if (sprite) {
      if (isBeyondInfluence) {
        sprite.setTint(0x78716c);
        sprite.setAlpha(0.65);
      } else {
        sprite.clearTint();
        sprite.setAlpha(1.0);
      }
    }

    // Nameplate text color
    if (nameText) {
      if (isBeyondInfluence) {
        nameText.setColor('#94a3b8');
      } else {
        nameText.setColor('#f8fafc');
      }
    }

    // Foundation Base Box / Isometric Ground Footprint
    if (isBeyondInfluence) {
      baseGfx.fillStyle(0x0a0f1d, 0.4);
      baseGfx.fillEllipse(0, 16, 76, 38);
      if (isSelected) {
        baseGfx.lineStyle(3, 0xfacc15, 0.9);
        baseGfx.strokeEllipse(0, 16, 82, 41);
      } else {
        baseGfx.lineStyle(1.5, 0x64748b, 0.6);
        baseGfx.strokeEllipse(0, 16, 78, 39);
      }
    } else {
      baseGfx.fillStyle(0x0a0f1d, 0.72);
      baseGfx.fillEllipse(0, 16, 76, 38);

      const strokeColor = gang ? gang.colorNum : 0x475569;
      if (isSelected) {
        baseGfx.lineStyle(3.5, 0xfacc15, 1.0);
        baseGfx.strokeEllipse(0, 16, 84, 42);
        baseGfx.lineStyle(1.5, 0xffffff, 0.9);
        baseGfx.strokeEllipse(0, 16, 78, 39);
      } else if (isCandidate) {
        baseGfx.lineStyle(2.5, 0x38bdf8, 0.85);
        baseGfx.strokeEllipse(0, 16, 80, 40);
      } else {
        baseGfx.lineStyle(2, strokeColor, 0.9);
        baseGfx.strokeEllipse(0, 16, 78, 39);
      }
    }

    // Badges / waiting count
    if (isBeyondInfluence) {
      countText.setColor('#94a3b8');
      badgeGfx.fillStyle(0x1e293b, 0.85);
      badgeGfx.lineStyle(1.5, 0x64748b, 0.7);

      if (isCandidate) {
        const remaining = loc.expiresAtTick !== undefined ? Math.max(0, loc.expiresAtTick - snapshot.tick) : null;
        const timerStr = remaining !== null ? ` ⏳${remaining}t` : '';
        countText.setText(`[OUT] $${loc.candidateCost || 1500}${timerStr}`);
        badgeGfx.fillRoundedRect(-52, -54, 104, 18, 4);
        badgeGfx.strokeRoundedRect(-52, -54, 104, 18, 4);
      } else if (isUnstaffed) {
        countText.setText('⚠️ UNSTAFFED');
        badgeGfx.fillRoundedRect(-44, -54, 88, 18, 4);
        badgeGfx.strokeRoundedRect(-44, -54, 88, 18, 4);
      } else if (loc.kind === 'RECRUITER') {
        const migrantsHere = Object.values(snapshot.migrants).filter(
          (c) => c.originId === loc.id && (c.status === 'WAITING' || c.status === 'RECRUITED')
        );
        if (migrantsHere.length > 0) {
          countText.setText(`👤 ${migrantsHere.length}`);
          badgeGfx.fillRoundedRect(-24, -54, 48, 18, 4);
          badgeGfx.strokeRoundedRect(-24, -54, 48, 18, 4);
        } else {
          countText.setText('');
        }
      } else if (loc.kind === 'DEPOT' || loc.kind === 'WORKSHOP') {
        const migrantsHere = Object.values(snapshot.migrants).filter(
          (c) => c.originId === loc.id && c.status === 'ARRIVED'
        );
        if (migrantsHere.length > 0) {
          const icon = loc.kind === 'DEPOT' ? '📦' : '⚙️';
          countText.setText(`${icon} ${migrantsHere.length}`);
          badgeGfx.fillRoundedRect(-24, -54, 48, 18, 4);
          badgeGfx.strokeRoundedRect(-24, -54, 48, 18, 4);
        } else {
          countText.setText('');
        }
      } else {
        countText.setText('');
      }
    } else {
      // Normal badge rendering in vibrant colors
      if (isCandidate) {
        const remaining = loc.expiresAtTick !== undefined ? Math.max(0, loc.expiresAtTick - snapshot.tick) : null;
        const timerStr = remaining !== null ? ` ⏳${remaining}t` : '';
        countText.setColor('#38bdf8');
        countText.setText(`$${loc.candidateCost || 1500}${timerStr}`);
        badgeGfx.fillStyle(0x0f172a, 0.92);
        badgeGfx.fillRoundedRect(-44, -54, 88, 18, 4);
        badgeGfx.lineStyle(1.5, 0x38bdf8, 0.9);
        badgeGfx.strokeRoundedRect(-44, -54, 88, 18, 4);
      } else if (isUnstaffed) {
        countText.setColor('#f59e0b');
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

        countText.setColor(gang.color);
        const hqLabel = loc.isMainHq ? '⭐ MAIN' : '⚡ HQ';
        countText.setText(hqLabel);
        badgeGfx.fillStyle(0x0f172a, 0.9);
        badgeGfx.fillRoundedRect(-30, -54, 60, 18, 4);
        badgeGfx.lineStyle(1.5, gang.colorNum, 0.9);
        badgeGfx.strokeRoundedRect(-30, -54, 60, 18, 4);
      } else if (loc.kind === 'RECRUITER') {
        const migrantsHere = Object.values(snapshot.migrants).filter(
          (c) => c.originId === loc.id && (c.status === 'WAITING' || c.status === 'RECRUITED')
        );
        if (migrantsHere.length > 0) {
          countText.setColor('#38bdf8');
          countText.setText(`👤 ${migrantsHere.length}`);
          badgeGfx.fillStyle(0x0f172a, 0.9);
          badgeGfx.fillRoundedRect(-24, -54, 48, 18, 4);
          badgeGfx.lineStyle(1.5, gang ? gang.colorNum : 0x38bdf8, 0.85);
          badgeGfx.strokeRoundedRect(-24, -54, 48, 18, 4);
        } else {
          countText.setText('');
        }
      } else if (loc.kind === 'DEPOT') {
        const migrantsHere = Object.values(snapshot.migrants).filter(
          (c) => c.originId === loc.id && c.status === 'ARRIVED'
        );
        if (migrantsHere.length > 0) {
          countText.setColor('#10b981');
          countText.setText(`📦 ${migrantsHere.length}`);
          badgeGfx.fillStyle(0x0f172a, 0.9);
          badgeGfx.fillRoundedRect(-24, -54, 48, 18, 4);
          badgeGfx.lineStyle(1.5, 0x10b981, 0.85);
          badgeGfx.strokeRoundedRect(-24, -54, 48, 18, 4);
        } else {
          countText.setText('');
        }
      } else if (loc.kind === 'WORKSHOP') {
        const migrantsHere = Object.values(snapshot.migrants).filter(
          (c) => c.originId === loc.id && c.status === 'ARRIVED'
        );
        if (migrantsHere.length > 0) {
          countText.setColor('#f59e0b');
          countText.setText(`⚙️ ${migrantsHere.length}`);
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
  }

  /**
   * Route Services:
   * Recruiter -> Depot ONLY!
   * 1 route max between nodes.
   * Only rendered when owning gang is selected.
   */
  /**
   * Route Services:
   * In GEO View: bundled into a single Trunk Line between HQs.
   * In REGION View: detailed individual routes between Recruiters and Depots.
   */
  private renderParallelRoutes(snapshot: WorldSnapshot) {
    if (this.viewMode === 'GEO') {
      this.renderTrunkCorridors(snapshot);
    } else {
      this.renderRegionRoutes(snapshot);
    }
  }

  private renderTrunkCorridors(snapshot: WorldSnapshot) {
    const gfx = this.routesGfx;
    gfx.clear();
    this.corridorLineCoords.clear();

    // Clean region route hit zones
    for (const zone of this.routeHitZones.values()) {
      zone.destroy();
    }
    this.routeHitZones.clear();

    if (this.selectedGangIds.size === 0) {
      this.cleanupTrunkHitZones();
      return;
    }

    // Group active routes into corridor bundles between distinct HQs
    const activeRoutes = Object.values(snapshot.routes).filter(
      (r) => this.selectedGangIds.has(r.gangId) && (r.status === 'ACTIVE' || r.activeVoyageCount > 0)
    );

    const bundlesMap = new Map<string, CorridorBundle>();
    for (const route of activeRoutes) {
      const srcLoc = snapshot.locations[route.sourceId];
      const tgtLoc = snapshot.locations[route.targetId];
      if (!srcLoc || !tgtLoc) continue;

      const srcHq = getClosestHqForNode(srcLoc, snapshot);
      const tgtHq = getClosestHqForNode(tgtLoc, snapshot);
      if (!srcHq || !tgtHq || srcHq.id === tgtHq.id) continue;

      const bundleId = `CORRIDOR_${route.gangId}_${srcHq.id}_${tgtHq.id}`;
      let bundle = bundlesMap.get(bundleId);
      if (!bundle) {
        bundle = {
          id: bundleId,
          gangId: route.gangId,
          sourceHqId: srcHq.id,
          targetHqId: tgtHq.id,
          routes: [],
          totalActiveVoyages: 0,
          totalDelivered: 0,
          totalRevenue: 0,
          modes: [],
        };
        bundlesMap.set(bundleId, bundle);
      }
      bundle.routes.push(route);
      bundle.totalActiveVoyages += route.activeVoyageCount;
      bundle.totalDelivered += route.totalPassengers;
      bundle.totalRevenue += route.revenue;
      if (!bundle.modes.includes(route.mode)) {
        bundle.modes.push(route.mode);
      }
    }

    this.corridorBundles = bundlesMap;

    // Clean obsolete trunk hit zones and badges
    const activeBundleIds = new Set(bundlesMap.keys());
    for (const [id, zone] of this.trunkRouteHitZones.entries()) {
      if (!activeBundleIds.has(id)) {
        zone.destroy();
        this.trunkRouteHitZones.delete(id);
      }
    }
    for (const [id, badge] of this.trunkRouteBadges.entries()) {
      if (!activeBundleIds.has(id)) {
        badge.destroy();
        this.trunkRouteBadges.delete(id);
      }
    }

    // Group parallel bundles between the same pair of HQs to calculate parallel offsets
    const pairCount: Record<string, number> = {};
    const pairIndex: Record<string, number> = {};
    for (const bundle of bundlesMap.values()) {
      const pairKey = [bundle.sourceHqId, bundle.targetHqId].sort().join('<->');
      pairCount[pairKey] = (pairCount[pairKey] || 0) + 1;
    }

    for (const bundle of bundlesMap.values()) {
      const srcHq = snapshot.locations[bundle.sourceHqId];
      const tgtHq = snapshot.locations[bundle.targetHqId];
      if (!srcHq || !tgtHq) continue;

      const pairKey = [bundle.sourceHqId, bundle.targetHqId].sort().join('<->');
      const totalPairs = pairCount[pairKey] || 1;
      const idx = pairIndex[pairKey] || 0;
      pairIndex[pairKey] = idx + 1;

      const dx = tgtHq.x - srcHq.x;
      const dy = tgtHq.y - srcHq.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) continue;

      const nx = -dy / dist;
      const ny = dx / dist;
      const offsetMag = (idx - (totalPairs - 1) / 2) * 22;

      const x1 = srcHq.x + nx * offsetMag;
      const y1 = srcHq.y + ny * offsetMag;
      const x2 = tgtHq.x + nx * offsetMag;
      const y2 = tgtHq.y + ny * offsetMag;

      this.corridorLineCoords.set(bundle.id, { x1, y1, x2, y2 });

      const gang = snapshot.gangs[bundle.gangId];
      const isSelected = this.selectedCorridorBundleId === bundle.id;
      const color = gang ? gang.colorNum : 0x38bdf8;
      const thickness = Math.min(8, 4 + bundle.routes.length * 1.5);

      if (isSelected) {
        // High-contrast gold halo
        gfx.lineStyle(thickness + 6, 0xfacc15, 0.9);
        gfx.lineBetween(x1, y1, x2, y2);
        gfx.lineStyle(thickness, 0xffffff, 1.0);
        gfx.lineBetween(x1, y1, x2, y2);
      } else {
        gfx.lineStyle(thickness + 2, 0x080c14, 0.7);
        gfx.lineBetween(x1, y1, x2, y2);
        gfx.lineStyle(thickness, color, 0.95);
        gfx.lineBetween(x1, y1, x2, y2);
      }

      // Direction chevrons along trunk line
      const angle = Math.atan2(dy, dx);
      const arrowLen = 10;
      gfx.lineStyle(2.5, isSelected ? 0xffffff : color, 1.0);
      for (const frac of [0.35, 0.65]) {
        const cx = x1 + dx * frac;
        const cy = y1 + dy * frac;
        gfx.beginPath();
        gfx.moveTo(cx, cy);
        gfx.lineTo(cx - arrowLen * Math.cos(angle - Math.PI / 5), cy - arrowLen * Math.sin(angle - Math.PI / 5));
        gfx.moveTo(cx, cy);
        gfx.lineTo(cx - arrowLen * Math.cos(angle + Math.PI / 5), cy - arrowLen * Math.sin(angle + Math.PI / 5));
        gfx.strokePath();
      }

      // Midpoint badge
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      let badge = this.trunkRouteBadges.get(bundle.id);
      if (!badge) {
        badge = this.createTrunkBadge();
        this.trunkRouteBadges.set(bundle.id, badge);
        this.labelsContainer.add(badge);
      }
      badge.setPosition(midX, midY);
      this.updateTrunkBadge(badge, bundle, isSelected, gang);

      // Hit zone
      const zoneW = Math.max(dist, 50);
      const zoneH = 36;
      let zone = this.trunkRouteHitZones.get(bundle.id);
      if (!zone) {
        zone = this.add.zone(midX, midY, zoneW, zoneH);
        zone.setRotation(angle);
        zone.setInteractive(
          new Phaser.Geom.Rectangle(-zoneW / 2, -zoneH / 2, zoneW, zoneH),
          Phaser.Geom.Rectangle.Contains
        );
        zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          if (pointer.leftButtonDown()) {
            this.justSelectedInteractiveObject = true;
            this.selectedCorridorBundleId = bundle.id;
            this.selectedRouteId = null;
            this.selectedLocationId = null;
            this.selectedVoyageId = null;
            this.renderWorld(this.currentSnapshot);
            if (this.eventsHandler.onSelectCorridorBundle) {
              this.eventsHandler.onSelectCorridorBundle(bundle, this.currentSnapshot);
            }
          }
        });
        this.trunkRouteHitZones.set(bundle.id, zone);
      } else {
        zone.setPosition(midX, midY);
        zone.setRotation(angle);
        zone.setSize(zoneW, zoneH);
        if (zone.input && zone.input.hitArea) {
          (zone.input.hitArea as Phaser.Geom.Rectangle).setTo(-zoneW / 2, -zoneH / 2, zoneW, zoneH);
        }
      }
    }
  }

  private renderRegionRoutes(snapshot: WorldSnapshot) {
    const gfx = this.routesGfx;
    gfx.clear();

    this.cleanupTrunkHitZones();

    if (this.selectedGangIds.size === 0) {
      for (const zone of this.routeHitZones.values()) {
        zone.destroy();
      }
      this.routeHitZones.clear();
      return;
    }

    const activeHq = this.activeRegionHqId ? snapshot.locations[this.activeRegionHqId] : null;
    const radius = activeHq ? (activeHq.influenceRadius || BASE_HQ_INFLUENCE_RADIUS) : 0;
    const cropRadius = Math.round(radius * 1.45);

    // Filter routes belonging to active HQ: either source or target belongs to this HQ
    const routesToRender = Object.values(snapshot.routes).filter((r) => {
      if (!this.selectedGangIds.has(r.gangId) || (r.status !== 'ACTIVE' && r.activeVoyageCount <= 0)) {
        return false;
      }
      const src = snapshot.locations[r.sourceId];
      const tgt = snapshot.locations[r.targetId];
      if (!src || !tgt) return false;
      if (!activeHq) return true;

      // Crop out routes in other regions
      if (src.region !== activeHq.region && tgt.region !== activeHq.region) {
        return false;
      }

      // Crop out routes where both endpoints are beyond cropRadius
      const srcDist = Math.hypot(src.x - activeHq.x, src.y - activeHq.y);
      const tgtDist = Math.hypot(tgt.x - activeHq.x, tgt.y - activeHq.y);
      if (srcDist > cropRadius && tgtDist > cropRadius) {
        return false;
      }

      const srcHq = getClosestHqForNode(src, snapshot);
      const tgtHq = getClosestHqForNode(tgt, snapshot);
      return srcHq?.id === activeHq.id || tgtHq?.id === activeHq.id || srcDist <= cropRadius || tgtDist <= cropRadius;
    });

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

      const srcDist = activeHq ? Math.hypot(src.x - activeHq.x, src.y - activeHq.y) : 0;
      const tgtDist = activeHq ? Math.hypot(tgt.x - activeHq.x, tgt.y - activeHq.y) : 0;
      const isPeriphery = activeHq && (srcDist > radius || tgtDist > radius);

      const gang = snapshot.gangs[route.gangId];
      const isSelected = this.selectedRouteId === route.id;
      const color = isPeriphery ? 0x64748b : (gang ? gang.colorNum : 0x38bdf8);

      if (isSelected) {
        gfx.lineStyle(7, 0xfacc15, 0.85);
        gfx.lineBetween(src.x, src.y, tgt.x, tgt.y);
        gfx.lineStyle(3.5, 0xffffff, 1.0);
        gfx.lineBetween(src.x, src.y, tgt.x, tgt.y);
      } else if (isPeriphery) {
        gfx.lineStyle(2.5, 0x64748b, 0.65);
        gfx.lineBetween(src.x, src.y, tgt.x, tgt.y);
      } else {
        gfx.lineStyle(3.0, color, 0.9);
        gfx.lineBetween(src.x, src.y, tgt.x, tgt.y);
      }

      // Direction arrow
      const midX = (src.x + tgt.x) / 2;
      const midY = (src.y + tgt.y) / 2;
      const arrowAngle = Math.atan2(dy, dx);
      const arrowLen = 8;
      const arrowColor = isSelected ? 0xffffff : (isPeriphery ? 0x94a3b8 : color);

      gfx.lineStyle(2, arrowColor, isPeriphery ? 0.7 : 1.0);
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
        const zoneW = Math.max(dist, 40);
        const zoneH = 26;
        zone = this.add.zone(midX, midY, zoneW, zoneH);
        zone.setRotation(arrowAngle);
        zone.setInteractive(
          new Phaser.Geom.Rectangle(-zoneW / 2, -zoneH / 2, zoneW, zoneH),
          Phaser.Geom.Rectangle.Contains
        );
        zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          if (pointer.leftButtonDown()) {
            this.justSelectedInteractiveObject = true;
            this.selectedRouteId = route.id;
            this.selectedLocationId = null;
            this.selectedVoyageId = null;
            this.selectedCorridorBundleId = null;
            this.renderWorld(this.currentSnapshot);
            if (this.eventsHandler.onSelectRoute) {
              this.eventsHandler.onSelectRoute(route, this.currentSnapshot);
            }
          }
        });
        this.routeHitZones.set(route.id, zone);
      } else {
        const zoneW = Math.max(dist, 40);
        const zoneH = 26;
        zone.setPosition(midX, midY);
        zone.setRotation(arrowAngle);
        zone.setSize(zoneW, zoneH);
        if (zone.input && zone.input.hitArea) {
          (zone.input.hitArea as Phaser.Geom.Rectangle).setTo(-zoneW / 2, -zoneH / 2, zoneW, zoneH);
        }
      }
    }
  }

  private cleanupTrunkHitZones() {
    for (const zone of this.trunkRouteHitZones.values()) {
      zone.destroy();
    }
    this.trunkRouteHitZones.clear();
    for (const badge of this.trunkRouteBadges.values()) {
      badge.destroy();
    }
    this.trunkRouteBadges.clear();
  }

  private createTrunkBadge(): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);

    const bgGfx = this.add.graphics();
    bgGfx.setName('bgGfx');
    container.add(bgGfx);

    const text = this.add.text(0, 0, '', {
      fontFamily: '"JetBrains Mono", Consolas, monospace',
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#ffffff',
    });
    text.setName('badgeText');
    text.setOrigin(0.5, 0.5);
    text.setResolution(2);
    container.add(text);

    const badgeHitZone = this.add.zone(0, 0, 80, 24);
    badgeHitZone.setName('badgeHitZone');
    badgeHitZone.setInteractive({ cursor: 'pointer' });
    container.add(badgeHitZone);

    return container;
  }

  private updateTrunkBadge(
    container: Phaser.GameObjects.Container,
    bundle: CorridorBundle,
    isSelected: boolean,
    gang?: GangState
  ) {
    const bgGfx = container.getByName('bgGfx') as Phaser.GameObjects.Graphics;
    const text = container.getByName('badgeText') as Phaser.GameObjects.Text;
    if (!bgGfx || !text) return;

    bgGfx.clear();
    const color = gang ? gang.colorNum : 0x38bdf8;
    const isSea = bundle.modes.includes('BOAT');
    const modeIcon = isSea ? '🚢' : '🚐';
    const label = `${modeIcon} ${bundle.routes.length} ${bundle.routes.length === 1 ? 'Route' : 'Routes'} | ${bundle.totalActiveVoyages} Runs`;
    text.setText(label);

    const padX = 8;
    const padY = 3;
    const w = text.width + padX * 2;
    const h = text.height + padY * 2;

    bgGfx.fillStyle(0x0f172a, 0.92);
    bgGfx.fillRoundedRect(-w / 2, -h / 2, w, h, 4);

    if (isSelected) {
      bgGfx.lineStyle(2, 0xfacc15, 1.0);
      bgGfx.strokeRoundedRect(-w / 2, -h / 2, w, h, 4);
    } else {
      bgGfx.lineStyle(1.5, color, 0.85);
      bgGfx.strokeRoundedRect(-w / 2, -h / 2, w, h, 4);
    }

    const badgeHitZone = container.getByName('badgeHitZone') as Phaser.GameObjects.Zone;
    if (badgeHitZone) {
      badgeHitZone.setSize(w, h);
      badgeHitZone.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
      badgeHitZone.removeAllListeners('pointerdown');
      badgeHitZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.leftButtonDown()) {
          this.justSelectedInteractiveObject = true;
          this.selectedCorridorBundleId = bundle.id;
          this.selectedRouteId = null;
          this.selectedLocationId = null;
          this.selectedVoyageId = null;
          this.renderWorld(this.currentSnapshot);
          if (this.eventsHandler.onSelectCorridorBundle) {
            this.eventsHandler.onSelectCorridorBundle(bundle, this.currentSnapshot);
          }
        }
      });
    }
  }

  /**
   * Voyage Vehicles:
   * In GEO View: vehicles interpolate along trunk corridor lines between HQs.
   * In REGION View: vehicles interpolate along individual routes between nodes.
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

    // Update active vehicles along their route/corridor line
    for (const voyage of activeVoyages) {
      const route = snapshot.routes[voyage.routeId];
      const gang = snapshot.gangs[voyage.gangId];
      const src = snapshot.locations[voyage.sourceId];
      const tgt = snapshot.locations[voyage.targetId];
      if (!route || !src || !tgt) continue;

      let posX = 0;
      let posY = 0;
      let rotDx = 0;
      let rotDy = 0;
      let isVehiclePeriphery = false;

      if (this.viewMode === 'GEO') {
        const srcHq = getClosestHqForNode(src, snapshot);
        const tgtHq = getClosestHqForNode(tgt, snapshot);
        if (!srcHq || !tgtHq || srcHq.id === tgtHq.id) {
          // Intra-cluster local voyage is abstracted in Geo View
          const existing = this.vehicleSprites.get(voyage.id);
          if (existing) {
            existing.destroy();
            this.vehicleSprites.delete(voyage.id);
          }
          continue;
        }

        const bundleId = `CORRIDOR_${voyage.gangId}_${srcHq.id}_${tgtHq.id}`;
        const revBundleId = `CORRIDOR_${voyage.gangId}_${tgtHq.id}_${srcHq.id}`;
        const line = this.corridorLineCoords.get(bundleId);
        const revLine = !line ? this.corridorLineCoords.get(revBundleId) : null;

        if (line) {
          rotDx = line.x2 - line.x1;
          rotDy = line.y2 - line.y1;
          posX = line.x1 + rotDx * voyage.progress;
          posY = line.y1 + rotDy * voyage.progress;
        } else if (revLine) {
          rotDx = revLine.x1 - revLine.x2;
          rotDy = revLine.y1 - revLine.y2;
          posX = revLine.x2 + rotDx * voyage.progress;
          posY = revLine.y2 + rotDy * voyage.progress;
        } else {
          rotDx = tgtHq.x - srcHq.x;
          rotDy = tgtHq.y - srcHq.y;
          const dist = Math.hypot(rotDx, rotDy);
          if (dist === 0) continue;
          posX = srcHq.x + rotDx * voyage.progress;
          posY = srcHq.y + rotDy * voyage.progress;
        }
      } else {
        // REGION view: check if voyage belongs to active HQ operational theatre
        const activeHq = this.activeRegionHqId ? snapshot.locations[this.activeRegionHqId] : null;
        if (!activeHq || (src.region !== activeHq.region && tgt.region !== activeHq.region)) {
          const existing = this.vehicleSprites.get(voyage.id);
          if (existing) {
            existing.destroy();
            this.vehicleSprites.delete(voyage.id);
          }
          continue;
        }

        rotDx = tgt.x - src.x;
        rotDy = tgt.y - src.y;
        posX = src.x + rotDx * voyage.progress;
        posY = src.y + rotDy * voyage.progress;

        const radius = activeHq.influenceRadius || BASE_HQ_INFLUENCE_RADIUS;
        const distFromHq = Math.hypot(posX - activeHq.x, posY - activeHq.y);

        // Keep inter-region vessels visible in transit; tint as periphery if outside influence zone
        isVehiclePeriphery = distFromHq > radius;
      }

      let container = this.vehicleSprites.get(voyage.id);
      if (!container) {
        container = this.createVehicleSprite(voyage, gang);
        this.vehicleSprites.set(voyage.id, container);
        this.vehiclesContainer.add(container);
      }

      container.setPosition(posX, posY);

      const sprite = container.getByName('vehicleSprite') as Phaser.GameObjects.Sprite | null;
      if (sprite) {
        sprite.setFlipX(rotDx > 0);
        if (isVehiclePeriphery) {
          sprite.setTint(0x78716c);
          sprite.setAlpha(0.65);
        } else {
          sprite.clearTint();
          sprite.setAlpha(1.0);
        }

        if (voyage.mode === 'BOAT') {
          sprite.setY(Math.sin(voyage.progress * 35) * 2.5);
          sprite.setRotation(Math.sin(voyage.progress * 18) * 0.05);
        }
      }

      const body = container.getByName('vehicleBody') as Phaser.GameObjects.Graphics | null;
      if (body) {
        body.setRotation(Math.atan2(rotDy, rotDx));
      }

      const wakeGfx = container.getByName('vehicleWake') as Phaser.GameObjects.Graphics | null;
      if (wakeGfx) {
        wakeGfx.clear();
        if (voyage.mode === 'BOAT') {
          wakeGfx.lineStyle(1.5, 0xbae6fd, isVehiclePeriphery ? 0.35 : 0.55);
          wakeGfx.strokeEllipse(rotDx > 0 ? -18 : 18, 8, 22, 8);
        } else {
          wakeGfx.fillStyle(0x000000, isVehiclePeriphery ? 0.2 : 0.35);
          wakeGfx.fillEllipse(0, 15, 42, 14);
        }
      }

      const selectGfx = container.getByName('selectGfx') as Phaser.GameObjects.Graphics;
      if (selectGfx) {
        selectGfx.clear();
        if (this.selectedVoyageId === voyage.id) {
          selectGfx.lineStyle(2.5, 0xfacc15, 1.0);
          selectGfx.strokeEllipse(0, 0, 56, 36);
        }
      }

      const badge = container.getByName('passengerBadge') as Phaser.GameObjects.Text;
      if (badge) {
        badge.setText(`×${voyage.passengerIds.length}`);
        if (isVehiclePeriphery) {
          badge.setColor('#94a3b8');
          badge.setBackgroundColor('#1e293b');
        } else {
          badge.setColor('#ffffff');
          badge.setBackgroundColor('#0f172a');
        }
      }
    }
  }

  private createVehicleSprite(voyage: VoyageState, gang?: GangState): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);

    const selectGfx = this.add.graphics();
    selectGfx.setName('selectGfx');
    container.add(selectGfx);

    // Vehicle ground shadow / sea foam wake
    const wakeGfx = this.add.graphics();
    wakeGfx.setName('vehicleWake');
    container.add(wakeGfx);

    const isBoat = voyage.mode === 'BOAT';
    const textureKey = isBoat ? 'voyage_boat' : 'voyage_van';

    if (this.textures.exists(textureKey)) {
      const sprite = this.add.sprite(0, 0, textureKey);
      sprite.setName('vehicleSprite');
      sprite.setScale(isBoat ? 0.065 : 0.058);
      sprite.setOrigin(0.5, 0.5);
      container.add(sprite);
    } else {
      const gfx = this.add.graphics();
      gfx.setName('vehicleBody');
      const color = gang ? gang.colorNum : 0x38bdf8;
      if (isBoat) {
        gfx.fillStyle(color, 1);
        gfx.beginPath();
        gfx.moveTo(12, 0);
        gfx.lineTo(-8, -6);
        gfx.lineTo(-12, 0);
        gfx.lineTo(-8, 6);
        gfx.closePath();
        gfx.fillPath();
      } else {
        gfx.fillStyle(color, 1);
        gfx.fillRoundedRect(-11, -6, 22, 12, 3);
      }
      container.add(gfx);
    }

    // Passenger count badge - upright, never rotated
    const badge = this.add.text(0, -24, `×${voyage.passengerIds.length}`, {
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

    const hit = this.add.zone(0, 0, 48, 48);
    hit.setInteractive({ cursor: 'pointer' });
    hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.justSelectedInteractiveObject = true;
        this.selectedVoyageId = voyage.id;
        this.selectedLocationId = null;
        this.selectedRouteId = null;
        this.selectedCorridorBundleId = null;
        if (voyage.gangId) {
          this.selectedGangIds.add(voyage.gangId);
        }
        this.renderWorld(this.currentSnapshot);
        const gangState = this.currentSnapshot.gangs[voyage.gangId];
        if (gangState && this.eventsHandler.onSelectGang) {
          this.eventsHandler.onSelectGang(gangState, this.currentSnapshot);
        }
        if (this.eventsHandler.onSelectVoyage) {
          this.eventsHandler.onSelectVoyage(voyage, this.currentSnapshot);
        }
      }
    });
    container.add(hit);

    return container;
  }
}
