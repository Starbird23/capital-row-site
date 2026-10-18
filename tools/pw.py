"""Shared Playwright helpers: local server pages, Google Fonts fetched through the proxy and cached."""
import os, hashlib, subprocess, asyncio
from playwright.async_api import async_playwright
CACHE=os.path.join(os.path.dirname(os.path.abspath(__file__)),'fontcache')
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
async def font_route(route):
    url=route.request.url
    key=hashlib.sha1(url.encode()).hexdigest()
    path=os.path.join(CACHE,key)
    if not os.path.exists(path):
        subprocess.run(['curl','-sS','-m','30','-A',UA,'-o',path,url],check=False)
    ct='text/css' if 'googleapis' in url else 'font/woff2'
    try:
        body=open(path,'rb').read()
        await route.fulfill(status=200,body=body,headers={'content-type':ct,'access-control-allow-origin':'*'})
    except Exception:
        await route.abort()
async def new_page(browser,w,h=900,reduced=False):
    ctx=await browser.new_context(viewport={'width':w,'height':h},reduced_motion='reduce' if reduced else 'no-preference')
    await ctx.route('**://fonts.googleapis.com/**',font_route)
    await ctx.route('**://fonts.gstatic.com/**',font_route)
    pg=await ctx.new_page()
    pg.errs=[]
    pg.on('console',lambda m: pg.errs.append(m.text) if m.type=='error' else None)
    pg.on('pageerror',lambda e: pg.errs.append('PAGEERROR '+str(e)))
    return ctx,pg
