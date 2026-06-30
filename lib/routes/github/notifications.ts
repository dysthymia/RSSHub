import type { Context } from 'hono';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const apiUrl = 'https://api.github.com';
const fallbackUrl = 'https://github.com/notifications';
const notificationStates = new Set<NotificationState>(['unread', 'all', 'participating']);

export const route: Route = {
    path: '/notifications/:state?',
    categories: ['programming'],
    example: '/github/notifications',
    view: ViewType.Notifications,
    parameters: {
        state: {
            description: 'Notification state to include',
            default: 'unread',
            options: [
                {
                    label: 'Unread notifications',
                    value: 'unread',
                },
                {
                    label: 'All notifications',
                    value: 'all',
                },
                {
                    label: 'Participating notifications',
                    value: 'participating',
                },
            ],
        },
    },
    features: {
        requireConfig: [
            {
                name: 'GITHUB_ACCESS_TOKEN',
                description: 'GitHub access token with notifications permission',
            },
        ],
    },
    radar: [
        {
            source: ['github.com/notifications'],
        },
    ],
    name: 'Notifications',
    maintainers: ['zhzy0077'],
    handler,
    url: 'github.com/notifications',
    description: 'Convert the authenticated user GitHub Notifications inbox to RSS. Fetches the first page of the GitHub Notifications API and does not mark notifications as read.',
};

type NotificationState = 'unread' | 'all' | 'participating';

type GithubNotification = {
    id: string;
    unread: boolean;
    reason: string;
    updated_at: string;
    repository: {
        full_name: string;
        html_url: string;
    };
    subject: {
        title: string;
        type: string;
        url?: string;
        latest_comment_url?: string;
    };
};

type GithubSubjectDetail = {
    html_url?: string;
};

async function handler(ctx: Context) {
    if (!config.github || !config.github.access_token) {
        throw new ConfigNotFoundError('GitHub notification RSS is disabled due to the lack of <a href="https://docs.rsshub.app/deploy/config#route-specific-configurations">relevant config</a>');
    }
    const state = getNotificationState(ctx.req.param('state'));
    const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.github.access_token}`,
        'X-GitHub-Api-Version': '2022-11-28',
    };

    const response = await ofetch.raw<GithubNotification[]>(`${apiUrl}/notifications?${getSearchParams(state).toString()}`, {
        headers,
    });
    const notifications = response._data ?? [];

    const items = await Promise.all(
        notifications.map(async (notification): Promise<DataItem> => {
            const link = await getNotificationLink(notification, headers);

            return {
                title: `${notification.repository.full_name}: ${notification.subject.title}`,
                description: getDescription(notification),
                pubDate: parseDate(notification.updated_at),
                guid: notification.id,
                link,
                category: [notification.repository.full_name, notification.subject.type, notification.reason, notification.unread ? 'unread' : 'read'],
            };
        })
    );

    const rateLimitReset = response.headers.get('x-ratelimit-reset');
    ctx.set('json', {
        title: getFeedTitle(state),
        item: notifications,
        rateLimit: {
            limit: getHeaderNumber(response.headers, 'x-ratelimit-limit'),
            remaining: getHeaderNumber(response.headers, 'x-ratelimit-remaining'),
            reset: rateLimitReset ? parseDate(Number.parseInt(rateLimitReset), 'X') : undefined,
            resource: response.headers.get('x-ratelimit-resource'),
            used: getHeaderNumber(response.headers, 'x-ratelimit-used'),
        },
    });

    return {
        title: getFeedTitle(state),
        link: fallbackUrl,
        item: items,
        allowEmpty: true,
    };
}

function getNotificationState(state?: string): NotificationState {
    if (!state) {
        return 'unread';
    }
    if (notificationStates.has(state as NotificationState)) {
        return state as NotificationState;
    }

    throw new InvalidParameterError('Invalid notification state. Use `unread`, `all`, or `participating`.');
}

function getSearchParams(state: NotificationState): URLSearchParams {
    const searchParams = new URLSearchParams({
        per_page: '50',
    });

    if (state === 'all') {
        searchParams.set('all', 'true');
    } else if (state === 'participating') {
        searchParams.set('participating', 'true');
    }

    return searchParams;
}

async function getNotificationLink(notification: GithubNotification, headers: Record<string, string>): Promise<string> {
    if (notification.subject.latest_comment_url) {
        const commentUrl = await getHtmlUrl(notification.subject.latest_comment_url, headers);
        if (commentUrl) {
            return commentUrl;
        }
    }

    if (notification.subject.url) {
        if (notification.subject.type === 'Release') {
            const releaseUrl = await getHtmlUrl(notification.subject.url, headers);
            if (releaseUrl) {
                return releaseUrl;
            }
        }

        return convertApiUrlToWebUrl(notification.subject.url);
    }

    return notification.repository.html_url || fallbackUrl;
}

async function getHtmlUrl(url: string, headers: Record<string, string>): Promise<string | undefined> {
    try {
        const detail = await cache.tryGet<GithubSubjectDetail>(`github:notifications:${url}`, async () => await ofetch<GithubSubjectDetail>(url, { headers }));

        return detail.html_url;
    } catch {
        return undefined;
    }
}

function convertApiUrlToWebUrl(url: string): string {
    if (!url.startsWith(`${apiUrl}/repos/`)) {
        return url;
    }

    return url
        .replace(`${apiUrl}/repos/`, 'https://github.com/')
        .replace(/\/pulls\/(\d+)$/, '/pull/$1')
        .replace(/\/commits\//, '/commit/')
        .replace(/\/releases\/\d+$/, '/releases');
}

function getDescription(notification: GithubNotification): string {
    return [
        ['Repository', notification.repository.full_name],
        ['Type', notification.subject.type],
        ['Reason', notification.reason],
        ['State', notification.unread ? 'Unread' : 'Read'],
    ]
        .map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`)
        .join('');
}

function getFeedTitle(state: NotificationState): string {
    if (state === 'all') {
        return 'GitHub Notifications - All';
    }
    if (state === 'participating') {
        return 'GitHub Notifications - Participating';
    }

    return 'GitHub Notifications - Unread';
}

function getHeaderNumber(headers: Headers, name: string): number | undefined {
    const value = headers.get(name);

    return value ? Number.parseInt(value) : undefined;
}

function escapeHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
