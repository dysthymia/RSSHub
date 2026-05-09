import type { Context } from 'hono';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { setConfig } from '@/config';
import { route } from '@/routes/theblockbeats/pro';

const createCtx = (channel: string, limit?: string) =>
    ({
        req: {
            param: (name: string) => (name === 'channel' ? channel : undefined),
            query: (name: string) => (name === 'limit' ? limit : undefined),
        },
    }) as unknown as Context;

const createFeed = (item: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BlockBeats Pro RSS</title>
    <link>https://www.theblockbeats.info/</link>
    <description>BlockBeats feed</description>
    ${item}
  </channel>
</rss>`;

afterEach(() => {
    setConfig({
        BLOCKBEATS_API_KEY: '',
        REQUEST_RETRY: '',
    });
});

describe('/theblockbeats/pro/:channel', () => {
    it('builds the article feed from the BlockBeats Pro RSS endpoint', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            BLOCKBEATS_API_KEY: 'test-key',
            REQUEST_RETRY: '0',
        });

        server.use(
            http.get('https://api-pro.theblockbeats.info/v1/rss/article', ({ request }) => {
                const url = new URL(request.url);
                expect(url.searchParams.get('page')).toBe('1');
                expect(url.searchParams.get('size')).toBe('20');
                expect(url.searchParams.has('lang')).toBe(false);
                expect(request.headers.get('api-key')).toBe('test-key');

                return HttpResponse.xml(
                    createFeed(`<item>
                      <title>Article title</title>
                      <link>https://www.theblockbeats.info/news/123</link>
                      <guid>article-123</guid>
                      <pubDate>Sat, 09 May 2026 10:00:00 GMT</pubDate>
                      <description><![CDATA[<p>Article body</p>]]></description>
                      <category>AI</category>
                      <enclosure url="https://image.blockbeats.cn/article.png" type="image/png" />
                    </item>`)
                );
            })
        );

        const feed = await route.handler(createCtx('article'));
        expect(feed.title).toBe('BlockBeats Pro RSS');
        expect(feed.link).toBe('https://www.theblockbeats.info/');
        expect(feed.feedLink).toBe('https://api-pro.theblockbeats.info/v1/rss/article');
        expect(feed.language).toBe('zh-CN');
        expect(feed.item).toHaveLength(1);
        expect(feed.item[0]).toMatchObject({
            title: 'Article title',
            link: 'https://www.theblockbeats.info/news/123',
            guid: 'article-123',
            description: '<p>Article body</p>',
            category: ['AI'],
            image: 'https://image.blockbeats.cn/article.png',
            enclosure_url: 'https://image.blockbeats.cn/article.png',
            enclosure_type: 'image/png',
        });
        expect(feed.item[0].pubDate).toBeInstanceOf(Date);
    });

    it('builds the newsflash feed and clamps the limit parameter', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            BLOCKBEATS_API_KEY: 'test-key',
            REQUEST_RETRY: '0',
        });

        server.use(
            http.get('https://api-pro.theblockbeats.info/v1/rss/newsflash', ({ request }) => {
                const url = new URL(request.url);
                expect(url.searchParams.get('page')).toBe('1');
                expect(url.searchParams.get('size')).toBe('50');
                expect(request.headers.get('api-key')).toBe('test-key');

                return HttpResponse.xml(
                    createFeed(`<item>
                      <title>Newsflash title</title>
                      <link>https://www.theblockbeats.info/flash/330276</link>
                      <guid>newsflash-330276</guid>
                      <pubDate>Sat, 09 May 2026 10:01:00 GMT</pubDate>
                      <description><![CDATA[<p>Newsflash body</p>]]></description>
                    </item>`)
                );
            })
        );

        const feed = await route.handler(createCtx('newsflash', '100'));
        expect(feed.feedLink).toBe('https://api-pro.theblockbeats.info/v1/rss/newsflash');
        expect(feed.item[0]).toMatchObject({
            title: 'Newsflash title',
            link: 'https://www.theblockbeats.info/flash/330276',
            guid: 'newsflash-330276',
            description: '<p>Newsflash body</p>',
        });
    });

    it('reports API errors from JSON error responses', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            BLOCKBEATS_API_KEY: 'bad-key',
            REQUEST_RETRY: '0',
        });

        server.use(
            http.get('https://api-pro.theblockbeats.info/v1/rss/article', () =>
                HttpResponse.json({
                    status: 101,
                    message: 'Invalid API key',
                    data: null,
                })
            )
        );

        await expect(route.handler(createCtx('article'))).rejects.toThrow('BlockBeats API error 101: Invalid API key');
    });

    it('requires the BlockBeats API key', async () => {
        setConfig({
            BLOCKBEATS_API_KEY: '',
            REQUEST_RETRY: '0',
        });

        await expect(route.handler(createCtx('article'))).rejects.toThrow('BlockBeats API key is missing');
    });

    it('rejects unexpected non-XML responses', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            BLOCKBEATS_API_KEY: 'test-key',
            REQUEST_RETRY: '0',
        });

        server.use(http.get('https://api-pro.theblockbeats.info/v1/rss/article', () => HttpResponse.text('not rss')));

        await expect(route.handler(createCtx('article'))).rejects.toThrow('Unexpected BlockBeats API response string. Length: 7');
    });
});
