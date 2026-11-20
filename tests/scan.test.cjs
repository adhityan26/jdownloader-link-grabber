const assert = require('node:assert/strict');
const {test} = require('node:test');
const {loadExtension} = require('./load-extension.cjs');

const base = 'https://example.test/';

function scanAnchors(...anchors) {
  const nodes = anchors.map(attributes => ({
    baseURI: base,
    localName: 'a',
    textContent: 'Manual',
    getAttribute: name => attributes[name] ?? null,
    hasAttribute: name => Object.hasOwn(attributes, name),
    matches: selector => selector.startsWith('a, area') || selector.includes('[href]'),
    querySelector: () => null
  }));
  const document = {URL: base, title: 'Manual', querySelector: () => null, querySelectorAll: () => nodes};
  return loadExtension(['filenames.js', 'scan.js'], {URL, document}).result;
}

test('a download anchor uses href before a generic data URL', () => {
  const links = scanAnchors({href: '/manual.pdf', 'data-url': '/preview', download: 'manual.pdf'});
  assert.equal(links.length, 1);
  assert.equal(links[0].url, base + 'manual.pdf');
});

test('a dedicated download URL still takes precedence', () => {
  const links = scanAnchors({href: '/preview', 'data-download-url': '/manual.pdf', download: 'manual.pdf'});
  assert.equal(links.length, 1);
  assert.equal(links[0].url, base + 'manual.pdf');
});

test('a duplicate anchor can supply an explicit filename', () => {
  const links = scanAnchors({href: '/manual.pdf'}, {href: '/manual.pdf', download: 'Petunjuk.pdf'});
  assert.equal(links.length, 1);
  assert.equal(links[0].filename, 'Petunjuk.pdf');
});
