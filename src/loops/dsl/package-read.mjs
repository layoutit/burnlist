import { constants } from "node:fs";
import { lstat, opendir, open } from "node:fs/promises";
import { join } from "node:path";

const KNOWN_ROOT = new Set(["review.loop", "instructions.md", "example"]);
const KNOWN_EXAMPLE = new Set(["item.md"]);
const FILE_LIMITS = { "review.loop": 65536, "instructions.md": 262144, "example/item.md": 65536 };
const DIRECTORY_LIMITS = { "": 3, example: 1 };
const MAX_PACKAGE_BYTES = 393216;

const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function sameEntry(before, after) {
  return Boolean(
    before &&
      after &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      before.mode === after.mode &&
      before.size === after.size &&
      before.mtimeNs === after.mtimeNs &&
      before.ctimeNs === after.ctimeNs,
  );
}

function addDiagnostic(output, path, code, message) {
  output.push({ path, byteOffset: 0, code, message });
}

async function readDirectoryEntries(folder, maxEntries, pathLabel, output) {
  let dir;
  try {
    dir = await opendir(folder, { encoding: "utf8" });
    const entries = [];
    let overflow = false;
    for await (const entry of dir) {
      entries.push(entry.name);
      if (entries.length > maxEntries) {
        overflow = true;
        break;
      }
    }
    if (overflow) entries.pop();
    return {
      entries: entries.sort(compareUtf8),
      overflow,
    };
  } catch {
    addDiagnostic(output, pathLabel, "E_PACKAGE_READ", "Package directory could not be read");
    return { entries: [], overflow: false, readError: true };
  } finally {
    await dir?.close?.().catch(() => {});
  }
}

async function snapshotDirectory(pathLabel, folder, output) {
  let stat;
  try {
    stat = await lstat(folder, { bigint: true });
  } catch {
    addDiagnostic(output, pathLabel, "E_PACKAGE_READ", "Package directory could not be inspected");
    return null;
  }
  if (stat.isSymbolicLink()) {
    addDiagnostic(output, pathLabel, "E_PACKAGE_SYMLINK", "Package symlinks are not allowed");
    return null;
  }
  if (!stat.isDirectory()) {
    addDiagnostic(output, pathLabel, "E_PACKAGE_DIRECTORY", "Package root must be a directory");
    return null;
  }

  const limit = DIRECTORY_LIMITS[pathLabel] ?? Number.MAX_SAFE_INTEGER;
  const contents = await readDirectoryEntries(folder, limit, pathLabel, output);
  if (contents.readError) {
    return { path: pathLabel, stat, entries: [], truncated: false, readError: true };
  }
  if (contents.overflow) addDiagnostic(output, pathLabel, "E_PACKAGE_COUNT", "Package may contain at most three files");

  return { path: pathLabel, stat, entries: contents.entries, truncated: contents.overflow };
}

function compareDirectory(before, after, output, isKnownEntry) {
  if (!before || !after) return;

  if (!sameEntry(before.stat, after.stat)) {
    addDiagnostic(output, before.path, "E_PACKAGE_RACE", "Package directory changed while reading");
  }
  if (before.truncated) {
    addDiagnostic(output, before.path, "E_PACKAGE_RACE", "Package directory changed while reading");
  }
  if (after.truncated && !before.truncated) {
    addDiagnostic(output, before.path, "E_PACKAGE_RACE", "Package directory changed while reading");
  }

  const previous = new Set(before.entries);
  const current = new Set(after.entries);
  for (const name of previous) {
    if (!current.has(name)) {
      addDiagnostic(output, before.path, "E_PACKAGE_RACE", "Package directory changed while reading");
    }
  }
  for (const name of current) {
    if (previous.has(name)) continue;
    if (isKnownEntry(name)) {
      addDiagnostic(output, before.path, "E_PACKAGE_RACE", "Package directory changed while reading");
    } else {
      addDiagnostic(output, `${before.path ? `${before.path}/` : ""}${name}`, "E_PACKAGE_PATH", "Package entry was discovered after directory enumeration");
    }
  }
}

function toFileSize(value) {
  return typeof value === "bigint" ? Number(value) : value;
}

async function validateAncestors(ancestors, output, failurePath) {
  for (const ancestor of ancestors) {
    try {
      const current = await lstat(ancestor.path, { bigint: true });
      if (!current.isDirectory() || !sameEntry(current, ancestor.stat)) {
        addDiagnostic(output, failurePath, "E_PACKAGE_RACE", "Package entry changed while reading");
        return false;
      }
    } catch {
      addDiagnostic(output, failurePath, "E_PACKAGE_RACE", "Package entry changed while reading");
      return false;
    }
  }
  return true;
}

async function readValidatedFile(snapshot, output, options) {
  let handle;
  const pathLabel = snapshot.path;
  const full = snapshot.full;
  let opened;
  try {
    handle = await open(full, OPEN_FLAGS);
    opened = await handle.stat({ bigint: true });

    if (options.expected && !sameEntry(opened, options.expected)) {
      addDiagnostic(output, pathLabel, "E_PACKAGE_RACE", "Package entry changed while reading");
      return null;
    }
    if (!opened.isFile()) {
      addDiagnostic(output, pathLabel, "E_PACKAGE_FILE", "Package entries must be regular files");
      return null;
    }
    if (toFileSize(opened.size) > toFileSize(options.maxSize)) {
      addDiagnostic(output, pathLabel, "E_FILE_SIZE", `${pathLabel} exceeds the package byte limit`);
      return null;
    }

    if (options.afterLeafOpenForTest) {
      await options.afterLeafOpenForTest({ path: pathLabel, full, opened });
    }

    if (!(await validateAncestors(snapshot.ancestors, output, pathLabel))) return null;

    if (options.expected && options.expected.size !== undefined && opened.size !== options.expected.size) {
      addDiagnostic(output, pathLabel, "E_PACKAGE_RACE", "Package entry changed while reading");
      return null;
    }

    const expectedSize = toFileSize(opened.size);
    const bytes = Buffer.allocUnsafe(expectedSize);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset !== bytes.length) {
      addDiagnostic(output, pathLabel, "E_PACKAGE_READ", "Package entry could not be read");
      return null;
    }

    const after = await handle.stat({ bigint: true });
    if (!sameEntry(opened, after)) {
      addDiagnostic(output, pathLabel, "E_PACKAGE_RACE", "Package entry changed while reading");
      return null;
    }
    if (!(await validateAncestors(snapshot.ancestors, output, pathLabel))) return null;

    return bytes;
  } catch {
    addDiagnostic(output, pathLabel, "E_PACKAGE_READ", "Package entry could not be read");
    return null;
  } finally {
    await handle?.close?.().catch(() => {});
  }
}

async function snapshotLeaf(full, pathLabel, output, ancestors, limit, options = {}) {
  let stat;
  try {
    stat = await lstat(full, { bigint: true });
  } catch {
    addDiagnostic(output, pathLabel, "E_PACKAGE_READ", "Package entry could not be inspected");
    return null;
  }

  if (stat.isSymbolicLink()) {
    addDiagnostic(output, pathLabel, "E_PACKAGE_SYMLINK", "Package symlinks are not allowed");
    return null;
  }
  if (!stat.isFile()) {
    addDiagnostic(output, pathLabel, "E_PACKAGE_FILE", "Package entries must be regular files");
    return null;
  }

  if (stat.size > limit) {
    addDiagnostic(output, pathLabel, "E_FILE_SIZE", `${pathLabel} exceeds the package byte limit`);
    return null;
  }

  const bytes = await readValidatedFile(
    {
      path: pathLabel,
      full,
      ancestors,
      stat,
      limit,
    },
    output,
    {
      expected: stat,
      maxSize: limit,
      ...options,
    },
  );
  if (!bytes) return null;

  return {
    path: pathLabel,
    full,
    stat,
    limit,
    content: bytes,
    ancestors,
  };
}

function validateLeafSnapshot(snapshot, output, remainingBytes) {
  if (snapshot.stat.size > snapshot.limit || snapshot.stat.size > remainingBytes) {
    addDiagnostic(output, snapshot.path, "E_FILE_SIZE", `${snapshot.path} exceeds the package byte limit`);
    return false;
  }
  return true;
}

async function readLeaf(snapshot, output, options) {
  if (options?.beforeLeafRead) {
    await options.beforeLeafRead({ path: snapshot.path, full: snapshot.full });
  }
  const bytes = await readValidatedFile(snapshot, output, {
    expected: snapshot.stat,
    maxSize: snapshot.limit,
    afterLeafOpenForTest: options?.afterLeafOpenForTest,
  });
  if (!bytes) return null;
  if (!bytes.equals(snapshot.content)) {
    addDiagnostic(output, snapshot.path, "E_PACKAGE_RACE", "Package entry changed while reading");
    return null;
  }
  return bytes;
}

async function revalidateLeafBoundary(snapshot, output) {
  const bytes = await readValidatedFile(snapshot, output, {
    expected: snapshot.stat,
    maxSize: snapshot.limit,
  });
  if (!bytes) return;
  if (!bytes.equals(snapshot.content)) {
    addDiagnostic(output, snapshot.path, "E_PACKAGE_RACE", "Package entry changed while reading");
  }
}

export async function readPackageDirectory(directory, { beforeLeafRead, afterLeafOpenForTest } = {}) {
  const diagnostics = [];
  const files = {};
  const root = await snapshotDirectory("", directory, diagnostics);
  if (!root) return { files, diagnostics };

  const leaves = [];
  let exampleBefore = null;
  let examplePath = null;

  for (const name of root.entries) {
    const full = join(directory, name);
    if (!KNOWN_ROOT.has(name)) {
      addDiagnostic(diagnostics, name, "E_PACKAGE_PATH", "Unknown package file");
      continue;
    }

    if (name === "example") {
      const example = await snapshotDirectory("example", full, diagnostics);
      if (!example) continue;
      exampleBefore = example;
      examplePath = full;

      for (const child of example.entries) {
        const path = `example/${child}`;
        if (!KNOWN_EXAMPLE.has(child)) {
          addDiagnostic(diagnostics, path, "E_PACKAGE_PATH", "Package entry was discovered after directory enumeration");
          continue;
        }
        const snapshot = await snapshotLeaf(join(full, child), path, diagnostics, [{ path: directory, stat: root.stat }, { path: full, stat: example.stat }], FILE_LIMITS[path]);
        if (!snapshot) continue;
        leaves.push(snapshot);
      }
      continue;
    }

    const snapshot = await snapshotLeaf(full, name, diagnostics, [{ path: directory, stat: root.stat }], FILE_LIMITS[name]);
    if (!snapshot) continue;
    leaves.push(snapshot);
  }

  const ordered = [...leaves].sort((left, right) => compareUtf8(left.path, right.path));
  let consumed = 0;
  for (const snapshot of ordered) {
    if (!validateLeafSnapshot(snapshot, diagnostics, MAX_PACKAGE_BYTES - consumed)) continue;
    const bytes = await readLeaf(snapshot, diagnostics, { beforeLeafRead, afterLeafOpenForTest });
    if (bytes) {
      consumed += bytes.length;
      files[snapshot.path] = bytes;
    }
  }

  const rootAfter = await snapshotDirectory("", directory, diagnostics);
  if (rootAfter) {
    compareDirectory(root, rootAfter, diagnostics, (name) => KNOWN_ROOT.has(name));
  }

  if (examplePath) {
    const exampleAfter = await snapshotDirectory("example", examplePath, diagnostics);
    if (exampleAfter) compareDirectory(exampleBefore, exampleAfter, diagnostics, (name) => KNOWN_EXAMPLE.has(name));
  }

  for (const snapshot of ordered) {
    await revalidateLeafBoundary(snapshot, diagnostics);
  }

  return { files, diagnostics };
}
