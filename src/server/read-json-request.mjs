export async function readJsonRequest(req, { maximumBytes = 262_144 } = {}) {
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    fail("Content-Type must be application/json.", 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximumBytes) fail("Request body is too large.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("Request body must be valid JSON.", 400);
  }
}

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
