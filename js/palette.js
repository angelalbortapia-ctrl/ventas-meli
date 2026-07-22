/* ==========================================================================
   Command Palette (⌘K / Ctrl+K).
   Muestra acciones y productos, con búsqueda en vivo y navegación por teclado.
   ========================================================================== */

const Palette = (() => {

    let open = false;
    let query = '';
    let selectedIdx = 0;
    let items = [];

    const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    function baseActions(App) {
        return [
            { section: 'Navegación', icon: '📦', title: 'Ir a Productos', keys: 'Lotes', run: () => App.switchTab('lotes') },
            { section: 'Navegación', icon: '📊', title: 'Ir a Inicio', keys: 'Dashboard KPIs métricas', run: () => App.switchTab('dashboard') },
            { section: 'Navegación', icon: '💡', title: 'Ir a Insights', keys: 'Alertas recomendaciones', run: () => App.switchTab('insights') },
            { section: 'Navegación', icon: '⚙️', title: 'Ir a Ajustes', keys: 'Comisiones IVA umbral', run: () => App.switchTab('settings') },

            { section: 'Acciones', icon: '➕', title: 'Nuevo lote', keys: 'Producto agregar crear', run: () => LotesView.openModal(null) },
            { section: 'Acciones', icon: '📥', title: 'Importar Excel', keys: 'Cargar archivo xlsx', run: () => document.getElementById('file-import').click() },
            { section: 'Acciones', icon: '📤', title: 'Exportar Excel', keys: 'Descargar xlsx', run: () => App.exportExcel() },
            { section: 'Acciones', icon: '💾', title: 'Respaldo (exportar/importar JSON)', keys: 'Backup datos', run: () => App.openBackup() },
            { section: 'Acciones', icon: '↺', title: 'Restaurar ajustes por defecto', keys: 'Reset settings', run: () => App.resetSettings() },
        ];
    }

    function buildIndex(App) {
        const actions = baseActions(App);
        const lotesItems = (window.State.lotes || []).map(l => ({
            section: 'Productos',
            icon: '•',
            title: l.producto || '(sin nombre)',
            sub: `${l.sku || '—'} · ${l.variante || ''}`,
            keys: `${l.sku} ${l.categoria || ''}`,
            run: () => LotesView.selectAndGo(l.id),
        }));
        return [...actions, ...lotesItems];
    }

    function filter(all, q) {
        if (!q.trim()) return all;
        const n = normalize(q);
        return all.filter(it => {
            const hay = normalize(`${it.title} ${it.sub || ''} ${it.keys || ''} ${it.section}`);
            return hay.includes(n);
        });
    }

    function render(App) {
        let host = document.getElementById('palette-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'palette-host';
            document.body.appendChild(host);
        }

        const all = buildIndex(App);
        items = filter(all, query);
        if (selectedIdx >= items.length) selectedIdx = 0;

        // Agrupa por sección para render
        const grouped = {};
        items.forEach((it, i) => {
            if (!grouped[it.section]) grouped[it.section] = [];
            grouped[it.section].push({ ...it, idx: i });
        });

        host.innerHTML = `
            <div class="palette-backdrop" data-close></div>
            <div class="palette" role="dialog" aria-label="Command palette">
                <div class="palette-input">
                    <span class="palette-icon">🔍</span>
                    <input type="text" id="palette-search" placeholder="Buscar acción, producto, SKU…" value="${escape(query)}" autocomplete="off">
                    <span class="pill"><kbd>Esc</kbd></span>
                </div>
                <div class="palette-list" id="palette-list">
                    ${items.length ? Object.entries(grouped).map(([section, list]) => `
                        <div class="palette-section">
                            <div class="palette-section-title">${section}</div>
                            ${list.map(it => `
                                <div class="palette-item ${it.idx === selectedIdx ? 'active' : ''}" data-idx="${it.idx}">
                                    <span class="palette-item-icon">${it.icon}</span>
                                    <div class="palette-item-body">
                                        <div class="palette-item-title">${escape(it.title)}</div>
                                        ${it.sub ? `<div class="palette-item-sub">${escape(it.sub)}</div>` : ''}
                                    </div>
                                    <span class="palette-item-hint">↵</span>
                                </div>
                            `).join('')}
                        </div>
                    `).join('') : `
                        <div class="palette-empty">Sin resultados para "<strong>${escape(query)}</strong>"</div>
                    `}
                </div>
                <div class="palette-foot">
                    <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
                    <span><kbd>↵</kbd> ejecutar</span>
                    <span><kbd>Esc</kbd> cerrar</span>
                </div>
            </div>
        `;

        const input = host.querySelector('#palette-search');
        input.addEventListener('input', e => {
            query = e.target.value;
            selectedIdx = 0;
            render(App);
            host.querySelector('#palette-search').focus();
        });
        host.querySelectorAll('.palette-item').forEach(el => {
            el.addEventListener('mouseenter', () => {
                selectedIdx = parseInt(el.dataset.idx, 10);
                updateActive();
            });
            el.addEventListener('click', () => execute(App));
        });
        host.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));

        setTimeout(() => input.focus(), 30);
    }

    function updateActive() {
        document.querySelectorAll('.palette-item').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.idx, 10) === selectedIdx);
        });
        const active = document.querySelector('.palette-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function execute(App) {
        const item = items[selectedIdx];
        if (!item) return;
        close();
        setTimeout(() => item.run(), 40);
    }

    function openPalette(App) {
        open = true;
        query = '';
        selectedIdx = 0;
        render(App);
    }

    function close() {
        open = false;
        const host = document.getElementById('palette-host');
        if (host) host.innerHTML = '';
    }

    function handleKey(e, App) {
        const isModK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
        if (isModK) {
            e.preventDefault();
            if (open) close(); else openPalette(App);
            return;
        }
        if (!open) return;

        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIdx = Math.min(items.length - 1, selectedIdx + 1);
            updateActive();
        }
        else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIdx = Math.max(0, selectedIdx - 1);
            updateActive();
        }
        else if (e.key === 'Enter') {
            if (document.activeElement && document.activeElement.id === 'palette-search') {
                e.preventDefault();
                execute(App);
            }
        }
    }

    function init(App) {
        document.addEventListener('keydown', e => handleKey(e, App));
    }

    function escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, ch => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[ch]));
    }

    return { init, open: openPalette, close };
})();
