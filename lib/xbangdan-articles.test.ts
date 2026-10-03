import type { Context } from 'hono';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { route } from '@/routes/xbangdan/articles';
import server from '@/setup.test';

const now = Date.parse('2026-10-03T12:00:00Z');
const dayMilliseconds = 24 * 60 * 60 * 1000;
const statusId = (timestamp: number) => ((BigInt(timestamp) - 1_288_834_974_657n) << 22n).toString();
const createContext = (region?: string) => ({ req: { param: () => region } }) as unknown as Context;

// 路由处理器也可返回响应对象；测试只接受包含条目的订阅数据。
const getFeed = async (ctx: Context) => {
    const feed = await route.handler(ctx);
    if (!feed || feed instanceof Response || !Array.isArray(feed.item)) {
        throw new Error('Expected route feed items');
    }
    return { ...feed, item: feed.item };
};

// Controlled timestamps verify the exact boundary without depending on the live ranking.
// 使用固定时间验证 24 小时边界，避免测试受实时榜单变化影响。
const card = (region: string, timestamp: number) => `
<a class="ac" hidden data-zone="${region}" data-age="1.00" data-h="writer" href="https://x.com/writer/status/${statusId(timestamp)}">
  <span class="ac-cv"><img src="/feed/img/cover.jpg?format=jpg&amp;name=small"><span class="ac-pv">内容 &lt;script&gt;alert(1)&lt;/script&gt; &amp; 摘要</span></span>
  <span class="ac-t" title="Original English title">完整标题：这是一个不截断的长文标题</span>
  <span class="ac-nm"><b>作者</b><i>@writer · 曝光</i></span>
  <span class="ac-q">999 收藏</span>
</a>`;

beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const mockPage = (html: string) => server.use(http.get('https://xbangdan.com/articles/', () => HttpResponse.html(html)));

describe('/xbangdan/articles/:region?', () => {
    it('defaults to Chinese articles and filters by exact publication time', async () => {
        const recent = card('cn', now - 1000);
        mockPage(`<div id="art-list">
            ${recent}${recent.replace('x.com/writer/', 'x.com/renamedWriter/')}
            ${card('cn', now - dayMilliseconds)}
            ${card('cn', now - dayMilliseconds - 1)}
            ${card('cn', now + 1)}
            ${card('gl', now - 2000)}
        </div>`);

        const feed = await getFeed(createContext());
        expect(feed.title).toBe('X榜单 - 中文区 24 小时长文');
        expect(feed.link).toBe('https://xbangdan.com/articles/');
        expect(feed.item).toHaveLength(2);
        expect(feed.item?.[0]).toMatchObject({
            title: '完整标题：这是一个不截断的长文标题',
            author: '作者',
            link: `https://x.com/writer/status/${statusId(now - 1000)}`,
            guid: `https://x.com/i/status/${statusId(now - 1000)}`,
            image: 'https://xbangdan.com/feed/img/cover.jpg?format=jpg&name=small',
            pubDate: new Date(now - 1000),
        });
        expect(feed.item?.[0].description).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(feed.item?.[0].description).not.toContain('999 收藏');
        expect(feed.item?.[0].description).not.toContain('完整标题');
    });

    it('includes overseas cards hidden by the source page and retains translated content', async () => {
        mockPage(`<div id="art-list">${card('cn', now - 1000)}${card('gl', now - 2000)}</div>`);

        const feed = await getFeed(createContext('gl'));
        expect(feed.title).toBe('X榜单 - 海外区 24 小时长文');
        expect(feed.language).toBe('zh-CN');
        expect(feed.item).toHaveLength(1);
        expect(feed.item?.[0].link).toBe(`https://x.com/writer/status/${statusId(now - 2000)}`);
    });

    it('rejects unsupported regions before requesting the source', async () => {
        await expect(route.handler(createContext('unknown'))).rejects.toThrow('Use cn (中文区) or gl (海外区)');
    });

    it('reports source structure changes', async () => {
        mockPage('<html><body>Challenge page</body></html>');
        await expect(route.handler(createContext('cn'))).rejects.toThrow('article cards were not found');
    });

    it('leaves a genuinely empty time window for the standard RSSHub empty-feed check', async () => {
        mockPage(`<div id="art-list">${card('cn', now - dayMilliseconds - 1)}</div>`);
        const feed = await getFeed(createContext('cn'));
        expect(feed.item).toEqual([]);
        expect(feed).not.toHaveProperty('allowEmpty');
    });
});
