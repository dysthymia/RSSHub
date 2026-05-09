import type { Cheerio, CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import type { Element } from 'domhandler';
import type { Context } from 'hono';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import type { Data, DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://www.panwiki.com';
const defaultOrder = 'dateline';
const defaultLimit = 20;
const maxLimit = 50;
const validOrders = new Set(['', 'dateline', 'heats', 'replies']);
const dateRegex = /\b\d{4}-\d{1,2}-\d{1,2}\b/;

export const route: Route = {
    path: '/portal/:order?',
    categories: ['bbs'],
    view: ViewType.Articles,
    example: '/panwiki/portal/dateline',
    parameters: {
        order: {
            description: '排序方式',
            options: [
                { value: 'dateline', label: '新鲜出炉' },
                { value: 'heats', label: '热门主题' },
                { value: 'replies', label: '全部主题' },
                { value: '', label: '默认' },
            ],
            default: defaultOrder,
        },
    },
    features: {
        requireConfig: [
            {
                name: 'PANWIKI_COOKIE',
                optional: false,
                description: 'Panwiki logged-in cookie. The site is login-gated, so the cookie must be configured server-side.',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Portal',
    maintainers: ['dysthymia'],
    handler,
    description: 'Panwiki portal topics. Requires server-side `PANWIKI_COOKIE` because Panwiki is login-gated.',
};

async function handler(ctx: Context): Promise<Data> {
    const cookie = normalizeCookie(config.panwiki.cookie);

    if (!cookie) {
        throw new ConfigNotFoundError('Panwiki cookie is missing. Please set PANWIKI_COOKIE.');
    }

    const order = normalizeOrder(ctx.req.param('order'));
    const limit = Math.min(Math.max(Number.parseInt(ctx.req.query('limit') ?? `${defaultLimit}`, 10) || defaultLimit, 1), maxLimit);
    const currentUrl = buildPortalUrl(order);
    const response = await ofetch<string>(currentUrl, {
        headers: {
            cookie,
            referer: rootUrl,
            'user-agent': config.trueUA,
        },
        parseResponse: (text) => text,
    });
    const $ = load(response);

    if (isLoginPage($)) {
        throw new Error('Panwiki cookie is invalid or expired. Please update PANWIKI_COOKIE.');
    }

    const items = parsePortalItems($, limit);

    if (items.length === 0) {
        throw new Error('No Panwiki portal topics found. The page structure may have changed or the cookie lacks access.');
    }

    return {
        title: `Panwiki - ${getOrderTitle(order)}`,
        link: currentUrl,
        description: `Panwiki ${getOrderTitle(order)}主题`,
        language: 'zh-CN',
        item: items,
    };
}

function normalizeOrder(order?: string) {
    const normalized = order ?? defaultOrder;

    if (!validOrders.has(normalized)) {
        throw new Error(`Unsupported Panwiki portal order: ${normalized}`);
    }

    return normalized;
}

function buildPortalUrl(order: string) {
    const url = new URL('/portal.php', rootUrl);
    url.searchParams.set('order', order);
    return url.href;
}

function normalizeCookie(cookie?: string) {
    if (!cookie) {
        return '';
    }

    const rawCookie = stripWrappingQuotes(cookie.trim())
        .replaceAll(String.raw`\r`, '\r')
        .replaceAll(String.raw`\n`, '\n');
    const lines = rawCookie
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const cookieLines = lines.filter((line) => /^cookie\s*:/i.test(line));
    const values = cookieLines.length > 0 ? cookieLines.map((line) => line.replace(/^cookie\s*:\s*/i, '')) : lines;

    return values
        .join('; ')
        .replaceAll(/\s*;\s*/g, '; ')
        .replaceAll(/;\s*;/g, ';')
        .trim();
}

function stripWrappingQuotes(value: string) {
    const first = value.at(0);
    const last = value.at(-1);

    return first && first === last && (first === '"' || first === "'") ? value.slice(1, -1) : value;
}

function isLoginPage($: CheerioAPI) {
    const pageText = normalizeText(`${$('title').text()} ${$('body').text()}`);

    return pageText.includes('登录 Panwiki') || pageText.includes('登录发现更多内容') || pageText.includes('已经开启登录可见');
}

function parsePortalItems($: CheerioAPI, limit: number) {
    const seen = new Set<string>();
    const items: DataItem[] = [];

    $('a[href*="mod=viewthread"][href*="tid="]')
        .toArray()
        .some((el) => {
            const $link = $(el);
            const title = normalizeText($link.text());
            const href = $link.attr('href');

            if (!title || !href) {
                return false;
            }

            const link = new URL(href, rootUrl).href;
            if (seen.has(link)) {
                return false;
            }
            seen.add(link);

            const $container = findTopicContainer($, $link, title);
            const text = normalizeText($container.text());
            const dateText = text.match(dateRegex)?.[0];
            const category = extractCategories($, $container);
            const author = extractAuthor(text, title, category);
            const image = normalizeImageUrl($container.find('img').first().attr('src'));
            const description = renderDescription($container, { title, category, author, dateText });

            items.push({
                title,
                link,
                guid: link,
                pubDate: dateText ? parseDate(dateText) : undefined,
                author,
                category,
                image,
                description,
            });

            return items.length >= limit;
        });

    return items;
}

function findTopicContainer($: CheerioAPI, $link: Cheerio<Element>, title: string) {
    let $candidate = $link.parent();

    for (const ancestor of $link.parents().toArray().slice(0, 8)) {
        const $ancestor = $(ancestor);
        const text = normalizeText($ancestor.text());

        if (text.includes(title) && dateRegex.test(text) && text.length < 1200) {
            return $ancestor;
        }

        if (text.includes(title) && text.length < normalizeText($candidate.text()).length) {
            $candidate = $ancestor;
        }
    }

    return $candidate;
}

function extractCategories($: CheerioAPI, $container: Cheerio<Element>) {
    const categories = $container
        .find('a[href*="mod=forumdisplay"][href*="fid="]')
        .toArray()
        .map((el) => normalizeText($(el).text()))
        .filter(Boolean);

    return [...new Set(categories)];
}

function extractAuthor(text: string, title: string, categories: string[]) {
    const lines = text
        .split(/\s+/)
        .map((line) => line.trim())
        .filter(Boolean);
    const dateIndex = lines.findIndex((line) => dateRegex.test(line));

    if (dateIndex > 0) {
        const ignored = new Set([title, ...categories, '夸克', '百度', '阿里', '迅雷']);
        const author = lines
            .slice(0, dateIndex)
            .toReversed()
            .find((line) => !ignored.has(line) && !line.includes(title) && !dateRegex.test(line));

        if (author) {
            return author;
        }
    }
}

function renderDescription($container: Cheerio<Element>, meta: { title: string; category: string[]; author?: string; dateText?: string }) {
    const image = normalizeImageUrl($container.find('img').first().attr('src'));
    const imageHtml = image ? `<p><img src="${image}"></p>` : '';
    const metaParts = [meta.category.length ? `分类：${meta.category.join(', ')}` : undefined, meta.author ? `作者：${meta.author}` : undefined, meta.dateText ? `日期：${meta.dateText}` : undefined].filter(Boolean);
    const metaHtml = metaParts.length > 0 ? `<p>${metaParts.join(' / ')}</p>` : '';

    return `${imageHtml}<p>${meta.title}</p>${metaHtml}`;
}

function normalizeImageUrl(src?: string) {
    if (!src || src.endsWith('none.gif')) {
        return;
    }

    return new URL(src, rootUrl).href;
}

function normalizeText(value: string) {
    return value.replaceAll(/\s+/g, ' ').trim();
}

function getOrderTitle(order: string) {
    switch (order) {
        case '':
            return '默认';
        case 'heats':
            return '热门主题';
        case 'replies':
            return '全部主题';
        case 'dateline':
        default:
            return '新鲜出炉';
    }
}
