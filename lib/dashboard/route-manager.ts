import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Category, Namespace, Route } from '@/types';

const execFileAsync = promisify(execFile);
const routeDirectory = path.join('lib', 'routes');
const safeNamespacePattern = /^[a-z0-9][a-z0-9.-]*$/i;
const safeFileNamePattern = /^[a-z0-9][a-z0-9.-]*$/i;
const safeMaintainerPattern = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

const categories: Category[] = [
    'popular',
    'social-media',
    'new-media',
    'traditional-media',
    'bbs',
    'blog',
    'programming',
    'design',
    'live',
    'multimedia',
    'picture',
    'anime',
    'program-update',
    'university',
    'forecast',
    'travel',
    'shopping',
    'game',
    'reading',
    'government',
    'study',
    'journal',
    'finance',
    'sport',
    'other',
];

type RouteWithLocation = Route & {
    location?: string;
};

type NamespaceWithRoutes = Namespace & {
    routes?: Record<string, RouteWithLocation>;
};

export type DashboardRoute = {
    namespace: string;
    namespaceName: string;
    path: string;
    routePath: string;
    name: string;
    example: string;
    categories: Category[];
    maintainers: string[];
    location?: string;
    filePath?: string;
    gitStatus?: string;
    requirePuppeteer: boolean;
    supportRadar: boolean;
};

export type DashboardNamespace = {
    id: string;
    name: string;
    url?: string;
    categories: Category[];
    routeCount: number;
    gitStatus?: string;
};

export type RouteDashboardState = {
    categories: Category[];
    namespaces: DashboardNamespace[];
    routes: DashboardRoute[];
    write: {
        enabled: boolean;
        reason?: string;
    };
};

export type CreateNamespaceInput = {
    namespace: string;
    name: string;
    url?: string;
    category?: Category;
    lang?: string;
};

export type CreateRouteInput = {
    namespace: string;
    fileName: string;
    routePath: string;
    name: string;
    source?: string;
    url?: string;
    category?: Category;
    maintainers: string[];
    requirePuppeteer?: boolean;
};

export type RouteFileRef = {
    namespace: string;
    location: string;
};

export function getWriteState(): RouteDashboardState['write'] {
    if (process.env.RSSHUB_ROUTE_DASHBOARD_WRITE === 'true') {
        return { enabled: true };
    }

    if (process.env.NODE_ENV === 'dev' && !process.env.VERCEL_ENV) {
        return { enabled: true };
    }

    return {
        enabled: false,
        reason: 'File management is only enabled in local dev. Set RSSHUB_ROUTE_DASHBOARD_WRITE=true to override.',
    };
}

export async function getRouteDashboardState(namespaces: Record<string, NamespaceWithRoutes>, rootDirectory = process.cwd()): Promise<RouteDashboardState> {
    const gitStatuses = await getGitStatuses(rootDirectory);
    const namespaceRows: DashboardNamespace[] = [];
    const routeRows: DashboardRoute[] = [];

    for (const [namespace, data] of Object.entries(namespaces).toSorted(([a], [b]) => a.localeCompare(b))) {
        const routeEntries = Object.entries(data.routes || {}) as Array<[string, RouteWithLocation]>;
        const namespaceFilePath = path.posix.join(routeDirectory, namespace, 'namespace.ts');

        namespaceRows.push({
            id: namespace,
            name: data.name,
            url: data.url,
            categories: data.categories || [],
            routeCount: routeEntries.length,
            gitStatus: gitStatuses.get(namespaceFilePath),
        });

        for (const [routePath, route] of routeEntries.toSorted(([a], [b]) => a.localeCompare(b))) {
            const location = route.location;
            const filePath = location ? path.posix.join(routeDirectory, namespace, toPosixPath(location)) : undefined;
            const fullRoutePath = `/${namespace}${routePath}`;
            const example = route.example?.startsWith(`/${namespace}`) ? route.example : fullRoutePath;

            routeRows.push({
                namespace,
                namespaceName: data.name,
                path: routePath,
                routePath: fullRoutePath,
                name: route.name,
                example,
                categories: route.categories || data.categories || [],
                maintainers: route.maintainers || [],
                location,
                filePath,
                gitStatus: filePath ? gitStatuses.get(filePath) : undefined,
                requirePuppeteer: route.features?.requirePuppeteer === true,
                supportRadar: route.features?.supportRadar === true || Boolean(route.radar?.length),
            });
        }
    }

    return {
        categories,
        namespaces: namespaceRows,
        routes: routeRows,
        write: getWriteState(),
    };
}

export function readRouteFile(ref: RouteFileRef, rootDirectory = process.cwd()): Promise<string> {
    requireWriteAccess();
    const filePath = resolveRouteFilePath(ref, rootDirectory);
    return fs.readFile(filePath, 'utf8');
}

export async function writeRouteFile(ref: RouteFileRef, content: string, rootDirectory = process.cwd()): Promise<void> {
    requireWriteAccess();
    const filePath = resolveRouteFilePath(ref, rootDirectory);
    await fs.writeFile(filePath, content, 'utf8');
}

export async function deleteRouteFile(ref: RouteFileRef, rootDirectory = process.cwd()): Promise<void> {
    requireWriteAccess();
    const filePath = resolveRouteFilePath(ref, rootDirectory);
    await fs.unlink(filePath);
}

export async function createNamespace(input: CreateNamespaceInput, rootDirectory = process.cwd()): Promise<{ filePath: string }> {
    requireWriteAccess();
    assertSafeNamespace(input.namespace);
    const namespaceDirectory = path.join(rootDirectory, routeDirectory, input.namespace);
    const namespaceFile = path.join(namespaceDirectory, 'namespace.ts');

    await assertFileDoesNotExist(namespaceFile);
    await fs.mkdir(namespaceDirectory, { recursive: true });
    await fs.writeFile(namespaceFile, renderNamespaceTemplate(input), 'utf8');

    return {
        filePath: toPosixPath(path.relative(rootDirectory, namespaceFile)),
    };
}

export async function createRoute(input: CreateRouteInput, rootDirectory = process.cwd()): Promise<{ filePath: string }> {
    requireWriteAccess();
    assertSafeNamespace(input.namespace);
    assertSafeFileName(input.fileName);
    assertRoutePath(input.routePath);
    assertMaintainers(input.maintainers);

    const namespaceDirectory = path.join(rootDirectory, routeDirectory, input.namespace);
    const routeFile = path.join(namespaceDirectory, `${input.fileName}.ts`);

    await assertDirectoryExists(namespaceDirectory);
    await assertFileDoesNotExist(routeFile);
    await fs.writeFile(routeFile, renderRouteTemplate(input), 'utf8');

    return {
        filePath: toPosixPath(path.relative(rootDirectory, routeFile)),
    };
}

export function resolveRouteFilePath(ref: RouteFileRef, rootDirectory = process.cwd()): string {
    assertSafeNamespace(ref.namespace);
    if (path.isAbsolute(ref.location) || ref.location.split(/[\\/]/).includes('..')) {
        throw new Error('Invalid route file location.');
    }
    if (!/\.(tsx?|mts)$/.test(ref.location)) {
        throw new Error('Route file must be a TypeScript file.');
    }

    const namespaceDirectory = path.resolve(rootDirectory, routeDirectory, ref.namespace);
    const filePath = path.resolve(namespaceDirectory, ref.location);

    if (filePath !== namespaceDirectory && !filePath.startsWith(namespaceDirectory + path.sep)) {
        throw new Error('Route file must stay inside its namespace directory.');
    }

    return filePath;
}

export async function verifyMaintainers(maintainers: string[]): Promise<void> {
    assertMaintainers(maintainers);
    if (process.env.RSSHUB_ROUTE_DASHBOARD_VERIFY_MAINTAINERS === 'false') {
        return;
    }

    const checks = await Promise.all(
        maintainers.map(async (maintainer) => {
            const response = await fetch(`https://api.github.com/users/${maintainer}`, {
                method: 'HEAD',
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'RSSHub route dashboard',
                },
            });
            return {
                maintainer,
                ok: response.ok,
            };
        })
    );
    const missing = checks.filter((check) => !check.ok).map((check) => check.maintainer);

    if (missing.length) {
        throw new Error(`GitHub maintainer not found: ${missing.join(', ')}`);
    }
}

function requireWriteAccess() {
    const write = getWriteState();
    if (!write.enabled) {
        throw new Error(write.reason);
    }
}

async function getGitStatuses(rootDirectory: string): Promise<Map<string, string>> {
    try {
        const { stdout } = await execFileAsync('git', ['status', '--short', '--', routeDirectory], {
            cwd: rootDirectory,
        });
        const statuses = new Map<string, string>();

        for (const line of stdout.split('\n')) {
            if (!line.trim()) {
                continue;
            }

            const status = line.slice(0, 2).trim();
            const rawFile = line.slice(3).trim();
            const file = rawFile.includes(' -> ') ? rawFile.split(' -> ').at(-1)! : rawFile;
            statuses.set(toPosixPath(file), status);
        }

        return statuses;
    } catch {
        return new Map();
    }
}

async function assertDirectoryExists(directoryPath: string) {
    try {
        const stats = await fs.stat(directoryPath);
        if (!stats.isDirectory()) {
            throw new Error('Namespace path is not a directory.');
        }
    } catch {
        throw new Error('Namespace directory does not exist.');
    }
}

async function assertFileDoesNotExist(filePath: string) {
    try {
        await fs.access(filePath);
    } catch {
        return;
    }
    throw new Error('File already exists.');
}

function assertSafeNamespace(namespace: string) {
    if (!safeNamespacePattern.test(namespace)) {
        throw new Error('Namespace must contain only letters, numbers, dots, and hyphens.');
    }
}

function assertSafeFileName(fileName: string) {
    if (!safeFileNamePattern.test(fileName)) {
        throw new Error('File name must contain only letters, numbers, dots, and hyphens.');
    }
}

function assertRoutePath(routePath: string) {
    if (!routePath.startsWith('/') || routePath.startsWith('//') || routePath.includes('://')) {
        throw new Error('Route path must start with a single slash and cannot be a full URL.');
    }
}

function assertMaintainers(maintainers: string[]) {
    if (!maintainers.length) {
        throw new Error('At least one maintainer is required.');
    }
    const invalid = maintainers.filter((maintainer) => !safeMaintainerPattern.test(maintainer));
    if (invalid.length) {
        throw new Error(`Invalid GitHub maintainer id: ${invalid.join(', ')}`);
    }
}

function renderNamespaceTemplate(input: CreateNamespaceInput): string {
    const fields = [
        `    name: ${quote(input.name || input.namespace)},`,
        input.url ? `    url: ${quote(stripProtocol(input.url))},` : undefined,
        `    categories: [${quote(input.category || 'other')}],`,
        input.lang ? `    lang: ${quote(input.lang)},` : undefined,
    ].filter(Boolean);

    return `import type { Namespace } from '@/types';

export const namespace: Namespace = {
${fields.join('\n')}
};
`;
}

function renderRouteTemplate(input: CreateRouteInput): string {
    const source = input.source ? stripProtocol(input.source) : undefined;
    const routePath = input.routePath;
    const example = `/${input.namespace}${routePath}`;
    const link = input.url ? ensureProtocol(input.url) : source ? ensureProtocol(source) : 'https://example.com/';
    const sourceLines = source
        ? `
    radar: [
        {
            source: [${quote(source)}],
            target: ${quote(routePath)},
        },
    ],`
        : '';

    return `import type { Route } from '@/types';

export const route: Route = {
    path: ${quote(routePath)},
    name: ${quote(input.name)},
    url: ${quote(stripProtocol(input.url || source || 'example.com'))},
    maintainers: [${input.maintainers.map((maintainer) => quote(maintainer)).join(', ')}],
    example: ${quote(example)},
    categories: [${quote(input.category || 'other')}],
    features: {
        requireConfig: false,
        requirePuppeteer: ${input.requirePuppeteer ? 'true' : 'false'},
        ${source ? 'supportRadar: true,' : ''}
    },${sourceLines}
    handler,
};

async function handler() {
    return {
        title: ${quote(input.name)},
        link: ${quote(link)},
        item: [
            {
                title: ${quote(`${input.name} sample item`)},
                link: ${quote(link)},
                description: 'Replace this scaffold with the source article content.',
            },
        ],
    };
}
`;
}

function quote(value: string): string {
    return JSON.stringify(value);
}

function stripProtocol(value: string): string {
    return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function ensureProtocol(value: string): string {
    return value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
}

function toPosixPath(value: string): string {
    return value.split(path.sep).join('/');
}
