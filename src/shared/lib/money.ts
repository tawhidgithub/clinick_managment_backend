// All money in the system is an integer number of poisha (1 taka = 100 poisha).
// The API sends and receives poisha; only the frontend formats taka.

export function takaToPoisha(taka: number): number {
  return Math.round(taka * 100);
}

export function poishaToTaka(poisha: number): number {
  return poisha / 100;
}

/** e.g. 125050 -> "৳1,250.50" */
export function formatTaka(poisha: number): string {
  const taka = poisha / 100;
  return `৳${taka.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(taka) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Percentage of an amount, rounded down to whole poisha (never over-discounts). */
export function percentOf(poisha: number, percent: number): number {
  return Math.floor((poisha * percent) / 100);
}
