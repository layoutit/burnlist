import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLocalOvenInventory, buildOfficialOvenCatalog, buildOvenCatalog } from './oven-catalog.mjs';

const officialFixture = ({
  id = 'alpha',
  name = 'Alpha Oven',
  maturity = 'shipped',
  state = 'unverified',
  dataInput = 'json-payload',
} = {}) => ({
  id,
  version: '1.0.0',
  contract: 'official-contract@1',
  dataInput,
  producer: `project-${id}-adapter`,
  routeKind: 'repo-oven',
  maturity,
  acceptance: { state, evidenceClass: 'canonical-oven', fixtureEvidence: 'forbidden' },
  name,
  description: `Official ${name}.`,
  ovenRevision: `o1-sha256:${'a'.repeat(64)}`,
});

test('buildOvenCatalog builds sorted catalog entries with state-aware setup instructions', () => {
  const ovens = [
    {
      id: 'custom-experiment',
      contract: 'custom-contract-v2',
      version: '2.4.0',
      name: 'Workshop Oven',
      description: 'A repository-specific custom oven.',
      builtIn: false,
      repoKey: 'acme/widgets',
      dataInput: 'json-payload',
    },
    {
      id: 'beta',
      contract: 'builtin-contract-v1',
      version: '1.1.0',
      name: 'beta Oven',
      description: 'The second built-in oven.',
      builtIn: true,
      repoKey: null,
      dataInput: 'producer-managed',
    },
    {
      id: 'alpha',
      contract: 'builtin-contract-v1',
      version: '1.0.0',
      name: 'Alpha Oven',
      description: 'The first built-in oven.',
      builtIn: true,
      repoKey: null,
      dataInput: 'json-payload',
    },
  ];

  const catalog = buildOvenCatalog(ovens);

  assert.equal(catalog.length, ovens.length);
  assert.deepEqual(
    catalog.map(({ id }) => id),
    ['alpha', 'beta', 'custom-experiment'],
  );
  assert.ok(catalog.slice(0, 2).every(({ builtIn }) => builtIn));
  assert.ok(catalog.slice(2).every(({ builtIn }) => !builtIn));

  for (const entry of catalog) {
    const oven = ovens.find(({ id }) => id === entry.id);

    assert.equal(entry.name, oven.name);
    assert.equal(entry.version, oven.version);
    assert.equal(entry.contract, oven.contract);
    assert.equal(entry.description, oven.description);
    assert.equal(entry.builtIn, oven.builtIn);
    assert.equal(entry.repoKey, oven.repoKey);
    assert.equal(entry.dataInput, oven.dataInput);
    assert.equal(entry.label, `${oven.id}@${oven.version}`);
    assert.ok(entry.agentInstructions.includes(oven.name));
    assert.ok(entry.agentInstructions.includes(entry.label));
    assert.ok(entry.agentInstructions.includes(oven.contract));
  }

  const alpha = catalog.find(({ id }) => id === 'alpha');
  const custom = catalog.find(({ id }) => id === 'custom-experiment');

  assert.equal(alpha.href, '/ovens/alpha');
  assert.equal(custom.href, '/ovens/custom-experiment?repoKey=acme%2Fwidgets');
  assert.match(alpha.agentInstructions, /burnlist oven use alpha/u);
  assert.match(alpha.agentInstructions, /burnlist oven set alpha <path>/u);
  assert.doesNotMatch(alpha.agentInstructions, /oven (?:adopt|bind)/u);
  assert.match(custom.agentInstructions, /burnlist oven set custom-experiment <path>/u);
  assert.doesNotMatch(custom.agentInstructions, /burnlist oven (?:use|adopt|bind)/u);

  const beta = catalog.find(({ id }) => id === 'beta');
  assert.match(beta.agentInstructions, /producer-managed/u);
  assert.doesNotMatch(beta.agentInstructions, /burnlist oven (?:set|bind)/u);
});

test('buildOvenCatalog does not reinstall a repo-scoped built-in', () => {
  const [vendored] = buildOvenCatalog([{
    id: 'checklist', name: 'Vendored Checklist', version: '7.8.9', contract: 'checklist-progress@1',
    description: 'Repository copy.', builtIn: true, repoKey: 'abc123', dataInput: 'json-payload',
  }]);

  assert.match(vendored.agentInstructions, /already available/u);
  assert.match(vendored.agentInstructions, /burnlist oven set checklist <path>/u);
  assert.doesNotMatch(vendored.agentInstructions, /burnlist oven (?:use|adopt|bind)/u);
});

test('buildOfficialOvenCatalog keeps membership distinct from acceptance', () => {
  const [entry] = buildOfficialOvenCatalog([officialFixture()]);

  assert.equal(entry.origin, 'official');
  assert.equal(entry.repoKey, null);
  assert.equal(entry.maturityLabel, 'Shipped');
  assert.equal(entry.acceptanceLabel, 'Unverified');
  assert.equal(entry.href, '/ovens/alpha');
  assert.match(entry.agentInstructions, /Do not invent a replacement Oven, renderer, or data contract/u);
  assert.match(entry.agentInstructions, /project-alpha-adapter/u);
  assert.match(entry.agentInstructions, /burnlist oven use alpha/u);
  assert.match(entry.agentInstructions, /burnlist oven set alpha <path>/u);
  assert.match(entry.agentInstructions, /fixtures do not/u);
});

test('buildOfficialOvenCatalog respects producer-managed data and visible status labels', () => {
  const [entry] = buildOfficialOvenCatalog([officialFixture({
    id: 'retired-feed',
    name: 'Retired Feed',
    maturity: 'deprecated',
    state: 'blocked',
    dataInput: 'producer-managed',
  })]);

  assert.equal(entry.maturityLabel, 'Deprecated');
  assert.equal(entry.acceptanceLabel, 'Blocked');
  assert.match(entry.agentInstructions, /producer-managed/u);
  assert.doesNotMatch(entry.agentInstructions, /burnlist oven set/u);
});

test('buildLocalOvenInventory excludes official entries and origin-qualifies collisions', () => {
  const local = buildLocalOvenInventory([
    { id: 'same', name: 'Official Same', version: '1.0.0', contract: 'same@1', description: '', builtIn: true, origin: 'official', repoKey: null, dataInput: 'json-payload', catalogRevision: 'a'.repeat(64) },
    { id: 'same', name: 'Vendored Same', version: '2.0.0', contract: 'same@1', description: '', builtIn: true, origin: 'vendored', repoKey: 'aaaaaaaaaaaa', dataInput: 'json-payload', catalogRevision: null },
    { id: 'same', name: 'Custom Same', version: '3.0.0', contract: 'same@1', description: '', builtIn: false, origin: 'custom', repoKey: 'bbbbbbbbbbbb', dataInput: 'json-payload', catalogRevision: null },
  ]);

  assert.deepEqual(local.map(({ origin }) => origin), ['vendored', 'custom']);
  assert.deepEqual(local.map(({ repoKey }) => repoKey), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
  assert.ok(local.every(({ agentInstructions }) => agentInstructions.includes('not official catalog membership')));
});
