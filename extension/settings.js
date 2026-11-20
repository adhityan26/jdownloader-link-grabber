(() => {
  const get = id => document.getElementById(id);
  const form = get('jd-login');
  const email = get('jd-email');
  const password = get('jd-password');
  const device = get('jd-device');
  const status = get('jd-status');
  let busy = false;
  let desktopTarget;
  let deviceTarget;

  async function render() {
    const profile = await JDAccount.info();
    desktopTarget = profile;
    get('desktop-form').hidden = !profile.connected || !profile.deviceId;
    get('desktop-url').value = profile.desktopURL || '';
    form.hidden = profile.connected;
    get('jd-connected').hidden = !profile.connected || profile.lan;
    get('use-cloud').hidden = !profile.lan;
    if (profile.lan) get('lan-origin').value = profile.deviceId;
    get('jd-logout').hidden = profile.lan || !profile.connected && !profile.email && !profile.deviceId;
    get('account').textContent = profile.connected ? profile.email || profile.deviceName || 'MyJDownloader terhubung' : '';
    if (!email.value || profile.email) email.value = profile.email;
    return profile;
  }

  async function loadDevices() {
    const profile = await render();
    deviceTarget = null;
    if (!profile.connected || profile.lan) return;
    device.replaceChildren(new Option(profile.deviceName || profile.deviceId || 'Pilih perangkat', profile.deviceId));
    const devices = await JDAccount.devices(profile);
    deviceTarget = profile;
    const saved = devices.find(item => item.id === profile.deviceId);
    device.replaceChildren(new Option(devices.length ? 'Pilih perangkat' : 'Tidak ada perangkat online', ''),
      ...devices.map(item => new Option(item.name, item.id)));
    if (profile.deviceId && !saved) {
      device.add(new Option((profile.deviceName || profile.deviceId) + ' (offline)', profile.deviceId));
    }
    device.value = profile.deviceId;
    const preferred = saved || (!profile.deviceId && devices.length === 1 ? devices[0] : null);
    if (preferred && (preferred.id !== profile.deviceId || preferred.name !== profile.deviceName)) {
      await chooseDevice(preferred.id, preferred.name);
      device.value = preferred.id;
    }
    status.textContent = device.value ? 'Perangkat tujuan tersimpan.' : 'Pilih JDownloader yang akan menerima link.';
  }

  async function chooseDevice(deviceId, deviceName) {
    await JDAccount.choose(deviceId, deviceName, deviceTarget);
    deviceTarget = {...deviceTarget, deviceId, deviceName};
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    const controls = document.querySelectorAll('input, button, select');
    controls.forEach(el => { el.disabled = true; });
    status.textContent = '';
    try { await action(); }
    catch (error) {
      status.textContent = error.code === 'AUTH_FAILED' ? 'Login ditolak. Periksa email dan password.' : error.message;
    } finally {
      try { await render(); }
      finally { controls.forEach(el => { el.disabled = false; }); busy = false; }
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      status.textContent = 'Menghubungkan akun…';
      const login = JDAccount.login(email.value, password.value);
      password.value = '';
      await login;
      await loadDevices();
    });
  });
  device.addEventListener('change', () => run(async () => {
    try {
      await chooseDevice(device.value, device.value ? device.selectedOptions[0].textContent : '');
    } catch (error) {
      await loadDevices().catch(() => {});
      throw error;
    }
    status.textContent = 'Pilihan perangkat disimpan.';
  }));
  get('jd-refresh').addEventListener('click', () => run(loadDevices));
  get('jd-logout').addEventListener('click', () => run(async () => {
    email.value = '';
    device.replaceChildren();
    await JDAccount.logout();
    status.textContent = 'Data login dan pilihan perangkat dihapus.';
  }));
  get('desktop-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      await JDAccount.setDesktopURL(desktopTarget, get('desktop-url').value);
      status.textContent = 'Alamat GUI perangkat disimpan.';
    });
  });
  get('lan-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      await JDAccount.connectLAN(get('lan-origin').value);
      status.textContent = 'Koneksi LAN teruji dan tersimpan.';
    });
  });
  get('use-cloud').addEventListener('click', () => run(async () => {
    await JDAccount.useCloud();
    await loadDevices();
  }));
  run(loadDevices);
})();
