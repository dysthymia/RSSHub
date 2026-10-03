import { load } from 'cheerio';
import type { Context } from 'hono';

import { config } from '@/config';
import type { Data, DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://xbangdan.com';
const articlesUrl = `${rootUrl}/articles/`;
const dayMilliseconds = 24 * 60 * 60 * 1000;
const twitterEpoch = 1_288_834_974_657n;
const regions = { cn: '中文区', gl: '海外区' } as const;

export const route: Route = {
    path: '/articles/:region?',
    categories: ['social-media'],
    view: ViewType.Articles,
    example: '/xbangdan/articles/cn',
    parameters: {
        region: {
            description: '区域',
            default: 'cn',
            options: [
                { value: 'cn', label: '中文区' },
                { value: 'gl', label: '海外区' },
            ],
        },
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [{ source: ['xbangdan.com/articles/', 'xbangdan.com/articles'], target: '/articles' }],
    name: '24 小时长文',
    maintainers: ['dysthymia'],
    handler,
    description: '订阅 X 榜单收录的最近 24 小时长文，默认中文区，`gl` 为海外区。包含网页提供的标题、作者、摘要和封面，链接指向 X 原帖。海外区沿用网站展示的中文翻译。时间范围按原帖发布时间计算，收录范围及更新频率由源站决定。',
};

async function handler(ctx: Context): Promise<Data> {
    const region = ctx.req.param('region') ?? 'cn';
    if (region !== 'cn' && region !== 'gl') {
        throw new Error('Invalid X榜单 region. Use cn (中文区) or gl (海外区).');
    }

    // The list is embedded in HTML; both regions are available without browser pagination.
    // 两区长文已包含在首个 HTML 响应中，无须运行浏览器或请求后续分页。
    const html = await ofetch<string>(articlesUrl, { headers: { 'User-Agent': config.trueUA } });
    const $ = load(html);
    const cards = $('#art-list .ac');
    if (!cards.length) {
        throw new Error('X榜单 article cards were not found. The source page structure may have changed.');
    }

    const now = Date.now();
    const seenStatusIds = new Set<string>();
    const items: DataItem[] = [];
    for (const card of cards.toArray()) {
        const element = $(card);
        if ((element.attr('data-zone') ?? 'cn') !== region) {
            continue;
        }

        const link = element.attr('href');
        const statusId = link?.match(/^https:\/\/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)(?:\?.*)?$/)?.[1];
        const title = element.find('.ac-t').text();
        if (!link || !statusId || !title || seenStatusIds.has(statusId)) {
            continue;
        }

        // Snowflake IDs encode the original post time; rounded data-age can exceed 24 hours.
        // 使用原帖 ID 中的真实时间，避免页面四舍五入的 data-age 把超过 24 小时的长文纳入。
        const pubDate = parseDate(Number((BigInt(statusId) >> 22n) + twitterEpoch));
        const age = now - pubDate.getTime();
        if (age < 0 || age > dayMilliseconds) {
            continue;
        }

        const summary = $('<p>').text(element.find('.ac-pv').text());
        const cover = element.find('.ac-cv img').attr('src');
        const image = cover ? new URL(cover, rootUrl).href : undefined;
        const description = summary.prop('outerHTML') ?? '';
        seenStatusIds.add(statusId);
        items.push({
            title,
            link,
            guid: `https://x.com/i/status/${statusId}`,
            author: element.find('.ac-nm b').text() || element.attr('data-h'),
            pubDate,
            description: image ? `${$('<img>').attr('src', image).prop('outerHTML')}${description}` : description,
            image,
        });
    }

    return {
        title: `X榜单 - ${regions[region]} 24 小时长文`,
        link: articlesUrl,
        description: `${regions[region]}最近 24 小时发布、被 X榜单收录的长文摘要。`,
        language: 'zh-CN',
        item: items,
    };
}
