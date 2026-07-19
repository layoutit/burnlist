import { createElement, type ReactNode } from "react";

type BoxProps = {
  element: "div" | "section" | "main" | "span";
  className?: string;
  id?: string;
  text?: string;
  children?: ReactNode;
};

export function Box({ element, className, id, text, children }: BoxProps) {
  return createElement(element, { className, id }, text, children);
}
