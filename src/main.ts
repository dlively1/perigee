import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { GameScene } from "./scenes/GameScene";
import { initEventBus } from "./agent/events";
import { readAgentConfig } from "./agent/config";
import { TUNING } from "./sim/constants";

const cfg = readAgentConfig();
initEventBus(cfg.seed);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  antialias: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    expandParent: false,
    width: TUNING.surface,
    height: TUNING.surface,
  },
  backgroundColor: "#060912",
  scene: [BootScene, MenuScene, GameScene],
};

new Phaser.Game(config);
