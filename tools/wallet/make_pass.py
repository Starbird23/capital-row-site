"""Builds and signs Shawnee Mercier's Apple Wallet pass: assets/shawnee/shawnee-mercier.pkpass.
Run only with real Apple credentials; there is no unsigned or test mode, because Wallet rejects any pass that is not signed
with a Pass Type ID certificate from the Apple Developer account named in teamIdentifier.

  PASS_TYPE_ID   the Pass Type ID registered in the Apple Developer account, e.g. pass.com.thecapitalrow.card
  TEAM_ID        the Apple Developer Team ID (10 characters)
  PASS_P12       path to the Pass Type ID certificate exported with its private key (.p12)
  PASS_P12_PASSWORD   the .p12 password
  WWDR_CERT      path to Apple's WWDR intermediate certificate (G4), .cer or .pem

  python3 tools/wallet/make_pass.py

The private key never enters the repository: it is read from PASS_P12, used in a temporary folder that is deleted, and only
the signed .pkpass (which contains no key) is written to assets/. Requires openssl."""
import hashlib, json, os, shutil, subprocess, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.environ.get('PASS_OUT') or os.path.join(ROOT, 'assets', 'shawnee', 'shawnee-mercier.pkpass')
need = ['PASS_TYPE_ID', 'TEAM_ID', 'PASS_P12', 'PASS_P12_PASSWORD', 'WWDR_CERT']
miss = [k for k in need if not os.environ.get(k)]
if miss: sys.exit('Missing: ' + ', '.join(miss) + '. See the notes at the top of this file.')
E = os.environ
tmp = tempfile.mkdtemp()
try:
    src = os.path.join(HERE, 'pass'); work = os.path.join(tmp, 'pass'); shutil.copytree(src, work)
    pj = json.load(open(os.path.join(work, 'pass.json')))
    pj['passTypeIdentifier'], pj['teamIdentifier'] = E['PASS_TYPE_ID'], E['TEAM_ID']
    json.dump(pj, open(os.path.join(work, 'pass.json'), 'w'), indent=2, ensure_ascii=False)
    files = sorted(f for f in os.listdir(work) if not f.startswith('.'))
    manifest = {f: hashlib.sha1(open(os.path.join(work, f), 'rb').read()).hexdigest() for f in files}
    json.dump(manifest, open(os.path.join(work, 'manifest.json'), 'w'), indent=2)
    cert, key, wwdr = os.path.join(tmp, 'cert.pem'), os.path.join(tmp, 'key.pem'), os.path.join(tmp, 'wwdr.pem')
    pw = 'pass:' + E['PASS_P12_PASSWORD']
    def run(args): subprocess.run(args, check=True, capture_output=True)
    for legacy in ([], ['-legacy']):   # OpenSSL 3 needs -legacy for .p12 files exported by older Keychain versions
        try:
            run(['openssl', 'pkcs12', '-in', E['PASS_P12'], '-clcerts', '-nokeys', '-out', cert, '-passin', pw] + legacy)
            run(['openssl', 'pkcs12', '-in', E['PASS_P12'], '-nocerts', '-nodes', '-out', key, '-passin', pw] + legacy)
            break
        except subprocess.CalledProcessError:
            if legacy: raise
    inform = 'DER' if open(E['WWDR_CERT'], 'rb').read(1) == b'\x30' else 'PEM'
    run(['openssl', 'x509', '-inform', inform, '-in', E['WWDR_CERT'], '-out', wwdr])
    run(['openssl', 'smime', '-binary', '-sign', '-certfile', wwdr, '-signer', cert, '-inkey', key,
         '-in', os.path.join(work, 'manifest.json'), '-out', os.path.join(work, 'signature'), '-outform', 'DER'])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in files + ['manifest.json', 'signature']: z.write(os.path.join(work, f), f)
    print('Signed pass written:', OUT)
finally:
    shutil.rmtree(tmp, ignore_errors=True)   # the decrypted key is gone
