(() => {
  const file = /\.(?:pdf|epub|mobi|csv|xlsx?|docx?|pptx?|mp[34]|mkv|mov|wav|flac|png|jpe?g|webp|exe|dmg|iso|zip|rar|7z|tar|gz|bz2|xz|3mf|stl|obj|step|stp|iges|igs|amf|ply|off|3ds|fbx|glb|gltf|blend|scad|f3d|f3z|dxf|svg|gcode|bgcode|goo|ctb|chitubox|lys)(?:\.\d{3})?(?=$|[\s"'();,\]])/i;
  const downloadWord = /\b(?:download|unduh)\b/i;
  const downloadAttrs = ['data-download-url', 'data-download-href', 'data-file-url'];
  const genericAttrs = ['data-href', 'data-url'];
  const attrs = [...downloadAttrs, ...genericAttrs, 'href'];
  const anchorDownloadAttrs = [...downloadAttrs, 'href', ...genericAttrs];
  const results = new Map();

  const videoPath = /\.(?:mp4|m4v|webm|mov|mkv|ogv|m3u8|mpd)$/i;

  function youtubeWatch(url) {
    let id;
    if (url.hostname === 'youtu.be') id = url.pathname.split('/')[1];
    else if (/^(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com$/.test(url.hostname)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') :
        url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    }
    return id !== 'videoseries' && /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? 'https://www.youtube.com/watch?v=' + id : '';
  }

  function httpUrl(raw, base) {
    if (!raw) return null;
    try {
      const url = new URL(raw, base);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url;
    } catch { /* Skip invalid media sources. */ }
    return null;
  }

  function addVideo(url, title) {
    const previous = results.get(url);
    results.set(url, {
      ...previous, url, isVideo: true, isFile: previous?.isFile || false,
      filename: previous?.filename || filenameFromUrl(url), title: previous?.title || title
    });
  }

  function usefulTitle(text) {
    const clean = text?.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > 300 || /^(?:https?:\/\/|www\.)/i.test(clean)) return '';
    if (/^(?:(?:click|klik|here|di sini|untuk|to|download|downloads|unduh|file|now|sekarang|open|buka|link|button)[\s:↓-]*)+$/i.test(clean)) return '';
    return clean;
  }

  function titleFor(el) {
    const refs = (el.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
    const referenced = refs.map(id => el.getRootNode().getElementById?.(id)?.textContent || '').join(' ');
    const labels = [referenced, el.getAttribute('title'), el.getAttribute('aria-label'), el.textContent,
      el.querySelector('img[alt]')?.alt].map(usefulTitle).filter(Boolean);
    if (labels.length) return labels.find(text => file.test(text)) || labels[0];

    // A download button may be nested several wrappers below its item title.
    const boundary = 'li, tr, article, [role="row"], [role="listitem"], [data-product-id]';
    const controls = 'a[href], area[href], button, [role="link"], [role="button"], ' +
      attrs.filter(attr => attr !== 'href').map(attr => '[' + attr + ']').join(', ');
    let branch = el;
    for (let depth = 0; depth < 6; depth++) {
      const group = branch.parentElement;
      if (!group || group.matches('html, body, main, nav, [role="main"]')) break;
      if (Array.from(group.querySelectorAll(controls)).some(control => control !== el &&
          !control.contains(el) && !el.contains(control))) break;
      const candidates = [];
      for (const sibling of group.children) {
        if (sibling === branch || sibling.matches('script, style, [hidden], [aria-hidden="true"]')) continue;
        const namedSelector = '[data-filename], [data-file-name], .filename, .file-name, [itemprop="name"], h1, h2, h3, h4, h5, h6, th, [role="heading"]';
        const named = sibling.matches(namedSelector) ? sibling : sibling.querySelector(namedSelector);
        const name = named && usefulTitle(named.getAttribute('data-filename') ||
          named.getAttribute('data-file-name') || named.textContent);
        const text = name || usefulTitle(sibling.textContent);
        if (text) candidates.push({ text, named: Boolean(name) });
      }
      const specific = candidates.filter(item => file.test(item.text));
      const headings = candidates.filter(item => item.named);
      const pool = specific.length ? specific : headings.length ? headings : candidates.filter(item =>
        /\p{L}/u.test(item.text) && !/^(?:\d+(?:[.,]\d+)?\s*(?:[KMGT]?i?B)|(?:Rp|IDR|USD)\s*[\d.,]+)$/i.test(item.text));
      const titles = [...new Set(pool.map(item => item.text))];
      if (titles.length === 1) return titles[0];
      if (titles.length > 1 || group.matches(boundary)) break;
      branch = group;
    }
    return '';
  }

  function collect(el) {
    const label = [el.textContent, el.getAttribute('title'), el.getAttribute('aria-label')].filter(Boolean).join(' ');
    const isControl = el.matches('a, area, button, [role="link"], [role="button"]');
    const hasDownload = el.hasAttribute('download');
    const urlAttrs = hasDownload && el.matches('a, area') ? anchorDownloadAttrs : attrs;
    const explicit = ['download', 'data-filename', 'data-file-name', 'data-download-filename']
      .map(key => usefulTitle(el.getAttribute(key))).find(Boolean);
    for (const attr of urlAttrs) {
      const raw = el.getAttribute(attr)?.trim();
      if (!raw || raw.startsWith('#')) continue;
      const url = httpUrl(raw, el.baseURI);
      if (!url) continue;
      let path = url.pathname;
      try { path = decodeURIComponent(path); } catch { /* Keep the original path. */ }
      const filename = path.split('/').pop();
      const fileInQuery = Array.from(url.searchParams.values()).some(value => file.test(value));
      const downloadHint = downloadAttrs.includes(attr) ||
        hasDownload || (isControl && (file.test(label) || downloadWord.test(label)));
      const isFile = file.test(filename) || fileInQuery || downloadHint ||
        /(?:^|\/)(?:downloads?|unduh)(?:\/|$)/i.test(path);
      const previous = results.get(url.href);
      results.set(url.href, {
        url: url.href,
        isVideo: Boolean(previous?.isVideo || videoPath.test(path)),
        isFile: Boolean(previous?.isFile || isFile || explicit),
        filename: previous?.filename || filenameFromUrl(url.href),
        explicitFilename: previous?.explicitFilename || explicit,
        title: previous?.title || titleFor(el)
      });
      if (isFile) break;
    }
  }

  function scan(root) {
    const doc = root.ownerDocument || root;
    const page = httpUrl(doc.URL);
    const watch = page && youtubeWatch(page);
    const pageTitle = doc.querySelector('meta[property="og:title"]')?.content || doc.title;
    if (watch) addVideo(watch, pageTitle);

    const selector = attrs.map(a => '[' + a + ']').join(',');
    for (const el of root.querySelectorAll('*')) {
      if (el.matches(selector) && (el.matches('a, area') || attrs.slice(0, -1).some(attr => el.hasAttribute(attr)))) collect(el);
      if (el.localName === 'video' && !watch) {
        const title = el.getAttribute('title') || el.getAttribute('aria-label') || pageTitle;
        const sources = [el.currentSrc, el.getAttribute('src'),
          ...Array.from(el.querySelectorAll('source[src]'), source => source.getAttribute('src'))];
        const urls = sources.map(src => httpUrl(src, el.baseURI)).filter(Boolean);
        for (const url of urls) addVideo(url.href, title);
        if (!urls.length && page) addVideo(page.href, title + ' (halaman pemutar)');
      }
      if (el.localName === 'iframe') {
        const src = httpUrl(el.getAttribute('src'), el.baseURI);
        const embedded = src && youtubeWatch(src);
        if (embedded) addVideo(embedded, el.title || 'Video YouTube');
      }
      if (el.shadowRoot) scan(el.shadowRoot);
      if (el.localName === 'iframe' && el.contentDocument) scan(el.contentDocument);
    }
  }

  scan(document);
  return Array.from(results.values(), ({explicitFilename, ...entry}) => ({
    ...entry, filename: explicitFilename || entry.filename
  }));
})()
