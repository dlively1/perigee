import Phaser from "phaser";
import { getEventBus } from "../agent/events";
import { readAgentConfig } from "../agent/config";
import { TUNING } from "../sim/constants";

export class MenuScene extends Phaser.Scene {
  constructor() {
    super("menu");
  }

  create(): void {
    const bus = getEventBus();
    bus.emit({ type: "scene", t: 0, name: "menu" });
    bus.updateSnapshot({ scene: "menu" });

    const cx = TUNING.surface / 2;
    const cfg = readAgentConfig();

    if (cfg.autoplay) {
      this.scene.start("game");
      return;
    }

    this.add
      .text(cx, 210, "PERIGEE", {
        fontFamily: "ui-monospace, monospace",
        fontSize: "64px",
        color: "#e6ecf5",
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 280, "launch satellites · hold coverage · stay solvent", {
        fontFamily: "ui-monospace, monospace",
        fontSize: "16px",
        color: "#8fa1bc",
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 400, "click  or  press SPACE to start", {
        fontFamily: "ui-monospace, monospace",
        fontSize: "18px",
        color: "#3dd6a0",
      })
      .setOrigin(0.5);

    const start = () => this.scene.start("game");
    this.input.keyboard?.once("keydown-SPACE", start);
    this.input.keyboard?.once("keydown-ENTER", start);
    this.input.once("pointerdown", start);
  }
}
