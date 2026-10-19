"""Card tests: the real /shawnee page and Pages Functions under `wrangler pages dev dist --d1 DB` (settings from .dev.vars)
against tools/mock_hubspot.py on :9911. Nothing leaves this machine. Run from the repository root:
  python3 tools/mock_hubspot.py 9911 &  npx wrangler pages dev dist --port 8788 --d1 DB &  python3 tools/card/card_test.py"""
import asyncio, json, os, re, sys, time, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from playwright.async_api import async_playwright
from pw import new_page
SITE, MOCK, KEY = 'http://127.0.0.1:8788/', 'http://127.0.0.1:9911/', 'testkey-123456'
CARD_FORM = '11111111-2222-3333-4444-555555555555'
RUN = str(int(time.time()))[-6:]
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def get(u, h=None):
    with op.open(urllib.request.Request(u, headers=h or {})) as r: return json.loads(r.read())
def post(u, body, h=None):
    hh = {'Content-Type': 'application/json'}; hh.update(h or {})
    try:
        with op.open(urllib.request.Request(u, data=json.dumps(body).encode(), headers=hh, method='POST')) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def log(): return get(MOCK + '_log')
def known(): get(MOCK + '_mode?known=cr_form,cr_contact_type,cr_card_owner,cr_card_channel,cr_card_event,cr_marketing_consent')
async def main():
    bad = []
    def ck(n, c, g=''):
        print(('ok   ' if c else 'FAIL ') + n + ('' if c else '  ' + repr(g)[:600]))
        if not c: bad.append(n)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def page(q='', w=390):
            ctx, pg = await new_page(b, w, 844); await ctx.route(re.compile(r'hsforms\.com|hubspot\.com|calendly'), lambda r: r.abort())
            await pg.goto(SITE + 'shawnee' + q, wait_until='load'); await pg.wait_for_timeout(500); return ctx, pg
        async def fill(pg, name, email, company='Test Capital', rel='buyer', msg='', updates=False):
            await pg.fill('#cn', name); await pg.fill('#ce', email); await pg.fill('#cc', company)
            if rel: await pg.select_option('#cr', rel)
            if msg: await pg.fill('#cm', msg)
            if updates: await pg.check('#cu')

        # 1. the page renders, at phone width, with no horizontal scroll and no script errors
        get(MOCK + '_reset'); known()
        ctx, pg = await page('?utm_source=nfc&utm_medium=business-card&utm_campaign=shawnee-card&utm_content=VSS Miami 2026')
        sw = await pg.evaluate('document.documentElement.scrollWidth'); ck('no horizontal scroll at 390px', sw <= 390, sw)
        await pg.screenshot(path=os.path.join(OUT, 'card-390-top.png'))
        await pg.screenshot(path=os.path.join(OUT, 'card-390-full.png'), full_page=True)
        body = await pg.inner_text('body')
        ck('name, title, email, LinkedIn shown', all(t in body for t in ['Shawnee Mercier', 'Founder & Managing Director', 'smercier@thecapitalrow.com', 'linkedin.com/in/smmercier']))
        ck('Wallet button hidden for a non-Apple browser even when a pass can be built', await pg.is_hidden('#wallet'))
        book = await pg.get_attribute('#book', 'href'); ck('booking link carries the channel and event', 'utm_campaign=nfc' in book and 'utm_content=vss-miami-2026' in book and book.startswith('https://calendly.com/caprow/'), book)
        ck('vCard link points at the vCard endpoint', await pg.get_attribute('#save', 'href') == '/shawnee/vcard')
        # QR toggle is a real button with aria-expanded
        await pg.click('#qrbtn'); ck('QR opens and says so', await pg.is_visible('#qrbox img') and await pg.get_attribute('#qrbtn', 'aria-expanded') == 'true')
        qr_ok = await pg.evaluate("document.querySelector('#qrbox img').naturalWidth > 0"); ck('QR image loads', qr_ok)
        await pg.click('#qrbtn'); ck('QR closes', await pg.is_hidden('#qrbox'))
        # accessibility: axe-core on the whole page
        await pg.add_script_tag(path='node_modules/axe-core/axe.min.js')
        res = await pg.evaluate("axe.run(document, {runOnly: ['wcag2a','wcag2aa','best-practice']}).then(r => r.violations.map(v => v.id + ': ' + v.nodes.length))")
        ck('axe: no WCAG A/AA or best-practice violations', not res, res)
        # 2. validation: empty submit shows field errors and focuses the first
        await pg.click('#send'); await pg.wait_for_timeout(200)
        ck('empty form: errors shown, nothing sent', (await pg.get_attribute('#cn', 'aria-invalid')) == 'true' and await pg.evaluate('document.activeElement.id') == 'cn' and not log()['hubspot'], await pg.inner_text('#cst'))
        await fill(pg, 'Test Buyer', 'not-an-email', rel='')
        await pg.click('#send'); await pg.wait_for_timeout(200)
        ck('bad email and no relationship flagged', await pg.inner_text('#ce-e') != '' and await pg.inner_text('#cr-e') != '' and await pg.inner_text('#cn-e') == '')
        # 3. a real exchange: saved, delivered to the card form, attribution kept, non-marketing unless opted in, then a task
        await pg.wait_for_timeout(3200)
        em = 'card.buyer+' + RUN + '@example.com'
        await fill(pg, 'Test Buyer Person', em, msg='Met at the summit.')
        await pg.click('#send'); await pg.wait_for_timeout(2500)
        ck('confirmation shown and focused', await pg.is_visible('#xdone') and 'Test, your details reached Shawnee' in await pg.inner_text('#xdone') and await pg.evaluate('document.activeElement.id') == 'xdone', await pg.inner_text('#xdone'))
        await pg.screenshot(path=os.path.join(OUT, 'card-390-confirmation.png'))
        hs = [e for e in log()['hubspot'] if e['answer'] == 200]
        f = {x['name']: x['value'] for x in hs[-1]['body']['fields']} if hs else {}
        ck('delivered once, to the card form', len(hs) == 1 and hs[0]['form'] == CARD_FORM, [(e['form'], e['answer']) for e in log()['hubspot']])
        ck('fields: name split, company, relationship', f.get('firstname') == 'Test' and f.get('lastname') == 'Buyer Person' and f.get('company') == 'Test Capital' and f.get('cr_contact_type') == 'buyer', f)
        ck('attribution: owner, channel, event', f.get('cr_card_owner') == 'shawnee-mercier' and f.get('cr_card_channel') == 'nfc' and f.get('cr_card_event') == 'vss-miami-2026', f)
        ck('updates not ticked -> cr_marketing_consent false', f.get('cr_marketing_consent') == 'false', f)
        ck('message carries everything for the notification', 'Relationship: Buyer or investor' in f.get('message', '') and 'Met at the summit.' in f.get('message', ''), f.get('message'))
        ctxt = hs[-1]['body'].get('context', {}) if hs else {}
        ck('page URI with its tags sent as context', 'utm_source=nfc' in ctxt.get('pageUri', ''), ctxt)
        ck('no legal-consent subscription sent (contact stays non-marketing)', 'legalConsentOptions' not in (hs[-1]['body'] if hs else {}))
        for _ in range(20):
            if log()['tasks']: break
            await asyncio.sleep(1)
        t = log()['tasks']
        ck('follow-up task created for the new contact, owned by Shawnee', len(t) == 1 and t[0]['properties']['hubspot_owner_id'] == '98756507' and t[0]['associations'][0]['types'][0]['associationTypeId'] == 204
           and 'Test Buyer Person, Test Capital' in t[0]['properties']['hs_task_subject'], t)
        st = get(SITE + 'api/status', {'X-Retry-Key': KEY})['recent']
        ck('both rows delivered in the store', {r['kind']: r['status'] for r in st if r['id'].startswith(st[0]['id'].split('-')[0])} == {'Contact exchange': 'delivered', 'Card task': 'delivered'}, st[:3])
        await ctx.close()

        # 4. opted in to updates
        get(MOCK + '_reset'); known()
        ctx, pg = await page('?utm_source=qr-print&utm_medium=business-card&utm_campaign=shawnee-card'); await pg.wait_for_timeout(3200)
        await fill(pg, 'Opt In', 'card.optin+' + RUN + '@example.com', rel='seller', updates=True); await pg.click('#send'); await pg.wait_for_timeout(2000)
        hs = [e for e in log()['hubspot'] if e['answer'] == 200]; f = {x['name']: x['value'] for x in hs[-1]['body']['fields']} if hs else {}
        ck('opt-in recorded; channel qr-print; no event', f.get('cr_marketing_consent') == 'true' and f.get('cr_card_channel') == 'qr-print' and 'cr_card_event' not in f and f.get('cr_contact_type') == 'seller', f)
        await ctx.close()

        # 5. a direct visit with no tags is "direct"; a reload keeps the first tags of the visit
        get(MOCK + '_reset'); known()
        ctx, pg = await page('?utm_source=wallet'); await pg.goto(SITE + 'shawnee'); await pg.wait_for_timeout(3300)
        await fill(pg, 'Reload Person', 'card.reload+' + RUN + '@example.com', rel='intermediary'); await pg.click('#send'); await pg.wait_for_timeout(1800)
        hs = [e for e in log()['hubspot'] if e['answer'] == 200]; f = {x['name']: x['value'] for x in hs[-1]['body']['fields']} if hs else {}
        ck('tags survive a reload in the same visit (wallet)', f.get('cr_card_channel') == 'wallet', f)
        ck('advisor sends Contact type intermediary', f.get('cr_contact_type') == 'intermediary', f)
        await ctx.close()
        ctx, pg = await page(''); await pg.wait_for_timeout(3300)
        await fill(pg, 'Direct Person', 'card.direct+' + RUN + '@example.com', rel='lender'); await pg.click('#send'); await pg.wait_for_timeout(1800)
        hs = [e for e in log()['hubspot'] if e['answer'] == 200]; f = {x['name']: x['value'] for x in hs[-1]['body']['fields']} if hs else {}
        ck('untagged visit recorded as direct', f.get('cr_card_channel') == 'direct', f)
        ck('lender maps to Contact type lender', f.get('cr_contact_type') == 'lender', f)
        await ctx.close()

        # 5b. links from the first version of the card (/shawnee/?src=&at=) still attribute correctly
        get(MOCK + '_reset'); known()
        ctx, pg = await page('/?src=screen&at=ACG Orange County')
        ck('old /shawnee/ link lands on /shawnee', pg.url.startswith(SITE + 'shawnee?'), pg.url)
        await pg.wait_for_timeout(3300); await fill(pg, 'Old Link', 'card.old+' + RUN + '@example.com'); await pg.click('#send'); await pg.wait_for_timeout(1800)
        hs = [e for e in log()['hubspot'] if e['answer'] == 200]; f = {x['name']: x['value'] for x in hs[-1]['body']['fields']} if hs else {}
        ck('old ?src=screen&at= maps to qr-screen and the event', f.get('cr_card_channel') == 'qr-screen' and f.get('cr_card_event') == 'acg-orange-county', f)
        await ctx.close()
        # 6. spam: a filled hidden field or a too-fast submission looks accepted but nothing is stored or sent
        get(MOCK + '_reset'); known()
        ctx, pg = await page('')
        await fill(pg, 'Bot Fast', 'bot.fast+' + RUN + '@example.com'); await pg.click('#send'); await pg.wait_for_timeout(1500)
        ck('too-fast submission screened, nothing sent', not log()['hubspot'] and await pg.is_visible('#xdone'))
        await ctx.close()
        ctx, pg = await page(''); await pg.wait_for_timeout(3300)
        await pg.evaluate("document.getElementById('hpw').value='http://spam.example'")
        await fill(pg, 'Bot Trap', 'bot.trap+' + RUN + '@example.com'); await pg.click('#send'); await pg.wait_for_timeout(1500)
        ck('honeypot submission screened, nothing sent', not log()['hubspot'])
        await ctx.close()
        # rate limit: the ninth exchange from one address in an hour is refused with a clear message
        codes = []
        for i in range(9):
            codes.append(post(SITE + 'api/submit', {'key': 'ratetest' + RUN + str(i), 'kind': 'Contact exchange', 'elapsed': 9000, 'fields': [{'name': 'email', 'value': 'rate%d+%s@example.com' % (i, RUN)}, {'name': 'message', 'value': 'x'}]}, {'CF-Connecting-IP': '203.0.113.9'})[0])
        ck('rate limit: eight an hour accepted, the ninth refused with 429', codes == [200] * 8 + [429], codes)
        # 7. HubSpot down: the page still says "received" because the server stored it, and the retry delivers it later
        get(MOCK + '_reset'); known(); get(MOCK + '_mode?fail=1&status=503')
        ctx, pg = await page('?utm_source=share'); await pg.wait_for_timeout(3300)
        em2 = 'card.retry+' + RUN + '@example.com'
        await fill(pg, 'Retry Person', em2, rel='other'); await pg.click('#send'); await pg.wait_for_timeout(1800)
        ck('HubSpot outage: stored and confirmed', await pg.is_visible('#xdone'))
        await asyncio.sleep(2); post(SITE + 'api/retry', {}, {'X-Retry-Key': KEY}); await asyncio.sleep(1); post(SITE + 'api/retry', {}, {'X-Retry-Key': KEY})
        hs = [e for e in log()['hubspot'] if e['answer'] == 200]
        ck('retry delivers it once HubSpot is back', any(any(x['name'] == 'email' and x['value'] == em2 for x in e['body']['fields']) for e in hs), [(e['form'], e['answer']) for e in log()['hubspot']])
        await ctx.close()
        # 8. the form server unreachable: the page sends straight to the card form; if that fails too, a clear error
        get(MOCK + '_reset'); known()
        ctx, pg = await page('')
        await ctx.unroute(re.compile(r'hsforms\.com|hubspot\.com|calendly'))
        await ctx.route('**/api/submit', lambda r: r.abort())
        await ctx.route(re.compile(r'api\.hsforms\.com'), lambda r: r.fulfill(status=200, body='{"inlineMessage":"Thanks"}', headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}))
        reqs = []; pg.on('request', lambda r: reqs.append(r.url) if 'hsforms' in r.url else None)
        await pg.wait_for_timeout(3300); await fill(pg, 'Fallback Person', 'card.fb+' + RUN + '@example.com'); await pg.click('#send'); await pg.wait_for_timeout(1500)
        ck('server unreachable: sent straight to the card form and confirmed', any(CARD_FORM in u for u in reqs) and await pg.is_visible('#xdone'), reqs)
        await ctx.close()
        ctx, pg = await page('')
        await ctx.route('**/api/submit', lambda r: r.abort()); await ctx.route(re.compile(r'api\.hsforms\.com'), lambda r: r.abort())
        await pg.wait_for_timeout(3300); await fill(pg, 'Error Person', 'card.err+' + RUN + '@example.com'); await pg.click('#send'); await pg.wait_for_timeout(1500)
        msg = await pg.inner_text('#cst')
        ck('both routes down: error with the email address, form kept and re-enabled', 'could not be sent' in msg and 'smercier@thecapitalrow.com' in msg and await pg.is_enabled('#send') and await pg.input_value('#cn') == 'Error Person', msg)
        await pg.screenshot(path=os.path.join(OUT, 'card-390-error.png'))
        await ctx.close()
        # 9. Safari on iPhone: the Wallet button appears when the server can sign a pass
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
        pg = await ctx.new_page(); await pg.goto(SITE + 'shawnee'); await pg.wait_for_timeout(800)
        ck('iPhone: Wallet button shown when a pass can be built', await pg.is_visible('#wallet'))
        await pg.screenshot(path=os.path.join(OUT, 'card-390-iphone.png'))
        await ctx.close()
        # desktop look
        ctx, pg = await page('', 1280); await pg.screenshot(path=os.path.join(OUT, 'card-1280.png'), full_page=True); await ctx.close()
        await b.close()
    print('\n%d failed' % len(bad) if bad else '\nall passed')
    sys.exit(1 if bad else 0)
asyncio.run(main())
