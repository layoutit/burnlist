export const BURNLIST_DATA_CONTRACT = "checklist-progress@1";

export function ovenFitsContract(oven, dataContract) {
  return Boolean(oven) && oven.contract === dataContract;
}

export function ovenInRepoScope(oven, repoKey) {
  return oven?.repoKey == null || oven.repoKey === repoKey;
}

export function fittingOvens(ovens, dataContract, { repoKey } = {}) {
  return (Array.isArray(ovens) ? ovens : []).filter((oven) => ovenFitsContract(oven, dataContract) && ovenInRepoScope(oven, repoKey));
}
