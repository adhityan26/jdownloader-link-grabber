// Each open dialog is bound to the device and selection that opened it.
function viewerTools(refresh) {
  const box = byId('toolbox'), body = byId('tool-body'), status = byId('tool-status');
  let generation = 0;
  function close() { generation++; if (box.open) box.close(); body.replaceChildren(); }
  byId('close-tool').onclick = close;
  box.addEventListener('cancel', () => { generation++; body.replaceChildren(); });
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  }
  function page(title, target, build) {
    const current = ++generation;
    body.replaceChildren(); status.textContent = '';
    byId('tool-title').textContent = title;
    if (!box.open) box.showModal();
    let working = false;
    const alive = () => generation === current && box.open;
    const call = async (path, args = []) => {
      if (!alive()) throw Error('Tampilan sudah berubah.');
      const result = await JDAccount.viewerCall(target, path, args);
      if (!alive()) throw Error('Tampilan sudah berubah.');
      return result;
    };
    async function run(fn) {
      if (working || !alive()) return;
      working = true; body.inert = true; status.textContent = 'Memproses…';
      try {
        const message = await fn();
        if (alive()) status.textContent = typeof message === 'string' ? message : '';
      } catch (error) { if (alive()) status.textContent = error.message; }
      finally { if (alive()) body.inert = false; working = false; }
    }
    body.inert = false;
    const button = (label, action, parent = body) => {
      const b = element('button', label);
      b.type = 'button'; b.onclick = () => run(action); parent.append(b); return b;
    };
    const apply = async (path, args) => {
      const result = await call(path, args);
      if (result === false) throw Error('JDownloader menolak perubahan.');
      refresh();
      return 'Perintah diterima JDownloader.';
    };
    const form = (caption, names, onSubmit) => {
      const f = element('form'), inputs = [];
      names.forEach(({label, type = 'text', value = '', required = true, options}) => {
        const wrapper = element('label', label);
        const field = element(options ? 'select' : type === 'textarea' ? 'textarea' : 'input');
        if (options) options.forEach(([id, name]) => field.add(new Option(name, id)));
        else if (type !== 'textarea') field.type = type;
        field.required = required; field.value = value;
        wrapper.append(field); f.append(wrapper); inputs.push(field);
      });
      f.append(element('button', caption));
      f.onsubmit = e => { e.preventDefault(); run(() => onSubmit(...inputs.map(i => i.value))); };
      body.append(f);
      return f;
    };
    run(() => build({call, apply, button, form, alive}));
  }

  function add(target) {
    page('Tambah link', target, ({form, apply, button}) => {
      form('Kirim ke LinkGrabber', [{label: 'URL, satu per baris', type: 'textarea'}, {label: 'Folder tujuan (opsional)', required: false}],
        async (links, path) => {
          links = links.trim();
          if (!links) throw Error('Isi setidaknya satu link.');
          await apply('/linkgrabberv2/addLinks', [MyJD.buildAddLinksQuery(links, path.trim())]);
          close(); byId('jd-status').textContent = 'Link dikirim ke LinkGrabber.';
        });
      const label = element('label', 'Impor container link');
      const file = element('input'); file.type = 'file'; file.accept = '.dlc,.ccf,.rsdf';
      label.append(file); body.append(label);
      button('Impor ke LinkGrabber', async () => {
        const selected = file.files[0];
        if (!selected) throw Error('Pilih file DLC, CCF atau RSDF.');
        const ext = selected.name.split('.').pop().toLowerCase();
        if (!['dlc', 'ccf', 'rsdf'].includes(ext)) throw Error('Format container tidak didukung.');
        const url = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(Error('File tidak dapat dibaca.'));
          reader.readAsDataURL(selected);
        });
        await apply('/linkgrabberv2/addContainer', [ext, url]);
        close(); byId('jd-status').textContent = selected.name + ' dikirim ke LinkGrabber.';
      });
    });
  }
  async function moveAndStart(target, ids) {
    const reply = await chrome.runtime.sendMessage({action: 'viewer-start', target, ids});
    if (!reply?.ok) throw Error(reply?.message || 'Perintah mulai belum terkonfirmasi.');
    refresh();
    return reply.result;
  }
  function downloadActions(target, queue, ids, {button, apply}, startLabel) {
    if (queue === 'collector') {
      button('Pindah ke Downloads', () => apply('/linkgrabberv2/moveToDownloadlist', ids));
      button('Download langsung', () => moveAndStart(target, ids));
    } else button(startLabel, () => apply('/downloadsV2/forceDownload', ids));
  }
  function batch(target, queue, selected) {
    const ids = [selected.filter(x => x.child).map(x => x.id), selected.filter(x => !x.child).map(x => x.id)];
    if (!ids.some(group => group.length)) return;
    const prefix = queue === 'collector' ? '/linkgrabberv2/' : '/downloadsV2/';
    page('Kelola ' + selected.length + ' pilihan', target, ({button, apply}) => {
      downloadActions(target, queue, ids, {button, apply}, 'Mulai pilihan');
      button('Aktifkan pilihan', () => apply(prefix + 'setEnabled', [true, ...ids]));
      button('Nonaktifkan pilihan', () => apply(prefix + 'setEnabled', [false, ...ids]));
      button('Hapus pilihan dari antrean', async () => {
        if (!confirm('Hapus ' + selected.length + ' pilihan dari antrean?')) return;
        await apply(prefix + 'removeLinks', ids); close();
      });
    });
  }
  function item(target, queue, entry, child) {
    const collector = queue === 'collector';
    const prefix = collector ? '/linkgrabberv2/' : '/downloadsV2/';
    const ids = child ? [[entry.uuid], []] : [[], [entry.uuid]];
    const context = collector ? 'LGC' : 'DLC';
    page(entry.name || 'Kelola pilihan', target, ({button, apply, call, form}) => {
      downloadActions(target, queue, ids, {button, apply}, 'Mulai unduhan ini');
      button(entry.enabled === false ? 'Aktifkan' : 'Nonaktifkan', () => apply(prefix + 'setEnabled', [entry.enabled === false, ...ids]));
      form('Simpan nama', [{label: 'Nama ' + (child ? 'file' : 'paket'), value: entry.name}],
        name => apply(prefix + (child ? 'renameLink' : 'renamePackage'), [entry.uuid, name.trim()]));
      if (!child) form('Simpan folder', [{label: 'Folder tujuan pada perangkat', value: entry.saveTo}], path => {
        if (!MyJD.isAbsoluteFolder(path.trim())) throw Error('Masukkan path absolut.');
        return apply(prefix + 'setDownloadDirectory', [path.trim(), ids[1]]);
      });
      const priorities = ['HIGHEST', 'HIGHER', 'HIGH', 'DEFAULT', 'LOW', 'LOWER', 'LOWEST'];
      form('Atur prioritas', [{label: 'Prioritas', options: priorities.map(k => [k, k]), value: entry.priority || 'DEFAULT'}],
        priority => apply(prefix + 'setPriority', [priority, ...ids]));
      if (collector && child) button('Varian file / kualitas video', async () => {
        const variants = await call(prefix + 'getVariants', [entry.uuid]);
        if (!variants?.length) return 'Plugin tidak menawarkan varian untuk file ini.';
        page('Varian · ' + entry.name, target, ({form, apply}) => form('Terapkan varian', [{
          label: 'Varian', value: entry.variant?.id || variants[0].id, options: variants.map(v => [v.id, v.name])
        }], id => apply(prefix + 'setVariant', [entry.uuid, id])));
      });
      if (!collector) button('Ekstrak arsip', async () => {
        const result = await call('/extraction/startExtractionNow', ids);
        return Object.values(result || {}).some(Boolean) ? 'Ekstraksi dimulai.' : 'Tidak ada arsip yang dapat diekstrak.';
      });
      button('Aksi lain dari perangkat', async () => {
        const menu = await call('/ui/getMenu', [context]);
        const actions = [];
        function visit(node, path) {
          if (node.children?.length) node.children.forEach(n => visit(n, [...path, node.name].filter(Boolean)));
          else if (node.id && node.name) actions.push([node.id, [...path, node.name].join(' / ')]);
        }
        visit(menu, []);
        if (!actions.length) return 'Perangkat tidak menyediakan aksi tambahan.';
        page(entry.name, target, ({form, call}) => form('Jalankan aksi', [{label: 'Menu perangkat', options: actions, value: actions[0][0]}], async id => {
          const name = actions.find(a => a[0] === id)[1];
          if (!confirm(name + ' untuk ' + entry.name + '?')) return;
          const result = await call('/ui/invokeAction', [context, id, ...ids]);
          refresh();
          return result == null ? 'Perintah diterima.' : JSON.stringify(result);
        }));
      });
      button('Hapus dari antrean', async () => {
        if (!confirm('Hapus ' + entry.name + ' dari ' + (collector ? 'LinkGrabber' : 'Downloads') + '?')) return;
        await apply(prefix + 'removeLinks', ids); close();
      });
    });
  }
  function config(target, plugins = false) {
    const prefix = plugins ? '/plugins/' : '/config/';
    page(plugins ? 'Pengaturan plugin hoster' : 'Pengaturan lanjutan', target, async ({call, button}) => {
      const entries = plugins ? await call('/plugins/query', [{pattern: '.*'}]) : await call('/config/list');
      const search = element('input'); search.type = 'search'; search.placeholder = 'Cari pengaturan, mis. Packagizer';
      search.setAttribute('aria-label', search.placeholder);
      const results = element('section'); body.append(search, results);
      function draw() {
        const q = search.value.trim().toLowerCase();
        const found = entries.filter(e => (e.interfaceName + ' ' + (e.storage || '') + ' ' + e.key).toLowerCase().includes(q));
        results.replaceChildren(element('p', found.length + ' pengaturan' + (found.length > 75 ? ' · 75 pertama ditampilkan' : '')));
        for (const e of found.slice(0, 75)) button((e.storage || e.interfaceName.split('.').pop()) + ' · ' + e.key, () => {
          const args = [e.interfaceName, e.storage ?? null, e.key];
          page(e.key, target, async ({call, apply, form, button}) => {
            const value = await call(prefix + 'get', args);
            const isText = typeof value === 'string';
            const boolean = typeof value === 'boolean';
            body.append(element('p', e.interfaceName));
            form('Simpan', [{label: isText ? 'Nilai' : 'Nilai JSON', type: 'textarea', required: false,
              value: isText ? value : JSON.stringify(value, null, 2),
              ...(boolean ? {options: [['true', 'Aktif'], ['false', 'Nonaktif']]} : {})}], input => {
              const value = isText ? input : JSON.parse(input);
              return apply(prefix + 'set', [...args, value]);
            });
            button('Pulihkan nilai default', async () => {
              if (!confirm('Pulihkan ' + e.key + ' ke default perangkat?')) return;
              await apply(prefix + 'reset', args); config(target, plugins);
            });
          });
        }, results);
      }
      search.oninput = draw; draw(); search.focus();
    });
  }
  function accounts(target) {
    page('Akun hoster', target, async ({call, apply, button, form}) => {
      const list = await call('/accountsV2/listAccounts', [{maxResults: -1, enabled: true, error: true, valid: true, userName: true}]);
      if (!list.length) body.append(element('p', 'Belum ada akun hoster.'));
      for (const a of list) {
        const section = element('section'); body.append(section);
        section.append(element('h3', a.hostname + ' · ' + (a.username || 'Akun')), element('p', a.errorString || (a.valid ? 'Valid' : 'Belum valid')));
        const change = async method => { await apply('/accountsV2/' + method, [[a.uuid]]); accounts(target); };
        button(a.enabled ? 'Nonaktifkan' : 'Aktifkan', () => change(a.enabled ? 'disableAccounts' : 'enableAccounts'), section);
        button('Ubah login', () => page('Ubah login · ' + a.hostname, target, ({apply, form}) => form('Simpan akun', [
          {label: 'Username', value: a.username}, {label: 'Password / token', type: 'password'}
        ], async (user, password) => {
          await apply('/accountsV2/setUserNameAndPassword', [a.uuid, user, password]); accounts(target);
        })), section);
        button('Periksa akun', () => change('refreshAccounts'), section);
        button('Hapus akun', () => confirm('Hapus akun hoster ' + a.hostname + '?') && change('removeAccounts'), section);
      }
      form('Tambah akun hoster', [{label: 'Hoster'}, {label: 'Username'}, {label: 'Password / token', type: 'password'}],
        async (host, user, pass) => { await apply('/accountsV2/addAccount', [host, user, pass]); accounts(target); });
    });
  }

  function device(target) {
    page('Kelola perangkat', target, ({button, call}) => {
      button('Pengaturan lanjutan & Packagizer', () => config(target));
      button('Pengaturan plugin hoster', () => config(target, true));
      button('Sistem & penyimpanan', () => page('Sistem & penyimpanan', target, async ({call, form}) => {
        const info = await call('/system/getSystemInfos');
        const list = element('dl');
        for (const [k,v] of Object.entries(info || {})) list.append(element('dt', k), element('dd', String(v)));
        body.append(list);
        form('Periksa ruang', [{label: 'Path pada perangkat', value: '/'}], async path => {
          const disks = await call('/system/getStorageInfos', [path]);
          return disks.map(d => (d.path || path) + ' · ' + (d.free >= 0 ? bytes(d.free) + ' tersedia' : JSON.stringify(d))).join(' · ');
        });
      }));
      button('Akun hoster', () => accounts(target));
      button('Ekstensi JDownloader', () => page('Ekstensi JDownloader', target, async ({call, apply, button}) => {
        const entries = await call('/extensions/list', [{enabled: true, installed: true, name: true}]);
        for (const entry of entries.filter(e => e.installed)) {
          button((entry.enabled ? 'Nonaktifkan ' : 'Aktifkan ') + (entry.name || entry.id), async () => {
            await apply('/extensions/setEnabled', [entry.id, !entry.enabled]); device(target);
          });
        }
      }));
      button('Periksa pembaruan JDownloader', async () => {
        await call('/update/runUpdateCheck');
        page('Pembaruan perangkat', target, async ({call, button}) => {
          const check = async () => await call('/update/isUpdateAvailable') ? 'Pembaruan tersedia.' : 'Belum ada pembaruan yang terdeteksi.';
          body.append(element('p', await check()));
          button('Periksa status lagi', check);
          button('Restart dan perbarui', async () => {
            if (confirm('Restart JDownloader pada ' + (target.name || target.deviceId) + '?')) {
              await call('/update/restartAndUpdate'); return 'Perintah restart dikirim.';
            }
          });
        });
      });
    });
  }
  function attention(target, dialog, captchas) {
    page('Perlu jawaban', target, ({button}) => {
      if (dialog) button(dialog.title || 'Dialog JDownloader', () => page(dialog.title || 'Dialog perangkat', target, async ({call, form, button, apply}) => {
        const info = await call('/dialogs/get', [dialog.id, false, true]);
        const props = info.properties || {};
        body.append(element('p', props.message || info.type));
        const schema = dialog.deep ? {out: {}} : await call('/dialogs/getTypeInfo', [info.type]);
        const keys = Object.keys(schema.out || {}).filter(k => k.toLowerCase() !== 'closereason');
        const answer = async (reason, values = []) => {
          const data = {closereason: reason};
          if (reason === 'ok') keys.forEach((k, i) => { data[k] = values[i]; });
          await apply('/dialogs/answer', [dialog.id, data]); close();
        };
        form(props.okbuttontext || 'Ya / OK', keys.map(k => ({
          label: k + ' (' + schema.out[k] + ')', type: /password/i.test(k) ? 'password' : 'text',
          value: props[k] || '', required: false
        })), (...values) => answer('ok', values));
        button(props.cancelbuttontext || 'Batal / Tidak', () => answer('cancel'));
      }));
      for (const c of captchas || []) button('CAPTCHA · ' + (c.hoster || c.type), () => page('CAPTCHA · ' + (c.hoster || ''), target, async ({call, form, apply, button}) => {
        if (c.explain) body.append(element('p', c.explain));
        button('Lewati CAPTCHA ini', async () => { await apply('/captcha/skip', [c.id, 'SINGLE']); close(); });
        const image = await call('/captcha/get', [c.id]);
        if (typeof image !== 'string' || !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(image)) {
          return 'Tipe CAPTCHA ini memerlukan antarmuka interaktif dari hoster.';
        }
        const img = element('img'); img.src = image; img.alt = 'Tantangan CAPTCHA dari hoster'; body.append(img);
        form('Kirim jawaban', [{label: 'Teks pada gambar'}], async value => { await apply('/captcha/solve', [c.id, value]); close(); });
      }));
    });
  }
  return {item, batch, add, device, attention, close};
}
