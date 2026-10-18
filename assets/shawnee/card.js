// Shawnee Mercier's card page (thecapitalrow.com/shawnee): contact links, sharing, QR screen and the exchange-details form.
// Attribution: ?src= is the channel (qr = printed card, nfc = NFC card, wallet = Apple Wallet pass, screen = QR on her phone,
// link = shared link, email = email signature); ?at= is the event. Both travel with the form to HubSpot.
(function () {
  var B = document.body, BASE = B.getAttribute('data-url'), PHONE = B.getAttribute('data-phone') || '';
  var $ = function (id) { return document.getElementById(id); };
  var T = function (k) { var e = document.querySelector('[data-t="' + k + '"]'); return e ? e.textContent : ''; };
  var CHANNELS = { qr: 'Printed card QR', nfc: 'NFC card tap', wallet: 'Apple Wallet pass', screen: 'QR on Shawnee’s phone', link: 'Shared link', email: 'Email signature', direct: 'Direct visit' };
  var q = {}; try { var u = new URLSearchParams(location.search); q.src = u.get('src'); q.at = u.get('at'); } catch (x) {}
  var SRC = CHANNELS[q.src] ? q.src : 'direct';
  var EVENT = (q.at || '').replace(/[^\w &'.,()\-\/]/g, '').trim().slice(0, 80);
  var withEvent = function (src) { return BASE + '?src=' + src + (EVENT ? '&at=' + encodeURIComponent(EVENT) : ''); };

  // call and text
  if (PHONE) { var c = $('icall'); c.href = 'tel:' + PHONE; c.hidden = false; }
  // Apple Wallet: the button appears only when a signed pass is actually on the server, and only on Apple devices
  if (/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) {
    fetch('/shawnee/shawnee-mercier.pkpass', { method: 'HEAD' }).then(function (r) {
      var t = (r.headers.get('Content-Type') || '');
      if (r.ok && t.indexOf('vnd.apple.pkpass') >= 0) $('wallet').hidden = false;
    }, function () {});
  }

  function toast(s) { var e = $('toast'); e.textContent = s; e.classList.add('on'); setTimeout(function () { e.classList.remove('on'); }, 1800); }
  function copy() {
    var url = withEvent('link');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast(T('share.4')); }, function () { window.prompt('', url); });
    else window.prompt('', url);
  }
  $('shc').onclick = copy;
  $('shs').onclick = function () {
    if (navigator.share) navigator.share({ title: document.title, text: document.querySelector('.pos').textContent, url: withEvent('link') }).catch(function () {});
    else copy();
  };

  // QR screen. With an event (?at=ACG) the code is drawn here so scans carry the event; otherwise the built-in code is used.
  var Q = $('qrfull');
  function drawEventQR() {
    if (!EVENT || !window.qrcode || Q.getAttribute('data-ev')) return;
    var qr = window.qrcode(0, 'H'); qr.addData(withEvent('screen')); qr.make();
    var n = qr.getModuleCount(), h = Math.round(n * .27); if ((n - h) % 2) h++; var a = (n - h) / 2, r, k, x0, out = [];
    for (r = 0; r < n; r++) { k = 0; while (k < n) { var dark = qr.isDark(r, k) && !(r >= a && r < a + h && k >= a && k < a + h);
      if (dark) { x0 = k; while (k < n && qr.isDark(r, k) && !(r >= a && r < a + h && k >= a && k < a + h)) k++; out.push('<rect x="' + x0 + '" y="' + r + '" width="' + (k - x0) + '" height="1.02"/>'); } else k++; } }
    var pad = h * .14, inner = h - 2 * pad, w = inner / 9, H = inner * 2 / 3, top = a + pad + (inner - H) / 2, S = [.4, .67, 1, .6, .34], bars = '';
    for (var i = 0; i < 5; i++) bars += '<rect x="' + (a + pad + i * 2 * w).toFixed(3) + '" y="' + (top + H - H * S[i]).toFixed(3) + '" width="' + w.toFixed(3) + '" height="' + (H * S[i]).toFixed(3) + '" rx="' + (w * .18).toFixed(3) + '" fill="' + (i === 2 ? '#14706E' : '#0C3234') + '"/>';
    $('qrbox').innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ' + (n + 8) + ' ' + (n + 8) + '" shape-rendering="crispEdges" role="img" aria-label="QR code"><g fill="#0C3234">' + out.join('') + '</g><g shape-rendering="geometricPrecision">' + bars + '</g></svg>';
    var ev = $('qev'); ev.textContent = EVENT; ev.hidden = false; Q.setAttribute('data-ev', '1');
  }
  if (EVENT) { var sc = document.createElement('script'); sc.src = '/shawnee/qrcode.js'; sc.onload = drawEventQR; document.head.appendChild(sc); }
  function openQR() { Q.hidden = false; drawEventQR(); $('qrx').focus(); }
  function closeQR() { Q.hidden = true; if (location.hash === '#qr') history.replaceState(null, '', location.pathname + location.search); $('shq').focus(); }
  $('shq').onclick = openQR; $('qrx').onclick = closeQR;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !Q.hidden) closeQR(); });
  if (location.hash === '#qr') openQR();

  // exchange details
  if (EVENT) $('met').value = EVENT;
  var t0 = Date.now();
  var MSG = { fn: T('ex.25'), ln: T('ex.26'), em: T('ex.27'), co: T('ex.28'), role: T('ex.29'), fail: T('ex.24') };
  function hash(s) { var a = 2166136261, b = 2654435761; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619) >>> 0; b = Math.imul(b ^ c, 2246822519) >>> 0; } return ('0000000' + a.toString(16)).slice(-8) + ('0000000' + b.toString(16)).slice(-8) + s.length.toString(16); }
  var form = $('exf');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = function (id) { return ($(id).value || '').trim(); };
    var d = { fn: v('fn'), ln: v('ln'), em: v('em'), co: v('co'), role: $('role').value, met: v('met'), note: v('note'), upd: $('upd').checked };
    ['fn', 'ln', 'em', 'co', 'role'].forEach(function (id) { $(id).removeAttribute('aria-invalid'); });
    var bad = !d.fn ? 'fn' : !d.ln ? 'ln' : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.em) ? 'em' : !d.co ? 'co' : !d.role ? 'role' : '';
    if (bad) { $('exerr').textContent = MSG[bad]; $(bad).setAttribute('aria-invalid', 'true'); $(bad).focus(); return; }
    $('exerr').textContent = '';
    function ok() { form.hidden = true; var o = $('exok'); o.hidden = false; o.setAttribute('tabindex', '-1'); o.focus(); }
    var elapsed = Date.now() - t0, trap = v('hpf');
    if (trap || elapsed < 2000) { ok(); return; }   // spam: looks sent, nothing is sent
    var when = new Date().toISOString(), roleText = $('role').options[$('role').selectedIndex].text;
    var F = [], add = function (n, val, o) { if (val !== '' && val != null) F.push({ objectTypeId: o || '0-1', name: n, value: String(val) }); };
    add('email', d.em); add('firstname', d.fn); add('lastname', d.ln); add('company', d.co); add('name', d.co, '0-2');
    if (d.role !== 'other') add('cr_contact_type', d.role);
    add('cr_form', 'Contact exchange'); add('cr_card_owner', 'Shawnee Mercier'); add('cr_card_channel', SRC);
    add('cr_marketing_consent', d.upd ? 'true' : 'false');
    if (d.met) { add('cr_heard_via', 'A conference or event'); add('cr_heard_via_detail', d.met); }
    var lines = ['Card exchange on thecapitalrow.com/shawnee', 'Card owner: Shawnee Mercier', 'Channel: ' + CHANNELS[SRC], 'I am: ' + roleText, 'Company: ' + d.co];
    if (d.met) lines.push('Where we met: ' + d.met);
    lines.push('Capital Row updates: ' + (d.upd ? 'Yes, opted in ' + when : 'No'));
    add('message', (d.note ? d.note + '\n\n' : '') + lines.join('\n'));
    var ctx = { pageUri: location.href.split('#')[0], pageName: document.title };
    var key = hash('Contact exchange|' + when.slice(0, 10) + '|' + JSON.stringify(F.filter(function (x) { return x.name !== 'message'; }).map(function (x) { return [x.name, x.value]; })));
    var btn = $('exsend'), label = btn.textContent; btn.disabled = true; btn.textContent = btn.getAttribute('data-busy');
    function fail() { btn.disabled = false; btn.textContent = label; $('exerr').textContent = MSG.fail; }
    function direct() {   // the site's server could not be reached: send the standard fields straight to HubSpot
      var url = 'https://api.hsforms.com/submissions/v3/integration/submit/247329185/8e02c346-11f0-4b2d-a17c-a596397264ee';
      var std = F.filter(function (x) { return x.objectTypeId === '0-1' && ['email', 'firstname', 'lastname', 'company', 'message'].indexOf(x.name) >= 0; });
      var min = std.filter(function (x) { return ['email', 'firstname', 'lastname', 'message'].indexOf(x.name) >= 0; });
      var post = function (fs) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: fs, context: ctx }) }).then(function (r) { return r.ok; }, function () { return false; }); };
      post(std).then(function (a) { return a || post(min); }).then(function (a) { if (a) ok(); else fail(); });
    }
    fetch('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ key: key, kind: 'Contact exchange', fields: F, context: ctx, consent: null, also: [], hp: trap, t: elapsed }) })
      .then(function (r) { return r.json().then(function (j) { return r.ok && j && j.saved === true; }, function () { return false; }); })
      .then(function (saved) { if (saved) ok(); else direct(); }, function () { direct(); });
  });
})();
