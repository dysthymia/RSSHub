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

afterEach(() => {
    setConfig({
        BLOCKBEATS_API_KEY: undefined,
        REQUEST_RETRY: undefined,
    });
});

describe('/theblockbeats/pro/:channel', () => {
    it('builds the article feed from the BlockBeats Pro API', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            BLOCKBEATS_API_KEY: 'test-key',
            REQUEST_RETRY: '0',
        });

        server.use(
            http.get('https://api-pro.theblockbeats.info/v1/article', ({ request }) => {
                const url = new URL(request.url);
                expect(url.searchParams.get('page')).toBe('1');
                expect(url.searchParams.get('size')).toBe('20');
                expect(url.searchParams.get('lang')).toBe('cn');
                expect(request.headers.get('api-key')).toBe('test-key');

                return HttpResponse.json({
                    status: 0,
                    message: '',
                    data: {
                        page: 1,
                        data: [
                            {
                                id: 123,
                                title: 'Article title',
                                content: '<p>Article body</p>',
                                pic: 'https://image.blockbeats.cn/article.png',
                                link: 'https://m.theblockbeats.info/news/123',
                                create_time: '2026-05-09 18:00:00',
                            },
                        ],
                    },
                });
            })
        );

        const feed = await route.handler(createCtx('article'));
        expect(feed.title).toBe('律动 BlockBeats - 文章');
        expect(feed.link).toBe('https://www.theblockbeats.info/article');
        expect(feed.language).toBe('zh-CN');
        expect(feed.item).toHaveLength(1);
        expect(feed.item[0]).toMatchObject({
            title: 'Article title',
            link: 'https://m.theblockbeats.info/news/123',
            guid: 'theblockbeats-pro-article-123',
            image: 'https://image.blockbeats.cn/article.png',
        });
        expect(feed.item[0].description).toContain('<p><img src="https://image.blockbeats.cn/article.png"></p>');
        expect(feed.item[0].description).toContain('<p>Article body</p>');
        expect(feed.item[0].pubDate).toBeInstanceOf(Date);
    });

    it('builds the newsflash feed and clamps the limit parameter', async () => {
        const { default: server } = await import('@/setup.test');
        setConfig({
            BLOCKBEATS_API_KEY: 'test-key',
            REQUEST_RETRY: '0',
        });

        server.use(
            http.get('https://api-pro.theblockbeats.info/v1/newsflash', ({ request }) => {
                const url = new URL(request.url);
                expect(url.searchParams.get('page')).toBe('1');
                expect(url.searchParams.get('size')).toBe('50');
                expect(url.searchParams.get('lang')).toBe('cn');
                expect(request.headers.get('api-key')).toBe('test-key');

                return HttpResponse.json({
                    status: 0,
                    message: '',
                    data: {
                        page: 1,
                        data: [
                            {
                                id: 330276,
                                title: 'Newsflash title',
                                content: '<p>Newsflash body</p>',
                                pic: '',
                                link: 'https://m.theblockbeats.info/flash/330276',
                                create_time: '2026-05-09 18:01:00',
                            },
                        ],
                    },
                });
            })
        );

        const feed = await route.handler(createCtx('newsflash', '100'));
        expect(feed.title).toBe('律动 BlockBeats - 快讯');
        expect(feed.link).toBe('https://www.theblockbeats.info/newsflash');
        expect(feed.item[0]).toMatchObject({
            title: 'Newsflash title',
            link: 'https://m.theblockbeats.info/flash/330276',
            guid: 'theblockbeats-pro-newsflash-330276',
            description: '<p>Newsflash body</p>',
        });
    });
});
