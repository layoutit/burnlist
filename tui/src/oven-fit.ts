import type { BurnlistSummary, OvenSummary } from "./types";

export function genericOvens(ovens: OvenSummary[]): OvenSummary[] {
  return ovens.filter((oven) => oven.builtIn && oven.repoKey === null);
}

export function associatedOven(burnlist: BurnlistSummary, ovens: OvenSummary[]): OvenSummary | null {
  return ovens.find((oven) => oven.id === burnlist.ovenId && oven.repoKey === burnlist.repoKey)
    ?? ovens.find((oven) => oven.id === burnlist.ovenId && oven.repoKey === null)
    ?? null;
}

export function ovenLenses(burnlist: BurnlistSummary, ovens: OvenSummary[]): OvenSummary[] {
  const active = associatedOven(burnlist, ovens);
  if (!active) return [];
  const result: OvenSummary[] = [];
  const indexById = new Map<string, number>();
  for (const oven of ovens) {
    if (oven.contract !== active.contract || (oven.repoKey !== null && oven.repoKey !== burnlist.repoKey)) continue;
    const index = indexById.get(oven.id);
    if (index === undefined) {
      indexById.set(oven.id, result.length);
      result.push(oven);
    } else if (oven.repoKey === burnlist.repoKey && result[index]!.repoKey === null) {
      result[index] = oven;
    }
  }
  return result;
}
