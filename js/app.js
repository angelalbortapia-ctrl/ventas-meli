/* ==========================================================================
   Bootstrap + orquestación:
     - navegación sidebar (4 vistas: lotes, dashboard, insights, settings)
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
        insights: 'Insights',
        settings: 'Ajustes',
    };

    function switchTab(tab) {
        if (!TAB_LABELS[tab]) return;
        // Envíos solo existe en Amazon con la función activa
        if (tab === 'envios' && window.EnviosView && !EnviosView.isEnabled()) {
            tab = 'settings';
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
        // Alerts bell
        const bell = document.getElementById('tb-bell');
        if (bell) bell.addEventListener('click', () => switchTab('insights'));
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

    /** Con Supabase logueado, el respaldo en la nube sustituye al nag de JSON. */
    function cloudBackupActive() {
        const st = window.Sync?.getStatus?.()?.state;
        return st === 'synced' || st === 'syncing' || st === 'signed_in';
    }

    function markBackupNeeded() {
        if (cloudBackupActive()) {
            // La nube recibe el push; no marcar dirty ni molestar
            refreshBackupHint();
            return;
        }
        window.State.ui = { ...window.State.ui, backupDirty: true };
        window.State.saveUI();
        refreshBackupHint();
    }

    function markBackupDone() {
        window.State.ui = {
            ...window.State.ui,
            backupDirty: false,
            lastBackupAt: new Date().toISOString(),
        };
        window.State.saveUI();
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
        // Esperar un momento a que Sync termine de bootear sesión
        await new Promise(r => setTimeout(r, 400));
        if (cloudBackupActive()) {
            // Limpiar flag viejo para que no reaparezca
            if (window.State.ui?.backupDirty) markBackupDone();
            return;
        }
        const ui = window.State.ui || {};
        const last = ui.lastBackupAt ? new Date(ui.lastBackupAt) : null;
        const days = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : 999;
        if (ui.backupDirty || days >= 7) {
            const ok = await UI.confirm({
                title: 'Respaldo recomendado',
                message: ui.backupDirty
                    ? 'Hay cambios recientes guardados solo en este navegador. ¿Exportar un JSON de respaldo ahora?'
                    : `Han pasado <strong>${days} días</strong> desde el último respaldo. Los datos viven en localStorage: un wipe del navegador los borra. ¿Exportar ahora?`,
                primaryLabel: 'Exportar JSON',
                cancelLabel: 'Después',
            });
            if (ok) exportJSON();
            else markBackupDone(); // posponer nag; no bloquear el panel
        }
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
                    const m = data.stores.meli || { lotes: [], settings: {} };
                    const a = data.stores.amazon || { lotes: [], settings: {} };
                    Data.saveLotes((m.lotes || []).map(l => Data.normalize(l, [])), 'meli');
                    Data.saveSettings({ ...Calc.defaultsFor('meli'), ...(m.settings || {}), marketplace: 'meli' }, 'meli');
                    Data.saveLotes((a.lotes || []).map(l => Data.normalize(l, [])), 'amazon');
                    Data.saveSettings({ ...Calc.defaultsFor('amazon'), ...(a.settings || {}), marketplace: 'amazon' }, 'amazon');
                    const mp = data.marketplace === 'amazon' ? 'amazon' : 'meli';
                    window.State.marketplace = mp;
                    window.State.ui = { ...window.State.ui, marketplace: mp };
                    window.State.saveUI();
                    window.State.lotes = Data.loadLotes(mp);
                    window.State.settings = Data.loadSettings(mp);
                } else {
                    window.State.lotes = data.lotes.map(l => Data.normalize(l, []));
                    if (data.settings) {
                        window.State.settings = {
                            ...Calc.defaultsFor(window.State.marketplace),
                            ...data.settings,
                            marketplace: window.State.marketplace,
                        };
                        window.State.saveSettings();
                    }
                    window.State.save();
                }
                refreshMarketplaceChrome();
                SettingsView.loadIntoForm();
                markBackupDone();
                UI.toast('Respaldo restaurado');
                window.State.notify();
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

    function exportJSON() {
        const active = Data.normalizeMarketplace(window.State.marketplace);
        Data.saveLotes(window.State.lotes, active);
        Data.saveSettings(window.State.settings, active);
        const data = {
            version: 4,
            exportedAt: new Date().toISOString(),
            marketplace: active,
            lotes: window.State.lotes,
            settings: window.State.settings,
            stores: {
                meli: {
                    lotes: active === 'meli' ? window.State.lotes : Data.loadLotes('meli'),
                    settings: active === 'meli' ? window.State.settings : Data.loadSettings('meli'),
                },
                amazon: {
                    lotes: active === 'amazon' ? window.State.lotes : Data.loadLotes('amazon'),
                    settings: active === 'amazon' ? window.State.settings : Data.loadSettings('amazon'),
                },
            },
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ventas-meli_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 100);
        markBackupDone();
        UI.toast('Respaldo JSON descargado');
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
        const meta = Data.mpMeta(mp);
        document.querySelectorAll('[data-marketplace]').forEach(el => {
            el.classList.toggle('active', el.dataset.marketplace === mp);
            el.setAttribute('aria-selected', el.dataset.marketplace === mp ? 'true' : 'false');
        });
        const brand = document.querySelector('.sb-brand-text .name');
        if (brand) brand.textContent = mp === 'amazon' ? 'Ventas Amazon' : 'Ventas Meli';
        const sub = document.querySelector('.sb-brand-text .sub');
        if (sub) sub.textContent = mp === 'amazon' ? 'Amazon México · rentabilidad' : 'Mercado Libre · rentabilidad';
        const root = document.querySelector('.tb-crumb-root');
        if (root) root.textContent = meta.short;
        document.body.dataset.marketplace = mp;
        document.querySelectorAll('[data-mp-only]').forEach(el => {
            el.hidden = el.dataset.mpOnly !== mp;
        });
        document.querySelectorAll('[data-mp-field]').forEach(el => {
            el.hidden = el.dataset.mpField !== mp;
        });
        // Feature flags (p.ej. menú Envíos)
        const prepOn = mp === 'amazon' && window.State.settings?.prepEnvioActivo !== false;
        document.querySelectorAll('[data-feature="prep-envio"]').forEach(el => {
            el.hidden = !prepOn;
        });
        if (window.State.view === 'envios' && !prepOn) {
            switchTab('lotes');
        }
        // Labels del modal
        const tipoLabel = document.querySelector('label:has(#f-tipo) > span');
        if (tipoLabel) tipoLabel.textContent = mp === 'amazon' ? 'Logística' : 'Tipo Publicación';
        const envioLabel = document.querySelector('label:has(#f-envio) > span');
        if (envioLabel) {
            envioLabel.textContent = mp === 'amazon'
                ? 'Fulfillment override (MXN)'
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

    function initMarketplaceSwitch() {
        document.querySelectorAll('[data-marketplace]').forEach(btn => {
            btn.addEventListener('click', () => {
                const mp = btn.dataset.marketplace;
                if (!mp || mp === window.State.marketplace) return;
                window.State.switchMarketplace(mp);
                refreshMarketplaceChrome();
                SettingsView.loadIntoForm();
                if (window.State.view === 'dashboard') DashboardView.render();
                else if (window.State.view === 'insights') InsightsView.render();
                else if (window.State.view === 'lotes') LotesView.render();
                else if (window.State.view === 'envios') EnviosView.render();
                refreshNavCounts();
                UI.toast(mp === 'amazon' ? 'Catálogo Amazon (vacío / propio)' : 'Catálogo Mercado Libre');
            });
        });
    }

    // ---- Init ----------------------------------------------------------
    function init() {
        window.State.ui = Data.loadUI();
        window.State.marketplace = Data.normalizeMarketplace(window.State.ui.marketplace);
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
        DashboardView.init();
        InsightsView.init();
        SettingsView.init();
        Palette.init(App);

        // Marcar dirty en cada guardado de lotes (excepto si acabamos de respaldar)
        const origSave = window.State.save.bind(window.State);
        window.State.save = () => {
            origSave();
            if (!window.__skipBackupDirty) markBackupNeeded();
        };

        // Sync Supabase (después de wrap de dirty, Sync vuelve a envolver save)
        const syncReady = window.Sync
            ? Sync.init().catch(err => console.warn('[sync] init', err))
            : Promise.resolve();

        refreshBackupHint();
        // Más tarde: da tiempo a Sync.init() a restaurar sesión Supabase
        setTimeout(() => maybeRemindBackup(), 2200);

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
    };
})();
