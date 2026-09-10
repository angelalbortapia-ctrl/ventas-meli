/* ==========================================================================
   Vista Envíos (Amazon)
   - FBA: inventario que TÚ mandas al almacén Amazon (inbound)
   - FBM: pedidos que TÚ mandas al cliente
   ========================================================================== */

const EnviosView = (() => {

    const FBM_LABELS = {
        por_preparar: '📦 Por empaquetar',
        empaquetado: '📦 Empaquetado',
        etiqueta: '🏷 Con etiqueta',
        listo: '📬 Listo para llevar',
        enviado: '✅ Enviado al cliente',
    };
    const FBA_LABELS = {
        creando: '📝 Creando envío',
        por_enviar: '📤 Por enviar a FBA',
        en_transito: '🚚 En tránsito',
        recibido: '✅ Recibido en FBA',
    };
    const NEXT_FBA = {
        creando: 'por_enviar',
        por_enviar: 'en_transito',
        en_transito: 'recibido',
    };
    const NEXT_FBM = {
        por_preparar: 'empaquetado',
        empaquetado: 'etiqueta',
        etiqueta: 'listo',
        listo: 'enviado',
    };
    const NEXT_BTN_FBA = {
        creando: '📤 Por enviar a FBA',
        por_enviar: '🚚 En tránsito',
        en_transito: '✅ Recibido en FBA',
    };
    const NEXT_BTN_FBM = {
        por_preparar: '📦 Ya empaqueté',
        empaquetado: '🏷 Ya puse etiqueta',
        etiqueta: '📬 Listo para mañana',
        listo: '✅ Ya lo envié',
    };
    const ORDER_FBA = { creando: 0, por_enviar: 1, en_transito: 2, recibido: 3 };
    const ORDER_FBM = { por_preparar: 0, empaquetado: 1, etiqueta: 2, listo: 3, enviado: 4 };

    const local = { showDone: false, freightForm: null, freightSaving: false }; // form: 'charge' | 'payment' | null

    function esc(s) {
        return UI.escapeHTML(String(s ?? ''));
    }

    const round2 = (...a) => Freight.round2(...a);
    const parseMoney = (...a) => Freight.parseMoney(...a);
    const readFreight = (...a) => Freight.readFreight(...a);
    const writeFreight = (...a) => Freight.writeFreight(...a);
    const freightTotals = (...a) => Freight.freightTotals(...a);
    const balance = (...a) => Freight.balance(...a);
    const addCharge = (...a) => Freight.addCharge(...a);
    const addPayment = (...a) => Freight.addPayment(...a);
    const removeEntry = (...a) => Freight.removeEntry(...a);

    /** Colas FBA/FBM (prep). La deuda de flete vive aparte. */
    function isEnabled() {
        if (window.State.marketplace !== 'amazon') return false;
        return window.State.settings?.prepEnvioActivo !== false;
    }

    /** Vista Envíos disponible en Amazon (deuda aunque prep esté apagada). */
    function canOpen() {
        return window.State.marketplace === 'amazon';
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

    function layFreightDebt() {
        const state = readFreight();
        const totals = freightTotals(state);
        const sorted = state.ledger.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
        const formMode = local.freightForm;

        const formHtml = formMode === 'charge' ? `
            <form class="envios-freight-form" id="envios-freight-form" data-mode="charge">
                <div class="envios-freight-form-grid">
                    <label>
                        <span>Monto del cargo (MXN)</span>
                        <input type="number" min="0.01" step="0.01" name="amount" required placeholder="ej. 130" inputmode="decimal">
                    </label>
                    <label>
                        <span>Nota (opcional)</span>
                        <input type="text" name="note" maxlength="120" placeholder="histórico inbound, envío marzo…">
                    </label>
                    <label class="envios-freight-form-full">
                        <span>Lote FBA (opcional)</span>
                        <select name="loteId">${fbaLoteOptionsHtml()}</select>
                    </label>
                    <label class="envios-freight-form-full envios-freight-check">
                        <input type="checkbox" name="allocateCost">
                        <span>Repartir al costo/ud del lote (sube <code>costo</code> del producto)</span>
                    </label>
                </div>
                <div class="envios-freight-form-actions">
                    <button type="submit" class="btn primary btn-sm">Guardar cargo</button>
                    <button type="button" class="btn ghost btn-sm" data-freight-cancel>Cancelar</button>
                </div>
            </form>
        ` : formMode === 'payment' ? `
            <form class="envios-freight-form" id="envios-freight-form" data-mode="payment">
                <div class="envios-freight-form-grid">
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
                <div class="envios-freight-form-actions">
                    <button type="submit" class="btn primary btn-sm">Registrar pago</button>
                    <button type="button" class="btn ghost btn-sm" data-freight-cancel>Cancelar</button>
                </div>
            </form>
        ` : '';

        const listHtml = sorted.length ? `
            <ul class="envios-freight-list">
                ${sorted.map(e => {
                    const isCharge = e.type === 'charge';
                    const loteTxt = isCharge && e.loteId ? loteLabel(e.loteId) : '';
                    return `
                        <li class="envios-freight-row envios-freight-${esc(e.type)}">
                            <div class="envios-freight-row-main">
                                <span class="envios-freight-badge">${isCharge ? 'Cargo' : 'Pago'}</span>
                                <span class="envios-freight-amt">${isCharge ? '+' : '−'}${Calc.fmtMXN(e.amount)}</span>
                                <span class="envios-freight-date muted small">${esc(fmtFreightDate(e.at))}</span>
                            </div>
                            <div class="envios-freight-row-meta muted small">
                                ${e.note ? `<span>${esc(e.note)}</span>` : ''}
                                ${loteTxt ? `<span>${esc(loteTxt)}</span>` : ''}
                                ${e.allocatedCost ? '<span>En costo/ud</span>' : ''}
                                ${!e.note && !loteTxt && !e.allocatedCost ? '<span>—</span>' : ''}
                            </div>
                            <div class="envios-freight-row-actions">
                                ${isCharge && e.loteId && !e.allocatedCost ? `
                                    <button type="button" class="btn ghost btn-sm" data-freight-alloc="${esc(e.id)}">→ Costo/ud</button>
                                ` : ''}
                                <button type="button" class="btn ghost btn-sm envios-freight-del"
                                    data-freight-del="${esc(e.id)}" aria-label="Eliminar movimiento">Eliminar</button>
                            </div>
                        </li>
                    `;
                }).join('')}
            </ul>
        ` : `
            <p class="muted small envios-freight-empty-hint">
                Si Amazon ya te cobró envíos pasados, registra un cargo con el total (ej. $130).
            </p>
        `;

        return `
            <section class="envios-freight" aria-label="Deuda de envío a FBA">
                <div class="envios-freight-head">
                    <div>
                        <h3 class="envios-freight-title">Deuda envío a FBA</h3>
                        <p class="muted small" style="margin:0">
                            Flete de mandar inventario al almacén. Opcional: repartirlo al costo/ud del lote.
                        </p>
                    </div>
                    <div class="envios-freight-kpi${totals.balanceDisplay > 0 ? ' is-owe' : ''}">
                        <div class="envios-freight-kpi-label">Le debes a Amazon</div>
                        <div class="envios-freight-kpi-value"${UI.fxAttrs?.(totals.balanceDisplay, 'mxn') || ''}>${Calc.fmtMXN(totals.balanceDisplay)}</div>
                        <div class="envios-freight-kpi-sub muted small">
                            Cargos ${Calc.fmtMXN(totals.charges)} · Pagos ${Calc.fmtMXN(totals.payments)}
                        </div>
                    </div>
                </div>
                <div class="envios-freight-actions">
                    <button type="button" class="btn primary btn-sm" data-freight-open="charge">+ Cargo de envío</button>
                    <button type="button" class="btn btn-sm" data-freight-open="payment">+ Pago</button>
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
                document.querySelector('#envios-freight-form input[name="amount"]')?.focus();
            });
        });
        root.querySelectorAll('[data-freight-cancel]').forEach(btn => {
            btn.addEventListener('click', () => {
                local.freightForm = null;
                render();
            });
        });
        const form = root.querySelector('#envios-freight-form');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            if (local.freightSaving) return;
            local.freightSaving = true;
            const submitBtn = form.querySelector('[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;
            const mode = form.dataset.mode;
            const amount = parseMoney(form.querySelector('[name="amount"]')?.value);
            const note = form.querySelector('[name="note"]')?.value || '';
            try {
                if (mode === 'payment') {
                    const entry = addPayment({ amount, note });
                    UI.toast(`Pago ${Calc.fmtMXN(entry.amount)} registrado`);
                } else {
                    const loteId = form.querySelector('[name="loteId"]')?.value || null;
                    const allocateCost = !!form.querySelector('[name="allocateCost"]')?.checked;
                    if (allocateCost && !loteId) {
                        throw new Error('Elige un lote FBA para repartir al costo');
                    }
                    const entry = addCharge({ amount, note, loteId, allocateCost });
                    UI.toast(allocateCost
                        ? `Cargo ${Calc.fmtMXN(entry.amount)} · sumado al costo/ud`
                        : `Cargo ${Calc.fmtMXN(entry.amount)} registrado`);
                }
                local.freightForm = null;
                render();
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
                if (removeEntry(btn.dataset.freightDel)) {
                    UI.toast('Movimiento eliminado');
                    render();
                }
            });
        });
    }

    function collectFbaInbound({ includeDone = false } = {}) {
        const rows = [];
        (window.State.lotes || []).forEach(lote => {
            if (String(lote.tipo || '').toUpperCase() !== 'FBA') return;
            const estado = lote.fbaInboundEstado || '';
            if (!estado) return;
            if (!includeDone && estado === 'recibido') return;
            rows.push({ kind: 'fba', lote, estado, sort: ORDER_FBA[estado] ?? 9 });
        });
        rows.sort((a, b) => a.sort - b.sort || String(a.lote.sku).localeCompare(String(b.lote.sku)));
        return rows;
    }

    function collectFbmSales({ includeEnviado = false } = {}) {
        const rows = [];
        (window.State.lotes || []).forEach(lote => {
            if (String(lote.tipo || '').toUpperCase() === 'FBA') return;
            (lote.ventas || []).forEach(v => {
                const estado = v.envioEstado || '';
                if (!estado) return;
                if (!includeEnviado && estado === 'enviado') return;
                rows.push({
                    kind: 'fbm',
                    lote,
                    venta: v,
                    estado,
                    sort: ORDER_FBM[estado] ?? 9,
                });
            });
        });
        rows.sort((a, b) => {
            if (a.sort !== b.sort) return a.sort - b.sort;
            return String(b.venta.fecha || '').localeCompare(String(a.venta.fecha || ''));
        });
        return rows;
    }

    function pendingCount() {
        if (!isEnabled()) return 0;
        return collectFbaInbound().length + collectFbmSales().length;
    }

    function advanceFba(loteId, estado) {
        const l = window.State.lotes.find(x => x.id === loteId);
        if (!l || !Data.setLoteFbaInboundEstado) return;
        try {
            Data.setLoteFbaInboundEstado(l, estado);
            window.State.lotes = Data.upsertLote(window.State.lotes, l);
            window.State.save();
            render();
            window.App?.refreshNavCounts?.();
            UI.toast(FBA_LABELS[estado] || 'FBA actualizado');
        } catch (err) {
            UI.toast(err.message || 'Error', 'error');
        }
    }

    function advanceFbm(loteId, ventaId, estado) {
        const l = window.State.lotes.find(x => x.id === loteId);
        if (!l || !Data.setVentaEnvioEstado) return;
        try {
            Data.setVentaEnvioEstado(l, ventaId, estado);
            window.State.lotes = Data.upsertLote(window.State.lotes, l);
            window.State.save();
            render();
            window.App?.refreshNavCounts?.();
            UI.toast(FBM_LABELS[estado] || 'Envío actualizado');
        } catch (err) {
            UI.toast(err.message || 'Error', 'error');
        }
    }

    function markFba(loteId) {
        advanceFba(loteId, 'creando');
    }

    function markFbm(loteId, ventaId) {
        advanceFbm(loteId, ventaId, 'por_preparar');
    }

    function openProduct(lote) {
        if (window.LotesView?.selectAndGo) LotesView.selectAndGo(lote.id);
        else window.App?.switchTab?.('lotes');
    }

    function render() {
        const root = document.getElementById('view-envios');
        if (!root) return;

        if (!canOpen()) {
            root.innerHTML = `
                <div class="view-head">
                    <div>
                        <h2>Envíos</h2>
                        <p class="muted">Solo disponible en Amazon.</p>
                    </div>
                </div>`;
            return;
        }

        const prepOn = isEnabled();
        const fbaPending = prepOn ? collectFbaInbound() : [];
        const fbmPending = prepOn ? collectFbmSales() : [];
        const fbaDone = prepOn && local.showDone
            ? collectFbaInbound({ includeDone: true }).filter(r => r.estado === 'recibido').slice(0, 20)
            : [];
        const fbmDone = prepOn && local.showDone
            ? collectFbmSales({ includeEnviado: true }).filter(r => r.estado === 'enviado').slice(0, 20)
            : [];

        const unmarkedFba = prepOn
            ? (window.State.lotes || []).filter(l =>
                String(l.tipo || '').toUpperCase() === 'FBA' && !l.fbaInboundEstado
            )
            : [];
        const unmarkedFbm = [];
        if (prepOn) {
            (window.State.lotes || []).forEach(lote => {
                if (String(lote.tipo || '').toUpperCase() === 'FBA') return;
                (lote.ventas || []).forEach(v => {
                    if (!v.envioEstado) unmarkedFbm.push({ lote, venta: v });
                });
            });
        }

        const prepQueuesHtml = prepOn ? `
            <div class="envios-stats">
                <div class="envios-stat">
                    <div class="envios-stat-n"${UI.fxAttrs?.(fbaPending.length, 'int') || ''}>${fbaPending.length}</div>
                    <div class="envios-stat-l">A FBA (pendientes)</div>
                </div>
                <div class="envios-stat">
                    <div class="envios-stat-n"${UI.fxAttrs?.(fbmPending.length, 'int') || ''}>${fbmPending.length}</div>
                    <div class="envios-stat-l">Al cliente FBM</div>
                </div>
            </div>

            <h3 class="envios-sub">📦 A FBA · Amazon</h3>
            ${fbaPending.length ? `
                <div class="envios-list">${fbaPending.map(cardFba).join('')}</div>
            ` : `<div class="card envios-empty"><p class="muted small">Nada pendiente hacia FBA.</p></div>`}
            ${unmarkedFba.length ? `
                <p class="muted small" style="margin:10px 0 6px">Productos FBA sin marcar (${unmarkedFba.length})</p>
                <div class="envios-list envios-list-muted">
                    ${unmarkedFba.slice(0, 15).map(lote => `
                        <div class="envios-card envios-card-plain">
                            <div class="envios-card-main">
                                <div class="envios-card-title">${esc(lote.producto)}${lote.variante ? ` · ${esc(lote.variante)}` : ''}</div>
                                <div class="envios-card-meta"><code>${esc(lote.sku)}</code></div>
                            </div>
                            <button type="button" class="btn primary btn-sm" data-envios-mark-fba data-lote="${esc(lote.id)}">Creando envío</button>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <h3 class="envios-sub">🚚 Al cliente · FBM</h3>
            ${fbmPending.length ? `
                <div class="envios-list">${fbmPending.map(cardFbm).join('')}</div>
            ` : `<div class="card envios-empty"><p class="muted small">Nada pendiente al cliente.</p></div>`}
            ${unmarkedFbm.length ? `
                <p class="muted small" style="margin:10px 0 6px">Ventas FBM sin marcar (${unmarkedFbm.length})</p>
                <div class="envios-list envios-list-muted">
                    ${unmarkedFbm.slice(0, 15).map(({ lote, venta }) => `
                        <div class="envios-card envios-card-plain">
                            <div class="envios-card-main">
                                <div class="envios-card-title">${esc(lote.producto)}</div>
                                <div class="envios-card-meta">
                                    <code>${esc(lote.sku)}</code>
                                    <span>${Calc.fmtDate(venta.fecha)}</span>
                                    <span>${venta.unidades} ud</span>
                                </div>
                            </div>
                            <button type="button" class="btn primary btn-sm"
                                data-envios-mark-fbm data-lote="${esc(lote.id)}" data-venta="${esc(venta.id)}">Por enviar</button>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            ${local.showDone && (fbaDone.length || fbmDone.length) ? `
                <h3 class="envios-sub">Enviados recientes</h3>
                <div class="envios-list envios-list-muted">
                    ${fbaDone.map(cardFba).join('')}
                    ${fbmDone.map(r => cardFbm(r, true)).join('')}
                </div>
            ` : ''}
        ` : `
            <div class="card envios-off" style="margin-top:12px">
                <p><strong>Colas de preparación apagadas.</strong></p>
                <p class="muted small">La deuda de envío a FBA sigue activa arriba. Para ver pendientes FBA/FBM, activa Preparación de envíos en Ajustes.</p>
                <button type="button" class="btn primary btn-sm" id="envios-goto-settings">Ir a Ajustes</button>
            </div>
        `;

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h2>Envíos</h2>
                    <p class="muted"><strong>FBA</strong> = tú mandas stock a Amazon · <strong>FBM</strong> = tú mandas al cliente</p>
                </div>
                <div class="view-actions">
                    ${prepOn ? `
                        <button type="button" class="btn ghost btn-sm" id="envios-toggle-done">
                            ${local.showDone ? 'Ocultar enviados' : 'Ver enviados'}
                        </button>
                        <button type="button" class="btn ghost btn-sm" id="envios-disable">Apagar preparación</button>
                    ` : ''}
                </div>
            </div>
            ${layFreightDebt()}
            ${prepQueuesHtml}
        `;

        bind(root);
        UI.countUp?.(root);
        bindFreight(root);
        document.getElementById('envios-goto-settings')?.addEventListener('click', () => {
            window.App?.switchTab?.('settings');
        });
    }

    function cardFba(row) {
        const { lote, estado } = row;
        const next = NEXT_FBA[estado];
        const nextBtn = NEXT_BTN_FBA[estado];
        return `
            <div class="envios-card">
                <div class="envios-card-main">
                    <div class="envios-card-title">${esc(lote.producto)}${lote.variante ? ` · ${esc(lote.variante)}` : ''}</div>
                    <div class="envios-card-meta"><code>${esc(lote.sku)}</code><span>→ Amazon FBA</span></div>
                    <span class="ship-badge ship-${esc(estado)}">${esc(FBA_LABELS[estado] || estado)}</span>
                </div>
                <div class="envios-card-actions">
                    ${next && nextBtn ? `
                        <button type="button" class="btn primary btn-sm"
                            data-envios-adv-fba data-lote="${esc(lote.id)}" data-estado="${next}">${esc(nextBtn)}</button>
                    ` : ''}
                    <button type="button" class="btn ghost btn-sm" data-envios-open data-lote="${esc(lote.id)}">Ver producto</button>
                </div>
            </div>
        `;
    }

    function cardFbm(row, done = false) {
        const { lote, venta, estado } = row;
        const next = NEXT_FBM[estado];
        const nextBtn = NEXT_BTN_FBM[estado];
        return `
            <div class="envios-card">
                <div class="envios-card-main">
                    <div class="envios-card-title">${esc(lote.producto)}${lote.variante ? ` · ${esc(lote.variante)}` : ''}</div>
                    <div class="envios-card-meta">
                        <code>${esc(lote.sku)}</code>
                        <span>${Calc.fmtDate(venta.fecha)}</span>
                        <span>${venta.unidades} ud · ${Calc.fmtMXN(venta.precio * venta.unidades)}</span>
                    </div>
                    <span class="ship-badge ship-${esc(estado)}">${esc(FBM_LABELS[estado] || estado)}</span>
                </div>
                <div class="envios-card-actions">
                    ${!done && next && nextBtn ? `
                        <button type="button" class="btn primary btn-sm"
                            data-envios-adv-fbm data-lote="${esc(lote.id)}" data-venta="${esc(venta.id)}" data-estado="${next}">${esc(nextBtn)}</button>
                    ` : ''}
                    <button type="button" class="btn ghost btn-sm" data-envios-open data-lote="${esc(lote.id)}">Ver producto</button>
                </div>
            </div>
        `;
    }

    function bind(root) {
        document.getElementById('envios-toggle-done')?.addEventListener('click', () => {
            local.showDone = !local.showDone;
            render();
        });
        document.getElementById('envios-disable')?.addEventListener('click', async () => {
            const ok = await UI.confirm({
                title: 'Apagar preparación de envíos',
                message: 'Se ocultan las colas FBA/FBM. La deuda de envío a FBA sigue disponible aquí.',
                primaryLabel: 'Apagar preparación',
            });
            if (!ok) return;
            window.State.settings.prepEnvioActivo = false;
            window.State.saveSettings();
            window.App?.refreshMarketplaceChrome?.();
            window.App?.refreshNavCounts?.();
            SettingsView.loadIntoForm?.();
            UI.toast('Preparación de envíos apagada');
            render();
        });
        root.querySelectorAll('[data-envios-adv-fba]').forEach(btn => {
            btn.addEventListener('click', () => advanceFba(btn.dataset.lote, btn.dataset.estado));
        });
        root.querySelectorAll('[data-envios-adv-fbm]').forEach(btn => {
            btn.addEventListener('click', () => advanceFbm(btn.dataset.lote, btn.dataset.venta, btn.dataset.estado));
        });
        root.querySelectorAll('[data-envios-mark-fba]').forEach(btn => {
            btn.addEventListener('click', () => markFba(btn.dataset.lote));
        });
        root.querySelectorAll('[data-envios-mark-fbm]').forEach(btn => {
            btn.addEventListener('click', () => markFbm(btn.dataset.lote, btn.dataset.venta));
        });
        root.querySelectorAll('[data-envios-open]').forEach(btn => {
            btn.addEventListener('click', () => {
                const lote = window.State.lotes.find(l => l.id === btn.dataset.lote);
                if (lote) openProduct(lote);
            });
        });
    }

    function init() {}

    return {
        render,
        init,
        pendingCount,
        isEnabled,
        canOpen,
        readFreight,
        addCharge,
        addPayment,
        removeEntry,
        balance,
    };
})();
window.EnviosView = EnviosView;