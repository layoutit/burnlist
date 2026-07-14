const GOLDEN_ANGLE = 2.399963229728653;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function directoryName(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "root";
}

function inScope(path, scope) {
  return !scope || path === scope || path.startsWith(`${scope}/`);
}

function groupFor(path, scope) {
  const directory = directoryName(path);
  if (!scope || scope === "root") return directory.split("/")[0] || "root";
  if (directory === scope) return scope;
  const suffix = directory.slice(scope.length).replace(/^\/+/, "");
  return suffix ? `${scope}/${suffix.split("/")[0]}` : scope;
}

function fileRadius(size, low, high) {
  const value = Math.log2(Math.max(1, Number(size) || 1) + 1);
  const normalized = clamp((value - low) / Math.max(.5, high - low), 0, 1);
  return 3.4 + Math.pow(normalized, .68) * 7.6;
}

function folderLabel(group, scope) {
  if (group === scope) return `${scope}/`;
  return `${group.split("/").at(-1)}/`;
}

function initialGroupCenters(groups, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = Math.min(width * .34, 330);
  const radiusY = Math.min(height * .3, 145);
  return groups.map((group, index) => {
    const angle = groups.length === 1 ? 0 : -Math.PI / 2 + (Math.PI * 2 * index) / groups.length;
    const radius = 42 + Math.sqrt(group.files.length) * 15;
    return {
      ...group,
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
      vx: 0,
      vy: 0,
      radius: clamp(radius, 58, 150),
    };
  });
}

function settleGroupCenters(groups, crossEdges, width, height) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (let tick = 0; tick < 100; tick += 1) {
    const force = new Map(groups.map((group) => [group.id, { x: 0, y: 0 }]));
    for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
        const left = groups[leftIndex];
        const right = groups[rightIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance < .01) {
          const angle = ((hashString(`${left.id}/${right.id}`) % 6283) / 1000);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const desired = left.radius + right.radius + 36;
        const amount = distance < desired ? (desired - distance) * .055 : 0;
        const unitX = dx / distance;
        const unitY = dy / distance;
        force.get(left.id).x -= unitX * amount;
        force.get(left.id).y -= unitY * amount;
        force.get(right.id).x += unitX * amount;
        force.get(right.id).y += unitY * amount;
      }
    }
    for (const edge of crossEdges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const amount = (distance - 220) * Math.min(.018, .004 + edge.weight * .0015);
      force.get(source.id).x += (dx / distance) * amount;
      force.get(source.id).y += (dy / distance) * amount;
      force.get(target.id).x -= (dx / distance) * amount;
      force.get(target.id).y -= (dy / distance) * amount;
    }
    for (const group of groups) {
      const pullX = (width / 2 - group.x) * .0015;
      const pullY = (height / 2 - group.y) * .0015;
      group.vx = (group.vx + force.get(group.id).x + pullX) * .72;
      group.vy = (group.vy + force.get(group.id).y + pullY) * .72;
      group.x = clamp(group.x + group.vx, group.radius + 24, width - group.radius - 24);
      group.y = clamp(group.y + group.vy, group.radius + 24, height - group.radius - 24);
    }
  }
}

function settleFiles(nodes, edges, groups, width, height) {
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  for (let tick = 0; tick < 150; tick += 1) {
    const alpha = 1 - tick / 170;
    const force = new Map(nodes.map((node) => [node.path, { x: 0, y: 0 }]));
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance < .01) {
          const angle = (hashString(`${left.path}/${right.path}`) % 6283) / 1000;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const desired = left.r + right.r + 5;
        const collision = distance < desired ? (desired - distance) * .28 : 0;
        const repulsion = distance < 95 ? 28 / Math.max(18, distance) : 0;
        const amount = collision + repulsion;
        const unitX = dx / distance;
        const unitY = dy / distance;
        force.get(left.path).x -= unitX * amount;
        force.get(left.path).y -= unitY * amount;
        force.get(right.path).x += unitX * amount;
        force.get(right.path).y += unitY * amount;
      }
    }
    for (const edge of edges) {
      const source = byPath.get(edge.source);
      const target = byPath.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = source.group === target.group ? 48 : 90;
      const amount = (distance - desired) * .012 * alpha;
      force.get(source.path).x += (dx / distance) * amount;
      force.get(source.path).y += (dy / distance) * amount;
      force.get(target.path).x -= (dx / distance) * amount;
      force.get(target.path).y -= (dy / distance) * amount;
    }
    for (const node of nodes) {
      const group = groupById.get(node.group);
      const pull = node.active ? .022 : node.dirty ? .018 : .014;
      force.get(node.path).x += (group.x - node.x) * pull;
      force.get(node.path).y += (group.y - node.y) * pull;
      node.vx = (node.vx + force.get(node.path).x * alpha) * .76;
      node.vy = (node.vy + force.get(node.path).y * alpha) * .76;
      node.x = clamp(node.x + node.vx, node.r + 20, width - node.r - 20);
      node.y = clamp(node.y + node.vy, node.r + 20, height - node.r - 20);
    }
  }
}

function folderBoundary(nodes, group, scope) {
  const members = nodes.filter((node) => node.group === group.id);
  const cx = members.reduce((sum, node) => sum + node.x, 0) / Math.max(1, members.length);
  const cy = members.reduce((sum, node) => sum + node.y, 0) / Math.max(1, members.length);
  const radius = members.reduce((largest, node) => Math.max(largest, Math.hypot(node.x - cx, node.y - cy) + node.r), 26) + 14;
  return {
      id: group.id,
      label: folderLabel(group.id, scope),
      cx,
      cy,
      r: radius,
      dirty: members.some((node) => node.dirty),
      count: members.length,
  };
}

function moveGroup(nodes, groupId, dx, dy) {
  for (const node of nodes) {
    if (node.group !== groupId) continue;
    node.x += dx;
    node.y += dy;
  }
}

function separateFolderGroups(nodes, groups, scope, width, height) {
  for (let pass = 0; pass < 14; pass += 1) {
    const boundaries = groups.map((group) => folderBoundary(nodes, group, scope));
    for (let leftIndex = 0; leftIndex < boundaries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < boundaries.length; rightIndex += 1) {
        const left = boundaries[leftIndex];
        const right = boundaries[rightIndex];
        let dx = right.cx - left.cx;
        let dy = right.cy - left.cy;
        let distance = Math.hypot(dx, dy);
        if (distance < .01) { dx = 1; dy = 0; distance = 1; }
        const overlap = left.r + right.r + 18 - distance;
        if (overlap <= 0) continue;
        const shiftX = (dx / distance) * overlap * .5;
        const shiftY = (dy / distance) * overlap * .5;
        moveGroup(nodes, left.id, -shiftX, -shiftY);
        moveGroup(nodes, right.id, shiftX, shiftY);
      }
    }
  }
  for (const group of groups) {
    const boundary = folderBoundary(nodes, group, scope);
    const dx = boundary.cx - boundary.r < 12 ? 12 - (boundary.cx - boundary.r) : boundary.cx + boundary.r > width - 12 ? width - 12 - (boundary.cx + boundary.r) : 0;
    const dy = boundary.cy - boundary.r < 12 ? 12 - (boundary.cy - boundary.r) : boundary.cy + boundary.r > height - 12 ? height - 12 - (boundary.cy + boundary.r) : 0;
    moveGroup(nodes, group.id, dx, dy);
  }
}

function folderBoundaries(nodes, groups, scope) {
  return groups.map((group) => folderBoundary(nodes, group, scope));
}

export function repoGraphFileColor(path) {
  const name = String(path || "").split("/").at(-1)?.toLowerCase() || "";
  const extension = name.includes(".") ? name.split(".").at(-1) : "";
  if (["ts", "tsx"].includes(extension)) return "#5aa2ff";
  if (["js", "mjs", "cjs", "jsx"].includes(extension)) return "#d9b85f";
  if (["css", "scss", "sass", "less"].includes(extension)) return "#c78cff";
  if (["json", "yaml", "yml", "toml", "xml"].includes(extension)) return "#67d58b";
  if (["md", "mdx", "txt", "rst"].includes(extension)) return "#9aa8b8";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(extension)) return "#e8799f";
  return "#657080";
}

export function layoutRepoGraph(files, apiEdges, scope, { width = 1000, height = 500 } = {}) {
  const visibleFiles = (Array.isArray(files) ? files : []).filter((file) => inScope(file.path, scope)).sort((left, right) => left.path.localeCompare(right.path));
  const visiblePaths = new Set(visibleFiles.map((file) => file.path));
  const edges = (Array.isArray(apiEdges) ? apiEdges : []).filter((edge) => edge.type === "import" && visiblePaths.has(edge.source) && visiblePaths.has(edge.target));
  const grouped = new Map();
  for (const file of visibleFiles) {
    const group = groupFor(file.path, scope);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(file);
  }
  const groups = [...grouped.entries()].map(([id, groupFiles]) => ({ id, files: groupFiles })).sort((left, right) => left.id.localeCompare(right.id));
  const groupForPath = new Map(visibleFiles.map((file) => [file.path, groupFor(file.path, scope)]));
  const crossWeights = new Map();
  for (const edge of edges) {
    const source = groupForPath.get(edge.source);
    const target = groupForPath.get(edge.target);
    if (!source || !target || source === target) continue;
    const key = source < target ? `${source}\0${target}` : `${target}\0${source}`;
    crossWeights.set(key, (crossWeights.get(key) || 0) + 1);
  }
  const crossEdges = [...crossWeights.entries()].map(([key, weight]) => {
    const [source, target] = key.split("\0");
    return { source, target, weight };
  });
  const settledGroups = initialGroupCenters(groups, width, height);
  settleGroupCenters(settledGroups, crossEdges, width, height);
  const groupById = new Map(settledGroups.map((group) => [group.id, group]));
  const logs = visibleFiles.map((file) => Math.log2(Math.max(1, Number(file.size) || 1) + 1));
  const low = logs.length ? Math.min(...logs) : 0;
  const high = logs.length ? Math.max(...logs) : 1;
  const nodes = visibleFiles.map((file, index) => {
    const group = groupById.get(groupForPath.get(file.path));
    const angle = (hashString(file.path) % 6283) / 1000 + index * GOLDEN_ANGLE;
    const ring = 18 + Math.sqrt((index % Math.max(1, group.files.length)) + 1) * 12;
    return {
      ...file,
      group: group.id,
      x: group.x + Math.cos(angle) * ring,
      y: group.y + Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
      r: fileRadius(file.size, low, high),
      color: repoGraphFileColor(file.path),
    };
  });
  settleFiles(nodes, edges, settledGroups, width, height);
  separateFolderGroups(nodes, settledGroups, scope, width, height);
  return { nodes, edges, groups: folderBoundaries(nodes, settledGroups, scope) };
}
