import { getComparator, getPredicate, type Comparator, type Predicate } from "./predicate-sort-registry";

type Pointer = (payload: unknown, pointer: string) => unknown;
type ActiveControl = boolean | string | { key?: string; active?: boolean } | undefined;
export type CollectionPipelineOptions = {
  query?: string;
  matchFields?: string | string[];
  filter?: ActiveControl;
  sort?: ActiveControl;
  contract: string;
};

function activeKey(value: ActiveControl): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && value.active !== false && typeof value.key === "string") return value.key;
  return undefined;
}

function fields(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : typeof value === "string" ? value.split(/\s+/u).filter(Boolean) : [];
}

function search(items: unknown[], query: string, matchFields: string[], resolvePointer: Pointer): unknown[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => matchFields.some((field) => String(resolvePointer(item, field) ?? "").toLowerCase().includes(needle)));
}

function predicate(contract: string, control: ActiveControl): Predicate | undefined {
  const key = activeKey(control);
  return key ? getPredicate(contract, key) : undefined;
}

function comparator(contract: string, control: ActiveControl): Comparator | undefined {
  const key = activeKey(control);
  return key ? getComparator(contract, key) : undefined;
}

/** Runs source -> search -> registered filter -> stable registered sort. Paging is selector-owned. */
export function runCollection(items: unknown[], options: CollectionPipelineOptions, resolvePointer: Pointer): unknown[] {
  let result = search(items.slice(), options.query ?? "", fields(options.matchFields), resolvePointer);
  const filter = predicate(options.contract, options.filter);
  if (filter) result = result.filter((item) => !!item && typeof item === "object" && filter(item as Record<string, unknown>));
  const sort = comparator(options.contract, options.sort);
  if (!sort) return result;
  if (sort.include) result = result.filter((item) => !!item && typeof item === "object" && sort.include!(item as Record<string, unknown>));
  return result.map((item, index) => ({ item, index })).sort((left, right) => {
    if (!left.item || typeof left.item !== "object" || !right.item || typeof right.item !== "object") return left.index - right.index;
    return sort(left.item as Record<string, unknown>, right.item as Record<string, unknown>) || left.index - right.index;
  }).map(({ item }) => item);
}
