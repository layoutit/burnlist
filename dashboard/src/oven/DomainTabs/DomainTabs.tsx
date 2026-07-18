type DomainTab = {
  id: string;
  label: string;
  qualification: string;
  failed: number;
};

type DomainTabsProps = {
  tabs: DomainTab[];
  activeId: string;
  onSelect: (id: string) => void;
};

export function DomainTabs({ tabs, activeId, onSelect }: DomainTabsProps) {
  return <nav aria-label="Visual parity domains" className="visual-parity-domains">{tabs.map((tab) => { const current = tab.id === activeId; return <button aria-pressed={current} className={current ? "is-active" : ""} key={tab.id} onClick={() => onSelect(tab.id)} type="button"><span>{tab.label}</span><small>{tab.qualification} · {tab.failed ? `${tab.failed} fail` : "pass"}</small></button>; })}</nav>;
}
