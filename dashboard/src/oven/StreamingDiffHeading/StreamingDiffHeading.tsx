export function StreamingDiffHeading({ backHref, session }: { backHref: string; session: string }) {
  return <header className="streaming-diff-heading">
    <a className="streaming-diff-back" href={backHref}>Recent feeds</a>
    <h1>Streaming Diff</h1>
    <p>Session {session}</p>
  </header>;
}
