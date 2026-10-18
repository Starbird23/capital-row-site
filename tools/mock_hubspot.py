"""A stand-in for HubSpot's Forms API, an alert webhook and Resend, for the local server tests. Nothing leaves this machine.
- Like the real main form today: only the standard contact fields are on it (email, names, company, phone, mobile, job
  title, website, message). Any other field (cr_ properties, company-record fields) is refused with FIELD_NOT_IN_FORM_DEFINITION,
  the way HubSpot answers, unless /_mode?known=a,b names it. /_mode?badopt=name refuses that field's value (INVALID_OPTION).
- /_mode?fail=N&status=503 makes the next N submissions fail with that status; /_mode?invalid=1 answers 400 INVALID_EMAIL.
- /_log returns everything received; /_reset clears it."""
import json, re, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
LOG = {'hubspot': [], 'alerts': [], 'emails': []}; MODE = {'fail': 0, 'status': 503, 'invalid': 0, 'known': [], 'badopt': ''}
STDF = {'email', 'firstname', 'lastname', 'company', 'phone', 'mobilephone', 'jobtitle', 'website', 'message'}
LOCK = threading.Lock()
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == '/_log': return self.send(200, LOG)
        if u.path == '/_reset':
            with LOCK: LOG['hubspot'].clear(); LOG['alerts'].clear(); LOG['emails'].clear(); MODE.update({'fail': 0, 'status': 503, 'invalid': 0, 'known': [], 'badopt': ''})
            return self.send(200, {'ok': True})
        if u.path == '/_mode':
            with LOCK:
                if 'fail' in q: MODE['fail'] = int(q['fail'][0])
                if 'status' in q: MODE['status'] = int(q['status'][0])
                if 'invalid' in q: MODE['invalid'] = int(q['invalid'][0])
                if 'known' in q: MODE['known'] = q['known'][0].split(',')
                if 'badopt' in q: MODE['badopt'] = q['badopt'][0]
            return self.send(200, MODE)
        self.send(404, {})
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n).decode('utf-8', 'replace')
        try: j = json.loads(body)
        except Exception: j = None
        u = urlparse(self.path)
        if u.path == '/alert':
            with LOCK: LOG['alerts'].append(j)
            return self.send(200, {'ok': True})
        if u.path == '/resend/emails':
            with LOCK: LOG['emails'].append({'auth': self.headers.get('Authorization'), 'body': j})
            return self.send(200, {'id': 'mock'})
        m = re.match(r'^/submissions/v3/integration/submit/(\d+)/([0-9a-f-]+)$', u.path)
        if not m: return self.send(404, {})
        with LOCK:
            entry = {'portal': m.group(1), 'form': m.group(2), 'body': j}
            if MODE['fail'] > 0:
                MODE['fail'] -= 1; entry['answer'] = MODE['status']; LOG['hubspot'].append(entry)
                return self.send(MODE['status'], {'status': 'error', 'message': 'mock outage'})
            if MODE['invalid']:
                entry['answer'] = 400; LOG['hubspot'].append(entry)
                return self.send(400, {'status': 'error', 'errors': [{'errorType': 'INVALID_EMAIL', 'message': 'Email address is invalid'}]})
            missing = [f['name'] for f in (j or {}).get('fields', []) if f['name'] not in STDF and f['name'] not in MODE['known']]
            if not missing and MODE['badopt'] and any(f['name'] == MODE['badopt'] for f in (j or {}).get('fields', [])):
                entry['answer'] = 400; LOG['hubspot'].append(entry)
                return self.send(400, {'status': 'error', 'errors': [{'errorType': 'INVALID_OPTION', 'message': "Error in 'fields." + MODE['badopt'] + "'. 'Bogus' is not one of the allowed options"}]})
            if missing:
                entry['answer'] = 400; LOG['hubspot'].append(entry)
                return self.send(400, {'status': 'error', 'message': 'The request is not valid', 'errors': [{'errorType': 'FIELD_NOT_IN_FORM_DEFINITION', 'message': "Error in 'fields." + x + "'. Field '" + x + "' does not exist in the form definition."} for x in missing]})
            entry['answer'] = 200; LOG['hubspot'].append(entry)
        return self.send(200, {'inlineMessage': 'Thanks'})
if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 9911), H).serve_forever()
