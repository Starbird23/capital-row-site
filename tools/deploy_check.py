"""Pre-deploy check of a built site: every link and anchor, every image, external links by request,
British spellings and common misspellings in the visible text, placeholders, meta uniqueness, one h1, orphan pages.
Usage: python3 deploy_check.py <dist> [--no-external]"""
import os, re, sys, glob, json, html as H, concurrent.futures, urllib.request, urllib.error, ssl
from spellchecker import SpellChecker

DIST = sys.argv[1]; EXTERNAL = '--no-external' not in sys.argv
PAGES = sorted(os.path.relpath(p, DIST) for p in glob.glob(DIST + '/**/*.html', recursive=True))
def rd(p): return open(p, encoding='utf-8').read()

def visible(h):
    t = re.sub(r'<script.*?</script>|<style.*?</style>|<!--.*?-->', ' ', h, flags=re.S)
    t = re.sub(r'<(?:select)[^>]*>.*?</select>', lambda m: ' ' + ' '.join(re.findall(r'<option[^>]*>([^<]*)', m.group(0))) + ' ', t, flags=re.S)
    alts = ' '.join(re.findall(r'(?:alt|title|aria-label|placeholder|content)="([^"]*)"', t))
    t = re.sub(r'<[^>]+>', ' ', t)
    return H.unescape(t + ' ' + alts)

# ---- British spellings and misspellings ----
BRITISH = '''colour favour favourite honour humour labour neighbour behaviour behavioural flavour harbour rumour vapour vigour endeavour
odour parlour candour clamour armour savour valour splendour tumour
centre centres metre metres litre fibre theatre calibre sombre lustre sabre spectre
licence licences defence offence pretence practise practised practising
analyse analysed analysing catalyse paralyse
organise organised organising organisation organisations realise realised realising realisation recognise recognised recognising
specialise specialised specialising specialisation summarise summarised prioritise prioritised prioritisation optimise optimised optimisation
minimise minimised maximise maximised utilise utilised utilisation finalise finalised capitalise capitalised capitalisation emphasise emphasised
categorise categorised standardise standardised standardisation normalise normalised normalisation monetise monetised monetisation
digitise digitised authorise authorised authorisation apologise criticise criticised amortisation amortised itemise itemised customise customised
scrutinise scrutinised characterise characterised stabilise stabilised formalise formalised legitimise localise centralise centralised
programme programmes catalogue analogue dialogue cheque cheques enquiry enquiries enquire acknowledgement acknowledgements judgement judgements
ageing grey mould plough draught tyre pyjamas aluminium sceptical sceptic jewellery storey kerb
towards afterwards whilst amongst learnt spelt dreamt burnt leant
modelling modelled labelling labelled cancelled cancelling travelled travelling signalled totalled levelled fuelled channelled equalled dialled
counsellor counsellors marvellous skilful wilful fulfil fulfils enrol enrolment instalment instalments instil distil
focussed focussing biassed
paediatric orthopaedic anaesthesia anaesthetic haematology haemorrhage oesophagus oestrogen gynaecology leukaemia diarrhoea oedema foetal encyclopaedia mediaeval
speciality specialities aeroplane maths tonne sulphur artefact cosy gaol'''.split() + ['per cent']
MISSPELT = '''aquisition aquisitions acquisiton recieve recieved seperate seperately occured occuring accomodate definately succesful buisness
managment finacial finanical adress adresses calender comittee commitee concensus enviroment goverment independant liason neccessary
occassion occurence posession prefered refered relevent restaraunt wich untill teh thier recieve wierd acheive beleive begining
transfered transfering benifit benifits garantee guarentee lisence liscense maintainance mantain mispell noticable persue priviledge
publically recomend recomendation reccomend reccommend seige sieze supercede tommorow truely withold writen writting
entreprenuer entrepeneur entreprenur strenght lenght heigth wiegh seperation judgement'''.split()
BRIT_RE = re.compile(r'\b(' + '|'.join(re.escape(w) for w in sorted(set(BRITISH) | set(MISSPELT), key=len, reverse=True)).replace(r'per\ cent', r'per cent') + r')\b', re.I) if False else re.compile(r'\b(' + '|'.join(re.escape(w) for w in sorted(set(BRITISH) | set(MISSPELT), key=len, reverse=True)) + r')\b', re.I)
PLACEHOLDER_RE = re.compile(r'lorem ipsum|\bTODO\b|\bTBD\b|\bXXX\b|\{\{|\}\}|\bundefined\b|\bNaN\b|\[placeholder\]|\bplaceholder text\b|\bInsert \w+ here\b', re.I)

sp = SpellChecker(language='en', distance=1)
KNOWN = set('''saas qoe ebitda arr sba cpa cpas llc lp lps m&a loi lois nda ndas cim cims pe sop sops faq faqs kpi kpis dso dpo ar ap gaap
ltv cac nrr grr churn ehr emr rcm pms crm erp api apis hubspot sanity cloudflare calendly linkedin youtube ltd inc
capital row thecapitalrow caprow dana point ca usc keck mercier shawnee nazeri eskenazi banneker aness gonzalo
denials clearinghouse credentialing med spa dme infusion telehealth hospice rehab orthopedic payer payers payor
fintech proptech insurtech regtech edtech govtech agtech legaltech martech adtech
ecommerce marketplace marketplaces subcontractor subcontractors dealflow
utilities fleet telematics dispatch towing hvac plumbing roofing landscaping
roi irr moic dscr ltv pci hipaa soc iso fedramp cmmc cjis
rollover earnout earnouts carveout carve rollup rollups bolt addon addons
multiples ebitda pre post dealmaker dealmakers originator origination originations
ok okay na n/a e.g i.e etc vs
'''.split())
sp.word_frequency.load_words(KNOWN)

def spell_unknown(text):
    words = re.findall(r"[A-Za-z][A-Za-z'’]+", text)
    out = {}
    for w in words:
        lw = w.lower().replace('’', "'")
        if lw.endswith("'s"): lw = lw[:-2]
        if len(lw) < 4 or lw in KNOWN or any(c.isupper() for c in w[1:]): continue
        if w[0].isupper(): continue   # proper nouns, sector names, headings: reviewed separately
        if lw in sp: continue
        out[lw] = out.get(lw, 0) + 1
    return out

# ---- links ----
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
ctx = ssl.create_default_context()
def fetch(u):
    for method in ('HEAD', 'GET'):
        try:
            req = urllib.request.Request(u, method=method, headers={'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9'})
            with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
                return r.status
        except urllib.error.HTTPError as e:
            if method == 'HEAD' and e.code in (403, 405, 404, 400, 429, 500, 501, 503): continue
            return e.code
        except Exception as e:
            if method == 'HEAD': continue
            return 'ERR ' + type(e).__name__
    return '?'

problems = []; ext = {}; linked = set(); unknown_total = {}; titles = {}; descs = {}
for page in PAGES:
    h = rd(os.path.join(DIST, page)); base = os.path.dirname(page)
    ids = set(re.findall(r'\sid="([^"]+)"', h)) | set(re.findall(r'\sname="([^"]+)"', h))
    markup = re.sub(r'<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>', ' ', h, flags=re.S)
    for attr, u in re.findall(r'\b(href|src|poster|data-src)="([^"]*)"', markup):
        u = H.unescape(u)
        if u.startswith(('mailto:', 'tel:', 'sms:', 'javascript:', 'data:')): continue
        if u.startswith(('http://', 'https://')):
            ext.setdefault(u, set()).add(page); continue
        if u.startswith('#'):
            if u != '#' and u[1:] not in ids: problems.append((page, 'anchor missing on page', u))
            continue
        path, _, frag = u.partition('#')
        path = path.split('?')[0]
        if path == '' and not u.startswith('/'): continue
        target = os.path.normpath(path.lstrip('/')) if u.startswith('/') else os.path.normpath(os.path.join(base, path))
        if target in ('.', ''): target = 'index.html'
        full = os.path.join(DIST, target)
        if os.path.isdir(full): full = os.path.join(full, 'index.html'); target = os.path.join(target, 'index.html')
        if not os.path.isfile(full): problems.append((page, 'file missing', u)); continue
        if full.endswith('.html'): linked.add(os.path.relpath(full, DIST))
        if frag and full.endswith('.html'):
            th = rd(full)
            if not re.search(r'\sid="%s"' % re.escape(frag), th): problems.append((page, 'anchor missing on target', u))
    for m in re.finditer(r'<img\b[^>]*>', h):
        if 'alt=' not in m.group(0): problems.append((page, 'image without alt', m.group(0)[:80]))
    t = visible(h)
    for m in BRIT_RE.finditer(t):
        problems.append((page, 'spelling', m.group(0) + ' | ' + re.sub(r'\s+', ' ', t[max(0, m.start() - 40):m.end() + 40]).strip()))
    for m in PLACEHOLDER_RE.finditer(t):
        problems.append((page, 'placeholder', re.sub(r'\s+', ' ', t[max(0, m.start() - 40):m.end() + 40]).strip()))
    if '<meta name="robots" content="noindex' in h: continue
    h1 = len(re.findall(r'<h1\b', h))
    if h1 != 1: problems.append((page, 'h1 count', h1))
    tt = re.search(r'<title>([^<]*)</title>', h); dd = re.search(r'<meta name="description" content="([^"]*)"', h)
    if not tt or not tt.group(1).strip(): problems.append((page, 'no title', ''))
    else: titles.setdefault(tt.group(1).strip(), []).append(page)
    if not dd or len(dd.group(1)) < 50: problems.append((page, 'description short or missing', dd.group(1) if dd else ''))
    else: descs.setdefault(dd.group(1), []).append(page)
    for w, n in spell_unknown(t).items(): unknown_total.setdefault(w, set()).add(page)
for k, v in titles.items():
    if len(v) > 1: problems.append(('(site)', 'duplicate title', (k, v)))
for k, v in descs.items():
    if len(v) > 1: problems.append(('(site)', 'duplicate description', (k[:60], v)))
for page in PAGES:
    if page not in linked and page not in ('index.html', '404.html'): problems.append((page, 'orphan: no page links to it', ''))

if EXTERNAL:
    with concurrent.futures.ThreadPoolExecutor(16) as ex:
        res = dict(zip(ext.keys(), ex.map(fetch, ext.keys())))
    for u, s in res.items():
        if s != 200: problems.append(('(external)', 'status %s' % s, (u, sorted(ext[u])[:3])))
    print('external links', len(ext), 'not 200:', sum(1 for s in res.values() if s != 200))

print('pages', len(PAGES))
print('PROBLEMS', len(problems))
for p in problems: print(' ', p)
print('UNKNOWN WORDS', len(unknown_total))
for w in sorted(unknown_total): print(' ', w, sorted(unknown_total[w])[:2])
json.dump({'problems': problems, 'unknown': {k: sorted(v) for k, v in unknown_total.items()}, 'external': {u: res.get(u) if EXTERNAL else None for u in ext}}, open('deploy_check_report.json', 'w'), indent=1, default=list)
