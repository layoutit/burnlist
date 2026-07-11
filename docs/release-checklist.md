# Release Checklist

Before sharing this repo:

- confirm `package.json` says `GPL-3.0-or-later`
- confirm `package.json` is publishable, exposes the `burnlist` bin, and uses public npm access
- confirm `LICENSE` contains the GNU General Public License version 3 text
- confirm global installation registers only package-owned symlinks under `$HOME/.agents/skills`
- confirm `burnlist uninstall` removes those links before removing the global npm package
- run `npm run verify`
- run `npm run verify:clean`
- run `npm run verify:package`
- run `npm run test:global-install`
- run `npm publish --dry-run`
- inspect the npm payload for `.local`, `notes/burnlists`, personal paths, secrets, and generated reports
- confirm the source and npm payload do not contain repo-specific workflow names
- confirm README wording keeps Checklist and Differential Testing distinct
- confirm `skills/burnlist/ovens/` contains exactly `checklist` and `differential-testing`
