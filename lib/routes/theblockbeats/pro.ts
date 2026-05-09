import type { Context } from 'hono';
import type { Item } from 'rss-parser';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import type { Data, DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import rssParser from '@/utils/rss-parser';

const rootUrl = 'https://www.theblockbeats.info';
const apiBaseUrl = 'https://api-pro.theblockbeats.info';
const defaultSize = 20;
const maxSize = 50;

const channels = {
    newsflash: {
        title: '快讯',
        endpoint: '/v1/rss/newsflash',
        link: `${rootUrl}/newsflash`,
    },
    article: {
        title: '文章',
        endpoint: '/v1/rss/article',
        link: `${rootUrl}/article`,
    },
} as const;

type Channel = keyof typeof channels;

type BlockBeatsApiResponse = {
    status?: number;
    code?: number;
    message?: string;
    msg?: string;
};

export const route: Route = {
    path: '/pro/:channel',
    categories: ['finance'],
    view: ViewType.Articles,
    example: '/theblockbeats/pro/newsflash',
    parameters: {
        channel: {
            description: '类型',
            options: [
                { value: 'newsflash', label: '快讯' },
                { value: 'article', label: '文章' },
            ],
        },
    },
    features: {
        requireConfig: [
            {
                name: 'BLOCKBEATS_API_KEY',
                optional: false,
                description: 'BlockBeats API key from https://www.theblockbeats.info/apiDoc.',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Pro API',
    maintainers: ['dysthymia'],
    handler,
    description: 'Fetches BlockBeats Pro API data with the server-side `BLOCKBEATS_API_KEY` and outputs normal RSSHub RSS feeds.',
};

async function handler(ctx: Context): Promise<Data> {
    const channel = ctx.req.param('channel') as Channel;
    const channelConfig = channels[channel];

    if (!channelConfig) {
        throw new Error(`Unsupported BlockBeats channel: ${channel}`);
    }

    if (!config.blockbeats.apiKey) {
        throw new ConfigNotFoundError('BlockBeats API key is missing. Please set BLOCKBEATS_API_KEY.');
    }

    const size = Math.min(Number.parseInt(ctx.req.query('limit') || `${defaultSize}`, 10) || defaultSize, maxSize);
    const rawResponse = await ofetch<string>(`${apiBaseUrl}${channelConfig.endpoint}`, {
        query: {
            page: 1,
            size,
        },
        headers: {
            'api-key': config.blockbeats.apiKey,
        },
        parseResponse: (text) => text,
    });
    const xml = assertXmlResponse(rawResponse);
    const feed = await rssParser.parseString(xml);
    const items = feed.items.map((item) => mapRssItem(item, channel));

    return {
        title: feed.title || `律动 BlockBeats - ${channelConfig.title}`,
        link: feed.link || channelConfig.link,
        feedLink: `${apiBaseUrl}${channelConfig.endpoint}`,
        description: feed.description || `律动 BlockBeats ${channelConfig.title}`,
        language: 'zh-CN',
        item: items,
    };
}

function assertXmlResponse(response: string) {
    const trimmed = response.trim();

    if (trimmed.startsWith('{')) {
        const payload = JSON.parse(trimmed) as BlockBeatsApiResponse;
        const apiStatus = payload.status ?? payload.code;
        const apiMessage = payload.message || payload.msg;
        throw new Error(`BlockBeats API error ${apiStatus ?? 'unknown'}: ${apiMessage || 'Unknown error'}`);
    }

    if (!trimmed.startsWith('<')) {
        throw new Error(`Unexpected BlockBeats API response string. Length: ${response.length}`);
    }

    return response;
}

function mapRssItem(item: Item, channel: Channel): DataItem {
    const link = item.link;
    const description = item.content || item.summary || item.contentSnippet || '';
    const guid = item.guid || link || `theblockbeats-pro-${channel}-${item.title}`;

    return {
        title: item.title || link || '',
        link,
        guid,
        description,
        pubDate: item.isoDate ? parseDate(item.isoDate) : item.pubDate ? parseDate(item.pubDate) : undefined,
        author: item.creator,
        category: item.categories,
        image: item.enclosure?.url,
        enclosure_url: item.enclosure?.url,
        enclosure_type: item.enclosure?.type,
        enclosure_length: item.enclosure?.length,
    };
}
