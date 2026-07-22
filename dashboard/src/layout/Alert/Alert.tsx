import * as React from "react"

import { joinClasses } from "@lib/utils"

type AlertVariant = "default" | "info" | "success" | "warning" | "destructive"

function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: AlertVariant }) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      className={joinClasses("ui-alert", `ui-alert--${variant}`, className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-title" className={joinClasses("ui-alert-title", className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={joinClasses("ui-alert-description", className)} {...props} />
}

export { Alert, AlertDescription, AlertTitle }
export type { AlertVariant }
