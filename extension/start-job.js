async function forceDownloadLinks(ids, call) {
  const accepted = await call('/downloadsV2/forceDownload', [ids, []]);
  if (!accepted) throw Error('File masuk ke Downloads, tetapi JDownloader menolak perintah mulai.');
}

// The selected file may already have moved to Downloads in another client.
async function startTrackedLink(uuid, jobUUIDs, call) {
  if (!Number.isSafeInteger(uuid) || uuid <= 0 || !jobUUIDs?.length) throw Error('File tidak terlacak.');
  const query = {jobUUIDs, maxResults: -1};
  const collected = await call('/linkgrabberv2/queryLinks', [query]);
  if (collected.some(link => link.uuid === uuid)) {
    await call('/linkgrabberv2/moveToDownloadlist', [[uuid], []]);
  }
  for (let attempt = 0; attempt < 7; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 800));
    const downloads = await call('/downloadsV2/queryLinks', [{...query, running: true, finished: true}]);
    const file = downloads.find(link => link.uuid === uuid);
    if (!file) continue;
    if (!file.running && !file.finished) await forceDownloadLinks([uuid], call);
    return;
  }
  throw Error('File belum ditemukan di Downloads. Periksa status terbarunya di panel.');
}

// Job IDs scope both queries. Only the link UUIDs returned for this job can be moved or started.
async function startCollectedJob(jobId, call) {
  const startedAt = Date.now();
  let until = startedAt + 90000;
  // Allow time to answer a device prompt, while keeping the background request bounded.
  const hardLimit = startedAt + 240000;
  let nextDialogCheck = startedAt + 10000;
  const query = {jobUUIDs: [jobId], maxResults: -1};
  const moved = new Set();
  const started = new Set();
  let settled = 0;
  while (Date.now() < Math.min(until, hardLimit)) {
    const jobs = await call('/linkgrabberv2/queryLinkCrawlerJobs', [{jobIds: [jobId], collectorInfo: true}]);
    const crawling = jobs.some(job => job.jobId === jobId && (job.crawling || job.checking));
    const collected = await call('/linkgrabberv2/queryLinks', [query]);
    const ids = collected.map(link => link.uuid);
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('ID link LinkCollector tidak valid.');
    const toMove = ids.filter(id => !moved.has(id));
    if (toMove.length) {
      await call('/linkgrabberv2/moveToDownloadlist', [toMove, []]);
      toMove.forEach(id => moved.add(id));
    }

    const downloads = await call('/downloadsV2/queryLinks', [{...query, running: true, finished: true}]);
    if (downloads.some(link => !Number.isSafeInteger(link.uuid) || link.uuid <= 0)) throw Error('ID link Downloads tidak valid.');
    const toStart = downloads.filter(link => !link.running && !link.finished && !started.has(link.uuid)).map(link => link.uuid);
    if (toStart.length) {
      await forceDownloadLinks(toStart, call);
      toStart.forEach(id => started.add(id));
    }
    const confirmed = new Set(downloads.map(link => link.uuid));
    const allMoved = [...moved].every(id => confirmed.has(id));
    settled = !crawling && !ids.length && downloads.length && allMoved ? settled + 1 : 0;
    if (settled >= 2) {
      return {count: downloads.length, active: downloads.filter(link => link.running || link.finished).length};
    }
    if ((!downloads.length || crawling) && Date.now() >= nextDialogCheck) {
      const dialog = await firstJDDialog(call).catch(() => undefined);
      if (dialog?.deep) {
        until = Date.now() + 90000;
      }
      nextDialogCheck = Date.now() + 10000;
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw Error('Periksa dialog dan LinkGrabber di viewer JDownloader. Jika file muncul di tab Unduhan, klik Mulai.');
}

async function startViewerSelection(ids, target) {
  if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(group => Array.isArray(group) &&
      group.every(id => Number.isSafeInteger(id) && id > 0)) || !ids.some(group => group.length)) {
    throw Error('Pilihan paket atau file tidak valid.');
  }
  const call = (path, args) => JDAccount.viewerCall(target, path, args);
  const links = new Set(ids[0]);
  if (ids[1].length) {
    const packages = new Set(ids[1]);
    const members = await call('/linkgrabberv2/queryLinks', [{packageUUIDs: ids[1], maxResults: -1}]);
    for (const f of members) if (packages.has(f.packageUUID) && Number.isSafeInteger(f.uuid) && f.uuid > 0) links.add(f.uuid);
  }
  if (!links.size) throw Error('Pilihan sudah dipindah atau kosong.');
  await call('/linkgrabberv2/moveToDownloadlist', [[...links], []]);
  for (let i = 0; i < 8 && links.size; i++) {
    if (i) await new Promise(resolve => setTimeout(resolve, 600));
    const files = await call('/downloadsV2/queryLinks', [{running: true, finished: true, maxResults: -1}]);
    const found = files.filter(f => links.has(f.uuid));
    const ready = found.filter(f => !f.running && !f.finished).map(f => f.uuid);
    if (ready.length) await forceDownloadLinks(ready, call);
    for (const f of found) links.delete(f.uuid);
  }
  return links.size ? 'Sudah dipindah. Periksa Downloads untuk file yang belum terkonfirmasi.'
    : 'File sudah masuk ke Downloads dan perintah mulai diterima.';
}
