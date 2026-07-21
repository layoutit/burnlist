export function formatTime(value: string | null) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatListTime(value: string | null) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", hourCycle: "h23", minute: "2-digit" }).format(date);
  return `${day} · ${time}`;
}
