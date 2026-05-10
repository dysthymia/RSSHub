import type { Cheerio, CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import type { Element } from 'domhandler';
import type { Context } from 'hono';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import type { Data, DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://www.panwiki.com';
const loginUrl = `${rootUrl}/member.php?mod=logging&action=login`;
const loginCookieCacheKey = 'panwiki:login-cookie';
const loginCookieExpire = 25 * 24 * 60 * 60;
const defaultOrder = 'dateline';
const defaultLimit = 20;
const maxLimit = 50;
const validOrders = new Set(['', 'dateline', 'heats', 'replies']);
const cookieAttributeNames = new Set(['expires', 'max-age', 'domain', 'path', 'secure', 'httponly', 'samesite']);
const dateRegex = /\b\d{4}-\d{1,2}-\d{1,2}\b/;
const browserUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

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
                optional: true,
                description: 'Panwiki logged-in cookie. Preferred when available.',
            },
            {
                name: 'PANWIKI_USERNAME',
                optional: true,
                description: 'Panwiki username. Used to login when PANWIKI_COOKIE is missing or invalid.',
            },
            {
                name: 'PANWIKI_PASSWORD',
                optional: true,
                description: 'Panwiki password. Used to login when PANWIKI_COOKIE is missing or invalid.',
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
    description: 'Panwiki portal topics. Panwiki is login-gated; configure server-side `PANWIKI_COOKIE`, or `PANWIKI_USERNAME` and `PANWIKI_PASSWORD` for automatic login fallback.',
};

async function handler(ctx: Context): Promise<Data> {
    const order = normalizeOrder(ctx.req.param('order'));
    const limit = Math.min(Math.max(Number.parseInt(ctx.req.query('limit') ?? `${defaultLimit}`, 10) || defaultLimit, 1), maxLimit);
    const currentUrl = buildPortalUrl(order);
    const candidates = await getCookieCandidates();
    const candidatePages = await Promise.all(candidates.map((candidate) => fetchPortalPage(currentUrl, candidate.cookie)));
    const validCandidatePage = candidatePages.find(($) => !isLoginPage($));

    if (validCandidatePage) {
        return buildFeed(validCandidatePage, currentUrl, order, limit);
    }

    if (hasLoginCredentials()) {
        const loginCookie = await loginAndCacheCookie();
        const $ = await fetchPortalPage(currentUrl, loginCookie);

        if (!isLoginPage($)) {
            return buildFeed($, currentUrl, order, limit);
        }

        throw new Error('Panwiki login succeeded but the portal page still requires login. The account may lack access or Panwiki changed its login flow.');
    }

    throw getMissingAuthError();
}

function buildFeed($: CheerioAPI, currentUrl: string, order: string, limit: number) {
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

async function getCookieCandidates() {
    const candidates: Array<{ cookie: string }> = [];
    const configuredCookie = normalizeCookie(config.panwiki.cookie);

    if (configuredCookie) {
        const diagnostics = getCookieDiagnostics(configuredCookie);

        if (diagnostics.hasAuthCookie) {
            candidates.push({ cookie: configuredCookie });
        } else if (!hasLoginCredentials()) {
            throw new Error(`Panwiki cookie is incomplete: missing Discuz auth cookie. ${diagnostics.message}`);
        }
    }

    const cachedCookie = normalizeCookie((await cache.get(loginCookieCacheKey)) ?? '');

    if (cachedCookie && getCookieDiagnostics(cachedCookie).hasAuthCookie && !candidates.some((candidate) => candidate.cookie === cachedCookie)) {
        candidates.push({ cookie: cachedCookie });
    }

    if (candidates.length === 0 && hasLoginCredentials()) {
        candidates.push({ cookie: await loginAndCacheCookie() });
    }

    return candidates;
}

async function fetchPortalPage(url: string, cookie: string) {
    const response = await ofetch<string>(url, {
        headers: {
            ...getHtmlHeaders(rootUrl),
            cookie,
        },
        parseResponse: (text) => text,
    });

    return load(response);
}

async function loginAndCacheCookie() {
    const cookie = await login();
    await cache.set(loginCookieCacheKey, cookie, loginCookieExpire);
    return cookie;
}

async function login() {
    if (!config.panwiki.username || !config.panwiki.password) {
        throw getMissingAuthError();
    }

    const loginPageResponse = await ofetch.raw<string>(loginUrl, {
        headers: getHtmlHeaders(rootUrl),
        parseResponse: (text) => text,
    });
    const loginPageCookie = mergeCookies('', getSetCookieHeaders(loginPageResponse.headers));
    const $ = load(loginPageResponse._data);
    const $form = $('form[id^="loginform_"]').first();
    const action = $form.attr('action');
    const formhash = $form.find('input[name="formhash"]').attr('value');

    if (!action || !formhash) {
        throw new Error('Panwiki login form not found. The login page structure may have changed.');
    }

    const body = new URLSearchParams({
        formhash,
        referer: $form.find('input[name="referer"]').attr('value') || rootUrl,
        username: config.panwiki.username,
        password: config.panwiki.password,
        questionid: '0',
        answer: '',
        cookietime: '2592000',
        loginsubmit: 'true',
    });
    const submitResponse = await ofetch.raw<string>(new URL(action, rootUrl).href, {
        method: 'POST',
        headers: {
            ...getHtmlHeaders(loginUrl),
            cookie: loginPageCookie,
            origin: rootUrl,
            'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        parseResponse: (text) => text,
        redirect: 'manual',
    });
    const loginCookie = mergeCookies(loginPageCookie, getSetCookieHeaders(submitResponse.headers));
    const diagnostics = getCookieDiagnostics(loginCookie);

    if (!diagnostics.hasAuthCookie) {
        const message = extractLoginError(load(submitResponse._data));
        throw new Error(`Panwiki login failed: ${message || 'auth cookie was not returned.'} ${diagnostics.message}`);
    }

    return loginCookie;
}

function getHtmlHeaders(referer: string) {
    return {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        referer,
        'user-agent': browserUserAgent,
    };
}

function hasLoginCredentials() {
    return Boolean(config.panwiki.username && config.panwiki.password);
}

function getMissingAuthError() {
    const configuredCookie = normalizeCookie(config.panwiki.cookie);

    if (configuredCookie) {
        const diagnostics = getCookieDiagnostics(configuredCookie);

        if (!diagnostics.hasAuthCookie) {
            return new Error(`Panwiki cookie is incomplete: missing Discuz auth cookie. ${diagnostics.message}`);
        }

        return new Error(`Panwiki cookie is invalid or expired, and username/password fallback is not configured. ${diagnostics.message}`);
    }

    return new ConfigNotFoundError('Panwiki auth is missing. Please set PANWIKI_COOKIE, or set both PANWIKI_USERNAME and PANWIKI_PASSWORD.');
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
    const curlCookieValues = extractCurlHeaderValues(rawCookie, 'cookie');

    if (curlCookieValues.length > 0) {
        return normalizeCookieValue(curlCookieValues.join('; '));
    }

    const lines = rawCookie
        .split(/\r?\n/)
        .map((line) => normalizeCopiedHeaderLine(line))
        .filter(Boolean);
    const cookieLines = lines.filter((line) => /^cookie\s*:/i.test(line));

    if (cookieLines.length > 0) {
        return normalizeCookieValue(cookieLines.map((line) => line.replace(/^cookie\s*:\s*/i, '')).join('; '));
    }

    const setCookieLines = lines.filter((line) => /^set-cookie\s*:/i.test(line));

    if (setCookieLines.length > 0) {
        return normalizeCookieValue(
            setCookieLines
                .map((line) => line.replace(/^set-cookie\s*:\s*/i, '').split(';')[0])
                .filter((line) => line.includes('='))
                .join('; ')
        );
    }

    return normalizeCookieValue(lines.join('; '));
}

function normalizeCookieValue(cookie: string) {
    return cookie
        .replaceAll(/\s*;\s*/g, '; ')
        .replaceAll(/;\s*;/g, ';')
        .trim();
}

function normalizeCopiedHeaderLine(line: string) {
    return stripWrappingQuotes(
        line
            .trim()
            .replace(/\\$/, '')
            .replace(/^(?:-H|--header)\s+/i, '')
            .trim()
    );
}

function extractCurlHeaderValues(rawCookie: string, headerName: string) {
    const values: string[] = [];
    const headerRegex = /(?:^|\s)(?:-H|--header)\s+(["'])(.*?)\1/gis;

    for (const match of rawCookie.matchAll(headerRegex)) {
        const header = match[2].trim();

        if (header.toLowerCase().startsWith(`${headerName.toLowerCase()}:`)) {
            values.push(header.replace(new RegExp(`^${headerName}\\s*:\\s*`, 'i'), ''));
        }
    }

    return values;
}

function getCookieDiagnostics(cookie: string) {
    const cookieNames = cookie
        .split(';')
        .map((part) => part.trim().split('=')[0])
        .filter(Boolean);
    const hasAuthCookie = cookieNames.some((name) => name.endsWith('_auth'));

    return {
        hasAuthCookie,
        message: `Cookie diagnostics: ${cookieNames.length} cookie(s), Discuz auth cookie ${hasAuthCookie ? 'present' : 'missing'}. Copy the Request Headers Cookie value from a logged-in Panwiki portal page, not response Set-Cookie.`,
    };
}

function getSetCookieHeaders(headers: Headers) {
    const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;

    if (typeof getSetCookie === 'function') {
        return getSetCookie.call(headers).flatMap((header) => splitSetCookieHeader(header));
    }

    const setCookie = headers.get('set-cookie');
    return setCookie ? splitSetCookieHeader(setCookie) : [];
}

function splitSetCookieHeader(header: string) {
    const headers: string[] = [];
    let start = 0;

    for (let index = 0; index < header.length; index++) {
        if (header[index] !== ',') {
            continue;
        }

        const next = header.slice(index + 1).trimStart();
        const nextName = next.match(/^([^=;,\s]+)=/)?.[1].toLowerCase();

        if (nextName && !cookieAttributeNames.has(nextName)) {
            headers.push(header.slice(start, index).trim());
            start = index + 1;
        }
    }

    headers.push(header.slice(start).trim());
    return headers.filter(Boolean);
}

function mergeCookies(cookie: string, setCookies: string[]) {
    const cookieMap = new Map(
        normalizeCookie(cookie)
            .split(';')
            .map((part) => part.trim())
            .filter((part) => part.includes('='))
            .map((part) => {
                const [name, ...valueParts] = part.split('=');
                return [name, valueParts.join('=')] as const;
            })
            .filter(([name]) => !cookieAttributeNames.has(name.toLowerCase()))
    );

    for (const setCookie of setCookies) {
        const parts = setCookie.split(';').map((part) => part.trim());
        const attributes = parts.slice(1);
        const isDeleted = attributes.some((attribute) => /^max-age=0$/i.test(attribute) || /^expires=thu,\s*01-jan-1970/i.test(attribute));

        for (const part of parts) {
            const [name, ...valueParts] = part.split('=');

            if (!name || valueParts.length === 0 || cookieAttributeNames.has(name.toLowerCase())) {
                continue;
            }

            const value = valueParts.join('=').replace(/,\s*(?:expires|max-age|domain|path|secure|httponly|samesite)=.*$/i, '');

            if (isDeleted) {
                cookieMap.delete(name);
            } else {
                cookieMap.set(name, value);
            }
        }
    }

    return [...cookieMap.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function extractLoginError($: CheerioAPI) {
    return normalizeText($('#returnmessage, [id^="returnmessage_"], .alert_error, .error').first().text() || $('body').text()).slice(0, 160);
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
