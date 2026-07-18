import { ovenRepoKey, type VisualParityPayload } from "@lib";
import { useOvenLiveData } from "@oven";
import { receiveVisualParity } from "./visual-parity-transport.mjs";

export function useVisualParityData() {
  const { data, error, loading } = useOvenLiveData<VisualParityPayload | null>({
    transport: "poll",
    makeUrl: () => {
      const repoKey = ovenRepoKey();
      const query = repoKey ? `?repoKey=${encodeURIComponent(repoKey)}` : "";
      return `/api/oven-data/visual-parity${query}`;
    },
    intervalMs: 2_000,
    receive: receiveVisualParity,
    fallbackError: "Could not load Visual Parity.",
    initialData: null,
    deps: [],
  });

  return { payload: data, error, loading };
}
