const assert = require('node:assert/strict');
const {test} = require('node:test');
const {loadExtension} = require('./load-extension.cjs');

test('the panel retries the accepted job through the background worker', async () => {
  const profile = {connected: true, email: 'test@example.test', deviceId: 'jd-1'};
  const nodes = new Map();
  function element() {
    return {
      dataset: {}, children: [], events: {},
      addEventListener(event, handler) { this.events[event] = handler; },
      replaceChildren(message, ...children) { this.textContent = message; this.children = children; }
    };
  }
  function byId(id) {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  }

  let onMessage;
  let selected = ['https://example.test/manual.pdf'];
  let sends = 0;
  const retried = [];
  const getURL = path => 'chrome-extension://test/' + path;
  loadExtension(['background.js', 'jd-panel.js'], {
    byId, document: {createElement: element}, importScripts() {}, setTimeout, clearTimeout,
    selectedUrls: () => selected, refreshControls() {},
    JDLocation: {forTarget() {}, reset() {}},
    JDAccount: {
      info: async () => profile,
      send: async () => {
        sends++;
        return {jobId: 12, target: 'Test JD', startError: 'JDownloader timeout'};
      },
      resumeJob: async (id, target) => {
        retried.push(id);
        assert.equal(target.deviceId, profile.deviceId);
        return {jobId: id, target: 'Test JD', count: 2, active: 1};
      }
    },
    chrome: {
      sidePanel: {setPanelBehavior: async () => {}},
      storage: {onChanged: {addListener() {}}},
      runtime: {
        getURL, onMessage: {addListener: listener => { onMessage = listener; }},
        sendMessage: request => new Promise(resolve => {
          assert.equal(onMessage(request, {url: getURL('panel.html')}, resolve), true);
        })
      }
    }
  });

  await byId('jd-download').events.click();
  const message = byId('jd-status');
  assert.match(message.textContent, /Link diterima/);
  const [retry] = message.children;
  selected = [];
  await retry.events.click();
  assert.equal(sends, 1);
  assert.deepEqual(retried, [12]);
  assert.match(message.textContent, /2 file di Downloads/);
});
