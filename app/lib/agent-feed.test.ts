import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentActions } from './agent-feed.ts';

const job = (id: string, agent: string, action: string, result: string, status = 'done') => ({ id, updated_at: '2026-10-28T01:00:00Z', doc: { agent, action, result, status } });

test('GARY and JUNE reports pop; other seats only for real jobs; non-actions drop', () => {
  const out = agentActions([
    job('1', 'gary', 'STATUS REPORT', 'Daily ads (Omega X · Nihal): 26 Oct uploaded live, 6 ad(s)\nmore'),
    job('2', 'gary', 'STATUS REPORT', 'LIARE daily entry: US day 2026-10-26 already written and emailed'),
    job('3', 'june', 'STATUS REPORT', 'JUNE daily batch could not run: [Errno 11]'),
    job('4', 'sara', 'STATUS REPORT', 'Support: 0 new'),
    job('5', 'nora', 'Daily order: Check competitor ad counts · Omega X', 'Done 2026-10-28'),
    job('6', 'june', 'STUDY ADS (daily)', 'JUNE finished “STUDY ADS”.'),
    job('7', 'gary', 'STATUS REPORT', 'x', 'running'),
    job('8', 'bob', 'Sonny relay', 'sent to a@b.com'),
    job('9', 'gary', 'Upload', 'emailed tk@example.com on 0412 345 678'),
  ]);
  assert.deepEqual(out.map(x => [x.id, x.who, x.warn]), [['1', 'GARY', false], ['3', 'JUNE', true], ['6', 'JUNE', false], ['9', 'GARY', false]]);
  assert.equal(out[3].text, 'emailed [email] on [number]');
  assert.equal(out[0].text, 'Daily ads (Omega X · Nihal): 26 Oct uploaded live, 6 ad(s)');
});
