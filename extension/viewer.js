const byId = id => document.getElementById(id);

(() => {
  let queue = 'downloads';
  const expanded = new Set();
  let snapshot, timer, revision = 0, reading = false, failure = '';
  const selected = new Map();
  function selectionCount() {
    byId('bulk').hidden = !selected.size;
    byId('bulk').disabled = Boolean(failure);
    byId('bulk').textContent = 'Kelola pilihan (' + selected.size + ')';
  }
  const table = byId('queue-table');
  const rows = byId('packages');
  const tools = viewerTools(restart);
  const collecting = () => queue === 'collector';

  function cell(row, value) {
    const td = row.insertCell();
    if (value != null) td.textContent = value;
    return td;
  }
  function eta(seconds) {
    if (!(seconds > 0)) return '—';
    const minutes = Math.floor(seconds / 60);
    return minutes >= 60 ? Math.floor(minutes / 60) + ' j ' + minutes % 60 + ' m'
      : minutes ? minutes + ' m' : seconds + ' dtk';
  }
  function label(item, child) {
    if (item.enabled === false) return 'Nonaktif';
    if (collecting()) {
      if (child) return item.availability || 'Belum diperiksa';
      return [item.onlineCount && item.onlineCount + ' online', item.offlineCount && item.offlineCount + ' offline']
        .filter(Boolean).join(' · ') || 'Di LinkGrabber';
    }
    return item.status || (item.finished ? 'Selesai' : item.skipped ? 'Dilewati' : item.running ? 'Mengunduh' : 'Dalam antrean');
  }
  function rowFor(item, child) {
    const row = document.createElement('tr');
    const first = cell(row);
    const key = (child ? 'f' : 'p') + item.uuid;
    const check = document.createElement('input');
    check.type = 'checkbox'; check.dataset.focus = 'select-' + key;
    check.checked = selected.has(key); check.disabled = !(Number.isSafeInteger(item.uuid) && item.uuid > 0);
    check.setAttribute('aria-label', 'Pilih ' + item.name);
    check.onchange = () => {
      if (check.checked) selected.set(key, {id: item.uuid, child}); else selected.delete(key);
      selectionCount();
    };
    if (child) {
      row.className = 'child';
      first.textContent = item.name;
    } else {
      const button = document.createElement('button');
      button.dataset.focus = 'pkg-' + item.uuid;
      button.setAttribute('aria-expanded', expanded.has(item.uuid));
      button.textContent = item.name || 'Paket';
      button.onclick = () => {
        if (expanded.has(item.uuid)) expanded.delete(item.uuid);
        else expanded.add(item.uuid);
        render(); restart();
      };
      const detail = document.createElement('small');
      detail.textContent = [Number.isFinite(item.childCount) && item.childCount + ' file', item.saveTo].filter(Boolean).join(' · ');
      first.append(button, detail);
    }
    first.prepend(check);
    cell(row, label(item, child));
    cell(row, Number.isFinite(item.bytesTotal) && item.bytesTotal >= 0 ? bytes(item.bytesTotal) : '—');
    const percent = item.finished ? 100 : item.bytesTotal > 0 && Number.isFinite(item.bytesLoaded) && item.bytesLoaded >= 0
      ? Math.min(100, Math.floor(100 * item.bytesLoaded / item.bytesTotal)) : null;
    const progress = cell(row, percent === null ? '—' : percent + '%');
    if (!collecting() && percent !== null) {
      const bar = document.createElement('progress'); bar.max = 100; bar.value = percent;
      bar.setAttribute('aria-label', 'Progres ' + item.name); progress.append(bar);
    }
    cell(row, item.speed > 0 ? bytes(item.speed) + '/s' : '—');
    cell(row, eta(item.eta));
    const action = document.createElement('button');
    action.className = 'row-menu'; action.textContent = 'Kelola';
    action.setAttribute('aria-label', 'Kelola ' + item.name);
    action.dataset.focus = (child ? 'link-' : 'manage-') + item.uuid;
    action.disabled = Boolean(failure) || !Number.isSafeInteger(item.uuid) || item.uuid <= 0;
    action.onclick = () => tools.item(snapshot.target, queue, item, child);
    cell(row).append(action);
    return row;
  }
  function render() {
    const data = snapshot;
    const needle = byId('search').value.trim().toLowerCase();
    const packages = (data?.packages || []).filter(p => [p.name, p.saveTo].some(s => s?.toLowerCase().includes(needle)));
    const links = new Map();
    for (const link of data?.links || []) {
      if (!links.has(link.packageUUID)) links.set(link.packageUUID, []);
      links.get(link.packageUUID).push(link);
    }
    const focused = rows.contains(document.activeElement) && document.activeElement.dataset.focus;
    const fragment = document.createDocumentFragment();
    for (const pkg of packages) {
      fragment.append(rowFor(pkg, false));
      if (expanded.has(pkg.uuid)) {
        for (const link of links.get(pkg.uuid) || []) fragment.append(rowFor(link, true));
      }
    }
    const visible = new Set([...fragment.querySelectorAll('input[type=checkbox]')].map(c => c.dataset.focus.slice(7)));
    for (const k of selected.keys()) if (!visible.has(k)) selected.delete(k);
    selectionCount();
    rows.replaceChildren(fragment);
    if (focused) rows.querySelector('[data-focus="' + CSS.escape(focused) + '"]')?.focus({preventScroll: true});
    table.hidden = !packages.length; byId('select-visible').hidden = table.hidden;
    table.classList.toggle('collector', collecting());
    byId('summary').textContent = data ? packages.length + (needle ? ' / ' + data.packages.length : '') + ' paket' : '';
    const desktop = byId('native-gui');
    desktop.hidden = !data?.desktopURL;
    if (data?.desktopURL) desktop.href = data.desktopURL; else desktop.removeAttribute('href');
    byId('device').textContent = data ? data.target.name || data.target.deviceId : '';
    byId('engine-state').textContent = data?.engine ? 'Mesin unduhan · ' + data.engine : 'Mesin unduhan';
    const count = (data?.dialog ? 1 : 0) + (data?.captchas?.length || 0);
    byId('attention').hidden = !count;
    byId('attention').textContent = 'Perlu jawaban (' + count + ')';
    byId('notice').textContent = failure || (data ? packages.length ? '' : needle ? 'Tidak ada paket yang cocok.' : 'Antrean ini kosong.'
      : 'Hubungkan JDownloader di Pengaturan.');
    for (const button of document.querySelectorAll('[data-engine], #device-tools, #add-links, #attention')) {
      button.disabled = !data || Boolean(failure);
    }
  }
  async function refresh() {
    if (reading || document.hidden) return;
    reading = true;
    const current = revision;
    let delay = 2000;
    try {
      const data = await JDAccount.queueSnapshot(queue, new Set(expanded));
      if (current !== revision) return;
      snapshot = data; failure = ''; render();
      byId('updated').textContent = data ? 'Diperbarui ' + new Date().toLocaleTimeString('id-ID') : '';
      if (!data) delay = 0;
    } catch (error) {
      if (current !== revision) return;
      failure = 'Gagal memperbarui · ' + (error.code === 'OFFLINE' ? 'Perangkat offline' : error.message);
      render(); delay = 10000;
    } finally {
      reading = false;
      if (!document.hidden && (delay || current !== revision)) timer = setTimeout(refresh, current === revision ? delay : 0);
    }
  }
  function restart() { revision++; clearTimeout(timer); refresh(); }
  function reset() {
    snapshot = null; expanded.clear(); selected.clear(); failure = 'Memuat antrean…';
    tools.close(); byId('updated').textContent = ''; byId('jd-status').textContent = '';
    render(); restart();
  }
  for (const key of ['downloads', 'collector']) byId(key).onclick = () => {
    if (key === queue) return;
    byId(queue).setAttribute('aria-pressed', false); queue = key;
    byId(queue).setAttribute('aria-pressed', true); reset();
  };
  let controlling = false;
  for (const button of document.querySelectorAll('[data-engine]')) button.onclick = async () => {
    const target = snapshot?.target;
    if (controlling || !target) return;
    const cmd = button.dataset.engine;
    if (cmd === 'stop' && !confirm('Hentikan antrean unduhan pada ' + (target.name || target.deviceId) + '?')) return;
    controlling = true;
    try {
      const isPause = ['pause', 'resume'].includes(cmd);
      const result = await JDAccount.viewerCall(target, '/downloadcontroller/' + (isPause ? 'pause' : cmd), isPause ? [cmd === 'pause'] : []);
      if (result === false) throw Error('Perangkat menolak perintah.');
      byId('jd-status').textContent = 'Perintah diterima · ' + button.textContent;
    } catch (error) { byId('jd-status').textContent = error.message; }
    controlling = false; restart();
  };
  byId('device-tools').onclick = () => tools.device(snapshot.target);
  byId('attention').onclick = () => tools.attention(snapshot.target, snapshot.dialog, snapshot.captchas);
  byId('add-links').onclick = () => tools.add(snapshot.target);
  byId('bulk').onclick = () => tools.batch(snapshot.target, queue, [...selected.values()]);
  byId('select-visible').onclick = () => {
    const checks = [...rows.querySelectorAll('input[type=checkbox]:enabled')];
    const select = checks.some(c => !c.checked);
    for (const c of checks) { c.checked = select; c.onchange(); }
  };
  byId('search').oninput = render;
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[JDAccount.key];
    if (area !== 'local' || !change) return;
    const {oldValue, newValue} = change;
    if (oldValue?.email !== newValue?.email || oldValue?.deviceId !== newValue?.deviceId ||
        Boolean(oldValue?.session) !== Boolean(newValue?.session)) reset();
  });
  document.addEventListener('visibilitychange', restart);
  reset();
})();
