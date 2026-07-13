export function projectGroupShouldResetOpen(previousFilter, filter) {
  return previousFilter !== filter;
}

export function projectGroupOpen(filteredEntries, total) {
  return filteredEntries.length > 0 || total === 0;
}
