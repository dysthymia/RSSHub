import { Hono } from 'hono';

import { namespaces } from '@/registry';

import { createNamespace, createRoute, deleteRouteFile, getRouteDashboardState, readRouteFile, verifyMaintainers, writeRouteFile } from './route-manager';

const app = new Hono();

app.use('*', async (ctx, next) => {
    ctx.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
    ctx.header('Cache-Control', 'no-cache');
    await next();
});

app.get('/routes', async (ctx) => {
    const state = await getRouteDashboardState(namespaces);
    if (!isLocalRequest(ctx)) {
        state.write = {
            enabled: false,
            reason: 'File management is only available from localhost.',
        };
    }
    return ctx.json(state);
});

app.get('/routes/file', async (ctx) => {
    const namespace = ctx.req.query('namespace') || '';
    const location = ctx.req.query('location') || '';

    try {
        assertLocalRequest(ctx);
        const content = await readRouteFile({ namespace, location });
        return ctx.json({ content });
    } catch (error) {
        return jsonError(ctx, error);
    }
});

app.post('/routes/namespace', async (ctx) => {
    try {
        assertLocalRequest(ctx);
        const input = await ctx.req.json();
        const result = await createNamespace(input);
        return ctx.json(result, 201);
    } catch (error) {
        return jsonError(ctx, error);
    }
});

app.post('/routes/route', async (ctx) => {
    try {
        assertLocalRequest(ctx);
        const input = await ctx.req.json();
        await verifyMaintainers(input.maintainers || []);
        const result = await createRoute(input);
        return ctx.json(result, 201);
    } catch (error) {
        return jsonError(ctx, error);
    }
});

app.put('/routes/file', async (ctx) => {
    try {
        assertLocalRequest(ctx);
        const input = await ctx.req.json();
        await writeRouteFile(
            {
                namespace: input.namespace,
                location: input.location,
            },
            input.content || ''
        );
        return ctx.json({ ok: true });
    } catch (error) {
        return jsonError(ctx, error);
    }
});

app.delete('/routes/file', async (ctx) => {
    const namespace = ctx.req.query('namespace') || '';
    const location = ctx.req.query('location') || '';

    try {
        assertLocalRequest(ctx);
        await deleteRouteFile({ namespace, location });
        return ctx.json({ ok: true });
    } catch (error) {
        return jsonError(ctx, error);
    }
});

function jsonError(ctx, error: unknown) {
    const message = error instanceof Error ? error.message : 'Route dashboard request failed.';
    return ctx.json({ error: message }, 400);
}

function assertLocalRequest(ctx) {
    if (!isLocalRequest(ctx)) {
        throw new Error('File management is only available from localhost.');
    }
}

function isLocalRequest(ctx): boolean {
    const hostname = new URL(ctx.req.url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

export default app;
