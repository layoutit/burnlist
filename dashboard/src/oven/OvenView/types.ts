export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Binding = {
  source: string;
  format?: string;
};

export type SlotDef = CellDef | { icon: string } | { text: string };

export type CellDef = {
  component: string;
  props?: Record<string, JsonValue>;
  bind?: Record<string, Binding>;
  slots?: Record<string, SlotDef>;
  children?: CellDef[];
  key?: string;
};

export type SectionDef = {
  element?: "section" | "div" | "nav";
  className?: string;
  props?: Record<string, JsonValue>;
  cells: CellDef[];
  key?: string;
};

export type OvenViewDef = {
  shellClassName?: string;
  bodyId?: string;
  bodyClassName?: string;
  // Reserved metadata for a future body-class effect; OvenView must not touch document.body.
  bodyClasses?: string[];
  sections: SectionDef[];
};
