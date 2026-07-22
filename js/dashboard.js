/* ==========================================================================
   Dashboard — 4 layouts de DATA: P&G · Caja · Portafolio · Ranking
   Navegación: tabs / ← → / teclado. Preferencia en State.ui.dashLayoutId.
   ========================================================================== */

const DashboardView = (() => {

    const LAYOUTS = [
        { id: 'pyg',        name: 'P&G',        blurb: 'Ingresos, costos y fees' },
        { id: 'caja',       name: 'Caja',       blurb: 'Capital, cash in e inventario' },
        { id: 'portafolio', name: 'Portafolio', blurb: 'Estrategia y distribución' },
        { id: 'ranking',    name: 'Ranking',    blurb: 'Utilidad, margen y ROI' },
    ];

    function currentLayout() {
        const ui = window.State.ui || {};
        if (ui.dashLayoutId) {
            const byId = LAYOUTS.findIndex(l => l.id === ui.dashLayoutId);
            if (byId >= 0) return byId;
        }
        const n = Number(ui.dashLayout);
        if (Number.isInteger(n) && n >= 0 && n < LAYOUTS.length) return n;
        return 0;
    }

    function setLayout(i) {
        const next = ((i % LAYOUTS.length) + LAYOUTS.length) % LAYOUTS.length;
        window.State.ui = {
            ...window.State.ui,
            dashLayout: next,
            dashLayoutId: LAYOUTS[next].id,
        };
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
        const ctx = buildContext(agg);

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
                    <div class="dash-nav-tabs" role="tablist" aria-label="Vistas del dashboard">
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

    function buildContext(agg) {
        const rows = agg.rows;
        let fees = 0;
        let costoVendido = 0;
        let gastoAds = 0;
        rows.forEach(({ lote, calc }) => {
            const v = calc.vendidas;
            fees += (calc.comisionVariable + calc.cargoFijo + calc.retIVA + calc.retISR) * v;
            costoVendido += (Number(lote.costo) || 0) * v;
            gastoAds += calc.gastoAds;
        });
        return { agg, rows, fees, costoVendido, gastoAds };
    }

    function renderLayout(id, ctx) {
        switch (id) {
            case 'pyg': return layPyG(ctx);
            case 'caja': return layCaja(ctx);
            case 'portafolio': return layPortafolio(ctx);
            case 'ranking': return layRanking(ctx);
            default: return layPyG(ctx);
        }
    }

    /* ---------- P&G ---------- */
    function layPyG({ agg, fees, costoVendido, gastoAds }) {
        const bruto = agg.cashIn - costoVendido;
        const neto = agg.gananciaRealizada;
        const lines = [
            { label: 'Ingresos (cash in)', value: agg.cashIn },
            { label: '− Costo de lo vendido', value: -costoVendido },
            { label: '= Utilidad bruta est.', value: bruto, bold: true },
            { label: '− Fees ML + retenciones (est.)', value: -fees },
            { label: '− Gasto Ads', value: -gastoAds },
            { label: '= Ganancia realizada', value: neto, bold: true },
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
                        Fees estimados con precio de venta; Ads es el gasto registrado por lote.
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

    /* ---------- Caja ---------- */
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

    /* ---------- Portafolio ---------- */
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
                            const list = rows.filter(r => r.calc.estrategia === st).slice(0, 8);
                            return `
                                <div class="dash-strategy-col">
                                    <h4>${esc(st)} <span class="muted">${agg.strategyCount[st] || 0}</span></h4>
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

    /* ---------- Ranking ---------- */
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
                    ${list.slice(0, 12).map((r, i) => `
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

    /* ---------- atoms ---------- */
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
            const len = (p.n / Math.max(total, 1)) * c;
            const dash = `${len} ${c - len}`;
            const el = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${colors[p.key] || '#999'}"
                stroke-width="16" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}"
                transform="rotate(-90 70 70)"></circle>`;
            offset += len;
            return el;
        }).join('');
        return `
            <div class="dash-donut">
                <svg viewBox="0 0 140 140" width="160" height="160" aria-hidden="true">${segs}
                    <circle r="38" cx="70" cy="70" fill="var(--surface)"></circle>
                    <text x="70" y="74" text-anchor="middle" font-size="18" font-weight="700" fill="var(--text)">${total}</text>
                </svg>
            </div>`;
    }

    function emptyState() {
        return `
            <div class="dash-empty-full">
                <h2>Sin datos todavía</h2>
                <p class="muted">Importa un Excel o crea un lote para ver P&amp;G, caja, portafolio y ranking.</p>
                <button type="button" class="btn primary" data-dash-new>+ Nuevo lote</button>
            </div>`;
    }

    function tone(n) {
        if (!Number.isFinite(n) || Math.abs(n) < 0.0001) return '';
        return n > 0 ? 'pos' : 'neg';
    }

    function short(s, n) {
        s = String(s || '');
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
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

        if (!window.__dashKeysBound) {
            window.__dashKeysBound = true;
            document.addEventListener('keydown', e => {
                if (window.State.view !== 'dashboard') return;
                if (e.target.matches('input, textarea, select, [contenteditable]')) return;
                if (e.key === 'ArrowLeft') { e.preventDefault(); setLayout(currentLayout() - 1); }
                if (e.key === 'ArrowRight') { e.preventDefault(); setLayout(currentLayout() + 1); }
            });
        }
    }

    function init() {
        // Migrar índice viejo (0–9) → id de los 4 layouts actuales
        const ui = window.State.ui || {};
        if (!ui.dashLayoutId) {
            const legacyMap = {
                1: 'pyg', 2: 'caja', 3: 'portafolio', 6: 'ranking',
            };
            const mapped = legacyMap[ui.dashLayout];
            if (mapped) {
                window.State.ui = { ...ui, dashLayoutId: mapped, dashLayout: LAYOUTS.findIndex(l => l.id === mapped) };
                window.State.saveUI();
            } else if (ui.dashLayout != null) {
                window.State.ui = { ...ui, dashLayoutId: 'pyg', dashLayout: 0 };
                window.State.saveUI();
            }
        }

        window.State.subscribe(() => {
            if (window.State.view === 'dashboard') render();
        });
    }

    return { init, render, LAYOUTS };
})();
