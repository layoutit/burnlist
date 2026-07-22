import * as React from "react"

import { joinClasses } from "@lib/utils"

type SpinnerSize = "sm" | "default" | "lg"

function Spinner({
  className,
  label = "Loading",
  size = "default",
  ...props
}: React.ComponentProps<"span"> & { label?: string; size?: SpinnerSize }) {
  return (
    <span
      data-slot="spinner"
      data-size={size}
      className={joinClasses("ui-spinner", className)}
      role="status"
      {...props}
    >
      <span className="visually-hidden">{label}</span>
    </span>
  )
}

export { Spinner }
export type { SpinnerSize }
