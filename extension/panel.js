const byId = id => document.getElementById(id);
const mode = byId('mode');
const statusText = byId('status');
const results = byId('results');
const resolveButton = byId('resolve');
const copyButton = byId('copy');
const manual = byId('manual');
const filterForm = byId('filters');
const selectAll = byId('select-all');
let filters = readFilters(filterForm);
let session = new AbortController();
let entries = [];
let batchRunning = false;
const viewTabs = [byId('scan-tab'), byId('downloads-tab')];
const scrollPositions = new Map();
function openView(tab) {
  const workspace = document.querySelector('.workspace');
  const previous = viewTabs.find(item => item.getAttribute('aria-selected') === 'true');
  scrollPositions.set(previous.id, workspace.scrollTop);
  for (const item of viewTabs) {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    byId(item.getAttribute('aria-controls')).hidden = !active;
  }
  statusText.hidden = tab !== viewTabs[0];
  refreshControls();
  workspace.scrollTop = scrollPositions.get(tab.id) || 0;
}
for (const tab of viewTabs) {
  tab.addEventListener('click', () => openView(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'Home') next = viewTabs[0];
    else if (event.key === 'End') next = viewTabs[1];
    else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) next = viewTabs.find(item => item !== tab);
    else return;
    event.preventDefault();
    openView(next);
    next.focus();
  });
}

function inScanMode(entry) {
  if (mode.value === 'video') return entry.isVideo;
  return mode.value === 'all' || entry.isFile;
}

function updateDropdowns() {
  const domains = new Set();
  const extensions = new Set();
  for (const entry of entries) {
    if (!inScanMode(entry)) continue;
    domains.add(entry.sourceFields.host);
    if (entry.targetFields) domains.add(entry.targetFields.host);
    const ext = extensionOf(entry);
    if (ext) extensions.add(ext);
  }
  const domain = filterForm.elements.namedItem('domain');
  const selected = domain.value;
  const hosts = [...domains].sort();
  if (Array.from(domain.options).slice(1).map(option => option.value).join() !== hosts.join()) {
    domain.replaceChildren(new Option('Semua domain', ''), ...hosts.map(host => new Option(host, host)));
    domain.value = domains.has(selected) ? selected : '';
  }
  const options = byId('extension-options');
  const types = [...extensions].sort();
  if (Array.from(options.querySelectorAll('input'), box => box.value).join() !== types.join()) {
    options.replaceChildren(...types.map(type => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.name = 'extensions';
      box.value = type;
      box.checked = filters.extensions.includes(type);
      label.append(box, ' .' + type);
      return label;
    }));
  }
  filters = readFilters(filterForm);
}

function refreshControls() {
  byId('extension-summary').textContent = filters.extensions.length
    ? filters.extensions.map(ext => '.' + ext).join(', ') : 'Semua ekstensi';
  let visible = 0;
  let checked = 0;
  let visibleChecked = 0;
  let canResolve = false;
  let busy = false;
  let selectedBusy = false;
  for (const entry of entries) {
    const show = inScanMode(entry) && matchesFilters(entry, filters);
    entry.row.hidden = !show;
    if (show) {
      visible++;
      if (entry.pick.checked) visibleChecked++;
      if (entry.state === 'new' || entry.state === 'error') canResolve = true;
    }
    if (entry.pick.checked) checked++;
    if (entry.state === 'busy') {
      busy = true;
      if (entry.pick.checked) selectedBusy = true;
    }
  }
  selectAll.disabled = !visible;
  selectAll.checked = visible > 0 && visibleChecked === visible;
  selectAll.indeterminate = visibleChecked > 0 && visibleChecked < visible;
  copyButton.disabled = !checked || selectedBusy;
  const jdDisabled = copyButton.disabled || byId('jd-send').dataset.busy === 'true';
  byId('jd-send').disabled = jdDisabled;
  byId('jd-download').disabled = jdDisabled;
  byId('location-open').disabled = byId('jd-send').dataset.busy === 'true';
  resolveButton.disabled = busy || batchRunning || !canResolve;
  const hiddenChecked = checked - visibleChecked;
  byId('visible-count').textContent = '(' + visible + ')';
  byId('result-total').textContent = entries.filter(inScanMode).length;
  const activeFilters = [filters.name, filters.domain, filters.path, filters.state, filters.extensions.length].filter(Boolean).length;
  byId('filter-count').textContent = activeFilters ? '(' + activeFilters + ')' : '';
  byId('selection-actions').hidden = !checked || byId('scan-view').hidden;
  byId('counts').textContent = checked + ' link dipilih' +
    (hiddenChecked ? ' (' + hiddenChecked + ' di luar filter)' : '');
  byId('empty').hidden = !entries.length || visible > 0;
}

function selectedUrls() {
  return [...new Set(entries.filter(entry => entry.pick.checked).map(entry => entry.final || entry.original))];
}

async function copyUrls() {
  const signal = session.signal;
  const urls = selectedUrls();
  if (!urls.length) return;
  const text = urls.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    if (!signal.aborted) statusText.textContent = urls.length + ' URL disalin ke clipboard.';
  } catch {
    if (signal.aborted) return;
    manual.value = text;
    manual.hidden = false;
    manual.focus();
    manual.select();
    statusText.textContent = 'Tekan ⌘C atau Ctrl+C untuk menyalin URL yang dipilih.';
  }
}

async function resolveEntry(entry, signal) {
  if (signal.aborted || entry.state === 'busy' || entry.state === 'direct' || entry.state === 'redirected') return;
  entry.state = 'busy';
  entry.button.disabled = true;
  entry.label.textContent = 'Memeriksa…';
  manual.hidden = true;
  refreshControls();
  try {
    const result = await checkRedirect(entry.original, signal);
    if (signal.aborted) return;
    entry.final = result.url;
    if (result.filename) showName(entry, result.filename);
    entry.state = result.redirected ? 'redirected' : 'direct';
    if (result.redirected) entry.targetFields = urlFields(result.url);
    updateDropdowns();
    entry.label.textContent = result.redirected ? 'Dialihkan' : 'Langsung';
    entry.button.hidden = true;
    if (result.redirected) {
      entry.destination.textContent = 'Tujuan: ' + result.url;
      entry.destination.hidden = false;
    }
  } catch (error) {
    if (signal.aborted) return;
    entry.state = 'error';
    const reason = /^HTTP \d{3}$/.test(error.message) ? error.message : 'jaringan atau timeout';
    entry.label.textContent = 'Gagal · ' + reason;
    entry.button.textContent = 'Coba lagi';
    entry.button.disabled = false;
  } finally {
    if (!signal.aborted) refreshControls();
  }
}

function showName(entry, filename) {
  entry.filename = filename;
  entry.displayName = filename || entry.title || 'Link ' + entry.number;
  entry.name.textContent = entry.displayName;
  entry.caption.textContent = entry.title;
  entry.caption.hidden = !entry.title || entry.title === entry.name.textContent;
}

function addEntry({ url: original, filename, title, isFile, isVideo }, index) {
  const row = byId('row').content.firstElementChild.cloneNode(true);
  row.querySelector('.original').textContent = original;
  const entry = {
    row, original, title, isFile, isVideo, initialFilename: filename, sourceFields: urlFields(original),
    pick: row.querySelector('.pick'), number: index + 1, caption: row.querySelector('.caption'),
    state: 'new', name: row.querySelector('.name'), label: row.querySelector('.state'),
    button: row.querySelector('button'), destination: row.querySelector('.final')
  };
  row.querySelector('.host').textContent = entry.sourceFields.host;
  entry.pick.addEventListener('change', selectionChanged);
  showName(entry, filename);
  entry.label.textContent = 'Belum dicek';
  entry.button.addEventListener('click', () => {
    if (!batchRunning) return resolveEntry(entry, session.signal);
  });
  results.append(row);
  return entry;
}

async function scan() {
  session.abort();
  session = new AbortController();
  const signal = session.signal;
  batchRunning = false;
  entries = [];
  results.replaceChildren();
  byId('source').textContent = '';
  manual.hidden = true;
  refreshControls();
  statusText.textContent = 'Memindai tab aktif…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [frame] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['filenames.js', 'scan.js'] });
    if (signal.aborted) return;
    byId('source').textContent = tab.title || tab.url || '';
    byId('source').title = byId('source').textContent;
    entries = frame.result.map(addEntry);
    updateDropdowns();
    refreshControls();
    if (!entries.length) {
      statusText.textContent = 'Tidak ada link yang cocok di halaman ini.';
      return;
    }
    statusText.textContent = '';
  } catch {
    if (!signal.aborted) {
      updateDropdowns();
      refreshControls();
      statusText.textContent = 'Tab ini tidak bisa dipindai. Buka halaman situs lalu klik Scan tab aktif.';
    }
  }
}

async function resolveAll() {
  const signal = session.signal;
  const targets = entries.filter(entry => !entry.row.hidden && (entry.state === 'new' || entry.state === 'error'));
  const queue = targets.values();
  batchRunning = true;
  refreshControls();
  statusText.textContent = 'Memeriksa tujuan redirect…';
  async function worker() {
    for (const entry of queue) {
      if (signal.aborted) return;
      await resolveEntry(entry, signal);
    }
  }
  await Promise.all(Array.from({ length: Math.min(targets.length, 4) }, worker));
  if (signal.aborted) return;
  batchRunning = false;
  refreshControls();
  const failed = targets.filter(entry => entry.state === 'error').length;
  statusText.textContent = failed ? failed + ' gagal dicek. URL asal dipakai untuk link tersebut.' : 'Pengecekan selesai. Salin URL untuk memakai hasil terbaru.';
}

function selectionChanged() {
  manual.hidden = true;
  statusText.textContent = '';
  refreshControls();
}

function applyFilters() {
  filters = readFilters(filterForm);
  selectionChanged();
}

selectAll.addEventListener('change', () => {
  for (const entry of entries) {
    if (!entry.row.hidden) entry.pick.checked = selectAll.checked;
  }
  selectionChanged();
});

filterForm.addEventListener('input', applyFilters);
filterForm.addEventListener('reset', () => setTimeout(applyFilters, 0));
filterForm.addEventListener('submit', event => event.preventDefault());
mode.addEventListener('change', () => {
  updateDropdowns();
  selectionChanged();
});
byId('scan').addEventListener('click', scan);
resolveButton.addEventListener('click', resolveAll);
copyButton.addEventListener('click', copyUrls);
window.addEventListener('pagehide', () => session.abort());
scan();
