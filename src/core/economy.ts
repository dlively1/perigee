// Pure economy rules. Cash is spendable runway; valuation is cumulative revenue
// earned (the score). Bankruptcy is the loss condition.

export interface Wallet {
  cash: number;
  valuation: number;
}

// Earn coverage revenue for a dt slice. Both cash (spendable) and valuation
// (score) rise by the same amount — valuation is a monotonic record of income.
export function accrueRevenue(w: Wallet, ratePerSec: number, dt: number): Wallet {
  const gain = ratePerSec * dt;
  return { cash: w.cash + gain, valuation: w.valuation + gain };
}

export function canAfford(cash: number, cost: number): boolean {
  return cash >= cost;
}

export function spend(cash: number, cost: number): number {
  return cash - cost;
}

// Runway exhausted. Coverage revenue can rescue a run right up to the edge, so
// the check is strict — you're only bankrupt once cash is actually gone.
export function isBankrupt(cash: number): boolean {
  return cash <= 0;
}
