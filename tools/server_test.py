"""Rev 13.6 delivery tests: the real pages, the real Pages Functions and a local D1 database (wrangler pages dev), with a
stand-in for HubSpot that refuses cr_ properties the way the live portal does today. Nothing is sent outside this machine."""
import asyncio, json, re, urllib.request
from playwright.async_api import async_playwright
from pw import new_page
import time
RUN = str(int(time.time()))[-6:]   # new answers on every run: the same answers the same day are one submission by design
SITE, MOCK, KEY = 'http://127.0.0.1:8788/', 'http://127.0.0.1:9911/', 'testkey-123456'
MAIN, SEAT = '8e02c346-11f0-4b2d-a17c-a596397264ee', '2252081f-64ac-4259-925b-0bd99f4fb517'
def get(u, headers=None):
    with urllib.request.urlopen(urllib.request.Request(u, headers=headers or {})) as r: return json.loads(r.read())
def post(u, body=None, headers=None):
    h = {'Content-Type': 'application/json'}; h.update(headers or {})
    req = urllib.request.Request(u, data=json.dumps(body or {}).encode(), headers=h, method='POST')
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def log(): return get(MOCK + '_log')
def reset(**mode):
    get(MOCK + '_reset')
    if mode: get(MOCK + '_mode?' + '&'.join('%s=%s' % kv for kv in mode.items()))
def status(): return get(SITE + 'api/status', {'X-Retry-Key': KEY})
def row(i): return next((r for r in status()['recent'] if r['id'] == i), None)
def retry(): return post(SITE + 'api/retry', {}, {'X-Retry-Key': KEY})[1]
ALL_CR = ','.join(['cr_form', 'cr_side', 'cr_kind', 'cr_sector', 'cr_industry', 'cr_revenue_band', 'cr_heard_via', 'cr_heard_via_detail', 'cr_sector_updates', 'cr_sms_consent', 'cr_criteria_on_file',
                   'cr_reason', 'cr_owner_session', 'cr_capital_model', 'cr_acquisition_context', 'cr_platform_name', 'cr_ownership', 'cr_sector_firm', 'cr_industry_firm', 'cr_business_model', 'cr_geography',
                   'cr_geography_detail', 'cr_customer_markets', 'cr_rev_min', 'cr_rev_max', 'cr_arr_min', 'cr_arr_max', 'cr_ebitda_min', 'cr_ebitda_max', 'cr_ev_min', 'cr_ev_max', 'cr_equity_min', 'cr_equity_max',
                   'cr_range_flags', 'cr_profitability', 'cr_revenue_model', 'cr_recurring_pref', 'cr_regulated_appetite', 'cr_owner_after_close', 'cr_timing', 'cr_funding_status', 'cr_exclusions', 'cr_details',
                   'cr_main_reason', 'cr_stage', 'cr_revenue_ltm', 'cr_adjusted_earnings_ltm', 'cr_sector_followed', 'cr_client_type', 'cr_loan_min', 'cr_loan_max', 'cr_cash_flow_appetite'])
async def main():
    bad = []
    def ck(n, c, g=''):
        print(('ok   ' if c else 'FAIL ') + n + ('' if c else '  ' + repr(g)[:700]))
        if not c: bad.append(n)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def page(path, w=1280):
            ctx, pg = await new_page(b, w, 1000); await ctx.route(re.compile(r'hs-scripts|hsforms\.com|hubspot\.com'), lambda r: r.abort())
            await pg.goto(SITE + path, wait_until='load'); await pg.wait_for_timeout(600); await pg.evaluate("document.querySelectorAll('.ck').forEach(e=>e.remove())"); return ctx, pg
        async def pick(pg, pid, ind, n=1):
            await pg.evaluate("([p,i,n])=>{[...document.querySelectorAll('#'+p+' .spgt')].find(t=>t.parentNode.getAttribute('data-ind')===i).click();const c=document.querySelectorAll('#'+p+' .spg[data-ind='+i+'] input');for(let k=0;k<n;k++)c[k].click();}", [pid, ind, n])
        def sent_bodies(kind=None, form=None):
            out = []
            for e in log()['hubspot']:
                f = {x['name']: x['value'] for x in (e['body'] or {}).get('fields', [])}
                if (kind is None or f.get('cr_form') == kind or kind in f.get('message', '')) and (form is None or e['form'] == form): out.append((e, f))
            return out

        # ---------- 1. buyer, short form: saved, then delivered with the cr_ properties HubSpot does not have dropped
        reset()
        ctx, pg = await page('index.html')
        await pg.evaluate("document.querySelector('#nv a.cta').click()"); await pg.wait_for_timeout(400)
        await pg.select_option('#seat', 'Buyer'); await pg.wait_for_timeout(300); await pg.select_option('#kind', 'Private equity fund')
        await pick(pg, 'vert', 'hc', 2)
        await pg.fill('#nm', 'Test Buyer'); await pg.fill('#em', 'test.buyer+'+RUN+'@example.com'); await pg.fill('#co', 'Test Capital'); await pg.select_option('#how', 'LinkedIn'); await pg.fill('#msg', 'Test thesis')
        await pg.evaluate("document.getElementById('onfile').click()")
        await pg.click('#f button[type=submit]'); await pg.wait_for_timeout(2500)
        msg = await pg.inner_text('#formmsg')
        ck('buyer sees "received" after the server saved it', msg.startswith('Your acquisition criteria have been received') and 'test.buyer+'+RUN+'@example.com' in msg, msg)
        rows = status()['recent']; r0 = rows[0] if rows else {}
        ck('one row, delivered', r0.get('kind') == 'Conversation' and r0.get('status') == 'delivered' and r0.get('attempts') == 1, r0)
        hs = log()['hubspot']
        ck('HubSpot refused the missing cr_ properties, the rest was delivered', len(hs) == 2 and hs[0]['answer'] == 400 and hs[1]['answer'] == 200 and hs[1]['form'] == MAIN and hs[1]['portal'] == '247329185', [(e['answer'], e['form']) for e in hs])
        f = {x['name']: x['value'] for x in hs[-1]['body']['fields']} if hs else {}
        ck('delivered fields: email, names, company, message with every answer', f.get('email') == 'test.buyer+'+RUN+'@example.com' and f.get('firstname') == 'Test' and f.get('lastname') == 'Buyer' and f.get('company') == 'Test Capital'
           and 'Kind: Private equity fund' in f.get('message', '') and 'Sectors: ' in f.get('message', '') and 'Test thesis' in f.get('message', '') and not any(k.startswith('cr_') for k in f), f)
        ck('dropped properties recorded for Gonzalo', 'cr_side' in (r0.get('dropped') or '') and 'cr_sector' in (r0.get('dropped') or ''), r0.get('dropped'))
        ck('hutk-free context carries the page', hs and hs[-1]['body']['context'].get('pageUri', '').startswith(SITE), hs[-1]['body']['context'] if hs else '')
        # ---------- 2. the same answers again: a duplicate, not a second lead
        await pg.evaluate("document.querySelector('#nv a.cta').click()"); await pg.wait_for_timeout(300)
        st, j = 0, {}
        body = await pg.evaluate("""()=>{const d=fieldValues();return d;}""")
        ck('form reset after success', body.get('email', '') == '', body.get('email'))
        await ctx.close()
        # replay the exact request the page made
        reset(known=ALL_CR)
        ctx, pg = await page('index.html'); reqs = []
        pg.on('request', lambda rq: reqs.append(rq.post_data) if rq.url.endswith('/api/submit') else None)
        await pg.evaluate("document.querySelector('#nv a.cta').click()"); await pg.wait_for_timeout(400)
        await pg.select_option('#seat', 'Seller'); await pg.wait_for_timeout(300); await pg.select_option('#kind', 'Hybrid models'); await pg.select_option('#sl_reason', 'Preparing for a sale'); await pg.select_option('#band', 'Under $5M ARR')
        await pick(pg, 'vert', 'fin', 1)
        await pg.fill('#nm', 'Test Owner'); await pg.fill('#em', 'test.owner+'+RUN+'@example.com'); await pg.evaluate("document.getElementById('osbox')&&document.getElementById('osbox').click()")
        await pg.click('#f button[type=submit]'); await pg.wait_for_timeout(2500)
        ck('owner confirmation', (await pg.inner_text('#formmsg')).startswith('Your request has been received'))
        sb = json.loads(reqs[0]) if reqs else {}
        st, j = post(SITE + 'api/submit', sb, {'Origin': SITE.rstrip('/')})
        ck('same key again: saved, marked duplicate', st == 200 and j.get('saved') is True and j.get('duplicate') is True, (st, j))
        await pg.wait_for_timeout(800)
        main = sent_bodies(form=MAIN); seat = sent_bodies(form=SEAT)
        ck('delivered once to HubSpot, not twice', len(main) == 1 and main[0][0]['answer'] == 200, len(main))
        mf = main[0][1] if main else {}
        ck('with properties in place, typed values arrive', mf.get('cr_side') == 'Seller' and mf.get('cr_kind') == 'Hybrid models' and mf.get('cr_reason') == 'Preparing for a sale' and mf.get('cr_industry') == 'fin'
           and mf.get('cr_sector', '').startswith('fin_') and mf.get('cr_sms_consent') == 'false' and mf.get('cr_owner_session') == 'true', {k: v for k, v in mf.items() if k.startswith('cr_')})
        ck('the owner session seat goes to the seat form as its own submission', len(seat) == 1 and seat[0][1].get('email') == 'test.owner+'+RUN+'@example.com' and seat[0][1].get('cr_owner_session') == 'true', [s[1] for s in seat])
        await ctx.close()

        # ---------- 3. HubSpot down: saved, shown received, retried until delivered
        reset(fail=2, status=503, known=ALL_CR)
        ctx, pg = await page('reserve/index.html')
        await pg.fill('#stnm', 'Test Seat'); await pg.fill('#stem', 'test.seat+'+RUN+'@example.com'); await pg.select_option('#strole', 'CPA or accountant')
        await pick(pg, 'stsec', 'built', 1)
        await pg.click('#stf button[type=submit]'); await pg.wait_for_timeout(2500)
        txt = await pg.inner_text('#stmsg')
        ck('HubSpot down: the visitor still gets "reserved", because the seat is saved', txt.startswith('Your seat is reserved'), txt)
        rr = status()['recent'][0]
        ck('row waits for a retry', rr['status'] == 'retry' and rr['attempts'] in (1, 2) and 'hubspot 503' in (rr['last_error'] or ''), rr)
        r1 = retry(); r2 = retry(); rr = row(rr['id'])
        ck('retries deliver it', rr['status'] == 'delivered' and rr['attempts'] == 3, (r1, r2, rr))
        hs = sent_bodies(form=SEAT)
        ck('three attempts reached HubSpot, the last accepted', [e[0]['answer'] for e in hs] == [503, 503, 200] and hs[-1][1].get('cr_kind') == 'CPA or accountant' and hs[-1][1].get('cr_side') == 'Advisor', [(e[0]['answer']) for e in hs])
        await ctx.close()

        # ---------- 4. a refusal a retry cannot fix: failed at once, alert by email and webhook
        reset(invalid=1)
        ctx, pg = await page('pre-market-assessment/index.html')
        await pg.evaluate("document.querySelector('#request .fpopen').click()"); await pg.wait_for_timeout(400)
        await pg.fill('#pqnm', 'Test Assess'); await pg.fill('#pqem', 'test.assess+'+RUN+'@example.com'); await pg.select_option('#pqkind', 'Services'); await pick(pg, 'pqsec', 'prof', 1)
        await pg.click('#pqf button[type=submit]'); await pg.wait_for_timeout(2500)
        rr = status()['recent'][0]; lg = log()
        ck('saved, then failed on a permanent refusal', rr['kind'] == 'Pre-Market Assessment request' and rr['status'] == 'failed' and 'INVALID_EMAIL' in (rr['last_error'] or ''), rr)
        em = lg['emails'][-1] if lg['emails'] else {}
        ck('alert email to team@thecapitalrow.com, with the address and the error', em.get('auth') == 'Bearer re_test' and em.get('body', {}).get('to') == ['team@thecapitalrow.com'] and 'test.assess+'+RUN+'@example.com' in em.get('body', {}).get('text', '')
           and 'Pre-Market Assessment request' in em.get('body', {}).get('subject', ''), em)
        ck('alert webhook as well', lg['alerts'] and 'not delivered' in lg['alerts'][-1].get('text', ''), lg['alerts'][-1:] if lg['alerts'] else None)
        ck('the visitor saw "received" because the request is saved', (await pg.inner_text('#pqmsgbox')).startswith('Received.'))
        await ctx.close()

        # ---------- 5. a long outage: every attempt used, then failed and alerted once
        reset(fail=50, status=500)
        ctx, pg = await page('report/index.html')
        await pg.evaluate("document.querySelector('.fpopen').click()"); await pg.wait_for_timeout(400)
        await pg.select_option('#bdwhy1', 'Financing'); await pg.fill('#bdem', 'test.report+'+RUN+'@example.com')
        await pg.click('#bdf button[type=submit]'); await pg.wait_for_timeout(2500)
        rid = status()['recent'][0]['id']
        for _ in range(10): retry()
        rr = row(rid); lg = log()
        ck('after nine attempts it is failed and alerted once', rr['status'] == 'failed' and rr['attempts'] == 9 and len(lg['emails']) == 1 and len(lg['alerts']) == 1, (rr, len(lg['emails']), len(lg['alerts'])))
        sr = retry()
        ck('the retry report shows the failure, which fails the scheduled check', sr.get('failed_recent', 0) >= 1, sr)
        await ctx.close()

        # ---------- 6. "received" appears only when the server says saved
        reset(known=ALL_CR)
        ctx, pg = await page('capital-connections/index.html')
        await pg.route('**/api/submit', lambda r: asyncio.ensure_future(slow(r)))
        async def slow(r):
            await asyncio.sleep(2.5); await r.continue_()
        await pg.evaluate("document.querySelector('#inquiry .fpopen').click()"); await pg.wait_for_timeout(400)
        await pg.evaluate("""(()=>{const f=document.querySelector('#ccf');f.querySelectorAll('select').forEach(s=>{if(!s.value&&s.options.length>1){s.selectedIndex=1;s.dispatchEvent(new Event('change',{bubbles:true}));}});
          f.querySelectorAll('input').forEach(i=>{if(i.type==='checkbox'||i.type==='tel'||i.type==='search'||i.value)return;i.value=i.type==='email'?'test.cc+RUNID@example.com':'Test';});})()""".replace('RUNID', RUN))
        await pick(pg, 'ccsec', 'hc', 1)
        await pg.click('#ccf button[type=submit]'); await pg.wait_for_timeout(900)
        mid = await pg.inner_text('#ccmsg')
        ck('while the server is still saving, the page says Sending, not received', 'received' not in mid.lower(), mid)
        await pg.wait_for_timeout(3000)
        ck('after the save, received', 'received for review' in (await pg.inner_text('#ccmsg')))
        await ctx.close()
        ctx, pg = await page('capital-connections/index.html')
        async def tamper(r):
            d = json.loads(r.request.post_data); [x.update(value='Bogus') for x in d['fields'] if x['name'] == 'cr_stage']; await r.continue_(post_data=json.dumps(d))
        await pg.route('**/api/submit', lambda r: asyncio.ensure_future(tamper(r)))
        await pg.evaluate("document.querySelector('#inquiry .fpopen').click()"); await pg.wait_for_timeout(400)
        await pg.evaluate("""(()=>{const f=document.querySelector('#ccf');f.querySelectorAll('select').forEach(s=>{if(!s.value&&s.options.length>1){s.selectedIndex=1;s.dispatchEvent(new Event('change',{bubbles:true}));}});
          f.querySelectorAll('input').forEach(i=>{if(i.type==='checkbox'||i.type==='tel'||i.type==='search'||i.value)return;i.value=i.type==='email'?'test.cc2@example.com':'Test';});})()""")
        await pick(pg, 'ccsec', 'hc', 1); n0 = len(status()['recent'])
        await pg.click('#ccf button[type=submit]'); await pg.wait_for_timeout(2500)
        t2 = await pg.inner_text('#ccmsg')
        ck('a choice that is not on the list is refused by the server, and the page says it did not send', 'did not send' in t2 and len(status()['recent']) == n0, t2)
        await ctx.close()

        # ---------- 7. every other form: buy box, follow, valuation calculator
        reset(known=ALL_CR)
        ctx, pg = await page('buy-box/index.html')
        await pg.fill('#bbnm', 'Test Box'); await pg.fill('#bbem', 'test.box+'+RUN+'@example.com'); await pg.select_option('#bb_kind', 'Family office'); await pick(pg, 'bb_vert', 'fleet', 2)
        await pg.evaluate("document.querySelectorAll('#bb_model input')[0].click();document.querySelectorAll('#bb_geo input')[0].click();document.querySelectorAll('#bb_geo input')[1].click()")
        await pg.type('#bb_rev_min', '5000000'); await pg.evaluate("document.getElementById('bb_rev_nomax').click()"); await pg.type('#bb_arr_min', '3m')
        await pg.select_option('#bb_profit', 'Profitable required'); await pg.select_option('#bb_timing', 'Acquiring now'); await pg.select_option('#bb_funding', 'Committed capital')
        await pg.click('#bbf button[type=submit]'); await pg.wait_for_timeout(2500)
        ck('buy box received', 'have been received' in await pg.inner_text('#bbmsg'))
        bx = sent_bodies('Buy box'); bf = bx[-1][1] if bx else {}
        ck('buy box typed values', bf.get('cr_rev_min') == '5000000' and 'cr_rev_max' not in bf and bf.get('cr_arr_min') == '3000000' and bf.get('cr_range_flags') == 'Annual revenue: no maximum'
           and bf.get('cr_geography') == 'United States;Canada' and bf.get('cr_business_model') == 'Vertical software' and bf.get('cr_sector', '').count(';') == 1 and bf.get('cr_criteria_on_file') == 'true', {k: v for k, v in bf.items() if k.startswith('cr_')})
        await ctx.close()
        ctx, pg = await page('index.html')
        await pg.evaluate("location.hash='#follow'"); await pg.wait_for_timeout(600)
        await pick(pg, 'snsec', 'hosp', 2); await pg.fill('#snem', 'test.follow+'+RUN+'@example.com'); await pg.click('.snb'); await pg.wait_for_timeout(2500)
        fm = await pg.inner_text('#snm')
        fx = sent_bodies('Follow a sector'); ff = fx[-1][1] if fx else {}
        ck('follow: names in the confirmation, ids to HubSpot', fm.startswith('You are following ') and ff.get('cr_sector_followed', '').startswith('hosp_') and ff['cr_sector_followed'].count(';') == 1, (fm, ff.get('cr_sector_followed')))
        await ctx.close()
        ctx, pg = await page('sellers/index.html')
        await pg.click('#vcb'); await pg.wait_for_timeout(400)
        await pg.fill('#vcrev', '8,000,000'); await pg.fill('#vcearn', '1,500,000')
        for sid, val in (('vcgrow', '5% to 15%'), ('vckind', 'Vertical software, SaaS'), ('vcrec', '50% to 75%'), ('vctop', '10% to 25%'), ('vcreg', 'No'), ('vcinv', 'Leave at closing')): await pg.select_option('#' + sid, val)
        await pg.click('#vcf1 button[type=submit]'); await pg.wait_for_timeout(200)
        await pg.fill('#vcco', 'Test Co ' + RUN); await pg.select_option('#vcrole', label='Owner or founder'); await pg.fill('#vcfn', 'Test'); await pg.fill('#vcln', 'Calc'); await pg.fill('#vcem', 'test.calc+' + RUN + '@example.com')
        await pg.select_option('#vcwhen', label='12 to 24 months'); await pg.click('#vcf2 button[type=submit]'); await pg.wait_for_timeout(2000)
        vx = sent_bodies('Valuation calculator'); vf = vx[-1][1] if vx else {}
        ck('valuation calculator saved and delivered', 'Your answers are with us' in await pg.inner_text('#vcsent') and vf.get('cr_revenue_ltm') == '8000000', vf.get('cr_revenue_ltm'))
        await ctx.close()

        # ---------- 8. the server's own guards
        st, j = post(SITE + 'api/submit', {'key': 'abcdef1234', 'kind': 'Conversation', 'fields': [{'name': 'email', 'value': 'x@example.com'}, {'name': 'firstname', 'value': 'X'}]}, {'Origin': 'https://evil.example'})
        ck('another site cannot post', st == 403, (st, j))
        st, j = post(SITE + 'api/submit', {'key': 'abcdef1234', 'kind': 'Conversation', 'fields': [{'name': 'firstname', 'value': 'X'}]})
        ck('no email: refused, nothing saved', st == 400 and 'email' in j.get('fields', []), (st, j))
        st, j = post(SITE + 'api/submit', {'key': 'abcdef1235', 'kind': 'Conversation', 'fields': [{'name': 'email', 'value': 'x@example.com'}, {'name': 'firstname', 'value': 'X'}, {'name': 'cr_sector', 'value': 'hc_not_a_sector'}]})
        ck('a sector id that is not in the taxonomy: refused', st == 400 and 'sector:cr_sector' in j.get('fields', []), (st, j))
        st, j = post(SITE + 'api/submit', {'key': 'abcdef1236', 'kind': 'Conversation', 'fields': [{'name': 'email', 'value': 'x@example.com'}, {'name': 'firstname', 'value': 'X'}, {'name': 'hs_lead_status', 'value': 'NEW'}]})
        ck('a property the site never sends: refused', st == 400, (st, j))
        st, j = post(SITE + 'api/retry', {})
        ck('retry needs the key', st == 401, st)
        s = status()
        ck('status lists the HubSpot properties that were missing', 'cr_side' in s.get('hubspot_properties_missing_last_7_days', {}), s.get('hubspot_properties_missing_last_7_days'))
        await b.close()
    print('FAILED', len(bad))
asyncio.run(main())
