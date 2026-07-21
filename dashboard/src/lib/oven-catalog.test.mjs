import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildOvenCatalog } from './oven-catalog.mjs';

test('buildOvenCatalog builds sorted catalog entries with adoption instructions', () => {
  const ovens = [
    {
      id: 'custom/experiment',
      contract: 'custom-contract-v2',
      version: '2.4.0',
      name: 'Workshop Oven',
      description: 'A repository-specific custom oven.',
      builtIn: false,
      repoKey: 'acme/widgets',
    },
    {
      id: 'beta',
      contract: 'builtin-contract-v1',
      version: '1.1.0',
      name: 'beta Oven',
      description: 'The second built-in oven.',
      builtIn: true,
      repoKey: null,
    },
    {
      id: 'alpha',
      contract: 'builtin-contract-v1',
      version: '1.0.0',
      name: 'Alpha Oven',
      description: 'The first built-in oven.',
      builtIn: true,
      repoKey: null,
    },
  ];

  const catalog = buildOvenCatalog(ovens);

  assert.equal(catalog.length, ovens.length);
  assert.deepEqual(
    catalog.map(({ id }) => id),
    ['alpha', 'beta', 'custom/experiment'],
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
    assert.equal(entry.label, `${oven.id}@${oven.version}`);
    assert.equal(entry.adoptCommand, `burnlist oven adopt ${oven.id}`);
    assert.ok(entry.agentInstructions.includes(oven.name));
    assert.ok(entry.agentInstructions.includes(entry.label));
    assert.ok(entry.agentInstructions.includes(oven.contract));
    assert.ok(entry.agentInstructions.includes(`burnlist oven adopt ${oven.id}`));
    assert.ok(entry.agentInstructions.includes(`burnlist oven bind ${oven.id}`));
  }

  const alpha = catalog.find(({ id }) => id === 'alpha');
  const custom = catalog.find(({ id }) => id === 'custom/experiment');

  assert.equal(alpha.href, '/ovens/alpha');
  assert.equal(custom.href, '/ovens/custom%2Fexperiment?repoKey=acme%2Fwidgets');
});
