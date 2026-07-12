export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | ClassValue[]
  | { [className: string]: boolean | null | undefined };

function appendClassNames(value: ClassValue, classNames: string[]) {
  if (!value) return;
  if (typeof value === "string" || typeof value === "number") {
    classNames.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) appendClassNames(entry, classNames);
    return;
  }
  for (const [className, enabled] of Object.entries(value)) {
    if (enabled) classNames.push(className);
  }
}

export function joinClasses(...inputs: ClassValue[]) {
  const classNames: string[] = [];
  for (const input of inputs) appendClassNames(input, classNames);
  return classNames.join(" ");
}

// Kept as a compatibility export while page-level callers move to semantic CSS.
export const cn = joinClasses;
