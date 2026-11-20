const JDLocation = (() => {
  const dialog = byId('location-dialog');
  const opener = byId('location-open');
  const input = byId('location-path');
  const base = byId('mount-base');
  const note = byId('location-note');
  const editor = byId('subfolder-form');
  const folderName = byId('subfolder-name');
  let knownPaths = [];
  let target;
  let chosen = '';
  let revision = 0;

  function reset() {
    chosen = '';
    opener.textContent = 'Folder: Ikuti JDownloader';
  }
  function forTarget(profile) {
    if (chosen && (profile.deviceId !== target?.deviceId || profile.email !== target?.email)) {
      throw Error('Perangkat tujuan berubah. Pilih ulang folder download.');
    }
    return chosen || undefined;
  }
  function join(parent, name) {
    const separator = parent.startsWith('/') ? '/' : '\\';
    return (parent.endsWith(separator) ? parent : parent + separator) + name;
  }

  function choosePath(path) {
    editor.hidden = true;
    input.setCustomValidity('');
    input.value = path;
    input.focus();
  }
  function pickButton(name, path) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet';
    button.textContent = name;
    button.title = path;
    button.addEventListener('click', () => choosePath(path));
    return button;
  }

  // Each branch lists its children only when expanded, including mounted directories.
  function branch(name, path, children) {
    const item = document.createElement('div');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = name;
    summary.title = path;
    const list = document.createElement('div');
    list.className = 'folder-children';
    details.append(summary, list);
    const pick = pickButton('Pilih', path);
    pick.setAttribute('aria-label', 'Pilih ' + path);
    item.className = 'folder-branch';
    item.append(details, pick);
    let loaded = false;
    details.addEventListener('toggle', async () => {
      if (!details.open || loaded) return;
      loaded = true;
      list.textContent = 'Memuat folder…';
      try {
        const rows = await children();
        list.replaceChildren(...rows);
        if (!rows.length) list.textContent = 'Tidak ada subfolder.';
      } catch {
        loaded = false;
        list.textContent = 'Folder gagal dibaca. Periksa mount lalu tutup dan buka lagi.';
      }
    });
    return item;
  }

  function addSubfolder(parent) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet add-subfolder';
    button.textContent = '+ Subfolder';
    button.setAttribute('aria-label', 'Tambah subfolder di ' + parent);
    button.addEventListener('click', () => {
      byId('subfolder-parent').textContent = parent;
      folderName.value = '';
      folderName.setCustomValidity('');
      editor.hidden = false;
      folderName.focus();
    });
    return button;
  }

  function historyTree(paths, reveal) {
    const roots = new Map();
    for (const path of paths.filter(MyJD.isAbsoluteFolder)) {
      const windows = !path.startsWith('/');
      const root = windows ? path.match(/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/)[0].replace(/\//g, '\\') : '/';
      const parts = path.slice(root.length).split(windows ? /[\\/]+/ : /\/+/).filter(Boolean);
      let nodes = roots;
      let full = root;
      for (const name of [root, ...parts]) {
        if (nodes !== roots) full = join(full, name);
        if (!nodes.has(name)) nodes.set(name, {name, path: full, children: new Map()});
        nodes = nodes.get(name).children;
      }
    }
    function rows(nodes) {
      return [...nodes.values()].sort((a,b) => a.name.localeCompare(b.name)).map(node => {
        if (node.children.size) {
          const row = branch(node.name, node.path, () => rows(node.children));
          row.append(addSubfolder(node.path));
          if (reveal?.startsWith(join(node.path, ''))) row.querySelector('details').open = true;
          return row;
        }
        const row = document.createElement('div');
        row.className = 'folder-leaf';
        row.append(pickButton(node.name, node.path), addSubfolder(node.path));
        return row;
      });
    }
    return rows(roots);
  }

  function renderHistory(saved, reveal) {
    const tree = historyTree([...knownPaths, ...saved], reveal);
    byId('location-history').replaceChildren(...(tree.length ? tree : ['Belum ada folder dalam riwayat.']));
  }
  async function savePath(path, submitter) {
    const current = revision;
    submitter.disabled = true;
    try {
      const saved = await JDAccount.saveFolder(path, target);
      if (current !== revision || !dialog.open) return;
      renderHistory(saved, path);
      choosePath(path);
      note.textContent = 'Tujuan tersimpan. Klik Gunakan folder ini untuk pengiriman ini.';
    } catch (error) {
      if (current === revision && dialog.open) note.textContent = error.message;
    } finally {
      submitter.disabled = false;
    }
  }
  folderName.addEventListener('input', () => folderName.setCustomValidity(''));
  byId('subfolder-cancel').addEventListener('click', () => { editor.hidden = true; input.focus(); });
  editor.addEventListener('submit', event => {
    event.preventDefault();
    const parent = byId('subfolder-parent').textContent;
    const name = folderName.value.trim();
    if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f]/.test(name) ||
        (!parent.startsWith('/') && /[<>:"|?*]|[. ]$/.test(name))) {
      folderName.setCustomValidity('Masukkan satu nama folder yang valid.');
      folderName.reportValidity();
      return;
    }
    savePath(join(parent, name), editor.querySelector('[type=submit]'));
  });
  byId('save-manual-path').addEventListener('click', event => {
    if (valid(input)) savePath(input.value.trim(), event.currentTarget);
  });

  function mountedDirectory(handle, path) {
    return branch(handle.name, path, async () => {
      const dirs = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'directory') dirs.push(entry);
      }
      return dirs.sort((a,b) => a.name.localeCompare(b.name)).map(dir => mountedDirectory(dir, join(path, dir.name)));
    });
  }
  function valid(field) {
    field.setCustomValidity(MyJD.isAbsoluteFolder(field.value.trim()) ? '' : 'Masukkan path absolut pada perangkat JDownloader.');
    return field.reportValidity();
  }
  for (const field of [input, base]) field.addEventListener('input', () => field.setCustomValidity(''));
  base.addEventListener('input', () => byId('mount-tree').replaceChildren());
  byId('mount-open').addEventListener('click', async () => {
    if (!valid(base)) return;
    const path = base.value.trim();
    const current = revision;
    try {
      const handle = await window.showDirectoryPicker({mode: 'read', id: 'jdownloader-share'});
      if (current !== revision || !dialog.open || base.value.trim() !== path) return;
      const root = mountedDirectory(handle, path);
      byId('mount-tree').replaceChildren(root);
      root.querySelector('details').open = true;
    } catch (error) {
      if (current === revision && error.name !== 'AbortError') note.textContent = 'Pemilih folder tidak tersedia. Gunakan riwayat atau ketik path tujuan.';
    }
  });
  opener.addEventListener('click', async () => {
    const current = ++revision;
    dialog.showModal();
    editor.hidden = true;
    knownPaths = [];
    input.value = chosen;
    input.setCustomValidity('');
    byId('location-history').replaceChildren();
    byId('location-default-path').textContent = '';
    byId('mount-options').hidden = typeof window.showDirectoryPicker !== 'function';
    note.textContent = 'Membaca folder perangkat…';
    try {
      const profile = await JDAccount.info();
      if (current !== revision || !dialog.open) return;
      if (!profile.connected || !profile.deviceId) throw Error('Hubungkan akun dan pilih perangkat di Pengaturan.');
      target = profile;
      const result = await JDAccount.folders(profile);
      if (current !== revision || !dialog.open) return;
      byId('location-default-path').textContent = result.defaultPath;
      if (!base.value && MyJD.isAbsoluteFolder(result.defaultPath)) base.value = result.defaultPath;
      knownPaths = [...result.history, result.defaultPath];
      renderHistory(result.saved || []);
      note.textContent = result.warnings.join(' ');
    } catch (error) {
      if (current === revision && dialog.open) note.textContent = error.message;
    }
  });
  byId('location-cancel').addEventListener('click', () => dialog.close());
  byId('location-default').addEventListener('click', () => { reset(); dialog.close(); });
  byId('location-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!target) { note.textContent = 'Pilih perangkat JDownloader di Pengaturan terlebih dahulu.'; return; }
    if (!valid(input)) return;
    chosen = input.value.trim();
    opener.textContent = 'Folder: ' + chosen;
    dialog.close();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[JDAccount.key]) return;
    const {oldValue, newValue} = changes[JDAccount.key];
    if (newValue?.session && newValue.deviceId === oldValue?.deviceId && newValue.email === oldValue?.email) return;
    revision++;
    target = null;
    reset();
    base.value = '';
    byId('mount-tree').replaceChildren();
    if (dialog.open) dialog.close();
  });
  return {reset, forTarget};
})();
