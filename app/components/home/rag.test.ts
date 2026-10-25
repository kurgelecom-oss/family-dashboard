import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversionRag, goalRag, listRag, paceRag } from './rag.ts';

test('pace compares with what should have happened by now', () => {
  assert.equal(paceRag(4, 4), 'good');
  assert.equal(paceRag(3, 4), 'warn');
  assert.equal(paceRag(1, 4), 'bad');
  assert.equal(paceRag(0, 0), null);
});

test('a list is not red early in the morning', () => {
  assert.equal(listRag(0, 5, 6.5), 'bad');   // 6:30 am: 0.17 expected, 0 done → behind
  assert.equal(listRag(1, 5, 6.5), 'good');
  assert.equal(listRag(0, 5, 5), null);
  assert.equal(listRag(5, 5, 23), 'good');
  assert.equal(listRag(2, 5, 21), 'bad');
});

test('store and goal thresholds', () => {
  assert.equal(conversionRag(3.2), 'good');
  assert.equal(conversionRag(2.4), 'warn');
  assert.equal(conversionRag(1.1), 'bad');
  assert.equal(goalRag(100), 'good');
  assert.equal(goalRag(0), 'bad');
});
