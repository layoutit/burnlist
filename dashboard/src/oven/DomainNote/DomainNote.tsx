type DomainNoteProps = {
  isTarget: boolean;
  rationale: string;
};

export function DomainNote({ isTarget, rationale }: DomainNoteProps) {
  return <div className="visual-parity-domain-note"><strong>{isTarget ? "Qualifying target" : "Diagnostic context"}</strong><span>{rationale}</span></div>;
}
