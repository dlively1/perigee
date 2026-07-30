import Phaser from "phaser";
import { getEventBus } from "../agent/events";

// No asset binaries — all art is drawn procedurally with Graphics in the scenes.
// Boot just wires the bridge's first events and hands off to the menu.
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    const bus = getEventBus();
    bus.emit({ type: "boot", t: 0 });
    bus.updateSnapshot({ ready: true, scene: "boot" });
    this.scene.start("menu");
  }
}
