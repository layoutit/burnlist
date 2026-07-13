import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { joinClasses } from "@lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={joinClasses("ui-separator", className)}
      {...props}
    />
  )
}

export { Separator }
