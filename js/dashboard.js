/* ==========================================================================
   Dashboard — vista única: P&G + Caja + Portafolio + Ranking
   ========================================================================== */

const DashboardView = (() => {

    function render() {
        const root = document.getElementById('dashboard-canvas');
        if (!root) return;

        const lotes = window.State.lotes || [];
        if (!lotes.length) {
            root.innerHTML = `
                <div class="dash-shell">
                    <div class="dash-body">
                        <div class="dash-empty-full">
                            <h2>Sin datos todavía</h2>
                            <p class="muted">Importa un Excel o crea un lote para ver el panel financiero.</p>
                            <button type="button" class="btn primary" data-dash-new>+ Nuevo lote</button>
                        </div>
                    </div>
                </div>`;
            bind(root);
            return;
        }

        const agg = Calc.aggregate(lotes, window.State.settings);
        const ctx = buildContext(agg);
        const chartPeriod = window.State.ui?.dashChartPeriod === 'years' ? 'years' : 'months';
        const chartStyle = window.State.ui?.dashChartStyle === 'line' ? 'line' : 'bars';

        root.innerHTML = `
            <div class="dash-shell">
                <div class="dash-body dash-body-combined">
                    <section class="dash-section">
                        <div class="dash-section-head">
                            <h2 class="dash-section-title">Progreso</h2>
                            <div class="dash-chart-toggles">
                                <div class="dash-seg" role="group" aria-label="Periodo">
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'months' ? ' active' : ''}" data-dash-period="months">Meses</button>
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'years' ? ' active' : ''}" data-dash-period="years">Años</button>
                                </div>
                                <div class="dash-seg" role="group" aria-label="Tipo de gráfica">
                                    <button type="button" class="dash-seg-btn${chartStyle === 'bars' ? ' active' : ''}" data-dash-style="bars">Barras</button>
                                    <button type="button" class="dash-seg-btn${chartStyle === 'line' ? ' active' : ''}" data-dash-style="line">Líneas</button>
                                </div>
                            </div>
                        </div>
                        ${layProgreso(lotes, chartPeriod, chartStyle)}
                    </section>
                    <section class="dash-section">
                        <h2 class="dash-section-title">P&amp;G</h2>
                        ${layPyG(ctx)}
                    </section>
                    <section class="dash-section">
                        <h2 class="dash-section-title">Caja</h2>
                        ${layCaja(ctx)}
                    </section>
                    <section class="dash-section">
                        <h2 class="dash-section-title">Portafolio</h2>
                        ${layPortafolio(ctx)}
                    </section>
                    <section class="dash-section">
                        <h2 class="dash-section-title">Ranking</h2>
                        ${layRanking(ctx)}
                    </section>
                </div>
            </div>
        `;
        bind(root);
    }

    function layProgreso(lotes, period, style) {
        const series = buildTimeSeries(lotes, window.State.settings, period);
        const totalCash = series.reduce((s, p) => s + p.cashIn, 0);
        const totalGain = series.reduce((s, p) => s + p.ganancia, 0);
        const totalUds = series.reduce((s, p) => s + p.unidades, 0);
        const hasData = totalUds > 0 || totalCash > 0;

        return `
            <div class="dash-panel dash-progreso">
                <div class="dash-grid-kpi dash-grid-kpi-3">
                    <div class="dash-kpi">
                        <div class="dash-kpi-label">Cash in · periodo</div>
                        <div class="dash-kpi-value">${Calc.fmtMXN(totalCash)}</div>
                    </div>
                    <div class="dash-kpi">
                        <div class="dash-kpi-label">Ganancia · periodo</div>
                        <div class="dash-kpi-value ${tone(totalGain)}">${Calc.fmtMXN(totalGain)}</div>
                    </div>
                    <div class="dash-kpi">
                        <div class="dash-kpi-label">Unidades vendidas</div>
                        <div class="dash-kpi-value">${totalUds}</div>
                    </div>
                </div>
                ${hasData
                    ? timeChart(series, style)
                    : `<p class="dash-chart-empty muted">Aún no hay ventas con fecha. Registra ventas en un lote para ver el progreso.</p>`}
                <ul class="dash-chart-legend">
                    <li><i class="cash"></i>Cash in</li>
                    <li><i class="gain"></i>Ganancia realizada</li>
                </ul>
            </div>`;
    }

    /** Agrupa ventas por mes (últimos 12) o por año. */
    function buildTimeSeries(lotes, settings, period) {
        const map = new Map();
        const bump = (key, cash, gain, uds) => {
            const cur = map.get(key) || { cashIn: 0, ganancia: 0, unidades: 0 };
            cur.cashIn += cash;
            cur.ganancia += gain;
            cur.unidades += uds;
            map.set(key, cur);
        };

        lotes.forEach(lote => {
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            if (ventas.length) {
                ventas.forEach(v => {
                    const d = parseDate(v.fecha);
                    if (!d) return;
                    const key = period === 'years'
                        ? String(d.getFullYear())
                        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const uds = Number(v.unidades) || 0;
                    const p = Number(v.precio) || 0;
                    bump(key, p * uds, Calc.utilidadAtPrice(lote, p, settings).utilidad * uds, uds);
                });
            } else {
                const vendidas = Number(lote.vendidas) || 0;
                if (vendidas <= 0) return;
                const d = parseDate(lote.fecha);
                if (!d) return;
                const key = period === 'years'
                    ? String(d.getFullYear())
                    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const precio = Number(lote.precio) || 0;
                bump(key, precio * vendidas, Calc.utilidadAtPrice(lote, precio, settings).utilidad * vendidas, vendidas);
            }
        });

        if (period === 'months') {
            const keys = lastNMonthKeys(12);
            return keys.map(key => ({
                key,
                label: monthLabel(key),
                cashIn: map.get(key)?.cashIn || 0,
                ganancia: map.get(key)?.ganancia || 0,
                unidades: map.get(key)?.unidades || 0,
            }));
        }

        const years = [...map.keys()].map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
        const nowY = new Date().getFullYear();
        if (!years.length) years.push(nowY);
        const minY = Math.min(years[0], nowY - 2);
        const maxY = Math.max(years[years.length - 1], nowY);
        const out = [];
        for (let y = minY; y <= maxY; y++) {
            const key = String(y);
            out.push({
                key,
                label: key,
                cashIn: map.get(key)?.cashIn || 0,
                ganancia: map.get(key)?.ganancia || 0,
                unidades: map.get(key)?.unidades || 0,
            });
        }
        return out;
    }

    /** Parse local (evita desfase UTC con fechas YYYY-MM-DD). */
    function parseDate(raw) {
        if (!raw) return null;
        const s = String(raw);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function lastNMonthKeys(n) {
        const keys = [];
        const d = new Date();
        d.setDate(1);
        for (let i = n - 1; i >= 0; i--) {
            const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
            keys.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
        }
        return keys;
    }

    function monthLabel(key) {
        const [y, m] = key.split('-').map(Number);
        const names = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return `${names[(m || 1) - 1]} ${String(y).slice(2)}`;
    }

    function timeChart(series, style) {
        const W = 720, H = 220;
        const pad = { t: 16, r: 12, b: 36, l: 52 };
        const iw = W - pad.l - pad.r;
        const ih = H - pad.t - pad.b;
        const maxVal = Math.max(
            1,
            ...series.map(p => Math.max(p.cashIn, p.ganancia, 0)),
            ...series.map(p => Math.abs(Math.min(0, p.ganancia)))
        );
        const n = series.length || 1;
        const slot = iw / n;
        const yScale = v => pad.t + ih - (v / maxVal) * ih;

        const grid = [0.25, 0.5, 0.75, 1].map(f => {
            const y = yScale(maxVal * f);
            return `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" class="dash-chart-grid"/>
                <text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" class="dash-chart-axis">${shortMoney(maxVal * f)}</text>`;
        }).join('');

        const labels = series.map((p, i) => {
            const x = pad.l + slot * i + slot / 2;
            return `<text x="${x}" y="${H - 12}" text-anchor="middle" class="dash-chart-axis">${esc(p.label)}</text>`;
        }).join('');

        let plot = '';
        if (style === 'line') {
            const pathCash = series.map((p, i) => {
                const x = pad.l + slot * i + slot / 2;
                const y = yScale(Math.max(0, p.cashIn));
                return `${i ? 'L' : 'M'}${x},${y}`;
            }).join(' ');
            const pathGain = series.map((p, i) => {
                const x = pad.l + slot * i + slot / 2;
                const y = yScale(Math.max(0, p.ganancia));
                return `${i ? 'L' : 'M'}${x},${y}`;
            }).join(' ');
            const dotsCash = series.map((p, i) => {
                const x = pad.l + slot * i + slot / 2;
                const y = yScale(Math.max(0, p.cashIn));
                return `<circle cx="${x}" cy="${y}" r="3.5" class="dash-chart-dot cash" title="${esc(p.label)}: ${Calc.fmtMXN(p.cashIn)}"/>`;
            }).join('');
            const dotsGain = series.map((p, i) => {
                const x = pad.l + slot * i + slot / 2;
                const y = yScale(Math.max(0, p.ganancia));
                return `<circle cx="${x}" cy="${y}" r="3.5" class="dash-chart-dot gain" title="${esc(p.label)}: ${Calc.fmtMXN(p.ganancia)}"/>`;
            }).join('');
            plot = `
                <path d="${pathCash}" class="dash-chart-line cash" fill="none"/>
                <path d="${pathGain}" class="dash-chart-line gain" fill="none"/>
                ${dotsCash}${dotsGain}`;
        } else {
            const barW = Math.min(22, slot * 0.32);
            const gap = 3;
            plot = series.map((p, i) => {
                const cx = pad.l + slot * i + slot / 2;
                const hCash = (Math.max(0, p.cashIn) / maxVal) * ih;
                const hGain = (Math.max(0, p.ganancia) / maxVal) * ih;
                const xCash = cx - barW - gap / 2;
                const xGain = cx + gap / 2;
                return `
                    <rect x="${xCash}" y="${pad.t + ih - hCash}" width="${barW}" height="${hCash}" rx="3" class="dash-chart-bar cash">
                        <title>${esc(p.label)} · Cash in: ${Calc.fmtMXN(p.cashIn)}</title>
                    </rect>
                    <rect x="${xGain}" y="${pad.t + ih - hGain}" width="${barW}" height="${hGain}" rx="3" class="dash-chart-bar gain">
                        <title>${esc(p.label)} · Ganancia: ${Calc.fmtMXN(p.ganancia)}</title>
                    </rect>`;
            }).join('');
        }

        return `
            <div class="dash-chart-wrap">
                <svg class="dash-time-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progreso de ventas">
                    <line x1="${pad.l}" y1="${pad.t + ih}" x2="${W - pad.r}" y2="${pad.t + ih}" class="dash-chart-baseline"/>
                    ${grid}
                    ${plot}
                    ${labels}
                </svg>
            </div>`;
    }

    function shortMoney(n) {
        const v = Math.abs(n);
        if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
        if (v >= 1e3) return `$${(n / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
        return `$${Math.round(n)}`;
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
            <div class="dash-split-2">
                <div class="dash-panel">
                    <h3>Flujo: dónde está el dinero</h3>
                    ${stackBars([
                        { label: 'Ya cobrado (cash in)', value: agg.cashIn, cls: 'c-gain' },
                        { label: 'Atrapado en stock', value: trapped, cls: 'c-cost' },
                        { label: 'Ganancia realizada', value: Math.max(0, agg.gananciaRealizada), cls: 'c-fee' },
                    ], Math.max(agg.cashIn + trapped, 1))}
                </div>
                <div class="dash-panel">
                    <h3>Capital por lote (top 10)</h3>
                    ${barChart(rows.map(r => ({
                        label: short(r.lote.producto, 20),
                        value: r.calc.inversion,
                    })).sort((a, b) => b.value - a.value).slice(0, 10), 'MXN')}
                </div>
            </div>
        `;
    }

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
                    ${list.slice(0, 8).map((r, i) => `
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
                <svg viewBox="0 0 140 140" width="140" height="140" aria-hidden="true">${segs}
                    <circle r="38" cx="70" cy="70" fill="var(--surface)"></circle>
                    <text x="70" y="74" text-anchor="middle" font-size="18" font-weight="700" fill="var(--text)">${total}</text>
                </svg>
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
        root.querySelectorAll('[data-dash-period]').forEach(btn => {
            btn.addEventListener('click', () => {
                const period = btn.dataset.dashPeriod;
                const cur = window.State.ui?.dashChartPeriod === 'years' ? 'years' : 'months';
                if (!period || period === cur) return;
                window.State.ui = { ...window.State.ui, dashChartPeriod: period };
                window.State.saveUI();
                render();
            });
        });
        root.querySelectorAll('[data-dash-style]').forEach(btn => {
            btn.addEventListener('click', () => {
                const style = btn.dataset.dashStyle;
                const cur = window.State.ui?.dashChartStyle === 'line' ? 'line' : 'bars';
                if (!style || style === cur) return;
                window.State.ui = { ...window.State.ui, dashChartStyle: style };
                window.State.saveUI();
                render();
            });
        });
    }

    function init() {
        window.State.subscribe(() => {
            if (window.State.view === 'dashboard') render();
        });
    }

    return { init, render };
})();
window.DashboardView = DashboardView;
