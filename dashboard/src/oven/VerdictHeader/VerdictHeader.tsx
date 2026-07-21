import { ArrowLeft } from "lucide-react";

type VerdictHeaderProps = {
  targetPass: boolean;
  framesCount: number;
  error: string;
};

export function VerdictHeader({ targetPass, framesCount, error }: VerdictHeaderProps) {
  return <header className="visual-parity-heading"><a className="visual-parity-back" href="/"><ArrowLeft aria-hidden="true" />Burnlists</a><div><div className={`visual-parity-verdict ${targetPass ? "pass" : "fail"}`}>{targetPass ? "Target qualified" : "Target open"}</div><p>{framesCount} settled frames · isolated render passes · live refresh</p></div>{error && <span className="visual-parity-refresh-error">{error}</span>}</header>;
}
