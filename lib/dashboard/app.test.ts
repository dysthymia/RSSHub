import { describe, expect, it } from 'vitest';

import app from '@/app';

describe('route dashboard app', () => {
    it('serves the dashboard page', async () => {
        const response = await app.request('/dashboard/routes');

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        const body = await response.text();

        expect(body).toContain('Route Dashboard');
        expect(body).toContain("const defaultMaintainer = 'dysthymia'");
        expect(body).toContain("fetch('/api/dashboard/routes')");
        expect(body).toContain('(route) => route.gitStatus');
        expect(body).not.toContain('fetch(&#39;');
        expect(body).not.toContain('=&gt;');
    });

    it('serves route dashboard state', async () => {
        const response = await app.request('/api/dashboard/routes');

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');

        const data = await response.json();
        expect(Array.isArray(data.routes)).toBe(true);
        expect(Array.isArray(data.namespaces)).toBe(true);
        expect(data.write.enabled).toBe(false);
    });
});
