import Phaser from 'phaser';
import { engine, scheduler } from './app/state';
import { BrokeScene } from './presentation/BrokeScene';
import { HudOverlay } from './presentation/HudOverlay';

let hudOverlay: HudOverlay;

// Configure Phaser 4 Game
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#080c14',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    pixelArt: false,
    antialias: true,
    antialiasGL: true,
    roundPixels: true,
    mipmapFilter: 'LINEAR',
  },
  scene: [BrokeScene],
};

const game = new Phaser.Game(config);

window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth, window.innerHeight);
});

// Connect Scene and DOM HUD once ready
game.events.once('ready', () => {
  const scene = game.scene.getScene('BrokeScene') as BrokeScene;
  if (!scene) return;

  hudOverlay = new HudOverlay(engine, scheduler, {
    onSelectGangs: (gangIds) => scene.setSelectedGangs(gangIds),
    onFocusLocation: (locId) => scene.focusLocation(locId),
    onSelectRoute: (routeId) => scene.selectRoute(routeId),
    onToggleInfluence: () => scene.toggleInfluence(),
    onStartPlacement: (data) => scene.startPlacementMode(data),
    onCancelPlacement: () => scene.cancelPlacementMode(),
    onSwitchToGeoView: () => scene.switchToGeoView(),
    onSwitchToRegionView: (hqId) => scene.switchToRegionView(hqId),
  });

  scene.setEventsHandler({
    onSelectGang: (gang) => hudOverlay.selectGang(gang),
    onSelectLocation: (loc) => hudOverlay.selectLocation(loc),
    onSelectRoute: (route) => hudOverlay.selectRoute(route),
    onSelectVoyage: (voyage) => hudOverlay.selectVoyage(voyage),
    onSelectCorridorBundle: (bundle) => hudOverlay.selectCorridorBundle(bundle),
    onViewModeChanged: (mode, regionHq) => hudOverlay.setViewMode(mode, regionHq),
    onDeselectAll: () => hudOverlay.deselectEntity(),
    onCancelPlacement: () => {
      // Clean up any UI placement states if needed
    },
  });
});
