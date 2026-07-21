/* ==========================================================================
   Vista Dashboard: KPIs, rotación (con barras horizontales), distribución
   de estrategia, top rentabilidad, alertas resumen.
   ========================================================================== */

const DashboardView = (() => {

    function render() {
        const s = window.State;
        const agg = Calc.aggregate(s.lotes, s.settings);

        renderKPIs(agg);
        renderRotacion(agg);
        renderStrategyChart(agg);
        renderTop(agg);
        renderAlertsCard();
    }

    function renderKPIs(agg) {
        const kpis = [
            { label: 'Capital Desplegado', value: Calc.fmtMXN(agg.capitalDesplegado), sub: `${agg.rows.length} lote(s) · ${agg.totalUds} uds` },
            { label: 'Cash In (Ventas)', value: Calc.fmtMXN(agg.cashIn), sub: `${agg.totalVendidas} unidad(es) vendidas` },
            { label: 'Ganancia Realizada', value: Calc.fmtMXN(agg.gananciaRealizada), sub: `Por precio real de cada venta · margen lista ${Calc.fmtPct(agg.margenPonderado)}` },
            { label: 'Valor Inventario', value: Calc.fmtMXN(agg.valorInventario), sub: `al costo` },
        ];
        document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
            <div class="kpi">
                <div class="kpi-label">${k.label}</div>
                <div class="kpi-value">${k.value}</div>
                <div class="kpi-sub">${k.sub}</div>
            </div>
        `).join('');
    }

    function renderRotacion(agg) {
        const rows = agg.rows
            .slice()
            .sort((a, b) => b.calc.rotacion - a.calc.rotacion)
            .map(({ lote, calc }) => {
                const pct = Math.min(100, calc.rotacion * 100);
                const diag = diagnosticoRotacion(lote, calc);
                return `
                <tr>
                    <td><code>${lote.sku || '—'}</code></td>
                    <td>${lote.producto || '—'}</td>
                    <td class="num">${lote.unidades || 0}</td>
                    <td class="num">${lote.vendidas || 0}</td>
                    <td>
                        <div class="rot-bar">
                            <div class="rot-fill" style="width:${pct}%"></div>
                            <span class="rot-label">${pct.toFixed(0)}%</span>
                        </div>
                    </td>
                    <td>${diag}</td>
                </tr>`;
            }).join('');
        document.getElementById('rotacion-tbody').innerHTML = rows || `<tr><td colspan="6" class="empty">Sin lotes</td></tr>`;
    }

    function diagnosticoRotacion(lote, calc) {
        const uds = Number(lote.unidades) || 0;
        const vendidas = Number(lote.vendidas) || 0;
        if (uds === 0) return '—';
        const pct = vendidas / uds;
        if (vendidas === 0) return '🌱 Sin ventas';
        if (pct >= 1) return '✅ Agotado';
        if (pct >= 0.7) return '🔥 Vendiendo bien';
        if (pct >= 0.3) return '🍀 Fluido';
        return '🐌 Lenta';
    }

    function renderStrategyChart(agg) {
        const items = [
            { key: 'ESCALAR',    label: 'Escalar',    cls: 'esc', n: agg.strategyCount.ESCALAR || 0 },
            { key: 'MANTENER',   label: 'Mantener',   cls: 'man', n: agg.strategyCount.MANTENER || 0 },
            { key: 'LIQUIDAR',   label: 'Liquidar',   cls: 'liq', n: agg.strategyCount.LIQUIDAR || 0 },
            { key: 'AGOTADO',    label: 'Agotado',    cls: 'ago', n: agg.strategyCount.AGOTADO || 0 },
            { key: 'PAUSADA',    label: 'Pausada',    cls: 'pau', n: agg.strategyCount.PAUSADA || 0 },
            { key: 'FINALIZADA', label: 'Finalizada', cls: 'fin', n: agg.strategyCount.FINALIZADA || 0 },
        ];
        const present = items.filter(x => x.n > 0);
        const total = agg.rows.length;

        const el = document.getElementById('strategy-chart');
        if (!total) {
            el.innerHTML = `<div class="donut-empty muted">Sin lotes aún</div>`;
            return;
        }

        // Donut SVG: stroke-dasharray sobre circunferencia
        const size = 160;
        const stroke = 28;
        const r = (size - stroke) / 2;
        const c = 2 * Math.PI * r;
        let offset = 0;

        const rings = present.map(it => {
            const len = (it.n / total) * c;
            const gap = present.length > 1 ? 2 : 0;
            const dash = Math.max(0, len - gap);
            const html = `<circle class="donut-seg ${it.cls}" cx="${size/2}" cy="${size/2}" r="${r}"
                stroke-width="${stroke}" stroke-dasharray="${dash} ${c - dash}"
                stroke-dashoffset="${-offset}" transform="rotate(-90 ${size/2} ${size/2})"/>`;
            offset += len;
            return html;
        }).join('');

        const legend = items.map(it => {
            const pct = total ? Math.round((it.n / total) * 100) : 0;
            return `
                <div class="donut-legend-row ${it.n === 0 ? 'dim' : ''}">
                    <span class="donut-swatch ${it.cls}"></span>
                    <span class="donut-legend-label">${it.label}</span>
                    <span class="donut-legend-n">${it.n}</span>
                    <span class="donut-legend-pct">${pct}%</span>
                </div>`;
        }).join('');

        el.innerHTML = `
            <div class="donut-wrap">
                <div class="donut-svg-box">
                    <svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="Distribución de estrategia">
                        <circle class="donut-track" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}"/>
                        ${rings}
                    </svg>
                    <div class="donut-center">
                        <div class="donut-total">${total}</div>
                        <div class="donut-total-lbl">lotes</div>
                    </div>
                </div>
                <div class="donut-legend">${legend}</div>
            </div>`;
    }

    function renderTop(agg) {
        const sorted = [...agg.rows].sort((a, b) => b.calc.utilidad - a.calc.utilidad).slice(0, 5);
        document.getElementById('top-tbody').innerHTML = sorted.map(({ lote, calc }) => `
            <tr>
                <td>${lote.producto || '—'}<br><small class="muted">${lote.variante || ''}</small></td>
                <td class="num ${calc.utilidad >= 0 ? 'pos' : 'neg'}">${Calc.fmtMXN(calc.utilidad)}</td>
                <td class="num">${Calc.fmtPct(calc.margen)}</td>
            </tr>
        `).join('') || `<tr><td colspan="3" class="empty">Sin datos</td></tr>`;
    }

    function renderAlertsCard() {
        const el = document.getElementById('alerts-summary');
        if (!el || !window.InsightsView) return;
        const { alerts } = InsightsView.analyze();
        const high = alerts.filter(a => a.severity === 'high').length;
        const medium = alerts.filter(a => a.severity === 'medium').length;
        const low = alerts.filter(a => a.severity === 'low').length;

        el.innerHTML = `
            <div class="alerts-summary">
                <div class="alerts-stat">
                    <span class="alerts-dot high"></span>
                    <div>
                        <div class="alerts-count">${high}</div>
                        <div class="alerts-lbl">Alta prioridad</div>
                    </div>
                </div>
                <div class="alerts-stat">
                    <span class="alerts-dot med"></span>
                    <div>
                        <div class="alerts-count">${medium}</div>
                        <div class="alerts-lbl">Media</div>
                    </div>
                </div>
                <div class="alerts-stat">
                    <span class="alerts-dot low"></span>
                    <div>
                        <div class="alerts-count">${low}</div>
                        <div class="alerts-lbl">Oportunidades</div>
                    </div>
                </div>
            </div>
            <button class="btn" style="margin-top:14px" id="btn-go-insights">Ver todos los insights →</button>
        `;
        const goBtn = document.getElementById('btn-go-insights');
        if (goBtn) goBtn.addEventListener('click', () => window.App && window.App.switchTab('insights'));
    }

    function init() {
        window.State.subscribe(() => {
            if (window.State.view === 'dashboard') render();
        });
    }

    return { init, render };
})();
