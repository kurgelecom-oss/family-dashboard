import {test} from 'node:test';
import assert from 'node:assert/strict';
import {familyDatabaseUrl} from './family-db.ts';
test('serverless family reads use Supabase transaction pooling without changing the database identity',()=>{
 const url=new URL(familyDatabaseUrl('postgres://postgres.test:example@aws-0-test.pooler.supabase.com:5432/postgres?sslmode=require'));
 assert.equal(url.port,'6543');assert.equal(url.username,'postgres.test');assert.equal(url.password,'example');assert.equal(url.pathname,'/postgres');assert.equal(url.search,'?sslmode=require');
});
test('direct and custom database endpoints keep their configured port',()=>{
 for(const original of ['postgres://user:example@db.test.supabase.co:5432/postgres','postgres://user:example@localhost:5432/postgres','postgres://user:example@aws-0-test.pooler.supabase.com:6543/postgres'])assert.equal(familyDatabaseUrl(original),original);
});
