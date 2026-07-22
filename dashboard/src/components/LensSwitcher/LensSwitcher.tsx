import { useEffect, useState } from "react";
import { BURNLIST_DATA_CONTRACT, burnlistLensContext, burnlistOvenHref, fittingOvens } from "@lib";
import type { OvenSummary } from "@lib";
import "./LensSwitcher.css";

export function LensSwitcher() {
  const context = burnlistLensContext();
  const [ovens, setOvens] = useState<OvenSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!context) return;
    const controller = new AbortController();
    const load = async () => {
      setOvens(null);
      setFailed(false);
      try {
        const response = await fetch("/api/ovens", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not load Ovens.");
        const payload = await response.json() as { ovens?: OvenSummary[] };
        if (!controller.signal.aborted) setOvens(Array.isArray(payload.ovens) ? payload.ovens : []);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    void load();
    return () => controller.abort();
  }, [context?.repoKey, context?.burnlistId]);

  if (!context || !ovens || failed) return null;
  const lenses = fittingOvens(ovens, BURNLIST_DATA_CONTRACT, { repoKey: context.repoKey });
  if (!lenses.length) return null;

  return (
    <nav className="lens-switcher" aria-label="Burnlist lenses">
      {lenses.map((oven) => {
        const active = oven.id === context.activeOvenId;
        return <a aria-current={active ? "page" : undefined} className={`lens-switcher-link${active ? " is-active" : ""}`} href={burnlistOvenHref({ repoKey: context.repoKey, burnlistId: context.burnlistId, ovenId: oven.id })} key={oven.id}>{oven.name}</a>;
      })}
    </nav>
  );
}
