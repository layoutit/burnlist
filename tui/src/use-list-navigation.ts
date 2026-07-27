import { useCallback } from "react";

type Selection = Record<string, number>;
type SetState<T> = (value: T | ((current: T) => T)) => void;

export function useListNavigation({
  setSelections,
  setItemIndex,
  itemCount,
}: {
  setSelections: SetState<Selection>;
  setItemIndex: SetState<number>;
  itemCount: number;
}) {
  const moveList = useCallback((id: "burnlists" | "ovens", length: number, direction: -1 | 1) => {
    if (!length) return;
    setSelections((current) => {
      const selected = Math.max(0, Math.min(current[id] ?? 0, length - 1));
      return { ...current, [id]: (selected + direction + length) % length };
    });
  }, [setSelections]);
  const moveItem = useCallback((direction: -1 | 1) => {
    if (!itemCount) return;
    setItemIndex((current) => (Math.max(0, Math.min(current, itemCount - 1)) + direction + itemCount) % itemCount);
  }, [itemCount, setItemIndex]);
  return { moveList, moveItem };
}
