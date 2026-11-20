(() => {
  const section = byId('jd-progress');
  const list = byId('jd-files');
  const note = byId('jd-progress-note');
  let timer;
  let revision = 0;
  let reading = false;
  let starting = new Set();
  const showDialog = mountJDDialog(restart);

  async function startFile(link, target, button) {
    const pending = starting;
    if (pending.has(link.uuid)) return;
    pending.add(link.uuid);
    button.disabled = true;
    button.textContent = 'Memulai…';
    try {
      const reply = await chrome.runtime.sendMessage({action: 'jd-start-link', uuid: link.uuid, target});
      if (!reply?.ok) throw Error(reply?.message || 'Perintah mulai belum terkonfirmasi.');
      if (starting === pending) byId('jd-status').textContent = (link.name || 'File') + ' sudah di Downloads.';
    } catch (error) {
      if (starting === pending) byId('jd-status').textContent = (link.name || 'File') + ' · ' + error.message;
    } finally {
      pending.delete(link.uuid);
      restart();
    }
  }

  function fileRow(link, target) {
    const row = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = link.name || 'File ' + link.uuid;
    row.append(name);
    let state;
    if (link.collected) {
      state = link.availability === 'OFFLINE' ? 'LinkGrabber · File offline' : 'Di LinkGrabber';
    } else if (link.finished) state = 'Selesai';
    else if (link.skipped) state = 'Dilewati';
    else if (link.enabled === false) state = 'Dinonaktifkan';
    else if (link.running) state = 'Mengunduh';
    else state = link.status || 'Dalam antrean';

    const details = [state];
    if (link.status && link.status !== state) details.push(link.status);
    const loaded = link.bytesLoaded;
    const total = link.bytesTotal;
    if (!link.collected) {
      const percent = link.finished ? 100 : total > 0 && loaded >= 0
        ? Math.min(100, Math.floor(100 * loaded / total)) : null;
      if (percent !== null || link.running) {
        const bar = document.createElement('progress');
        bar.setAttribute('aria-label', 'Progres ' + name.textContent);
        bar.max = 100;
        if (percent !== null) {
          bar.value = percent;
          details.push(percent + '%');
        }
        row.append(bar);
      }
      if (loaded >= 0 && Number.isFinite(loaded)) {
        details.push(bytes(loaded) + (total > 0 ? ' / ' + bytes(total) : ''));
      }
      if (link.running && link.speed > 0) details.push(bytes(link.speed) + '/s');
    }
    const text = document.createElement('div');
    text.textContent = details.join(' · ');
    row.append(text);
    if (link.enabled !== false && !link.running && !link.finished && !link.skipped && link.availability !== 'OFFLINE') {
      const button = document.createElement('button');
      button.dataset.file = String(link.uuid);
      button.disabled = starting.has(link.uuid);
      button.textContent = button.disabled ? 'Memulai…' : 'Mulai';
      button.setAttribute('aria-label', 'Mulai unduhan ' + name.textContent);
      button.addEventListener('click', () => startFile(link, target, button));
      row.append(button);
    }
    return row;
  }

  async function refresh() {
    if (reading || document.hidden) return;
    reading = true;
    const current = revision;
    let delay = 0;
    try {
      const snapshot = await JDAccount.transfers();
      if (current !== revision) return;
      const files = snapshot?.files;
      showDialog(snapshot?.dialog, snapshot?.target);
      section.hidden = !snapshot;
      byId('jd-idle').hidden = Boolean(snapshot);
      if (!snapshot) byId('jd-idle').textContent = 'Kirim file dari Hasil scan untuk melihat status unduhannya.';
      byId('transfer-total').textContent = files?.length || '';
      const focusedFile = list.contains(document.activeElement) ? document.activeElement.dataset.file : null;
      list.replaceChildren(...(files || []).map(file => fileRow(file, snapshot.target)));
      if (focusedFile) list.querySelector('button[data-file="' + CSS.escape(focusedFile) + '"]')?.focus({preventScroll: true});
      note.textContent = files?.length === 0
        ? 'Belum ada file dari kiriman ini di LinkGrabber atau Downloads.' : '';
      if (files) delay = snapshot.dialog || !files.length || files.some(file => !file.finished) ||
        byId('jd-send').dataset.busy === 'true' ? 4000 : 15000;
    } catch (error) {
      if (current !== revision) return;
      showDialog(null);
      section.hidden = false;
      byId('jd-idle').hidden = true;
      note.textContent = 'Status belum bisa diperbarui. ' +
        (error.code === 'OFFLINE' ? 'Perangkat offline.' : error.message);
      delay = 15000;
    } finally {
      reading = false;
      if (!document.hidden && (delay || current !== revision)) {
        timer = setTimeout(refresh, current === revision ? delay : 0);
      }
    }
  }

  function restart() {
    revision++;
    clearTimeout(timer);
    refresh();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[JDAccount.key]) return;
    const {oldValue, newValue} = changes[JDAccount.key];
    if (oldValue?.email !== newValue?.email || oldValue?.deviceId !== newValue?.deviceId || !newValue?.session) {
      starting = new Set();
      showDialog(null);
      section.hidden = true;
      byId('jd-idle').hidden = false;
      byId('jd-idle').textContent = 'Memuat status JDownloader…';
      byId('transfer-total').textContent = '';
      list.replaceChildren();
      note.textContent = '';
    }
    restart();
  });
  document.addEventListener('visibilitychange', restart);
  refresh();
})();
