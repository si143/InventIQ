import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSelectedDatasetId } from './datasetStorage.js';

test('keeps a valid dataset selection', () => {
  const datasets = [{ dataset_id: 2 }, { dataset_id: 5 }];
  assert.equal(resolveSelectedDatasetId('5', datasets), '5');
});

test('clears stale dataset ids when no valid dataset exists', () => {
  const datasets = [];
  assert.equal(resolveSelectedDatasetId('99', datasets), '');
});

test('falls back to the first dataset when current selection is invalid', () => {
  const datasets = [{ dataset_id: 7 }, { dataset_id: 9 }];
  assert.equal(resolveSelectedDatasetId('99', datasets), '7');
});
