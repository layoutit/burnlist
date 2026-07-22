import * as React from "react"

import { joinClasses } from "@lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" data-slot="skeleton" className={joinClasses("ui-skeleton", className)} {...props} />
}

export { Skeleton }
