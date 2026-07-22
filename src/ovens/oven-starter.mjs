function escapeXmlAttribute(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

export function starterOvenSource(id, name) {
  return `<oven id="${escapeXmlAttribute(id)}" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <section-header title="${escapeXmlAttribute(name)}"/>
</oven>
`;
}
