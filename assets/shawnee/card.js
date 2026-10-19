// Shawnee Mercier's card page (thecapitalrow.com/shawnee): contact links, sharing, QR screen and the exchange-details form.
// The form posts straight to HubSpot form 065ddb74 (Business Card: Shawnee), dropping any field HubSpot says is not on the form.
// Attribution: ?src= is the channel in HubSpot's values (wallet, nfc, qr-print, qr-screen, share, vcard, direct, other; no tag = direct);
// ?at= is the event tag, for example acg-la-2026. Both travel with the form to HubSpot.
(function () {
  var B = document.body, BASE = B.getAttribute('data-url'), PHONE = B.getAttribute('data-phone') || '';
  var $ = function (id) { return document.getElementById(id); };
  var T = function (k) { var e = document.querySelector('[data-t="' + k + '"]'); return e ? e.textContent : ''; };
  // ?src= takes HubSpot's Card channel values; the older short tags (qr, screen, link, email) still work, so cards already printed with ?src=qr count as qr-print
  var CHANNELS = { wallet: 'Apple Wallet pass', nfc: 'NFC card tap', 'qr-print': 'Printed card QR', 'qr-screen': 'QR on Shawnee’s phone', share: 'Shared link', vcard: 'Saved contact', direct: 'Direct visit', other: 'Other' };
  var ALIAS = { qr: 'qr-print', screen: 'qr-screen', link: 'share', email: 'other' };
  var q = {}; try { var u = new URLSearchParams(location.search); q.src = u.get('src'); q.at = u.get('at'); } catch (x) {}
  var s0 = (q.src || '').toLowerCase(); s0 = ALIAS[s0] || s0; var SRC = CHANNELS[s0] ? s0 : 'direct';
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
    var url = withEvent('share');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast(T('share.4')); }, function () { window.prompt('', url); });
    else window.prompt('', url);
  }
  $('shc').onclick = copy;
  $('shs').onclick = function () {
    if (navigator.share) navigator.share({ title: document.title, text: document.querySelector('.pos').textContent, url: withEvent('share') }).catch(function () {});
    else copy();
  };

  // QR screen. With an event (?at=ACG) the code is drawn here so scans carry the event; otherwise the built-in code is used.
  var Q = $('qrfull');
  function drawEventQR() {
    if (!EVENT || !window.qrcode || Q.getAttribute('data-ev')) return;
    var qr = window.qrcode(0, 'H'); qr.addData(withEvent('qr-screen')); qr.make();
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
    if (trap || elapsed < 3000) { ok(); return; }   // spam: hidden field filled in, or sent under 3 seconds after the page opened: looks sent, nothing is sent
    var when = new Date().toISOString(), roleText = $('role').options[$('role').selectedIndex].text;
    // Sent straight to HubSpot's "Business Card: Shawnee" form (no embed code). Field names as HubSpot has them.
    // HubSpot's Card channel values (read October 18, 2026): wallet, nfc, qr-print, qr-screen, share, vcard, direct, other
    var F = [], add = function (n, val, o) { if (val !== '' && val != null) F.push({ objectTypeId: o || '0-1', name: n, value: String(val) }); };
    add('firstname', d.fn); add('lastname', d.ln); add('email', d.em); add('company', d.co); add('name', d.co, '0-2');
    if (d.role !== 'other') add('cr_contact_type', d.role);              // "Something else" sends nothing
    add('cr_card_owner', 'shawnee-mercier'); add('cr_card_channel', SRC); add('cr_card_event', EVENT);
    add('cr_marketing_consent', d.upd ? 'true' : 'false');
    // every answer is also written into the message, so nothing is lost when HubSpot drops a field
    var lines = ['Card exchange on thecapitalrow.com/shawnee', 'Card owner: Shawnee Mercier', 'Channel: ' + CHANNELS[SRC] + ' (' + SRC + ')',
      'Event from the link: ' + (EVENT || 'none'), 'Which side of the table: ' + roleText, 'Company: ' + d.co];
    if (d.met) lines.push('Where we met: ' + d.met);
    lines.push('Capital Row updates: ' + (d.upd ? 'Yes, opted in ' + when : 'No'));
    add('message', (d.note ? d.note + '\n\n' : '') + lines.join('\n'));
    var ctx = { pageUri: location.href.split('#')[0], pageName: document.title };
    var hutk = (document.cookie.match(/(?:^|;\s*)hubspotutk=([^;]+)/) || [])[1]; if (hutk) ctx.hutk = hutk;
    var btn = $('exsend'), label = btn.textContent; btn.disabled = true; btn.textContent = btn.getAttribute('data-busy');
    function fail(detail) { btn.disabled = false; btn.textContent = label; $('exerr').textContent = MSG.fail + (detail ? ' (HubSpot: ' + detail + ')' : ''); }
    var URL = 'https://api.hsforms.com/submissions/v3/integration/submit/247329185/065ddb74-fd13-4f6a-9442-baf9b73406fc';
    // Same rule as the website forms: a field HubSpot answers FIELD_NOT_IN_FORM_DEFINITION for is dropped and the rest is sent again;
    // any other error is shown. Email and message are never dropped.
    function send(fields, round) {
      fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: fields, context: ctx }) })
        .then(function (r) {
          if (r.ok) { ok(); return; }
          return r.text().then(function (t) {
            var j = null; try { j = JSON.parse(t); } catch (x) {}
            var errs = (j && j.errors) || [];
            var notInForm = errs.length && errs.every(function (e) { return e.errorType === 'FIELD_NOT_IN_FORM_DEFINITION'; });
            if (r.status !== 400 || !notInForm || round >= 8) { fail((errs[0] && errs[0].message) || (j && j.message) || ('status ' + r.status)); return; }
            var bad = [];
            errs.forEach(function (e) { var m = /fields\.([A-Za-z0-9_]+)/.exec(e.message || '') || /Field '([^']+)'/.exec(e.message || ''); if (m) bad.push(m[1]); });
            if (!bad.length) bad = fields.filter(function (f) { return f.name.indexOf('cr_') === 0 || f.objectTypeId === '0-2'; }).map(function (f) { return f.name; });
            bad = bad.filter(function (n) { return n !== 'email' && n !== 'message'; });
            var next = fields.filter(function (f) { return bad.indexOf(f.name) < 0; });
            if (!bad.length || next.length === fields.length) { fail(errs[0].message); return; }
            send(next, round + 1);
          });
        }, function () { fail(''); });
    }
    send(F, 1);
  });
})();
