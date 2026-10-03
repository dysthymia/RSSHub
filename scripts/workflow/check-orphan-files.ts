import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getCurrentPath } from '../../lib/utils/helpers';

const __dirname = getCurrentPath(import.meta.url);
const repoRoot = path.join(__dirname, '../..');

export const findOrphanFiles = async (): Promise<string[]> => {
    const folders = ['lib', 'spec', 'specs', 'test', 'tests'].filter((folder) => existsSync(path.join(repoRoot, folder)));
    const entries = (await Promise.all(folders.map((folder) => fs.readdir(path.join(repoRoot, folder), { recursive: true, withFileTypes: true })))).flat();
    const files = entries.filter((entry) => entry.isFile()).map((entry) => path.relative(repoRoot, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'));

    const candidates = entries
        .filter((entry) => entry.isFile() && /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(entry.name))
        .map((entry) => {
            const absolute = path.join(entry.parentPath, entry.name);
            return { absolute, relative: path.relative(repoRoot, absolute).replaceAll('\\', '/') };
        })
        .filter(({ relative }) => relative.startsWith('lib/') && relative !== 'lib/setup.test.ts');

    const orphans = (
        await Promise.all(
            candidates.map(async ({ absolute, relative }) => {
                if (relative.startsWith('lib/routes/')) {
                    return relative;
                }
                const dir = path.dirname(absolute);
                const base = path.basename(absolute).replace(/(?:\.worker)?\.(?:spec|test)\.[cm]?[jt]sx?$/, '');
                const exists = entries.some((entry) => entry.parentPath === dir && entry.isFile() && new RegExp(`^${base.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}(?:\\.worker)?\\.[cm]?[jt]sx?$`).test(entry.name));
                if (exists) {
                    return null;
                }
                // 路由单测可放在 lib 根目录，但文件名必须与实际路由模块对应。
                if (dir === path.join(repoRoot, 'lib')) {
                    const content = await fs.readFile(absolute, 'utf8');
                    const routeImport = content.match(/from ['"]@\/routes\/([^'"]+)['"]/);
                    if (routeImport?.[1].replaceAll('/', '-') === base && ['ts', 'tsx'].some((extension) => existsSync(path.join(repoRoot, 'lib/routes', `${routeImport[1]}.${extension}`)))) {
                        return null;
                    }
                }
                return relative;
            })
        )
    ).filter((relative) => relative !== null);

    const deprecated = files.filter((relative) => !relative.startsWith('lib/') || relative.startsWith('lib/routes-deprecated/'));

    return [...orphans, ...deprecated];
};
