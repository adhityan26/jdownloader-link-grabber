// My.JDownloader signs server queries and encrypts device requests with a session-specific key.
const MyJD = (() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const api = 'https://api.jdownloader.org';
  let previousRid = 0;
  function nextRid() {
    previousRid = Math.max(Date.now(), previousRid + 1);
    return previousRid;
  }

  const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  function fromHex(value) {
    if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(value)) throw Error('Token sesi tidak valid.');
    return Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16));
  }
  async function digest(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  }
  async function cipher(operation, token, bytes) {
    const key = await crypto.subtle.importKey('raw', token.slice(16), 'AES-CBC', false, [operation]);
    return new Uint8Array(await crypto.subtle[operation]({name: 'AES-CBC', iv: token.slice(0, 16)}, key, bytes));
  }

  async function request(path, token, rid, options = {}) {
    const response = await fetch(api + path, {
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(20000), ...options
    });
    const body = (await response.text()).trim();
    let reply;
    try {
      if (!response.ok && body.startsWith('{')) reply = JSON.parse(body);
      else {
        const encrypted = Uint8Array.from(atob(body), char => char.charCodeAt(0));
        reply = JSON.parse(decoder.decode(await cipher('decrypt', token, encrypted)));
      }
    } catch {
      throw Error('Respons MyJDownloader tidak dapat dibaca (HTTP ' + response.status + ').');
    }
    if (!response.ok || reply.type) {
      const error = Error('MyJDownloader: ' + (reply.type || 'HTTP ' + response.status));
      error.code = reply.type;
      throw error;
    }
    if (reply.rid !== rid) throw Error('ID respons MyJDownloader tidak cocok.');
    return reply;
  }

  async function server(path, params, key) {
    const rid = nextRid();
    const query = path + '?' + new URLSearchParams({...params, rid});
    const hmac = await crypto.subtle.importKey('raw', key, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', hmac, encoder.encode(query));
    return request(query + '&signature=' + hex(new Uint8Array(signature)), key, rid);
  }

  async function connect(email, password) {
    email = email.trim().toLowerCase();
    const [login, device] = await Promise.all(['server', 'device'].map(suffix =>
      digest(encoder.encode(email + password + suffix))));
    const reply = await server('/my/connect', {email, appkey: 'scan-link-3d'}, login);
    return sessionKeys(reply, login, device);
  }

  async function sessionKeys({sessiontoken, regaintoken}, serverSecret, deviceSecret) {
    const token = fromHex(sessiontoken);
    const [serverKey, deviceKey] = await Promise.all([serverSecret, deviceSecret].map(async secret =>
      hex(await digest(Uint8Array.from([...secret, ...token])))));
    return {sessiontoken, regaintoken: regaintoken || '', serverKey, deviceKey, deviceSecret: hex(deviceSecret)};
  }

  async function reconnect(session) {
    const key = fromHex(session.serverKey);
    const reply = await server('/my/reconnect', {
      appkey: 'scan-link-3d', sessiontoken: session.sessiontoken, regaintoken: session.regaintoken
    }, key);
    return sessionKeys(reply, key, fromHex(session.deviceSecret));
  }

  async function devices(session) {
    const reply = await server('/my/listdevices', {sessiontoken: session.sessiontoken}, fromHex(session.serverKey));
    if (!Array.isArray(reply.list)) throw Error('Daftar perangkat tidak valid.');
    return reply.list.filter(item => item.id && item.name && (!item.type || item.type.toLowerCase() === 'jd'));
  }

  function localURL(input) {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) throw Error('Masukkan alamat dasar Remote API, termasuk port.');
    return url;
  }
  const localOrigin = input => localURL(input).origin;
  const hosterCredentials = new Set(['/accountsV2/addAccount', '/accountsV2/setUserNameAndPassword']);
  async function localCall(origin, path, params) {
    const url = localURL(origin);
    const loopback = ['localhost', '[::1]'].includes(url.hostname) || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (hosterCredentials.has(path) && url.protocol === 'http:' && !loopback) {
      throw Error('Untuk mengirim password akun hoster, gunakan HTTPS atau tunnel SSH ke localhost.');
    }
    const response = await fetch(url.origin + path, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({params}),
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(20000)
    });
    let result;
    try { result = await response.json(); }
    catch { throw Error('Alamat ini tidak memberikan respons JSON Remote API JDownloader.'); }
    if (!response.ok || result?.type) throw Error('JDownloader LAN · ' + (result?.type || response.status));
    if (!result || !Object.hasOwn(result, 'data')) throw Error('Format respons Remote API tidak dikenali.');
    return result.data;
  }

  async function deviceCall(session, device, url, args) {
    if (session.localOrigin) {
      if (device !== session.localOrigin) throw Error('Tujuan LAN berubah.');
      return localCall(device, url, args);
    }
    const rid = nextRid();
    const params = args.map(value => JSON.stringify(value));
    const key = fromHex(session.deviceKey);
    const encrypted = await cipher('encrypt', key, encoder.encode(JSON.stringify({apiVer: 1, url, rid, params})));
    const reply = await request('/t_' + session.sessiontoken + '_' + encodeURIComponent(device) + url, key, rid, {
      method: 'POST', headers: {'Content-Type': 'application/aesjson-jd; charset=utf-8'},
      body: btoa(Array.from(encrypted, byte => String.fromCharCode(byte)).join(''))
    });
    return reply.data;
  }

  function isAbsoluteFolder(path) {
    return typeof path === 'string' && /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(path) && !/[\u0000-\u001f]/.test(path);
  }
  function buildAddLinksQuery(links, destinationFolder, assignJobID = false) {
    const query = {links, autostart: false};
    if (assignJobID) query.assignJobID = true;
    if (destinationFolder) {
      if (!isAbsoluteFolder(destinationFolder)) throw Error('Masukkan path absolut pada perangkat JDownloader.');
      query.destinationFolder = destinationFolder;
      query.overwritePackagizerRules = true;
    }
    return query;
  }
  async function addLinks(session, device, urls, destinationFolder) {
    const query = buildAddLinksQuery(urls.join('\n'), destinationFolder, true);
    const job = await deviceCall(session, device, '/linkgrabberv2/addLinks', [query]);
    if (!Number.isSafeInteger(job?.id) || job.id <= 0) throw Error('ID job dari JDownloader belum terkonfirmasi.');
    return job;
  }

  function disconnect(session) {
    return server('/my/disconnect', {sessiontoken: session.sessiontoken}, fromHex(session.serverKey));
  }
  return {localOrigin, localCall, connect, reconnect, devices, deviceCall, buildAddLinksQuery, addLinks, isAbsoluteFolder, disconnect};
})();
