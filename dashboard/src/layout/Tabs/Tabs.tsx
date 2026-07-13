"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { joinClasses } from "@lib"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={joinClasses("ui-tabs", className)}
      {...props}
    />
  )
}

type TabsListVariant = "default" | "line"

type TabsListVariantOptions = {
  variant?: TabsListVariant
  className?: string
}

function tabsListVariants({
  variant = "default",
  className,
}: TabsListVariantOptions = {}) {
  return joinClasses("ui-tabs-list", `ui-tabs-list--${variant}`, className)
}

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  TabsListVariantOptions) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={tabsListVariants({ variant, className })}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={joinClasses("ui-tabs-trigger", className)}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={joinClasses("ui-tabs-content", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
