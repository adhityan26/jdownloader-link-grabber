// Pakai GET karena URL bertanda tangan bisa terikat pada metode HTTP.
// Hentikan respons begitu header diterima agar file tidak diunduh penuh.
async function checkRedirect(original, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(original, {
      credentials: 'include', redirect: 'follow', cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const url = response.redirected ? response.url : original;
    const filename = filenameFromHeader(response.headers.get('content-disposition')) ||
      (response.redirected ? filenameFromUrl(url) : '');
    return { url, redirected: response.redirected, filename };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}
