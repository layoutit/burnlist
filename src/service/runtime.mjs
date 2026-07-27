import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const SERVICE_SCHEMA = "burnlist-service@1";

export function serviceHome(env = process.env) {
  return resolve(env.BURNLIST_HOME || join(env.HOME || homedir(), ".burnlist"));
}

export function servicePaths(env = process.env) {
  const home = serviceHome(env);
  return {
    home,
    runtime: join(home, "server.json"),
    marker: join(home, "install.json"),
    lock: join(home, "service.lock"),
    log: join(home, "service.log"),
  };
}

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function writeAtomicJson(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function canonical(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

export function installMarker(packageRoot, version, { env = process.env, write = writeAtomicJson } = {}) {
  const marker = {
    schema: SERVICE_SCHEMA,
    packageRoot: canonical(packageRoot),
    version,
    installedAt: new Date().toISOString(),
  };
  write(servicePaths(env).marker, marker);
  return marker;
}

export function removeInstallMarker(packageRoot, { env = process.env } = {}) {
  const path = servicePaths(env).marker;
  const marker = readJson(path);
  if (marker?.schema === SERVICE_SCHEMA && canonical(marker.packageRoot) === canonical(packageRoot)) {
    rmSync(path, { force: true });
    return true;
  }
  return false;
}

export function ownedGlobalInstall(packageRoot, version, { env = process.env } = {}) {
  const marker = readJson(servicePaths(env).marker);
  return Boolean(marker?.schema === SERVICE_SCHEMA
    && canonical(marker.packageRoot) === canonical(packageRoot)
    && marker.version === version);
}

export function removeMatchingRuntime(path, instanceId) {
  if (!instanceId || !existsSync(path)) return false;
  if (readJson(path)?.instanceId !== instanceId) return false;
  rmSync(path, { force: true });
  return true;
}
