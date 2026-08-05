/* ==========================================================================
   Vista Caja: timeline Por cobrar → Cobrado
   - Días en espera, filtro SKU, historial corto
   - Cobrado reparte automático con % de Mis bolsitas (dashboard)
   ========================================================================== */

const CajaView = (() => {

    const local = {
        filter: 'pendiente', // pendiente | hecho
        q: '',
        selected: new Set(), // ventaIds
    };

    function esc(s) {
        return UI.escapeHTML(String(s ?? ''));
    }

    function buckets() {
        return window.DashboardView?.ALLOC_BUCKETS || [
            { key: 'reinversion', label: 'Reinversión' },
            { key: 'reserva', label: 'Reserva' },
            { key: 'ads', label: 'Ads' },
            { key: 'insumos', label: 'Insumos' },
            { key: 'utilidad', label: 'Utilidad' },
        ];
    }

    function round2(n) {
        return window.DashboardView?.round2?.(n)
            ?? (Math.round((Number(n) || 0) * 100) / 100);
    }

    function readAlloc() {
        return window.DashboardView?.readAllocState?.() || {
            percents: { reinversion: 35, reserva: 20, ads: 15, insumos: 15, utilidad: 15 },
            buckets: { reinversion: 0, reserva: 0, ads: 0, insumos: 0, utilidad: 0 },
        };
    }

    function splitByPercents(amount, percents) {
        if (window.DashboardView?.splitByPercents) {
            return window.DashboardView.splitByPercents(amount, percents);
        }
        const empty = Data.emptyAsignacionBuckets();
        const amt = round2(amount);
        let used = 0;
        const keys = buckets().map(b => b.key);
        keys.forEach((key, i) => {
            if (i === keys.length - 1) empty[key] = round2(amt - used);
            else {
                empty[key] = round2(amt * ((Number(percents[key]) || 0) / 100));
                used = round2(used + empty[key]);
            }
        });
        return empty;
    }

    function hydrate() {
        const mp = Data.currentMarketplace();
        const changed = Data.hydrateCobroFromLedger?.(window.State.lotes, mp);
        const purged = window.DashboardView?.purgeOrphanSaleLiberations?.({
            [mp]: window.State.lotes,
        });
        if (changed) window.State.save();
        if (purged?.n > 0) window.App?.refreshNavCounts?.();
    }

    function lists() {
        return Data.listVentasCobro(window.State.lotes, window.State.settings);
    }

    function kpis() {
        return Data.cobroKpis(window.State.lotes, window.State.settings);
    }

    function pendingCount() {
        if (window.State.ui?.mpView === 'general' && Data.loadBothCatalogs) {
            const both = Data.loadBothCatalogs();
            return Data.cobroPendingCount(both.meli.lotes, both.meli.settings)
                + Data.cobroPendingCount(both.amazon.lotes, both.amazon.settings);
        }
        return Data.cobroPendingCount(window.State.lotes, window.State.settings);
    }

    function open(tab = 'pendiente') {
        // 'asignar' = cobrado sin bolsitas → vive en Por cobrar (junto con pendientes)
        local.filter = tab === 'historial' || tab === 'hecho'
            ? 'hecho'
            : 'pendiente';
        window.App?.switchTab?.('caja');
    }

    function todayISO() {
        return new Date().toISOString().slice(0, 10);
    }

    function daysWaiting(fecha) {
        if (!fecha) return 0;
        const d = new Date(`${String(fecha).slice(0, 10)}T12:00:00`);
        if (Number.isNaN(d.getTime())) return 0;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        return Math.max(0, Math.round((today - start) / 86400000));
    }

    function esperaLabel(n) {
        if (n <= 0) return 'Hoy';
        if (n === 1) return 'Lleva 1 día';
        return `Lleva ${n} días`;
    }

    function matchQuery(row, q) {
        if (!q) return true;
        const hay = `${row.sku || ''} ${row.producto || ''} ${row.variante || ''}`.toLowerCase();
        return hay.includes(q);
    }

    function sortPending(rows) {
        return [...rows].sort((a, b) => {
            const da = daysWaiting(a.fecha);
            const db = daysWaiting(b.fecha);
            if (db !== da) return db - da; // más viejas primero
            return String(a.fecha || '').localeCompare(String(b.fecha || ''));
        });
    }

    function markCobrado(loteId, ventaId, amount, { silent = false } = {}) {
        const lote = (window.State.lotes || []).find(l => l.id === loteId);
        if (!lote) {
            if (!silent) UI.toast('Lote no encontrado', 'error');
            return false;
        }
        const amt = round2(amount);
        if (!Number.isFinite(amt) || amt < 0) {
            if (!silent) UI.toast('Monto inválido', 'error');
            return false;
        }
        try {
            // Liberación 0: cobrado sin reparto (venta a pérdida / fees ≥ precio)
            const splits = amt > 0
                ? splitByPercents(amt, readAlloc().percents)
                : Data.emptyAsignacionBuckets();
            Data.asignarVentaABolsitas(lote, ventaId, splits);
            window.State.lotes = Data.upsertLote(window.State.lotes, lote);
            return true;
        } catch (err) {
            if (!silent) UI.toast(err.message || 'No se pudo cobrar', 'error');
            return false;
        }
    }

    function markMany(rows) {
        let n = 0;
        let total = 0;
        rows.forEach(r => {
            if (markCobrado(r.loteId, r.ventaId, r.amount, { silent: true })) {
                n += 1;
                total = round2(total + (r.amount || 0));
                local.selected.delete(r.ventaId);
            }
        });
        if (n > 0) {
            window.State.save();
            window.App?.refreshNavCounts?.();
            if (window.State.view === 'dashboard') DashboardView.render();
            UI.toast(`${n} cobrada${n === 1 ? '' : 's'} · ${Calc.fmtMXN(total)} → bolsitas`);
        } else {
            UI.toast('No se pudo cobrar ninguna', 'error');
        }
        render();
    }

    function layToolbar(pendingVisible, todayRows) {
        const mp = Data.currentMarketplace();
        const mpLabel = mp === 'amazon' ? 'Amazon' : 'Mercado Libre';
        return `
            <div class="caja-toolbar">
                <label class="caja-search">
                    <span class="sr-only">Buscar SKU</span>
                    <input type="search" id="caja-q" placeholder="Filtrar SKU o producto…"
                        value="${esc(local.q)}" autocomplete="off">
                </label>
                <span class="caja-mp-chip muted small">${esc(mpLabel)}</span>
                <div class="caja-toolbar-actions">
                    ${todayRows.length ? `
                        <button type="button" class="btn ghost btn-sm" data-caja-hoy
                            title="Marca cobradas las ventas de hoy">
                            Cobrar las de hoy (${todayRows.length})
                        </button>
                    ` : ''}
                    ${local.selected.size ? `
                        <button type="button" class="btn primary btn-sm" data-caja-selected>
                            Cobrar seleccionadas (${local.selected.size})
                        </button>
                    ` : ''}
                </div>
            </div>
            ${pendingVisible.length && local.filter === 'pendiente' ? `
                <p class="caja-hint muted small">
                    Ordenadas por antigüedad · toca el check para seleccionar varias
                </p>
            ` : ''}
        `;
    }

    function layTimelineItem(row, { pending = false } = {}) {
        const days = daysWaiting(row.fecha);
        const checked = local.selected.has(row.ventaId);
        const when = pending
            ? Calc.fmtDate(row.fecha)
            : (row.asignacion?.asignadoAt
                ? new Date(row.asignacion.asignadoAt).toLocaleDateString('es-MX')
                : Calc.fmtDate(row.fecha));

        if (!pending) {
            // Historial corto: fecha · SKU · monto
            return `
                <li class="caja-hist-row">
                    <span class="caja-hist-fecha">${esc(when)}</span>
                    <code class="caja-hist-sku">${esc(row.sku || '—')}</code>
                    <span class="caja-hist-amt">${Calc.fmtMXN(row.amount)}</span>
                </li>
            `;
        }

        return `
            <li class="caja-tl-item is-pending${days >= 5 ? ' is-stale' : ''}">
                <div class="caja-tl-rail" aria-hidden="true">
                    <span class="caja-tl-dot"></span>
                    <span class="caja-tl-line"></span>
                </div>
                <div class="caja-tl-body">
                    <div class="caja-tl-top">
                        <label class="caja-check">
                            <input type="checkbox" data-caja-pick value="${esc(row.ventaId)}"
                                ${checked ? 'checked' : ''}>
                            <span>
                                <div class="caja-tl-sku">${esc(row.sku || 'Sin SKU')}</div>
                                <div class="caja-tl-title">${esc(row.producto)}${row.variante ? ` · ${esc(row.variante)}` : ''}</div>
                            </span>
                        </label>
                        <button type="button" class="btn primary btn-sm"
                            data-caja-cobrado
                            data-lote="${esc(row.loteId)}"
                            data-venta="${esc(row.ventaId)}"
                            data-amount="${row.amount}">
                            Cobrado
                        </button>
                    </div>
                    <div class="caja-tl-meta">
                        <span>${esc(when)}</span>
                        <span class="caja-espera${days >= 5 ? ' is-hot' : ''}">${esc(esperaLabel(days))}</span>
                        <span>${row.unidades} ud</span>
                        <span>venta ${Calc.fmtMXN(row.saleTotal)}</span>
                        <span>a repartir ${Calc.fmtMXN(row.amount)}</span>
                    </div>
                </div>
            </li>
        `;
    }

    function render() {
        const root = document.getElementById('view-caja');
        if (!root) return;

        if (window.State.ui?.mpView === 'general') {
            root.innerHTML = `
                <div class="view-head">
                    <div>
                        <h2>Caja</h2>
                        <p class="muted">Abre Mercado Libre o Amazon para marcar cobros.</p>
                    </div>
                </div>
                <div class="card">
                    <p class="muted">General es solo resumen. Elige un catálogo (el filtro de Caja es por marketplace activo).</p>
                    <div class="caja-panel-actions">
                        <button type="button" class="btn primary" data-caja-goto-mp="meli">Mercado Libre</button>
                        <button type="button" class="btn" data-caja-goto-mp="amazon">Amazon</button>
                    </div>
                </div>
            `;
            root.querySelectorAll('[data-caja-goto-mp]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mp = btn.getAttribute('data-caja-goto-mp');
                    if (window.App?.applyMarketplaceView) window.App.applyMarketplaceView(mp);
                    open(local.filter);
                });
            });
            return;
        }

        hydrate();
        const { porCobrar, porAsignar, historial } = lists();
        const pendingAll = sortPending([...porCobrar, ...porAsignar]);
        const q = String(local.q || '').trim().toLowerCase();
        const pending = pendingAll.filter(r => matchQuery(r, q));
        const hist = historial.filter(r => matchQuery(r, q));
        const kpi = kpis();
        const showPending = local.filter === 'pendiente';
        const rows = showPending ? pending : hist;
        const today = todayISO();
        const todayRows = pending.filter(r => String(r.fecha || '').slice(0, 10) === today);

        // Limpia selección de ventas que ya no están pendientes
        const alive = new Set(pendingAll.map(r => r.ventaId));
        [...local.selected].forEach(id => { if (!alive.has(id)) local.selected.delete(id); });

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h2>Caja</h2>
                    <p class="muted">Marca <strong>Cobrado</strong> y se reparte solo con los % de Mis bolsitas.</p>
                </div>
            </div>

            <div class="caja-kpis">
                <div class="caja-kpi${pendingAll.length ? ' is-warn' : ''}">
                    <div class="caja-kpi-n">${pendingAll.length}</div>
                    <div class="caja-kpi-l">Por cobrar · ${Calc.fmtMXN((kpi.porCobrarAmt || 0) + (kpi.porAsignarAmt || 0))}</div>
                </div>
                <div class="caja-kpi">
                    <div class="caja-kpi-n">${kpi.asignadoN || 0}</div>
                    <div class="caja-kpi-l">Ya cobrados</div>
                </div>
            </div>

            <div class="dash-seg caja-tabs" role="tablist" aria-label="Filtro Caja">
                <button type="button" class="dash-seg-btn${showPending ? ' active' : ''}"
                    data-caja-filter="pendiente" role="tab" aria-selected="${showPending}">
                    Por cobrar${pendingAll.length ? ` (${pendingAll.length})` : ''}
                </button>
                <button type="button" class="dash-seg-btn${!showPending ? ' active' : ''}"
                    data-caja-filter="hecho" role="tab" aria-selected="${!showPending}">
                    Historial${historial.length ? ` (${historial.length})` : ''}
                </button>
            </div>

            ${layToolbar(pending, todayRows)}

            ${showPending ? (
                rows.length ? `
                    <ol class="caja-timeline">
                        ${rows.slice(0, 80).map(r => layTimelineItem(r, { pending: true })).join('')}
                    </ol>
                ` : `
                    <div class="card caja-empty">
                        <p class="muted">${q
                            ? 'Nada coincide con ese filtro.'
                            : 'Nada por cobrar. Las ventas nuevas aparecen aquí.'}</p>
                    </div>
                `
            ) : (
                rows.length ? `
                    <div class="caja-hist card">
                        <div class="caja-hist-head">
                            <span>Fecha</span>
                            <span>SKU</span>
                            <span>Monto</span>
                        </div>
                        <ul class="caja-hist-list">
                            ${rows.slice(0, 80).map(r => layTimelineItem(r, { pending: false })).join('')}
                        </ul>
                    </div>
                ` : `
                    <div class="card caja-empty">
                        <p class="muted">${q ? 'Nada coincide con ese filtro.' : 'Aún no hay cobros.'}</p>
                    </div>
                `
            )}
        `;

        bind(root, { pending, todayRows });
    }

    function bind(root, { pending, todayRows }) {
        root.querySelectorAll('[data-caja-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                local.filter = btn.getAttribute('data-caja-filter') || 'pendiente';
                local.selected.clear();
                render();
            });
        });

        const qEl = root.querySelector('#caja-q');
        if (qEl) {
            qEl.addEventListener('input', () => {
                local.q = qEl.value || '';
                // Re-render suave: guarda foco
                const start = qEl.selectionStart;
                render();
                const again = document.getElementById('caja-q');
                if (again) {
                    again.focus();
                    try { again.setSelectionRange(start, start); } catch { /* ignore */ }
                }
            });
        }

        root.querySelectorAll('[data-caja-pick]').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.value;
                if (cb.checked) local.selected.add(id);
                else local.selected.delete(id);
                render();
            });
        });

        root.querySelectorAll('[data-caja-cobrado]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const ok = markCobrado(
                    btn.getAttribute('data-lote'),
                    btn.getAttribute('data-venta'),
                    Number(btn.getAttribute('data-amount')) || 0,
                );
                if (ok) {
                    local.selected.delete(btn.getAttribute('data-venta'));
                    window.State.save();
                    window.App?.refreshNavCounts?.();
                    UI.toast(`Cobrado · ${Calc.fmtMXN(Number(btn.getAttribute('data-amount')) || 0)} → bolsitas`);
                    if (window.State.view === 'dashboard') DashboardView.render();
                    render();
                }
            });
        });

        root.querySelector('[data-caja-hoy]')?.addEventListener('click', () => {
            markMany(todayRows);
        });

        root.querySelector('[data-caja-selected]')?.addEventListener('click', () => {
            const picked = pending.filter(r => local.selected.has(r.ventaId));
            markMany(picked);
        });
    }

    function init() {
        window.State.subscribe(() => {
            if (window.State.view === 'caja') render();
        });
    }

    return {
        init,
        render,
        open,
        pendingCount,
    };
})();
window.CajaView = CajaView;
