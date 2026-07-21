import { createElement, type ReactNode } from "react";

type BoxProps = {
  element: "div" | "section" | "main" | "span";
  className?: string;
  id?: string;
  text?: string;
  dataDetailTab?: string;
  children?: ReactNode;
};

export function Box({ element, className, id, text, dataDetailTab, children }: BoxProps) {
  return createElement(element, { className, id, "data-detail-tab": dataDetailTab }, text, children);
}
