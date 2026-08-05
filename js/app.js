/* ==========================================================================
   Bootstrap + orquestación:
     - navegación sidebar (dashboard, productos, envíos, caja, insights, ajustes)
     - marketplace Meli / Amazon / General
     - importar/exportar Excel (con wizard)
     - respaldo JSON (con dialog propio)
     - command palette (⌘K)
     - PWA service worker registration
     - sincronización de topbar (breadcrumb + fecha)
   ========================================================================== */

const App = (() => {

    const TAB_LABELS = {
        dashboard: 'Inicio',
        lotes: 'Productos',
        envios: 'Envíos',
        wishlist: 'Wishlist',
        keepa: 'Keepa Lab',
        caja: 'Caja',
        insights: 'Insights',
        settings: 'Ajustes',
    };

    function switchTab(tab) {
        if (!TAB_LABELS[tab]) return;
        // Envíos solo existe en Amazon con la función activa
        if (tab === 'envios' && (!window.EnviosView || !window.EnviosView.isEnabled())) {
            tab = 'settings';
        }
        if (['wishlist', 'keepa'].includes(tab) && window.State.marketplace !== 'amazon') {
            tab = 'lotes';
        }
        // General es solo resumen: al ir a catálogo, vuelve al último MP real.
        // Ajustes (Sync) sí. Caja está oculta en el menú General; si se abre, su vista pide catálogo.
        if (['lotes', 'envios', 'wishlist', 'keepa', 'insights'].includes(tab)
            && window.State.ui?.mpView === 'general') {
            const real = Data.normalizeMarketplace(window.State.marketplace);
            window.State.ui = { ...window.State.ui, mpView: real };
            window.State.saveUI();
            refreshMarketplaceChrome();
            const label = real === 'amazon' ? 'Amazon' : 'Mercado Libre';
            UI.toast(`Catálogo ${label} (General es solo resumen)`);
        }
        const view = document.getElementById('view-' + tab);
        if (!view) return;
        window.State.view = tab;
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

        if (tab === 'dashboard') DashboardView.render();
        else if (tab === 'insights') InsightsView.render();
        else if (tab === 'lotes') LotesView.render();
        else if (tab === 'envios') EnviosView.render();
        else if (tab === 'wishlist') WishlistView.render();
        else if (tab === 'keepa') KeepaView.render();
        else if (tab === 'caja') CajaView.render();
        else if (tab === 'settings') SettingsView.loadIntoForm();
        refreshNavCounts();
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
        // Alerts bell — Insights + opcional permiso push
        const bell = document.getElementById('tb-bell');
        if (bell) {
            bell.addEventListener('click', async () => {
                if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                    await requestOpsNotifyPermission();
                } else {
                    await maybeNotifyOpsAlerts();
                }
                switchTab('insights');
            });
        }
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
        document.getElementById('m-tab-more')?.addEventListener('click', () => {
            if (document.body.classList.contains('nav-open')) closeMobileNav();
            else openMobileNav();
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

        const alerts = window.InsightsView ? InsightsView.alertCount() : 0;
        const bell = document.getElementById('tb-bell-count');
        if (bell) {
            bell.textContent = alerts;
            bell.hidden = alerts === 0;
        }
        const sbIns = document.getElementById('sb-count-insights');
        if (sbIns) {
            sbIns.textContent = alerts;
            sbIns.hidden = alerts === 0;
            sbIns.classList.toggle('badge-alert', alerts > 0);
        }
        const mIns = document.getElementById('m-tab-insights');
        if (mIns) {
            mIns.textContent = alerts;
            mIns.hidden = alerts === 0;
        }

        const pendingShip = window.EnviosView?.pendingCount?.() || 0;
        const sbEnv = document.getElementById('sb-count-envios');
        if (sbEnv) {
            sbEnv.textContent = pendingShip;
            sbEnv.hidden = pendingShip === 0;
            sbEnv.classList.toggle('badge-alert', pendingShip > 0);
        }

        const pendingWish = window.WishlistView?.pendingCount?.() || 0;
        const sbWish = document.getElementById('sb-count-wishlist');
        if (sbWish) {
            sbWish.textContent = pendingWish;
            sbWish.hidden = pendingWish === 0;
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
    }

    // ---- Excel ---------------------------------------------------------
    function initExcel() {
        document.getElementById('btn-import').addEventListener('click', () => {
            document.getElementById('file-import').click();
        });
        document.getElementById('file-import').addEventListener('change', async e => {
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

        document.getElementById('btn-export').addEventListener('click', () => exportExcel());
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
            ? 'Hay cambios sin respaldo JSON. En Meli/Amazon → Datos → Respaldo.'
            : (last
                ? `Llevas ${days}d sin respaldo. En Meli/Amazon → Datos → Respaldo.`
                : 'Aún no hay respaldo JSON. En Meli/Amazon → Datos → Respaldo.');
        UI.toast?.(msg, 'info', 4200);
    }

    // ---- Backup --------------------------------------------------------
    function initBackup() {
        document.getElementById('btn-backup').addEventListener('click', openBackup);
        document.getElementById('file-backup').addEventListener('change', async e => {
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
                // Refresca la vista abierta (wishlist/caja incluidos)
                if (window.State.view === 'wishlist') WishlistView?.render?.();
                else if (window.State.view === 'keepa') KeepaView?.render?.();
                else if (window.State.view === 'caja') CajaView?.render?.();
                else if (window.State.view === 'dashboard') DashboardView?.render?.();
                else if (window.State.view === 'lotes') LotesView?.render?.();
                else if (window.State.view === 'envios') EnviosView?.render?.();
                else if (window.State.view === 'insights') InsightsView?.render?.();
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
        return {
            version: 5,
            exportedAt: new Date().toISOString(),
            marketplace: active,
            lotes: window.State.lotes,
            settings: window.State.settings,
            ui: {
                ...backupUI,
                // Asegura wishlist + bolsitas en el JSON
                wishlistAmazon: window.State.ui?.wishlistAmazon || [],
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
            if (!('keepaApiKey' in ui) && !('keepaCache' in ui)) return;
            delete ui.keepaApiKey;
            delete ui.keepaCache;
            localStorage.setItem('vm.autoBackup', JSON.stringify(stored));
        } catch (err) {
            console.warn('[backup] no se pudo sanear Keepa', err);
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
                const fecha = lote.fecha ? new Date(lote.fecha) : null;
                const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
                if (fecha && calc.inventarioRestante > 0 && ventas.length === 0) {
                    const dias = Math.floor((Date.now() - fecha.getTime()) / 86400000);
                    if (dias >= 30) {
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
                    const reg = await navigator.serviceWorker?.ready;
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

    // ---- FAB -----------------------------------------------------------
    function initFAB() {
        const fab = document.getElementById('fab-new');
        if (fab) fab.addEventListener('click', () => LotesView.openModal(null));
    }

    // ---- PWA -----------------------------------------------------------
    function initPWA() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js').catch(() => {});
            });
        }
    }

    /** Borra ventas, restaura piezas del seed y sube a Sync si hay sesión. */
    async function clearVentasRestore({ confirm = true } = {}) {
        if (confirm) {
            const ok = await UI.confirm({
                title: 'Borrar ventas y restaurar piezas',
                message: 'Se eliminarán <strong>todas las ventas registradas</strong> y el stock volverá a las piezas originales. Si Sync está activo, se subirá a Supabase para que no regresen.',
                primaryLabel: 'Borrar y restaurar',
                danger: true,
            });
            if (!ok) return false;
        }
        // Evita que realtime/pull vuelva a meter las ventas viejas
        Sync?.holdRemote?.(25000);

        let ventasCleared = 0;
        if (typeof Data.clearVentasRestoreStock === 'function') {
            const r = Data.clearVentasRestoreStock(window.State.lotes);
            window.State.lotes = r.lotes;
            ventasCleared = r.ventasCleared;
        } else {
            const bySku = Object.fromEntries(Data.SEED.map(s => [s.sku, s]));
            window.State.lotes = window.State.lotes.map(l => {
                const seed = bySku[l.sku];
                if ((l.ventas || []).length || l.vendidas) ventasCleared++;
                return Data.normalize({
                    ...l,
                    unidades: seed ? seed.unidades : l.unidades,
                    ventas: [],
                    vendidas: 0,
                    estatus: '✅ Activa / En Venta',
                }, []);
            });
        }
        window.State.save();

        // Ventas borradas dejan liberaciones huérfanas → limpiar bolsitas del MP activo
        try {
            const mp = Data.currentMarketplace();
            window.DashboardView?.purgeOrphanSaleLiberations?.({ [mp]: window.State.lotes });
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
        else if (window.State.view === 'insights') InsightsView.render();
        else if (window.State.view === 'lotes') LotesView.render();
        else if (window.State.view === 'envios') EnviosView.render();
        else if (window.State.view === 'wishlist') WishlistView.render();
        else if (window.State.view === 'keepa') KeepaView.render();
        else if (window.State.view === 'caja') CajaView.render();
        refreshNavCounts();
        return true;
    }

    async function maybeClearVentasFromUrl() {
        const params = new URLSearchParams(location.search);
        if (params.get('clearVentas') !== '1' && sessionStorage.getItem('vm:clearVentas') !== '1') return;
        sessionStorage.setItem('vm:clearVentas', '1');
        Sync?.holdRemote?.(30000);
        // Esperar a que Sync termine el pull inicial
        await new Promise(r => setTimeout(r, 2200));
        await clearVentasRestore({ confirm: false });
        sessionStorage.removeItem('vm:clearVentas');
        params.delete('clearVentas');
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
                ? 'Ventas Meli'
                : (mp === 'amazon' ? 'Ventas Amazon' : 'Ventas Meli');
        }
        const sub = document.querySelector('.sb-brand-text .sub');
        if (sub) {
            sub.textContent = mpView === 'general'
                ? 'Hoy · capital y agenda'
                : (mp === 'amazon' ? 'Catálogo Amazon MX' : 'Catálogo Mercado Libre');
        }
        const root = document.querySelector('.tb-crumb-root');
        if (root) root.textContent = mpView === 'general' ? 'General' : meta.short;
        const curr = document.getElementById('tb-current');
        if (curr && mpView === 'general') curr.textContent = 'Hoy';
        document.body.dataset.marketplace = mp;
        document.body.dataset.mpView = mpView;

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
        const mpHint = document.querySelector('.sb-mp-hint');
        if (mpHint) {
            mpHint.textContent = isGeneral
                ? 'Checklist, agenda y metas. Productos en cada catálogo.'
                : 'Cambia a General para el pulso del día.';
        }

        // Cards/flags por catálogo activo (incluso en General: Ajustes usa el MP subyacente).
        // Envíos y similares se ocultan en General vía data-feature / data-hide-on-general.
        document.querySelectorAll('[data-mp-only]').forEach(el => {
            el.hidden = el.dataset.mpOnly !== mp;
        });
        document.querySelectorAll('[data-mp-field]').forEach(el => {
            el.hidden = el.dataset.mpField !== mp;
        });
        // Feature flags (p.ej. menú Envíos)
        const prepOn = !isGeneral && mp === 'amazon' && window.State.settings?.prepEnvioActivo !== false;
        document.querySelectorAll('[data-feature="prep-envio"]').forEach(el => {
            el.hidden = !prepOn;
        });
        if (!isGeneral && window.State.view === 'envios' && !prepOn) {
            switchTab('lotes');
        }
        if (!isGeneral && ['wishlist', 'keepa'].includes(window.State.view) && mp !== 'amazon') {
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

    function applyMarketplaceView(mp, { toast = true } = {}) {
        if (!mp) return;
        const curView = Data.normalizeMpView(
            window.State.ui?.mpView === 'general'
                ? 'general'
                : (window.State.ui?.mpView || window.State.marketplace)
        );
        if (mp === curView) return;

        if (mp === 'general') {
            window.State.ui = { ...window.State.ui, mpView: 'general' };
            window.State.saveUI();
            refreshMarketplaceChrome();
            switchTab('dashboard');
            if (toast) UI.toast('General · checklist y agenda');
            return;
        }

        window.State.ui = { ...window.State.ui, mpView: mp };
        window.State.saveUI();
        if (mp !== window.State.marketplace) {
            window.State.switchMarketplace(mp);
        }
        refreshMarketplaceChrome();
        SettingsView.loadIntoForm();
        if (window.State.view === 'dashboard') DashboardView.render();
        else if (window.State.view === 'insights') InsightsView.render();
        else if (window.State.view === 'lotes') LotesView.render();
        else if (window.State.view === 'envios') EnviosView.render();
        else if (window.State.view === 'wishlist') WishlistView.render();
        else if (window.State.view === 'keepa') KeepaView.render();
        else if (window.State.view === 'caja') CajaView.render();
        refreshNavCounts();
        if (document.body.classList.contains('nav-open')) {
            document.body.classList.remove('nav-open');
            const overlay = document.getElementById('nav-overlay');
            if (overlay) overlay.hidden = true;
        }
        if (toast) UI.toast(mp === 'amazon' ? 'Amazon' : 'Mercado Libre');
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
        document.querySelectorAll('[data-gx-jump]').forEach(b => {
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
                    setTimeout(() => scrollGeneralSection(gx.dataset.gxJump), 80);
                } else {
                    scrollGeneralSection(gx.dataset.gxJump);
                }
            }
        });
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
        window.State.lotes = Data.loadLotes(window.State.marketplace);
        window.State.settings = Data.loadSettings(window.State.marketplace);

        window.App = App; // expose for other modules

        initMarketplaceSwitch();
        refreshMarketplaceChrome();
        initSidebar();
        initTopbar();
        initExcel();
        initBackup();
        initFAB();
        initPWA();

        LotesView.init();
        EnviosView.init();
        WishlistView.init();
        CajaView.init();
        DashboardView.init();
        InsightsView.init();
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

        // Sync Supabase (después de wrap de dirty, Sync vuelve a envolver saves)
        const syncReady = window.Sync
            ? Sync.init().catch(err => console.warn('[sync] init', err))
            : Promise.resolve();

        refreshBackupHint();
        // Más tarde: da tiempo a Sync.init() a restaurar sesión Supabase
        setTimeout(() => maybeRemindBackup(), 2200);
        setTimeout(() => maybeNotifyOpsAlerts().catch(() => {}), 2800);

        switchTab('dashboard');

        // ?clearVentas=1 → limpia después del pull de Sync
        syncReady.finally(() => {
            maybeClearVentasFromUrl().catch(err => console.warn('[clearVentas]', err));
        });
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
        scrollGeneralSection,
        requestOpsNotifyPermission,
        maybeNotifyOpsAlerts,
        exportJSON,
    };
})();
