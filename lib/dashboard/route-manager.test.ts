import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Namespace, Route } from '@/types';

import { createNamespace, createRoute, getRouteDashboardState, readRouteFile, resolveRouteFilePath } from './route-manager';

let rootDirectory: string;
let previousWriteFlag: string | undefined;
let previousVerifyFlag: string | undefined;

describe('dashboard route manager', () => {
    beforeEach(async () => {
        rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'rsshub-dashboard-'));
        previousWriteFlag = process.env.RSSHUB_ROUTE_DASHBOARD_WRITE;
        previousVerifyFlag = process.env.RSSHUB_ROUTE_DASHBOARD_VERIFY_MAINTAINERS;
        process.env.RSSHUB_ROUTE_DASHBOARD_WRITE = 'true';
        process.env.RSSHUB_ROUTE_DASHBOARD_VERIFY_MAINTAINERS = 'false';
    });

    afterEach(async () => {
        if (previousWriteFlag === undefined) {
            delete process.env.RSSHUB_ROUTE_DASHBOARD_WRITE;
        } else {
            process.env.RSSHUB_ROUTE_DASHBOARD_WRITE = previousWriteFlag;
        }
        if (previousVerifyFlag === undefined) {
            delete process.env.RSSHUB_ROUTE_DASHBOARD_VERIFY_MAINTAINERS;
        } else {
            process.env.RSSHUB_ROUTE_DASHBOARD_VERIFY_MAINTAINERS = previousVerifyFlag;
        }
        await fs.rm(rootDirectory, { recursive: true, force: true });
    });

    it('creates namespace and route source files', async () => {
        const namespaceResult = await createNamespace(
            {
                namespace: 'mysite',
                name: 'My Site',
                url: 'https://example.com',
                category: 'blog',
                lang: 'en',
            },
            rootDirectory
        );

        expect(namespaceResult.filePath).toBe('lib/routes/mysite/namespace.ts');
        const namespaceFile = await readRouteFile({ namespace: 'mysite', location: 'namespace.ts' }, rootDirectory);
        expect(namespaceFile).toContain('url: "example.com"');
        expect(namespaceFile).toContain('categories: ["blog"]');

        const routeResult = await createRoute(
            {
                namespace: 'mysite',
                fileName: 'latest',
                routePath: '/latest',
                name: 'Latest',
                source: 'https://example.com/news',
                maintainers: ['DIYgod'],
                category: 'blog',
            },
            rootDirectory
        );

        expect(routeResult.filePath).toBe('lib/routes/mysite/latest.ts');
        const routeFile = await readRouteFile({ namespace: 'mysite', location: 'latest.ts' }, rootDirectory);
        expect(routeFile).toContain('example: "/mysite/latest"');
        expect(routeFile).toContain('source: ["example.com/news"]');
        expect(routeFile).toContain('target: "/latest"');
        expect(routeFile).toContain('requirePuppeteer: false');
        expect(routeFile).toContain('supportRadar: true');
    });

    it('rejects route file traversal', () => {
        expect(() => resolveRouteFilePath({ namespace: 'mysite', location: '../other.ts' }, rootDirectory)).toThrow('Invalid route file location.');
        expect(() => resolveRouteFilePath({ namespace: '../bad', location: 'index.ts' }, rootDirectory)).toThrow('Namespace must contain only letters');
    });

    it('builds dashboard state from registry data', async () => {
        const route: Route & { location: string } = {
            path: '/latest',
            name: 'Latest',
            maintainers: ['DIYgod'],
            example: '/latest',
            categories: ['blog'],
            features: {
                requirePuppeteer: true,
            },
            radar: [
                {
                    source: ['example.com/news'],
                    target: '/latest',
                },
            ],
            location: 'latest.ts',
            handler: () => ({
                title: 'Latest',
                item: [
                    {
                        title: 'Item',
                    },
                ],
            }),
        };
        const namespaces = {
            mysite: {
                name: 'My Site',
                routes: {
                    '/latest': route,
                },
            } as Namespace & { routes: Record<string, typeof route> },
        };

        const state = await getRouteDashboardState(namespaces, rootDirectory);

        expect(state.namespaces).toHaveLength(1);
        expect(state.routes).toMatchObject([
            {
                namespace: 'mysite',
                example: '/mysite/latest',
                routePath: '/mysite/latest',
                filePath: 'lib/routes/mysite/latest.ts',
                requirePuppeteer: true,
                supportRadar: true,
            },
        ]);
    });
});
