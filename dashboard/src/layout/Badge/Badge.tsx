import * as React from "react"
import { Slot } from "radix-ui"

import { joinClasses } from "@lib"

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "ghost"
  | "link"

type BadgeVariantOptions = {
  variant?: BadgeVariant
  className?: string
}

function badgeVariants({
  variant = "default",
  className,
}: BadgeVariantOptions = {}) {
  return joinClasses("ui-badge", `ui-badge--${variant}`, className)
}

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  BadgeVariantOptions & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={badgeVariants({ variant, className })}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
