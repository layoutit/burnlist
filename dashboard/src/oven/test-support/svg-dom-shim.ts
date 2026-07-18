const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
export const FROZEN_CHART_NOW = 1_700_000_000_000;

class SvgText {
  constructor(value) { this.value = value; this.nodeName = "#text"; this.parentElement = null; }
}

function datasetAttribute(key) { return `data-${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`; }
function escapeText(value) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function escapeAttribute(value) { return escapeText(value).replaceAll('"', "&quot;"); }

/** A deliberately tiny DOM surface for the imperative vanilla SVG renderers. */
export class SvgElement {
  constructor(namespaceURI, tagName) {
    this.namespaceURI = namespaceURI;
    this.tagName = tagName;
    this.nodeName = tagName;
    this.children = [];
    this.childNodes = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = new Proxy({}, {
      get: (_target, key) => typeof key === "string" ? this.getAttribute(datasetAttribute(key)) : undefined,
      set: (_target, key, value) => {
        if (typeof key === "string") this.setAttribute(datasetAttribute(key), String(value));
        return true;
      },
      deleteProperty: (_target, key) => {
        if (typeof key === "string") this.removeAttribute(datasetAttribute(key));
        return true;
      },
    });
    this.style = new Proxy({}, {
      get: (_target, key) => typeof key === "string" ? this.styleValue(key) : undefined,
      set: (_target, key, value) => {
        if (typeof key === "string") this.setStyle(key, String(value));
        return true;
      },
    });
    this.classList = {
      add: (...names) => this.setClasses(new Set([...this.classNames(), ...names])),
      remove: (...names) => this.setClasses(new Set([...this.classNames()].filter((name) => !names.includes(name)))),
      toggle: (name, force) => {
        const names = this.classNames();
        const enabled = force === undefined ? !names.has(name) : force;
        if (enabled) names.add(name); else names.delete(name);
        this.setClasses(names);
        return enabled;
      },
      contains: (name) => this.classNames().has(name),
    };
  }

  get id() { return this.getAttribute("id") ?? ""; }
  set id(value) { this.setAttribute("id", value); }
  get clientWidth() { return 0; }
  get clientHeight() { return 0; }
  get childElementCount() { return this.children.length; }
  get textContent() { return this.childNodes.map((child) => child instanceof SvgText ? child.value : child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(String(value)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) {
    const child = typeof node === "string" ? new SvgText(node) : node;
    child.parentElement = this;
    this.childNodes.push(child);
    if (child instanceof SvgElement) this.children.push(child);
    return child;
  }
  insertBefore(node, reference) {
    if (!reference) return this.appendChild(node);
    const child = typeof node === "string" ? new SvgText(node) : node;
    const nodeIndex = this.childNodes.indexOf(reference);
    if (nodeIndex < 0) return this.appendChild(child);
    child.parentElement = this;
    this.childNodes.splice(nodeIndex, 0, child);
    if (child instanceof SvgElement) {
      const elementIndex = this.children.indexOf(reference);
      this.children.splice(elementIndex < 0 ? this.children.length : elementIndex, 0, child);
    }
    return child;
  }
  replaceChildren(...nodes) { this.childNodes.length = 0; this.children.length = 0; this.append(...nodes); }
  querySelector(selector) {
    const classes = selector.split(",").map((part) => part.trim()).filter((part) => part.startsWith(".")).map((part) => part.slice(1));
    const visit = (element) => {
      for (const child of element.children) {
        if (classes.some((name) => child.classList.contains(name))) return child;
        const descendant = visit(child);
        if (descendant) return descendant;
      }
      return null;
    };
    return visit(this);
  }
  serializedAttributes() { return [...this.attributes.entries()].sort(([left], [right]) => left.localeCompare(right)); }
  classNames() { return new Set((this.getAttribute("class") ?? "").split(/\s+/u).filter(Boolean)); }
  setClasses(names) {
    const value = [...names].join(" ");
    if (value) this.setAttribute("class", value); else this.removeAttribute("class");
  }
  styleValue(key) { return (this.getAttribute("style") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${key}:`))?.slice(key.length + 1); }
  setStyle(key, value) {
    const declarations = (this.getAttribute("style") ?? "").split(";").map((part) => part.trim()).filter(Boolean).filter((part) => !part.startsWith(`${key}:`));
    declarations.push(`${key}:${value}`);
    this.setAttribute("style", declarations.join(";"));
  }
}

export function createSvgDocument() { return { createElementNS: (namespaceURI, tagName) => new SvgElement(namespaceURI, tagName) }; }
export function serializeSvgNode(node) {
  if (node instanceof SvgText) return escapeText(node.value);
  const attributes = node.serializedAttributes().map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");
  return `<${node.tagName}${attributes}>${node.childNodes.map(serializeSvgNode).join("")}</${node.tagName}>`;
}

/** Captures one render while restoring every global the renderer touches. */
export function captureVanillaChartSvg({ render, args, svgId }) {
  const root = new SvgElement(SVG_NAMESPACE, "svg");
  root.id = svgId;
  const priorDocument = globalThis.document;
  const priorGetComputedStyle = globalThis.getComputedStyle;
  const priorDateNow = Date.now;
  const priorTimeZone = process.env.TZ;
  const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, "document");
  const hadGetComputedStyle = Object.prototype.hasOwnProperty.call(globalThis, "getComputedStyle");
  try {
    globalThis.document = createSvgDocument();
    globalThis.getComputedStyle = () => ({ height: "" });
    Date.now = () => FROZEN_CHART_NOW;
    process.env.TZ = "UTC";
    render(root, ...args);
    return serializeSvgNode(root);
  } finally {
    Date.now = priorDateNow;
    if (priorTimeZone === undefined) delete process.env.TZ; else process.env.TZ = priorTimeZone;
    if (hadDocument) globalThis.document = priorDocument; else delete globalThis.document;
    if (hadGetComputedStyle) globalThis.getComputedStyle = priorGetComputedStyle; else delete globalThis.getComputedStyle;
  }
}
