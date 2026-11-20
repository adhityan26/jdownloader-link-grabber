const assert = require('node:assert/strict');
const {test} = require('node:test');
const {loadExtension} = require('./load-extension.cjs');

test('the variant menu preselects the current API variant', async () => {
  const nodes = new Map();
  function element(tag, textContent = '') {
    return {
      tag, textContent, children: [],
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener() {},
      add(option) { this.append(option); }
    };
  }
  const box = element('dialog');
  box.showModal = () => { box.open = true; };
  nodes.set('toolbox', box);
  function byId(id) {
    if (!nodes.has(id)) nodes.set(id, element(id));
    return nodes.get(id);
  }

  const {get} = loadExtension(['viewer-tools.js'], {
    byId, document: {createElement: element},
    Option: function (text, value) { Object.assign(this, {text, value}); },
    JDAccount: {viewerCall: async () => [{id: 'low', name: '480p'}, {id: 'high', name: '1080p'}]}
  });
  get('viewerTools(() => {})').item({deviceId: 'jd-1'}, 'collector', {uuid: 23, name: 'Video', variant: {id: 'high'}}, true);
  await new Promise(resolve => setImmediate(resolve));
  const body = byId('tool-body');
  body.children.find(node => node.textContent === 'Varian file / kualitas video').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(body.children[0].children[0].children[0].value, 'high');
});
