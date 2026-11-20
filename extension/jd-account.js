// A single profile per extension installation. Serialize token rotation, logout and sends across windows.
const JDAccount = (() => {
  const key = 'myjd.profile';
  const completedJobLimit = 100;
  function locked(task) {
    return navigator.locks.request(key, async () => {
      await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
      let profile = (await chrome.storage.local.get(key))[key];
      if (!profile) {
        const {id} = await chrome.windows.getCurrent();
        const legacyKey = 'myjd.window.' + id;
        const legacy = (await chrome.storage.session.get(legacyKey))[legacyKey];
        profile = {email: '', deviceId: legacy?.deviceId || '', deviceName: '', session: legacy || null};
        if (legacy) {
          await save(profile);
          await chrome.storage.session.remove(legacyKey);
        }
      }
      return task(profile);
    });
  }
  const save = profile => chrome.storage.local.set({[key]: profile});
  const targetOf = profile => ({email: profile.email, deviceId: profile.deviceId, name: profile.deviceName});
  const sameTarget = (profile, target) => profile.email === target?.email && profile.deviceId === target?.deviceId;
  function requireTarget(profile, target, message = 'Akun atau perangkat tujuan berubah.') {
    if (!profile.session || !sameTarget(profile, target)) throw Error(message);
  }
  const expired = error => ['SESSION', 'TOKEN_INVALID'].includes(error.code);
  const renewDenied = error => expired(error) || error.code === 'AUTH_FAILED';
  const expiredMessage = () => Error('Sesi MyJDownloader berakhir. Login kembali di Pengaturan.');
  async function clearSession(profile) {
    profile.session = null;
    await save(profile);
    throw expiredMessage();
  }
  async function renewSession(profile) {
    const old = profile.session;
    if (!old?.regaintoken || !old.deviceSecret) return clearSession(profile);
    try {
      profile.session = await MyJD.reconnect(old);
    } catch (error) {
      if (!renewDenied(error)) throw error;
      return clearSession(profile);
    }
    await save(profile);
    return profile.session;
  }
  async function authenticated(profile, action, updateSession = task => task(profile)) {
    const initial = profile.session;
    if (!initial) throw Error('Login dulu di Pengaturan MyJDownloader.');
    try {
      return await action(initial);
    } catch (error) {
      if (!expired(error)) throw error;
    }
    const fresh = await updateSession(current => {
      if (!current.session) throw expiredMessage();
      return current.session.sessiontoken === initial.sessiontoken ? renewSession(current) : current.session;
    });
    profile.session = fresh;
    try {
      return await action(fresh);
    } catch (error) {
      if (!renewDenied(error)) throw error;
      return updateSession(current => {
        if (current.session?.sessiontoken === fresh.sessiontoken) return clearSession(current);
        throw expiredMessage();
      });
    }
  }

  function callDevice(profile, path, args, updateSession) {
    return authenticated(profile, session => MyJD.deviceCall(session, profile.deviceId, path, args), updateSession);
  }
  function readDevice(profile) {
    const target = targetOf(profile);
    const updateSession = task => locked(current => {
      requireTarget(current, target);
      return task(current);
    });
    return (path, args) => callDevice(profile, path, args, updateSession);
  }

  function login(email, password) {
    email = email.trim().toLowerCase();
    return locked(async profile => {
      if (profile.session?.localOrigin) throw Error('Pilih Kembali ke MyJDownloader sebelum login.');
      const session = await MyJD.connect(email, password);
      if (profile.email && profile.email !== email) {
        profile.deviceId = '';
        profile.deviceName = '';
        delete profile.trackedJobs;
        delete profile.savedFolders;
        delete profile.desktopURLs;
      }
      await save({...profile, email, session});
    });
  }
  function connectLAN(input) {
    return locked(async profile => {
      const origin = MyJD.localOrigin(input.trim());
      const result = await MyJD.localCall(origin, '/downloadcontroller/getCurrentState', []);
      if (typeof result !== 'string' || !result) throw Error('Perangkat JDownloader tidak terdeteksi.');
      if (profile.session?.localOrigin === origin) return;
      const backup = 'myjd.cloud';
      const savedKey = 'myjd.lan.' + origin;
      const saved = (await chrome.storage.local.get(savedKey))[savedKey] || {};
      const changes = {[key]: {...saved, email: '', deviceId: origin, deviceName: origin, session: {localOrigin: origin}}};
      if (profile.session?.localOrigin) changes['myjd.lan.' + profile.deviceId] = profile;
      else changes[backup] = profile;
      await chrome.storage.local.set(changes);
    });
  }
  function useCloud() {
    return locked(async profile => {
      if (!profile.session?.localOrigin) return;
      const saved = (await chrome.storage.local.get('myjd.cloud'))['myjd.cloud'];
      await chrome.storage.local.set({['myjd.lan.' + profile.deviceId]: profile,
        [key]: saved || {email: '', deviceId: '', deviceName: '', session: null}});
      await chrome.storage.local.remove('myjd.cloud');
    });
  }
  function setDesktopURL(target, input) {
    return locked(async profile => {
      requireTarget(profile, target);
      let value = '';
      if (input.trim()) {
        const url = new URL(input.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Gunakan URL HTTP atau HTTPS tanpa kredensial.');
        value = url.href;
      }
      profile.desktopURLs = {...profile.desktopURLs, [profile.deviceId]: value};
      await save(profile);
    });
  }
  function viewerCall(target, path, args = []) {
    return locked(profile => {
      requireTarget(profile, target, 'Perangkat berubah. Muat ulang daftar perangkat.');
      return callDevice(profile, path, args);
    });
  }
  function devices(target) {
    return locked(profile => {
      requireTarget(profile, target);
      return profile.session.localOrigin ? [{id: profile.deviceId, name: profile.deviceName}]
        : authenticated(profile, session => MyJD.devices(session));
    });
  }
  function choose(deviceId, deviceName, target) {
    return locked(async profile => {
      requireTarget(profile, target);
      if (profile.session.localOrigin) throw Error('Pilih koneksi MyJDownloader sebelum mengganti perangkat.');
      await save({...profile, deviceId, deviceName});
    });
  }
  function folders(expected) {
    return locked(async profile => {
      requireTarget(profile, expected);
      const read = (path, args) => callDevice(profile, path, args);
      // A device can support adding links even if either lookup is unavailable.
      const warnings = [];
      const defaultPath = await read('/config/get', ['org.jdownloader.settings.GeneralSettings', null, 'DefaultDownloadFolder'])
        .catch(() => { warnings.push('Path default belum bisa dibaca.'); return ''; });
      const history = await read('/linkgrabberv2/getDownloadFolderHistorySelectionBase', [])
        .catch(() => { warnings.push('Riwayat folder belum bisa dibaca.'); return []; });
      return {defaultPath: typeof defaultPath === 'string' ? defaultPath : '', history: Array.isArray(history) ? history : [],
        saved: profile.savedFolders?.[profile.deviceId] || [], warnings};
    });
  }
  function saveFolder(path, expected) {
    return locked(async profile => {
      requireTarget(profile, expected);
      if (!MyJD.isAbsoluteFolder(path)) throw Error('Path tujuan harus absolut.');
      profile.savedFolders ??= {};
      const paths = profile.savedFolders[profile.deviceId] || [];
      if (!paths.includes(path)) {
        profile.savedFolders[profile.deviceId] = [...paths, path];
        await save(profile);
      }
      return profile.savedFolders[profile.deviceId];
    });
  }
  async function send(urls, autostart, expected, destinationFolder) {
    const submission = await locked(async profile => {
      requireTarget(profile, expected, 'Perangkat tujuan atau akun berubah. Periksa tujuan lalu kirim ulang.');
      if (!profile.deviceId) throw Error('Pilih perangkat tujuan di Pengaturan MyJDownloader.');
      const job = await authenticated(profile, session => MyJD.addLinks(session, profile.deviceId, urls, destinationFolder));
      profile.trackedJobs ??= {};
      const previous = profile.trackedJobs[profile.deviceId] || [];
      profile.trackedJobs[profile.deviceId] = [...new Set([...previous, job.id])];
      await save(profile);
      return {jobId: job.id, target: profile.deviceName || profile.deviceId};
    });
    return autostart ? startSubmission(submission, expected) : submission;
  }
  async function resumeJob(jobId, target) {
    const submission = await locked(profile => {
      requireTarget(profile, target);
      if (!profile.trackedJobs?.[profile.deviceId]?.includes(jobId)) throw Error('Kiriman ini sudah tidak terlacak.');
      return {jobId, target: profile.deviceName || profile.deviceId};
    });
    return startSubmission(submission, target);
  }
  async function startSubmission(submission, target) {
    try {
      const result = await startCollectedJob(submission.jobId, (path, args) => viewerCall(target, path, args));
      return {...submission, ...result};
    } catch (error) {
      return {...submission, startError: error.message || 'JDownloader gagal memulai unduhan.'};
    }
  }
  async function trimCompletedJobs(target, jobUUIDs, jobs, collected, downloads) {
    if (!Array.isArray(jobs) || [...collected, ...downloads].some(link => !Number.isSafeInteger(link.jobUUID))) return;
    const unfinished = new Set(jobs.filter(job => job.crawling || job.checking).map(job => job.jobId));
    const finished = new Set();
    for (const link of collected) unfinished.add(link.jobUUID);
    for (const link of downloads) {
      (link.finished === true && !link.running ? finished : unfinished).add(link.jobUUID);
    }
    const candidates = jobUUIDs.filter(id => finished.has(id) && !unfinished.has(id));
    const remove = new Set(candidates.slice(0, Math.max(0, candidates.length - completedJobLimit)));
    if (!remove.size) return;
    await locked(async profile => {
      if (!profile.session || !sameTarget(profile, target)) return;
      const current = profile.trackedJobs?.[profile.deviceId];
      if (!current?.some(id => remove.has(id))) return;
      profile.trackedJobs[profile.deviceId] = current.filter(id => !remove.has(id));
      await save(profile);
    });
  }
  async function transfers() {
    const profile = await locked(profile => profile);
    const jobUUIDs = profile.trackedJobs?.[profile.deviceId];
    if (!profile.session || !jobUUIDs?.length) return null;
    const target = targetOf(profile);
    const call = readDevice(profile);
    const trimHistory = jobUUIDs.length > completedJobLimit;
    const query = {jobUUIDs, maxResults: -1, enabled: true, bytesTotal: true, ...(trimHistory ? {jobUUID: true} : {})};
    const jobs = trimHistory
      ? await call('/linkgrabberv2/queryLinkCrawlerJobs', [{jobIds: jobUUIDs}]).catch(() => null)
      : null;
    const collected = await call('/linkgrabberv2/queryLinks', [{...query, availability: true}]);
    const downloads = await call('/downloadsV2/queryLinks', [{
      ...query, bytesLoaded: true, finished: true, running: true, skipped: true, speed: true, status: true
    }]);
    if (trimHistory) await trimCompletedJobs(target, jobUUIDs, jobs, collected, downloads);
    const files = new Map(collected.map(link => [link.uuid, {...link, collected: true}]));
    for (const link of downloads) files.set(link.uuid, link);
    const dialog = await firstJDDialog(call).catch(() => undefined);
    return {files: [...files.values()], dialog, target};
  }
  async function queueSnapshot(queue, expandedIds) {
    const profile = await locked(profile => profile);
    if (!profile.session || !profile.deviceId) return null;
    const collector = queue === 'collector';
    const namespace = collector ? '/linkgrabberv2/' : '/downloadsV2/';
    const call = readDevice(profile);
    const fields = {maxResults: -1, enabled: true, bytesTotal: true, priority: true};
    const progress = collector ? {} : {bytesLoaded: true, running: true, finished: true, speed: true, eta: true, status: true};
    const packages = await call(namespace + 'queryPackages', [{...fields, ...progress, childCount: true, saveTo: true,
      ...(collector ? {availableOnlineCount: true, availableOfflineCount: true} : {})}]);
    const packageUUIDs = packages.filter(pkg => expandedIds.has(pkg.uuid)).map(pkg => pkg.uuid);
    const links = packageUUIDs.length ? await call(namespace + 'queryLinks', [{...fields, ...progress, packageUUIDs,
      ...(collector ? {availability: true, variantID: true} : {skipped: true})}]) : [];
    const [dialog, engine, captchas] = await Promise.all([
      firstJDDialog(call).catch(() => undefined),
      call('/downloadcontroller/getCurrentState', []).catch(() => null),
      call('/captcha/list', []).catch(() => [])
    ]);
    return {packages, links, dialog, engine, captchas, desktopURL: profile.desktopURLs?.[profile.deviceId], target: targetOf(profile)};
  }
  function answerDeepDialog(id, reason, target) {
    return locked(async profile => {
      requireTarget(profile, target, 'Konfirmasi atau perangkat tujuan berubah.');
      if (!['ok', 'cancel'].includes(reason)) throw Error('Jawaban dialog tidak valid.');
      const call = (path, args) => callDevice(profile, path, args);
      const dialog = await firstJDDialog(call);
      if (!dialog?.deep || dialog.id !== id) throw Error('Dialog ini sudah ditutup atau diganti.');
      await call('/dialogs/answer', [id, {closereason: reason}]);
    });
  }
  function startLink(uuid, target) {
    return locked(profile => {
      requireTarget(profile, target, 'Tujuan berubah. Pilih file dari daftar terbaru.');
      return startTrackedLink(uuid, profile.trackedJobs?.[profile.deviceId], (path, args) =>
        callDevice(profile, path, args));
    });
  }
  function logout() {
    return locked(async profile => {
      if (profile.session?.localOrigin) throw Error('Gunakan Kembali ke MyJDownloader untuk berpindah dari mode LAN.');
      // Keep an empty record so old per-window sessions cannot restore this login.
      await save({email: '', deviceId: '', deviceName: '', session: null});
      if (profile.session) {
        try { await MyJD.disconnect(profile.session); }
        catch (error) { if (!expired(error)) throw Error('Data login lokal dihapus. Pemutusan sesi di server belum terkonfirmasi.'); }
      }
    });
  }
  function info() {
    return locked(({email, deviceId, deviceName, session, desktopURLs}) => ({email, deviceId, deviceName, desktopURL: desktopURLs?.[deviceId] || '', connected: Boolean(session), lan: Boolean(session?.localOrigin)}));
  }
  return {key, setDesktopURL, connectLAN, useCloud, viewerCall, login, devices, choose, folders, saveFolder, send, resumeJob, transfers, queueSnapshot, startLink, answerDeepDialog, logout, info};
})();
