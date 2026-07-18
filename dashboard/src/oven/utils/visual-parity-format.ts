export function percent(value: number) {
  return `${(value * 100).toFixed(value < 0.01 ? 3 : 2)}%`;
}

export function delta(value: number) {
  return value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}
