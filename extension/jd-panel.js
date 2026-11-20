(() => {
  const send = byId('jd-send');
  const message = byId('jd-status');
  async function showTarget() {
    try {
      const profile = await JDAccount.info();
      byId('jd-target').textContent = profile.connected
        ? 'Tujuan: ' + (profile.deviceName || profile.deviceId || 'Belum dipilih') : 'MyJDownloader belum terhubung';
    } catch { message.textContent = 'Pengaturan MyJDownloader tidak dapat dibaca.'; }
  }
  async function sendSelection(autostart, retry) {
    const urls = retry ? [] : selectedUrls();
    if ((!retry && !urls.length) || send.dataset.busy === 'true') return;
    send.dataset.busy = 'true';
    refreshControls();
    let slowHint;
    try {
      const profile = retry?.profile || await JDAccount.info();
      if (!profile.connected || !profile.deviceId) {
        message.textContent = 'Hubungkan akun dan pilih perangkat di Pengaturan.';
        await chrome.runtime.openOptionsPage();
        return;
      }
      message.textContent = retry ? 'Memulai unduhan dari kiriman sebelumnya…'
        : autostart ? 'Menunggu hasil scan dan memulai unduhan di JDownloader…' : 'Mengirim ke JDownloader…';
      const waitingMessage = message.textContent;
      slowHint = setTimeout(() => {
        if (byId('jd-prompt').hidden && message.textContent === waitingMessage) {
          message.replaceChildren('Masih menunggu JDownloader. Jika ada dialog konfirmasi, jawab di ');
          const link = document.createElement('a');
          link.href = 'viewer.html';
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'viewer JDownloader';
          message.append(link, '.');
        }
      }, 10000);
      const request = retry ? {action: 'jd-resume-job', jobId: retry.jobId, target: profile}
        : {action: 'jd-send', urls, autostart, expected: profile, destinationFolder: JDLocation.forTarget(profile)};
      const reply = await chrome.runtime.sendMessage(request);
      if (!reply?.ok) throw Object.assign(Error(reply?.message || 'Pengiriman belum terkonfirmasi.'), {code: reply?.code});
      const {target, jobId, count, active, startError} = reply.result;
      if (!retry) JDLocation.reset();
      if (startError) {
        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.textContent = 'Coba mulai lagi';
        retryButton.addEventListener('click', () => sendSelection(true, {profile, jobId}));
        message.replaceChildren('Link diterima di ' + target + '. Unduhan belum terkonfirmasi. ' + startError + ' ', retryButton);
      } else {
        message.textContent = autostart
          ? count + ' file di Downloads pada ' + target + '. ' + active + ' berjalan atau selesai.'
          : 'LinkGrabber di ' + target + ' menerima ' + urls.length + ' URL.';
      }
    } catch (error) {
      message.textContent = retry ? 'Link sudah diterima. ' + error.message
        : error.code === 'OFFLINE' ? 'Perangkat tujuan offline. Pilihan perangkat tetap tersimpan.'
          : error.message + ' Periksa JDownloader sebelum mencoba lagi.';
    } finally {
      clearTimeout(slowHint);
      send.dataset.busy = 'false';
      refreshControls();
    }
  }
  byId('jd-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  send.addEventListener('click', () => sendSelection(false));
  byId('jd-download').addEventListener('click', () => sendSelection(true));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[JDAccount.key]) showTarget();
  });
  showTarget();
})();
