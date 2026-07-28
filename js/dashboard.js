/* ==========================================================================
   Dashboard — vista única: P&G + Caja + Portafolio + Ranking
   ========================================================================== */

const DashboardView = (() => {

    function render() {
        const root = document.getElementById('dashboard-canvas');
        if (!root) return;

        const lotes = window.State.lotes || [];
        const mpLabel = window.State.marketplace === 'amazon' ? 'Amazon' : 'Mercado Libre';
        persistAllocMigrations();

        if (!lotes.length) {
            const emptyCtx = {
                agg: { totalVendidas: 0 },
                costoVendido: 0,
            };
            root.innerHTML = `
                <div class="dash-shell">
                    <div class="dash-body dash-body-combined">
                        <div class="dash-empty-full">
                            <h2>Sin datos todavía · ${esc(mpLabel)}</h2>
                            <p class="muted">Importa un Excel o crea un lote para ver el panel financiero. Las bolsitas ya están listas para este marketplace.</p>
                            <button type="button" class="btn primary" data-dash-new>+ Nuevo lote</button>
                        </div>
                        <section class="dash-section">
                            <h2 class="dash-section-title">Asignación <span class="dash-mp-tag">${esc(mpLabel)}</span></h2>
                            ${layAsignacion(emptyCtx)}
                        </section>
                    </div>
                </div>`;
            bind(root);
            return;
        }

        const agg = Calc.aggregate(lotes, window.State.settings);
        const ctx = buildContext(agg);
        const chartPeriod = ['weeks', 'years'].includes(window.State.ui?.dashChartPeriod)
            ? window.State.ui.dashChartPeriod
            : 'months';
        const chartRange = [3, 6, 12, 24].includes(Number(window.State.ui?.dashChartRange))
            ? Number(window.State.ui.dashChartRange)
            : 12;
        const chartShowEmpty = window.State.ui?.dashChartEmpty === true;
        const chartType = ['hero', 'bars', 'lines', 'area'].includes(window.State.ui?.dashChartType)
            ? window.State.ui.dashChartType
            : 'hero';
        const fromResolved = resolveChartFrom(window.State.ui);

        root.innerHTML = `
            <div class="dash-shell">
                <div class="dash-body dash-body-combined">
                    <section class="dash-section">
                        <div class="dash-section-head">
                            <h2 class="dash-section-title">Progreso <span class="dash-mp-tag">${esc(mpLabel)}</span></h2>
                            <div class="dash-chart-toggles">
                                <div class="dash-seg" role="group" aria-label="Granularidad">
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'weeks' ? ' active' : ''}" data-dash-period="weeks">Semanas</button>
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'months' ? ' active' : ''}" data-dash-period="months">Meses</button>
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'years' ? ' active' : ''}" data-dash-period="years">Años</button>
                                </div>
                                <div class="dash-seg" role="group" aria-label="Tipo de gráfica">
                                    <button type="button" class="dash-seg-btn${chartType === 'hero' ? ' active' : ''}" data-dash-type="hero">Hero</button>
                                    <button type="button" class="dash-seg-btn${chartType === 'bars' ? ' active' : ''}" data-dash-type="bars">Barras</button>
                                    <button type="button" class="dash-seg-btn${chartType === 'lines' ? ' active' : ''}" data-dash-type="lines">Líneas</button>
                                    <button type="button" class="dash-seg-btn${chartType === 'area' ? ' active' : ''}" data-dash-type="area">Área</button>
                                </div>
                            </div>
                        </div>
                        ${layProgreso(lotes, {
                            period: chartPeriod,
                            range: chartRange,
                            showEmpty: chartShowEmpty,
                            chartType,
                            fromDate: fromResolved.iso,
                            fromPreset: fromResolved.preset,
                        })}
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
                        <h2 class="dash-section-title">Asignación <span class="dash-mp-tag">${esc(mpLabel)}</span></h2>
                        ${layAsignacion(ctx)}
                    </section>
                    <section class="dash-section">
                        <h2 class="dash-section-title">Portafolio</h2>
                        ${layPortafolio(ctx)}
                    </section>
                    <section class="dash-section">
                        <h2 class="dash-section-title">Ranking <span class="dash-mp-tag">${esc(mpLabel)}</span></h2>
                        ${layRanking(ctx)}
                    </section>
                </div>
            </div>
        `;
        bind(root);
    }

    /** Fecha ISO YYYY-MM-DD (inicio de filtro). Presets vivos: month | year. */
    function resolveChartFrom(ui = {}) {
        const preset = ui?.dashChartFromPreset === 'month' || ui?.dashChartFromPreset === 'year'
            ? ui.dashChartFromPreset
            : '';
        const now = new Date();
        if (preset === 'month') {
            return { iso: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), preset: 'month' };
        }
        if (preset === 'year') {
            return { iso: toISODate(new Date(now.getFullYear(), 0, 1)), preset: 'year' };
        }
        const iso = normalizeFromDate(ui?.dashChartFrom);
        return { iso, preset: '' };
    }

    function toISODate(d) {
        if (!d || Number.isNaN(d.getTime())) return '';
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    function parseISODate(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return Number.isNaN(d.getTime()) ? null : d;
    }

    /** Acepta legado (año / mes / W-…) y lo normaliza a YYYY-MM-DD. */
    function normalizeFromDate(raw) {
        if (!raw) return '';
        const s = String(raw).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            return parseISODate(s) ? s : '';
        }
        let d = null;
        if (/^W-\d{4}-\d{2}-\d{2}$/.test(s)) d = parsePeriodKey(s, 'weeks');
        else if (/^\d{4}-\d{2}$/.test(s)) d = parsePeriodKey(s, 'months');
        else if (/^\d{4}$/.test(s)) d = parsePeriodKey(s, 'years');
        else d = parseSaleDate(s);
        return d && !Number.isNaN(d.getTime()) ? toISODate(d) : '';
    }

    function formatFromLabel(iso) {
        const d = parseISODate(iso);
        if (!d) return iso || '';
        return fmtDMY(d);
    }

    function layProgreso(lotes, opts = {}) {
        const period = opts.period === 'years' ? 'years' : opts.period === 'weeks' ? 'weeks' : 'months';
        const range = [3, 6, 12, 24].includes(Number(opts.range)) ? Number(opts.range) : 12;
        const showEmpty = opts.showEmpty === true;
        const chartType = ['hero', 'bars', 'lines', 'area'].includes(opts.chartType) ? opts.chartType : 'hero';
        const fromDate = opts.fromDate || '';
        const fromPreset = opts.fromPreset || '';
        const series = buildProgressSeries(lotes, period, range, fromDate);
        const visible = showEmpty ? series : series.filter(b => b.cashIn > 0 || b.ganancia > 0 || b.unidades > 0);
        const chartSeries = visible.length ? visible : series.slice(-Math.min(range, series.length || range));
        const totalCash = series.reduce((s, b) => s + b.cashIn, 0);
        const totalGain = series.reduce((s, b) => s + b.ganancia, 0);
        const totalUds = series.reduce((s, b) => s + b.unidades, 0);
        const emptyHidden = !showEmpty && series.some(b => !(b.cashIn > 0 || b.ganancia > 0 || b.unidades > 0));
        const mpLabel = window.State.marketplace === 'amazon' ? 'Amazon' : 'Mercado Libre';
        const rangeHint = fromDate
            ? (fromPreset === 'month'
                ? 'Mes corriente → hoy'
                : fromPreset === 'year'
                    ? 'Año corriente → hoy'
                    : `Desde ${esc(formatFromLabel(fromDate))} hasta hoy`)
            : (period === 'years'
                ? 'Últimos años con actividad'
                : `Últimos ${range} ${period === 'weeks' ? 'semanas' : 'meses'}`);

        return `
            <div class="dash-grid-kpi dash-grid-kpi-3">
                ${kpi('Cash in · periodo', Calc.fmtMXN(totalCash), '', rangeHint)}
                ${kpi('Ganancia · periodo', Calc.fmtMXN(totalGain), tone(totalGain), 'Tras fees y costo')}
                ${kpi('Unidades vendidas', String(totalUds), '', 'En el rango')}
            </div>
            <div class="dash-panel dash-chart-panel">
                <div class="dash-chart-filters">
                    <div class="dash-from-row">
                        <label class="dash-from-field"><span>Desde (año / mes / día)</span>
                            <input type="date" data-dash-from value="${esc(fromDate)}" max="${esc(toISODate(new Date()))}">
                        </label>
                        <div class="dash-from-presets" role="group" aria-label="Filtros rápidos">
                            <button type="button" class="dash-chip-btn${fromPreset === 'month' ? ' active' : ''}" data-dash-from-preset="month">Mes actual</button>
                            <button type="button" class="dash-chip-btn${fromPreset === 'year' ? ' active' : ''}" data-dash-from-preset="year">Año actual</button>
                            ${fromDate ? '<button type="button" class="dash-chip-btn" data-dash-from-clear>Quitar filtro</button>' : ''}
                        </div>
                    </div>
                    <div class="dash-seg" role="group" aria-label="Rango rápido" ${fromDate ? 'hidden' : ''}>
                        <button type="button" class="dash-seg-btn${range === 3 ? ' active' : ''}" data-dash-range="3">3</button>
                        <button type="button" class="dash-seg-btn${range === 6 ? ' active' : ''}" data-dash-range="6">6</button>
                        <button type="button" class="dash-seg-btn${range === 12 ? ' active' : ''}" data-dash-range="12">12</button>
                        <button type="button" class="dash-seg-btn${range === 24 ? ' active' : ''}" data-dash-range="24">24</button>
                    </div>
                    <button type="button" class="dash-chip-btn${showEmpty ? ' active' : ''}" data-dash-empty="${showEmpty ? '0' : '1'}">
                        ${showEmpty ? 'Ocultar vacíos' : 'Mostrar vacíos'}
                    </button>
                </div>
                ${renderProgressChart(chartType, chartSeries, { totalCash, totalGain, totalUds, period })}
                <p class="muted small dash-chart-note">
                    ${emptyHidden
                        ? 'Periodos sin ventas ocultos. Activa «Mostrar vacíos» para ver el calendario completo.'
                        : `Filtra por fecha exacta o usa Mes/Año actual · ${esc(mpLabel)}.`}
                </p>
            </div>
        `;
    }

    function buildProgressSeries(lotes, period, range = 12, fromISO = '') {
        const fromDate = parseISODate(fromISO);
        const map = new Map();
        const settings = window.State.settings;
        (lotes || []).forEach(lote => {
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];

            if (ventas.length) {
                ventas.forEach(v => {
                    const d = parseSaleDate(v.fecha);
                    if (!d) return;
                    if (fromDate && d < fromDate) return;
                    const key = periodKey(d, period);
                    if (!map.has(key)) map.set(key, emptyBucket(key, d, period));
                    const b = map.get(key);
                    const uds = Math.max(0, Number(v.unidades) || 0);
                    const precio = Number(v.precio) || 0;
                    const u = Calc.utilidadAtPrice(lote, precio, settings).utilidad;
                    b.cashIn += precio * uds;
                    b.ganancia += u * uds;
                    b.unidades += uds;
                    b.pedidos += 1;
                });
                return;
            }

            // Legacy: solo contador vendidas (sin eventos con fecha)
            const vendidas = Math.max(0, Number(lote.vendidas) || 0);
            if (!vendidas) return;
            const d = parseSaleDate(lote.fecha) || new Date();
            if (fromDate && d < fromDate) return;
            const key = periodKey(d, period);
            if (!map.has(key)) map.set(key, emptyBucket(key, d, period));
            const b = map.get(key);
            const precio = Number(lote.precio) || 0;
            const calc = Calc.computeLote(lote, settings);
            b.cashIn += precio * vendidas;
            b.ganancia += (Number(calc.utilidad) || 0) * vendidas;
            b.unidades += vendidas;
            b.pedidos += 1;
        });

        const now = new Date();
        const fromKey = fromDate ? periodKey(fromDate, period) : '';
        const keys = buildPeriodKeys(period, range, fromKey, now);

        return keys.map(k => {
            if (map.has(k)) return map.get(k);
            const d = parsePeriodKey(k, period);
            return emptyBucket(k, d, period);
        });
    }

    function buildPeriodKeys(period, range, fromKey, now = new Date()) {
        const keys = [];
        const endKey = periodKey(now, period);
        if (fromKey) {
            // Desde inicio elegido hasta hoy (tope 48 buckets)
            let d = parsePeriodKey(fromKey, period);
            if (!d || Number.isNaN(d.getTime())) d = now;
            const end = parsePeriodKey(endKey, period);
            let guard = 0;
            while (guard < 48) {
                const k = periodKey(d, period);
                keys.push(k);
                if (k === endKey) break;
                if (d > end) break;
                if (period === 'years') d = new Date(d.getFullYear() + 1, 0, 1);
                else if (period === 'weeks') d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
                else d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
                guard += 1;
            }
            return keys.length ? keys : [endKey];
        }
        if (period === 'years') {
            const yNow = now.getFullYear();
            for (let y = yNow - 4; y <= yNow; y++) keys.push(String(y));
        } else if (period === 'weeks') {
            const start = startOfWeek(now);
            for (let i = range - 1; i >= 0; i--) {
                const d = new Date(start);
                d.setDate(d.getDate() - i * 7);
                keys.push(periodKey(d, 'weeks'));
            }
        } else {
            for (let i = range - 1; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                keys.push(periodKey(d, 'months'));
            }
        }
        return keys;
    }

    function emptyBucket(key, d, period) {
        return {
            key,
            label: periodLabel(d, period),
            tip: periodTip(d, period),
            cashIn: 0,
            ganancia: 0,
            unidades: 0,
            pedidos: 0,
        };
    }

    function periodKey(d, period) {
        if (period === 'years') return String(d.getFullYear());
        if (period === 'weeks') {
            const s = startOfWeek(d);
            return `W-${s.getFullYear()}-${pad2(s.getMonth() + 1)}-${pad2(s.getDate())}`;
        }
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    }

    function parsePeriodKey(key, period) {
        if (period === 'years') return new Date(Number(key), 0, 1);
        if (period === 'weeks') {
            const m = String(key).match(/^W-(\d{4})-(\d{2})-(\d{2})$/);
            if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
            return new Date();
        }
        const [y, mo] = String(key).split('-').map(Number);
        return new Date(y, (mo || 1) - 1, 1);
    }

    function periodLabel(d, period) {
        if (period === 'years') return String(d.getFullYear());
        if (period === 'weeks') {
            return `${d.getDate()}/${d.getMonth() + 1}`;
        }
        const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return `${months[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
    }

    function periodTip(d, period) {
        if (period === 'years') return `Año ${d.getFullYear()}`;
        if (period === 'weeks') {
            const end = new Date(d);
            end.setDate(end.getDate() + 6);
            return `Semana ${fmtDMY(d)} – ${fmtDMY(end)}`;
        }
        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return `${months[d.getMonth()]} ${d.getFullYear()}`;
    }

    function startOfWeek(d) {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const day = (x.getDay() + 6) % 7; // lunes = 0
        x.setDate(x.getDate() - day);
        return x;
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function fmtDMY(d) {
        return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
    }

    function parseSaleDate(raw) {
        if (!raw) return null;
        const s = String(raw).trim();
        let d = null;
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
            const [y, m, day] = s.slice(0, 10).split('-').map(Number);
            d = new Date(y, m - 1, day);
        } else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) {
            const [a, b, c] = s.split(/[\/-]/).map(Number);
            const y = c < 100 ? 2000 + c : c;
            d = new Date(y, b - 1, a);
        } else {
            const t = Date.parse(s);
            if (!Number.isNaN(t)) d = new Date(t);
        }
        return d && !Number.isNaN(d.getTime()) ? d : null;
    }


    function renderProgressChart(type, buckets, ctx = {}) {
        if (!buckets.length) {
            return '<p class="muted small dash-chart-empty">Sin ventas en el periodo</p>';
        }
        if (type === 'bars') return chartBarsPanel(buckets, ctx);
        if (type === 'lines') return chartSparkPanel(buckets, ctx, { areaMode: 'none' });
        if (type === 'area') return chartSparkPanel(buckets, ctx, { areaMode: 'both' });
        return chartHero(buckets, ctx);
    }

    function chartHero(buckets, ctx = {}) {
        const withData = buckets
            .map((b, i) => ({ b, i }))
            .filter(x => x.b.cashIn > 0 || x.b.ganancia > 0 || x.b.unidades > 0);
        const cur = withData.length ? withData[withData.length - 1] : { b: buckets[buckets.length - 1], i: buckets.length - 1 };
        const prev = withData.length >= 2 ? withData[withData.length - 2] : null;
        const deltaGain = prev ? cur.b.ganancia - prev.b.ganancia : null;
        const deltaPct = prev && Math.abs(prev.b.ganancia) > 0.009
            ? (deltaGain / Math.abs(prev.b.ganancia)) * 100
            : (prev && Math.abs(deltaGain) > 0.009 ? (deltaGain > 0 ? 100 : -100) : null);
        const periodWord = ctx.period === 'weeks' ? 'semana' : ctx.period === 'years' ? 'año' : 'periodo';
        const spark = progressSpark(buckets, { focusIndex: cur.i, areaMode: 'gain' });
        const deltaHtml = deltaPct == null
            ? '<span class="dash-hero-delta is-na">Sin periodo previo</span>'
            : `<span class="dash-hero-delta ${tone(deltaGain)}" title="vs ${esc(prev.b.label)}: ${Calc.fmtMXN(deltaGain)}">
                    ${deltaGain >= 0 ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(0)}% vs ${esc(periodWord)} anterior
               </span>`;

        return `
            <div class="dash-hero-chart">
                <div class="dash-hero-main">
                    <div class="dash-hero-label">Ganancia del periodo</div>
                    <div class="dash-hero-value ${tone(ctx.totalGain)}">${Calc.fmtMXN(ctx.totalGain || 0)}</div>
                    ${deltaHtml}
                    <div class="dash-hero-sub muted">
                        Cash in ${Calc.fmtMXN(ctx.totalCash || 0)} · ${ctx.totalUds || 0} uds
                        · Último con datos: ${esc(cur.b.tip || cur.b.label || '—')}
                    </div>
                </div>
                <div class="dash-hero-spark" data-focus-index="${cur.i}">
                    ${spark}
                    ${chartLegendAndDetail()}
                </div>
            </div>`;
    }

    function chartSparkPanel(buckets, ctx = {}, opts = {}) {
        const withData = buckets
            .map((b, i) => ({ b, i }))
            .filter(x => x.b.cashIn > 0 || x.b.ganancia > 0 || x.b.unidades > 0);
        const focusIndex = withData.length ? withData[withData.length - 1].i : buckets.length - 1;
        return `
            <div class="dash-chart-plain" data-focus-index="${focusIndex}">
                ${deltaStrip(buckets, ctx)}
                ${progressSpark(buckets, { focusIndex, areaMode: opts.areaMode || 'none' })}
                ${chartLegendAndDetail()}
            </div>`;
    }

    function chartBarsPanel(buckets, ctx = {}) {
        const withData = buckets
            .map((b, i) => ({ b, i }))
            .filter(x => x.b.cashIn > 0 || x.b.ganancia > 0 || x.b.unidades > 0);
        const focusIndex = withData.length ? withData[withData.length - 1].i : buckets.length - 1;
        const maxV = Math.max(...buckets.flatMap(b => [b.cashIn, Math.abs(b.ganancia)]), 1);
        return `
            <div class="dash-chart-plain" data-focus-index="${focusIndex}">
                ${deltaStrip(buckets, ctx)}
                <div class="dash-progress-chart" role="img" aria-label="Barras cash y ganancia">
                    <div class="dash-progress-y">
                        <span>${shortMoney(maxV)}</span>
                        <span>${shortMoney(maxV / 2)}</span>
                        <span>$0</span>
                    </div>
                    <div class="dash-progress-plot">
                        <div class="dash-progress-grid" aria-hidden="true"></div>
                        <div class="dash-progress-cols">
                            ${buckets.map((b, i) => {
                                const hCash = Math.max(b.cashIn > 0 ? 4 : 0, Math.round((b.cashIn / maxV) * 100));
                                const hGain = Math.max(Math.abs(b.ganancia) > 0 ? 4 : 0, Math.round((Math.abs(b.ganancia) / maxV) * 100));
                                return `
                                    <div class="dash-progress-col${i === focusIndex ? ' is-focus' : ''}"
                                        role="button" tabindex="0"
                                        data-dash-point="${i}"
                                        data-label="${esc(b.label)}"
                                        data-tip="${esc(b.tip)}"
                                        data-cash="${b.cashIn}"
                                        data-gain="${b.ganancia}"
                                        data-uds="${b.unidades}"
                                        data-pedidos="${b.pedidos || 0}">
                                        <div class="dash-progress-bars">
                                            <div class="pb pb-cash" style="height:${hCash}%"></div>
                                            <div class="pb pb-gain ${b.ganancia < 0 ? 'is-neg' : ''}" style="height:${hGain}%"></div>
                                        </div>
                                        <div class="dash-progress-x">${esc(b.label)}</div>
                                    </div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>
                ${chartLegendAndDetail()}
            </div>`;
    }

    function deltaStrip(buckets, ctx = {}) {
        const withData = buckets
            .map((b, i) => ({ b, i }))
            .filter(x => x.b.cashIn > 0 || x.b.ganancia > 0 || x.b.unidades > 0);
        const cur = withData.length ? withData[withData.length - 1] : null;
        const prev = withData.length >= 2 ? withData[withData.length - 2] : null;
        if (!cur || !prev) {
            return `<div class="dash-delta-strip"><span class="dash-hero-delta is-na">Sin periodo previo para comparar</span>
                <span class="muted small">Total ganancia ${Calc.fmtMXN(ctx.totalGain || 0)}</span></div>`;
        }
        const deltaGain = cur.b.ganancia - prev.b.ganancia;
        const deltaPct = Math.abs(prev.b.ganancia) > 0.009
            ? (deltaGain / Math.abs(prev.b.ganancia)) * 100
            : (Math.abs(deltaGain) > 0.009 ? (deltaGain > 0 ? 100 : -100) : 0);
        const periodWord = ctx.period === 'weeks' ? 'semana' : ctx.period === 'years' ? 'año' : 'periodo';
        return `<div class="dash-delta-strip">
            <span class="dash-hero-delta ${tone(deltaGain)}">${deltaGain >= 0 ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(0)}% vs ${esc(periodWord)} anterior</span>
            <span class="muted small">Total ganancia ${Calc.fmtMXN(ctx.totalGain || 0)} · Cash ${Calc.fmtMXN(ctx.totalCash || 0)}</span>
        </div>`;
    }

    function chartLegendAndDetail() {
        return `
            <div class="dash-chart-legend">
                <span class="leg-gain">Ganancia</span>
                <span class="leg-cash">Cash in</span>
            </div>
            <div class="dash-spark-detail muted small" data-dash-spark-detail>
                Pasa el cursor o toca un punto del gráfico.
            </div>`;
    }

    function progressSpark(buckets, opts = {}) {
        const W = 640, H = 180, padL = 8, padR = 8, padT = 12, padB = 28;
        const n = buckets.length;
        const focusIndex = Number.isFinite(opts.focusIndex) ? opts.focusIndex : -1;
        const areaMode = opts.areaMode || 'gain'; // gain | both | none
        const xAt = i => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
        const maxV = Math.max(
            ...buckets.flatMap(b => [Math.abs(b.ganancia), Math.abs(b.cashIn)]),
            1,
        );
        const yAt = v => padT + (1 - Math.max(0, v) / maxV) * (H - padT - padB);
        const gainVals = buckets.map(b => Math.max(0, b.ganancia));
        const cashVals = buckets.map(b => Math.max(0, b.cashIn));
        const pathFor = vals => vals.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
        const gainPath = pathFor(gainVals);
        const cashPath = pathFor(cashVals);
        const base = H - padB;
        const areaFor = (path) => `${path} L${xAt(n - 1).toFixed(1)},${base} L${xAt(0).toFixed(1)},${base} Z`;

        let areas = '';
        if (areaMode === 'gain' || areaMode === 'both') areas += `<path class="dash-area-gain" d="${areaFor(gainPath)}" />`;
        if (areaMode === 'both') areas += `<path class="dash-area-cash" d="${areaFor(cashPath)}" />`;

        // Franjas verticales (no círculos): con preserveAspectRatio=none los
        // círculos se aplastan y el hit activo se veía como un óvalo azul inútil.
        const band = n <= 1 ? (W - padL - padR) : (W - padL - padR) / (n - 1);
        const hitW = Math.max(18, Math.min(48, band * 0.9));
        const marks = buckets.map((b, i) => {
            const gx = xAt(i);
            const gy = yAt(gainVals[i]);
            const cy = yAt(cashVals[i]);
            const active = i === focusIndex ? ' is-focus' : '';
            const hx = Math.max(0, gx - hitW / 2);
            return `
                <g class="dash-pt${active}" data-dash-point="${i}">
                    <rect class="dash-hit"
                        x="${hx.toFixed(1)}" y="${padT}"
                        width="${hitW.toFixed(1)}" height="${(H - padT - padB).toFixed(1)}"
                        tabindex="0" role="button"
                        data-dash-point="${i}"
                        data-label="${esc(b.label)}"
                        data-tip="${esc(b.tip)}"
                        data-cash="${b.cashIn}"
                        data-gain="${b.ganancia}"
                        data-uds="${b.unidades}"
                        data-pedidos="${b.pedidos || 0}">
                        <title>${esc(b.tip)}</title>
                    </rect>
                    <circle class="dash-dot-cash" cx="${gx}" cy="${cy}" r="3"></circle>
                    <circle class="dash-dot-gain" cx="${gx}" cy="${gy}" r="3.5"></circle>
                </g>`;
        }).join('');

        return `
            <div class="dash-progress-chart dash-progress-line" role="img" aria-label="Tendencia de ganancia y cash in">
                <div class="dash-progress-y">
                    <span>${shortMoney(maxV)}</span>
                    <span>${shortMoney(maxV / 2)}</span>
                    <span>$0</span>
                </div>
                <div class="dash-progress-plot">
                    <div class="dash-progress-grid" aria-hidden="true"></div>
                    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="dash-line-svg">
                        ${areas}
                        <path class="dash-line-gain" d="${gainPath}" fill="none" />
                        <path class="dash-line-cash" d="${cashPath}" fill="none" />
                        ${marks}
                    </svg>
                    <div class="dash-progress-xlabels">
                        ${buckets.map(b => `<span title="${esc(b.tip)}">${esc(b.label)}</span>`).join('')}
                    </div>
                </div>
            </div>`;
    }

    function formatSparkDetail(el) {
        if (!el) return 'Pasa el cursor o toca un punto del gráfico.';
        const tip = el.dataset.tip || el.dataset.label || 'Periodo';
        const cash = Number(el.dataset.cash) || 0;
        const gain = Number(el.dataset.gain) || 0;
        const uds = Number(el.dataset.uds) || 0;
        const pedidos = Number(el.dataset.pedidos) || 0;
        return `<strong>${esc(tip)}</strong> · Cash ${Calc.fmtMXN(cash)} · Ganancia <span class="${tone(gain)}">${Calc.fmtMXN(gain)}</span> · ${uds} uds · ${pedidos} venta${pedidos === 1 ? '' : 's'}`;
    }

    function shortMoney(n) {
        const v = Math.abs(n);
        if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
        if (v >= 1e3) return `$${(n / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
        return `$${Math.round(n)}`;
    }

    function buildContext(agg) {
        const rows = agg.rows;
        const isAmazon = window.State.marketplace === 'amazon';
        let fees = 0;
        let costoVendido = 0;
        let gastoAds = 0;
        rows.forEach(({ lote, calc }) => {
            const v = calc.vendidas;
            fees += (calc.comisionVariable + calc.cargoFijo + calc.retIVA + calc.retISR) * v;
            if (isAmazon) {
                fees += ((Number(calc.envio) || 0) + (Number(calc.almacenamiento) || 0)) * v;
            }
            costoVendido += (Number(lote.costo) || 0) * v;
            gastoAds += calc.gastoAds;
        });
        return { agg, rows, fees, costoVendido, gastoAds, isAmazon };
    }

    function layPyG({ agg, fees, costoVendido, gastoAds, isAmazon }) {
        const bruto = agg.cashIn - costoVendido;
        const neto = agg.gananciaRealizada;
        const feeLabel = isAmazon
            ? '− Fees Amazon (est.)'
            : '− Fees ML + retenciones (est.)';
        const lines = [
            { label: 'Ingresos (cash in)', value: agg.cashIn },
            { label: '− Costo de lo vendido', value: -costoVendido },
            { label: '= Utilidad bruta est.', value: bruto, bold: true },
            { label: feeLabel, value: -fees },
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

    const ALLOC_BUCKETS = [
        { key: 'reinversion', label: 'Reinversión', hint: 'Reponer stock' },
        { key: 'reserva', label: 'Reserva', hint: 'Colchón / imprevistos' },
        { key: 'ads', label: 'Ads', hint: 'Presupuesto publicidad' },
        { key: 'insumos', label: 'Insumos', hint: 'Empaque, etiquetas, consumibles' },
        { key: 'utilidad', label: 'Utilidad', hint: 'Tu ganancia / sacar a cuenta' },
    ];

    function allocMpKey() {
        return window.State.marketplace === 'amazon' ? 'amazon' : 'meli';
    }

    function emptyAllocBuckets() {
        return { reinversion: 0, reserva: 0, ads: 0, insumos: 0, utilidad: 0 };
    }

    function defaultAllocPercents() {
        return { reinversion: 35, reserva: 20, ads: 15, insumos: 15, utilidad: 15 };
    }

    /** Migra claves viejas: retiro→utilidad, fondo→reserva. */
    function migrateLegacyAllocMaps(obj) {
        if (!obj || typeof obj !== 'object') return {};
        const out = { ...obj };
        if (out.retiro != null && out.utilidad == null) out.utilidad = out.retiro;
        delete out.retiro;
        if (out.fondo != null && out.reserva == null) out.reserva = out.fondo;
        delete out.fondo;
        return out;
    }

    function migrateLedgerEntry(entry) {
        if (!entry || typeof entry !== 'object') return entry;
        const splits = migrateLegacyAllocMaps(entry.splits || {});
        let meta = entry.meta && typeof entry.meta === 'object' ? { ...entry.meta } : entry.meta;
        if (meta?.bucket === 'retiro') meta = { ...meta, bucket: 'utilidad' };
        if (meta?.bucket === 'fondo') meta = { ...meta, bucket: 'reserva' };
        return { ...entry, splits, meta };
    }

    function formatSplitLine(splits) {
        const s = migrateLegacyAllocMaps(splits || {});
        return `→ R ${Calc.fmtMXN(s.reinversion || 0)} · S ${Calc.fmtMXN(s.reserva || 0)} · A ${Calc.fmtMXN(s.ads || 0)} · I ${Calc.fmtMXN(s.insumos || 0)} · U ${Calc.fmtMXN(s.utilidad || 0)}`;
    }

    function round2(n) {
        return Math.round((Number(n) || 0) * 100) / 100;
    }

    function normalizePercents(raw) {
        const src = migrateLegacyAllocMaps(raw);
        const out = emptyAllocBuckets();
        let any = false;
        ALLOC_BUCKETS.forEach(({ key }) => {
            const n = Number(src[key]);
            if (Number.isFinite(n) && n >= 0) {
                out[key] = n;
                any = true;
            }
        });
        if (!any) return defaultAllocPercents();
        const sum = ALLOC_BUCKETS.reduce((s, b) => s + (out[b.key] || 0), 0);
        if (sum <= 0) return defaultAllocPercents();
        if (Math.abs(sum - 100) > 0.05) {
            ALLOC_BUCKETS.forEach(({ key }, i) => {
                if (i === ALLOC_BUCKETS.length - 1) {
                    const others = ALLOC_BUCKETS.slice(0, -1).reduce((s, b) => s + out[b.key], 0);
                    out[key] = round2(100 - others);
                } else {
                    out[key] = round2((out[key] / sum) * 100);
                }
            });
        }
        return out;
    }

    /** Calcula % nuevos fijando una bolsita y repartiendo el resto proporcionalmente. */
    function previewPercentsForKey(key, pct, basePercents) {
        const clamped = Math.max(0, Math.min(100, round2(pct)));
        const base = basePercents && typeof basePercents === 'object' ? basePercents : defaultAllocPercents();
        const next = { ...base, [key]: clamped };
        const others = ALLOC_BUCKETS.filter(b => b.key !== key);
        const rest = round2(100 - clamped);
        const othersSum = others.reduce((s, b) => s + (Number(base[b.key]) || 0), 0);

        if (rest <= 0) {
            others.forEach(b => { next[b.key] = 0; });
        } else if (othersSum <= 0) {
            const each = round2(rest / others.length);
            let used = 0;
            others.forEach((b, i) => {
                if (i === others.length - 1) next[b.key] = round2(rest - used);
                else {
                    next[b.key] = each;
                    used = round2(used + each);
                }
            });
        } else {
            let used = 0;
            others.forEach((b, i) => {
                if (i === others.length - 1) {
                    next[b.key] = round2(rest - used);
                } else {
                    const share = round2(rest * ((Number(base[b.key]) || 0) / othersSum));
                    next[b.key] = share;
                    used = round2(used + share);
                }
            });
        }
        return next;
    }

    /** Fija el % de una bolsita, reparte el resto entre las otras y rebalancea montos actuales. */
    function setBucketPercent(key, pct) {
        const state = readAllocState();
        const next = previewPercentsForKey(key, pct, state.percents);
        const total = round2(ALLOC_BUCKETS.reduce((s, b) => s + (state.buckets[b.key] || 0), 0));
        const buckets = total > 0 ? splitByPercents(total, next) : { ...state.buckets };
        writeAllocState({ percents: next, buckets });
        return { percents: next, buckets, total };
    }

    function getDashScrollEl() {
        return document.querySelector('#dashboard-canvas .dash-body')
            || document.querySelector('.content');
    }

    function renderPreservingScroll(anchorSel = null) {
        const scroller = getDashScrollEl();
        const y = scroller ? scroller.scrollTop : window.scrollY;
        render();
        const restore = () => {
            const next = getDashScrollEl();
            if (next) next.scrollTop = y;
            else window.scrollTo(0, y);
            if (anchorSel) {
                const el = document.querySelector(anchorSel);
                el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        };
        requestAnimationFrame(() => {
            restore();
            requestAnimationFrame(restore);
        });
    }

    function splitByPercents(amount, percents) {
        const amt = round2(amount);
        const pct = normalizePercents(percents);
        const splits = emptyAllocBuckets();
        if (amt <= 0) return splits;
        let used = 0;
        ALLOC_BUCKETS.forEach(({ key }, i) => {
            if (i === ALLOC_BUCKETS.length - 1) {
                splits[key] = round2(amt - used);
            } else {
                splits[key] = round2(amt * (pct[key] / 100));
                used = round2(used + splits[key]);
            }
        });
        return splits;
    }

    function addSplits(buckets, splits, sign = 1) {
        const next = { ...emptyAllocBuckets(), ...buckets };
        ALLOC_BUCKETS.forEach(({ key }) => {
            next[key] = Math.max(0, round2((next[key] || 0) + sign * (splits[key] || 0)));
        });
        return next;
    }

    function readAllocState() {
        const mp = allocMpKey();
        const store = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        const raw = store[mp] && typeof store[mp] === 'object' ? store[mp] : {};
        const buckets = emptyAllocBuckets();
        const src = migrateLegacyAllocMaps(raw.buckets && typeof raw.buckets === 'object' ? raw.buckets : {});
        ALLOC_BUCKETS.forEach(({ key }) => {
            const n = Number(src[key]);
            buckets[key] = Number.isFinite(n) && n > 0 ? round2(n) : 0;
        });
        const injections = Array.isArray(raw.injections) ? raw.injections : [];
        const ledger = (Array.isArray(raw.ledger) ? raw.ledger : []).map(migrateLedgerEntry);
        const injected = Number.isFinite(Number(raw.injected))
            ? round2(raw.injected)
            : round2(injections.reduce((s, x) => s + (Number(x.amount) || 0), 0));
        const liberated = Number.isFinite(Number(raw.liberated))
            ? round2(raw.liberated)
            : round2(ledger.filter(x => x.type === 'sale').reduce((s, x) => s + (Number(x.amount) || 0), 0));
        return {
            mp,
            percents: normalizePercents(raw.percents),
            buckets,
            injected,
            liberated,
            injections,
            ledger,
        };
    }

    function allocHasLegacyKeys(raw) {
        if (!raw || typeof raw !== 'object') return false;
        const maps = [raw.buckets, raw.percents];
        if (maps.some(m => m && (m.fondo != null || m.retiro != null))) return true;
        return (Array.isArray(raw.ledger) ? raw.ledger : []).some(e =>
            e?.splits?.fondo != null || e?.splits?.retiro != null
            || e?.meta?.bucket === 'fondo' || e?.meta?.bucket === 'retiro'
        );
    }

    /** Persiste migración de claves viejas en meli y amazon. */
    function persistAllocMigrations() {
        const prev = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        let changed = false;
        const nextStore = { ...prev };
        ['meli', 'amazon'].forEach(mp => {
            const raw = prev[mp];
            if (!allocHasLegacyKeys(raw)) return;
            const active = allocMpKey();
            // Lee estado migrado sin pisar el marketplace activo del State
            const buckets = emptyAllocBuckets();
            const src = migrateLegacyAllocMaps(raw.buckets && typeof raw.buckets === 'object' ? raw.buckets : {});
            ALLOC_BUCKETS.forEach(({ key }) => {
                const n = Number(src[key]);
                buckets[key] = Number.isFinite(n) && n > 0 ? round2(n) : 0;
            });
            nextStore[mp] = {
                ...raw,
                percents: normalizePercents(raw.percents),
                buckets,
                injected: round2(Number(raw.injected) || 0),
                liberated: round2(Number(raw.liberated) || 0),
                injections: Array.isArray(raw.injections) ? raw.injections.slice(-40) : [],
                ledger: (Array.isArray(raw.ledger) ? raw.ledger : []).map(migrateLedgerEntry).slice(-80),
            };
            changed = true;
            void active;
        });
        if (!changed) return;
        window.State.ui = { ...window.State.ui, capitalAlloc: nextStore };
        window.State.saveUI();
    }

    function writeAllocState(next) {
        const mp = allocMpKey();
        const prev = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        const cur = { ...readAllocState(), ...next };
        window.State.ui = {
            ...window.State.ui,
            capitalAlloc: {
                ...prev,
                [mp]: {
                    percents: normalizePercents(cur.percents),
                    buckets: { ...emptyAllocBuckets(), ...migrateLegacyAllocMaps(cur.buckets) },
                    injected: round2(cur.injected),
                    liberated: round2(cur.liberated),
                    injections: Array.isArray(cur.injections) ? cur.injections.slice(-40) : [],
                    ledger: Array.isArray(cur.ledger) ? cur.ledger.map(migrateLedgerEntry).slice(-80) : [],
                },
            },
        };
        window.State.saveUI();
    }

    function distributeAmount(amount, { type, meta = {} } = {}) {
        const amt = round2(amount);
        if (amt <= 0) return null;
        const state = readAllocState();
        const splits = splitByPercents(amt, state.percents);
        const entry = {
            id: `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: type || 'manual',
            amount: amt,
            at: Date.now(),
            splits,
            meta,
        };
        const patch = {
            buckets: addSplits(state.buckets, splits, 1),
            ledger: [...state.ledger, entry],
        };
        if (type === 'sale') patch.liberated = round2(state.liberated + amt);
        writeAllocState(patch);
        return entry;
    }

    function applySaleLiberation(amount, meta = {}) {
        const state = readAllocState();
        // Evita duplicar la misma venta
        if (meta?.ventaId && state.ledger.some(x => x.type === 'sale' && x.meta?.ventaId === meta.ventaId)) {
            return null;
        }
        return distributeAmount(amount, { type: 'sale', meta });
    }

    function listUnassignedVentas() {
        const state = readAllocState();
        const assigned = new Set(
            state.ledger.filter(x => x.type === 'sale' && x.meta?.ventaId).map(x => x.meta.ventaId),
        );
        const out = [];
        (window.State.lotes || []).forEach(lote => {
            (lote.ventas || []).forEach(v => {
                if (!v?.id || assigned.has(v.id)) return;
                const uds = Math.max(0, Number(v.unidades) || 0);
                const precio = Number(v.precio) || 0;
                if (uds <= 0 || precio <= 0) return;
                let utilidad = 0;
                try {
                    utilidad = Number(Calc.utilidadAtPrice(lote, precio, window.State.settings).utilidad) || 0;
                } catch { utilidad = 0; }
                const amount = round2((Math.max(0, Number(lote.costo) || 0) + utilidad) * uds);
                if (amount <= 0) return;
                out.push({
                    ventaId: v.id,
                    loteId: lote.id,
                    fecha: v.fecha,
                    producto: lote.producto || lote.sku || 'Producto',
                    unidades: uds,
                    precio,
                    amount,
                });
            });
        });
        out.sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
        return out;
    }

    function syncMissingSalesToAlloc() {
        const pending = listUnassignedVentas();
        let n = 0;
        let total = 0;
        pending.forEach(p => {
            const entry = applySaleLiberation(p.amount, {
                ventaId: p.ventaId,
                loteId: p.loteId,
                unidades: p.unidades,
                precio: p.precio,
                fecha: p.fecha,
                backfill: true,
            });
            if (entry) {
                n += 1;
                total = round2(total + p.amount);
            }
        });
        return { n, total, pending: pending.length };
    }

    function reverseSaleLiberation(ventaId) {
        if (!ventaId) return false;
        // Busca en el marketplace activo; si no, en el otro (por si cambiaste de tab).
        const tryMp = (mp) => {
            const store = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
                ? window.State.ui.capitalAlloc
                : {};
            const raw = store[mp] && typeof store[mp] === 'object' ? store[mp] : null;
            if (!raw || !Array.isArray(raw.ledger)) return null;
            const idx = raw.ledger.findIndex(x => x.type === 'sale' && x.meta?.ventaId === ventaId);
            if (idx < 0) return null;
            return { mp, raw, idx, entry: raw.ledger[idx] };
        };
        const hit = tryMp(allocMpKey()) || tryMp(allocMpKey() === 'amazon' ? 'meli' : 'amazon');
        if (!hit) return false;

        const { mp, raw, idx, entry } = hit;
        const ledger = raw.ledger.slice();
        ledger.splice(idx, 1);
        const buckets = emptyAllocBuckets();
        const src = migrateLegacyAllocMaps(raw.buckets && typeof raw.buckets === 'object' ? raw.buckets : {});
        ALLOC_BUCKETS.forEach(({ key }) => {
            const n = Number(src[key]);
            buckets[key] = Number.isFinite(n) && n > 0 ? round2(n) : 0;
        });
        const splits = migrateLegacyAllocMaps(entry.splits || {});
        const liberated = Math.max(0, round2((Number(raw.liberated) || 0) - (Number(entry.amount) || 0)));
        const prev = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        window.State.ui = {
            ...window.State.ui,
            capitalAlloc: {
                ...prev,
                [mp]: {
                    ...raw,
                    buckets: addSplits(buckets, splits, -1),
                    liberated,
                    ledger,
                },
            },
        };
        window.State.saveUI();
        return true;
    }

    function spendFromBucket(key, amount, note = '') {
        if (!ALLOC_BUCKETS.some(b => b.key === key)) return null;
        const amt = round2(amount);
        if (!(amt > 0)) return null;
        const state = readAllocState();
        const available = round2(state.buckets[key] || 0);
        if (available <= 0) return null;
        const spent = Math.min(amt, available);
        const nextBuckets = { ...state.buckets, [key]: round2(available - spent) };
        const splits = emptyAllocBuckets();
        splits[key] = spent;
        const entry = {
            id: `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'spend',
            amount: spent,
            at: Date.now(),
            splits,
            meta: {
                bucket: key,
                note: String(note || '').trim(),
                remaining: nextBuckets[key],
            },
        };
        writeAllocState({
            buckets: nextBuckets,
            ledger: [...state.ledger, entry],
        });
        return { entry, remaining: nextBuckets[key], spent, available };
    }

    function layAsignacion(ctx) {
        const state = readAllocState();
        const { buckets, percents, injected, liberated } = state;
        const totalBuckets = round2(ALLOC_BUCKETS.reduce((s, b) => s + (buckets[b.key] || 0), 0));
        const uds = Math.max(0, Number(ctx.agg?.totalVendidas) || 0);
        const unitCost = uds > 0 ? (Number(ctx.costoVendido) || 0) / uds : 0;
        const reinvestUds = unitCost > 0 ? buckets.reinversion / unitCost : 0;
        const pctSum = round2(ALLOC_BUCKETS.reduce((s, b) => s + (percents[b.key] || 0), 0));
        const pendingSales = listUnassignedVentas();
        const recentSales = [...state.ledger].filter(x => x.type === 'sale').reverse().slice(0, 5);
        const recentSpends = [...state.ledger].filter(x => x.type === 'spend').reverse().slice(0, 5);
        const shareOf = (val) => totalBuckets > 0 ? Math.round((val / totalBuckets) * 1000) / 10 : 0;

        const bolsitasCards = ALLOC_BUCKETS.map(b => {
            const val = buckets[b.key] || 0;
            const share = shareOf(val);
            const extra = b.key === 'reinversion' && unitCost > 0 && val > 0
                ? `≈ ${reinvestUds.toFixed(1)} uds al costo avg`
                : esc(b.hint);
            return `
                <div class="dash-bolsa alloc-${b.key}" data-bolsa="${b.key}">
                    <div class="dash-bolsa-top">
                        <div class="dash-bolsa-name">${esc(b.label)}</div>
                        <button type="button" class="dash-bolsa-use-btn" data-bolsa-use="${b.key}"
                            title="Registrar uso" aria-label="Usar dinero de ${esc(b.label)}">usar</button>
                    </div>
                    <div class="dash-bolsa-amt" data-bolsa-amt>${Calc.fmtMXN(val)}</div>
                    <button type="button" class="dash-bolsa-share" data-bolsa-edit="${b.key}"
                        title="Ajustar %" aria-label="Ajustar porcentaje de ${esc(b.label)}">
                        <span data-bolsa-share>${percents[b.key]}% de cada venta · ${share}% actual</span>
                        <span class="dash-bolsa-adjust">ajustar</span>
                    </button>
                    <div class="dash-bolsa-meta" data-bolsa-meta>${extra}</div>
                    <div class="dash-bolsa-edit-panel" hidden>
                        <label>
                            <span>% de cada venta <strong data-bolsa-pct-live>${percents[b.key]}%</strong></span>
                            <input type="range" min="0" max="100" step="1" data-bolsa-pct-range="${b.key}" value="${percents[b.key]}">
                            <input type="number" min="0" max="100" step="1" data-bolsa-pct-input="${b.key}" value="${percents[b.key]}">
                        </label>
                        <p class="muted small dash-bolsa-edit-hint">Mueve el control: las otras bolsitas se ajustan al instante. Guardar confirma.</p>
                        <div class="dash-bolsa-edit-actions">
                            <button type="button" class="btn primary btn-sm" data-bolsa-pct-save="${b.key}">Guardar</button>
                            <button type="button" class="btn ghost btn-sm" data-bolsa-pct-cancel="${b.key}">Cancelar</button>
                        </div>
                    </div>
                    <div class="dash-bolsa-use-panel" hidden>
                        <label>
                            <span>Usaste de ${esc(b.label)} (MXN)</span>
                            <input type="number" min="0" step="1" max="${val}" data-bolsa-use-amt="${b.key}" placeholder="ej. 200">
                        </label>
                        <p class="muted small dash-bolsa-edit-hint" data-bolsa-use-remain="${b.key}">
                            Disponible ${Calc.fmtMXN(val)}. Al restar verás cuánto queda.
                        </p>
                        <div class="dash-bolsa-edit-actions">
                            <button type="button" class="btn primary btn-sm" data-bolsa-use-save="${b.key}">Restar</button>
                            <button type="button" class="btn ghost btn-sm" data-bolsa-use-cancel="${b.key}">Cancelar</button>
                        </div>
                    </div>
                </div>`;
        }).join('');

        const stackSegments = totalBuckets > 0
            ? ALLOC_BUCKETS.map(b => {
                const val = buckets[b.key] || 0;
                if (val <= 0) return '';
                const w = Math.max(2, (val / totalBuckets) * 100);
                return `<span class="dash-bolsa-seg alloc-${b.key}" style="width:${w.toFixed(1)}%" title="${esc(b.label)}: ${Calc.fmtMXN(val)}"></span>`;
            }).join('')
            : '<span class="dash-bolsa-seg is-empty">Sin dinero en bolsitas aún</span>';

        return `
            <div class="dash-panel dash-alloc-panel">
                <div class="dash-alloc-head">
                    <div>
                        <h3>Mis bolsitas</h3>
                        <p class="muted small">
                            Cada venta se reparte sola. Si eliminas una venta (devolución), se resta.
                            Toca el % para ajustarlo · <em>usar</em> para restar lo que ya gastaste.
                        </p>
                    </div>
                    <div class="dash-alloc-actions">
                        <button type="button" class="dash-chip-btn" data-alloc-equal-pct>% iguales</button>
                        <button type="button" class="dash-chip-btn" data-alloc-reset-buckets>Vaciar sobres</button>
                    </div>
                </div>

                <div class="dash-bolsa-hero">
                    <div class="dash-bolsa-hero-main">
                        <div class="dash-bolsa-hero-label">Total distribuido en bolsitas</div>
                        <div class="dash-bolsa-hero-value">${Calc.fmtMXN(totalBuckets)}</div>
                        <div class="dash-bolsa-hero-sub muted">
                            Liberado por ventas ${Calc.fmtMXN(liberated)}
                            ${injected > 0 ? ` · inyectado (histórico) ${Calc.fmtMXN(injected)}` : ''}
                            · reglas ${pctSum}%
                        </div>
                    </div>
                    <div class="dash-bolsa-stack" data-bolsa-stack role="img" aria-label="Composición de bolsitas">${stackSegments}</div>
                    <div class="dash-bolsa-legend" data-bolsa-legend>
                        ${ALLOC_BUCKETS.map(b => `
                            <span class="dash-bolsa-leg alloc-${b.key}" data-bolsa-leg="${b.key}">${esc(b.label)} ${percents[b.key]}%</span>
                        `).join('')}
                    </div>
                </div>

                <div class="dash-bolsa-grid">
                    ${bolsitasCards}
                </div>

                ${pendingSales.length ? `
                    <div class="dash-alloc-pending">
                        <div>
                            <strong>${pendingSales.length} venta${pendingSales.length === 1 ? '' : 's'} sin asignar</strong>
                            <p class="muted small">
                                Se registraron antes del auto-reparto.
                                Total pendiente ≈ ${Calc.fmtMXN(pendingSales.reduce((s, p) => s + p.amount, 0))}.
                            </p>
                        </div>
                        <button type="button" class="btn primary btn-sm" data-alloc-sync-sales>
                            Asignar a bolsitas
                        </button>
                    </div>
                ` : ''}

                ${recentSpends.length ? `
                    <div class="dash-alloc-history dash-alloc-spend-log">
                        <h4>Últimos usos</h4>
                        <ul>
                            ${recentSpends.map(e => {
                                const bLabel = ALLOC_BUCKETS.find(b => b.key === e.meta?.bucket)?.label || e.meta?.bucket || '';
                                return `
                                <li>
                                    <span>${esc(new Date(e.at).toLocaleDateString('es-MX'))}</span>
                                    <strong class="neg">−${Calc.fmtMXN(e.amount)}</strong>
                                    <span class="muted">${esc(bLabel)}${e.meta?.note ? ` · ${esc(e.meta.note)}` : ''} · quedan ${Calc.fmtMXN(e.meta?.remaining || 0)}</span>
                                </li>`;
                            }).join('')}
                        </ul>
                    </div>
                ` : ''}

                ${recentSales.length ? `
                    <div class="dash-alloc-history dash-alloc-sales-log">
                        <h4>Últimas ventas en bolsitas</h4>
                        <ul>
                            ${recentSales.map(e => `
                                <li>
                                    <span>${esc(e.meta?.fecha || new Date(e.at).toLocaleDateString('es-MX'))}</span>
                                    <strong class="pos">+${Calc.fmtMXN(e.amount)}</strong>
                                    <span class="muted">${esc(formatSplitLine(e.splits))}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                ` : ''}
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
                            const list = groupBestByProduct(rows.filter(r => isRankable(r) && r.calc.estrategia === st)).slice(0, 6);
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
        // Un renglón por producto (no por color). Sin variantes archivadas / finalizadas.
        const active = rows.filter(r => isRankable(r));
        const byProduct = groupBestByProduct(active);
        const byUtil = [...byProduct].sort((a, b) => b.calc.utilidad - a.calc.utilidad);
        const byMargen = [...byProduct].sort((a, b) => b.calc.margen - a.calc.margen);
        const byRoi = [...byProduct].sort((a, b) => b.calc.roi - a.calc.roi);
        return `
            <div class="dash-split-3">
                ${rankCol('Por utilidad / ud', byUtil, r => Calc.fmtMXN(r.calc.utilidad), r => tone(r.calc.utilidad))}
                ${rankCol('Por margen', byMargen, r => Calc.fmtPct(r.calc.margen), r => tone(r.calc.margen))}
                ${rankCol('Por ROI', byRoi, r => Calc.fmtPct(r.calc.roi), r => tone(r.calc.roi))}
            </div>
        `;
    }

    function isRankable({ lote, calc }) {
        const est = String(lote.estatus || '');
        if (est.includes('Finalizada')) return false;
        const uds = Number(lote.unidades) || 0;
        const rest = calc?.inventarioRestante ?? Math.max(0, uds - (Number(lote.vendidas) || 0));
        if (uds <= 0 && rest <= 0 && !(lote.ventas || []).length) return false;
        return true;
    }

    /** Una entrada por familia de producto; usa la variante con mejor utilidad. */
    function groupBestByProduct(rows) {
        const map = new Map();
        rows.forEach(r => {
            const key = r.lote.productId
                || String(r.lote.producto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                || r.lote.id;
            const prev = map.get(key);
            if (!prev || r.calc.utilidad > prev.calc.utilidad) map.set(key, r);
        });
        return [...map.values()];
    }

    function rankCol(title, list, fmt, toneFn) {
        return `
            <div class="dash-panel">
                <h3>${esc(title)}</h3>
                <ol class="dash-rank-ol">
                    ${list.slice(0, 8).map((r, i) => `
                        <li data-dash-lote="${esc(r.lote.id)}">
                            <span class="n">${i + 1}</span>
                            <span class="name" title="${esc(r.lote.producto)}${r.lote.variante ? ' · ' + esc(r.lote.variante) : ''}">${esc(short(r.lote.producto, 28))}${r.lote.variante ? ` <small class="muted">${esc(short(r.lote.variante, 10))}</small>` : ''}</span>
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
        const setChartUI = (patch) => {
            window.State.ui = { ...window.State.ui, ...patch };
            window.State.saveUI();
            render();
        };
        root.querySelectorAll('[data-dash-period]').forEach(btn => {
            btn.addEventListener('click', () => {
                const period = btn.dataset.dashPeriod;
                const cur = ['weeks', 'years'].includes(window.State.ui?.dashChartPeriod)
                    ? window.State.ui.dashChartPeriod
                    : 'months';
                if (!period || period === cur) return;
                // Conserva fecha ISO / preset al cambiar granularidad
                const iso = normalizeFromDate(window.State.ui?.dashChartFrom);
                setChartUI({
                    dashChartPeriod: period,
                    dashChartFrom: iso || '',
                });
            });
        });
        root.querySelectorAll('[data-dash-range]').forEach(btn => {
            btn.addEventListener('click', () => {
                const range = Number(btn.dataset.dashRange);
                const cur = [3, 6, 12, 24].includes(Number(window.State.ui?.dashChartRange))
                    ? Number(window.State.ui.dashChartRange)
                    : 12;
                if (![3, 6, 12, 24].includes(range) || range === cur) return;
                setChartUI({ dashChartRange: range, dashChartFrom: '', dashChartFromPreset: '' });
            });
        });
        root.querySelectorAll('[data-dash-empty]').forEach(btn => {
            btn.addEventListener('click', () => {
                const show = btn.dataset.dashEmpty === '1';
                setChartUI({ dashChartEmpty: show });
            });
        });
        root.querySelectorAll('[data-dash-type]').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.dashType;
                const allowed = ['hero', 'bars', 'lines', 'area'];
                const cur = allowed.includes(window.State.ui?.dashChartType)
                    ? window.State.ui.dashChartType
                    : 'hero';
                if (!allowed.includes(type) || type === cur) return;
                setChartUI({ dashChartType: type });
            });
        });
        root.querySelectorAll('[data-dash-from]').forEach(input => {
            const commit = () => {
                const raw = input.value;
                if (!raw) {
                    if (window.State.ui?.dashChartFrom || window.State.ui?.dashChartFromPreset) {
                        setChartUI({ dashChartFrom: '', dashChartFromPreset: '' });
                    }
                    return;
                }
                const next = normalizeFromDate(raw);
                if (!next) return;
                if (next === (window.State.ui?.dashChartFrom || '') && !window.State.ui?.dashChartFromPreset) return;
                setChartUI({ dashChartFrom: next, dashChartFromPreset: '' });
            };
            input.addEventListener('change', commit);
        });
        root.querySelectorAll('[data-dash-from-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.dashFromPreset;
                if (preset !== 'month' && preset !== 'year') return;
                if (window.State.ui?.dashChartFromPreset === preset) return;
                setChartUI({ dashChartFromPreset: preset, dashChartFrom: '' });
            });
        });
        root.querySelectorAll('[data-dash-from-clear]').forEach(btn => {
            btn.addEventListener('click', () => setChartUI({ dashChartFrom: '', dashChartFromPreset: '' }));
        });

        const allocPanel = root.querySelector('.dash-alloc-panel');
        if (allocPanel) {
            const allocSnap = (() => {
                const s = readAllocState();
                const total = round2(ALLOC_BUCKETS.reduce((sum, b) => sum + (s.buckets[b.key] || 0), 0));
                let unitCost = 0;
                try {
                    const agg = Calc.aggregate(window.State.lotes || [], window.State.settings);
                    const vendidas = Math.max(0, Number(agg.totalVendidas) || 0);
                    const costo = Number(agg.costoVendido) || 0;
                    unitCost = vendidas > 0 ? costo / vendidas : 0;
                } catch { /* ignore */ }
                return {
                    percents: { ...s.percents },
                    buckets: { ...s.buckets },
                    total,
                    unitCost,
                };
            })();

            const paintBolsaPreview = (percents, buckets, editingKey = null) => {
                const total = round2(ALLOC_BUCKETS.reduce((s, b) => s + (buckets[b.key] || 0), 0));
                ALLOC_BUCKETS.forEach(b => {
                    const card = allocPanel.querySelector(`[data-bolsa="${b.key}"]`);
                    if (!card) return;
                    const val = buckets[b.key] || 0;
                    const share = total > 0 ? Math.round((val / total) * 1000) / 10 : 0;
                    const amtEl = card.querySelector('[data-bolsa-amt]');
                    const shareEl = card.querySelector('[data-bolsa-share]');
                    const metaEl = card.querySelector('[data-bolsa-meta]');
                    const liveEl = card.querySelector('[data-bolsa-pct-live]');
                    if (amtEl) amtEl.textContent = Calc.fmtMXN(val);
                    if (shareEl) shareEl.textContent = `${percents[b.key]}% de cada venta · ${share}% actual`;
                    if (liveEl) liveEl.textContent = `${percents[b.key]}%`;
                    if (metaEl && b.key === 'reinversion') {
                        const uc = allocSnap.unitCost;
                        metaEl.textContent = uc > 0 && val > 0
                            ? `≈ ${(val / uc).toFixed(1)} uds al costo avg`
                            : (ALLOC_BUCKETS.find(x => x.key === 'reinversion')?.hint || '');
                    }
                    card.classList.toggle('is-preview', !!editingKey && b.key !== editingKey);
                });
                const stack = allocPanel.querySelector('[data-bolsa-stack]');
                if (stack) {
                    if (total <= 0) {
                        stack.innerHTML = '<span class="dash-bolsa-seg is-empty">Sin dinero en bolsitas aún</span>';
                    } else {
                        stack.innerHTML = ALLOC_BUCKETS.map(b => {
                            const val = buckets[b.key] || 0;
                            if (val <= 0) return '';
                            const w = Math.max(2, (val / total) * 100);
                            return `<span class="dash-bolsa-seg alloc-${b.key}" style="width:${w.toFixed(1)}%" title="${esc(b.label)}: ${Calc.fmtMXN(val)}"></span>`;
                        }).join('');
                    }
                }
                ALLOC_BUCKETS.forEach(b => {
                    const leg = allocPanel.querySelector(`[data-bolsa-leg="${b.key}"]`);
                    if (leg) leg.textContent = `${b.label} ${percents[b.key]}%`;
                });
            };

            const previewFromEdit = (key, raw) => {
                const pct = Number.isFinite(raw) ? raw : Number(allocSnap.percents[key]) || 0;
                const nextPct = previewPercentsForKey(key, pct, allocSnap.percents);
                const nextBuckets = allocSnap.total > 0
                    ? splitByPercents(allocSnap.total, nextPct)
                    : { ...allocSnap.buckets };
                paintBolsaPreview(nextPct, nextBuckets, key);
                return nextPct;
            };

            const closeAllBolsaEdits = (restore = true) => {
                if (restore) paintBolsaPreview(allocSnap.percents, allocSnap.buckets, null);
                allocPanel.querySelectorAll('.dash-bolsa-edit-panel').forEach(p => { p.hidden = true; });
                allocPanel.querySelectorAll('.dash-bolsa-use-panel').forEach(p => { p.hidden = true; });
                allocPanel.querySelectorAll('.dash-bolsa').forEach(c => {
                    c.classList.remove('is-editing', 'is-preview', 'is-using');
                });
            };

            allocPanel.querySelectorAll('[data-bolsa-edit]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const key = btn.dataset.bolsaEdit;
                    const card = allocPanel.querySelector(`[data-bolsa="${key}"]`);
                    const panel = card?.querySelector('.dash-bolsa-edit-panel');
                    const open = panel && !panel.hidden;
                    closeAllBolsaEdits(true);
                    if (!open && panel) {
                        const pct = allocSnap.percents[key];
                        const range = panel.querySelector(`[data-bolsa-pct-range="${key}"]`);
                        const input = panel.querySelector(`[data-bolsa-pct-input="${key}"]`);
                        if (range) range.value = pct;
                        if (input) input.value = pct;
                        panel.hidden = false;
                        card.classList.add('is-editing');
                        (range || input)?.focus();
                    }
                });
            });

            allocPanel.querySelectorAll('[data-bolsa-use]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const key = btn.dataset.bolsaUse;
                    const card = allocPanel.querySelector(`[data-bolsa="${key}"]`);
                    const panel = card?.querySelector('.dash-bolsa-use-panel');
                    const open = panel && !panel.hidden;
                    closeAllBolsaEdits(true);
                    if (!open && panel) {
                        const avail = round2(allocSnap.buckets[key] || 0);
                        const input = panel.querySelector(`[data-bolsa-use-amt="${key}"]`);
                        const hint = panel.querySelector(`[data-bolsa-use-remain="${key}"]`);
                        if (input) {
                            input.value = '';
                            input.max = String(avail);
                        }
                        if (hint) hint.textContent = `Disponible ${Calc.fmtMXN(avail)}. Al restar verás cuánto queda.`;
                        panel.hidden = false;
                        card.classList.add('is-using');
                        input?.focus();
                    }
                });
            });

            ALLOC_BUCKETS.forEach(b => {
                const input = allocPanel.querySelector(`[data-bolsa-use-amt="${b.key}"]`);
                input?.addEventListener('input', () => {
                    const avail = round2(allocSnap.buckets[b.key] || 0);
                    const raw = Number(input.value);
                    const hint = allocPanel.querySelector(`[data-bolsa-use-remain="${b.key}"]`);
                    if (!hint) return;
                    if (!Number.isFinite(raw) || raw <= 0) {
                        hint.textContent = `Disponible ${Calc.fmtMXN(avail)}. Al restar verás cuánto queda.`;
                        return;
                    }
                    const spent = Math.min(raw, avail);
                    const remain = round2(Math.max(0, avail - spent));
                    hint.textContent = raw > avail
                        ? `Solo hay ${Calc.fmtMXN(avail)}. Quedarían $0.00.`
                        : `Quedarían ${Calc.fmtMXN(remain)} en ${ALLOC_BUCKETS.find(x => x.key === b.key)?.label || b.key}.`;
                });
            });

            const bindLive = (key) => {
                const range = allocPanel.querySelector(`[data-bolsa-pct-range="${key}"]`);
                const input = allocPanel.querySelector(`[data-bolsa-pct-input="${key}"]`);
                const sync = (fromRange) => {
                    let raw = fromRange ? Number(range?.value) : Number(input?.value);
                    if (!Number.isFinite(raw)) raw = allocSnap.percents[key];
                    raw = Math.max(0, Math.min(100, raw));
                    if (range) range.value = raw;
                    if (input && document.activeElement !== input) input.value = raw;
                    else if (input && fromRange) input.value = raw;
                    previewFromEdit(key, raw);
                };
                range?.addEventListener('input', () => sync(true));
                input?.addEventListener('input', () => sync(false));
            };
            ALLOC_BUCKETS.forEach(b => bindLive(b.key));

            allocPanel.querySelectorAll('[data-bolsa-pct-cancel]').forEach(btn => {
                btn.addEventListener('click', () => closeAllBolsaEdits(true));
            });
            allocPanel.querySelectorAll('[data-bolsa-use-cancel]').forEach(btn => {
                btn.addEventListener('click', () => closeAllBolsaEdits(true));
            });
            allocPanel.querySelectorAll('[data-bolsa-pct-save]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const key = btn.dataset.bolsaPctSave;
                    const raw = Number(allocPanel.querySelector(`[data-bolsa-pct-input="${key}"]`)?.value);
                    if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
                        UI.toast?.('Pon un % entre 0 y 100', 'error');
                        return;
                    }
                    const res = setBucketPercent(key, raw);
                    Object.assign(allocSnap.percents, res.percents);
                    Object.assign(allocSnap.buckets, res.buckets);
                    allocSnap.total = res.total;
                    renderPreservingScroll(`[data-bolsa="${key}"]`);
                    const label = ALLOC_BUCKETS.find(b => b.key === key)?.label || key;
                    UI.toast?.(`${label}: ${res.percents[key]}% · montos rebalanceados`);
                });
            });
            allocPanel.querySelectorAll('[data-bolsa-use-save]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const key = btn.dataset.bolsaUseSave;
                    const raw = Number(allocPanel.querySelector(`[data-bolsa-use-amt="${key}"]`)?.value);
                    if (!(raw > 0)) {
                        UI.toast?.('Pon cuánto usaste', 'error');
                        return;
                    }
                    const res = spendFromBucket(key, raw);
                    if (!res) {
                        UI.toast?.('No hay saldo en esa bolsita', 'error');
                        return;
                    }
                    const label = ALLOC_BUCKETS.find(b => b.key === key)?.label || key;
                    renderPreservingScroll(`[data-bolsa="${key}"]`);
                    UI.toast?.(`${label}: usaste ${Calc.fmtMXN(res.spent)} · quedan ${Calc.fmtMXN(res.remaining)}`);
                });
            });
            allocPanel.querySelector('[data-alloc-equal-pct]')?.addEventListener('click', (e) => {
                e.preventDefault();
                const percents = { reinversion: 20, reserva: 20, ads: 20, insumos: 20, utilidad: 20 };
                const state = readAllocState();
                const total = round2(ALLOC_BUCKETS.reduce((s, b) => s + (state.buckets[b.key] || 0), 0));
                writeAllocState({
                    percents,
                    buckets: total > 0 ? splitByPercents(total, percents) : state.buckets,
                });
                renderPreservingScroll('.dash-alloc-panel');
                UI.toast?.('20% en cada bolsita · montos rebalanceados');
            });
            allocPanel.querySelector('[data-alloc-reset-buckets]')?.addEventListener('click', (e) => {
                e.preventDefault();
                writeAllocState({
                    buckets: emptyAllocBuckets(),
                    liberated: 0,
                    ledger: readAllocState().ledger.filter(x => x.type === 'spend'),
                });
                renderPreservingScroll('.dash-alloc-panel');
            });
            allocPanel.querySelector('[data-alloc-sync-sales]')?.addEventListener('click', (e) => {
                e.preventDefault();
                const res = syncMissingSalesToAlloc();
                renderPreservingScroll('.dash-alloc-panel');
                if (res.n > 0) {
                    UI.toast?.(`${res.n} venta${res.n === 1 ? '' : 's'} → bolsitas (${Calc.fmtMXN(res.total)})`);
                } else {
                    UI.toast?.('No había ventas pendientes', 'error');
                }
            });
        }

        const detail = root.querySelector('[data-dash-spark-detail]');
        const hits = [...root.querySelectorAll('.dash-hit, .dash-progress-col[data-dash-point]')];
        const setDetail = (el) => {
            if (!detail || !el) return;
            detail.innerHTML = formatSparkDetail(el);
            const idx = Number(el.dataset.dashPoint);
            hits.forEach(h => h.classList.toggle('is-active', h === el));
            root.querySelectorAll('.dash-pt').forEach(g => {
                g.classList.toggle('is-focus', Number(g.dataset.dashPoint) === idx);
            });
            root.querySelectorAll('.dash-progress-col[data-dash-point]').forEach(col => {
                col.classList.toggle('is-active', col === el);
            });
        };
        hits.forEach(hit => {
            hit.addEventListener('mouseenter', () => setDetail(hit));
            hit.addEventListener('focus', () => setDetail(hit));
            hit.addEventListener('click', () => setDetail(hit));
        });
        if (hits.length) {
            const host = root.querySelector('.dash-hero-spark, .dash-chart-plain');
            const focusIdx = Number(host?.dataset.focusIndex);
            const focusHit = hits.find(h => Number(h.dataset.dashPoint) === focusIdx) || hits[hits.length - 1];
            if (focusHit) setDetail(focusHit);
        }
    }

    function init() {
        window.State.subscribe(() => {
            if (window.State.view === 'dashboard') render();
        });
    }

    return {
        init,
        render,
        applySaleLiberation,
        reverseSaleLiberation,
        spendFromBucket,
        syncMissingSalesToAlloc,
        listUnassignedVentas,
    };
})();
window.DashboardView = DashboardView;
