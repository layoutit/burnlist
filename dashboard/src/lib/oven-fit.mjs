export const BURNLIST_DATA_CONTRACT = "checklist-progress@1";

export function ovenFitsContract(oven, dataContract) {
  return Boolean(oven) && oven.contract === dataContract;
}

export function ovenInRepoScope(oven, repoKey) {
  return oven?.repoKey == null || oven.repoKey === repoKey;
}

export function fittingOvens(ovens, dataContract, { repoKey } = {}) {
  const fitted = [];
  const indexById = new Map();
  for (const oven of Array.isArray(ovens) ? ovens : []) {
    if (!ovenFitsContract(oven, dataContract) || !ovenInRepoScope(oven, repoKey)) continue;
    const index = indexById.get(oven.id);
    if (index === undefined) {
      indexById.set(oven.id, fitted.length);
      fitted.push(oven);
    } else if (oven.repoKey === repoKey && fitted[index].repoKey == null) {
      fitted[index] = oven;
    }
  }
  return fitted;
}
