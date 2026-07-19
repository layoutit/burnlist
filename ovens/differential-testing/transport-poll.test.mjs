import assert from "node:assert/strict";
import test from "node:test";

import { startDifferentialTestingLiveUpdates } from "../../dashboard/src/oven/differential-testing-render/differential-testing-renderer.js";

const ovenUrl = "/api/ovens/differential-testing";
const payloadUrl = "/api/oven-data/differential-testing";

function compactPayload({ publishedAt = "2026-01-01T12:00:00.000Z", status = "complete", report = {} } = {}) {
  return {
    publishedAt,
    refresh: { status, report },
    telemetry: {
      status: "comparable",
      authority: "telemetry-only",
      blockers: [],
      summary: {},
    },
  };
}

function response(body, { status = 200, etag = 'W/"fixture"', ok = status >= 200 && status < 300 } = {}) {
  return {
    status,
    ok,
    headers: {
      get(name) {
        return name.toLowerCase() === "etag" ? etag : null;
      },
    },
    async json() {
      return body;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHarness({ respond, locationSearch = "", locationHref = "http://localhost/ovens/differential-testing/view", onError } = {}) {
  const requests = [];
  const updates = [];
  const statuses = [];
  const mountCalls = [];
  const historyCalls = [];
  const controller = startDifferentialTestingLiveUpdates({ innerHTML: "" }, {
    locationImpl: { search: locationSearch, href: locationHref },
    historyImpl: { replaceState(...args) { historyCalls.push(args); } },
    fetchImpl(url, options) {
      requests.push({ url, options });
      return respond(url, options, requests);
    },
    setIntervalImpl: () => 0,
    clearIntervalImpl() {},
    mount(...args) {
      mountCalls.push(args);
      return {
        update(...updateArgs) {
          updates.push(updateArgs);
        },
        setClientRefreshStatus(status) {
          statuses.push(status);
        },
        destroy() {},
      };
    },
    onError,
  });
  return { controller, requests, updates, statuses, mountCalls, historyCalls };
}

function defaultRespond(url) {
  return url === ovenUrl
    ? response({ oven: { detail: { cells: [] } } })
    : response({ payload: compactPayload() });
}

function payloadRequests(requests) {
  return requests.filter(({ url }) => url.startsWith(payloadUrl));
}

test("stores an ETag and sends it only on the next request for that URL", async () => {
  const harness = createHarness({ respond: defaultRespond });

  await harness.controller.ready;
  await harness.controller.refresh();

  const requests = payloadRequests(harness.requests);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers, undefined);
  assert.deepEqual(requests[1].options.headers, { "If-None-Match": 'W/"fixture"' });
  harness.controller.stop();
});

test("handles cached 304 responses and rejects a 304 before the first payload", async () => {
  for (const [status, expectedStatus] of [["queued", "queued"], ["complete", null]]) {
    let payloadCount = 0;
    const harness = createHarness({
      respond(url) {
        if (url === ovenUrl) return response({ oven: { detail: { cells: [] } } });
        payloadCount += 1;
        return payloadCount === 1
          ? response({ payload: compactPayload({ status }) })
          : response(null, { status: 304, ok: false });
      },
    });

    await harness.controller.ready;
    await harness.controller.refresh();
    assert.equal(harness.mountCalls.length, 1);
    assert.equal(harness.updates.length, 0);
    assert.deepEqual(harness.statuses, [expectedStatus]);
    harness.controller.stop();
  }

  const errors = [];
  const harness = createHarness({
    respond(url) {
      return url === ovenUrl
        ? response({ oven: { detail: { cells: [] } } })
        : response(null, { status: 304, ok: false });
    },
    onError(...args) {
      errors.push(args);
    },
  });
  await harness.controller.ready;
  assert.equal(harness.mountCalls.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0][0].message, /304 before an initial payload/u);
  assert.equal(errors[0][1], false);
  harness.controller.stop();
});

test("drops a response from an older generation after scenario selection", async () => {
  const stalePayload = deferred();
  const freshPayload = deferred();
  let payloadCount = 0;
  const harness = createHarness({
    respond(url) {
      if (url === ovenUrl) return response({ oven: { detail: { cells: [] } } });
      payloadCount += 1;
      if (payloadCount === 1) return response({ payload: compactPayload() });
      if (payloadCount === 2) return stalePayload.promise.then(() => response({ payload: compactPayload({ publishedAt: "stale" }) }));
      return freshPayload.promise.then(() => response({ payload: compactPayload({ publishedAt: "fresh" }) }));
    },
  });

  await harness.controller.ready;
  const staleRefresh = harness.controller.refresh();
  await tick();
  assert.equal(payloadRequests(harness.requests).length, 2);
  harness.controller.selectScenario("newid");
  stalePayload.resolve();
  await tick();
  await tick();

  assert.equal(harness.mountCalls.length, 1);
  assert.equal(harness.updates.length, 0);
  assert.equal(payloadRequests(harness.requests).at(-1).url, `${payloadUrl}?scenario=newid`);
  freshPayload.resolve();
  await tick();
  await tick();
  assert.equal(harness.updates.length, 1);
  void staleRefresh;
  harness.controller.stop();
});

test("coalesces refresh calls made while a refresh is in flight", async () => {
  const firstPayload = deferred();
  let payloadCount = 0;
  const harness = createHarness({
    respond(url) {
      if (url === ovenUrl) return response({ oven: { detail: { cells: [] } } });
      payloadCount += 1;
      return payloadCount === 1
        ? firstPayload.promise.then(() => response({ payload: compactPayload() }))
        : response({ payload: compactPayload({ publishedAt: "second" }) });
    },
  });

  const initial = harness.controller.ready;
  await tick();
  assert.equal(payloadRequests(harness.requests).length, 1);
  harness.controller.refresh();
  harness.controller.refresh();
  firstPayload.resolve();
  await initial;
  await tick();
  await tick();

  assert.equal(payloadRequests(harness.requests).length, 2);
  harness.controller.stop();
});

test("selectScenario updates history, clears its URL cache, and refetches the selected scenario", async () => {
  let payloadCount = 0;
  const harness = createHarness({
    locationSearch: "?scenario=oldid",
    locationHref: "http://localhost/ovens/differential-testing/view?scenario=oldid",
    respond(url) {
      if (url === ovenUrl) return response({ oven: { detail: { cells: [] } } });
      payloadCount += 1;
      return response({ payload: compactPayload({ publishedAt: String(payloadCount) }) }, { etag: `W/"${payloadCount}"` });
    },
  });

  await harness.controller.ready;
  await harness.controller.selectScenario("newid");
  await harness.controller.refresh();
  await harness.controller.selectScenario("newid");

  const requests = payloadRequests(harness.requests);
  assert.equal(requests[0].url, `${payloadUrl}?scenario=oldid`);
  assert.equal(requests[1].url, `${payloadUrl}?scenario=newid`);
  assert.equal(requests[1].options.headers, undefined);
  assert.deepEqual(requests[2].options.headers, { "If-None-Match": 'W/"2"' });
  assert.equal(requests[3].options.headers, undefined);
  assert.ok(harness.historyCalls.length >= 1);
  assert.ok(harness.historyCalls.some(([, , path]) => path.includes("scenario=newid")));
  harness.controller.stop();
});

test("selectFieldView advances the view generation and sends every view parameter", async () => {
  let payloadCount = 0;
  const harness = createHarness({
    respond(url) {
      if (url === ovenUrl) return response({ oven: { detail: { cells: [] } } });
      payloadCount += 1;
      return response({ payload: compactPayload({ publishedAt: String(payloadCount) }) }, { etag: `W/"${payloadCount}"` });
    },
  });
  const query = { search: "wheel force", filter: "failing", sort: "changed", page: 2, pageSize: 50 };

  await harness.controller.ready;
  await harness.controller.selectFieldView(query);
  await harness.controller.refresh();
  await harness.controller.selectFieldView(query);

  const requests = payloadRequests(harness.requests);
  const viewUrl = `${payloadUrl}?search=wheel+force&filter=failing&sort=changed&page=2&pageSize=50`;
  assert.equal(requests[1].url, viewUrl);
  assert.equal(requests[1].options.headers, undefined);
  assert.deepEqual(requests[2].options.headers, { "If-None-Match": 'W/"2"' });
  assert.equal(requests[3].options.headers, undefined);
  harness.controller.stop();
});

test("reports refresh failures with and without an existing dashboard", async () => {
  const dashboardErrors = [];
  let payloadCount = 0;
  const dashboardHarness = createHarness({
    respond(url) {
      if (url === ovenUrl) return response({ oven: { detail: { cells: [] } } });
      payloadCount += 1;
      if (payloadCount === 2) return Promise.reject(new Error("network offline"));
      return response({ payload: compactPayload() });
    },
    onError(...args) {
      dashboardErrors.push(args);
    },
  });
  await dashboardHarness.controller.ready;
  await dashboardHarness.controller.refresh();
  assert.deepEqual(dashboardHarness.statuses, ["failed"]);
  assert.equal(dashboardErrors.length, 1);
  assert.equal(dashboardErrors[0][0].message, "network offline");
  assert.equal(dashboardErrors[0][1], true);
  dashboardHarness.controller.stop();

  const firstLoadErrors = [];
  const firstLoadHarness = createHarness({
    respond(url) {
      return url === ovenUrl
        ? response({ error: "oven unavailable" }, { status: 503, ok: false })
        : response({ payload: compactPayload() });
    },
    onError(...args) {
      firstLoadErrors.push(args);
    },
  });
  await firstLoadHarness.controller.ready;
  assert.equal(firstLoadErrors.length, 1);
  assert.equal(firstLoadErrors[0][0].message, "oven unavailable");
  assert.equal(firstLoadErrors[0][1], false);
  firstLoadHarness.controller.stop();
});

test("passes a pending refresh status without rerendering the same report", async () => {
  let payloadCount = 0;
  const harness = createHarness({
    respond(url) {
      if (url === ovenUrl) return response({ oven: { detail: { cells: [] } } });
      payloadCount += 1;
      return payloadCount === 1
        ? response({ payload: compactPayload() }, { etag: 'W/"one"' })
        : response({ payload: compactPayload({ publishedAt: "next", status: "running" }) }, { etag: 'W/"two"' });
    },
  });

  await harness.controller.ready;
  await harness.controller.refresh();
  assert.equal(harness.mountCalls.length, 1);
  assert.equal(harness.updates.length, 0);
  assert.deepEqual(harness.statuses, ["running"]);
  harness.controller.stop();
});
