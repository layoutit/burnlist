import * as React from "react"

import { joinClasses } from "@lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={joinClasses("ui-textarea", className)} {...props} />
}

export { Textarea }
