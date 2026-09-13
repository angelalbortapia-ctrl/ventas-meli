/* ==========================================================================
   Bootstrap + orquestación:
     - navegación sidebar (dashboard, productos, caja, ajustes)
     - marketplace Meli / Amazon / General
     - importar/exportar Excel (con wizard)
     - respaldo JSON (con dialog propio)
     - command palette (⌘K)
     - PWA: desregistrar Service Worker (Safari Sync)
     - sincronización de topbar (breadcrumb + fecha)
   ========================================================================== */

const App = (() => {

    const TAB_LABELS = {
        dashboard: 'Inicio',
        lotes: 'Productos',
        envios: 'Inicio', // alias legacy → Inicio (pestaña retirada)
        wishlist: 'Ofertas', // alias legacy → Ofertas/Guardados
        ofertas: 'Ofertas',
        keepa: 'Keepa',
        caja: 'Caja',
        insights: 'Inicio', // alias legacy → Inicio (pestaña retirada)
        settings: 'Ajustes',
    };

    let pageTxBusy = false;
    let pageTxToken = 0;

    function prefersReducedMotion() {
        return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    }

    function isIOSSafari() {
        const ua = String(navigator.userAgent || '');
        const iOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return iOS;
    }

    /** Transición preciosa entre canal o vista (View Transitions API + fallback). */
    function runPageTransition(kind, mutate) {
        const body = document.body;
        const root = document.documentElement;
        const token = ++pageTxToken;
        const guarded = () => {
            if (token !== pageTxToken) return;
            mutate();
        };

        // iOS Safari: View Transitions / fade a veces deja la UI borrosa o en blanco.
        if (prefersReducedMotion() || isIOSSafari()) {
            guarded();
            body.classList.remove('is-page-exit', 'is-page-enter', 'is-mp-sky-shift');
            delete body.dataset.pageTransition;
            delete root.dataset.pageTransition;
            return Promise.resolve();
        }

        // Si ya hay animación, gana la última navegación (la pendiente queda invalidada).
        if (pageTxBusy) {
            guarded();
            delete body.dataset.pageTransition;
            delete root.dataset.pageTransition;
            body.classList.remove('is-page-exit', 'is-page-enter', 'is-mp-sky-shift');
            return Promise.resolve();
        }

        pageTxBusy = true;
        body.dataset.pageTransition = kind;
        root.dataset.pageTransition = kind;

        const finish = () => {
            // Siempre libera el lock; si hubo supersede, no toca clases de otra transición.
            pageTxBusy = false;
            if (token !== pageTxToken) return;
            delete body.dataset.pageTransition;
            delete root.dataset.pageTransition;
            body.classList.remove('is-page-exit', 'is-page-enter', 'is-mp-sky-shift');
        };

        if (typeof document.startViewTransition === 'function') {
            try {
                const tx = document.startViewTransition(() => { guarded(); });
                const timeout = new Promise(resolve => window.setTimeout(resolve, 900));
                return Promise.race([tx.finished.catch(() => {}), timeout]).then(finish, finish);
            } catch (_) {
                guarded();
                finish();
                return Promise.resolve();
            }
        }

        body.classList.add('is-page-exit');
        if (kind === 'channel') body.classList.add('is-mp-sky-shift');
        return new Promise((resolve) => {
            window.setTimeout(() => {
                guarded();
                if (token !== pageTxToken) {
                    resolve();
                    return;
                }
                body.classList.remove('is-page-exit');
                body.classList.add('is-page-enter');
                window.setTimeout(() => {
                    finish();
                    resolve();
                }, 560);
            }, 210);
        });
    }

    function switchTab(tab) {
        if (!TAB_LABELS[tab]) return;

        const apply = () => {
            // Wishlist unificada dentro de Ofertas → Guardados
            if (tab === 'wishlist') {
                tab = 'ofertas';
                window.__ofertasOpenGuardados = true;
            }
            // Insights retirado: alias a Inicio
            if (tab === 'insights') tab = 'dashboard';
            // Envíos retirado: alias a Inicio
            if (tab === 'envios') tab = 'dashboard';
            if (['wishlist', 'ofertas', 'keepa'].includes(tab) && window.State.marketplace !== 'amazon') {
                applyMarketplaceView('amazon', { toast: false, animate: false });
                if (window.State.marketplace !== 'amazon') {
                    tab = 'lotes';
                }
            }
            if (['lotes', 'wishlist', 'ofertas', 'keepa'].includes(tab)
                && window.State.ui?.mpView === 'general') {
                const real = Data.normalizeMarketplace(window.State.marketplace);
                window.State.ui = { ...window.State.ui, mpView: real };
                window.State.saveUI();
                refreshMarketplaceChrome();
                const label = real === 'amazon' ? 'Amazon' : 'Mercado Libre';
                UI.toast(`Catálogo ${label} (Hoy es el resumen)`);
            }
            const view = document.getElementById('view-' + tab);
            if (!view) return;
            window.State.view = tab;
            document.body.dataset.appView = tab;
            document.querySelectorAll('.sb-item[data-tab]').forEach(el => {
                const active = el.dataset.tab === tab;
                el.classList.toggle('active', active);
                el.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            document.querySelectorAll('.mobile-tab[data-tab]').forEach(el => {
                el.classList.toggle('active', el.dataset.tab === tab);
            });
            document.querySelectorAll('.view').forEach(v => { v.hidden = true; });
            view.hidden = false;

            const crumb = document.getElementById('tb-current');
            if (crumb) crumb.textContent = TAB_LABELS[tab];

            UI.clearCountFx?.(view);

            if (tab === 'dashboard') DashboardView.render();
            else if (tab === 'lotes') LotesView.render();
            else if (tab === 'ofertas') {
                OfertasView.render();
                if (window.__ofertasOpenGuardados) {
                    window.__ofertasOpenGuardados = false;
                    OfertasView.showGuardados?.();
                }
            }
            else if (tab === 'keepa') KeepaView.render();
            else if (tab === 'caja') CajaView.render();
            else if (tab === 'settings') SettingsView.loadIntoForm();
            refreshNavCounts();
            refreshFAB();
        };

        const same = window.State.view === tab
            && !document.getElementById('view-' + tab)?.hidden;
        if (same) {
            apply();
            return;
        }
        runPageTransition('tab', apply);
    }

    function closeMobileNav() {
        document.body.classList.remove('nav-open');
        const menu = document.getElementById('tb-menu');
        if (menu) menu.setAttribute('aria-expanded', 'false');
        const overlay = document.getElementById('nav-overlay');
        if (overlay) overlay.hidden = true;
    }

    function openMobileNav() {
        document.body.classList.add('nav-open');
        const menu = document.getElementById('tb-menu');
        if (menu) menu.setAttribute('aria-expanded', 'true');
        const overlay = document.getElementById('nav-overlay');
        if (overlay) overlay.hidden = false;
    }

    function initSidebar() {
        document.querySelectorAll('.sb-item[data-tab]').forEach(el => {
            el.addEventListener('click', () => {
                switchTab(el.dataset.tab);
                closeMobileNav();
            });
        });
        ['btn-import', 'btn-export', 'btn-backup'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => closeMobileNav());
        });
    }

    function initTopbar() {
        const date = document.getElementById('tb-date');
        if (date) {
            const now = new Date();
            const fmt = new Intl.DateTimeFormat('es-MX', {
                weekday: 'short', day: '2-digit', month: 'short'
            });
            date.textContent = fmt.format(now);
        }
        // Alertas ops (toasts / Notification API) — sin pestaña Insights
        refreshNavCounts();
        window.State.subscribe(refreshNavCounts);

        const menu = document.getElementById('tb-menu');
        const overlay = document.getElementById('nav-overlay');
        if (menu) {
            menu.addEventListener('click', () => {
                if (document.body.classList.contains('nav-open')) closeMobileNav();
                else openMobileNav();
            });
        }
        if (overlay) overlay.addEventListener('click', closeMobileNav);

        // Bottom tab bar (iPhone)
        document.querySelectorAll('.mobile-tab[data-tab]').forEach(el => {
            el.addEventListener('click', () => {
                switchTab(el.dataset.tab);
                closeMobileNav();
            });
        });
        document.getElementById('m-tab-more')?.addEventListener('click', () => openMoreSheet());
        initSyncPill();
    }

    /**
     * Pill de estado en el topbar: red offline, sync error/syncing/ok.
     * Se oculta cuando todo está tranquilo (idle sin cuenta o silent OK).
     */
    function initSyncPill() {
        const pill = document.getElementById('tb-sync-pill');
        if (!pill) return;
        const label = pill.querySelector('.tb-sync-label');
        let okHideTimer = 0;
        let prevState = window.Sync?.getStatus?.()?.state || 'off';

        function paint() {
            const online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
            const st = window.Sync?.getStatus?.() || { state: 'off' };
            const nextState = st.state || 'off';
            pill.classList.remove('is-offline', 'is-error', 'is-syncing', 'is-ok', 'is-idle');
            if (!online) {
                pill.hidden = false;
                pill.classList.add('is-offline');
                label.textContent = 'Sin conexión';
                pill.title = 'Estás offline. Tus cambios se guardan localmente y suben al reconectar.';
                clearTimeout(okHideTimer);
                prevState = nextState;
                return;
            }
            if (st.state === 'syncing') {
                pill.hidden = false;
                pill.classList.add('is-syncing');
                label.textContent = 'Sincronizando…';
                pill.title = 'Subiendo cambios a Supabase.';
                clearTimeout(okHideTimer);
                prevState = nextState;
                return;
            }
            if (st.state === 'error') {
                pill.hidden = false;
                pill.classList.add('is-error');
                label.textContent = 'Sync error';
                pill.title = st.detail || 'Falla de sincronización. Click para abrir Ajustes.';
                clearTimeout(okHideTimer);
                prevState = nextState;
                return;
            }
            if (st.state === 'synced') {
                pill.hidden = false;
                pill.classList.add('is-ok');
                label.textContent = 'Sync OK';
                pill.title = st.email ? `Sincronizado · ${st.email}` : 'Sincronizado.';
                if (prevState === 'syncing') {
                    UI.pulseRainbow?.();
                }
                clearTimeout(okHideTimer);
                okHideTimer = setTimeout(() => { pill.hidden = true; }, 3000);
                prevState = nextState;
                return;
            }
            // Estados "sin cuenta / esperando login": ocultamos para no ensuciar.
            pill.hidden = true;
            prevState = nextState;
        }

        pill.addEventListener('click', () => {
            switchTab('settings');
            const sync = document.getElementById('view-settings')
                ?.querySelector('.sync-card, #sync-status, #sync-url');
            sync?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        });
        window.addEventListener('online', paint);
        window.addEventListener('offline', paint);
        window.Sync?.onStatus?.(paint);
        paint();
    }

    /**
     * Bottom-sheet "Más": tabs restantes + acciones de Datos.
     * Se construye dinámicamente con badges y respetando el marketplace activo.
     */
    function openMoreSheet() {
        const isAmazon = window.State.marketplace === 'amazon';

        const items = [];
        if (isAmazon) {
            items.push({ id: 'ofertas', icon: 'ofertas', label: 'Ofertas',
                hint: 'Radar + Guardados · → Producto',
                badge: window.OfertasView?.pendingCount?.() || null });
            items.push({ id: 'keepa', icon: 'keepa', label: 'Keepa',
                hint: 'Checar ASIN + alertas catálogo' });
        }
        items.push({ id: 'settings', icon: 'settings', label: 'Ajustes',
            hint: 'Sync, comisiones, umbrales' });
        // Datos (import/export/backup) — atajos rápidos
        items.push({ id: 'import', icon: 'import', label: 'Importar Excel',
            hint: 'XLSX de lotes', tone: 'mute' });
        items.push({ id: 'export', icon: 'export', label: 'Exportar Excel',
            hint: 'Descarga snapshot', tone: 'mute' });
        items.push({ id: 'backup', icon: 'backup', label: 'Respaldo JSON',
            hint: 'Exportar / importar copia' });


        UI.bottomSheet({
            title: 'Más opciones',
            items,
            onPick: id => {
                if (['dashboard', 'lotes', 'ofertas', 'keepa', 'caja', 'settings'].includes(id)) {
                    switchTab(id);
                    return;
                }
                if (id === 'wishlist') {
                    window.__ofertasOpenGuardados = true;
                    switchTab('ofertas');
                    return;
                }
                if (id === 'import') document.getElementById('file-import')?.click();
                else if (id === 'export') exportExcel();
                else if (id === 'backup') openBackup();
            },
        });
    }

    /** Badges sidebar + móvil + campana (productos y alertas). */
    function refreshNavCounts() {
        const lotes = window.State.lotes || [];
        const nProd = new Set(lotes.map(l => l.productId || l.id)).size;

        const sbLotes = document.getElementById('sb-count-lotes');
        if (sbLotes) sbLotes.textContent = nProd;
        const mLotes = document.getElementById('m-tab-lotes');
        if (mLotes) {
            mLotes.textContent = nProd;
            mLotes.hidden = nProd === 0;
        }

        const pendingOfertas = window.OfertasView?.pendingCount?.() || 0;
        const sbOfertas = document.getElementById('sb-count-ofertas');
        if (sbOfertas) {
            sbOfertas.textContent = pendingOfertas;
            sbOfertas.hidden = pendingOfertas === 0;
        }
        const mOfertas = document.getElementById('m-tab-ofertas');
        if (mOfertas) {
            mOfertas.textContent = pendingOfertas;
            mOfertas.hidden = pendingOfertas === 0;
        }

        const pendingCaja = window.CajaView?.pendingCount?.() || 0;
        const sbCaja = document.getElementById('sb-count-caja');
        if (sbCaja) {
            sbCaja.textContent = pendingCaja;
            sbCaja.hidden = pendingCaja === 0;
            sbCaja.classList.toggle('badge-alert', pendingCaja > 0);
        }
        const mCaja = document.getElementById('m-tab-caja');
        if (mCaja) {
            mCaja.textContent = pendingCaja;
            mCaja.hidden = pendingCaja === 0;
        }

        const moreBadge = document.getElementById('m-tab-more-badge');
        if (moreBadge) {
            moreBadge.textContent = '0';
            moreBadge.hidden = true;
        }
    }

    // ---- Excel ---------------------------------------------------------
    function initExcel() {
        document.getElementById('btn-import')?.addEventListener('click', () => {
            document.getElementById('file-import')?.click();
        });
        document.getElementById('file-import')?.addEventListener('change', async e => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const imported = await ExcelIO.importFile(file);
                const lotes = Array.isArray(imported) ? imported : (imported.lotes || []);
                const ventasCount = imported.ventasCount || 0;
                if (!lotes.length) {
                    UI.toast('El Excel no contiene lotes válidos', 'error');
                    return;
                }
                const choice = await UI.importWizard({
                    count: lotes.length,
                    sample: lotes,
                });
                if (!choice) return;
                if (choice === 'replace') {
                    const ok = await UI.confirm({
                        title: 'Reemplazar todo',
                        message: 'Se borrarán los lotes actuales (incluidas ventas e historial). Se recomienda <strong>exportar un respaldo JSON</strong> antes. ¿Continuar?',
                        primaryLabel: 'Reemplazar',
                        danger: true,
                    });
                    if (!ok) return;
                    window.State.lotes = lotes.map(l => Data.normalize(l, []));
                    window.State.save();
                    markBackupNeeded();
                    UI.toast(`Reemplazado: ${lotes.length} lote(s)${ventasCount ? ` · ${ventasCount} venta(s)` : ''}`);
                } else if (choice === 'merge' || choice === 'merge-full') {
                    const mode = choice === 'merge-full' ? 'full' : 'catalog';
                    const { lotes: merged, updated, added } = Data.mergeBySku(window.State.lotes, lotes, { mode });
                    window.State.lotes = Data.attachVentasBySku(merged, lotes.flatMap(l =>
                        (l.ventas || []).map(v => ({ ...v, sku: l.sku }))
                    ));
                    window.State.save();
                    markBackupNeeded();
                    UI.toast(`Merge (${mode === 'catalog' ? 'catálogo' : 'completo'}): ${updated} act. · ${added} nuevos${ventasCount ? ` · ${ventasCount} ventas` : ''}`);
                }
            } catch (err) {
                console.error(err);
                UI.toast('Error al importar: ' + err.message, 'error');
            } finally {
                e.target.value = '';
            }
        });

        document.getElementById('btn-export')?.addEventListener('click', () => exportExcel());
    }

    function exportExcel() {
        const stamp = new Date().toISOString().slice(0, 10);
        ExcelIO.exportFile(window.State.lotes, window.State.settings, `Negocio_${stamp}.xlsx`);
        UI.toast('Excel exportado');
    }

    /** Solo con Sync activo (push/pull), no basta con “signed_in”. */
    function cloudBackupActive() {
        const st = window.Sync?.getStatus?.()?.state;
        return st === 'synced' || st === 'syncing';
    }

    function markBackupNeeded() {
        if (cloudBackupActive()) {
            // La nube recibe el push; no marcar dirty ni molestar
            refreshBackupHint();
            return;
        }
        window.State.ui = { ...window.State.ui, backupDirty: true };
        // Persistir el flag sin reentrar al wrapper de saveUI.
        const prevBackupSkip = window.__skipBackupDirty;
        const prevSyncSkip = window.__skipSync;
        window.__skipBackupDirty = true;
        window.__skipSync = true;
        try {
            window.State.saveUI();
        } finally {
            window.__skipBackupDirty = prevBackupSkip;
            window.__skipSync = prevSyncSkip;
        }
        refreshBackupHint();
    }

    function markBackupDone() {
        window.State.ui = {
            ...window.State.ui,
            backupDirty: false,
            lastBackupAt: new Date().toISOString(),
        };
        // Este guardado solo actualiza metadatos del respaldo; no debe disparar
        // otro auto-respaldo ni otro push de Sync.
        const prevBackupSkip = window.__skipBackupDirty;
        const prevSyncSkip = window.__skipSync;
        window.__skipBackupDirty = true;
        window.__skipSync = true;
        try {
            window.State.saveUI();
        } finally {
            window.__skipBackupDirty = prevBackupSkip;
            window.__skipSync = prevSyncSkip;
        }
        refreshBackupHint();
    }

    function refreshBackupHint() {
        const foot = document.querySelector('.sb-foot span:last-child');
        if (!foot) return;
        // Si Supabase está activo, Sync pinta el footer
        const syncSt = window.Sync?.getStatus?.()?.state;
        if (syncSt && syncSt !== 'off') return;
        const ui = window.State.ui || {};
        const last = ui.lastBackupAt ? new Date(ui.lastBackupAt) : null;
        const days = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
        const stale = !last || days >= 7 || ui.backupDirty;
        if (stale) {
            foot.textContent = ui.backupDirty
                ? '⚠️ Hay cambios sin respaldar'
                : (last ? `⚠️ Último respaldo hace ${days}d` : '⚠️ Sin respaldo aún');
            foot.style.color = 'var(--warn-text)';
        } else {
            foot.textContent = `Respaldo OK · hace ${days}d`;
            foot.style.color = '';
        }
    }

    async function maybeRemindBackup() {
        await new Promise(r => setTimeout(r, 400));
        if (cloudBackupActive()) {
            if (window.State.ui?.backupDirty) markBackupDone();
            return;
        }
        // No bloquear la UI con un modal a pantalla completa
        if (sessionStorage.getItem('vm-backup-nag') === '1') return;
        const ui = window.State.ui || {};
        const last = ui.lastBackupAt ? new Date(ui.lastBackupAt) : null;
        const days = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : 999;
        if (!(ui.backupDirty || days >= 7)) return;
        sessionStorage.setItem('vm-backup-nag', '1');
        const msg = ui.backupDirty
            ? 'Hay cambios sin respaldo JSON. Usa Más → Respaldo o ⌘K.'
            : (last
                ? `Llevas ${days}d sin respaldo. Usa Más → Respaldo o ⌘K.`
                : 'Aún no hay respaldo JSON. Usa Más → Respaldo o ⌘K.');
        UI.toast?.(msg, 'info', 4200);
    }

    // ---- Backup --------------------------------------------------------
    function initBackup() {
        document.getElementById('btn-backup')?.addEventListener('click', openBackup);
        document.getElementById('file-backup')?.addEventListener('change', async e => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!data || (!Array.isArray(data.lotes) && !data.stores)) throw new Error('Formato inválido');
                const nMeli = data.stores?.meli?.lotes?.length ?? (data.marketplace !== 'amazon' ? (data.lotes?.length || 0) : 0);
                const nAmz = data.stores?.amazon?.lotes?.length ?? (data.marketplace === 'amazon' ? (data.lotes?.length || 0) : 0);
                const ok = await UI.confirm({
                    title: 'Restaurar respaldo',
                    message: `Se restaurará el respaldo (Meli: <strong>${nMeli}</strong> · Amazon: <strong>${nAmz}</strong>) y reemplazará los datos locales. ¿Continuar?`,
                    primaryLabel: 'Restaurar',
                    danger: true,
                });
                if (!ok) return;
                if (data.stores?.meli || data.stores?.amazon) {
                    // Solo pisa el catálogo si el respaldo trae productos;
                    // un slice vacío no borra un catálogo local con datos (misma regla que Sync).
                    const restoreStore = (mp, slice) => {
                        if (!slice || typeof slice !== 'object') return;
                        const incoming = Array.isArray(slice.lotes) ? slice.lotes : [];
                        const localN = (Data.peekLotes?.(mp) || Data.loadLotes(mp) || []).length;
                        if (incoming.length === 0 && localN > 0) return;
                        Data.saveLotes(incoming.map(l => Data.normalize(l, [], mp)), mp);
                        Data.saveSettings({
                            ...Calc.defaultsFor(mp),
                            ...(slice.settings || {}),
                            marketplace: mp,
                        }, mp);
                    };
                    if (data.stores.meli) restoreStore('meli', data.stores.meli);
                    if (data.stores.amazon) restoreStore('amazon', data.stores.amazon);
                    const mp = data.marketplace === 'amazon' ? 'amazon' : 'meli';
                    window.State.marketplace = mp;
                    const uiFromBackup = (data.ui && typeof data.ui === 'object') ? { ...data.ui } : {};
                    delete uiFromBackup.keepaApiKey;
                    delete uiFromBackup.keepaCache;
                    delete uiFromBackup.keepaLibrary;
                    window.State.ui = {
                        ...window.State.ui,
                        ...uiFromBackup,
                        marketplace: mp,
                        mpView: uiFromBackup.mpView === 'general' ? 'general' : mp,
                    };
                    window.State.saveUI();
                    window.State.lotes = Data.loadLotes(mp);
                    window.State.settings = Data.loadSettings(mp);
                } else {
                    const legacyMp = data.marketplace === 'amazon'
                        || data.settings?.marketplace === 'amazon'
                        ? 'amazon'
                        : (window.State.marketplace === 'amazon' ? 'amazon' : 'meli');
                    if (legacyMp !== window.State.marketplace) {
                        window.State.switchMarketplace(legacyMp);
                    }
                    window.State.lotes = data.lotes.map(l => Data.normalize(l, [], legacyMp));
                    if (data.settings) {
                        window.State.settings = {
                            ...Calc.defaultsFor(legacyMp),
                            ...data.settings,
                            marketplace: legacyMp,
                        };
                        window.State.saveSettings();
                    }
                    if (data.ui && typeof data.ui === 'object') {
                        const legacyUI = { ...data.ui };
                        delete legacyUI.keepaApiKey;
                        delete legacyUI.keepaCache;
                        delete legacyUI.keepaLibrary;
                        window.State.ui = { ...window.State.ui, ...legacyUI, marketplace: legacyMp };
                        window.State.saveUI();
                    }
                    window.State.save();
                }
                refreshMarketplaceChrome();
                SettingsView.loadIntoForm();
                markBackupDone();
                UI.toast('Respaldo restaurado');
                window.State.notify();
                // Refresca la vista abierta
                if (window.State.view === 'ofertas') OfertasView?.render?.();
                else if (window.State.view === 'keepa') KeepaView?.render?.();
                else if (window.State.view === 'caja') CajaView?.render?.();
                else if (window.State.view === 'dashboard') DashboardView?.render?.();
                else if (window.State.view === 'lotes') LotesView?.render?.();
                refreshNavCounts();
            } catch (err) {
                UI.toast('Error: ' + err.message, 'error');
            } finally {
                e.target.value = '';
            }
        });
    }

    async function openBackup() {
        const choice = await UI.backupChoice();
        if (choice === 'export') exportJSON();
        else if (choice === 'import') document.getElementById('file-backup').click();
    }

    function buildBackupPayload() {
        const active = Data.normalizeMarketplace(window.State.marketplace);
        Data.saveLotes(window.State.lotes, active);
        Data.saveSettings(window.State.settings, active);
        const meliLotes = active === 'meli' ? window.State.lotes : Data.loadLotes('meli');
        const amzLotes = active === 'amazon' ? window.State.lotes : Data.loadLotes('amazon');
        const backupUI = { ...(window.State.ui || {}) };
        // Credencial y caché efímero de Keepa nunca salen en respaldos exportables.
        delete backupUI.keepaApiKey;
        delete backupUI.keepaCache;
        delete backupUI.keepaLibrary;
        delete backupUI.serpApiKey;
        return {
            version: 5,
            exportedAt: new Date().toISOString(),
            marketplace: active,
            lotes: window.State.lotes,
            settings: window.State.settings,
            ui: {
                ...backupUI,
                // Asegura wishlist + ofertas + bolsitas en el JSON
                wishlistAmazon: window.State.ui?.wishlistAmazon || [],
                ofertasRetail: window.State.ui?.ofertasRetail || [],
                ofertasSerpWatches: window.State.ui?.ofertasSerpWatches || [],
                capitalAlloc: window.State.ui?.capitalAlloc || {},
            },
            stores: {
                meli: {
                    lotes: meliLotes,
                    settings: active === 'meli' ? window.State.settings : Data.loadSettings('meli'),
                },
                amazon: {
                    lotes: amzLotes,
                    settings: active === 'amazon' ? window.State.settings : Data.loadSettings('amazon'),
                },
            },
            _counts: { meli: (meliLotes || []).length, amazon: (amzLotes || []).length },
        };
    }

    function scrubKeepaFromStoredBackup() {
        try {
            const raw = localStorage.getItem('vm.autoBackup');
            if (!raw) return;
            const stored = JSON.parse(raw);
            const ui = stored?.data?.ui;
            if (!ui || typeof ui !== 'object') return;
            if (!('keepaApiKey' in ui) && !('keepaCache' in ui) && !('keepaLibrary' in ui) && !('serpApiKey' in ui)) return;
            delete ui.keepaApiKey;
            delete ui.keepaCache;
            delete ui.keepaLibrary;
            delete ui.serpApiKey;
            localStorage.setItem('vm.autoBackup', JSON.stringify(stored));
        } catch (err) {
            console.warn('[backup] no se pudo sanear secrets', err);
        }
    }

    function downloadBackupBlob(data, { silent = false } = {}) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = (data.exportedAt || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
        a.download = `ventas-backup_${stamp}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 100);
        markBackupDone();
        const nAmz = data._counts?.amazon ?? (data.stores?.amazon?.lotes || []).length;
        UI.toast(silent ? `Amazon ${nAmz} SKUs` : `Respaldo JSON · Amazon ${nAmz} SKUs`);
        return { nAmz, nMeli: data._counts?.meli ?? 0 };
    }

    function exportJSON({ silent = false } = {}) {
        return downloadBackupBlob(buildBackupPayload(), { silent });
    }

    /** Auto-respaldo local (JSON + timestamp) sin spamear descargas. */
    let lastAmzToastAt = 0;
    let lastAmzToastN = null;
    function persistAutoBackupLocal() {
        const data = buildBackupPayload();
        const stamp = data.exportedAt;
        const nAmz = data._counts.amazon;
        try {
            localStorage.setItem('vm.autoBackup', JSON.stringify({ at: stamp, data }));
            const metaRaw = localStorage.getItem('vm.autoBackupMeta');
            const meta = metaRaw ? JSON.parse(metaRaw) : [];
            const next = [{ at: stamp, nAmz, nMeli: data._counts.meli }, ...(Array.isArray(meta) ? meta : [])].slice(0, 8);
            localStorage.setItem('vm.autoBackupMeta', JSON.stringify(next));
            markBackupDone();
            const now = Date.now();
            if (nAmz !== lastAmzToastN || now - lastAmzToastAt > 12000) {
                lastAmzToastAt = now;
                lastAmzToastN = nAmz;
                UI.toast(`Amazon ${nAmz} SKUs`);
            }
        } catch (err) {
            console.warn('[auto-backup] quota → descarga', err);
            downloadBackupBlob(data, { silent: true });
        }
    }

    let autoBackupTimer = null;
    function scheduleAutoBackup() {
        if (cloudBackupActive()) return;
        clearTimeout(autoBackupTimer);
        autoBackupTimer = setTimeout(() => {
            try {
                window.__skipBackupDirty = true;
                persistAutoBackupLocal();
            } catch (err) {
                console.warn('[auto-backup]', err);
            } finally {
                window.__skipBackupDirty = false;
            }
        }, 1800);
    }

    // ---- Ops alerts (PWA Notification + toast) --------------------------
    function collectOpsAlerts() {
        const out = [];
        const both = typeof Data.loadBothCatalogs === 'function'
            ? Data.loadBothCatalogs()
            : {
                meli: { lotes: Data.loadLotes('meli'), settings: Data.loadSettings('meli') },
                amazon: { lotes: Data.loadLotes('amazon'), settings: Data.loadSettings('amazon') },
            };
        [['meli', both.meli], ['amazon', both.amazon]].forEach(([mp, pack]) => {
            const agg = Calc.aggregate(pack.lotes || [], pack.settings || {});
            (agg.rows || []).forEach(({ lote, calc }) => {
                const name = lote.producto || lote.sku || 'SKU';
                const tag = mp === 'amazon' ? 'Amz' : 'Meli';
                if (calc.estrategia === 'AGOTADO' || (calc.inventarioRestante === 0 && (calc.vendidas || 0) > 0)) {
                    out.push({
                        id: `stockout:${mp}:${lote.id}`,
                        kind: 'stockout',
                        title: `Stockout · ${name}`,
                        body: `${tag}: sin piezas. Revisa recompra.`,
                    });
                }
                const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
                if (calc.inventarioRestante > 0 && ventas.length === 0) {
                    const dias = Calc.daysSinceActivity(lote);
                    if (dias != null && dias >= 30) {
                        out.push({
                            id: `stagnant:${mp}:${lote.id}`,
                            kind: 'stagnant',
                            title: `Estancado 30d · ${name}`,
                            body: `${tag}: ${dias}d sin ventas · ${Calc.fmtMXN(calc.valorInventario)} atrapados.`,
                        });
                    }
                }
                if (calc.adsStatus === 'over') {
                    out.push({
                        id: `ads:${mp}:${lote.id}`,
                        kind: 'ads',
                        title: `Ads > tope CPA · ${name}`,
                        body: `${tag}: ${Calc.fmtMXN(calc.adsPorVenta)}/venta vs tope ${Calc.fmtMXN(calc.topeCPA)}.`,
                    });
                }
            });
        });
        return out;
    }

    function notifiedTodayKey(id) {
        const day = new Date().toISOString().slice(0, 10);
        return `vm-alert:${day}:${id}`;
    }

    async function maybeNotifyOpsAlerts({ forceToast = false } = {}) {
        const alerts = collectOpsAlerts().slice(0, 8);
        if (!alerts.length) return;

        let perm = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
        if (perm === 'default' && forceToast === false) {
            // No pedir permiso automáticamente; el usuario puede activarlo con la campana
            perm = 'denied';
        }

        const fresh = alerts.filter(a => !sessionStorage.getItem(notifiedTodayKey(a.id)));
        if (!fresh.length) return;

        const show = fresh.slice(0, 3);
        for (const a of show) {
            sessionStorage.setItem(notifiedTodayKey(a.id), '1');
            if (perm === 'granted') {
                try {
                    // No await serviceWorker.ready: sin SW nunca resuelve.
                    const reg = await navigator.serviceWorker?.getRegistration?.();
                    if (reg?.showNotification) {
                        await reg.showNotification(a.title, {
                            body: a.body,
                            tag: a.id,
                        });
                        continue;
                    }
                    new Notification(a.title, { body: a.body, tag: a.id });
                    continue;
                } catch { /* fallback toast */ }
            }
            UI.toast?.(`${a.title} — ${a.body}`, a.kind === 'ads' ? 'error' : 'info', 5000);
        }
    }

    async function requestOpsNotifyPermission() {
        if (typeof Notification === 'undefined') {
            UI.toast?.('Este navegador no soporta notificaciones', 'error');
            return false;
        }
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
            UI.toast?.('Alertas activadas · stockout, estancado 30d, Ads>CPA');
            await maybeNotifyOpsAlerts({ forceToast: false });
            return true;
        }
        UI.toast?.('Permiso denegado · se usarán toasts', 'info');
        return false;
    }

    // ---- Settings ------------------------------------------------------
    async function resetSettings() {
        const ok = await UI.confirm({
            title: 'Restaurar ajustes',
            message: 'Todos los parámetros volverán a sus valores por defecto.',
            primaryLabel: 'Restaurar',
        });
        if (!ok) return;
        window.State.settings = Calc.defaultsFor(window.State.marketplace);
        window.State.saveSettings();
        SettingsView.loadIntoForm();
        UI.toast('Ajustes restaurados');
    }

    // ---- FAB contextual -----------------------------------------------
    // Cada vista define su acción primaria; el resto oculta el botón.
    // Ninguna acción es destructiva; todas abren editores/formularios.
    // Productos usa el CTA del header (#lotes-new); no FAB ahí.
    const FAB_CONFIG = {
        ofertas: {
            label: 'Añadir',
            title: 'Añadir oferta',
            aria: 'Añadir oferta retail',
            action: () => {
                const view = document.getElementById('view-ofertas');
                view?.scrollTo?.({ top: 0, behavior: 'smooth' });
                document.getElementById('of-link-tienda')?.focus();
            },
        },
    };

    function refreshFAB() {
        const fab = document.getElementById('fab-new');
        if (!fab) return;
        const cfg = FAB_CONFIG[window.State.view];
        if (!cfg) {
            fab.hidden = true;
            return;
        }
        fab.hidden = false;
        fab.setAttribute('aria-label', cfg.aria);
        fab.setAttribute('title', cfg.title);
        const label = fab.querySelector('.fab-label');
        if (label) label.textContent = cfg.label;
        fab.dataset.fabView = window.State.view;
    }

    function initFAB() {
        const fab = document.getElementById('fab-new');
        if (!fab) return;
        fab.addEventListener('click', () => {
            const view = fab.dataset.fabView || window.State.view;
            FAB_CONFIG[view]?.action?.();
        });
        refreshFAB();
    }

    // ---- PWA -----------------------------------------------------------
    /** Quita SW/cachés viejos YA (antes de Sync). No registrar uno nuevo. */
    async function killServiceWorkers() {
        if (!('serviceWorker' in navigator)) return;
        try {
            const regs = await navigator.serviceWorker.getRegistrations?.() || [];
            await Promise.all(regs.map(r => r.unregister().catch(() => {})));
        } catch (_) { /* ignore */ }
        try {
            if (window.caches?.keys) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
        } catch (_) { /* ignore */ }
    }

    function initPWA() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.addEventListener?.('message', ev => {
            if (ev.data?.type === 'vm-sw-off') killServiceWorkers();
        });
        window.addEventListener('load', () => { killServiceWorkers(); });
    }

    /**
     * Borra ventas de AMBOS marketplaces (Meli + Amazon), conserva unidades
     * (restocks intactos), purga bolsitas ligadas a esas ventas y sube a Sync.
     * Operar sobre un solo MP era un bug: el hermano conservaba ventas y el
     * bundle dual las reintroducía.
     */
    async function clearVentasRestore({ confirm = true } = {}) {
        if (confirm) {
            const ok = await UI.confirm({
                title: 'Borrar todas las ventas',
                message: 'Se eliminarán <strong>todas las ventas registradas en ambos marketplaces</strong> (Mercado Libre y Amazon). Las <strong>unidades del lote se conservan</strong>; solo se ponen vendidas en 0 y se limpian las bolsitas ligadas a esas ventas. Si Sync está activo, se subirá el cambio a Supabase.',
                primaryLabel: 'Borrar en ambos MPs',
                danger: true,
            });
            if (!ok) return false;
        }
        // Evita que realtime/pull vuelva a meter las ventas viejas
        Sync?.holdRemote?.(25000);

        const activeMp = Data.currentMarketplace();
        const both = { meli: [], amazon: [] };
        let ventasCleared = 0;

        ['meli', 'amazon'].forEach(mp => {
            const source = mp === activeMp
                ? window.State.lotes
                : Data.loadLotes(mp);
            const r = Data.clearVentasRestoreStock(source, mp);
            both[mp] = r.lotes;
            ventasCleared += r.ventasCleared || 0;
        });

        // Persistir catálogo activo vía State.save() para disparar suscriptores;
        // el hermano se guarda directo con Data.saveLotes.
        window.State.lotes = both[activeMp];
        window.State.save();
        const otherMp = activeMp === 'meli' ? 'amazon' : 'meli';
        Data.saveLotes(both[otherMp], otherMp);

        // Ventas borradas dejan liberaciones huérfanas en las bolsitas de AMBOS MPs
        try {
            window.DashboardView?.purgeOrphanSaleLiberations?.(both);
        } catch (err) {
            console.warn('[app] purge bolsitas after clear ventas', err);
        }

        try {
            if (window.Sync?.pushNow) {
                // Esperar un momento a que la sesión esté lista
                for (let i = 0; i < 10; i++) {
                    const st = Sync.getStatus?.()?.state;
                    if (st === 'synced' || st === 'signed_in' || st === 'syncing') break;
                    if (st === 'off' || st === 'ready' || st === 'error') break;
                    await new Promise(r => setTimeout(r, 200));
                }
                const st = Sync.getStatus?.()?.state;
                if (st === 'synced' || st === 'signed_in' || st === 'syncing') {
                    await Sync.pushNow({ force: true });
                }
            }
        } catch (err) {
            console.warn('[app] push after clear ventas', err);
            UI.toast('Local limpio, pero no se pudo subir a Sync: ' + (err.message || err), 'error');
            return false;
        }
        UI.toast(ventasCleared
            ? `Listo: ${ventasCleared} venta(s) borrada(s) · stock restaurado`
            : 'Stock restaurado (no había ventas)');
        if (window.State.view === 'dashboard') DashboardView.render();
        else if (window.State.view === 'lotes') LotesView.render();
        else if (window.State.view === 'ofertas') OfertasView.render();
        else if (window.State.view === 'keepa') KeepaView.render();
        else if (window.State.view === 'caja') CajaView.render();
        refreshNavCounts();
        return true;
    }

    async function maybeClearVentasFromUrl() {
        const params = new URLSearchParams(location.search);
        const inFlight = sessionStorage.getItem('vm:clearVentas') === '1';
        if (params.get('clearVentas') !== '1' && !inFlight) return;
        // Nonce firmado por reset.html: si viene sin nonce (URL pegada a mano o
        // compartida), obligamos a confirmar dentro de la app antes de tocar datos.
        const nonceQuery = params.get('nonce') || '';
        const nonceExpected = sessionStorage.getItem('vm:clearVentasNonce') || '';
        const trusted = inFlight || (nonceQuery && nonceExpected && nonceQuery === nonceExpected);
        sessionStorage.setItem('vm:clearVentas', '1');
        Sync?.holdRemote?.(30000);
        await new Promise(r => setTimeout(r, 2200));
        const ok = await clearVentasRestore({ confirm: !trusted });
        if (ok !== false) sessionStorage.removeItem('vm:clearVentasNonce');
        sessionStorage.removeItem('vm:clearVentas');
        params.delete('clearVentas');
        params.delete('scope');
        params.delete('nonce');
        params.delete('t');
        const q = params.toString();
        history.replaceState({}, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }

    function refreshMarketplaceChrome() {
        const mp = Data.normalizeMarketplace(window.State.marketplace);
        const mpView = Data.normalizeMpView(
            window.State.ui?.mpView === 'general' ? 'general' : (window.State.ui?.mpView || mp)
        );
        const meta = Data.mpMeta(mp);
        document.querySelectorAll('[data-marketplace]').forEach(el => {
            const active = el.dataset.marketplace === mpView;
            el.classList.toggle('active', active);
            el.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        const brand = document.querySelector('.sb-brand-text .name');
        if (brand) {
            brand.textContent = mpView === 'general'
                ? 'Ventas'
                : Data.mpBrand(mp);
        }
        const sub = document.querySelector('.sb-brand-text .sub');
        if (sub) {
            // Canal bajo la marca (Meli / Amazon / consolidado)
            sub.textContent = mpView === 'general'
                ? 'Ambos canales'
                : (mp === 'amazon' ? 'Amazon MX' : 'Mercado Libre MX');
        }
        const root = document.querySelector('.tb-crumb-root');
        if (root) root.textContent = mpView === 'general' ? 'General' : meta.short;
        const curr = document.getElementById('tb-current');
        if (curr && mpView === 'general') curr.textContent = 'Hoy';
        document.body.dataset.marketplace = mp;
        const prevMpView = document.body.dataset.mpView;
        document.body.dataset.mpView = mpView;
        if (prevMpView && prevMpView !== mpView) {
            document.body.classList.remove('is-mp-sky-shift');
            void document.body.offsetWidth;
            document.body.classList.add('is-mp-sky-shift');
            window.clearTimeout(window.__mpSkyShiftTimer);
            window.__mpSkyShiftTimer = window.setTimeout(
                () => document.body.classList.remove('is-mp-sky-shift'),
                1200
            );
        }

        const themeMeta = document.querySelector('meta[name="theme-color"]');
        if (themeMeta) {
            themeMeta.content = mpView === 'general' ? '#2b2f36'
                : (mpView === 'amazon' ? '#ff9900' : '#3483fa');
        }

        const isGeneral = mpView === 'general';
        document.querySelectorAll('[data-hide-on-general]').forEach(el => {
            el.hidden = isGeneral;
        });
        document.querySelectorAll('[data-show-on-general]').forEach(el => {
            el.hidden = !isGeneral;
        });
        const gxItems = document.querySelectorAll('.sb-gx-nav [data-gx-jump]');
        if (isGeneral) {
            const anyActive = [...gxItems].some(b => b.classList.contains('active'));
            if (!anyActive) {
                document.querySelector('.sb-gx-nav [data-gx-jump="gx-pulso"]')?.classList.add('active');
            }
            window.Icons?.hydrate?.(document.querySelector('.sb-general-panel'));
        } else {
            gxItems.forEach(b => b.classList.remove('active'));
        }
        // Cards/flags por catálogo activo (incluso en General: Ajustes usa el MP subyacente).
        document.querySelectorAll('[data-mp-only]').forEach(el => {
            el.hidden = el.dataset.mpOnly !== mp;
        });
        document.querySelectorAll('[data-mp-field]').forEach(el => {
            el.hidden = el.dataset.mpField !== mp;
        });
        if (!isGeneral && ['wishlist', 'ofertas', 'keepa'].includes(window.State.view) && mp !== 'amazon') {
            switchTab('lotes');
        }
        // Labels del modal
        const tipoLabel = document.querySelector('label:has(#f-tipo) > span');
        if (tipoLabel) tipoLabel.textContent = mp === 'amazon' ? 'Logística' : 'Tipo Publicación';
        const envioLabel = document.querySelector('label:has(#f-envio) > span');
        if (envioLabel) {
            envioLabel.textContent = mp === 'amazon'
                ? 'FBA override (MXN · vacío = tabla)'
                : 'Envío al cliente (MXN)';
        }
        const tipoSel = document.getElementById('f-tipo');
        if (tipoSel) {
            const cur = tipoSel.value;
            if (mp === 'amazon') {
                tipoSel.innerHTML = '<option value="FBA">FBA (Logística Amazon)</option><option value="FBM">FBM (Tú envías)</option>';
                tipoSel.value = (cur === 'FBM' || cur === 'FBA') ? cur : 'FBA';
            } else {
                tipoSel.innerHTML = '<option value="Clasica">Clásica</option><option value="Premium">Premium</option>';
                tipoSel.value = (cur === 'Premium' || cur === 'Clasica') ? cur : 'Clasica';
            }
        }
        // Selects de categorías Amazon
        const fillAmzCats = (sel, selected) => {
            if (!sel || !Calc.amzCategoryList) return;
            const cur = selected || sel.value;
            sel.innerHTML = Calc.amzCategoryList().map(c =>
                `<option value="${c.id}">${c.label}</option>`
            ).join('');
            if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
            else if (window.State.settings?.categoriaDefault) sel.value = window.State.settings.categoriaDefault;
        };
        fillAmzCats(document.getElementById('f-amz-categoria'));
        fillAmzCats(document.getElementById('set-amz-cat-default'), window.State.settings?.categoriaDefault);
    }

    function applyMarketplaceView(mp, { toast = true, animate = true } = {}) {
        if (!mp) return;
        const curView = Data.normalizeMpView(
            window.State.ui?.mpView === 'general'
                ? 'general'
                : (window.State.ui?.mpView || window.State.marketplace)
        );
        if (mp === curView) return;

        const go = () => {
            if (mp === 'general') {
                window.State.ui = { ...window.State.ui, mpView: 'general' };
                window.State.saveUI();
                refreshMarketplaceChrome();
                // Evita transición anidada: el render de dashboard ya va dentro de esta.
                const dash = document.getElementById('view-dashboard');
                window.State.view = 'dashboard';
                document.body.dataset.appView = 'dashboard';
                document.querySelectorAll('.sb-item[data-tab]').forEach(el => {
                    const active = el.dataset.tab === 'dashboard';
                    el.classList.toggle('active', active);
                    el.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                document.querySelectorAll('.mobile-tab[data-tab]').forEach(el => {
                    el.classList.toggle('active', el.dataset.tab === 'dashboard');
                });
                document.querySelectorAll('.view').forEach(v => { v.hidden = true; });
                if (dash) dash.hidden = false;
                const crumb = document.getElementById('tb-current');
                if (crumb) crumb.textContent = TAB_LABELS.dashboard;
                DashboardView.render();
                refreshNavCounts();
                refreshFAB();
                if (toast) UI.toast('Hoy · cola y prioridades');
                return;
            }

            window.State.ui = { ...window.State.ui, mpView: mp };
            window.State.saveUI();
            if (mp !== window.State.marketplace) {
                window.State.switchMarketplace(mp);
            }
            refreshMarketplaceChrome();
            SettingsView.loadIntoForm();
            ['view-lotes', 'view-ofertas', 'view-keepa', 'view-caja']
                .forEach(id => {
                    const el = document.getElementById(id);
                    if (el && el.hidden) el.innerHTML = '';
                });
            window.LotesView?.invalidate?.();
            if (window.State.view === 'dashboard') DashboardView.render();
            else if (window.State.view === 'lotes') LotesView.render();
            else if (window.State.view === 'ofertas') OfertasView.render();
            else if (window.State.view === 'keepa') KeepaView.render();
            else if (window.State.view === 'caja') CajaView.render();
            refreshNavCounts();
            if (document.body.classList.contains('nav-open')) {
                document.body.classList.remove('nav-open');
                const overlay = document.getElementById('nav-overlay');
                if (overlay) overlay.hidden = true;
            }
            if (toast) UI.toast(mp === 'amazon' ? 'Amazon' : 'Mercado Libre');
        };

        if (animate) runPageTransition('channel', go);
        else go();
    }

    function scrollGeneralSection(id) {
        if (!id) return;
        const key = id.startsWith('gx-') ? id : `gx-${id}`;
        const el = document.getElementById(key) || document.getElementById(id);
        if (!el) {
            UI.toast?.('Sección no disponible en esta vista', 'error');
            return;
        }
        if (el.tagName === 'DETAILS' && !el.open) el.open = true;
        const scroller = el.closest('.dash-body') || el.closest('.content');
        if (scroller) {
            const sRect = scroller.getBoundingClientRect();
            const eRect = el.getBoundingClientRect();
            const top = scroller.scrollTop + (eRect.top - sRect.top) - 8;
            scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        } else {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        document.querySelectorAll('.sb-gx-nav [data-gx-jump]').forEach(b => {
            b.classList.toggle('active', b.dataset.gxJump === key || b.dataset.gxJump === id);
        });
    }

    function initMarketplaceSwitch() {
        // Delegación: sobrevive a re-renders y evita botones “muertos”
        document.body.addEventListener('click', (e) => {
            const mpBtn = e.target.closest('.sb-mp [data-marketplace]');
            if (mpBtn) {
                e.preventDefault();
                applyMarketplaceView(mpBtn.dataset.marketplace);
                return;
            }
            const gx = e.target.closest('[data-gx-jump]');
            if (gx) {
                e.preventDefault();
                if (window.State.ui?.mpView !== 'general') {
                    applyMarketplaceView('general', { toast: false });
                    const jump = gx.dataset.gxJump;
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => scrollGeneralSection(jump));
                    });
                } else {
                    scrollGeneralSection(gx.dataset.gxJump);
                }
            }
        });
    }

    /** Ambiente del canvas según hora de Ciudad de México (no la TZ del dispositivo).
     *  Seis franjas: con un único bloque de 8 a 17 la app se veía igual toda la jornada. */
    const CDMX_TZ = 'America/Mexico_City';

    /** Hora decimal CDMX (0–24). Independiente del huso del Mac/iPhone. */
    function cdmxHourDecimal(d = new Date()) {
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: CDMX_TZ,
                hour: 'numeric',
                minute: 'numeric',
                hourCycle: 'h23',
            }).formatToParts(d);
            const hour = Number(parts.find(p => p.type === 'hour')?.value);
            const minute = Number(parts.find(p => p.type === 'minute')?.value);
            if (Number.isFinite(hour) && Number.isFinite(minute)) {
                return hour + minute / 60;
            }
        } catch { /* Intl / TZ no disponible */ }
        return d.getHours() + d.getMinutes() / 60;
    }

    function resolveDaypart(d = new Date()) {
        const h = cdmxHourDecimal(d);
        if (h >= 5 && h < 7.5) return 'dawn';
        if (h >= 7.5 && h < 11) return 'morning';
        if (h >= 11 && h < 15) return 'midday';
        if (h >= 15 && h < 17.5) return 'afternoon';
        if (h >= 17.5 && h < 20) return 'dusk';
        return 'night';
    }

    /** Recorrido del sol 0–1 (este → oeste) entre las 5 y las 20 CDMX. */
    function resolveSunX(d = new Date()) {
        const h = cdmxHourDecimal(d);
        return Math.min(1, Math.max(0, (h - 5) / 15));
    }

    /** Elevación del sol 0–1 (pico al mediodía CDMX) para matizar el cielo. */
    function resolveSunElev(d = new Date()) {
        const h = cdmxHourDecimal(d);
        // 6 → 0, 12 → 1, 18 → 0; noche suave ~0.12–0.25
        const elev = Math.sin(((h - 6) / 12) * Math.PI);
        if (elev > 0) return Math.min(1, elev);
        // Noche: brillo lunar suave según qué tan lejos del mediodía
        return 0.14 + Math.min(0.16, Math.abs(elev) * 0.12);
    }

    function applyDaypart(force = false) {
        const now = new Date();
        const part = resolveDaypart(now);
        const hour = cdmxHourDecimal(now);
        const elev = resolveSunElev(now);
        const sunX = resolveSunX(now);
        const root = document.documentElement;
        root.style.setProperty('--sun-hour', hour.toFixed(3));
        root.style.setProperty('--sun-elev', elev.toFixed(3));
        root.style.setProperty('--sun-x', sunX.toFixed(3));
        document.body.style.setProperty('--sun-hour', hour.toFixed(3));
        document.body.style.setProperty('--sun-elev', elev.toFixed(3));
        document.body.style.setProperty('--sun-x', sunX.toFixed(3));
        root.dataset.daypart = part;
        if (!force && document.body.dataset.daypart === part) return part;
        document.body.dataset.daypart = part;
        // Micro-kick visual al cruzar franja (sin ser molesto)
        if (force || document.body.dataset.daypartPrev !== part) {
            document.body.dataset.daypartPrev = part;
            document.body.classList.remove('is-daypart-shift');
            void document.body.offsetWidth;
            document.body.classList.add('is-daypart-shift');
            window.setTimeout(() => document.body.classList.remove('is-daypart-shift'), 1200);
        }
        return part;
    }

    function initDaypartAmbient() {
        applyDaypart(true);
        const tick = () => applyDaypart(false);
        // Cada minuto: el sol se mueve; cada 5 min bastaba para franjas, ahora afinamos
        const id = window.setInterval(tick, 60 * 1000);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') tick();
        });
        window.addEventListener('beforeunload', () => clearInterval(id), { once: true });
    }

    // ---- Init ----------------------------------------------------------
    function init() {
        window.State.ui = Data.loadUI();
        scrubKeepaFromStoredBackup();
        window.State.marketplace = Data.normalizeMarketplace(window.State.ui.marketplace);
        if (!window.State.ui.mpView) {
            window.State.ui = {
                ...window.State.ui,
                mpView: window.State.marketplace === 'amazon' ? 'amazon' : 'meli',
            };
        }
        // Deep-link desde iphone-sync: forzar Amazon (donde está el catálogo grande)
        try {
            const params = new URLSearchParams(location.search);
            if (params.get('mp') === 'amazon' || params.get('installed')) {
                window.State.ui = { ...window.State.ui, marketplace: 'amazon', mpView: 'amazon' };
                window.State.marketplace = 'amazon';
                window.State.saveUI();
            }
        } catch (_) { /* ignore */ }
        window.State.lotes = Data.loadLotes(window.State.marketplace);
        window.State.settings = Data.loadSettings(window.State.marketplace);

        window.App = App; // expose for other modules

        initMarketplaceSwitch();
        refreshMarketplaceChrome();
        initDaypartAmbient();
        initSidebar();
        initTopbar();
        initExcel();
        initBackup();
        initFAB();
        initPWA();
        window.Icons?.hydrate?.(document);

        LotesView.init();
        WishlistView.init();
        OfertasView.init();
        CajaView.init();
        DashboardView.init();
        SettingsView.init();
        Palette.init(App);

        // Migra asignaciones desde ledger + limpia bolsitas de ventas ya borradas
        try {
            let hydrated = false;
            const both = { meli: null, amazon: null };
            ['meli', 'amazon'].forEach(mp => {
                const lotes = mp === Data.currentMarketplace()
                    ? window.State.lotes
                    : Data.loadLotes(mp);
                both[mp] = lotes;
                if (Data.hydrateCobroFromLedger?.(lotes, mp)) {
                    Data.saveLotes(lotes, mp);
                    hydrated = true;
                    if (mp === Data.currentMarketplace()) window.State.lotes = lotes;
                }
            });
            const purged = window.DashboardView?.purgeOrphanSaleLiberations?.(both);
            // Reconciliar también si el MP activo no estaba en el loop de purge con cambio
            ['meli', 'amazon'].forEach(mp => {
                window.DashboardView?.reconcileAllocFromLedger?.(mp);
            });
            if (hydrated || (purged?.n > 0)) window.App?.refreshNavCounts?.();
        } catch { /* ignore */ }

        // Marcar dirty + auto-respaldo JSON en cada guardado.
        // UI contiene datos de negocio (Wishlist y Mis bolsitas), no solo layout.
        const origSave = window.State.save.bind(window.State);
        window.State.save = () => {
            origSave();
            if (!window.__skipBackupDirty) {
                markBackupNeeded();
                scheduleAutoBackup();
            }
            setTimeout(() => maybeNotifyOpsAlerts().catch(() => {}), 400);
        };
        const origSaveUI = window.State.saveUI.bind(window.State);
        window.State.saveUI = () => {
            origSaveUI();
            if (!window.__skipBackupDirty) {
                markBackupNeeded();
                scheduleAutoBackup();
            }
        };

        // Sync Supabase: primero matar SW (Safari), luego init
        const syncReady = killServiceWorkers()
            .catch(() => {})
            .then(() => (window.Sync
                ? Sync.init().catch(err => console.warn('[sync] init', err))
                : Promise.resolve()));

        refreshBackupHint();
        // Más tarde: da tiempo a Sync.init() a restaurar sesión Supabase
        setTimeout(() => maybeRemindBackup(), 2200);
        setTimeout(() => maybeNotifyOpsAlerts().catch(() => {}), 2800);

        switchTab('dashboard');
        // Tras instalar desde iPhone, abrir Productos para ver el catálogo de inmediato
        try {
            const params = new URLSearchParams(location.search);
            if (params.get('installed') || params.get('fromPhoneSync')) {
                switchTab('lotes');
            }
        } catch (_) { /* ignore */ }
        openOfertasDraft();

        // Tras Sync: recargar catálogo (iPhone a menudo aplicaba la nube DESPUÉS del primer paint)
        syncReady.finally(() => {
            try {
                const mp = Data.normalizeMarketplace(window.State.marketplace);
                const ui = Data.loadUI();
                if (ui?.mpView) {
                    window.State.ui = { ...window.State.ui, ...ui };
                }
                window.State.marketplace = Data.normalizeMarketplace(
                    window.State.ui?.marketplace || window.State.ui?.mpView || mp
                );
                if (window.State.ui?.mpView === 'amazon' || window.State.ui?.mpView === 'meli') {
                    window.State.marketplace = window.State.ui.mpView;
                }
                window.State.lotes = Data.loadLotes(window.State.marketplace);
                window.State.settings = Data.loadSettings(window.State.marketplace);
                window.State.notify();
                App.refreshMarketplaceChrome?.();
                App.refreshNavCounts?.();
                switchTab(window.State.view || 'dashboard');
            } catch (err) {
                console.warn('[sync] post-init refresh', err);
            }
            maybeClearVentasFromUrl().catch(err => console.warn('[clearVentas]', err));
            maybeDiagSalesDump().catch(err => console.warn('[diagSales]', err));
        });
    }

    /** Bookmarklet #oferta=… → Amazon + pestaña Ofertas con form prellenado. */
    function openOfertasDraft() {
        const hadHash = /^#oferta=/.test(location.hash || '');
        const ingested = window.OfertasView?.openDraftFromUrl?.();
        if (!ingested && !window.OfertasView?.hasDraft?.()) return false;

        try {
            if (window.State.marketplace !== 'amazon') {
                window.State.switchMarketplace('amazon');
            }
            if (window.State.ui?.mpView === 'general') {
                window.State.ui = { ...window.State.ui, mpView: 'amazon' };
                window.State.saveUI();
            }
        } catch (err) {
            console.warn('[ofertas draft]', err);
        }
        refreshMarketplaceChrome();
        switchTab('ofertas');
        if (hadHash || ingested) {
            UI.toast?.('Oferta capturada — completa ASIN Amazon y guarda');
        }
        return true;
    }

    /** ?diagSales=1 → vuelca ventas Amazon a .diag/amazon-sales.json (solo local). */
    async function maybeDiagSalesDump() {
        const params = new URLSearchParams(location.search);
        if (params.get('diagSales') !== '1') return;
        try {
            const mp = 'amazon';
            const settings = Data.loadSettings(mp);
            const lotes = Data.loadLotes(mp);
            const lists = Data.listVentasCobro(lotes, settings);
            const all = [...lists.porCobrar, ...lists.porAsignar, ...lists.historial];
            const rows = all.map(r => {
                const lote = lotes.find(l => l.id === r.loteId);
                const venta = (lote?.ventas || []).find(v => v.id === r.ventaId);
                let fees = 0;
                let util = 0;
                let costo = 0;
                let ref = 0;
                let fba = 0;
                try {
                    const loteAt = Data.loteForVentaCalc?.(lote, venta) || lote;
                    const u = Calc.utilidadAtPrice(loteAt, r.precio, settings);
                    const uds = r.unidades || 0;
                    util = (u.utilidad || 0) * uds;
                    costo = (Number(loteAt?.costo) || 0) * uds;
                    ref = (u.comisionVariable || 0) * uds;
                    fba = (u.envio || 0) * uds;
                    const alm = (u.almacenamiento || 0) * uds;
                    const varios = (u.varios || 0) * uds;
                    fees = ref + fba + alm + varios;
                } catch { /* ignore */ }
                return {
                    fecha: r.fecha,
                    sku: r.sku,
                    producto: r.producto,
                    uds: r.unidades,
                    precio: r.precio,
                    venta: r.saleTotal,
                    costo: Math.round(costo * 100) / 100,
                    ref: Math.round(ref * 100) / 100,
                    fba: Math.round(fba * 100) / 100,
                    fees: Math.round(fees * 100) / 100,
                    util: Math.round(util * 100) / 100,
                    repartir: r.amount,
                    cobro: r.cobroEstado,
                };
            }).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
            const sum = (k) => Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100;
            const payload = {
                at: new Date().toISOString(),
                n: rows.length,
                totals: {
                    venta: sum('venta'),
                    costo: sum('costo'),
                    fees: sum('fees'),
                    util: sum('util'),
                    repartir: sum('repartir'),
                },
                rows,
            };
            const res = await fetch('/api/diag/dump', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'amazon-sales', data: payload }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
            UI.toast?.(`Diag: ${rows.length} ventas Amazon → .diag/amazon-sales.json`, 'success');
        } finally {
            params.delete('diagSales');
            const q = params.toString();
            history.replaceState({}, '', location.pathname + (q ? `?${q}` : '') + location.hash);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        switchTab,
        exportExcel,
        openBackup,
        resetSettings,
        clearVentasRestore,
        markBackupDone,
        markBackupNeeded,
        refreshBackupHint,
        refreshNavCounts,
        refreshMarketplaceChrome,
        applyMarketplaceView,
        openOfertasDraft,
        applyDaypart,
        resolveDaypart,
        scrollGeneralSection,
        requestOpsNotifyPermission,
        maybeNotifyOpsAlerts,
        exportJSON,
    };
})();
