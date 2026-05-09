import type { Context } from 'hono';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import type { Data, DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://www.theblockbeats.info';
const apiBaseUrl = 'https://api-pro.theblockbeats.info';
const defaultSize = 20;
const maxSize = 50;

const channels = {
    newsflash: {
        title: '快讯',
        endpoint: '/v1/newsflash',
        link: `${rootUrl}/newsflash`,
        itemPath: 'flash',
    },
    article: {
        title: '文章',
        endpoint: '/v1/article',
        link: `${rootUrl}/article`,
        itemPath: 'news',
    },
} as const;

type Channel = keyof typeof channels;

type BlockBeatsApiItem = {
    id: number;
    title: string;
    content?: string;
    pic?: string;
    link?: string;
    create_time?: string;
};

type BlockBeatsApiResponse = {
    status: number;
    message?: string;
    data?: {
        data?: BlockBeatsApiItem[];
    };
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
    const response = await ofetch<BlockBeatsApiResponse>(`${apiBaseUrl}${channelConfig.endpoint}`, {
        query: {
            page: 1,
            size,
            lang: 'cn',
        },
        headers: {
            'api-key': config.blockbeats.apiKey,
        },
    });

    if (response.status !== 0) {
        throw new Error(`BlockBeats API error ${response.status}: ${response.message || 'Unknown error'}`);
    }

    const items =
        response.data?.data?.map((item): DataItem => {
            const link = item.link || `${rootUrl}/${channelConfig.itemPath}/${item.id}`;

            return {
                title: item.title,
                link,
                guid: `theblockbeats-pro-${channel}-${item.id}`,
                description: renderDescription(item),
                pubDate: parseBlockBeatsDate(item.create_time),
                image: item.pic || undefined,
            };
        }) ?? [];

    return {
        title: `律动 BlockBeats - ${channelConfig.title}`,
        link: channelConfig.link,
        description: `律动 BlockBeats ${channelConfig.title}`,
        language: 'zh-CN',
        item: items,
    };
}

function parseBlockBeatsDate(value?: string) {
    if (!value) {
        return;
    }

    if (/^\d{10}$/.test(value)) {
        return parseDate(value, 'X');
    }

    return parseDate(value);
}

function renderDescription(item: BlockBeatsApiItem) {
    const image = item.pic ? `<p><img src="${item.pic}"></p>` : '';

    return `${image}${item.content || ''}`;
}
