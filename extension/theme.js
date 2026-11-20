(() => {
  const key = 'ui.theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  const picker = document.getElementById('theme');
  let preference = 'system';
  function render(value) {
    preference = ['dark', 'light'].includes(value) ? value : 'system';
    document.documentElement.dataset.theme = preference === 'system'
      ? (system.matches ? 'dark' : 'light') : preference;
    if (picker) picker.value = preference;
  }
  render(preference);
  system.addEventListener('change', () => render(preference));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key]) render(changes[key].newValue);
  });
  chrome.storage.local.get(key).then(stored => render(stored[key]));
  picker?.addEventListener('change', async () => {
    try {
      await chrome.storage.local.set({[key]: picker.value});
    } catch {
      render(preference);
      document.getElementById('jd-status').textContent = 'Tema gagal disimpan.';
    }
  });
})();
