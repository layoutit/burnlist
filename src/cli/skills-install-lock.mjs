import { resolve } from "node:path";

import { withRepoStateLock } from "../server/repo-state.mjs";

// Every global operation shares a HOME-derived lock root, independently of
// agent selection and skill-directory overrides.
export function withGlobalSkillsLock(env, fn) {
  const home = env.HOME || env.USERPROFILE;
  if (!home) throw new Error("cannot lock global skill registrations because no user home directory is available");
  return withRepoStateLock(resolve(home, ".burnlist"), fn);
}
