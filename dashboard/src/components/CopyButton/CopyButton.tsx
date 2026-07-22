import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@layout";
import "./CopyButton.css";

export function CopyButton({ text }: { text: string }) {
  const [isCopied, setIsCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = async () => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) return;
    try {
      await clipboard.writeText(text);
      setIsCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setIsCopied(false), 1500);
    } catch {
      // Clipboard access may be unavailable outside a secure browser context.
    }
  };

  return (
    <Button
      aria-label={isCopied ? "Instructions copied" : "Copy instructions"}
      className="copy-btn oven-catalog-copy-button"
      onClick={() => void copy()}
      size="xs"
      title={isCopied ? "Copied" : "Copy instructions"}
      type="button"
      variant="outline"
    >
      {isCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{isCopied ? "Copied" : "Copy"}</span>
    </Button>
  );
}
