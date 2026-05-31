import { Hono } from 'hono';
import { raw } from 'hono/html';

import { Layout } from '@/views/layout';

const app = new Hono();

app.get('/', (ctx) => ctx.redirect('/dashboard/routes'));

app.get('/routes', (ctx) => {
    ctx.header('Cache-Control', 'no-cache');

    return ctx.html(
        <Layout title="RSSHub Route Dashboard">
            <main className="min-h-screen bg-[oklch(97%_0.006_65)] text-[oklch(23%_0.012_65)]">
                <style>
                    {`
                    .route-dashboard {
                        --ink: oklch(23% 0.012 65);
                        --muted: oklch(48% 0.014 65);
                        --line: oklch(86% 0.014 65);
                        --surface: oklch(99% 0.004 65);
                        --accent: oklch(66% 0.18 42);
                        --blue: oklch(58% 0.13 245);
                        --green: oklch(56% 0.13 150);
                    }

                    .dashboard-button {
                        border: 1px solid var(--line);
                        border-radius: 8px;
                        padding: 0.56rem 0.74rem;
                        font-weight: 700;
                        transition: background 160ms ease-out, border-color 160ms ease-out, color 160ms ease-out;
                    }

                    .dashboard-button:hover {
                        border-color: oklch(74% 0.045 65);
                    }

                    .dashboard-button-primary {
                        background: var(--accent);
                        border-color: var(--accent);
                        color: oklch(99% 0.004 65);
                    }

                    .dashboard-input {
                        width: 100%;
                        border: 1px solid var(--line);
                        border-radius: 8px;
                        background: oklch(99% 0.004 65);
                        padding: 0.58rem 0.68rem;
                        color: var(--ink);
                        outline: none;
                    }

                    .dashboard-input:focus {
                        border-color: var(--blue);
                        box-shadow: 0 0 0 3px oklch(58% 0.13 245 / 14%);
                    }

                    .route-row {
                        border: 1px solid var(--line);
                        border-radius: 8px;
                        background: var(--surface);
                    }

                    .route-row[aria-selected="true"] {
                        border-color: oklch(58% 0.13 245 / 55%);
                        background: oklch(96% 0.02 245);
                    }

                    textarea.dashboard-input {
                        min-height: 32rem;
                        resize: vertical;
                        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
                        font-size: 0.82rem;
                        line-height: 1.48;
                    }
                    `}
                </style>
                <div className="route-dashboard mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 md:px-6">
                    <header className="flex flex-col gap-4 border-b border-[oklch(86%_0.014_65)] pb-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[oklch(52%_0.11_42)]">RSSHub local</p>
                            <h1 className="mt-1 text-3xl font-black tracking-normal text-[oklch(22%_0.018_65)]">Route Dashboard</h1>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm sm:min-w-[28rem]">
                            <div className="rounded-[8px] border border-[oklch(86%_0.014_65)] bg-[oklch(99%_0.004_65)] p-3">
                                <div className="text-xs font-bold uppercase text-[oklch(48%_0.014_65)]">Routes</div>
                                <div id="route-count" className="mt-1 text-2xl font-black">
                                    0
                                </div>
                            </div>
                            <div className="rounded-[8px] border border-[oklch(86%_0.014_65)] bg-[oklch(99%_0.004_65)] p-3">
                                <div className="text-xs font-bold uppercase text-[oklch(48%_0.014_65)]">Changed</div>
                                <div id="changed-count" className="mt-1 text-2xl font-black text-[oklch(56%_0.13_150)]">
                                    0
                                </div>
                            </div>
                            <div className="rounded-[8px] border border-[oklch(86%_0.014_65)] bg-[oklch(99%_0.004_65)] p-3">
                                <div className="text-xs font-bold uppercase text-[oklch(48%_0.014_65)]">Write</div>
                                <div id="write-state" className="mt-1 text-lg font-black text-[oklch(58%_0.13_245)]">
                                    ...
                                </div>
                            </div>
                        </div>
                    </header>

                    <section id="notice" className="hidden rounded-[8px] border border-[oklch(88%_0.09_42)] bg-[oklch(96%_0.025_42)] px-4 py-3 text-sm font-medium text-[oklch(35%_0.06_42)]"></section>

                    <div className="grid gap-5 lg:grid-cols-[minmax(28rem,0.95fr)_minmax(0,1.35fr)]">
                        <section className="flex min-h-[72vh] flex-col gap-3">
                            <div className="grid gap-2 md:grid-cols-[1.1fr_0.8fr_0.7fr]">
                                <input id="search-input" className="dashboard-input" placeholder="Search route, namespace, file" />
                                <input id="owner-input" className="dashboard-input" placeholder="GitHub maintainer" />
                                <select id="namespace-filter" className="dashboard-input">
                                    <option value="">All namespaces</option>
                                </select>
                            </div>
                            <div className="flex flex-wrap gap-2 text-sm">
                                <button id="changed-filter" className="dashboard-button bg-[oklch(99%_0.004_65)]" type="button">
                                    Changed only
                                </button>
                                <button id="clear-filter" className="dashboard-button bg-[oklch(99%_0.004_65)]" type="button">
                                    Clear
                                </button>
                                <button id="reload-button" className="dashboard-button bg-[oklch(99%_0.004_65)]" type="button">
                                    Reload
                                </button>
                            </div>
                            <div id="route-list" className="flex flex-1 flex-col gap-2 overflow-auto pr-1"></div>
                        </section>

                        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
                            <div className="flex min-w-0 flex-col gap-4">
                                <div className="rounded-[8px] border border-[oklch(86%_0.014_65)] bg-[oklch(99%_0.004_65)] p-4">
                                    <div className="flex flex-col gap-3">
                                        <div className="min-w-0">
                                            <div id="selected-route-name" className="truncate text-xl font-black">
                                                Select a route
                                            </div>
                                            <div id="selected-route-meta" className="mt-1 break-all text-sm font-medium text-[oklch(48%_0.014_65)]"></div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <a id="open-feed-link" className="dashboard-button bg-[oklch(99%_0.004_65)] text-center" href="#" target="_blank">
                                                Open feed
                                            </a>
                                            <button id="load-file-button" className="dashboard-button bg-[oklch(99%_0.004_65)]" type="button">
                                                Load file
                                            </button>
                                            <button id="save-file-button" className="dashboard-button dashboard-button-primary" type="button">
                                                Save
                                            </button>
                                            <button id="delete-file-button" className="dashboard-button bg-[oklch(99%_0.004_65)] text-[oklch(50%_0.15_27)]" type="button">
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                    <textarea id="file-editor" className="dashboard-input mt-4" spellCheck={false} placeholder="Route source will appear here"></textarea>
                                    <div id="editor-status" className="mt-2 min-h-5 text-sm font-semibold text-[oklch(48%_0.014_65)]"></div>
                                </div>
                            </div>

                            <aside className="flex flex-col gap-4">
                                <form id="namespace-form" className="rounded-[8px] border border-[oklch(86%_0.014_65)] bg-[oklch(99%_0.004_65)] p-4">
                                    <h2 className="text-lg font-black">New namespace</h2>
                                    <div className="mt-3 grid gap-2">
                                        <input name="namespace" className="dashboard-input" placeholder="folder id, example: mysite" required />
                                        <input name="name" className="dashboard-input" placeholder="display name" required />
                                        <input name="url" className="dashboard-input" placeholder="domain without protocol" />
                                        <select name="category" className="dashboard-input"></select>
                                        <input name="lang" className="dashboard-input" placeholder="lang, example: zh-CN" />
                                        <button className="dashboard-button dashboard-button-primary" type="submit">
                                            Create namespace
                                        </button>
                                    </div>
                                </form>

                                <form id="route-form" className="rounded-[8px] border border-[oklch(86%_0.014_65)] bg-[oklch(99%_0.004_65)] p-4">
                                    <h2 className="text-lg font-black">New route</h2>
                                    <div className="mt-3 grid gap-2">
                                        <select name="namespace" className="dashboard-input" required></select>
                                        <input name="fileName" className="dashboard-input" placeholder="file name, example: latest" required />
                                        <input name="routePath" className="dashboard-input" placeholder="/latest" required />
                                        <input name="name" className="dashboard-input" placeholder="route name" required />
                                        <input name="source" className="dashboard-input" placeholder="radar source, no protocol" />
                                        <input name="url" className="dashboard-input" placeholder="human page url" />
                                        <input name="maintainers" className="dashboard-input" placeholder="GitHub IDs, comma separated" required />
                                        <select name="category" className="dashboard-input"></select>
                                        <label className="flex items-center gap-2 text-sm font-bold text-[oklch(39%_0.018_65)]">
                                            <input name="requirePuppeteer" type="checkbox" />
                                            require Puppeteer
                                        </label>
                                        <button className="dashboard-button dashboard-button-primary" type="submit">
                                            Create route
                                        </button>
                                    </div>
                                </form>
                            </aside>
                        </section>
                    </div>
                </div>
                <script type="module">{raw(dashboardScript)}</script>
            </main>
        </Layout>
    );
});

const dashboardScript = String.raw`
const state = {
    data: null,
    selected: null,
    changedOnly: false,
};

const elements = {
    routeCount: document.getElementById('route-count'),
    changedCount: document.getElementById('changed-count'),
    writeState: document.getElementById('write-state'),
    notice: document.getElementById('notice'),
    searchInput: document.getElementById('search-input'),
    ownerInput: document.getElementById('owner-input'),
    namespaceFilter: document.getElementById('namespace-filter'),
    changedFilter: document.getElementById('changed-filter'),
    clearFilter: document.getElementById('clear-filter'),
    reloadButton: document.getElementById('reload-button'),
    routeList: document.getElementById('route-list'),
    selectedRouteName: document.getElementById('selected-route-name'),
    selectedRouteMeta: document.getElementById('selected-route-meta'),
    openFeedLink: document.getElementById('open-feed-link'),
    loadFileButton: document.getElementById('load-file-button'),
    saveFileButton: document.getElementById('save-file-button'),
    deleteFileButton: document.getElementById('delete-file-button'),
    fileEditor: document.getElementById('file-editor'),
    editorStatus: document.getElementById('editor-status'),
    namespaceForm: document.getElementById('namespace-form'),
    routeForm: document.getElementById('route-form'),
};

const defaultMaintainer = 'dysthymia';
const savedMaintainer = localStorage.getItem('rsshub-dashboard-maintainer');
elements.ownerInput.value = savedMaintainer === null ? defaultMaintainer : savedMaintainer;

async function loadDashboard() {
    setStatus('Loading routes...');
    const response = await fetch('/api/dashboard/routes');
    state.data = await response.json();
    renderDashboard();
    setStatus('');
}

function renderDashboard() {
    elements.writeState.textContent = state.data.write.enabled ? 'enabled' : 'read only';
    elements.notice.textContent = state.data.write.enabled ? '' : state.data.write.reason;
    elements.notice.classList.toggle('hidden', state.data.write.enabled);

    renderNamespaceOptions();
    renderCategoryOptions();
    renderRoutes();
    syncWriteControls();
}

function renderNamespaceOptions() {
    const selectedNamespace = elements.namespaceFilter.value;
    const namespaces = state.data.namespaces;
    elements.namespaceFilter.innerHTML = '<option value="">All namespaces</option>' + namespaces.map((namespace) => option(namespace.id, namespace.id + ' (' + namespace.routeCount + ')')).join('');
    elements.namespaceFilter.value = selectedNamespace;

    const routeNamespace = elements.routeForm.elements.namespace.value;
    elements.routeForm.elements.namespace.innerHTML = namespaces.map((namespace) => option(namespace.id, namespace.id)).join('');
    elements.routeForm.elements.namespace.value = routeNamespace || namespaces[0]?.id || '';
}

function renderCategoryOptions() {
    const options = state.data.categories.map((category) => option(category, category)).join('');
    elements.namespaceForm.elements.category.innerHTML = options;
    elements.routeForm.elements.category.innerHTML = options;
    elements.namespaceForm.elements.category.value = 'other';
    elements.routeForm.elements.category.value = 'other';
}

function renderRoutes() {
    const query = elements.searchInput.value.trim().toLowerCase();
    const owner = elements.ownerInput.value.trim().toLowerCase();
    const namespace = elements.namespaceFilter.value;
    const routes = state.data.routes.filter((route) => {
        const text = [route.name, route.routePath, route.namespace, route.filePath || '', route.maintainers.join(',')].join(' ').toLowerCase();
        return (!query || text.includes(query)) && (!owner || route.maintainers.some((maintainer) => maintainer.toLowerCase() === owner)) && (!namespace || route.namespace === namespace) && (!state.changedOnly || route.gitStatus);
    });

    elements.routeCount.textContent = routes.length;
    elements.changedCount.textContent = routes.filter((route) => route.gitStatus).length;
    elements.routeList.innerHTML = routes
        .map((route, index) => {
            const selected = state.selected && state.selected.namespace === route.namespace && state.selected.path === route.path;
            const status = route.gitStatus ? '<span class="rounded-[6px] bg-[oklch(92%_0.05_150)] px-2 py-0.5 text-[oklch(42%_0.11_150)]">' + escapeHtml(route.gitStatus) + '</span>' : '';
            const radar = route.supportRadar ? '<span class="rounded-[6px] bg-[oklch(93%_0.045_245)] px-2 py-0.5 text-[oklch(42%_0.1_245)]">radar</span>' : '';
            const browser = route.requirePuppeteer ? '<span class="rounded-[6px] bg-[oklch(93%_0.055_42)] px-2 py-0.5 text-[oklch(43%_0.11_42)]">browser</span>' : '';
            return '<button type="button" class="route-row px-3 py-3 text-left" data-index="' + index + '" data-route-key="' + escapeHtml(route.namespace + '|' + route.path) + '" aria-selected="' + selected + '">' +
                '<div class="flex items-start justify-between gap-3">' +
                '<div class="min-w-0">' +
                '<div class="truncate text-base font-black">' + escapeHtml(route.name) + '</div>' +
                '<div class="mt-1 break-all text-sm font-semibold text-[oklch(48%_0.014_65)]">' + escapeHtml(route.routePath) + '</div>' +
                '</div>' +
                '<div class="flex shrink-0 flex-wrap justify-end gap-1 text-xs font-black">' + status + radar + browser + '</div>' +
                '</div>' +
                '<div class="mt-2 truncate text-xs font-bold text-[oklch(52%_0.016_65)]">' + escapeHtml(route.filePath || 'registry only') + '</div>' +
                '</button>';
        })
        .join('');

    for (const button of elements.routeList.querySelectorAll('[data-route-key]')) {
        button.addEventListener('click', () => {
            const [selectedNamespace, selectedPath] = button.dataset.routeKey.split('|');
            state.selected = state.data.routes.find((route) => route.namespace === selectedNamespace && route.path === selectedPath);
            renderSelection();
            renderRoutes();
        });
    }
}

function renderSelection() {
    const route = state.selected;
    if (!route) {
        return;
    }

    elements.selectedRouteName.textContent = route.name;
    elements.selectedRouteMeta.textContent = [route.routePath, route.filePath || 'no file location', route.maintainers.join(', ')].filter(Boolean).join(' / ');
    elements.openFeedLink.href = route.example || route.routePath;
    elements.fileEditor.value = '';
    setStatus('');
    syncWriteControls();
}

async function loadSelectedFile() {
    const route = state.selected;
    if (!route?.location) {
        setStatus('No editable file location for this route.');
        return;
    }

    const params = new URLSearchParams({
        namespace: route.namespace,
        location: route.location,
    });
    const response = await fetch('/api/dashboard/routes/file?' + params);
    const data = await response.json();
    if (!response.ok) {
        setStatus(data.error || 'Unable to load file.');
        return;
    }
    elements.fileEditor.value = data.content;
    setStatus('Loaded ' + route.filePath);
}

async function saveSelectedFile() {
    const route = state.selected;
    if (!route?.location) {
        return;
    }

    const response = await fetch('/api/dashboard/routes/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            namespace: route.namespace,
            location: route.location,
            content: elements.fileEditor.value,
        }),
    });
    const data = await response.json();
    if (!response.ok) {
        setStatus(data.error || 'Unable to save file.');
        return;
    }
    setStatus('Saved ' + route.filePath);
    await loadDashboard();
}

async function deleteSelectedFile() {
    const route = state.selected;
    if (!route?.location) {
        return;
    }
    if (prompt('Type DELETE to remove ' + route.filePath) !== 'DELETE') {
        return;
    }

    const params = new URLSearchParams({
        namespace: route.namespace,
        location: route.location,
    });
    const response = await fetch('/api/dashboard/routes/file?' + params, {
        method: 'DELETE',
    });
    const data = await response.json();
    if (!response.ok) {
        setStatus(data.error || 'Unable to delete file.');
        return;
    }
    state.selected = null;
    elements.fileEditor.value = '';
    setStatus('Deleted ' + route.filePath);
    await loadDashboard();
}

async function createNamespaceFromForm(event) {
    event.preventDefault();
    const body = formData(elements.namespaceForm);
    const response = await fetch('/api/dashboard/routes/namespace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    await handleMutationResponse(response, elements.namespaceForm);
}

async function createRouteFromForm(event) {
    event.preventDefault();
    const body = formData(elements.routeForm);
    body.maintainers = body.maintainers.split(',').map((maintainer) => maintainer.trim()).filter(Boolean);
    body.requirePuppeteer = elements.routeForm.elements.requirePuppeteer.checked;
    const response = await fetch('/api/dashboard/routes/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    await handleMutationResponse(response, elements.routeForm);
}

async function handleMutationResponse(response, form) {
    const data = await response.json();
    if (!response.ok) {
        setStatus(data.error || 'Request failed.');
        return;
    }
    setStatus('Created ' + data.filePath);
    form.reset();
    await loadDashboard();
}

function syncWriteControls() {
    const enabled = Boolean(state.data?.write.enabled);
    const hasFile = Boolean(state.selected?.location);
    for (const element of [elements.saveFileButton, elements.deleteFileButton]) {
        element.disabled = !enabled || !hasFile;
        element.classList.toggle('opacity-40', !enabled || !hasFile);
        element.classList.toggle('cursor-not-allowed', !enabled || !hasFile);
    }
    for (const element of [elements.namespaceForm.querySelector('button'), elements.routeForm.querySelector('button')]) {
        element.disabled = !enabled;
        element.classList.toggle('opacity-40', !enabled);
        element.classList.toggle('cursor-not-allowed', !enabled);
    }
    elements.loadFileButton.classList.toggle('opacity-40', !hasFile);
    elements.loadFileButton.disabled = !hasFile;
}

function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
}

function option(value, label) {
    return '<option value="' + escapeHtml(value) + '">' + escapeHtml(label) + '</option>';
}

function setStatus(message) {
    elements.editorStatus.textContent = message;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[character]));
}

elements.searchInput.addEventListener('input', renderRoutes);
elements.ownerInput.addEventListener('input', () => {
    localStorage.setItem('rsshub-dashboard-maintainer', elements.ownerInput.value.trim());
    renderRoutes();
});
elements.namespaceFilter.addEventListener('change', renderRoutes);
elements.changedFilter.addEventListener('click', () => {
    state.changedOnly = !state.changedOnly;
    elements.changedFilter.classList.toggle('dashboard-button-primary', state.changedOnly);
    renderRoutes();
});
elements.clearFilter.addEventListener('click', () => {
    elements.searchInput.value = '';
    elements.ownerInput.value = '';
    elements.namespaceFilter.value = '';
    localStorage.setItem('rsshub-dashboard-maintainer', '');
    state.changedOnly = false;
    elements.changedFilter.classList.remove('dashboard-button-primary');
    renderRoutes();
});
elements.reloadButton.addEventListener('click', loadDashboard);
elements.loadFileButton.addEventListener('click', loadSelectedFile);
elements.saveFileButton.addEventListener('click', saveSelectedFile);
elements.deleteFileButton.addEventListener('click', deleteSelectedFile);
elements.namespaceForm.addEventListener('submit', createNamespaceFromForm);
elements.routeForm.addEventListener('submit', createRouteFromForm);

loadDashboard().catch((error) => setStatus(error.message));
`;

export default app;
