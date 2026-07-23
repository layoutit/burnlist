import { palette } from "./theme";

export function BrandMark() {
  return <box width={3} height={1} alignItems="center" justifyContent="center">
    <text fg={palette.soft}>⟁</text>
  </box>;
}
