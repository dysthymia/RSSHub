import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['./lib/server.ts'],
    // Wait for https://github.com/vercel/vercel/pull/14429
    // Then we can set outDir to outputDirectory in vercel.json
    outDir: 'src',
    minify: true,
    shims: true,
    clean: true,
    // copy: [{ from: 'lib/assets', to: 'dist' }],
    deps: {
        // 将 CommonJS 净化器及其 ESM 解析器一同打包，避免 Vercel 运行时跨模块加载失败。
        alwaysBundle: ['sanitize-html', 'htmlparser2'],
        onlyBundle: false,
    },
});
