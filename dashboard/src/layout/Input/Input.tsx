import * as React from "react"

import { joinClasses } from "@lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" type={type} className={joinClasses("ui-input", className)} {...props} />
}

export { Input }
