type Item = Record<string, unknown>;
export type Predicate = (item: Item) => boolean;
export type Comparator = ((left: Item, right: Item) => number) & { include?: Predicate };

type Registry<T> = Record<string, Record<string, T>>;

function registry<T>(entries: Array<[string, string, T]>): Registry<T> {
  const contracts: Record<string, Record<string, T>> = Object.create(null);
  for (const [contract, key, value] of entries) {
    const keys = contracts[contract] ?? (contracts[contract] = Object.create(null));
    keys[key] = value;
  }
  for (const keys of Object.values(contracts)) Object.freeze(keys);
  return Object.freeze(contracts);
}

function number(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function telemetry(item: Item): Item | undefined {
  const value = item.transitionTelemetry ?? item.telemetry;
  return value && typeof value === "object" ? value as Item : undefined;
}

/** DT's renderer treats either failed or missing samples as non-passing. */
const nonPass: Predicate = (item) => number(item.failedSampleCount) + number(item.missingSampleCount) > 0;

/** DT's changed view orders transition volume, then net improvement, then source order. */
const changed = ((left: Item, right: Item) => {
  const leftTelemetry = telemetry(left), rightTelemetry = telemetry(right);
  const leftChanged = number(leftTelemetry?.failToPassCount) + number(leftTelemetry?.passToFailCount);
  const rightChanged = number(rightTelemetry?.failToPassCount) + number(rightTelemetry?.passToFailCount);
  const leftImprovement = number(leftTelemetry?.failToPassCount) - number(leftTelemetry?.passToFailCount);
  const rightImprovement = number(rightTelemetry?.failToPassCount) - number(rightTelemetry?.passToFailCount);
  return rightChanged - leftChanged || rightImprovement - leftImprovement;
}) as Comparator;
changed.include = (item) => {
  const value = telemetry(item);
  return number(value?.failToPassCount) + number(value?.passToFailCount) > 0;
};

export const predicateRegistry = registry<Predicate>([
  ["burnlist-differential-testing-data@1", "non-pass", nonPass],
]);

export const sortRegistry = registry<Comparator>([
  ["burnlist-differential-testing-data@1", "changed", changed],
]);

function lookup<T>(source: Registry<T>, contract: string, key: string, kind: string): T {
  const value = source[contract]?.[key];
  if (!value) throw new Error(`Unknown ${kind}: (${contract}, ${key})`);
  return value;
}

export function getPredicate(contract: string, key: string): Predicate {
  return lookup(predicateRegistry, contract, key, "predicate");
}

export function getComparator(contract: string, key: string): Comparator {
  return lookup(sortRegistry, contract, key, "sort");
}
