const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const model = vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '..', 'recommendation-model.js'), 'utf8')}\n({validateProfile, calculateRecommendation, hostingTier, searchTier})`
);
const example = {
  objects: 5000, users: 3, locales: 4, channels: 4, attributes: 500,
  localized: 0, scoped: 0, both: 0, docKb: 100
};

test('the requested profile recommends Start while separately planning a search upgrade', () => {
  const result = model.calculateRecommendation(example);
  assert.equal(result.hosting, 'start');
  assert.equal(result.search, 'plan');
  assert.equal(result.fields, 500);
  assert.equal(result.cells, 2500000);
  assert.ok(Math.abs(result.hostingLoad - 0.4166666666666667) < 1e-12);
  assert.equal(result.searchLoad, 0.6);
});

test('offer and search thresholds use the original calculator strict comparisons', () => {
  assert.equal(model.hostingTier(0.499999), 'start');
  assert.equal(model.hostingTier(0.5), 'business');
  assert.equal(model.hostingTier(0.799999), 'business');
  assert.equal(model.hostingTier(0.8), 'flex');
  assert.equal(model.searchTier(0.599999), 'suitable');
  assert.equal(model.searchTier(0.6), 'plan');
  assert.equal(model.searchTier(0.899999), 'plan');
  assert.equal(model.searchTier(0.9), 'upgrade');
});

test('each attribute category is counted once and combined attributes multiply both dimensions', () => {
  const result = model.calculateRecommendation({ ...example, localized: 100, scoped: 50, both: 25 });
  assert.equal(result.common, 325);
  assert.equal(result.fields, 1325);
  assert.equal(result.hosting, 'business');
  assert.equal(result.mappingReview, true);
  const combined = model.calculateRecommendation({ ...example, both: 500 });
  assert.equal(combined.fields, 8000);
  assert.equal(combined.hosting, 'flex');
  assert.equal(combined.search, 'upgrade');
});

test('document size can trigger search review without upgrading hosting', () => {
  const result = model.calculateRecommendation({ ...example, attributes: 100, docKb: 3000 });
  assert.equal(result.hosting, 'start');
  assert.equal(result.search, 'upgrade');
  assert.ok(result.indexGb > 10);
});

test('recommendations and displayed indices agree with the existing calculator', () => {
  const original = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const hostingLabels = { start: 'Standard ok', business: 'Business testen', flex: 'Managed Flex' };
  const searchLabels = { suitable: 'Hobbyist-2 ok', plan: 'Startup-4 planen', upgrade: 'Startup-4 nötig' };
  for (const changes of [{}, { objects: 15000 }, { objects: 30000 }, { both: 500 }, { attributes: 100, docKb: 3000 }]) {
    const profile = { ...example, ...changes };
    const values = {
      prod: profile.objects, attSimple: profile.attributes - profile.localized - profile.scoped - profile.both,
      attLoc: profile.localized, attScope: profile.scoped, attBoth: profile.both,
      loc: profile.locales, chan: profile.channels, users: profile.users, docKb: profile.docKb
    };
    const elements = new Map();
    const document = {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: values[id], style: {} });
        return elements.get(id);
      },
      querySelectorAll() { return []; }
    };
    vm.runInNewContext(original, { document });
    const result = model.calculateRecommendation(profile);
    assert.equal(elements.get('outL').textContent, result.hostingLoad.toFixed(2));
    assert.equal(elements.get('outO').textContent, result.searchLoad.toFixed(2));
    assert.equal(elements.get('badgeL').textContent, hostingLabels[result.hosting]);
    assert.equal(elements.get('badgeO').textContent, searchLabels[result.search]);
  }
});

test('invalid, fractional, overflowing and inconsistent inputs cannot produce recommendations', () => {
  for (const changes of [
    { objects: NaN }, { objects: -1 }, { users: 0 }, { locales: 1.5 },
    { channels: Infinity }, { attributes: -1 }, { localized: 501 },
    { localized: 300, scoped: 201 }, { docKb: 0 }, { docKb: Infinity },
    { objects: Number.MAX_SAFE_INTEGER }, { docKb: Number.MAX_VALUE }
  ]) {
    const profile = { ...example, ...changes };
    assert.ok(model.validateProfile(profile).length > 0, JSON.stringify(changes));
    assert.throws(() => model.calculateRecommendation(profile), { name: 'RangeError' });
  }
});
