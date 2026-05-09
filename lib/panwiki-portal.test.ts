import type { Context } from 'hono';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { setConfig } from '@/config';
import { route } from '@/routes/panwiki/portal';

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

afterEach(() => {
    setConfig({
        PANWIKI_COOKIE: '',
        REQUEST_RETRY: '',
    });
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

    it('reports missing cookie', async () => {
        await expect(route.handler(createCtx('dateline'))).rejects.toThrow('Panwiki cookie is missing');
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
