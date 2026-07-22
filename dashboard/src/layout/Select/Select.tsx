import * as React from "react"

import { joinClasses } from "@lib/utils"

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="select" className={joinClasses("ui-select", className)} {...props} />
}

export { Select }
