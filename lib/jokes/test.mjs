// Run: node --test lib/jokes/test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JOKES, CATEGORY_LABELS, MIN_PER_CATEGORY } from './catalogue.mjs';
import { configure, pick, categories, find, speakable, knockLines, recent, resetTold, RECENT_WINDOW } from './index.mjs';

// Never touch the app's real data/jokes-told.json from tests.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayspring-jokes-'));
configure({ toldPath: path.join(tmpDir, 'jokes-told.json') });

const TYPES = new Set(['qa', 'oneliner', 'knock']);
const TAGS = new Set(['pun', 'kids', 'dad-joke']);
const REQUIRED_CATEGORIES = [
  'food', 'animals', 'space', 'math', 'science', 'school', 'sports', 'music', 'weather', 'seasons',
  'tech', 'health', 'jobs', 'history', 'geography', 'politics', 'showbiz', 'farm', 'ocean', 'dinosaurs',
  'bugs', 'travel', 'family', 'books', 'art', 'kitchen', 'birthdays', 'christmas', 'thanksgiving',
  'halloween', 'valentines', 'garden', 'time', 'money', 'pirates', 'monsters', 'robots', 'church',
];
const BANNED = [
  'damn', 'dammit', 'hell', 'crap', 'shit', 'fuck', 'bitch', 'bastard', 'ass', 'asshole', 'piss', 'pissed',
  'dick', 'cock', 'pussy', 'slut', 'whore', 'sex', 'sexy', 'boobs', 'porn', 'retard', 'retarded',
  'stupid', 'idiot', 'moron', 'dumb', 'ugly', 'fatso', 'beer', 'vodka', 'whiskey', 'drunk', 'booze',
  'stoned', 'cocaine', 'kill', 'killed', 'murder', 'gun', 'guns', 'suicide', 'democrat',
  'democrats', 'republican', 'republicans', 'liberal', 'conservative',
];
const bannedRe = new RegExp(`\\b(${BANNED.join('|')})\\b`, 'i');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

test('ids are unique and well formed', () => {
  const seen = new Set();
  for (const j of JOKES) {
    assert.match(j.id, /^[a-z]+-\d{3}$/, `bad id ${j.id}`);
    assert.ok(j.id.startsWith(j.category + '-'), `id ${j.id} should start with its category`);
    assert.ok(!seen.has(j.id), `duplicate id ${j.id}`);
    seen.add(j.id);
  }
});

test('no empty fields and valid enums', () => {
  for (const j of JOKES) {
    assert.ok(CATEGORY_LABELS[j.category], `${j.id}: unknown category ${j.category}`);
    assert.ok(TYPES.has(j.type), `${j.id}: bad type ${j.type}`);
    assert.equal(typeof j.setup, 'string');
    assert.ok(j.setup.trim().length > 0, `${j.id}: empty setup`);
    if (j.type !== 'oneliner' || 'punchline' in j) {
      assert.equal(typeof j.punchline, 'string', `${j.id}: missing punchline`);
      assert.ok(j.punchline.trim().length > 0, `${j.id}: empty punchline`);
    }
    if (j.tags !== undefined) {
      assert.ok(Array.isArray(j.tags), `${j.id}: tags must be an array`);
      for (const t of j.tags) assert.ok(TAGS.has(t), `${j.id}: unknown tag ${t}`);
    }
    for (const f of ['setup', 'punchline']) {
      if (j[f] === undefined) continue;
      assert.equal(j[f], j[f].trim(), `${j.id}: ${f} has stray whitespace`);
      assert.ok(!/\\"|\s{2,}/.test(j[f]), `${j.id}: ${f} has an escape artifact or double space`);
    }
  }
});

test('catalogue size and per-category minimums', () => {
  assert.ok(JOKES.length >= 600, `only ${JOKES.length} jokes`);
  const knocks = JOKES.filter((j) => j.type === 'knock').length;
  assert.ok(knocks >= 120, `only ${knocks} knock-knock jokes`);
  const counts = {};
  for (const j of JOKES) counts[j.category] = (counts[j.category] || 0) + 1;
  for (const c of REQUIRED_CATEGORIES) {
    assert.ok((counts[c] || 0) >= MIN_PER_CATEGORY, `${c} has ${counts[c] || 0}, needs ${MIN_PER_CATEGORY}`);
  }
  const listed = categories();
  assert.equal(listed.reduce((n, c) => n + c.count, 0), JOKES.length);
  for (const c of listed) assert.equal(c.count, c.types.qa + c.types.oneliner + c.types.knock);
});

test('no duplicate jokes (same setup or same punchline)', () => {
  const setups = new Map();
  const punches = new Map();
  for (const j of JOKES) {
    const s = j.type + ':' + norm(j.setup);
    assert.ok(!setups.has(s), `${j.id} repeats the setup of ${setups.get(s)}`);
    setups.set(s, j.id);
    if (j.punchline) {
      const p = norm(j.punchline);
      assert.ok(!punches.has(p), `${j.id} repeats the punchline of ${punches.get(p)}`);
      punches.set(p, j.id);
    }
  }
});

test('no banned words', () => {
  for (const j of JOKES) {
    const text = `${j.setup} ${j.punchline || ''}`;
    const m = text.match(bannedRe);
    assert.equal(m, null, `${j.id} contains banned word "${m && m[0]}"`);
  }
});

test('knock-knock jokes have the right shape', () => {
  for (const j of JOKES.filter((x) => x.type === 'knock')) {
    const words = j.setup.split(/\s+/);
    assert.ok(words.length >= 1 && words.length <= 4, `${j.id}: setup should be a short name/word, got "${j.setup}"`);
    assert.ok(!/[?.!,]$/.test(j.setup), `${j.id}: setup should not end in punctuation`);
    assert.ok(!/knock|who's there/i.test(j.setup), `${j.id}: store only the name, not the routine`);
    assert.ok(!/^knock/i.test(j.punchline) && !/who's there/i.test(j.punchline), `${j.id}: punchline should be just the payoff`);
    const lines = knockLines(j);
    assert.deepEqual(lines.slice(0, 2), ['Knock knock.', "Who's there?"]);
    assert.equal(lines[2], `${j.setup}.`);
    assert.equal(lines[3], `${j.setup} who?`);
    assert.equal(lines[4], j.punchline);
  }
});

test('pick never repeats within the recent window', () => {
  resetTold();
  const told = [];
  for (let i = 0; i < 400; i++) {
    const j = pick();
    assert.ok(j, 'pick returned nothing');
    const window = told.slice(-(RECENT_WINDOW - 1));
    assert.ok(!window.includes(j.id), `repeated ${j.id} within ${RECENT_WINDOW}`);
    told.push(j.id);
  }
  const saved = recent();
  assert.equal(saved.length, RECENT_WINDOW);
  assert.deepEqual(saved, told.slice(-RECENT_WINDOW));
});

test('pick respects category, type and exclude, and survives a missing or broken file', () => {
  const file = path.join(tmpDir, 'jokes-told.json');
  fs.rmSync(file, { force: true });
  assert.deepEqual(recent(), []);
  const a = pick({ category: 'space' });
  assert.equal(a.category, 'space');
  const k = pick({ type: 'knock' });
  assert.equal(k.type, 'knock');
  const both = pick({ category: 'christmas', type: 'knock' });
  assert.equal(both.category, 'christmas');
  assert.equal(both.type, 'knock');
  const pool = JOKES.filter((j) => j.category === 'pirates').map((j) => j.id);
  const keep = pool[0];
  const got = pick({ category: 'pirates', exclude: pool.slice(1), record: false });
  assert.equal(got.id, keep);
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(recent(), []);
  assert.ok(pick());
  assert.equal(recent().length, 1);
  // A category smaller than the window still returns something once exhausted.
  resetTold();
  const n = JOKES.filter((j) => j.category === 'math').length;
  for (let i = 0; i < n + 5; i++) assert.equal(pick({ category: 'math' }).category, 'math');
  assert.ok(!fs.readdirSync(tmpDir).some((f) => f.endsWith('.tmp')), 'temp files left behind');
});

test('find maps requests to categories and types', () => {
  assert.equal(find('tell me a space joke').category, 'space');
  assert.equal(find('something about food').category, 'food');
  assert.equal(find('a cooking joke').category, 'food');
  assert.equal(find('tell me a joke about politics').category, 'politics');
  assert.equal(find('what about a politician joke').category, 'politics');
  assert.deepEqual(find('knock knock'), { category: null, type: 'knock' });
  assert.deepEqual(find('Tell me a knock-knock joke about animals'), { category: 'animals', type: 'knock' });
  assert.equal(find('a Christmas joke').category, 'christmas');
  assert.equal(find('a Bible joke').category, 'church');
  assert.equal(find('a dinosaur joke').category, 'dinosaurs');
  assert.equal(find('something about the weather').category, 'weather');
  assert.equal(find('I love space jokes').category, 'space');
  assert.equal(find('tell me a joke'), null);
  assert.equal(find(''), null);
});

test('speakable adds a pause before the punchline', () => {
  const qa = JOKES.find((j) => j.type === 'qa');
  const s = speakable(qa);
  assert.equal(s.setup, qa.setup);
  assert.equal(s.punchline, qa.punchline);
  assert.equal(s.pause_ms, 1200);
  const k = JOKES.find((j) => j.type === 'knock');
  const ks = speakable(k);
  assert.equal(ks.setup, `Knock knock. Who's there? ${k.setup}. ${k.setup} who?`);
  assert.equal(ks.punchline, k.punchline);
  assert.ok(ks.pause_ms > 0);
  assert.equal(speakable(qa, { pause_ms: 500 }).pause_ms, 500);
  assert.equal(speakable({ id: 'x', type: 'oneliner', setup: 'Just one line.' }).pause_ms, 0);
});

test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
