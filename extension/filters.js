// Without a star, match a substring. With stars, match the whole name.
function matchesName(value, pattern) {
  if (!pattern.includes('*')) return value.includes(pattern);
  const parts = pattern.split('*');
  const first = parts.shift();
  const last = parts.pop();
  if (!value.startsWith(first) || !value.endsWith(last)) return false;
  let offset = first.length;
  for (const part of parts) {
    const index = value.indexOf(part, offset);
    if (index < 0) return false;
    offset = index + part.length;
  }
  return offset <= value.length - last.length;
}

function urlFields(raw) {
  const url = new URL(raw);
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* Keep the encoded path. */ }
  return { host: url.hostname.toLowerCase(), path: path.toLowerCase(), raw: raw.toLowerCase() };
}

function readFilters(form) {
  const field = name => form.elements.namedItem(name).value.trim().toLowerCase();
  return {
    search: field('search'), name: field('name'), domain: field('domain'),
    path: field('path'), state: field('state'),
    extensions: Array.from(form.querySelectorAll('[name="extensions"]:checked'), box => box.value)
  };
}

function extensionOf(entry) {
  const name = (entry.filename || entry.title || '').trim();
  return name.match(/\.([a-z0-9]{1,12})$/i)?.[1].toLowerCase() || '';
}

function matchesFilters(entry, filters) {
  const names = [entry.displayName, entry.title, entry.initialFilename].filter(Boolean).map(text => text.toLowerCase());
  const urls = entry.targetFields ? [entry.sourceFields, entry.targetFields] : [entry.sourceFields];
  if (filters.state && filters.state !== entry.state) return false;
  if (filters.name && !names.some(name => matchesName(name, filters.name))) return false;
  if (filters.search && !names.some(name => name.includes(filters.search)) &&
      !urls.some(url => url.raw.includes(filters.search) || url.path.includes(filters.search))) return false;
  if (!urls.some(url => (!filters.domain || url.host === filters.domain) &&
      url.path.startsWith(filters.path))) return false;
  return !filters.extensions.length || filters.extensions.includes(extensionOf(entry));
}
