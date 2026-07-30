import Phaser from "phaser";
import { TUNING } from "../sim/constants";

const FONT = "ui-monospace, monospace";

export interface HudState {
  cash: number;
  valuation: number;
  covered: boolean;
  sats: number;
  paused: boolean;
}

// Always-on runway / valuation / coverage overlay, plus the pause banner and
// the bankruptcy panel. Pure presentation — reads a state struct each frame.
export class GameHud {
  private runway: Phaser.GameObjects.Text;
  private valuation: Phaser.GameObjects.Text;
  private coverage: Phaser.GameObjects.Text;
  private sats: Phaser.GameObjects.Text;
  private pausedBanner: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;

  constructor(private scene: Phaser.Scene) {
    const w = TUNING.surface;

    this.runway = scene.add
      .text(18, 16, "", { fontFamily: FONT, fontSize: "22px", color: "#3dd6a0" })
      .setDepth(10);
    this.valuation = scene.add
      .text(18, 44, "", { fontFamily: FONT, fontSize: "14px", color: "#8fa1bc" })
      .setDepth(10);

    this.coverage = scene.add
      .text(w - 18, 16, "", { fontFamily: FONT, fontSize: "16px", color: "#8fa1bc" })
      .setOrigin(1, 0)
      .setDepth(10);
    this.sats = scene.add
      .text(w - 18, 40, "", { fontFamily: FONT, fontSize: "14px", color: "#8fa1bc" })
      .setOrigin(1, 0)
      .setDepth(10);

    scene.add
      .text(w / 2, w - 20, "click ring: launch   ·   click sat then B: boost   ·   SPACE: pause", {
        fontFamily: FONT,
        fontSize: "13px",
        color: "#5f6f88",
      })
      .setOrigin(0.5, 1)
      .setDepth(10);

    this.pausedBanner = scene.add
      .text(w / 2, 34, "❚❚ PAUSED", { fontFamily: FONT, fontSize: "16px", color: "#ef9f27" })
      .setOrigin(0.5, 0)
      .setDepth(10)
      .setVisible(false);
  }

  update(s: HudState): void {
    this.runway.setText(`RUNWAY  $${Math.round(s.cash)}`);
    this.runway.setColor(s.cash < TUNING.launchCost ? "#e24b4a" : "#3dd6a0");
    this.valuation.setText(`valuation  $${Math.round(s.valuation)}`);
    this.coverage.setText(s.covered ? "COVERAGE  ● live" : "COVERAGE  ○ gap");
    this.coverage.setColor(s.covered ? "#97c459" : "#e24b4a");
    this.sats.setText(`sats  ${s.sats}`);
    this.pausedBanner.setVisible(s.paused);
  }

  showGameOver(valuation: number): void {
    if (this.overlay) return;
    const w = TUNING.surface;
    const panel = this.scene.add
      .rectangle(w / 2, w / 2, 420, 200, 0x0e1526, 0.94)
      .setStrokeStyle(1, 0x2a3a56);
    const title = this.scene.add
      .text(w / 2, w / 2 - 52, "BANKRUPT", { fontFamily: FONT, fontSize: "40px", color: "#e24b4a" })
      .setOrigin(0.5);
    const score = this.scene.add
      .text(w / 2, w / 2 + 4, `final valuation  $${Math.round(valuation)}`, {
        fontFamily: FONT,
        fontSize: "18px",
        color: "#e6ecf5",
      })
      .setOrigin(0.5);
    const hint = this.scene.add
      .text(w / 2, w / 2 + 56, "click  or  press SPACE to restart", {
        fontFamily: FONT,
        fontSize: "15px",
        color: "#8fa1bc",
      })
      .setOrigin(0.5);
    this.overlay = this.scene.add.container(0, 0, [panel, title, score, hint]).setDepth(20);
  }
}
