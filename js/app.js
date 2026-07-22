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
        lotes: 'Productos',
        dashboard: 'Dashboard',
        insights: 'Insights',
        settings: 'Ajustes',
    };

    function switchTab(tab) {
        if (!TAB_LABELS[tab]) return;
        window.State.view = tab;
        document.querySelectorAll('.sb-item[data-tab]').forEach(el => {
            const active = el.dataset.tab === tab;
            el.classList.toggle('active', active);
            el.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('.mobile-tab[data-tab]').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });
        document.querySelectorAll('.view').forEach(v => v.hidden = true);
        document.getElementById('view-' + tab).hidden = false;

        const crumb = document.getElementById('tb-current');
        if (crumb) crumb.textContent = TAB_LABELS[tab];

        if (tab === 'dashboard') DashboardView.render();
        else if (tab === 'insights') InsightsView.render();
        else if (tab === 'lotes') LotesView.render();
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
        refreshAlertBadge();
        window.State.subscribe(refreshAlertBadge);

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

    function refreshAlertBadge() {
        const badge = document.getElementById('tb-bell-count');
        if (!badge || !window.InsightsView) return;
        const c = InsightsView.alertCount();
        badge.textContent = c;
        badge.hidden = c === 0;
        const mBadge = document.getElementById('m-tab-insights');
        if (mBadge) {
            mBadge.textContent = c;
            mBadge.hidden = c === 0;
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
                if (!data || !Array.isArray(data.lotes)) throw new Error('Formato inválido');
                const ok = await UI.confirm({
                    title: 'Restaurar respaldo',
                    message: `Se restaurarán <strong>${data.lotes.length}</strong> lote(s) y se reemplazarán los actuales. ¿Continuar?`,
                    primaryLabel: 'Restaurar',
                    danger: true,
                });
                if (!ok) return;
                window.State.lotes = data.lotes.map(Data.normalize);
                if (data.settings) {
                    window.State.settings = { ...Calc.DEFAULT_SETTINGS, ...data.settings };
                    window.State.saveSettings();
                    SettingsView.loadIntoForm();
                }
                window.State.save();
                markBackupDone();
                UI.toast('Respaldo restaurado');
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
        const data = {
            version: 3,
            exportedAt: new Date().toISOString(),
            lotes: window.State.lotes,
            settings: window.State.settings,
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
        window.State.settings = { ...Calc.DEFAULT_SETTINGS };
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

    // ---- Init ----------------------------------------------------------
    function init() {
        window.State.lotes = Data.loadLotes();
        window.State.settings = Data.loadSettings();
        window.State.ui = Data.loadUI();

        window.App = App; // expose for other modules

        initSidebar();
        initTopbar();
        initExcel();
        initBackup();
        initFAB();
        initPWA();

        LotesView.init();
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
        if (window.Sync) {
            Sync.init().catch(err => console.warn('[sync] init', err));
        }

        refreshBackupHint();
        // Más tarde: da tiempo a Sync.init() a restaurar sesión Supabase
        setTimeout(() => maybeRemindBackup(), 2200);

        switchTab('lotes');
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
        markBackupDone,
        markBackupNeeded,
        refreshBackupHint,
    };
})();
