const assert = require('node:assert/strict');
const {test} = require('node:test');
const {loadExtension} = require('./load-extension.cjs');

const target = {email: 'test@example.test', deviceId: 'jd-1', deviceName: 'Test JD'};
const urls = ['https://example.test/manual.pdf'];

function setup(options = {}) {
  let profile = {...target, session: {sessiontoken: 'initial'}, ...options.profile};
  let tail = Promise.resolve();
  const {get} = loadExtension(['jd-account.js'], {
    navigator: {locks: {request: (_key, task) => {
      const result = tail.then(task);
      tail = result.catch(() => {});
      return result;
    }}},
    chrome: {storage: {local: {
      setAccessLevel: async () => {},
      get: async key => ({[key]: structuredClone(profile)}),
      set: async records => { profile = structuredClone(records['myjd.profile']); }
    }}},
    MyJD: options.myjd ?? {},
    firstJDDialog: options.firstJDDialog ?? (async () => null),
    startCollectedJob: options.startCollectedJob
  });
  return {account: get('JDAccount'), readProfile: () => profile};
}

test('a stale device picker cannot overwrite the current account selection', async () => {
  const {account, readProfile} = setup();
  await assert.rejects(account.choose('old-device', 'Old JD', {...target, email: 'old@example.test'}), /berubah/i);
  assert.equal(readProfile().deviceId, 'jd-1');
  await account.choose('jd-2', 'Second JD', target);
  assert.equal(readProfile().deviceId, 'jd-2');
});

test('a start failure preserves the accepted job and retry starts that job only', async () => {
  let submissions = 0;
  const attempts = [];
  const {account, readProfile} = setup({
    myjd: {addLinks: async () => ({id: ++submissions})},
    startCollectedJob: async id => {
      attempts.push(id);
      if (attempts.length === 1) throw Error('JDownloader timeout');
      return {count: 1, active: 1};
    }
  });
  const reply = await account.send(urls, true, target);
  assert.equal(reply.jobId, 1);
  assert.match(reply.startError, /timeout/);
  assert.deepEqual(readProfile().trackedJobs['jd-1'], [1]);
  const resumed = await account.resumeJob(reply.jobId, target);
  assert.equal(resumed.active, 1);
  assert.equal(submissions, 1);
  assert.deepEqual(attempts, [1, 1]);
  await assert.rejects(account.resumeJob(1000, target), /terlacak/i);
});

test('tracking retains active and unresolved jobs when trimming completed history', async () => {
  const tracked = Array.from({length: 104}, (_, index) => index + 1);
  const {account, readProfile} = setup({
    profile: {trackedJobs: {'jd-1': tracked}},
    myjd: {
      addLinks: async () => ({id: 105}),
      deviceCall: async (_session, _device, endpoint, [query]) => {
        if (endpoint === '/linkgrabberv2/queryLinkCrawlerJobs') return [{jobId: 3, crawling: true}];
        if (endpoint === '/linkgrabberv2/queryLinks') return [{jobUUID: 3, uuid: 300}];
        assert.equal(endpoint, '/downloadsV2/queryLinks');
        return query.jobUUIDs.filter(id => id > 2).map(id => ({jobUUID: id, uuid: id, finished: true}))
          .concat([{jobUUID: 1, uuid: 1, finished: false, running: true}]);
      }
    }
  });
  await account.send(urls, false, target);
  assert.equal(readProfile().trackedJobs['jd-1'].length, 105);
  const snapshot = await account.transfers();
  assert.equal(snapshot.files.find(file => file.uuid === 1)?.running, true);
  assert.deepEqual(readProfile().trackedJobs['jd-1'].slice(0, 4), [1, 2, 3, 6]);
  assert.equal(readProfile().trackedJobs['jd-1'].at(-1), 105);
});

test('a slow optional viewer request does not hold the account lock', async () => {
  const entered = Promise.withResolvers();
  const pending = Promise.withResolvers();
  const {account} = setup({
    myjd: {deviceCall: async (_session, _device, endpoint) => endpoint.endsWith('queryPackages') ? [] : null},
    firstJDDialog: () => { entered.resolve(); return pending.promise; }
  });
  const snapshot = account.queueSnapshot('downloads', new Set());
  await entered.promise;
  const info = account.info();
  try {
    const first = await Promise.race([info, new Promise(resolve => setImmediate(() => resolve(null)))]);
    assert.equal(first?.deviceId, 'jd-1');
  } finally {
    pending.resolve(null);
    await Promise.all([snapshot, info]);
  }
});

test('concurrent expired reads share one session rotation', async () => {
  let reconnects = 0;
  const {account, readProfile} = setup({
    profile: {session: {sessiontoken: 'initial', regaintoken: 'regain', deviceSecret: 'secret'}},
    myjd: {
      reconnect: async () => { reconnects++; return {sessiontoken: 'new'}; },
      deviceCall: async (session, _device, endpoint) => {
        if (session.sessiontoken === 'initial') throw Object.assign(Error('Expired'), {code: 'TOKEN_INVALID'});
        return endpoint.endsWith('queryPackages') ? [] : null;
      }
    }
  });
  const snapshots = await Promise.all([account.queueSnapshot('downloads', new Set()), account.queueSnapshot('collector', new Set())]);
  assert(snapshots.every(snapshot => snapshot.target.deviceId === 'jd-1'));
  assert.equal(readProfile().session.sessiontoken, 'new');
  assert.equal(reconnects, 1);
});
