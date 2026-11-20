const assert = require('node:assert/strict');
const {test} = require('node:test');
const {loadExtension} = require('./load-extension.cjs');

function setup() {
  const requests = [];
  const {get} = loadExtension(['myjd.js'], {
    URL, TextEncoder, TextDecoder, AbortSignal,
    fetch: async (url, options) => {
      requests.push({url, body: JSON.parse(options.body)});
      return {ok: true, json: async () => ({data: {id: 12}})};
    }
  });
  return {api: get('MyJD'), requests};
}

test('hoster credential changes require HTTPS or HTTP loopback', async () => {
  const {api, requests} = setup();
  const endpoint = '/accountsV2/addAccount';
  const args = ['example.test', 'tester', 'fixture-password'];
  await assert.rejects(api.localCall('http://192.0.2.10:3128', endpoint, args), /HTTPS/);
  await assert.rejects(api.localCall('http://192.0.2.10:3128', '/accountsV2/setUserNameAndPassword', [1, ...args.slice(1)]), /HTTPS/);
  assert.equal(requests.length, 0);
  await api.localCall('https://192.0.2.10:3128', endpoint, args);
  await api.localCall('http://127.0.0.1:3128', endpoint, args);
  await api.localCall('http://[::1]:3128', endpoint, args);
  await api.localCall('http://192.0.2.10:3128', '/downloadcontroller/getCurrentState', []);
  assert.equal(requests.length, 4);
});

test('tracked and untracked link requests share folder rules', async () => {
  const {api, requests} = setup();
  const origin = 'http://127.0.0.1:3128';
  await api.addLinks({localOrigin: origin}, origin, ['https://example.test/manual.pdf'], '/downloads');
  assert.deepEqual(requests[0].body.params, [{
    links: 'https://example.test/manual.pdf', autostart: false, assignJobID: true,
    destinationFolder: '/downloads', overwritePackagizerRules: true
  }]);
  const actual = api.buildAddLinksQuery('https://example.test/manual.pdf', '/downloads');
  assert.deepEqual(structuredClone(actual), {
    links: 'https://example.test/manual.pdf', autostart: false,
    destinationFolder: '/downloads', overwritePackagizerRules: true
  });
  assert.throws(() => api.buildAddLinksQuery('https://example.test/manual.pdf', 'relative'), /absolut/);
});
