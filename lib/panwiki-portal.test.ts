import type { Context } from 'hono';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { setConfig } from '@/config';
import { route } from '@/routes/panwiki/portal';
import cache from '@/utils/cache';

const createCtx = (order?: string, limit?: string) =>
    ({
        req: {
            param: (name: string) => (name === 'order' ? order : undefined),
            query: (name: string) => (name === 'limit' ? limit : undefined),
        },
    }) as unknown as Context;

const portalHtml = `<!doctype html>
<html>
  <head><title>Panwiki - （原我的小站论坛）</title></head>
  <body>
    <div class="template-fragment">登录发现更多内容</div>
    <div class="topic-card">
      <a href="forum.php?mod=viewthread&tid=200091"><img src="data/attachment/forum/cover.jpg"></a>
      <h2><a href="forum.php?mod=viewthread&tid=200091" style="font-size:16px;">杨照－古代中国的留言：先秦经典八部【完结】</a></h2>
      <a href="forum.php?mod=forumdisplay&fid=2">影视</a>
      <span>夸克</span>
      <span>lanshou2333</span>
      <span>2026-05-09</span>
      <span>0</span>
    </div>
    <div class="topic-card">
      <a href="forum.php?mod=viewthread&tid=200090"><img src="static/image/common/none.gif"></a>
      <h2><a href="forum.php?mod=viewthread&tid=200090" style="font-size:16px;">异人之下之决战！碧游村（2025）</a></h2>
      <a href="forum.php?mod=forumdisplay&fid=2">影视</a>
      <span>百度</span>
      <span>T-Z</span>
      <span>2026-05-09</span>
      <span>0</span>
    </div>
  </body>
</html>`;

const loginHtml = `<!doctype html>
<html>
  <body>
    <form id="loginform_LKXbk" action="member.php?mod=logging&action=login&loginsubmit=yes&loginhash=LKXbk">
      <input type="hidden" name="formhash" value="40431143">
      <input type="hidden" name="referer" value="https://www.panwiki.com/./">
      <input type="text" name="username">
      <input type="password" name="password">
    </form>
  </body>
</html>`;

afterEach(() => {
    setConfig({
        PANWIKI_COOKIE: '',
        PANWIKI_PASSWORD: '',
        PANWIKI_USERNAME: '',
        REQUEST_RETRY: '',
    });
    cache.set('panwiki:login-cookie', '', 1);
});

describe('/panwiki/portal/:order?', () => {
    it('builds portal feed with the configured cookie', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            PANWIKI_COOKIE: 'hH6n_2132_auth=secret',
            REQUEST_RETRY: '0',
        });

        server.use(
            http.get('https://www.panwiki.com/portal.php', ({ request }) => {
                const url = new URL(request.url);
                expect(url.searchParams.get('order')).toBe('dateline');
                expect(request.headers.get('cookie')).toBe('hH6n_2132_auth=secret');
                expect(request.headers.get('user-agent')).toBeTruthy();

                return HttpResponse.text(portalHtml, {
                    headers: {
                        'content-type': 'text/html; charset=utf-8',
                    },
                });
            })
        );

        const feed = await route.handler(createCtx('dateline'));
        expect(feed.title).toBe('Panwiki - 新鲜出炉');
        expect(feed.link).toBe('https://www.panwiki.com/portal.php?order=dateline');
        expect(feed.item).toHaveLength(2);
        expect(feed.item[0]).toMatchObject({
            title: '杨照－古代中国的留言：先秦经典八部【完结】',
            link: 'https://www.panwiki.com/forum.php?mod=viewthread&tid=200091',
            guid: 'https://www.panwiki.com/forum.php?mod=viewthread&tid=200091',
            author: 'lanshou2333',
            category: ['影视'],
            image: 'https://www.panwiki.com/data/attachment/forum/cover.jpg',
        });
        expect(feed.item[0].description).toContain('作者：lanshou2333');
        expect(feed.item[0].pubDate).toBeInstanceOf(Date);
        expect(feed.item[1].image).toBeUndefined();
    });

    it('defaults to dateline and clamps limit', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            PANWIKI_COOKIE: 'hH6n_2132_auth=secret',
            REQUEST_RETRY: '0',
        });

        server.use(
            http.get('https://www.panwiki.com/portal.php', ({ request }) => {
                const url = new URL(request.url);
                expect(url.searchParams.get('order')).toBe('dateline');
                return HttpResponse.text(portalHtml);
            })
        );

        const feed = await route.handler(createCtx(undefined, '1'));
        expect(feed.item).toHaveLength(1);
    });

    it('normalizes a copied Cookie header value', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            PANWIKI_COOKIE: 'Cookie: panwiki_auth=secret; panwiki_salt=salt',
            REQUEST_RETRY: '0',
        });

        server.use(
            http.get('https://www.panwiki.com/portal.php', ({ request }) => {
                expect(request.headers.get('cookie')).toBe('panwiki_auth=secret; panwiki_salt=salt');
                return HttpResponse.text(portalHtml);
            })
        );

        const feed = await route.handler(createCtx('dateline', '1'));
        expect(feed.item).toHaveLength(1);
    });

    it('normalizes a copied curl Cookie header', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            PANWIKI_COOKIE: "curl 'https://www.panwiki.com/portal.php?order=dateline' -H 'accept: text/html' -H 'Cookie: hH6n_2132_auth=secret; hH6n_2132_saltkey=salt'",
            REQUEST_RETRY: '0',
        });

        server.use(
            http.get('https://www.panwiki.com/portal.php', ({ request }) => {
                expect(request.headers.get('cookie')).toBe('hH6n_2132_auth=secret; hH6n_2132_saltkey=salt');
                return HttpResponse.text(portalHtml);
            })
        );

        const feed = await route.handler(createCtx('dateline', '1'));
        expect(feed.item).toHaveLength(1);
    });

    it('normalizes copied Set-Cookie lines', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            PANWIKI_COOKIE: ['set-cookie: hH6n_2132_saltkey=salt; expires=Mon, 08-Jun-2026 14:21:22 GMT; path=/; secure', 'set-cookie: hH6n_2132_auth=secret; expires=Mon, 08-Jun-2026 14:21:22 GMT; path=/; secure; HttpOnly'].join(
                String.raw`\n`
            ),
            REQUEST_RETRY: '0',
        });

        server.use(
            http.get('https://www.panwiki.com/portal.php', ({ request }) => {
                expect(request.headers.get('cookie')).toBe('hH6n_2132_saltkey=salt; hH6n_2132_auth=secret');
                return HttpResponse.text(portalHtml);
            })
        );

        const feed = await route.handler(createCtx('dateline', '1'));
        expect(feed.item).toHaveLength(1);
    });

    it('logs in with username and password when the configured cookie is expired', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            PANWIKI_COOKIE: 'hH6n_2132_auth=expired',
            PANWIKI_USERNAME: 'rsshub-user',
            PANWIKI_PASSWORD: 'rsshub-password',
            REQUEST_RETRY: '0',
        });

        let portalRequests = 0;

        server.use(
            http.get('https://www.panwiki.com/portal.php', ({ request }) => {
                portalRequests++;

                if (portalRequests === 1) {
                    expect(request.headers.get('cookie')).toBe('hH6n_2132_auth=expired');
                    return HttpResponse.text('<title>登录 Panwiki</title><body>登录发现更多内容</body>');
                }

                expect(request.headers.get('cookie')).toContain('hH6n_2132_auth=secret');
                return HttpResponse.text(portalHtml);
            }),
            http.get('https://www.panwiki.com/member.php', ({ request }) => {
                const url = new URL(request.url);
                expect(url.searchParams.get('mod')).toBe('logging');
                expect(url.searchParams.get('action')).toBe('login');

                return HttpResponse.text(loginHtml, {
                    headers: {
                        'set-cookie': 'hH6n_2132_saltkey=salt; path=/, hH6n_2132_sid=sid; path=/',
                    },
                });
            }),
            http.post('https://www.panwiki.com/member.php', async ({ request }) => {
                const url = new URL(request.url);
                const body = new URLSearchParams(await request.text());

                expect(url.searchParams.get('loginsubmit')).toBe('yes');
                expect(url.searchParams.get('loginhash')).toBe('LKXbk');
                expect(url.searchParams.get('inajax')).toBe('1');
                expect(request.headers.get('cookie')).toContain('hH6n_2132_saltkey=salt');
                expect(request.headers.get('cookie')).toContain('hH6n_2132_sid=sid');
                expect(body.get('formhash')).toBe('40431143');
                expect(body.get('username')).toBe('rsshub-user');
                expect(body.get('password')).toBe('rsshub-password');
                expect(body.get('cookietime')).toBe('2592000');

                return HttpResponse.text('<body>欢迎回来</body>', {
                    headers: {
                        'set-cookie': 'hH6n_2132_auth=secret; path=/',
                    },
                });
            })
        );

        const feed = await route.handler(createCtx('dateline', '1'));

        expect(portalRequests).toBe(2);
        expect(feed.item).toHaveLength(1);
    });

    it('reports missing authentication config', async () => {
        await expect(route.handler(createCtx('dateline'))).rejects.toThrow('Panwiki auth is missing');
    });

    it('reports incomplete cookie without auth cookie', async () => {
        setConfig({
            PANWIKI_COOKIE: 'hH6n_2132_saltkey=salt',
            REQUEST_RETRY: '0',
        });

        await expect(route.handler(createCtx('dateline'))).rejects.toThrow('missing Discuz auth cookie');
    });

    it('reports invalid or expired cookie from login page', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            PANWIKI_COOKIE: 'hH6n_2132_auth=expired',
            REQUEST_RETRY: '0',
        });

        server.use(http.get('https://www.panwiki.com/portal.php', () => HttpResponse.text('<title>登录 Panwiki</title><body>登录发现更多内容</body>')));

        await expect(route.handler(createCtx('dateline'))).rejects.toThrow('Panwiki cookie is invalid or expired');
    });
});
