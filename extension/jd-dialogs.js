// Dialogs belong to the device. The API does not associate them with an addLinks job.
async function firstJDDialog(call) {
  const ids = await call('/dialogs/list', []);
  if (!Array.isArray(ids)) throw Error('Daftar dialog tidak dapat dibaca.');
  if (!ids.length) return null;
  const id = ids[0];
  if (!Number.isSafeInteger(id) || id <= 0) return {id: null, deep: false};
  let info;
  try { info = await call('/dialogs/get', [id, false, true]); }
  catch { return {id, deep: false}; }
  const message = info?.properties?.message || '';
  const deep = info?.type === 'org.appwork.uio.ConfirmDialogInterface' &&
    /\bdeep link analysis\b/i.test(message);
  return {id, deep, title: info?.properties?.title || ''};
}
