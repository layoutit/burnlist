# `layout/` — generic, presentational primitives

Reusable, app-agnostic building blocks: `Button`, `Badge`, `Card`, `Progress`, `Tabs`,
`Separator`, containers. Style + behavior only — **no business logic, no data fetching, no
API/domain types**. The nearest `AGENTS.md` wins.

## Structure
- One CamelCase folder per component: `Button/`.
- `Button/Button.tsx` — the component; a **named export**, never `default`.
- `Button/index.ts` — barrel: `export { Button } from "./Button";` (plus its prop types).
- Subcomponents live beside the parent (`Button/ButtonIcon.tsx`, named export); a *complex*
  subcomponent gets its own subfolder with its own `index.ts`.
- `layout/index.ts` re-exports every primitive, so consumers write `import { Button } from "@layout"`
  — never a deep path like `@layout/Button`.

## Rules
- **Named exports only** (no `export default`).
- **Never import from `@components`, `@hooks`, or any data/domain layer** — layout must not depend
  on app code. Depend only on React, styling utils (`@lib/utils`), and other `layout` primitives.
- Keep them controlled and presentational; accept and forward `className`.
