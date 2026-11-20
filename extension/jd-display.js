function mountJDDialog(restart) {
  const prompt = byId('jd-prompt');
  const yes = byId('jd-prompt-yes');
  const no = byId('jd-prompt-no');
  let pendingDialog = null;
  let answering = false;

  function showDialog(dialog, target) {
    pendingDialog = dialog ? {dialog, target} : null;
    prompt.hidden = !dialog;
    if (!dialog) return;
    const title = 'JDownloader menunggu jawaban · ' + (target.name || target.deviceId);
    if (byId('jd-prompt-title').textContent !== title) byId('jd-prompt-title').textContent = title;
    byId('jd-prompt-text').textContent = dialog.deep
      ? 'Scan awal tidak menemukan file. Izinkan JDownloader mencari link lebih dalam di halaman tersebut?'
      : (dialog.title ? dialog.title + '. ' : '') + 'Buka viewer JDownloader untuk meninjau dialog pada perangkat ini.';
    yes.hidden = no.hidden = !dialog.deep;
    yes.disabled = no.disabled = answering;
  }

  async function answer(reason) {
    if (!pendingDialog?.dialog.deep || answering) return;
    const {dialog, target} = pendingDialog;
    answering = true;
    yes.disabled = no.disabled = true;
    try {
      await JDAccount.answerDeepDialog(dialog.id, reason, target);
      if (pendingDialog?.dialog.id === dialog.id && pendingDialog.target.deviceId === target.deviceId) {
        showDialog(null);
        byId('jd-status').textContent = reason === 'ok' ? 'Analisis link disetujui. Menunggu hasil dari JDownloader…'
          : 'Analisis lanjutan ditolak untuk dialog ini.';
      }
    } catch (error) {
      byId('jd-status').textContent = error.message + ' Periksa dialog di viewer JDownloader.';
    } finally {
      answering = false;
      restart();
    }
  }
  yes.addEventListener('click', () => answer('ok'));
  no.addEventListener('click', () => answer('cancel'));

  return showDialog;
}

const byteNumber = new Intl.NumberFormat('id-ID', {maximumFractionDigits: 1});
function bytes(value) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return byteNumber.format(value) + ' ' + units[unit];
}
