import * as React from "react"

import { joinClasses } from "@lib/utils"

function Field({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field" className={joinClasses("ui-field", className)} {...props} />
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-group" className={joinClasses("ui-field-group", className)} {...props} />
}

function FieldLabel({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="field-label" className={joinClasses("ui-field-label", className)} {...props} />
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="field-description" className={joinClasses("ui-field-description", className)} {...props} />
}

function FieldError({ className, role = "alert", ...props }: React.ComponentProps<"p">) {
  return <p data-slot="field-error" className={joinClasses("ui-field-error", className)} role={role} {...props} />
}

export { Field, FieldDescription, FieldError, FieldGroup, FieldLabel }
