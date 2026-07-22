/* ==========================================================================
   Dashboard — 10 layouts con DATA distinta (no temas de color).
   Navegación: 1–10 / ← →. Preferencia en State.ui.dashLayout.
   ========================================================================== */

const DashboardView = (() => {

    const LAYOUTS = [
        { id: 'resumen',   name: 'Resumen',     blurb: 'KPIs financieros del negocio' },
        { id: 'pyg',       name: 'P&G',         blurb: 'Ingresos, costos y fees' },
        { id: 'caja',      name: 'Caja',        blurb: 'Capital, cash in e inventario' },
        { id: 'portafolio',name: 'Portafolio',  blurb: 'Estrategia y distribución' },
        { id: 'accion',    name: 'Acción',      blurb: 'Qué hacer hoy' },
        { id: 'rotacion',  name: 'Rotación',    blurb: 'Stock lento y capital atrapado' },
        { id: 'ranking',   name: 'Ranking',     blurb: 'Utilidad, margen y ROI' },
        { id: 'ads',       name: 'Ads',         blurb: 'Gasto Ads vs tope CPA' },
        { id: 'ventas',    name: 'Ventas',      blurb: 'Actividad y unidades' },
        { id: 'versus',    name: 'Versus',      blurb: 'Mejores vs peores SKUs' },
    ];

    function currentLayout() {
        const n = Number(window.State.ui?.dashLayout);
        if (Number.isInteger(n) && n >= 0 && n < LAYOUTS.length) return n;
        return 0;
    }

    function setLayout(i) {
        const next = ((i % LAYOUTS.length) + LAYOUTS.length) % LAYOUTS.length;
        window.State.ui = { ...window.State.ui, dashLayout: next };
        window.State.saveUI();
        render();
    }

    function render() {
        const root = document.getElementById('dashboard-canvas');
        if (!root) return;

        const lotes = window.State.lotes || [];
        const idx = currentLayout();
        const layout = LAYOUTS[idx];
        const agg = Calc.aggregate(lotes, window.State.settings);
        const ctx = buildContext(agg, lotes);

        root.innerHTML = `
            <div class="dash-shell">
                <header class="dash-nav">
                    <div class="dash-nav-left">
                        <button type="button" class="btn btn-sm" data-dash-prev aria-label="Anterior">←</button>
                        <button type="button" class="btn btn-sm" data-dash-next aria-label="Siguiente">→</button>
                        <div class="dash-nav-title">
                            <strong>${idx + 1}/${LAYOUTS.length} · ${esc(layout.name)}</strong>
                            <span class="muted small">${esc(layout.blurb)}</span>
                        </div>
                    </div>
                    <div class="dash-nav-tabs" role="tablist" aria-label="Layouts del dashboard">
                        ${LAYOUTS.map((L, i) => `
                            <button type="button" role="tab"
                                class="dash-tab ${i === idx ? 'active' : ''}"
                                data-dash-layout="${i}"
                                aria-selected="${i === idx}"
                                title="${esc(L.blurb)}">${i + 1}. ${esc(L.name)}</button>
                        `).join('')}
                    </div>
                </header>
                <div class="dash-body" data-layout="${esc(layout.id)}">
                    ${lotes.length ? renderLayout(layout.id, ctx) : emptyState()}
                </div>
            </div>
        `;
        bind(root);
    }

    function buildContext(agg, lotes) {
        const { alerts } = InsightsView.analyze();
        const rows = agg.rows;

        let fees = 0;
        let costoVendido = 0;
        let gastoAds = 0;
        let utilidadLista = 0;
        rows.forEach(({ lote, calc }) => {
            const v = calc.vendidas;
            fees += (calc.comisionVariable + calc.cargoFijo + calc.retIVA + calc.retISR) * v;
            costoVendido += (Number(lote.costo) || 0) * v;
            gastoAds += calc.gastoAds;
            utilidadLista += calc.utilidad * (Number(lote.unidades) || 0);
        });

        const recentSales = [];
        lotes.forEach(lote => {
            (lote.ventas || []).forEach(v => {
                recentSales.push({
                    lote,
                    fecha: v.fecha,
                    unidades: Number(v.unidades) || 0,
                    precio: Number(v.precio) || 0,
                    total: (Number(v.unidades) || 0) * (Number(v.precio) || 0),
                });
            });
        });
        recentSales.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));

        return { agg, rows, alerts, fees, costoVendido, gastoAds, utilidadLista, recentSales };
    }

    function renderLayout(id, ctx) {
        switch (id) {
            case 'resumen': return layResumen(ctx);
            case 'pyg': return layPyG(ctx);
            case 'caja': return layCaja(ctx);
            case 'portafolio': return layPortafolio(ctx);
            case 'accion': return layAccion(ctx);
            case 'rotacion': return layRotacion(ctx);
            case 'ranking': return layRanking(ctx);
            case 'ads': return layAds(ctx);
            case 'ventas': return layVentas(ctx);
            case 'versus': return layVersus(ctx);
            default: return layResumen(ctx);
        }
    }

    /* ---------- 1. Resumen financiero ---------- */
    function layResumen({ agg, rows }) {
        const active = rows.filter(r => !['PAUSADA', 'FINALIZADA'].includes(r.calc.estrategia)).length;
        const avgTicket = agg.totalVendidas > 0 ? agg.cashIn / agg.totalVendidas : 0;
        const roiCap = agg.capitalDesplegado > 0 ? agg.gananciaRealizada / agg.capitalDesplegado : 0;
        return `
            <div class="dash-grid-kpi">
                ${kpi('Ganancia realizada', Calc.fmtMXN(agg.gananciaRealizada), tone(agg.gananciaRealizada), 'Neto cobrado − costos/fees')}
                ${kpi('Cash in', Calc.fmtMXN(agg.cashIn), '', `${agg.totalVendidas} uds vendidas`)}
                ${kpi('Capital desplegado', Calc.fmtMXN(agg.capitalDesplegado), '', `${agg.rows.length} lotes · ${agg.totalUds} uds`)}
                ${kpi('Inventario (costo)', Calc.fmtMXN(agg.valorInventario), '', 'Capital aún en stock')}
                ${kpi('Margen ponderado', Calc.fmtPct(agg.margenPonderado), '', 'Sobre precio de lista')}
                ${kpi('ROI sobre capital', Calc.fmtPct(roiCap), tone(roiCap), 'Ganancia / capital')}
                ${kpi('Ticket promedio', Calc.fmtMXN(avgTicket), '', 'Cash in / uds')}
                ${kpi('Lotes activos', String(active), '', `${agg.strategyCount.ESCALAR || 0} escalar · ${agg.strategyCount.LIQUIDAR || 0} liquidar`)}
            </div>
            <div class="dash-panel">
                <h3>Distribución de utilidad por SKU</h3>
                ${barChart(rows.map(r => ({
                    label: short(r.lote.producto, 22),
                    value: r.calc.gananciaRealizada,
                    meta: r.lote.variante || r.lote.sku || '',
                })).sort((a, b) => b.value - a.value).slice(0, 10), 'MXN')}
            </div>
        `;
    }

    /* ---------- 2. P&G ---------- */
    function layPyG({ agg, fees, costoVendido, gastoAds }) {
        const bruto = agg.cashIn - costoVendido;
        const neto = agg.gananciaRealizada;
        const lines = [
            { label: 'Ingresos (cash in)', value: agg.cashIn, sign: '+' },
            { label: '− Costo de lo vendido', value: -costoVendido, sign: '−' },
            { label: '= Utilidad bruta est.', value: bruto, sign: '=', bold: true },
            { label: '− Fees ML + retenciones (est.)', value: -fees, sign: '−' },
            { label: '− Gasto Ads', value: -gastoAds, sign: '−' },
            { label: '= Ganancia realizada', value: neto, sign: '=', bold: true },
        ];
        return `
            <div class="dash-split-2">
                <div class="dash-panel">
                    <h3>Estado de resultados (estimado)</h3>
                    <table class="dash-table">
                        <tbody>
                            ${lines.map(l => `
                                <tr class="${l.bold ? 'is-bold' : ''} ${tone(l.value)}">
                                    <td>${esc(l.label)}</td>
                                    <td class="num">${Calc.fmtMXN(l.value)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <p class="muted small" style="margin-top:12px">
                        Fees estimados con precio de cada venta cuando hay historial; Ads es gasto registrado por lote.
                    </p>
                </div>
                <div class="dash-panel">
                    <h3>Composición del cash in</h3>
                    ${stackBars([
                        { label: 'Costo vendido', value: costoVendido, cls: 'c-cost' },
                        { label: 'Fees est.', value: Math.max(0, fees), cls: 'c-fee' },
                        { label: 'Ads', value: gastoAds, cls: 'c-ads' },
                        { label: 'Ganancia', value: Math.max(0, neto), cls: 'c-gain' },
                    ], agg.cashIn)}
                    <div class="dash-mini-kpis">
                        ${mini('Margen lista', Calc.fmtPct(agg.margenPonderado))}
                        ${mini('Uds vendidas', String(agg.totalVendidas))}
                        ${mini('Fees / cash', agg.cashIn ? Calc.fmtPct(fees / agg.cashIn) : '—')}
                    </div>
                </div>
            </div>
        `;
    }

    /* ---------- 3. Caja ---------- */
    function layCaja({ agg, rows }) {
        const trapped = rows
            .filter(r => r.calc.inventarioRestante > 0)
            .reduce((s, r) => s + r.calc.valorInventario, 0);
        const liberable = rows
            .filter(r => r.calc.estrategia === 'LIQUIDAR')
            .reduce((s, r) => s + r.calc.valorInventario, 0);
        return `
            <div class="dash-grid-kpi dash-grid-kpi-4">
                ${kpi('Capital en juego', Calc.fmtMXN(agg.capitalDesplegado), '', 'Costo × unidades compradas')}
                ${kpi('Cash in cobrado', Calc.fmtMXN(agg.cashIn), 'pos', 'Dinero que ya entró')}
                ${kpi('En inventario', Calc.fmtMXN(agg.valorInventario), '', `${Calc.fmtPct(agg.capitalDesplegado ? agg.valorInventario / agg.capitalDesplegado : 0)} del capital`)}
                ${kpi('A liquidar (stock)', Calc.fmtMXN(liberable), liberable > 0 ? 'neg' : '', 'Capital en estrategia LIQUIDAR')}
            </div>
            <div class="dash-panel">
                <h3>Flujo: dónde está el dinero</h3>
                ${stackBars([
                    { label: 'Ya cobrado (cash in)', value: agg.cashIn, cls: 'c-gain' },
                    { label: 'Atrapado en stock', value: trapped, cls: 'c-cost' },
                    { label: 'Ganancia realizada', value: Math.max(0, agg.gananciaRealizada), cls: 'c-fee' },
                ], Math.max(agg.cashIn + trapped, 1))}
            </div>
            <div class="dash-panel">
                <h3>Capital por lote (top 12)</h3>
                ${barChart(rows.map(r => ({
                    label: short(r.lote.producto, 20),
                    value: r.calc.inversion,
                    meta: `${r.calc.inventarioRestante} en stock`,
                })).sort((a, b) => b.value - a.value).slice(0, 12), 'MXN')}
            </div>
        `;
    }

    /* ---------- 4. Portafolio ---------- */
    function layPortafolio({ agg, rows }) {
        const keys = ['ESCALAR', 'MANTENER', 'LIQUIDAR', 'AGOTADO', 'PAUSADA', 'FINALIZADA'];
        const counts = keys.map(k => ({ key: k, n: agg.strategyCount[k] || 0 }));
        const total = rows.length || 1;
        return `
            <div class="dash-split-2">
                <div class="dash-panel">
                    <h3>Distribución de estrategia</h3>
                    ${donut(counts.filter(c => c.n > 0), total)}
                    <ul class="dash-legend-list">
                        ${counts.map(c => `
                            <li><span class="dash-dot st-${c.key}"></span>${esc(c.key)} <strong>${c.n}</strong>
                            <span class="muted">(${Math.round(c.n / total * 100)}%)</span></li>
                        `).join('')}
                    </ul>
                </div>
                <div class="dash-panel">
                    <h3>Lotes por estrategia</h3>
                    <div class="dash-strategy-cols">
                        ${['ESCALAR', 'MANTENER', 'LIQUIDAR'].map(st => {
                            const list = rows.filter(r => r.calc.estrategia === st).slice(0, 6);
                            return `
                                <div class="dash-strategy-col">
                                    <h4>${esc(st)} <span class="muted">${list.length}</span></h4>
                                    ${list.length ? list.map(r => `
                                        <button type="button" class="dash-link-row" data-dash-lote="${esc(r.lote.id)}">
                                            <span>${esc(short(r.lote.producto, 26))}</span>
                                            <span class="num ${tone(r.calc.utilidad)}">${Calc.fmtMXN(r.calc.utilidad)}</span>
                                        </button>
                                    `).join('') : '<p class="muted small">Ninguno</p>'}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    /* ---------- 5. Acción ---------- */
    function layAccion({ alerts }) {
        const unique = uniqueAlerts(alerts);
        const high = unique.filter(a => a.severity === 'high');
        const med = unique.filter(a => a.severity === 'medium');
        const low = unique.filter(a => a.severity === 'low');
        return `
            <div class="dash-grid-kpi dash-grid-kpi-3">
                ${kpi('Alta', String(high.length), high.length ? 'neg' : '', 'Acción inmediata')}
                ${kpi('Media', String(med.length), '', 'Esta semana')}
                ${kpi('Oportunidad', String(low.length), 'pos', 'Explorar')}
            </div>
            <div class="dash-panel">
                <h3>Cola de decisiones</h3>
                ${unique.length ? `
                    <ul class="dash-action-list">
                        ${unique.slice(0, 12).map(a => `
                            <li class="sev-${a.severity}" data-dash-lote="${esc(a.lote?.id || '')}">
                                <span class="sev">${a.severity === 'high' ? 'ALTA' : a.severity === 'medium' ? 'MEDIA' : 'IDEA'}</span>
                                <div>
                                    <div class="t">${esc(a.title)}</div>
                                    <div class="d">${esc(strip(a.text))}</div>
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                ` : `<p class="muted">Sin alertas. El portafolio está estable.</p>`}
            </div>
        `;
    }

    /* ---------- 6. Rotación ---------- */
    function layRotacion({ agg, rows }) {
        const slow = [...rows]
            .filter(r => r.calc.inventarioRestante > 0)
            .sort((a, b) => a.calc.rotacion - b.calc.rotacion);
        const trapped = slow.reduce((s, r) => s + r.calc.valorInventario, 0);
        const zeroSales = slow.filter(r => r.calc.vendidas === 0).length;
        return `
            <div class="dash-grid-kpi dash-grid-kpi-3">
                ${kpi('Capital atrapado', Calc.fmtMXN(trapped), trapped > 0 ? 'neg' : '', 'Stock con rotación pendiente')}
                ${kpi('% inventario lento', agg.valorInventario ? Calc.fmtPct(trapped / agg.valorInventario) : '—', '', 'Sobre valor en stock')}
                ${kpi('Sin ventas', String(zeroSales), zeroSales ? 'neg' : '', 'Lotes con stock y 0 vendidas')}
            </div>
            <div class="dash-panel">
                <h3>Rotación por SKU (menor → mayor)</h3>
                <table class="dash-table">
                    <thead>
                        <tr>
                            <th>Producto</th>
                            <th class="num">Stock</th>
                            <th class="num">Rotación</th>
                            <th class="num">$ atrapado</th>
                            <th>Diagnóstico</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${slow.slice(0, 15).map(({ lote, calc }) => `
                            <tr data-dash-lote="${esc(lote.id)}" class="is-click">
                                <td>${esc(lote.producto)}${lote.variante ? ` <span class="muted">· ${esc(lote.variante)}</span>` : ''}</td>
                                <td class="num">${calc.inventarioRestante}</td>
                                <td class="num">${Math.round(calc.rotacion * 100)}%</td>
                                <td class="num">${Calc.fmtMXN(calc.valorInventario)}</td>
                                <td>${esc(diag(lote, calc))}</td>
                            </tr>
                        `).join('') || `<tr><td colspan="5" class="muted">Sin inventario</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;
    }

    /* ---------- 7. Ranking ---------- */
    function layRanking({ rows }) {
        const byUtil = [...rows].sort((a, b) => b.calc.utilidad - a.calc.utilidad);
        const byMargen = [...rows].sort((a, b) => b.calc.margen - a.calc.margen);
        const byRoi = [...rows].sort((a, b) => b.calc.roi - a.calc.roi);
        return `
            <div class="dash-split-3">
                ${rankCol('Por utilidad / ud', byUtil, r => Calc.fmtMXN(r.calc.utilidad), r => tone(r.calc.utilidad))}
                ${rankCol('Por margen', byMargen, r => Calc.fmtPct(r.calc.margen), r => tone(r.calc.margen))}
                ${rankCol('Por ROI', byRoi, r => Calc.fmtPct(r.calc.roi), r => tone(r.calc.roi))}
            </div>
        `;
    }

    function rankCol(title, list, fmt, toneFn) {
        return `
            <div class="dash-panel">
                <h3>${esc(title)}</h3>
                <ol class="dash-rank-ol">
                    ${list.slice(0, 10).map((r, i) => `
                        <li data-dash-lote="${esc(r.lote.id)}">
                            <span class="n">${i + 1}</span>
                            <span class="name">${esc(short(r.lote.producto, 28))}</span>
                            <span class="num ${toneFn(r)}">${fmt(r)}</span>
                        </li>
                    `).join('') || '<li class="muted">Sin datos</li>'}
                </ol>
            </div>
        `;
    }

    /* ---------- 8. Ads ---------- */
    function layAds({ rows, gastoAds }) {
        const withAds = rows.filter(r => r.calc.gastoAds > 0 || r.calc.topeCPA > 0)
            .sort((a, b) => b.calc.gastoAds - a.calc.gastoAds);
        const over = rows.filter(r => r.calc.adsStatus === 'over').length;
        const near = rows.filter(r => r.calc.adsStatus === 'near').length;
        return `
            <div class="dash-grid-kpi dash-grid-kpi-3">
                ${kpi('Gasto Ads total', Calc.fmtMXN(gastoAds), '', 'Suma de lotes')}
                ${kpi('Sobre tope CPA', String(over), over ? 'neg' : '', 'Bajar puja / pausar')}
                ${kpi('Cerca del tope', String(near), near ? '' : '', 'Vigilar esta semana')}
            </div>
            <div class="dash-panel">
                <h3>Ads vs tope por SKU</h3>
                <table class="dash-table">
                    <thead>
                        <tr>
                            <th>Producto</th>
                            <th class="num">Gasto</th>
                            <th class="num">$/venta</th>
                            <th class="num">Tope CPA</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${withAds.length ? withAds.map(({ lote, calc }) => `
                            <tr data-dash-lote="${esc(lote.id)}" class="is-click">
                                <td>${esc(short(lote.producto, 32))}</td>
                                <td class="num">${Calc.fmtMXN(calc.gastoAds)}</td>
                                <td class="num">${Calc.fmtMXN(calc.adsPorVenta)}</td>
                                <td class="num">${calc.topeCPA ? Calc.fmtMXN(calc.topeCPA) : '—'}</td>
                                <td><span class="dash-pill ads-${esc(calc.adsStatus)}">${esc(calc.adsStatus)}</span></td>
                            </tr>
                        `).join('') : `<tr><td colspan="5" class="muted">Sin gasto Ads ni tope CPA. Registra Ads en el detalle del lote.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;
    }

    /* ---------- 9. Ventas ---------- */
    function layVentas({ agg, recentSales, rows }) {
        const byUds = [...rows].sort((a, b) => b.calc.vendidas - a.calc.vendidas).slice(0, 10);
        return `
            <div class="dash-grid-kpi dash-grid-kpi-4">
                ${kpi('Uds vendidas', String(agg.totalVendidas), '', 'Todas las variantes')}
                ${kpi('Cash in', Calc.fmtMXN(agg.cashIn), 'pos', '')}
                ${kpi('Eventos de venta', String(recentSales.length), '', 'Registros en historial')}
                ${kpi('Ganancia', Calc.fmtMXN(agg.gananciaRealizada), tone(agg.gananciaRealizada), '')}
            </div>
            <div class="dash-split-2">
                <div class="dash-panel">
                    <h3>Últimas ventas</h3>
                    <table class="dash-table">
                        <thead><tr><th>Fecha</th><th>Producto</th><th class="num">Uds</th><th class="num">Total</th></tr></thead>
                        <tbody>
                            ${recentSales.slice(0, 12).map(s => `
                                <tr data-dash-lote="${esc(s.lote.id)}" class="is-click">
                                    <td>${esc(Calc.fmtDate(s.fecha))}</td>
                                    <td>${esc(short(s.lote.producto, 28))}</td>
                                    <td class="num">${s.unidades}</td>
                                    <td class="num">${Calc.fmtMXN(s.total)}</td>
                                </tr>
                            `).join('') || `<tr><td colspan="4" class="muted">Sin ventas registradas. Usa “Registrar venta”.</td></tr>`}
                        </tbody>
                    </table>
                </div>
                <div class="dash-panel">
                    <h3>Volumen por SKU</h3>
                    ${barChart(byUds.map(r => ({
                        label: short(r.lote.producto, 20),
                        value: r.calc.vendidas,
                        meta: Calc.fmtMXN(r.calc.cashIn),
                    })), 'uds')}
                </div>
            </div>
        `;
    }

    /* ---------- 10. Versus ---------- */
    function layVersus({ rows }) {
        const ranked = [...rows].sort((a, b) => b.calc.utilidad - a.calc.utilidad);
        const top = ranked.filter(r => r.calc.utilidad > 0).slice(0, 5);
        const bottom = [...ranked].reverse().filter(r => r.calc.utilidad <= 0 || r.calc.estrategia === 'LIQUIDAR').slice(0, 5);
        if (!bottom.length) {
            bottom.push(...[...ranked].reverse().slice(0, 5));
        }
        return `
            <div class="dash-split-2">
                <div class="dash-panel dash-panel-good">
                    <h3>Mejores (escalar / utilidad +)</h3>
                    ${versusList(top)}
                </div>
                <div class="dash-panel dash-panel-bad">
                    <h3>Atención (liquidar / utilidad −)</h3>
                    ${versusList(bottom)}
                </div>
            </div>
            <div class="dash-panel">
                <h3>Brecha de utilidad (mejor vs peor)</h3>
                ${(() => {
                    if (!top[0] || !bottom[0]) return '<p class="muted">Necesitas más lotes para comparar.</p>';
                    const gap = top[0].calc.utilidad - bottom[0].calc.utilidad;
                    return `
                        <div class="dash-gap">
                            <div>
                                <div class="muted small">Mejor</div>
                                <div class="pos strong">${esc(short(top[0].lote.producto, 30))} · ${Calc.fmtMXN(top[0].calc.utilidad)}</div>
                            </div>
                            <div class="dash-gap-num">${Calc.fmtMXN(gap)}</div>
                            <div>
                                <div class="muted small">Peor</div>
                                <div class="neg strong">${esc(short(bottom[0].lote.producto, 30))} · ${Calc.fmtMXN(bottom[0].calc.utilidad)}</div>
                            </div>
                        </div>
                    `;
                })()}
            </div>
        `;
    }

    function versusList(list) {
        if (!list.length) return '<p class="muted small">Sin datos</p>';
        return `
            <ul class="dash-versus-list">
                ${list.map(r => `
                    <li data-dash-lote="${esc(r.lote.id)}">
                        <div>
                            <div class="name">${esc(r.lote.producto)}</div>
                            <div class="muted small">${esc(r.lote.variante || r.lote.sku || '—')} · ${esc(r.calc.estrategia)}</div>
                        </div>
                        <div class="nums">
                            <div class="${tone(r.calc.utilidad)}">${Calc.fmtMXN(r.calc.utilidad)}</div>
                            <div class="muted small">${Calc.fmtPct(r.calc.margen)} margen</div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    /* ---------- Charts / atoms ---------- */
    function kpi(label, value, t, sub) {
        return `
            <div class="dash-kpi">
                <div class="dash-kpi-label">${esc(label)}</div>
                <div class="dash-kpi-value ${t || ''}">${value}</div>
                ${sub ? `<div class="dash-kpi-sub">${esc(sub)}</div>` : ''}
            </div>`;
    }

    function mini(label, value) {
        return `<div class="dash-mini"><span>${esc(label)}</span><strong>${value}</strong></div>`;
    }

    function barChart(items, unit) {
        if (!items.length) return '<p class="muted small">Sin datos</p>';
        const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
        return `
            <div class="dash-bars">
                ${items.map(i => {
                    const pct = Math.round((Math.abs(i.value) / max) * 100);
                    return `
                        <div class="dash-bar-row">
                            <div class="dash-bar-label" title="${esc(i.label)}">${esc(i.label)}</div>
                            <div class="dash-bar-track"><div class="dash-bar-fill ${i.value < 0 ? 'neg' : ''}" style="width:${pct}%"></div></div>
                            <div class="dash-bar-val">${unit === 'uds' ? i.value : Calc.fmtMXN(i.value)}</div>
                        </div>`;
                }).join('')}
            </div>`;
    }

    function stackBars(parts, total) {
        const t = total > 0 ? total : parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
        return `
            <div class="dash-stack-bar">
                ${parts.map(p => {
                    const w = Math.max(0, p.value) / t * 100;
                    if (w <= 0) return '';
                    return `<div class="seg ${p.cls}" style="width:${w}%" title="${esc(p.label)}: ${Calc.fmtMXN(p.value)}"></div>`;
                }).join('')}
            </div>
            <ul class="dash-stack-legend">
                ${parts.map(p => `<li><i class="${p.cls}"></i>${esc(p.label)} <strong>${Calc.fmtMXN(p.value)}</strong></li>`).join('')}
            </ul>`;
    }

    function donut(parts, total) {
        const colors = {
            ESCALAR: 'var(--primary)', MANTENER: 'var(--warn)', LIQUIDAR: 'var(--danger)',
            AGOTADO: 'var(--text-dim)', PAUSADA: '#8a9aad', FINALIZADA: '#bcc7d3',
        };
        const r = 54, c = 2 * Math.PI * r;
        let offset = 0;
        const segs = parts.map(p => {
            const len = (p.n / total) * c;
            const dash = `${len} ${c - len}`;
            const el = `<circle class="donut-seg" r="${r}" cx="70" cy="70" fill="none" stroke="${colors[p.key] || '#999'}"
                stroke-width="16" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}"
                transform="rotate(-90 70 70)"></circle>`;
            offset += len;
            return el;
        }).join('');
        return `
            <div class="dash-donut">
                <svg viewBox="0 0 140 140" width="160" height="160">${segs}
                    <circle r="38" cx="70" cy="70" fill="var(--surface)"></circle>
                    <text x="70" y="74" text-anchor="middle" font-size="18" font-weight="700" fill="var(--text)">${total}</text>
                </svg>
            </div>`;
    }

    function emptyState() {
        return `
            <div class="dash-empty-full">
                <h2>Sin datos todavía</h2>
                <p class="muted">Importa un Excel o crea un lote. Los 10 layouts se llenan con tu información financiera.</p>
                <button type="button" class="btn primary" data-dash-new>+ Nuevo lote</button>
            </div>`;
    }

    /* ---------- helpers ---------- */
    function uniqueAlerts(alerts) {
        const seen = new Set();
        const out = [];
        for (const a of alerts) {
            const key = a.lote?.productId || a.lote?.producto || a.lote?.id || a.title;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(a);
        }
        return out;
    }

    function tone(n) {
        if (!Number.isFinite(n) || Math.abs(n) < 0.0001) return '';
        return n > 0 ? 'pos' : 'neg';
    }

    function short(s, n) {
        s = String(s || '');
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    function strip(html) {
        const d = document.createElement('div');
        d.innerHTML = html || '';
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function diag(lote, calc) {
        if (!lote.unidades) return '—';
        if (calc.vendidas === 0) return 'Sin ventas';
        if (calc.rotacion >= 1) return 'Agotado';
        if (calc.rotacion >= 0.7) return 'Alta';
        if (calc.rotacion >= 0.3) return 'Media';
        return 'Lenta';
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function bind(root) {
        root.querySelector('[data-dash-prev]')?.addEventListener('click', () => setLayout(currentLayout() - 1));
        root.querySelector('[data-dash-next]')?.addEventListener('click', () => setLayout(currentLayout() + 1));
        root.querySelectorAll('[data-dash-layout]').forEach(btn => {
            btn.addEventListener('click', () => setLayout(Number(btn.dataset.dashLayout)));
        });
        root.querySelectorAll('[data-dash-new]').forEach(btn => {
            btn.addEventListener('click', () => {
                window.App?.switchTab('lotes');
                LotesView.openModal(null);
            });
        });
        root.querySelectorAll('[data-dash-lote]').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.dashLote;
                if (id && window.LotesView?.selectAndGo) LotesView.selectAndGo(id);
            });
        });

        // Teclado ← → cuando estás en dashboard
        if (!window.__dashKeys) {
            window.__dashKeys = true;
            document.addEventListener('keydown', e => {
                if (window.State.view !== 'dashboard') return;
                if (e.target.matches('input, textarea, select')) return;
                if (e.key === 'ArrowLeft') { e.preventDefault(); setLayout(currentLayout() - 1); }
                if (e.key === 'ArrowRight') { e.preventDefault(); setLayout(currentLayout() + 1); }
            });
        }
    }

    function init() {
        window.State.subscribe(() => {
            if (window.State.view === 'dashboard') render();
        });
    }

    return { init, render, LAYOUTS };
})();
