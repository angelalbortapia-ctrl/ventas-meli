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
        freightForm: null, // 'charge' | 'payment' | null
        freightSaving: false,
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

    function shortName(s, n = 28) {
        const t = String(s || '').trim();
        if (t.length <= n) return t;
        return `${t.slice(0, n - 1)}…`;
    }

    function restockPicksForCaja(reinversion) {
        const mp = window.State.marketplace === 'amazon' ? 'amazon' : 'meli';
        const tagged = (window.State.lotes || []).map(l => ({ ...l, _mp: mp }));
        const plan = Calc.collectRestockPlan?.(tagged, {
            [mp]: window.State.settings || {},
        }) || { buy: [], cashBuy: 0 };
        let left = Math.max(0, Number(reinversion) || 0);
        const picks = [];
        for (const item of plan.buy || []) {
            const costo = Number(item.costo) || 0;
            if (!(costo > 0) || !(item.suggestUds > 0) || left < costo) continue;
            const maxUds = Math.min(item.suggestUds, Math.floor(left / costo));
            if (maxUds < 1) continue;
            const fitCash = maxUds * costo;
            picks.push({ ...item, fitUds: maxUds, fitCash });
            left = Math.round((left - fitCash) * 100) / 100;
            if (picks.length >= 3) break;
        }
        return { plan, picks, spend: picks.reduce((s, p) => s + p.fitCash, 0) };
    }

    function layReinversionBuyCard() {
        const alloc = readAlloc();
        const reinversion = Number(alloc.buckets?.reinversion) || 0;
        const { plan, picks, spend } = restockPicksForCaja(reinversion);
        const lead = reinversion > 0
            ? (picks.length
                ? `Puedes comprar hasta <strong class="mono">${Calc.fmtMXN(spend)}</strong> con Reinversión`
                : ((plan.buy || []).length
                    ? `Reinversión <strong class="mono">${Calc.fmtMXN(reinversion)}</strong> · sugerido ${Calc.fmtMXN(plan.cashBuy)} (arriba del saldo)`
                    : `Reinversión <strong class="mono">${Calc.fmtMXN(reinversion)}</strong> · sin SKUs urgentes`))
            : `Reinversión <strong class="mono">${Calc.fmtMXN(0)}</strong> · cobra ventas para llenarla`;

        return `
            <section class="card caja-reinvest">
                <div class="caja-reinvest-head">
                    <div>
                        <p class="caja-reinvest-kicker">Reinversión</p>
                        <p class="caja-reinvest-lead">${lead}</p>
                    </div>
                    <button type="button" class="btn ghost btn-sm" data-caja-goto-lotes>Productos</button>
                </div>
                ${picks.length ? `
                    <ul class="caja-reinvest-list">
                        ${picks.map(p => `
                            <li>
                                <button type="button" class="caja-reinvest-row" data-caja-restock="${esc(p.lote.id)}" data-caja-uds="${p.fitUds}">
                                    <span class="caja-reinvest-name">${esc(shortName(p.lote.producto || p.lote.sku))}</span>
                                    <span class="muted small">${esc(p.reason)} · +${p.fitUds} ud · ${Calc.fmtMXN(p.fitCash)}</span>
                                </button>
                                <button type="button" class="btn primary btn-sm" data-caja-restock="${esc(p.lote.id)}" data-caja-uds="${p.fitUds}">Reponer ${p.fitUds}</button>
                            </li>
                        `).join('')}
                    </ul>
                ` : `
                    <p class="muted small caja-reinvest-empty">Marca cobros arriba: el % de Reinversión alimenta esta lista.</p>
                `}
            </section>
        `;
    }

    function loteLabel(loteId) {
        if (!loteId) return '';
        const lote = (window.State.lotes || []).find(l => String(l.id) === String(loteId));
        if (!lote) return 'Lote eliminado';
        const name = lote.producto || 'Producto';
        const sku = lote.sku ? ` · ${lote.sku}` : '';
        const v = lote.variante ? ` · ${lote.variante}` : '';
        return `${name}${v}${sku}`;
    }

    function fbaLoteOptionsHtml(selected = '') {
        const lotes = (window.State.lotes || [])
            .filter(l => String(l.tipo || '').toUpperCase() === 'FBA')
            .slice()
            .sort((a, b) => String(a.producto || '').localeCompare(String(b.producto || ''), 'es'));
        const opts = lotes.map(l => {
            const label = `${l.producto || 'Producto'}${l.variante ? ` · ${l.variante}` : ''} (${l.sku || 'sin SKU'})`;
            const sel = String(l.id) === String(selected) ? ' selected' : '';
            return `<option value="${esc(l.id)}"${sel}>${esc(label)}</option>`;
        }).join('');
        return `<option value="">Sin vincular a un lote</option>${opts}`;
    }

    function fmtFreightDate(at) {
        try {
            return new Date(at).toLocaleDateString('es-MX', {
                year: 'numeric', month: 'short', day: 'numeric',
            });
        } catch {
            return '';
        }
    }

    /** Deuda flete inbound FBA — solo Amazon. */
    function layFreightDebt() {
        if (window.State.marketplace !== 'amazon' || !window.Freight) return '';
        const state = Freight.readFreight();
        const totals = Freight.freightTotals(state);
        const sorted = state.ledger.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
        const formMode = local.freightForm;

        const formHtml = formMode === 'charge' ? `
            <form class="caja-freight-form" id="caja-freight-form" data-mode="charge">
                <div class="caja-freight-form-grid">
                    <label>
                        <span>Monto del cargo (MXN)</span>
                        <input type="number" min="0.01" step="0.01" name="amount" required placeholder="ej. 130" inputmode="decimal">
                    </label>
                    <label>
                        <span>Nota (opcional)</span>
                        <input type="text" name="note" maxlength="120" placeholder="histórico inbound, envío marzo…">
                    </label>
                    <label class="caja-freight-form-full">
                        <span>Lote FBA (opcional)</span>
                        <select name="loteId">${fbaLoteOptionsHtml()}</select>
                    </label>
                    <label class="caja-freight-form-full caja-freight-check">
                        <input type="checkbox" name="allocateCost">
                        <span>Repartir al costo/ud del lote</span>
                    </label>
                </div>
                <div class="caja-freight-form-actions">
                    <button type="submit" class="btn primary btn-sm">Guardar cargo</button>
                    <button type="button" class="btn ghost btn-sm" data-freight-cancel>Cancelar</button>
                </div>
            </form>
        ` : formMode === 'payment' ? `
            <form class="caja-freight-form" id="caja-freight-form" data-mode="payment">
                <div class="caja-freight-form-grid">
                    <label>
                        <span>Monto que pagaste (MXN)</span>
                        <input type="number" min="0.01" step="0.01" name="amount" required placeholder="ej. 130" inputmode="decimal">
                    </label>
                    <label>
                        <span>Nota (opcional)</span>
                        <input type="text" name="note" maxlength="120" placeholder="pago tarjeta, descuento en payout…">
                    </label>
                </div>
                <p class="muted small" style="margin:0 0 8px">Saldo actual: ${Calc.fmtMXN(totals.balanceDisplay)}. El pago baja lo que le debes.</p>
                <div class="caja-freight-form-actions">
                    <button type="submit" class="btn primary btn-sm">Registrar pago</button>
                    <button type="button" class="btn ghost btn-sm" data-freight-cancel>Cancelar</button>
                </div>
            </form>
        ` : '';

        const listHtml = sorted.length ? `
            <ul class="caja-freight-list">
                ${sorted.map(e => {
                    const isCharge = e.type === 'charge';
                    const loteTxt = isCharge && e.loteId ? loteLabel(e.loteId) : '';
                    return `
                        <li class="caja-freight-row caja-freight-${esc(e.type)}">
                            <div class="caja-freight-row-main">
                                <span class="caja-freight-badge">${isCharge ? 'Cargo' : 'Pago'}</span>
                                <span class="caja-freight-amt">${isCharge ? '+' : '−'}${Calc.fmtMXN(e.amount)}</span>
                                <span class="caja-freight-date muted small">${esc(fmtFreightDate(e.at))}</span>
                            </div>
                            <div class="caja-freight-row-meta muted small">
                                ${e.note ? `<span>${esc(e.note)}</span>` : ''}
                                ${loteTxt ? `<span>${esc(loteTxt)}</span>` : ''}
                                ${e.allocatedCost ? '<span>En costo/ud</span>' : ''}
                                ${!e.note && !loteTxt && !e.allocatedCost ? '<span>—</span>' : ''}
                            </div>
                            <div class="caja-freight-row-actions">
                                ${isCharge && e.loteId && !e.allocatedCost ? `
                                    <button type="button" class="btn ghost btn-sm" data-freight-alloc="${esc(e.id)}">→ Costo/ud</button>
                                ` : ''}
                                <button type="button" class="btn ghost btn-sm"
                                    data-freight-del="${esc(e.id)}" aria-label="Eliminar movimiento">Eliminar</button>
                            </div>
                        </li>
                    `;
                }).join('')}
            </ul>
        ` : `
            <p class="muted small caja-freight-empty-hint">
                Si Amazon ya te cobró envíos inbound, registra un cargo con el total (ej. $130).
            </p>
        `;

        return `
            <section class="card caja-freight" id="caja-freight" aria-label="Deuda de envío a FBA">
                <div class="caja-freight-head">
                    <div>
                        <p class="caja-freight-kicker">Amazon FBA</p>
                        <p class="caja-freight-title">Deuda envío a FBA</p>
                        <p class="muted small" style="margin:4px 0 0">
                            Flete de mandar inventario al almacén. Opcional: repartirlo al costo/ud.
                        </p>
                    </div>
                    <div class="caja-freight-kpi${totals.balanceDisplay > 0 ? ' is-owe' : ''}">
                        <div class="caja-freight-kpi-label">Le debes a Amazon</div>
                        <div class="caja-freight-kpi-value"${UI.fxAttrs?.(totals.balanceDisplay, 'mxn') || ''}>${Calc.fmtMXN(totals.balanceDisplay)}</div>
                        <div class="caja-freight-kpi-sub muted small">
                            Cargos ${Calc.fmtMXN(totals.charges)} · Pagos ${Calc.fmtMXN(totals.payments)}
                        </div>
                    </div>
                </div>
                <div class="caja-freight-actions">
                    <button type="button" class="btn primary btn-sm" data-freight-open="charge">+ Cargo</button>
                    <button type="button" class="btn btn-sm" data-freight-open="payment"${totals.balanceDisplay > 0 ? '' : ' disabled'}>+ Pago</button>
                </div>
                ${formHtml}
                ${listHtml}
            </section>
        `;
    }

    function bindFreight(root) {
        root.querySelectorAll('[data-freight-open]').forEach(btn => {
            btn.addEventListener('click', () => {
                local.freightForm = btn.dataset.freightOpen === 'payment' ? 'payment' : 'charge';
                render();
                document.querySelector('#caja-freight-form input[name="amount"]')?.focus();
            });
        });
        root.querySelectorAll('[data-freight-cancel]').forEach(btn => {
            btn.addEventListener('click', () => {
                local.freightForm = null;
                render();
            });
        });
        const form = root.querySelector('#caja-freight-form');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            if (local.freightSaving) return;
            local.freightSaving = true;
            const submitBtn = form.querySelector('[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;
            const mode = form.dataset.mode;
            const amount = Freight.parseMoney(form.querySelector('[name="amount"]')?.value);
            const note = form.querySelector('[name="note"]')?.value || '';
            try {
                if (mode === 'payment') {
                    const entry = Freight.addPayment({ amount, note });
                    UI.toast(`Pago ${Calc.fmtMXN(entry.amount)} registrado`);
                } else {
                    const loteId = form.querySelector('[name="loteId"]')?.value || null;
                    const allocateCost = !!form.querySelector('[name="allocateCost"]')?.checked;
                    if (allocateCost && !loteId) {
                        throw new Error('Elige un lote FBA para repartir al costo');
                    }
                    const entry = Freight.addCharge({ amount, note, loteId, allocateCost });
                    UI.toast(allocateCost
                        ? `Cargo ${Calc.fmtMXN(entry.amount)} · sumado al costo/ud`
                        : `Cargo ${Calc.fmtMXN(entry.amount)} registrado`);
                }
                local.freightForm = null;
                render();
                if (window.State.view === 'dashboard') DashboardView?.render?.();
            } catch (err) {
                UI.toast(err.message || 'No se pudo guardar', 'error');
                if (submitBtn) submitBtn.disabled = false;
            } finally {
                local.freightSaving = false;
            }
        });
        root.querySelectorAll('[data-freight-alloc]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await UI.confirm({
                    title: 'Repartir flete al costo/ud',
                    message: 'Suma (monto ÷ unidades del lote) al costo unitario. No se puede deshacer desde aquí.',
                    primaryLabel: 'Sumar al costo',
                });
                if (!ok) return;
                try {
                    const res = Freight.allocateChargeToLoteCost(btn.dataset.freightAlloc);
                    UI.toast(`+${Calc.fmtMXN(res.perUnit)}/ud → costo ${Calc.fmtMXN(res.nextCosto)}`);
                    render();
                    if (window.State.view === 'lotes') LotesView?.render?.();
                } catch (err) {
                    UI.toast(err.message || 'No se pudo repartir', 'error');
                }
            });
        });
        root.querySelectorAll('[data-freight-del]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await UI.confirm({
                    title: 'Eliminar movimiento',
                    message: 'Se quita de la deuda de envío a FBA. No se puede deshacer.',
                    primaryLabel: 'Eliminar',
                    danger: true,
                });
                if (!ok) return;
                if (Freight.removeEntry(btn.dataset.freightDel)) {
                    UI.toast('Movimiento eliminado');
                    render();
                    if (window.State.view === 'dashboard') DashboardView?.render?.();
                }
            });
        });
    }

    function focusFreight() {
        const el = document.getElementById('caja-freight');
        if (!el) return false;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('is-flash');
        setTimeout(() => el.classList.remove('is-flash'), 1200);
        return true;
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

    function celebrateCobro() {
        UI.playMoneySound?.();
        UI.burstConfetti?.({ intensity: 'light' });
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
            celebrateCobro();
            UI.toast(
                `${n} cobrada${n === 1 ? '' : 's'} · ${Calc.fmtMXN(total)} → bolsitas`,
                'success',
                { pulse: true },
            );
        } else {
            UI.toast('No se pudo cobrar ninguna', 'error');
        }
        render();
    }

    function layToolbar(pendingVisible, todayRows) {
        const mp = Data.currentMarketplace();
        const mpLabel = Data.mpBrand(mp);
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
                    <div class="caja-kpi-n"${UI.fxAttrs?.(pendingAll.length, 'int') || ''}>${pendingAll.length}</div>
                    <div class="caja-kpi-l">Por cobrar · <span${UI.fxAttrs?.(kpi.pendingSaleAmt || 0, 'mxn') || ''}>${Calc.fmtMXN(kpi.pendingSaleAmt || 0)}</span></div>
                    <div class="caja-kpi-sub muted small">A repartir en bolsitas ${Calc.fmtMXN(kpi.pendingRepartirAmt || 0)} <span class="caja-kpi-hint">(venta − fees)</span></div>
                </div>
                <div class="caja-kpi">
                    <div class="caja-kpi-n"${UI.fxAttrs?.(kpi.asignadoN || 0, 'int') || ''}>${kpi.asignadoN || 0}</div>
                    <div class="caja-kpi-l">Ya cobrados · <span${UI.fxAttrs?.(kpi.asignadoSaleAmt || 0, 'mxn') || ''}>${Calc.fmtMXN(kpi.asignadoSaleAmt || 0)}</span></div>
                    ${(kpi.asignadoAmt || 0) > 0.009
                        ? `<div class="caja-kpi-sub muted small">En bolsitas ${Calc.fmtMXN(kpi.asignadoAmt || 0)}</div>`
                        : ''}
                </div>
            </div>

            ${layReinversionBuyCard()}
            ${layFreightDebt()}

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
        bindFreight(root);
        UI.countUp?.(root);
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
                    celebrateCobro();
                    UI.toast(
                        `Cobrado · ${Calc.fmtMXN(Number(btn.getAttribute('data-amount')) || 0)} → bolsitas`,
                        'success',
                        { pulse: true },
                    );
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

        root.querySelector('[data-caja-goto-lotes]')?.addEventListener('click', () => {
            window.App?.switchTab?.('lotes');
        });

        root.querySelectorAll('[data-caja-restock]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-caja-restock');
                const uds = Number(btn.getAttribute('data-caja-uds')) || 1;
                if (!id) return;
                await window.LotesView?.restock?.(id, { uds });
            });
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
        focusFreight,
    };
})();
window.CajaView = CajaView;
