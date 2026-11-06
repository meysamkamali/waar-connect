#!/usr/bin/env python3
"""Small aaPanel API client for deployment tasks. Runs on the aaPanel server as root and reads the
panel's own API token from /www/server/panel/config/api.json (API access must be enabled in the
panel). Nothing is printed that contains the token.

  bt-api.py sites                                  list sites (id, name, path)
  bt-api.py add-site DOMAIN [ALIAS ...]            create a site with optional extra domains
  bt-api.py ssl DOMAIN [ALIAS ...]                 Let's Encrypt (HTTP-01), install, force HTTPS
  bt-api.py proxy DOMAIN TARGET_URL                reverse proxy "/" of the site to TARGET_URL
  bt-api.py call PATH key=value ...                any panel endpoint, prints the JSON answer
"""

import hashlib
import json
import os
import ssl
import sys
import time
import urllib.parse
import urllib.request

PANEL = '/www/server/panel'


def panel_base() -> str:
    port = open(f'{PANEL}/data/port.pl', encoding='utf-8').read().strip()
    scheme = 'https' if os.path.exists(f'{PANEL}/data/ssl.pl') else 'http'
    return f'{scheme}://127.0.0.1:{port}'


def api_token() -> str:
    with open(f'{PANEL}/config/api.json', encoding='utf-8') as f:
        cfg = json.load(f)
    if not cfg.get('open'):
        sys.exit('panel API is not enabled (Settings -> API interface)')
    return cfg['token']


def _post(endpoint: str, params: dict):
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(panel_base() + endpoint, data=data)
    ctx = ssl._create_unverified_context()  # the panel's own self-signed certificate
    with urllib.request.urlopen(req, context=ctx, timeout=180) as res:
        body = res.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {'raw': body[:500]}


def call(endpoint: str, **params):
    """Signed request. api.json stores md5(secret) in some panel versions and the secret in others,
    so the signature is tried both ways: md5(time + stored) first, then md5(time + md5(stored))."""
    stored = api_token()
    for key in (stored, hashlib.md5(stored.encode()).hexdigest()):
        now = int(time.time())
        signed = dict(params, request_time=now, request_token=hashlib.md5(f'{now}{key}'.encode()).hexdigest())
        res = _post(endpoint, signed)
        if isinstance(res, dict) and res.get('status') is False and 'Secret key' in str(res.get('msg', '')):
            continue
        return res
    return res


def sites():
    res = call('/data?action=getData', table='sites', limit=100, p=1, search='')
    return res.get('data', []) if isinstance(res, dict) else []


def site_id(domain: str) -> int:
    for s in sites():
        if s.get('name') == domain:
            return int(s['id'])
    sys.exit(f'site {domain} not found')


def cmd_sites():
    for s in sites():
        print(f"{s['id']:>4}  {s['name']:<32} {s.get('path', '')}")


def cmd_add_site(domain: str, aliases: list[str]):
    webname = json.dumps({'domain': domain, 'domainlist': aliases, 'count': len(aliases)})
    res = call(
        '/site?action=AddSite',
        webname=webname,
        path=f'/www/wwwroot/{domain}',
        type_id=0,
        type='PHP',
        version='00',
        port=80,
        ps=domain,
        ftp='false',
        sql='false',
        codeing='utf8',
    )
    print(json.dumps(res, ensure_ascii=False))


def cmd_ssl(domain: str, aliases: list[str]):
    sid = site_id(domain)
    res = call(
        '/acme?action=apply_cert_api',
        domains=json.dumps([domain, *aliases]),
        auth_type='http',
        auth_to=sid,
        auto_wildcard=0,
        id=sid,
    )
    if not isinstance(res, dict) or not res.get('status', False) and 'cert' not in res:
        print(json.dumps(res, ensure_ascii=False)[:800])
        sys.exit('certificate request failed')
    cert = res.get('cert') or ''
    root = res.get('root') or ''
    key = res.get('private_key') or ''
    if not cert or not key:
        print({k: (v if k not in ('cert', 'private_key', 'root') else '...') for k, v in res.items()})
        sys.exit('certificate response had no cert/private_key')
    fullchain = cert if root and root.strip() in cert else cert + ('\n' if not cert.endswith('\n') else '') + root
    set_res = call('/site?action=SetSSL', type=1, siteName=domain, key=key, csr=fullchain)
    print('SetSSL:', json.dumps(set_res, ensure_ascii=False))
    force = call('/site?action=HttpToHttps', siteName=domain)
    print('HttpToHttps:', json.dumps(force, ensure_ascii=False))


def cmd_proxy(domain: str, target: str):
    res = call(
        '/site?action=CreateProxy',
        cache=0,
        proxyname=domain.replace('.', '-'),
        cachetime=1,
        proxydir='/',
        proxysite=target,
        todomain='$host',
        advanced=0,
        sitename=domain,
        subfilter='[]',
        type=1,
    )
    print(json.dumps(res, ensure_ascii=False))


def main(argv: list[str]):
    if len(argv) < 2:
        sys.exit(__doc__)
    cmd, args = argv[1], argv[2:]
    if cmd == 'sites':
        cmd_sites()
    elif cmd == 'add-site' and args:
        cmd_add_site(args[0], args[1:])
    elif cmd == 'ssl' and args:
        cmd_ssl(args[0], args[1:])
    elif cmd == 'proxy' and len(args) == 2:
        cmd_proxy(args[0], args[1])
    elif cmd == 'call' and args:
        kv = dict(a.split('=', 1) for a in args[1:])
        print(json.dumps(call(args[0], **kv), ensure_ascii=False)[:2000])
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
