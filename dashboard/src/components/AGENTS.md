# `components/` — app components (customized / connected)

Instantiated, domain-aware components that compose `@layout` primitives with app data and
behavior: `AppHeader`, `Filters`, `ProjectGroup`, `Pagination`, `EmptyState`, page views, etc.
The nearest `AGENTS.md` wins.

## Structure
- One CamelCase folder per component: `ProjectGroup/`.
- `ProjectGroup/ProjectGroup.tsx` — a **named export**, never `default`.
- `ProjectGroup/index.ts` — barrel: `export { ProjectGroup } from "./ProjectGroup";`.
- Subcomponents live beside the parent (`ProjectGroup/BurnlistRow.tsx`, `BurnlistTable.tsx`);
  a *complex* subcomponent gets its own subfolder + `index.ts`.
- `components/index.ts` re-exports the public components, so consumers write
  `import { ProjectGroup } from "@components"` — never a deep path.

## Rules
- **Named exports only** (no `export default`).
- Import primitives from `@layout`, data from `@hooks`, types/helpers from `@lib`. Import a
  sibling *inside the same folder* relatively (`./BurnlistRow`) to avoid barrel cycles.
- Keep domain types + fetching in `@hooks` / `@lib`; components stay declarative.
- On a move/refactor, preserve existing class names and markup — don't restyle.
