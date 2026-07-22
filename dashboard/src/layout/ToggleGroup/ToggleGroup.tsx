import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { joinClasses } from "@lib/utils"

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root data-slot="toggle-group" className={joinClasses("ui-toggle-group", className)} {...props} />
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return <ToggleGroupPrimitive.Item data-slot="toggle-group-item" className={joinClasses("ui-toggle-group-item", className)} {...props} />
}

export { ToggleGroup, ToggleGroupItem }
