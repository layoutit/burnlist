# Sample Burnlist

Status: Burnlist Final
Updated: 2026-01-01
Repo: `fixtures/sample-repo`
Goal: ./goal.md

## Active Checklist
- [ ] B1 | Verify fixture protocol
  Files/search: `fixtures/sample-repo/notes/burnlists/draft/260101-001`
  Action: Run the bundled protocol checker against this fixture.
  Done/delete when: The checker exits successfully.
  Validate: `burnlist --plan fixtures/sample-repo/notes/burnlists/draft/260101-001/burnlist.md --check`
- [ ] B2 | Review default Oven docs
  Files/search: `docs/progress.md docs/compare.md`
  Action: Confirm Checklist and Compare are described as distinct default Ovens.
  Done/delete when: Both docs describe their own state model and question.
  Validate: `npm run verify`

## Completed
