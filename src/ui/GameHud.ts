import Phaser from "phaser";
import { TUNING } from "../sim/constants";

const FONT = "ui-monospace, monospace";

export interface HudState {
  cash: number;
  valuation: number;
  covered: boolean;
  // Contract markets served right now, out of those valuation has signed.
  regionsCovered: number;
  regionsSigned: number;
  // Gross revenue in $/s at this instant.
  income: number;
  sats: number;
  // Satellites that ran out of fuel: still in orbit, earning nothing.
  darkSats: number;
  satCap: number;
  debris: number;
  kesslerRisk: number;
  paused: boolean;
  consoleOpen: boolean;
  siteName: string;
  // Service life of the satellites the active pad builds.
  siteFuelSeconds: number;
  // The next pad or contract valuation will unlock, or null when all are open.
  nextUnlock: { name: string; at: number; kind: "pad" | "contract" } | null;
}

// Always-on overlay built for legibility: every number says what it is and
// what it's for, and a launch-status line answers "can I launch right now?".
// Pure presentation — reads a state struct each frame.
export class GameHud {
  private cashText: Phaser.GameObjects.Text;
  private valuationText: Phaser.GameObjects.Text;
  private valuationSub: Phaser.GameObjects.Text;
  private launchStatus: Phaser.GameObjects.Text;
  private siteText: Phaser.GameObjects.Text;
  private coverage: Phaser.GameObjects.Text;
  private sats: Phaser.GameObjects.Text;
  private kesslerLabel: Phaser.GameObjects.Text;
  private kesslerBar: Phaser.GameObjects.Rectangle;
  private pausedBanner: Phaser.GameObjects.Text;
  private toastText: Phaser.GameObjects.Text;
  private toastTween?: Phaser.Tweens.Tween;
  private overlay?: Phaser.GameObjects.Container;

  private static readonly BAR_W = 150;

  constructor(private scene: Phaser.Scene) {
    const w = TUNING.surface;

    this.cashText = scene.add
      .text(18, 14, "", { fontFamily: FONT, fontSize: "22px", color: "#3dd6a0" })
      .setDepth(10);
    scene.add
      .text(18, 40, "pays for launches, boosts, de-orbits", {
        fontFamily: FONT,
        fontSize: "11px",
        color: "#5f6f88",
      })
      .setDepth(10);
    this.valuationText = scene.add
      .text(18, 60, "", { fontFamily: FONT, fontSize: "15px", color: "#8fa1bc" })
      .setDepth(10);
    this.valuationSub = scene.add
      .text(18, 78, "", { fontFamily: FONT, fontSize: "11px", color: "#5f6f88" })
      .setDepth(10);
    this.launchStatus = scene.add
      .text(18, 102, "", { fontFamily: FONT, fontSize: "13px", color: "#97c459" })
      .setDepth(10);
    this.siteText = scene.add
      .text(18, 122, "", { fontFamily: FONT, fontSize: "12px", color: "#8fa1bc" })
      .setDepth(10);

    this.coverage = scene.add
      .text(w - 18, 16, "", { fontFamily: FONT, fontSize: "16px", color: "#8fa1bc" })
      .setOrigin(1, 0)
      .setDepth(10);
    this.sats = scene.add
      .text(w - 18, 40, "", { fontFamily: FONT, fontSize: "14px", color: "#8fa1bc" })
      .setOrigin(1, 0)
      .setDepth(10);

    const barX = w - 18 - GameHud.BAR_W;
    this.kesslerLabel = scene.add
      .text(w - 18, 64, "", { fontFamily: FONT, fontSize: "12px", color: "#8fa1bc" })
      .setOrigin(1, 0)
      .setDepth(10);
    scene.add.rectangle(barX, 84, GameHud.BAR_W, 8, 0x23303f).setOrigin(0, 0).setDepth(10);
    this.kesslerBar = scene.add.rectangle(barX, 84, 0, 8, 0xe24b4a).setOrigin(0, 0).setDepth(10);

    scene.add
      .text(
        w / 2,
        w - 20,
        "L: launch console  ·  click sat + B: boost  ·  D: de-orbit  ·  SPACE: pause",
        {
          fontFamily: FONT,
          fontSize: "13px",
          color: "#5f6f88",
        },
      )
      .setOrigin(0.5, 1)
      .setDepth(10);

    this.pausedBanner = scene.add
      .text(w / 2, 34, "❚❚ PAUSED", { fontFamily: FONT, fontSize: "16px", color: "#ef9f27" })
      .setOrigin(0.5, 0)
      .setDepth(10)
      .setVisible(false);

    this.toastText = scene.add
      .text(w / 2, w - 48, "", { fontFamily: FONT, fontSize: "14px", color: "#e6ecf5" })
      .setOrigin(0.5, 1)
      .setDepth(11)
      .setAlpha(0);
  }

  update(s: HudState): void {
    this.cashText.setText(`CASH  $${Math.round(s.cash)}`);
    this.cashText.setColor(s.cash < TUNING.launchCost ? "#e24b4a" : "#3dd6a0");
    this.valuationText.setText(`VALUATION  $${Math.round(s.valuation)}`);
    this.valuationSub.setText(
      s.nextUnlock
        ? `$${s.nextUnlock.at} unlocks ${s.nextUnlock.name} (${s.nextUnlock.kind})`
        : "company worth — your score",
    );
    // The pad line advertises both halves of a site upgrade: how hard it can
    // throw is felt in the console, but how long its birds last is a number
    // you'd otherwise never see until they started dying.
    this.siteText.setText(`pad: ${s.siteName} · ${s.siteFuelSeconds}s sats   (1/2/3 or TAB)`);

    if (s.sats >= s.satCap) {
      this.launchStatus.setText(`launch — fleet full (${s.sats}/${s.satCap})`);
      this.launchStatus.setColor("#ef9f27");
    } else if (s.cash < TUNING.launchCost) {
      this.launchStatus.setText(`launch $${TUNING.launchCost} — need more cash`);
      this.launchStatus.setColor("#e24b4a");
    } else if (s.consoleOpen) {
      this.launchStatus.setText(`launch console open — aim, then ENTER to fire`);
      this.launchStatus.setColor("#97c459");
    } else {
      this.launchStatus.setText(`launch $${TUNING.launchCost} — press L to open the console`);
      this.launchStatus.setColor("#97c459");
    }

    // Markets served, and what that is actually worth per second. The $/s is
    // the number that makes spreading the fleet legible: cover a second region
    // and watch it double.
    this.coverage.setText(
      `MARKETS  ${s.regionsCovered}/${s.regionsSigned}  ·  $${Math.round(s.income)}/s`,
    );
    this.coverage.setColor(
      s.regionsCovered === 0
        ? "#e24b4a"
        : s.regionsCovered < s.regionsSigned
          ? "#ef9f27"
          : "#97c459",
    );
    // Dark sats still count against the fleet cap and still collide, so they
    // get called out rather than quietly inflating the headline number.
    this.sats.setText(
      s.darkSats > 0
        ? `sats  ${s.sats}/${s.satCap}  (${s.darkSats} dark — D to clear)`
        : `sats  ${s.sats}/${s.satCap}`,
    );
    this.sats.setColor(s.darkSats > 0 ? "#ef9f27" : "#8fa1bc");
    this.kesslerLabel.setText(`kessler risk · debris ${s.debris}`);
    this.kesslerBar.width = GameHud.BAR_W * Math.min(1, s.kesslerRisk);
    this.kesslerBar.fillColor =
      s.kesslerRisk > 0.66 ? 0xe24b4a : s.kesslerRisk > 0.33 ? 0xef9f27 : 0x3dd6a0;
    this.pausedBanner.setVisible(s.paused);
  }

  // Transient center-bottom message: selection hints, refused orders, etc.
  toast(message: string): void {
    this.toastTween?.stop();
    this.toastText.setText(message).setAlpha(1);
    this.toastTween = this.scene.tweens.add({
      targets: this.toastText,
      alpha: 0,
      delay: 1800,
      duration: 500,
    });
  }

  showGameOver(reason: "bankruptcy" | "kessler", valuation: number): void {
    if (this.overlay) return;
    const w = TUNING.surface;
    const heading = reason === "kessler" ? "KESSLER CASCADE" : "BANKRUPT";
    const panel = this.scene.add
      .rectangle(w / 2, w / 2, 460, 200, 0x0e1526, 0.94)
      .setStrokeStyle(1, 0x2a3a56);
    const title = this.scene.add
      .text(w / 2, w / 2 - 52, heading, { fontFamily: FONT, fontSize: "38px", color: "#e24b4a" })
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
