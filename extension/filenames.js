function filenameFromHeader(header) {
  if (!header) return '';
  // filename* carries percent-encoded UTF-8 and takes precedence over filename.
  const params = new Map();
  for (const match of header.matchAll(/;\s*(filename\*?)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/gi)) {
    params.set(match[1].toLowerCase(), (match[2]?.replace(/\\(["\\])/g, '$1') ?? match[3]).trim());
  }
  const encoded = /^utf-8'[^']*'(.*)$/i.exec(params.get('filename*') || '');
  let name = params.get('filename') || '';
  if (encoded) {
    try { name = decodeURIComponent(encoded[1]) || name; } catch { /* Use the plain filename. */ }
  }
  return name.split(/[\\/]/).pop().trim();
}

function filenameFromUrl(url) {
  const parsed = new URL(url);
  const suggested = filenameFromHeader(parsed.searchParams.get('response-content-disposition'));
  if (suggested) return suggested;
  for (const key of ['filename', 'file_name', 'file', 'name', 'attachment']) {
    const value = parsed.searchParams.get(key);
    if (!value || /^https?:/i.test(value)) continue;
    const last = value.split(/[\\/]/).pop()?.trim();
    if (last && /\.[a-z0-9]{1,12}$/i.test(last)) return last;
  }
  const segment = parsed.pathname.split('/').pop();
  let name = segment;
  try { name = decodeURIComponent(segment); } catch { /* Gunakan teks URL asli. */ }
  if (/\.(?:php|aspx?|jsp|cgi|html?)$/i.test(name)) return '';
  return /\.[a-z0-9]{1,12}$/i.test(name) ? name : '';
}
