/* ==========================================================================
   Vista Envíos (Amazon)
   - FBA: inventario que TÚ mandas al almacén Amazon (inbound)
   - FBM: pedidos que TÚ mandas al cliente
   ========================================================================== */

const EnviosView = (() => {

    const FBM_LABELS = {
        por_preparar: 'Por empaquetar',
        empaquetado: 'Empaquetado',
        etiqueta: 'Con etiqueta',
        listo: 'Listo para llevar',
        enviado: 'Enviado al cliente',
    };
    const FBA_LABELS = {
        creando: 'Creando envío',
        por_enviar: 'Por enviar a FBA',
        en_transito: 'En tránsito',
        recibido: 'Recibido en FBA',
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
        creando: 'Por enviar a FBA',
        por_enviar: 'En tránsito',
        en_transito: 'Recibido en FBA',
    };
    const NEXT_BTN_FBM = {
        por_preparar: 'Ya empaqueté',
        empaquetado: 'Ya puse etiqueta',
        etiqueta: 'Listo para mañana',
        listo: 'Ya lo envié',
    };
    const ORDER_FBA = { creando: 0, por_enviar: 1, en_transito: 2, recibido: 3 };
    const ORDER_FBM = { por_preparar: 0, empaquetado: 1, etiqueta: 2, listo: 3, enviado: 4 };

    const local = { showDone: false };

    function esc(s) {
        return UI.escapeHTML(String(s ?? ''));
    }

    function isEnabled() {
        if (window.State.marketplace !== 'amazon') return false;
        return window.State.settings?.prepEnvioActivo !== false;
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

        if (!isEnabled()) {
            root.innerHTML = `
                <div class="view-head">
                    <div>
                        <h2>Envíos</h2>
                        <p class="muted">FBA (a Amazon) y FBM (al cliente).</p>
                    </div>
                </div>
                <div class="card envios-off">
                    <p><strong>Esta función está apagada.</strong></p>
                    <p class="muted">Actívala en Ajustes → Tarifas Amazon → <em>Preparación de envíos</em>.</p>
                    <button type="button" class="btn primary btn-sm" id="envios-goto-settings">Ir a Ajustes</button>
                </div>
            `;
            document.getElementById('envios-goto-settings')?.addEventListener('click', () => {
                window.App?.switchTab?.('settings');
            });
            return;
        }

        const fbaPending = collectFbaInbound();
        const fbmPending = collectFbmSales();
        const fbaDone = local.showDone
            ? collectFbaInbound({ includeDone: true }).filter(r => r.estado === 'recibido').slice(0, 20)
            : [];
        const fbmDone = local.showDone
            ? collectFbmSales({ includeEnviado: true }).filter(r => r.estado === 'enviado').slice(0, 20)
            : [];

        const unmarkedFba = (window.State.lotes || []).filter(l =>
            String(l.tipo || '').toUpperCase() === 'FBA' && !l.fbaInboundEstado
        );
        const unmarkedFbm = [];
        (window.State.lotes || []).forEach(lote => {
            if (String(lote.tipo || '').toUpperCase() === 'FBA') return;
            (lote.ventas || []).forEach(v => {
                if (!v.envioEstado) unmarkedFbm.push({ lote, venta: v });
            });
        });

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h2>Envíos</h2>
                    <p class="muted"><strong>FBA</strong> = tú mandas stock a Amazon · <strong>FBM</strong> = tú mandas al cliente</p>
                </div>
                <div class="view-actions">
                    <button type="button" class="btn ghost btn-sm" id="envios-toggle-done">
                        ${local.showDone ? 'Ocultar enviados' : 'Ver enviados'}
                    </button>
                    <button type="button" class="btn ghost btn-sm" id="envios-disable">Apagar envíos</button>
                </div>
            </div>

            <div class="envios-stats">
                <div class="envios-stat">
                    <div class="envios-stat-n">${fbaPending.length}</div>
                    <div class="envios-stat-l">A FBA (pendientes)</div>
                </div>
                <div class="envios-stat">
                    <div class="envios-stat-n">${fbmPending.length}</div>
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
        `;

        bind(root);
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
                message: 'Se oculta esta vista. Puedes volver a activarla en Ajustes.',
                primaryLabel: 'Apagar',
            });
            if (!ok) return;
            window.State.settings.prepEnvioActivo = false;
            window.State.saveSettings();
            window.App?.refreshMarketplaceChrome?.();
            window.App?.refreshNavCounts?.();
            SettingsView.loadIntoForm?.();
            UI.toast('Envíos apagado');
            window.App?.switchTab?.('lotes');
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

    return { render, init, pendingCount, isEnabled };
})();
window.EnviosView = EnviosView;