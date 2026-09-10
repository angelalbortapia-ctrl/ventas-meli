/* ==========================================================================
   Dashboard — Progreso · P&G · flujo de caja · Asignación · Portafolio
   ========================================================================== */

const DashboardView = (() => {

    function render() {
        const root = document.getElementById('dashboard-canvas');
        if (!root) return;

        if (window.State.ui?.mpView === 'general') {
            renderGeneral(root);
            return;
        }

        const lotes = window.State.lotes || [];
        const isAmz = window.State.marketplace === 'amazon';
        const mpLabel = isAmz ? Data.mpBrand('amazon') : Data.mpBrand('meli');
        const themeCls = isAmz ? 'is-amz' : 'is-meli';
        const shellCls = `dash-shell dash-shell-home is-fx ${themeCls}`;
        const mastheadAmbience = `
            <div class="dash-fx-stage" aria-hidden="true">
                <span class="dash-fx-wash"></span>
                <span class="dash-fx-mark"></span>
            </div>`;
        persistAllocMigrations();
        // Evita bolsitas fantasma (total > 0 con liberado $0 sin ventas en ledger)
        try { reconcileAllocFromLedger(allocMpKey()); } catch { /* ignore */ }

        if (!lotes.length) {
            const emptyCtx = {
                agg: { totalVendidas: 0 },
                costoVendido: 0,
            };
            root.innerHTML = `
                <div class="${shellCls}">
                    <div class="dash-body dash-body-combined dash-home">
                        <header class="dash-masthead">
                            ${mastheadAmbience}
                            <p class="dash-masthead-kicker">${esc(mpLabel)}</p>
                            <h1 class="dash-masthead-title">Empieza aquí.</h1>
                        </header>
                        ${layHeroKPIs([])}
                        <div class="dash-empty-full">
                            <h2>Sin datos todavía</h2>
                            <p>Importa un Excel o crea un lote para ver el panel financiero.</p>
                            <button type="button" class="btn primary" data-dash-new>+ Nuevo lote</button>
                        </div>
                        <section class="dash-section dash-section-rise">
                            <div class="dash-section-copy">
                                <h2 class="dash-section-title">Asignación</h2>
                                <p class="dash-section-lead">Bolsitas listas para <span class="dash-mp-tag">${esc(mpLabel)}</span></p>
                            </div>
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
            <div class="${shellCls}">
                <div class="dash-body dash-body-combined dash-home">
                    <header class="dash-masthead">
                        ${mastheadAmbience}
                        <p class="dash-masthead-kicker">${esc(mpLabel)}</p>
                        <h1 class="dash-masthead-title">Tu negocio,<br>de un vistazo.</h1>
                    </header>
                    ${layHeroKPIs(lotes)}
                    <section class="dash-section dash-section-rise" id="dash-progreso">
                        <div class="dash-section-head">
                            <div class="dash-section-copy">
                                <h2 class="dash-section-title">Progreso</h2>
                                <p class="dash-section-lead">Tendencia en el tiempo</p>
                            </div>
                            <div class="dash-chart-toggles">
                                <div class="dash-seg" role="group" aria-label="Granularidad">
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'weeks' ? ' active' : ''}" data-dash-period="weeks">Semanas</button>
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'months' ? ' active' : ''}" data-dash-period="months">Meses</button>
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'years' ? ' active' : ''}" data-dash-period="years">Años</button>
                                </div>
                                <details class="dash-chart-type-more">
                                    <summary class="dash-chart-type-btn" aria-label="Tipo de gráfica">⋯</summary>
                                    <div class="dash-chart-type-list" role="group" aria-label="Tipo de gráfica">
                                        <button type="button" class="dash-type-opt${chartType === 'hero' ? ' active' : ''}" data-dash-type="hero">Hero</button>
                                        <button type="button" class="dash-type-opt${chartType === 'bars' ? ' active' : ''}" data-dash-type="bars">Barras</button>
                                        <button type="button" class="dash-type-opt${chartType === 'lines' ? ' active' : ''}" data-dash-type="lines">Líneas</button>
                                        <button type="button" class="dash-type-opt${chartType === 'area' ? ' active' : ''}" data-dash-type="area">Área</button>
                                    </div>
                                </details>
                            </div>
                        </div>
                        ${layProgreso(lotes, {
                            period: chartPeriod,
                            range: chartRange,
                            showEmpty: chartShowEmpty,
                            chartType,
                            fromDate: fromResolved.iso,
                            fromPreset: fromResolved.preset,
                            cashMode: window.State.ui?.dashCashMode === 'vendido' ? 'vendido' : 'cobrado',
                        })}
                    </section>
                    <section class="dash-section dash-section-rise">
                        ${(() => {
                            const pygPeriod = resolvePyGPeriod();
                            const pygCtx = sliceCtxForPyG(ctx, pygPeriod);
                            return `
                        <div class="dash-section-head">
                            <div class="dash-section-copy">
                                <h2 class="dash-section-title">P&amp;G estimado</h2>
                                <p class="dash-section-lead">${esc(pygPeriod?.label || 'Periodo')} · ${pygCtx.agg?.totalVendidas || 0} uds · por fecha de venta</p>
                            </div>
                            ${layPyGPeriodChips(pygPeriod)}
                        </div>
                        ${layPyGCompact(pygCtx)}`;
                        })()}
                    </section>
                    <section class="dash-section dash-section-rise" id="dash-asignacion">
                        <div class="dash-section-copy">
                            <h2 class="dash-section-title">Asignación</h2>
                            <p class="dash-section-lead">Cómo se reparte el cobro en tus bolsitas · <span class="dash-mp-tag">${esc(mpLabel)}</span></p>
                        </div>
                        ${layAsignacion(ctx)}
                    </section>
                    <div class="dash-hint-general">
                        <p>Estas bolsitas son de <strong>${esc(mpLabel)}</strong> y alimentan el consolidado de
                            <button type="button" class="dash-link-inline" data-dash-goto-mp="general">General</button>.
                            Caja y Portafolio también viven ahí.</p>
                    </div>
                </div>
            </div>
        `;
        bind(root);
    }

    function renderGeneral(root) {
        persistAllocMigrations();
        const both = Data.loadBothCatalogs();
        window.__dashMpSettings = { meli: both.meli.settings, amazon: both.amazon.settings };
        const aggMeli = Calc.aggregate(both.meli.lotes, both.meli.settings);
        const aggAmz = Calc.aggregate(both.amazon.lotes, both.amazon.settings);
        const rows = [
            ...aggMeli.rows.map(r => ({ ...r, lote: { ...r.lote, _mp: 'meli' } })),
            ...aggAmz.rows.map(r => ({ ...r, lote: { ...r.lote, _mp: 'amazon' } })),
        ];
        const lotesAll = rows.map(r => r.lote);
        const nMeli = new Set(both.meli.lotes.map(l => l.productId || l.id)).size;
        const nAmz = new Set(both.amazon.lotes.map(l => l.productId || l.id)).size;
        const utilPot = rows.reduce((s, r) => {
            const rest = r.calc.inventarioRestante || 0;
            return s + (r.calc.utilidad || 0) * rest;
        }, 0);
        const aggCombined = {
            capitalDesplegado: aggMeli.capitalDesplegado + aggAmz.capitalDesplegado,
            cashIn: aggMeli.cashIn + aggAmz.cashIn,
            gananciaRealizada: aggMeli.gananciaRealizada + aggAmz.gananciaRealizada,
            valorInventario: aggMeli.valorInventario + aggAmz.valorInventario,
            margenPonderado: 0,
            totalUds: aggMeli.totalUds + aggAmz.totalUds,
            totalVendidas: aggMeli.totalVendidas + aggAmz.totalVendidas,
            strategyCount: mergeStrategyCounts(aggMeli.strategyCount, aggAmz.strategyCount),
            rows,
        };
        if (aggCombined.totalUds > 0) {
            const w = rows.reduce((s, r) => s + r.calc.margen * (Number(r.lote.unidades) || 0), 0);
            aggCombined.margenPonderado = w / aggCombined.totalUds;
        }
        const ctx = buildContext(aggCombined);
        ctx.isGeneral = true;
        ctx.isAmazon = null;

        const hardMeli = channelHardMetrics(aggMeli, both.meli.lotes, false);
        const hardAmz = channelHardMetrics(aggAmz, both.amazon.lotes, true);
        const monthStats = monthToDateStats(lotesAll);
        const goals = readGeneralGoals();
        const split = suggestCapitalSplit(hardMeli, hardAmz);
        const nextBuy = buildNextBuyLists(rows);
        const agenda = buildGeneralAgenda(rows, nextBuy, split);
        const alerts = buildGeneralAlerts(rows);
        const allocUnified = unifiedAllocState();
        const exec = {
            nMeli, nAmz, utilPot, aggCombined, aggMeli, aggAmz,
            hardMeli, hardAmz, monthStats, goals, split, nextBuy, agenda, alerts, allocUnified,
        };

        const moreFlags = readGxMoreOpen();
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

        const gxAmbience = `
            <div class="dash-fx-stage" aria-hidden="true">
                <span class="dash-fx-wash"></span>
                <span class="dash-fx-mark"></span>
            </div>`;

        if (!lotesAll.length) {
            root.innerHTML = `
                <div class="dash-shell dash-shell-home dash-shell-general is-fx is-general" id="dash-general-root">
                    <div class="dash-body dash-body-combined dash-home gx-body">
                        <header class="dash-masthead">
                            ${gxAmbience}
                            <p class="dash-masthead-kicker">General</p>
                            <h1 class="dash-masthead-title">Empieza en un canal.</h1>
                        </header>
                        ${layHeroKPIs([])}
                        <div class="dash-empty-full">
                            <h2>Vista ejecutiva vacía</h2>
                            <p>Agrega productos en Mercado Libre o Amazon para ver el consolidado.</p>
                            <div class="dash-empty-actions">
                                <button type="button" class="btn primary" data-dash-goto-mp="meli">Abrir Mercado Libre</button>
                                <button type="button" class="btn" data-dash-goto-mp="amazon">Abrir Amazon</button>
                            </div>
                        </div>
                        <section class="dash-section dash-section-rise">
                            <div class="dash-section-copy">
                                <h2 class="dash-section-title">Capital unificado</h2>
                                <p class="dash-section-lead">Listo cuando haya ventas en cualquiera de los dos.</p>
                            </div>
                            ${layCapitalUnificado(allocUnified)}
                        </section>
                    </div>
                </div>`;
            bind(root);
            return;
        }

        const pygPeriod = resolvePyGPeriod();
        const pygCtx = sliceCtxForPyG(ctx, pygPeriod);

        root.innerHTML = `
            <div class="dash-shell dash-shell-home dash-shell-general is-fx is-general" id="dash-general-root">
                <div class="dash-body dash-body-combined dash-home gx-body">
                    <header class="dash-masthead">
                        ${gxAmbience}
                        <p class="dash-masthead-kicker">General</p>
                        <h1 class="dash-masthead-title">Ambos canales,<br>un solo pulso.</h1>
                    </header>
                    ${layHeroKPIs(lotesAll)}
                    ${layGeneralExecutive(exec)}
                    <section class="dash-section dash-section-rise" id="gx-progreso">
                        <div class="dash-section-head">
                            <div class="dash-section-copy">
                                <h2 class="dash-section-title">Progreso</h2>
                                <p class="dash-section-lead">Tendencia consolidada Meli + Amazon</p>
                            </div>
                            <div class="dash-chart-toggles">
                                <div class="dash-seg" role="group" aria-label="Granularidad">
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'weeks' ? ' active' : ''}" data-dash-period="weeks">Semanas</button>
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'months' ? ' active' : ''}" data-dash-period="months">Meses</button>
                                    <button type="button" class="dash-seg-btn${chartPeriod === 'years' ? ' active' : ''}" data-dash-period="years">Años</button>
                                </div>
                                <details class="dash-chart-type-more">
                                    <summary class="dash-chart-type-btn" aria-label="Tipo de gráfica">⋯</summary>
                                    <div class="dash-chart-type-list" role="group" aria-label="Tipo de gráfica">
                                        <button type="button" class="dash-type-opt${chartType === 'hero' ? ' active' : ''}" data-dash-type="hero">Hero</button>
                                        <button type="button" class="dash-type-opt${chartType === 'bars' ? ' active' : ''}" data-dash-type="bars">Barras</button>
                                        <button type="button" class="dash-type-opt${chartType === 'lines' ? ' active' : ''}" data-dash-type="lines">Líneas</button>
                                        <button type="button" class="dash-type-opt${chartType === 'area' ? ' active' : ''}" data-dash-type="area">Área</button>
                                    </div>
                                </details>
                            </div>
                        </div>
                        ${layProgreso(lotesAll, {
                            period: chartPeriod,
                            range: chartRange,
                            showEmpty: chartShowEmpty,
                            chartType,
                            fromDate: fromResolved.iso,
                            fromPreset: fromResolved.preset,
                            cashMode: window.State.ui?.dashCashMode === 'vendido' ? 'vendido' : 'cobrado',
                        })}
                    </section>
                    <section class="dash-section dash-section-rise" id="gx-finanzas">
                        <div class="dash-section-head">
                            <div class="dash-section-copy">
                                <h2 class="dash-section-title">P&amp;G estimado</h2>
                                <p class="dash-section-lead">${esc(pygPeriod?.label || 'Periodo')} · ${pygCtx.agg?.totalVendidas || 0} uds · por fecha de venta</p>
                            </div>
                            ${layPyGPeriodChips(pygPeriod)}
                        </div>
                        ${layPyGCompact(pygCtx)}
                    </section>
                    <details class="gx-more dash-section-rise" id="gx-finanzas-more" data-gx-more-persist="finanzas"${moreFlags.finanzas ? ' open' : ''}>
                        <summary class="gx-more-summary">Más finanzas · detalle, caja y portafolio</summary>
                        <div class="gx-more-body">
                            <div class="gx-fin-stack">
                                <div>
                                    <h3 class="gx-fin-h">Estado de resultados</h3>
                                    ${layPyG(pygCtx)}
                                </div>
                                <div>
                                    <h3 class="gx-fin-h">Detalle por venta</h3>
                                    ${layVentaDetalle(pygCtx, { variant: 'full' })}
                                </div>
                                <div>
                                    <h3 class="gx-fin-h">Caja</h3>
                                    ${layCaja(ctx)}
                                </div>
                                <div>
                                    <h3 class="gx-fin-h">Portafolio</h3>
                                    ${layPortafolio(ctx)}
                                </div>
                                <div>
                                    <h3 class="gx-fin-h">Bolsitas consolidadas</h3>
                                    <p class="dash-section-lead" style="margin:0 0 12px">Suma de Meli + Amazon. Para usar o ajustar %, abre cada marketplace.</p>
                                    ${layAsignacionDualReadonly()}
                                </div>
                            </div>
                        </div>
                    </details>
                </div>
            </div>`;
        bind(root);
        bindGeneralExecutive(root, exec);
    }

    function mergeStrategyCounts(a = {}, b = {}) {
        const keys = ['ESCALAR', 'MANTENER', 'LIQUIDAR', 'AGOTADO', 'PAUSADA', 'FINALIZADA'];
        const out = {};
        keys.forEach(k => { out[k] = (a[k] || 0) + (b[k] || 0); });
        return out;
    }

    function settingsForTaggedLote(lote) {
        const mp = lote?._mp;
        if (mp === 'amazon' || mp === 'meli') {
            return window.__dashMpSettings?.[mp] || Data.loadSettings(mp);
        }
        return window.State.settings;
    }

    /** Lote con costo + fees congelados de la venta (o valores actuales). */
    function loteAtSaleCost(lote, venta) {
        if (Data.loteForVentaCalc) return Data.loteForVentaCalc(lote, venta);
        const costo = Data.ventaCostoUnitario
            ? Data.ventaCostoUnitario(lote, venta)
            : (() => {
                const frozen = Number(venta?.costoUnitario);
                return Number.isFinite(frozen) && frozen >= 0
                    ? frozen
                    : Math.max(0, Number(lote?.costo) || 0);
            })();
        return { ...lote, costo };
    }

    /** Fees unitarios (comisión + envío/FBA + retenciones + extras). */
    function unitFeesFromUtil(u) {
        if (!u) return 0;
        return (Number(u.comisionVariable) || 0)
            + (Number(u.cargoFijo) || 0)
            + (Number(u.envio) || 0)
            + (Number(u.almacenamiento) || 0)
            + (Number(u.varios) || 0)
            + (Number(u.retIVA) || 0)
            + (Number(u.retISR) || 0);
    }

    /**
     * Fees y COGS a precio real de cada venta (no precio de lista × vendidas).
     * Legacy sin eventos: usa precio/costo de lista.
     */
    function sumFeesAndCogs(lote, settings) {
        let fees = 0;
        let costoVendido = 0;
        const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
        if (ventas.length) {
            ventas.forEach(v => {
                const uds = Math.max(0, Number(v.unidades) || 0);
                if (!uds) return;
                const precio = Number(v.precio) || 0;
                const loteAt = loteAtSaleCost(lote, v);
                const u = Calc.utilidadAtPrice(loteAt, precio, settings);
                fees += unitFeesFromUtil(u) * uds;
                costoVendido += (Number(loteAt.costo) || 0) * uds;
            });
            return { fees, costoVendido };
        }
        const vendidas = Math.max(0, Number(lote.vendidas) || 0);
        if (vendidas) {
            const precio = Number(lote.precio) || 0;
            const u = Calc.utilidadAtPrice(lote, precio, settings);
            fees += unitFeesFromUtil(u) * vendidas;
            costoVendido += (Number(lote.costo) || 0) * vendidas;
        }
        return { fees, costoVendido };
    }

    function channelHardMetrics(agg, lotes, isAmazon) {
        let fees = 0;
        let gastoAds = 0;
        let costoVendido = 0;
        let stockUds = 0;
        (agg.rows || []).forEach(({ lote, calc }) => {
            const settings = settingsForTaggedLote(lote);
            const sum = sumFeesAndCogs(lote, settings);
            fees += sum.fees;
            costoVendido += sum.costoVendido;
            gastoAds += Number(calc.gastoAds) || 0;
            stockUds += Number(calc.inventarioRestante) || 0;
        });
        const cash = agg.cashIn || 0;
        const capital = agg.capitalDesplegado || 0;
        const roiCapital = capital > 0 ? (agg.gananciaRealizada || 0) / capital : 0;
        const feePct = cash > 0 ? fees / cash : 0;
        const adsPct = cash > 0 ? gastoAds / cash : 0;
        const feeAdsPct = cash > 0 ? (fees + gastoAds) / cash : 0;
        const uds30 = salesUdsLastDays(lotes, 30);
        const diasInv = uds30 > 0
            ? stockUds / (uds30 / 30)
            : (stockUds > 0 ? null : 0);
        const rotacion = agg.totalUds > 0 ? (agg.totalVendidas || 0) / agg.totalUds : 0;
        return {
            fees, gastoAds, costoVendido, feePct, adsPct, feeAdsPct,
            roiCapital, diasInv, rotacion, stockUds, uds30,
            cashIn: cash,
            ganancia: agg.gananciaRealizada || 0,
            capital,
            valorInventario: agg.valorInventario || 0,
            strategyCount: agg.strategyCount || {},
        };
    }

    function salesUdsLastDays(lotes, days) {
        const now = new Date();
        const cut = Calc.startOfLocalDay(new Date(now.getTime() - days * 86400000));
        let uds = 0;
        (lotes || []).forEach(lote => {
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            ventas.forEach(v => {
                const d = Calc.effectiveSaleDay(v.fecha, now);
                if (!d || !cut || d < cut) return;
                uds += Math.max(0, Number(v.unidades) || 0);
            });
        });
        return uds;
    }

    function monthToDateStats(lotes) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const start = new Date(y, m, 1);
        const today = Calc.startOfLocalDay(now);
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const daysElapsed = Math.max(1, now.getDate());
        let cashIn = 0;
        let ganancia = 0;
        let unidades = 0;
        (lotes || []).forEach(lote => {
            const settings = settingsForTaggedLote(lote);
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            if (ventas.length) {
                ventas.forEach(v => {
                    const d = Calc.effectiveSaleDay(v.fecha, now);
                    if (!d || d < start || (today && d > today)) return;
                    const uds = Math.max(0, Number(v.unidades) || 0);
                    const precio = Number(v.precio) || 0;
                    cashIn += precio * uds;
                    ganancia += Calc.utilidadAtPrice(loteAtSaleCost(lote, v), precio, settings).utilidad * uds;
                    unidades += uds;
                });
                return;
            }
            // Legacy sin fechas: no cuenta en mes (evita inflar)
        });
        const projGain = ganancia / daysElapsed * daysInMonth;
        const projCash = cashIn / daysElapsed * daysInMonth;
        const monthLabel = now.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
        return {
            cashIn, ganancia, unidades, daysElapsed, daysInMonth,
            projGain, projCash, monthLabel,
            monthKey: `${y}-${pad2(m + 1)}`,
        };
    }

    function readGeneralGoals() {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
        const raw = window.State.ui?.generalGoals && typeof window.State.ui.generalGoals === 'object'
            ? window.State.ui.generalGoals
            : {};
        const sameMonth = raw.monthKey === monthKey;
        return {
            monthKey,
            utilidad: Math.max(0, Number(sameMonth ? raw.utilidad : 0) || 0),
            cashIn: Math.max(0, Number(sameMonth ? raw.cashIn : 0) || 0),
        };
    }

    function saveGeneralGoals(patch) {
        const cur = readGeneralGoals();
        const next = {
            monthKey: cur.monthKey,
            utilidad: patch.utilidad != null ? Math.max(0, Number(patch.utilidad) || 0) : cur.utilidad,
            cashIn: patch.cashIn != null ? Math.max(0, Number(patch.cashIn) || 0) : cur.cashIn,
        };
        window.State.ui = { ...window.State.ui, generalGoals: next };
        window.State.saveUI();
        return next;
    }

    function suggestCapitalSplit(hardMeli, hardAmz) {
        const score = (h) => {
            const roi = Math.max(0, h.roiCapital || 0);
            const rot = Math.max(0, h.rotacion || 0);
            const feePenalty = Math.max(0, 1 - (h.feeAdsPct || 0));
            return roi * 0.55 + rot * 0.35 + feePenalty * 0.1;
        };
        const sM = score(hardMeli);
        const sA = score(hardAmz);
        const sum = sM + sA;
        let pctMeli = 50;
        let pctAmz = 50;
        if (sum > 0.0001) {
            pctMeli = Math.round((sM / sum) * 100);
            pctAmz = 100 - pctMeli;
        }
        // Evitar extremos si ambos canales tienen actividad
        if ((hardMeli.capital > 0 || hardMeli.cashIn > 0) && (hardAmz.capital > 0 || hardAmz.cashIn > 0)) {
            pctMeli = Math.min(80, Math.max(20, pctMeli));
            pctAmz = 100 - pctMeli;
        } else if (hardMeli.capital <= 0 && hardMeli.cashIn <= 0) {
            pctMeli = 0;
            pctAmz = 100;
        } else if (hardAmz.capital <= 0 && hardAmz.cashIn <= 0) {
            pctMeli = 100;
            pctAmz = 0;
        }
        let line = 'Ambos canales rinden parecido; reparte según capacidad operativa.';
        if (pctMeli >= pctAmz + 8) {
            line = `Meli rinde mejor por capital/rotación. Sugiere ~${pctMeli}% del próximo peso ahí.`;
        } else if (pctAmz >= pctMeli + 8) {
            line = `Amazon rinde mejor por capital/rotación. Sugiere ~${pctAmz}% del próximo peso ahí.`;
        }
        return { pctMeli, pctAmz, line };
    }

    function buildNextBuyLists(rows) {
        const active = (rows || []).filter(r => isRankable(r));
        const byProd = groupBestByProduct(active);
        const escalate = byProd
            .filter(r => r.calc.estrategia === 'ESCALAR' || r.calc.estrategia === 'AGOTADO')
            .sort((a, b) => {
                const score = (r) => (r.calc.roi || 0) * 0.5
                    + (r.calc.margen || 0) * 0.3
                    + (r.calc.estrategia === 'AGOTADO' ? 0.2 : 0)
                    + Math.min(1, (r.calc.rotacion || 0)) * 0.2
                    - Math.min(0.3, (r.calc.inventarioRestante || 0) / 20);
                return score(b) - score(a);
            })
            .slice(0, 3);
        const liquidate = byProd
            .filter(r => r.calc.estrategia === 'LIQUIDAR' && (r.calc.inventarioRestante || 0) > 0)
            .sort((a, b) => (b.calc.valorInventario || 0) - (a.calc.valorInventario || 0))
            .slice(0, 3);
        return { escalate, liquidate };
    }

    function buildGeneralAlerts(rows) {
        const nEscLow = rows.filter(r =>
            r.calc.estrategia === 'ESCALAR' && (r.calc.inventarioRestante || 0) > 0 && (r.calc.inventarioRestante || 0) <= 2
        ).length;
        const nLiq = rows.filter(r =>
            r.calc.estrategia === 'LIQUIDAR' && (r.calc.inventarioRestante || 0) >= 3
        ).length;
        const nAgot = rows.filter(r => r.calc.estrategia === 'AGOTADO').length;
        const nAds = rows.filter(r => r.calc.adsStatus === 'over' || r.calc.adsStatus === 'near').length;
        const parts = [];
        if (nEscLow) parts.push(`${nEscLow} SKU${nEscLow === 1 ? '' : 's'} ESCALAR con stock bajo`);
        if (nLiq) parts.push(`${nLiq} a liquidar`);
        if (nAgot) parts.push(`${nAgot} agotado${nAgot === 1 ? '' : 's'}`);
        if (nAds) parts.push(`${nAds} con Ads cerca/sobre tope`);
        return {
            nEscLow, nLiq, nAgot, nAds,
            line: parts.length ? parts.join(' · ') : 'Sin alertas críticas hoy',
            has: parts.length > 0,
        };
    }

    function agendaDayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    function readAgendaDone() {
        const key = agendaDayKey();
        const store = window.State.ui?.generalAgendaDone && typeof window.State.ui.generalAgendaDone === 'object'
            ? window.State.ui.generalAgendaDone
            : {};
        const list = Array.isArray(store[key]) ? store[key] : [];
        return { key, set: new Set(list.map(String)) };
    }

    function toggleAgendaDone(id, done) {
        const { key, set } = readAgendaDone();
        if (done) set.add(String(id));
        else set.delete(String(id));
        const prev = window.State.ui?.generalAgendaDone && typeof window.State.ui.generalAgendaDone === 'object'
            ? { ...window.State.ui.generalAgendaDone }
            : {};
        prev[key] = [...set];
        // Limpia días viejos (queda hoy + ayer)
        const keys = Object.keys(prev).sort();
        while (keys.length > 3) {
            delete prev[keys.shift()];
        }
        window.State.ui = { ...window.State.ui, generalAgendaDone: prev };
        window.State.saveUI();
    }

    function buildGeneralAgenda(rows, nextBuy, split) {
        const items = [];
        (nextBuy.escalate || []).slice(0, 2).forEach(r => {
            const mp = r.lote._mp || 'meli';
            const stock = r.calc.inventarioRestante || 0;
            items.push({
                id: `restock:${mp}:${r.lote.id}`,
                kind: 'restock',
                title: stock <= 2 || r.calc.estrategia === 'AGOTADO'
                    ? `Reponer · ${short(r.lote.producto, 36)}`
                    : `Escalar · ${short(r.lote.producto, 36)}`,
                sub: `${mp === 'amazon' ? 'Amazon' : 'Meli'} · util ${Calc.fmtMXN(r.calc.utilidad)} · stock ${stock}`,
                mp,
                loteId: r.lote.id,
            });
        });
        (nextBuy.liquidate || []).slice(0, 2).forEach(r => {
            const mp = r.lote._mp || 'meli';
            items.push({
                id: `liq:${mp}:${r.lote.id}`,
                kind: 'liquidate',
                title: `Liquidar · ${short(r.lote.producto, 36)}`,
                sub: `${mp === 'amazon' ? 'Amazon' : 'Meli'} · atrapado ${Calc.fmtMXN(r.calc.valorInventario)}`,
                mp,
                loteId: r.lote.id,
            });
        });
        const feeHeavy = (rows || [])
            .filter(r => (r.calc.vendidas || 0) > 0 && (r.calc.margen || 0) < 0.12)
            .sort((a, b) => (a.calc.margen || 0) - (b.calc.margen || 0))[0];
        if (feeHeavy) {
            const mp = feeHeavy.lote._mp || 'meli';
            items.push({
                id: `fee:${mp}:${feeHeavy.lote.id}`,
                kind: 'fee',
                title: `Revisar margen · ${short(feeHeavy.lote.producto, 36)}`,
                sub: `Margen ${Calc.fmtPct(feeHeavy.calc.margen)} · posible fee/precio`,
                mp,
                loteId: feeHeavy.lote.id,
            });
        }
        const reinversion = unifiedAllocState().buckets.reinversion || 0;
        if (reinversion > 0) {
            items.push({
                id: `capital:split`,
                kind: 'capital',
                title: `Desplegar reinversión · ${Calc.fmtMXN(reinversion)}`,
                sub: split.line,
                mp: split.pctAmz > split.pctMeli ? 'amazon' : 'meli',
                loteId: '',
            });
        }
        const done = readAgendaDone();
        return items.slice(0, 6).map(it => ({ ...it, done: done.set.has(it.id) }));
    }

    function unifiedAllocState() {
        const meli = readAllocStateFor('meli');
        const amz = readAllocStateFor('amazon');
        const buckets = emptyAllocBuckets();
        ALLOC_BUCKETS.forEach(({ key }) => {
            buckets[key] = round2((meli.buckets[key] || 0) + (amz.buckets[key] || 0));
        });
        const total = round2(ALLOC_BUCKETS.reduce((s, b) => s + (buckets[b.key] || 0), 0));
        const percents = total > 0
            ? Object.fromEntries(ALLOC_BUCKETS.map(b => [b.key, round2(((buckets[b.key] || 0) / total) * 100)]))
            : defaultAllocPercents();
        return { buckets, percents, total, meli, amz };
    }

    function fmtDaysInv(d) {
        if (d == null || !Number.isFinite(d)) return 'Sin rotación 30d';
        if (d <= 0) return '0 d';
        if (d > 999) return '>999 d';
        return `${Math.round(d)} d`;
    }

    function layGeneralExecutive(exec) {
        const {
            nMeli, nAmz, aggCombined, hardMeli, hardAmz,
            monthStats, goals, split, nextBuy, agenda, alerts, allocUnified,
        } = exec;
        const trapped = aggCombined.valorInventario || 0;
        const goalUtil = goals.utilidad || 0;
        const goalCash = goals.cashIn || 0;
        const pctUtil = goalUtil > 0 ? monthStats.ganancia / goalUtil : null;
        const pctCash = goalCash > 0 ? monthStats.cashIn / goalCash : null;
        const healthUtil = goalUtil > 0
            ? (monthStats.ganancia >= goalUtil ? 'ok' : (monthStats.projGain >= goalUtil ? 'warn' : 'bad'))
            : (monthStats.ganancia >= 0 ? 'ok' : 'bad');
        const reinversion = allocUnified.buckets.reinversion || 0;
        const alertN = alerts.nEscLow + alerts.nLiq + alerts.nAgot + alerts.nAds;
        const monthCap = monthStats.monthLabel
            ? monthStats.monthLabel.charAt(0).toUpperCase() + monthStats.monthLabel.slice(1)
            : '';
        const healthLabel = healthUtil === 'ok' ? 'En ritmo' : (healthUtil === 'warn' ? 'Ajustar ritmo' : 'Fuera de meta');
        const moreFlags = readGxMoreOpen();
        // BC: si el flag legacy era boolean, lo usábamos como "canales open".
        const moreOpen = moreFlags.canales;

        return `
            <section class="dash-section dash-exec gx-exec dash-section-rise" id="gx-pulso">
                <div class="gx-hero gx-hero-compact">
                    <div class="gx-hero-copy">
                        <p class="gx-sub">${esc(monthCap)} · día ${monthStats.daysElapsed}/${monthStats.daysInMonth} · ${nMeli + nAmz} productos</p>
                        <div class="gx-hero-ctas">
                            <button type="button" class="btn primary gx-btn-solid" data-lote-new>Nuevo lote</button>
                            <button type="button" class="btn gx-btn-ghost" data-dash-goto-mp="meli">Mercado Libre</button>
                            <button type="button" class="btn gx-btn-ghost" data-dash-goto-mp="amazon">Amazon</button>
                            <button type="button" class="btn gx-btn-ghost" data-general-snapshot>Exportar cierre</button>
                        </div>
                    </div>
                    <div class="gx-hero-metric tone-${healthUtil}">
                        <div class="gx-hero-metric-label">Utilidad del mes</div>
                        <div class="gx-hero-metric-value"${UI.fxAttrs?.(monthStats.ganancia, 'mxn') || ''}>${Calc.fmtMXN(monthStats.ganancia)}</div>
                        <div class="gx-hero-metric-meta">
                            <span class="gx-chip tone-${healthUtil}">${esc(healthLabel)}</span>
                            <span>${goalUtil > 0 ? `${fmtGoalPct(pctUtil)} de meta` : 'Sin meta'}</span>
                        </div>
                    </div>
                </div>

                <div class="gx-scoreboard gx-scoreboard-3" id="dash-pulse">
                    ${layScoreMetric({
                        label: 'Cash in del mes',
                        value: Calc.fmtMXN(monthStats.cashIn),
                        fxNum: monthStats.cashIn,
                        tone: 'neutral',
                        hint: goalCash > 0 ? `${fmtGoalPct(pctCash)} de meta` : `${monthStats.unidades} uds`,
                        foot: `Proy. ${Calc.fmtMXN(monthStats.projCash)}`,
                        progress: goalCash > 0 ? Math.min(1, Math.max(0, pctCash)) : null,
                    })}
                    ${layScoreMetric({
                        label: 'Capital atrapado',
                        value: Calc.fmtMXN(trapped),
                        fxNum: trapped,
                        tone: trapped > 0 ? 'warn' : 'ok',
                        hint: 'Inventario al costo',
                        foot: `Disponible ${Calc.fmtMXN(reinversion)}`,
                    })}
                    ${layScoreMetric({
                        label: 'Atención',
                        value: String(alertN),
                        fxNum: alertN,
                        fxFmt: 'int',
                        tone: alertN > 0 ? 'bad' : 'ok',
                        hint: alertN > 0 ? 'Requieren acción' : 'Sin críticas',
                        foot: alerts.line,
                    })}
                </div>
            </section>

            <section class="dash-section dash-section-rise" id="gx-acciones">
                <div class="dash-section-copy">
                    <h2 class="dash-section-title">Agenda y prioridades</h2>
                    <p class="dash-section-lead">Qué hacer hoy con el capital</p>
                </div>
                <div class="gx-actions dash-split-2">
                    <div class="dash-panel gx-panel dash-panel-quiet">
                        <div class="gx-panel-head">
                            <h3>Prioridades</h3>
                            <p class="muted small">Escalar · liquidar</p>
                        </div>
                        <div class="dash-next-cols">
                            <div>
                                <h4 class="dash-next-h">Escalar / reponer</h4>
                                ${layNextList(nextBuy.escalate, 'escalar')}
                            </div>
                            <div>
                                <h4 class="dash-next-h">Liquidar</h4>
                                ${layNextList(nextBuy.liquidate, 'liquidar')}
                            </div>
                        </div>
                    </div>
                    <div class="dash-panel gx-panel dash-panel-quiet">
                        <div class="gx-panel-head">
                            <h3>Agenda</h3>
                            <p class="muted small">Hoy</p>
                        </div>
                        <ul class="dash-agenda">
                            ${agenda.length ? agenda.map(it => `
                                <li class="dash-agenda-item${it.done ? ' is-done' : ''}" data-agenda-id="${esc(it.id)}">
                                    <div class="dash-agenda-check">
                                        <input type="checkbox" data-agenda-toggle ${it.done ? 'checked' : ''} aria-label="Hecho">
                                        <button type="button" class="dash-agenda-body" data-agenda-open data-mp="${esc(it.mp || '')}" data-lote="${esc(it.loteId || '')}">
                                            <strong>${esc(it.title)}</strong>
                                            <span class="muted">${esc(it.sub)}</span>
                                        </button>
                                    </div>
                                </li>
                            `).join('') : '<li class="muted">Sin pendientes urgentes</li>'}
                        </ul>
                    </div>
                </div>
            </section>

            <section class="dash-section dash-section-rise" id="gx-invmap">
                <div class="dash-section-copy">
                    <h2 class="dash-section-title">Sano vs flojo</h2>
                    <p class="dash-section-lead">Capital en margen sano (≥20%) vs flojo</p>
                </div>
                <div class="dash-panel dash-panel-quiet gx-invmap-panel">
                    ${layInvMarginMap(aggCombined.rows || [])}
                </div>
            </section>

            <section class="dash-section dash-section-rise" id="gx-metas">
                <div class="dash-section-copy">
                    <h2 class="dash-section-title">Metas del mes</h2>
                    <p class="dash-section-lead">Objetivo simple. El pulso sigue el ritmo.</p>
                </div>
                <div class="dash-panel dash-panel-quiet gx-goals-panel">
                    <div class="gx-goals">
                        <div class="gx-goals-main">
                            <div class="gx-goals-fields">
                                <label class="gx-field">
                                    <span>Meta utilidad (MXN)</span>
                                    <input type="number" min="0" step="100" data-goal-utilidad value="${goalUtil || ''}" placeholder="0">
                                </label>
                                <label class="gx-field">
                                    <span>Meta cash in (MXN)</span>
                                    <input type="number" min="0" step="100" data-goal-cash value="${goalCash || ''}" placeholder="0">
                                </label>
                                <button type="button" class="btn primary gx-btn-solid" data-goal-save>Guardar metas</button>
                            </div>
                        </div>
                        <div class="gx-goals-pace">
                            ${layGoalBar('Utilidad', monthStats.ganancia, goalUtil, monthStats.projGain)}
                            ${layGoalBar('Cash in', monthStats.cashIn, goalCash, monthStats.projCash)}
                        </div>
                    </div>
                </div>
            </section>

            <details class="gx-more dash-section-rise" id="gx-canales" data-gx-more-persist="canales" ${moreOpen ? 'open' : ''}>
                <summary class="gx-more-summary">Más detalle · canales y capital</summary>
                <div class="gx-more-body">
                    <div class="gx-alloc-suggest" aria-label="Asignación sugerida de capital">
                        <div class="gx-alloc-copy">
                            <span class="gx-alloc-title">Peso sugerido</span>
                            <span class="muted small">${esc(split.line)}</span>
                        </div>
                        <div class="gx-alloc-track">
                            <span class="gx-alloc-meli" style="width:${split.pctMeli}%"></span>
                            <span class="gx-alloc-amz" style="width:${split.pctAmz}%"></span>
                        </div>
                        <div class="gx-alloc-meta">
                            <span><i class="gx-dot meli"></i> Meli ${split.pctMeli}%</span>
                            <span><i class="gx-dot amz"></i> Amazon ${split.pctAmz}%</span>
                        </div>
                    </div>
                    ${layChannelMatrix(exec.aggMeli, exec.aggAmz, nMeli, nAmz, hardMeli, hardAmz)}
                    <div class="gx-canales-capital">${layCapitalUnificado(allocUnified)}</div>
                </div>
            </details>
        `;
    }

    function fmtGoalPct(ratio) {
        if (ratio == null || !Number.isFinite(ratio)) return '—';
        return `${Math.round(ratio * 100)}%`;
    }

    function layScoreMetric({ label, value, tone, hint, foot, progress = null, primary = false, fxNum = null, fxFmt = 'mxn' }) {
        const t = tone || 'neutral';
        const bar = progress == null ? '' : `
            <div class="gx-metric-bar" aria-hidden="true">
                <span style="width:${Math.round(progress * 100)}%"></span>
            </div>`;
        const fx = fxNum != null && Number.isFinite(Number(fxNum))
            ? (UI.fxAttrs?.(fxNum, fxFmt) || '')
            : '';
        return `
            <article class="gx-metric tone-${t}${primary ? ' is-primary' : ''}">
                <div class="gx-metric-top">
                    <span class="gx-metric-label">${esc(label)}</span>
                    <span class="gx-metric-status" aria-hidden="true"></span>
                </div>
                <div class="gx-metric-value"${fx}>${value}</div>
                ${bar}
                <div class="gx-metric-hint">${esc(hint || '')}</div>
                <div class="gx-metric-foot">${esc(foot || '')}</div>
            </article>`;
    }

    function layChannelMatrix(aggMeli, aggAmz, nMeli, nAmz, hardMeli, hardAmz) {
        const rows = [
            { label: 'SKU activos', m: String(nMeli), a: String(nAmz) },
            { label: 'ROI del capital', m: Calc.fmtPct(hardMeli.roiCapital), a: Calc.fmtPct(hardAmz.roiCapital), tm: tone(hardMeli.roiCapital), ta: tone(hardAmz.roiCapital) },
            { label: 'Días de inventario', m: fmtDaysInv(hardMeli.diasInv), a: fmtDaysInv(hardAmz.diasInv) },
            { label: 'Fees + Ads / venta', m: Calc.fmtPct(hardMeli.feeAdsPct), a: Calc.fmtPct(hardAmz.feeAdsPct) },
            { label: 'Cash in', m: Calc.fmtMXN(aggMeli.cashIn), a: Calc.fmtMXN(aggAmz.cashIn) },
            { label: 'Ganancia realizada', m: Calc.fmtMXN(aggMeli.gananciaRealizada), a: Calc.fmtMXN(aggAmz.gananciaRealizada), tm: tone(aggMeli.gananciaRealizada), ta: tone(aggAmz.gananciaRealizada) },
            { label: 'Capital desplegado', m: Calc.fmtMXN(aggMeli.capitalDesplegado), a: Calc.fmtMXN(aggAmz.capitalDesplegado) },
            { label: 'Inventario al costo', m: Calc.fmtMXN(aggMeli.valorInventario), a: Calc.fmtMXN(aggAmz.valorInventario) },
        ];
        return `
            <div class="gx-matrix-wrap">
                <table class="gx-matrix">
                    <thead>
                        <tr>
                            <th scope="col">Indicador</th>
                            <th scope="col">
                                <span class="gx-ch-label"><i class="gx-dot meli"></i> Mercado Libre</span>
                                <button type="button" class="dash-chip-btn" data-dash-goto-mp="meli">Abrir</button>
                            </th>
                            <th scope="col">
                                <span class="gx-ch-label"><i class="gx-dot amz"></i> Amazon</span>
                                <button type="button" class="dash-chip-btn" data-dash-goto-mp="amazon">Abrir</button>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <th scope="row">${esc(r.label)}</th>
                                <td class="num ${r.tm || ''}">${r.m}</td>
                                <td class="num ${r.ta || ''}">${r.a}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    function layGoalBar(label, actual, goal, projected) {
        const hasGoal = goal > 0;
        const pct = hasGoal ? Math.min(100, Math.round((actual / goal) * 100)) : 0;
        const pctProj = hasGoal ? Math.min(150, Math.round((projected / goal) * 100)) : 0;
        return `
            <div class="dash-goal-bar">
                <div class="dash-goal-bar-top">
                    <span>${esc(label)}</span>
                    <strong class="mono">${Calc.fmtMXN(actual)}${hasGoal ? ` <span class="muted">/</span> ${Calc.fmtMXN(goal)}` : ''}</strong>
                </div>
                <div class="dash-goal-track">
                    ${hasGoal ? `<span class="dash-goal-proj" style="width:${Math.min(100, pctProj)}%"></span>` : ''}
                    <span class="dash-goal-fill" style="width:${hasGoal ? pct : 0}%"></span>
                </div>
                ${hasGoal
                    ? `<div class="muted small">Cierre proyectado ${Calc.fmtMXN(projected)} · ${pctProj}% meta</div>`
                    : '<div class="muted small">Sin meta</div>'}
            </div>`;
    }

    function layNextList(list, mode) {
        if (!list || !list.length) {
            return `<p class="muted small">${mode === 'liquidar' ? 'Sin SKUs en liquidación con stock.' : 'Sin candidatos claros a escalar.'}</p>`;
        }
        return `
            <ol class="dash-next-ol">
                ${list.map((r, i) => `
                    <li data-dash-lote="${esc(r.lote.id)}" data-dash-mp="${esc(r.lote._mp || '')}">
                        <span class="n">${i + 1}</span>
                        <span class="name">${esc(short(r.lote.producto, 32))}
                            <small class="dash-mp-mini">${r.lote._mp === 'amazon' ? 'Amz' : 'Meli'}</small>
                        </span>
                        <span class="num ${tone(mode === 'liquidar' ? -r.calc.valorInventario : r.calc.utilidad)}">
                            ${mode === 'liquidar'
                                ? Calc.fmtMXN(r.calc.valorInventario)
                                : Calc.fmtMXN(r.calc.utilidad)}
                        </span>
                    </li>
                `).join('')}
            </ol>`;
    }

    function layCapitalUnificado(st) {
        const stack = st.total > 0
            ? ALLOC_BUCKETS.map(b => {
                const val = st.buckets[b.key] || 0;
                if (val <= 0) return '';
                const w = Math.max(2, (val / st.total) * 100);
                return `<span class="dash-bolsa-seg alloc-${b.key}" style="width:${w.toFixed(1)}%" title="${esc(b.label)}: ${Calc.fmtMXN(val)}"></span>`;
            }).join('')
            : '<span class="dash-bolsa-seg is-empty">Sin dinero en bolsitas aún</span>';
        return `
            <div class="dash-panel dash-capital-unified">
                <div class="dash-bolsa-hero-label">Total en bolsitas</div>
                <div class="dash-bolsa-hero-value mono"${UI.fxAttrs?.(st.total, 'mxn') || ''}>${Calc.fmtMXN(st.total)}</div>
                <div class="dash-bolsa-stack" role="img" aria-label="Composición unificada">${stack}</div>
                <ul class="dash-legend-list" style="margin-top:12px">
                    ${ALLOC_BUCKETS.map(b => `
                        <li>
                            <span class="dash-dot alloc-dot-${b.key}"></span>
                            ${esc(b.label)}
                            <strong class="mono">${Calc.fmtMXN(st.buckets[b.key] || 0)}</strong>
                            <span class="muted">Meli ${Calc.fmtMXN(st.meli.buckets[b.key] || 0)} · Amz ${Calc.fmtMXN(st.amz.buckets[b.key] || 0)}</span>
                        </li>
                    `).join('')}
                </ul>
                <p class="muted small" style="margin-top:10px">
                    Disponible para comprar (reinversión): <strong class="mono">${Calc.fmtMXN(st.buckets.reinversion || 0)}</strong>
                </p>
            </div>
            ${layAsignacionDualReadonly()}
        `;
    }

    function bindGeneralExecutive(root, exec) {
        root.querySelectorAll('[data-goal-save]').forEach(btn => {
            btn.addEventListener('click', () => {
                const utilEl = root.querySelector('[data-goal-utilidad]');
                const cashEl = root.querySelector('[data-goal-cash]');
                saveGeneralGoals({
                    utilidad: utilEl ? utilEl.value : 0,
                    cashIn: cashEl ? cashEl.value : 0,
                });
                UI.toast?.('Metas del mes guardadas');
                render();
            });
        });
        root.querySelectorAll('[data-agenda-toggle]').forEach(input => {
            input.addEventListener('change', () => {
                const li = input.closest('[data-agenda-id]');
                const id = li?.dataset.agendaId;
                if (!id) return;
                toggleAgendaDone(id, input.checked);
                li.classList.toggle('is-done', input.checked);
            });
        });
        root.querySelectorAll('[data-agenda-open]').forEach(el => {
            el.addEventListener('click', () => {
                const mp = el.dataset.mp;
                const loteId = el.dataset.lote;
                if (loteId) {
                    openDashLote(loteId, mp);
                    return;
                }
                if (mp) {
                    if (window.App?.applyMarketplaceView) window.App.applyMarketplaceView(mp);
                    else document.querySelector(`.sb-mp [data-marketplace="${mp}"]`)?.click();
                }
            });
        });
        root.querySelectorAll('[data-general-snapshot]').forEach(btn => {
            btn.addEventListener('click', () => openGeneralSnapshot(exec));
        });
        root.querySelectorAll('[data-lote-new]').forEach(btn => {
            btn.addEventListener('click', () => {
                window.LotesView?.openModal?.(null);
            });
        });
        root.querySelectorAll('details[data-gx-more-persist]').forEach(el => {
            el.addEventListener('toggle', () => {
                const key = el.getAttribute('data-gx-more-persist') || 'canales';
                const flags = { ...readGxMoreOpen(), [key]: el.open };
                window.State.ui = { ...window.State.ui, gxMoreOpen: flags };
                window.State.saveUI();
            });
        });
    }

    /**
     * Lee el estado por-details. BC: si es boolean (modelo viejo) se usa como
     * "canales". Finanzas queda abierto por defecto para que las bolsitas sean
     * visibles al entrar a General sin clicks extra.
     */
    function readGxMoreOpen() {
        const raw = window.State.ui?.gxMoreOpen;
        const defaults = { canales: false, progreso: false, finanzas: true };
        if (raw === true || raw === false) {
            return { ...defaults, canales: !!raw };
        }
        if (raw && typeof raw === 'object') {
            return {
                canales: raw.canales === true,
                progreso: raw.progreso === true,
                finanzas: raw.finanzas !== false, // opt-out
            };
        }
        return defaults;
    }

    /** Inventario atrapado: sano (≥20% margen) vs flojo. */
    function buildInvCapitalStats(rows) {
        const total = { inv: 0, good: 0, weak: 0, margenW: 0 };
        (rows || []).forEach(r => {
            const inv = Math.max(0, Number(r.calc?.valorInventario) || 0);
            const rest = Math.max(0, Number(r.calc?.inventarioRestante) || 0);
            if (rest <= 0 || inv <= 0.009) return;
            const margen = Number(r.calc?.margen) || 0;
            total.inv += inv;
            total.margenW += margen * inv;
            if (margen >= 0.2) total.good += inv;
            else total.weak += inv;
        });
        total.margen = total.inv > 0 ? total.margenW / total.inv : 0;
        delete total.margenW;
        return total;
    }

    function layInvMarginMap(rows) {
        const stats = buildInvCapitalStats(rows);
        const trapped = stats.inv;

        if (trapped <= 0.009) {
            return `
                <div class="gx-invmap is-empty">
                    <div class="gx-invmap-empty">
                        <strong>Sin inventario con costo</strong>
                        <p class="muted">Cuando haya stock valuado, aquí ves sano vs flojo.</p>
                    </div>
                </div>`;
        }

        return `
            <div class="gx-invmap" data-invmap>
                <div class="gx-invmap-toolbar">
                    <div class="gx-invmap-insights">
                        <span class="gx-invmap-pill">${Calc.fmtMXN(trapped)} atrapado</span>
                        <span class="gx-invmap-pill">Margen ponderado ${Calc.fmtPct(stats.margen)}</span>
                    </div>
                </div>
                <div class="gx-invmap-body">${layInvMargenSplit(stats)}</div>
            </div>`;
    }

    function layInvMargenSplit(stats) {
        const total = stats.inv || 1;
        const good = stats.good;
        const weak = stats.weak;
        const wG = (good / total) * 100;
        const wW = (weak / total) * 100;
        return `
            <div class="gx-invsplit">
                <div class="gx-invsplit-bar" role="img" aria-label="Inventario sano versus flojo">
                    <span class="good" style="width:${wG}%"></span>
                    <span class="weak" style="width:${wW}%"></span>
                </div>
                <div class="gx-invsplit-grid">
                    <div class="gx-invsplit-card is-good">
                        <div class="k">Margen ≥ 20%</div>
                        <div class="v">${Calc.fmtMXN(good)}</div>
                        <div class="s">${Math.round(wG)}% del capital atrapado</div>
                    </div>
                    <div class="gx-invsplit-card is-weak">
                        <div class="k">Margen &lt; 20%</div>
                        <div class="v">${Calc.fmtMXN(weak)}</div>
                        <div class="s">${Math.round(wW)}% del capital atrapado</div>
                    </div>
                </div>
            </div>`;
    }

    function openGeneralSnapshot(exec) {
        const {
            monthStats, goals, alerts, split, nextBuy, allocUnified, hardMeli, hardAmz,
            nMeli, nAmz, aggCombined,
        } = exec;
        const when = new Date().toLocaleString('es-MX', {
            dateStyle: 'full', timeStyle: 'short',
        });
        const escRows = (list, mode) => (list || []).map((r, i) =>
            `<li>${i + 1}. ${esc(r.lote.producto)} (${r.lote._mp === 'amazon' ? 'Amz' : 'Meli'}) — ${
                mode === 'liq' ? Calc.fmtMXN(r.calc.valorInventario) : Calc.fmtMXN(r.calc.utilidad)
            }</li>`
        ).join('') || '<li>Sin datos</li>';
        const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Cierre General · Ventas</title>
<style>
  body{font-family:Calibri,Carlito,Candara,'Segoe UI',Arial,sans-serif;max-width:720px;margin:32px auto;padding:0 20px;color:#1a1d23;line-height:1.45}
  h1{font-size:28px;margin:0 0 4px} h2{font-size:16px;text-transform:uppercase;letter-spacing:.06em;color:#666;margin:28px 0 10px}
  .sub{color:#666;font-size:13px;margin-bottom:24px} .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .card{border:1px solid #ddd;border-radius:10px;padding:14px} .k{font-size:11px;text-transform:uppercase;color:#888}
  .v{font-size:22px;font-weight:700;margin-top:4px} ul{padding-left:18px;margin:0} li{margin:4px 0}
  @media print{body{margin:0} button{display:none}}
</style></head><body>
  <button onclick="window.print()" style="float:right;padding:8px 12px">Imprimir / PDF</button>
  <h1>Cierre · General</h1>
  <p class="sub">${esc(when)} · Meli ${nMeli} · Amazon ${nAmz}</p>
  <div class="grid">
    <div class="card"><div class="k">Utilidad mes</div><div class="v">${Calc.fmtMXN(monthStats.ganancia)}</div>
      <div class="sub">Meta ${goals.utilidad ? Calc.fmtMXN(goals.utilidad) : '—'} · proy. ${Calc.fmtMXN(monthStats.projGain)}</div></div>
    <div class="card"><div class="k">Cash in mes</div><div class="v">${Calc.fmtMXN(monthStats.cashIn)}</div>
      <div class="sub">Meta ${goals.cashIn ? Calc.fmtMXN(goals.cashIn) : '—'} · proy. ${Calc.fmtMXN(monthStats.projCash)}</div></div>
    <div class="card"><div class="k">Capital / ganancia total</div><div class="v">${Calc.fmtMXN(aggCombined.gananciaRealizada)}</div>
      <div class="sub">Capital ${Calc.fmtMXN(aggCombined.capitalDesplegado)} · stock ${Calc.fmtMXN(aggCombined.valorInventario)}</div></div>
    <div class="card"><div class="k">Bolsitas</div><div class="v">${Calc.fmtMXN(allocUnified.total)}</div>
      <div class="sub">Reinversión ${Calc.fmtMXN(allocUnified.buckets.reinversion || 0)}</div></div>
  </div>
  <h2>Alertas</h2><p>${esc(alerts.line)}</p>
  <h2>Split sugerido</h2><p>${esc(split.line)} · Meli ${split.pctMeli}% · Amazon ${split.pctAmz}%</p>
  <div class="grid">
    <div class="card"><div class="k">Meli ROI / días / fees+ads</div>
      <div>${Calc.fmtPct(hardMeli.roiCapital)} · ${esc(fmtDaysInv(hardMeli.diasInv))} · ${Calc.fmtPct(hardMeli.feeAdsPct)}</div></div>
    <div class="card"><div class="k">Amazon ROI / días / fees+ads</div>
      <div>${Calc.fmtPct(hardAmz.roiCapital)} · ${esc(fmtDaysInv(hardAmz.diasInv))} · ${Calc.fmtPct(hardAmz.feeAdsPct)}</div></div>
  </div>
  <h2>Escalar</h2><ul>${escRows(nextBuy.escalate, 'esc')}</ul>
  <h2>Liquidar</h2><ul>${escRows(nextBuy.liquidate, 'liq')}</ul>
  <p class="sub" style="margin-top:32px">Generado desde Ventas · vista General. Catálogos no mezclados.</p>
</body></html>`;
        const w = window.open('', '_blank', 'width=820,height=900');
        if (!w) {
            UI.toast?.('Permite ventanas emergentes para el snapshot', 'error');
            return;
        }
        // noopener en windowFeatures hace que open() devuelva null; cortamos opener a mano
        try { w.opener = null; } catch { /* ignore */ }
        w.document.open();
        w.document.write(html);
        w.document.close();
        try { w.focus(); } catch { /* ignore */ }
        UI.toast?.('Snapshot listo · imprime o guarda PDF');
    }

    function readAllocStateFor(mp) {
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
        const total = round2(ALLOC_BUCKETS.reduce((s, b) => s + (buckets[b.key] || 0), 0));
        return { buckets, percents: normalizePercents(raw.percents), total };
    }

    function layAsignacionDualReadonly() {
        return `
            <div class="dash-split-2">
                ${layAsignacionReadonlyBlock('Mercado Libre', 'meli')}
                ${layAsignacionReadonlyBlock(Data.mpBrand('amazon'), 'amazon')}
            </div>
        `;
    }

    function layAsignacionReadonlyBlock(label, mp) {
        const st = readAllocStateFor(mp);
        const stack = st.total > 0
            ? ALLOC_BUCKETS.map(b => {
                const val = st.buckets[b.key] || 0;
                if (val <= 0) return '';
                const w = Math.max(2, (val / st.total) * 100);
                return `<span class="dash-bolsa-seg alloc-${b.key}" style="width:${w.toFixed(1)}%" title="${esc(b.label)}: ${Calc.fmtMXN(val)}"></span>`;
            }).join('')
            : '<span class="dash-bolsa-seg is-empty">Sin dinero aún</span>';
        const shortBtn = mp === 'amazon' ? 'Amazon' : 'Meli';
        return `
            <div class="dash-panel dash-alloc-readonly">
                <div class="dash-alloc-head">
                    <div>
                        <h3>${esc(label)}</h3>
                        <p class="muted small">Solo lectura · edita en Inicio de este marketplace</p>
                    </div>
                    <button type="button" class="dash-chip-btn" data-dash-goto-mp="${mp}">Abrir ${esc(shortBtn)}</button>
                </div>
                <div class="dash-bolsa-hero-value" style="font-size:22px;margin:8px 0">${Calc.fmtMXN(st.total)}</div>
                <div class="dash-bolsa-stack" role="img">${stack}</div>
                <ul class="dash-legend-list" style="margin-top:12px">
                    ${ALLOC_BUCKETS.map(b => `
                        <li>
                            <span class="dash-dot alloc-dot-${b.key}"></span>
                            ${esc(b.label)}
                            <strong>${Calc.fmtMXN(st.buckets[b.key] || 0)}</strong>
                            <span class="muted">(${st.percents[b.key]}%)</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
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

    /** Venta ya repartida en bolsitas (Caja). No cuenta cobrado-sin-asignar ni legacy suelto. */
    function ventaIsCobrado(v) {
        return !!(v && Data.hasAsignacion?.(v));
    }

    /** Periodos del resumen: 7d · 30d · mes calendario · año calendario. */
    const SUM_PERIODS = ['7d', '30d', 'month', 'year'];

    function readSumPeriod() {
        const raw = window.State.ui?.dashSumPeriod;
        return SUM_PERIODS.includes(raw) ? raw : '30d';
    }

    /**
     * Ventanas [curStart…curEnd] y [prevStart…prevEnd] (días locales inclusivos).
     * Mes/año: compara el tramo corrido vs el mismo tramo del periodo anterior
     * (día 14 de ago → 1–14 jul), no el mes completo.
     */
    function resolveSumRange(periodKey = '30d', now = new Date()) {
        const today = Calc.startOfLocalDay(now);
        const y = today.getFullYear();
        const m = today.getMonth();
        const d = today.getDate();
        const dayMs = 86400000;
        const addDays = (date, n) => Calc.startOfLocalDay(new Date(date.getTime() + n * dayMs));
        const clampDay = (yy, mm, dd) => {
            const last = new Date(yy, mm + 1, 0).getDate();
            return Calc.startOfLocalDay(new Date(yy, mm, Math.min(dd, last)));
        };
        const monthShort = (date) => date.toLocaleDateString('es-MX', { month: 'short' }).replace(/\./g, '');
        const monthLong = (date) => date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

        if (periodKey === '7d') {
            const curStart = addDays(today, -6);
            return {
                key: '7d',
                label: '7 días',
                compareLabel: 'vs 7d prev.',
                curStart,
                curEnd: today,
                prevStart: addDays(today, -13),
                prevEnd: addDays(today, -7),
            };
        }
        if (periodKey === 'month') {
            const curStart = Calc.startOfLocalDay(new Date(y, m, 1));
            const prevEnd = clampDay(y, m - 1, d);
            const prevStart = Calc.startOfLocalDay(new Date(y, m - 1, 1));
            return {
                key: 'month',
                label: monthLong(today),
                compareLabel: `vs ${monthShort(prevStart)}`,
                curStart,
                curEnd: today,
                prevStart,
                prevEnd,
            };
        }
        if (periodKey === 'year') {
            const curStart = Calc.startOfLocalDay(new Date(y, 0, 1));
            const prevStart = Calc.startOfLocalDay(new Date(y - 1, 0, 1));
            const prevEnd = clampDay(y - 1, m, d);
            return {
                key: 'year',
                label: String(y),
                compareLabel: `vs ${y - 1}`,
                curStart,
                curEnd: today,
                prevStart,
                prevEnd,
            };
        }
        // 30d (default)
        const curStart = addDays(today, -29);
        return {
            key: '30d',
            label: '30 días',
            compareLabel: 'vs mes ant.',
            curStart,
            curEnd: today,
            prevStart: addDays(today, -59),
            prevEnd: addDays(today, -30),
        };
    }

    function inDayRange(day, start, end) {
        return !!(day && start && end && day >= start && day <= end);
    }

    /**
     * Estadísticas del periodo actual y del previo (misma duración / tramo).
     * Legacy sin fecha confiable no cae en ningún bucket.
     * Fechas solo-día usan Calc.effectiveSaleDay (futuro → hoy).
     */
    function heroPeriodStats(lotes, periodOrDays = 30) {
        const now = new Date();
        const range = typeof periodOrDays === 'object' && periodOrDays?.curStart
            ? periodOrDays
            : resolveSumRange(
                periodOrDays === 7 ? '7d' : periodOrDays === 365 ? 'year' : '30d',
                now,
            );
        const { curStart, curEnd, prevStart, prevEnd } = range;
        // vendido = bruto; cobrado = lo repartido en bolsitas (venta − fees);
        // inversion = costo × uds; recibes = venta − fees (Caja)
        const cur = { cobrado: 0, vendido: 0, inversion: 0, recibes: 0, ganancia: 0, uds: 0 };
        const prev = { cobrado: 0, vendido: 0, inversion: 0, recibes: 0, ganancia: 0, uds: 0 };
        let hasAnyPrev = false;
        let hasAnyCur = false;

        (lotes || []).forEach(lote => {
            const settings = settingsForTaggedLote(lote);
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            ventas.forEach(v => {
                const uds = Math.max(0, Number(v.unidades) || 0);
                if (!uds) return;
                const precio = Number(v.precio) || 0;
                const loteAt = loteAtSaleCost(lote, v);
                const costoUd = Number(loteAt.costo) || 0;
                const util = Calc.utilidadAtPrice(loteAt, precio, settings).utilidad;
                const inversion = Math.max(0, costoUd * uds);
                const recibes = typeof Data.ventaLiberacionAmount === 'function'
                    ? (Number(Data.ventaLiberacionAmount(lote, v, settings)) || 0)
                    : Math.max(0, (costoUd + (Number(util) || 0)) * uds);
                const saleDay = Calc.effectiveSaleDay(v.fecha, now);

                if (inDayRange(saleDay, curStart, curEnd)) {
                    cur.vendido += precio * uds;
                    cur.inversion += inversion;
                    cur.recibes += recibes;
                    cur.ganancia += util * uds;
                    cur.uds += uds;
                    hasAnyCur = true;
                } else if (inDayRange(saleDay, prevStart, prevEnd)) {
                    prev.vendido += precio * uds;
                    prev.inversion += inversion;
                    prev.recibes += recibes;
                    prev.ganancia += util * uds;
                    prev.uds += uds;
                    hasAnyPrev = true;
                }
                if (ventaIsCobrado(v)) {
                    const cobroDay = Calc.effectiveSaleDay(v.cobradoAt, now) || saleDay;
                    // Siempre venta − fees (liberación), no el bruto ni splits viejos mal guardados.
                    const cobradoAmt = recibes;
                    if (inDayRange(cobroDay, curStart, curEnd)) {
                        cur.cobrado += cobradoAmt;
                    } else if (inDayRange(cobroDay, prevStart, prevEnd)) {
                        prev.cobrado += cobradoAmt;
                        hasAnyPrev = true;
                    }
                }
            });
        });
        cur.inversion = round2(cur.inversion);
        prev.inversion = round2(prev.inversion);
        cur.recibes = round2(cur.recibes);
        prev.recibes = round2(prev.recibes);
        cur.cobrado = round2(cur.cobrado);
        prev.cobrado = round2(prev.cobrado);
        return { cur, prev, hasAnyPrev, hasAnyCur, range };
    }

    /**
     * Hero KPIs en una sola banda ordenada:
     *   Bruta → Fees → Neta → Cobrado → Costo → Ganancia → Bonif → Resultado → (Deuda FBA)
     */
    /** Resumen deuda flete inbound FBA (Amazon Inicio). Ledger completo en Envíos. */
    function readAmazonFreightBalance() {
        if (typeof window.Freight?.balance === 'function') {
            const n = Number(window.Freight.balance());
            if (Number.isFinite(n)) return round2(n);
        }
        if (typeof window.EnviosView?.balance === 'function') {
            const n = Number(window.EnviosView.balance());
            if (Number.isFinite(n)) return round2(n);
        }
        return 0;
    }

    /** Monto de hero: siempre 2 decimales (legible y uniforme al centrar). */
    function fmtHeroMXN(n) {
        if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
        return Calc.fmtMXN(Number(n));
    }

    function layHeroKPIs(lotes, opts = {}) {
        const periodKey = SUM_PERIODS.includes(opts.period) ? opts.period : readSumPeriod();
        const range = resolveSumRange(periodKey);
        const stats = heroPeriodStats(lotes, range);
        const label = range.label;
        const compareLabel = range.compareLabel;
        const isAmazon = window.State.marketplace === 'amazon' && window.State.ui?.mpView !== 'general';

        const bonif = bonifHeroStats(range);
        const totalCur = round2((stats.cur.ganancia || 0) + (bonif.cur || 0));
        const totalPrev = round2((stats.prev.ganancia || 0) + (bonif.prev || 0));

        const feesCur = round2(Math.max(0, (stats.cur.vendido || 0) - (stats.cur.recibes || 0)));
        const feesPrev = round2(Math.max(0, (stats.prev.vendido || 0) - (stats.prev.recibes || 0)));
        const cobradoPctCur = (stats.cur.recibes || 0) > 0.009
            ? Math.min(999, (stats.cur.cobrado / stats.cur.recibes) * 100)
            : null;
        const cobradoPctLabel = cobradoPctCur == null
            ? null
            : (cobradoPctCur >= 99.95
                ? '100%'
                : (cobradoPctCur >= 10
                    ? `${Math.round(cobradoPctCur)}%`
                    : `${cobradoPctCur.toFixed(1)}%`));
        const gananciaPctCur = Math.abs(stats.cur.recibes || 0) > 0.009
            ? (stats.cur.ganancia / stats.cur.recibes) * 100
            : null;
        const gananciaPctLabel = gananciaPctCur == null
            ? null
            : (Math.abs(gananciaPctCur) >= 10
                ? `${Math.round(gananciaPctCur)}%`
                : `${gananciaPctCur.toFixed(1)}%`);

        // Variación vs periodo anterior, en texto plano (null = no hay con qué comparar).
        const trend = (cur, prev) => {
            if (!stats.hasAnyPrev || Math.abs(prev) < 0.005) return null;
            const rel = (cur - prev) / Math.abs(prev);
            if (Math.abs(rel) < 0.0001) return { text: `Sin cambio ${compareLabel}`, tone: '' };
            const pct = Math.abs(rel * 100);
            return {
                text: `${rel > 0 ? '↑' : '↓'} ${pct >= 100 ? Math.round(pct) : pct.toFixed(1)}% ${compareLabel}`,
                tone: rel > 0 ? 'pos' : 'neg',
                title: `Periodo actual: ${Calc.fmtMXN(cur)} · anterior: ${Calc.fmtMXN(prev)}`,
            };
        };

        // El Resultado manda; lo de abajo sólo lo explica.
        // Bruta → Fees → Neta → Cobrado → Costo → Ganancia → Bonif → (Deuda FBA)
        const cells = [
            {
                name: 'Venta bruta',
                value: stats.cur.vendido,
                note: 'Lo que pagó el cliente',
            },
            {
                name: 'Fees',
                value: feesCur,
                tone: feesCur > 0.009 ? 'neg' : '',
                note: feesCur > 0.009 ? 'Comisiones y envío' : 'Sin fees',
                noteTitle: 'Venta bruta − venta neta · comisiones, envío, ads del marketplace',
            },
            {
                name: 'Venta neta',
                value: stats.cur.recibes,
                strong: true,
                note: 'Bruta − fees',
                noteTitle: 'Lo que entra a Caja / bolsitas',
            },
            {
                name: 'Cobrado',
                value: stats.cur.cobrado,
                note: cobradoPctLabel ? `${cobradoPctLabel} de la neta` : 'Sin cobros',
                noteTone: (stats.cur.cobrado || 0) > 0.009 ? 'pos' : '',
                noteTitle: 'Cobrado ÷ venta neta del periodo · lo repartido en bolsitas',
            },
            {
                name: 'Costo',
                value: stats.cur.inversion,
                note: (stats.cur.uds || 0) > 0 ? `${stats.cur.uds} ud vendidas` : 'Sin ventas',
                noteTitle: 'Lo invertido en las unidades vendidas',
            },
            {
                name: 'Ganancia',
                value: stats.cur.ganancia,
                tone: tone(stats.cur.ganancia),
                strong: true,
                note: gananciaPctLabel ? `${gananciaPctLabel} de la neta` : 'Sin venta neta',
                noteTone: gananciaPctLabel ? (stats.cur.ganancia >= 0 ? 'pos' : 'neg') : '',
                noteTitle: 'Ganancia ÷ venta neta del periodo',
            },
            {
                name: 'Bonificaciones',
                value: bonif.cur,
                tone: bonif.cur > 0.009 ? 'pos' : '',
                clickAttr: 'data-dash-open-bonif',
                note: bonif.nCur > 0 ? `${bonif.nCur} registradas` : 'Registrar',
            },
        ];

        if (isAmazon) {
            const freightBal = Math.max(0, readAmazonFreightBalance());
            const ledgerLen = Array.isArray(window.State.ui?.fbaInboundFreight?.ledger)
                ? window.State.ui.fbaInboundFreight.ledger.length
                : 0;
            cells.push({
                name: 'Deuda FBA',
                value: freightBal,
                tone: freightBal > 0 ? 'neg' : '',
                clickAttr: 'data-dash-goto-envios',
                note: freightBal > 0 ? 'Pendiente' : (ledgerLen ? 'Al día' : 'Envíos'),
                noteTone: freightBal > 0 ? 'neg' : '',
            });
        }

        const renderCell = (c, i) => {
            const tag = c.clickAttr ? 'button' : 'div';
            const cls = `dash-sum-cell${c.strong ? ' is-strong' : ''}${c.clickAttr ? ' is-action' : ''}`;
            const open = c.clickAttr
                ? `<button type="button" class="${cls}" style="--cell-i:${i}" ${c.clickAttr}>`
                : `<div class="${cls}" style="--cell-i:${i}">`;
            const noteCls = c.noteTone ? ` is-${c.noteTone}` : '';
            const noteTitle = c.noteTitle ? ` title="${esc(c.noteTitle)}"` : '';
            return `${open}
                        <span class="dash-sum-cell-name">${esc(c.name)}</span>
                        <span class="dash-sum-cell-value ${c.tone || ''}"${UI.fxAttrs?.(c.value, 'mxn') || ''}>${fmtHeroMXN(c.value)}</span>
                        <span class="dash-sum-cell-note${noteCls}"${noteTitle}>${esc(c.note)}</span>
                    </${tag}>`;
        };

        const heroTrend = trend(totalCur, totalPrev);
        const heroCaption = Math.abs(bonif.cur) > 0.009
            ? 'Ganancia del periodo más bonificaciones'
            : 'Utilidad neta del periodo';

        return `
            <div class="dash-hero-kpis is-rows" aria-label="Indicadores del periodo">
                <div class="dash-sum-toolbar">
                    <div class="dash-sum-seg" role="group" aria-label="Periodo del resumen">
                        <button type="button" class="dash-sum-seg-btn${periodKey === '7d' ? ' is-active' : ''}" data-dash-sum-period="7d">7 días</button>
                        <button type="button" class="dash-sum-seg-btn${periodKey === '30d' ? ' is-active' : ''}" data-dash-sum-period="30d">30 días</button>
                        <button type="button" class="dash-sum-seg-btn${periodKey === 'month' ? ' is-active' : ''}" data-dash-sum-period="month">Este mes</button>
                        <button type="button" class="dash-sum-seg-btn${periodKey === 'year' ? ' is-active' : ''}" data-dash-sum-period="year">Este año</button>
                    </div>
                </div>
                <section class="dash-sum" aria-label="Resumen del periodo">
                    <div class="dash-sum-hero">
                        <p class="dash-sum-eyebrow">Resultado · ${esc(label)}</p>
                        <p class="dash-sum-figure ${tone(totalCur)}"${UI.fxAttrs?.(totalCur, 'mxn') || ''}>${fmtHeroMXN(totalCur)}</p>
                        <p class="dash-sum-caption">
                            <span>${esc(heroCaption)}</span>
                            ${heroTrend
                                ? `<span class="dash-sum-trend is-${heroTrend.tone || 'flat'}" title="${esc(heroTrend.title || '')}">${esc(heroTrend.text)}</span>`
                                : ''}
                        </p>
                    </div>
                    <div class="dash-sum-grid">
                        ${cells.map(renderCell).join('')}
                    </div>
                </section>
            </div>
        `;
    }

    function layProgreso(lotes, opts = {}) {
        const period = opts.period === 'years' ? 'years' : opts.period === 'weeks' ? 'weeks' : 'months';
        const range = [3, 6, 12, 24].includes(Number(opts.range)) ? Number(opts.range) : 12;
        const showEmpty = opts.showEmpty === true;
        const chartType = ['hero', 'bars', 'lines', 'area'].includes(opts.chartType) ? opts.chartType : 'hero';
        const fromDate = opts.fromDate || '';
        const fromPreset = opts.fromPreset || '';
        const cashMode = opts.cashMode === 'vendido' ? 'vendido' : 'cobrado';
        const seriesVendido = buildProgressSeries(lotes, period, range, fromDate, 'vendido');
        const seriesCobrado = buildProgressSeries(lotes, period, range, fromDate, 'cobrado');
        const series = cashMode === 'vendido' ? seriesVendido : seriesCobrado;
        const visible = showEmpty ? series : series.filter(b => b.cashIn > 0 || b.ganancia > 0 || b.unidades > 0);
        const chartSeries = visible.length ? visible : series.slice(-Math.min(range, series.length || range));
        const sum = (arr, key) => arr.reduce((s, b) => s + (b[key] || 0), 0);
        const totalVendido = sum(seriesVendido, 'cashIn');
        const totalCobrado = sum(seriesCobrado, 'cashIn');
        const totalCash = cashMode === 'vendido' ? totalVendido : totalCobrado;
        const salesGain = sum(series, 'ganancia');
        const progRange = progressRangeFromSeries(series, period);
        const bonifProg = sumBonificacionesInRange(bonifMarketsForView(), progRange);
        const totalGain = round2(salesGain + (bonifProg.total || 0));
        const totalUds = sum(series, 'unidades');
        const emptyHidden = !showEmpty && series.some(b => !(b.cashIn > 0 || b.ganancia > 0 || b.unidades > 0));
        const mpView = window.State.ui?.mpView;
        const mpLabel = mpView === 'general'
            ? 'General (ambos)'
            : Data.mpBrand(window.State.marketplace);
        const modeHint = cashMode === 'cobrado'
            ? 'Solo marcado Cobrado en Caja'
            : 'Todas las ventas registradas';

        return `
            <div class="dash-panel dash-chart-panel">
                <div class="dash-chart-toolbar">
                    <div class="dash-prog-mode">
                        <div class="dash-seg" role="group" aria-label="Vendido o cobrado">
                            <button type="button" class="dash-seg-btn${cashMode === 'cobrado' ? ' active' : ''}" data-dash-cash="cobrado">Cobrado</button>
                            <button type="button" class="dash-seg-btn${cashMode === 'vendido' ? ' active' : ''}" data-dash-cash="vendido">Vendido</button>
                        </div>
                        <span class="dash-toolbar-hint">${esc(modeHint)}</span>
                    </div>
                    <div class="dash-chart-filters">
                        <div class="dash-from-row">
                            <label class="dash-from-field"><span>Desde</span>
                                <input type="date" data-dash-from value="${esc(fromDate)}" max="${esc(toISODate(new Date()))}">
                            </label>
                            <div class="dash-from-presets" role="group" aria-label="Filtros rápidos">
                                <button type="button" class="dash-chip-btn${fromPreset === 'month' ? ' active' : ''}" data-dash-from-preset="month">Mes actual</button>
                                <button type="button" class="dash-chip-btn${fromPreset === 'year' ? ' active' : ''}" data-dash-from-preset="year">Año actual</button>
                                ${fromDate ? '<button type="button" class="dash-chip-btn" data-dash-from-clear>Quitar</button>' : ''}
                            </div>
                        </div>
                        <div class="dash-filter-right">
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
                    </div>
                </div>
                ${renderProgressChart(chartType, chartSeries, {
                    totalCash,
                    totalGain,
                    salesGain,
                    bonificaciones: bonifProg.total,
                    bonificacionesN: bonifProg.n,
                    totalUds,
                    period,
                    cashMode,
                })}
                <p class="dash-chart-note">
                    ${emptyHidden
                        ? 'Periodos vacíos ocultos. Activa «Mostrar vacíos» para ver el calendario completo.'
                        : `${cashMode === 'cobrado' ? 'Cobrado' : 'Vendido'} · ${esc(mpLabel)}`}
                </p>
            </div>
        `;
    }

    /** Rango calendario cubierto por la serie de Progreso (para sumar bonificaciones). */
    function progressRangeFromSeries(series, period) {
        if (!series?.length) return null;
        const startRaw = parsePeriodKey(series[0].key, period);
        const lastRaw = parsePeriodKey(series[series.length - 1].key, period);
        if (!startRaw || Number.isNaN(startRaw.getTime()) || !lastRaw || Number.isNaN(lastRaw.getTime())) {
            return null;
        }
        const start = Calc.startOfLocalDay(startRaw);
        const now = Calc.startOfLocalDay(new Date());
        if (!start || !now) return null;
        let end;
        if (period === 'years') {
            end = Calc.startOfLocalDay(new Date(lastRaw.getFullYear(), 11, 31));
        } else if (period === 'weeks') {
            end = Calc.startOfLocalDay(new Date(lastRaw.getFullYear(), lastRaw.getMonth(), lastRaw.getDate() + 6));
        } else {
            end = Calc.startOfLocalDay(new Date(lastRaw.getFullYear(), lastRaw.getMonth() + 1, 0));
        }
        if (!end) return null;
        if (end > now) end = now;
        if (end < start) end = start;
        return { start, end };
    }

    function buildProgressSeries(lotes, period, range = 12, fromISO = '', cashMode = 'cobrado') {
        const fromDate = parseISODate(fromISO);
        const mode = cashMode === 'vendido' ? 'vendido' : 'cobrado';
        const now = new Date();
        const map = new Map();
        (lotes || []).forEach(lote => {
            const settings = settingsForTaggedLote(lote);
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];

            if (ventas.length) {
                ventas.forEach(v => {
                    if (mode === 'cobrado' && !ventaIsCobrado(v)) return;
                    // Cobrado: fecha de cobro (cash-basis); Vendido: fecha de venta.
                    // effectiveSaleDay: fechas “mañana” no caen fuera del eje (hasta hoy).
                    const d = mode === 'cobrado'
                        ? (Calc.effectiveSaleDay(v.cobradoAt, now) || Calc.effectiveSaleDay(v.fecha, now))
                        : Calc.effectiveSaleDay(v.fecha, now);
                    if (!d) return;
                    if (fromDate && d < fromDate) return;
                    const key = periodKey(d, period);
                    if (!map.has(key)) map.set(key, emptyBucket(key, d, period));
                    const b = map.get(key);
                    const uds = Math.max(0, Number(v.unidades) || 0);
                    const precio = Number(v.precio) || 0;
                    const loteAt = loteAtSaleCost(lote, v);
                    const u = Calc.utilidadAtPrice(loteAt, precio, settings).utilidad;
                    const liberacion = typeof Data.ventaLiberacionAmount === 'function'
                        ? (Number(Data.ventaLiberacionAmount(lote, v, settings)) || 0)
                        : Math.max(0, ((Number(loteAt.costo) || 0) + (Number(u) || 0)) * uds);
                    // Cobrado = venta − fees (liberación a bolsitas); Vendido = bruto.
                    b.cashIn += mode === 'cobrado' ? liberacion : (precio * uds);
                    b.ganancia += u * uds;
                    b.unidades += uds;
                    b.pedidos += 1;
                });
                return;
            }

            // Legacy sin eventos: cuenta en ambos modos (historial viejo = ya cobrado)
            const vendidas = Math.max(0, Number(lote.vendidas) || 0);
            if (!vendidas) return;
            const d = Calc.effectiveSaleDay(lote.fecha, now) || Calc.startOfLocalDay(now);
            if (!d) return;
            if (fromDate && d < fromDate) return;
            const key = periodKey(d, period);
            if (!map.has(key)) map.set(key, emptyBucket(key, d, period));
            const b = map.get(key);
            const precio = Number(lote.precio) || 0;
            const calc = Calc.computeLote(lote, settings);
            b.cashIn += precio * vendidas;
            b.ganancia += calc.utilidad * vendidas;
            b.unidades += vendidas;
            b.pedidos += 1;
        });

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
        return Calc.parseSaleDate(raw);
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
        const spark = progressSpark(buckets, { focusIndex: cur.i, areaMode: 'both' });
        const deltaHtml = deltaPct == null
            ? '<span class="dash-hero-delta is-na">Sin periodo previo</span>'
            : `<span class="dash-hero-delta ${tone(deltaGain)}" title="vs ${esc(prev.b.label)}: ${Calc.fmtMXN(deltaGain)}">
                    ${deltaGain >= 0 ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(0)}% vs ${esc(periodWord)} anterior
               </span>`;

        return `
            <div class="dash-hero-chart">
                <div class="dash-hero-main">
                    <p class="dash-hero-label">Ganancia del periodo</p>
                    <p class="dash-hero-value ${tone(ctx.totalGain)}">${Calc.fmtMXN(ctx.totalGain || 0)}</p>
                    <div class="dash-hero-meta">
                        ${deltaHtml}
                        <p class="dash-hero-sub">
                            <span>${ctx.cashMode === 'vendido' ? 'Vendido' : 'Cobrado'} ${Calc.fmtMXN(ctx.totalCash || 0)}</span>
                            <span>${ctx.totalUds || 0} uds</span>
                            <span>Último: ${esc(cur.b.tip || cur.b.label || '—')}</span>
                        </p>
                        ${Math.abs(ctx.bonificaciones || 0) > 0.009
                            ? `<p class="dash-hero-bonif">Incluye ${Calc.fmtMXN(ctx.bonificaciones)} en bonificaciones</p>`
                            : ''}
                    </div>
                </div>
                <div class="dash-hero-spark" data-focus-index="${cur.i}">
                    ${spark}
                    ${chartLegendAndDetail(ctx)}
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
                ${chartLegendAndDetail(ctx)}
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
                <div class="dash-progress-chart" role="img" aria-label="Barras ${ctx.cashMode === 'vendido' ? 'vendido' : 'cobrado'} y ganancia">
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
                ${chartLegendAndDetail(ctx)}
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
            <span class="muted small">Total ganancia ${Calc.fmtMXN(ctx.totalGain || 0)} · ${ctx.cashMode === 'vendido' ? 'Vendido' : 'Cobrado'} ${Calc.fmtMXN(ctx.totalCash || 0)}</span>
        </div>`;
    }

    function chartLegendAndDetail(ctx = {}) {
        const cashLabel = ctx.cashMode === 'vendido' ? 'Vendido' : 'Cobrado';
        return `
            <div class="dash-chart-legend">
                <span class="leg-gain">Ganancia</span>
                <span class="leg-cash">${cashLabel}</span>
            </div>
            <div class="dash-spark-detail muted small" data-dash-spark-detail>
                Pasa el cursor o toca un punto del gráfico.
            </div>`;
    }

    /** Catmull-Rom → cubic Bézier (curvas suaves tipo “producto”). */
    function smoothLinePath(vals, xAt, yAt) {
        const n = vals.length;
        if (!n) return '';
        const pts = vals.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
        if (n === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
        if (n === 2) {
            return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;
        }
        let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
        for (let i = 0; i < n - 1; i++) {
            const p0 = pts[i - 1] || pts[i];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[i + 2] || p2;
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
        }
        return d;
    }

    function progressSpark(buckets, opts = {}) {
        const W = 640, H = 200, padL = 10, padR = 10, padT = 16, padB = 30;
        const n = buckets.length;
        const focusIndex = Number.isFinite(opts.focusIndex) ? opts.focusIndex : -1;
        const areaMode = opts.areaMode || 'gain'; // gain | both | none
        const uid = `ps${Math.random().toString(36).slice(2, 9)}`;
        const xAt = i => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
        const cashVals = buckets.map(b => Math.max(0, Number(b.cashIn) || 0));
        const gainVals = buckets.map(b => Number(b.ganancia) || 0);
        const yMax = Math.max(1, ...cashVals, ...gainVals);
        const yMin = Math.min(0, ...gainVals);
        const ySpan = Math.max(yMax - yMin, 1);
        const yAt = v => padT + (1 - (v - yMin) / ySpan) * (H - padT - padB);
        const zeroY = yAt(0);
        const gainPath = smoothLinePath(gainVals, xAt, yAt);
        const cashPath = smoothLinePath(cashVals, xAt, yAt);
        const areaFor = (path) => (n
            ? `${path} L${xAt(n - 1).toFixed(1)},${zeroY.toFixed(1)} L${xAt(0).toFixed(1)},${zeroY.toFixed(1)} Z`
            : '');

        let areas = '';
        if (areaMode === 'both') {
            areas += `<path class="dash-area-cash" d="${areaFor(cashPath)}" fill="url(#${uid}-cash)" />`;
        }
        if (areaMode === 'gain' || areaMode === 'both') {
            areas += `<path class="dash-area-gain" d="${areaFor(gainPath)}" fill="url(#${uid}-gain)" />`;
        }

        // Hits en SVG (estirado); puntos redondos en HTML overlay (sin óvalos).
        const band = n <= 1 ? (W - padL - padR) : (W - padL - padR) / Math.max(1, n - 1);
        const hitW = Math.max(20, Math.min(52, band * 0.92));
        const marks = buckets.map((b, i) => {
            const gx = xAt(i);
            const active = i === focusIndex ? ' is-focus' : '';
            const hx = Math.max(0, gx - hitW / 2);
            return `
                <g class="dash-pt${active}" data-dash-point="${i}">
                    <rect class="dash-focus-band"
                        x="${hx.toFixed(1)}" y="${padT}"
                        width="${hitW.toFixed(1)}" height="${(H - padT - padB).toFixed(1)}" />
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
                </g>`;
        }).join('');

        const markers = buckets.map((b, i) => {
            const left = (xAt(i) / W) * 100;
            const topCash = (yAt(cashVals[i]) / H) * 100;
            const topGain = (yAt(gainVals[i]) / H) * 100;
            const focus = i === focusIndex ? ' is-focus' : '';
            return `
                <span class="dash-dot-html is-cash${focus}" data-dash-dot="${i}" style="left:${left.toFixed(2)}%;top:${topCash.toFixed(2)}%"></span>
                <span class="dash-dot-html is-gain${focus}" data-dash-dot="${i}" style="left:${left.toFixed(2)}%;top:${topGain.toFixed(2)}%"></span>`;
        }).join('');

        const midLabel = yMin < 0 ? shortMoney((yMax + yMin) / 2) : shortMoney(yMax / 2);
        const bottomLabel = yMin < 0 ? shortMoney(yMin) : '$0';

        return `
            <div class="dash-progress-chart dash-progress-line" role="img" aria-label="Tendencia de ganancia y cobrado/vendido">
                <div class="dash-progress-y">
                    <span>${shortMoney(yMax)}</span>
                    <span>${midLabel}</span>
                    <span>${bottomLabel}</span>
                </div>
                <div class="dash-progress-plot">
                    <div class="dash-progress-grid" aria-hidden="true"></div>
                    <div class="dash-spark-stage">
                        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="dash-line-svg">
                            <defs>
                                <linearGradient id="${uid}-gain" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stop-color="#30D158" stop-opacity="0.38"/>
                                    <stop offset="55%" stop-color="#30D158" stop-opacity="0.12"/>
                                    <stop offset="100%" stop-color="#30D158" stop-opacity="0"/>
                                </linearGradient>
                                <linearGradient id="${uid}-cash" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stop-color="#0071e3" stop-opacity="0.22"/>
                                    <stop offset="60%" stop-color="#0071e3" stop-opacity="0.07"/>
                                    <stop offset="100%" stop-color="#0071e3" stop-opacity="0"/>
                                </linearGradient>
                                <filter id="${uid}-glow" x="-20%" y="-20%" width="140%" height="140%">
                                    <feGaussianBlur stdDeviation="1.6" result="b"/>
                                    <feMerge>
                                        <feMergeNode in="b"/>
                                        <feMergeNode in="SourceGraphic"/>
                                    </feMerge>
                                </filter>
                            </defs>
                            ${areas}
                            <path class="dash-line-cash" d="${cashPath}" fill="none" vector-effect="non-scaling-stroke" />
                            <path class="dash-line-gain" d="${gainPath}" fill="none" vector-effect="non-scaling-stroke" filter="url(#${uid}-glow)" />
                            ${marks}
                        </svg>
                        <div class="dash-spark-markers" aria-hidden="true">${markers}</div>
                    </div>
                    <div class="dash-progress-xlabels">
                        ${buckets.map((b, i) => `<span class="${i === focusIndex ? 'is-focus' : ''}" data-dash-xlabel="${i}" title="${esc(b.tip)}">${esc(b.label)}</span>`).join('')}
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
        const cashLabel = window.State.ui?.dashCashMode === 'vendido' ? 'Vendido' : 'Cobrado';
        return `<strong>${esc(tip)}</strong> · ${cashLabel} ${Calc.fmtMXN(cash)} · Ganancia <span class="${tone(gain)}">${Calc.fmtMXN(gain)}</span> · ${uds} uds · ${pedidos} venta${pedidos === 1 ? '' : 's'}`;
    }

    /** Abre un lote cambiando marketplace con chrome completo (no solo switchMarketplace). */
    function openDashLote(id, mp) {
        if (!id || !window.LotesView?.selectAndGo) return;
        if (mp && (mp === 'meli' || mp === 'amazon')) {
            const curView = Data.normalizeMpView?.(
                window.State.ui?.mpView === 'general'
                    ? 'general'
                    : (window.State.ui?.mpView || window.State.marketplace)
            ) || window.State.marketplace;
            if (mp !== curView || mp !== window.State.marketplace) {
                if (window.App?.applyMarketplaceView) window.App.applyMarketplaceView(mp, { toast: false });
                else {
                    window.State.ui = { ...window.State.ui, mpView: mp };
                    window.State.saveUI();
                    window.State.switchMarketplace(mp);
                    window.App?.refreshMarketplaceChrome?.();
                }
            }
        }
        LotesView.selectAndGo(id);
    }

    function shortMoney(n) {
        const v = Math.abs(n);
        if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
        if (v >= 1e3) return `$${(n / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
        return `$${Math.round(n)}`;
    }

    function buildContext(agg) {
        const rows = agg.rows;
        const isGeneral = window.State.ui?.mpView === 'general';
        const isAmazon = isGeneral ? null : (window.State.marketplace === 'amazon');
        let fees = 0;
        let costoVendido = 0;
        let gastoAds = 0;
        rows.forEach(({ lote, calc }) => {
            const sum = sumFeesAndCogs(lote, settingsForTaggedLote(lote));
            fees += sum.fees;
            costoVendido += sum.costoVendido;
            gastoAds += calc.gastoAds;
        });
        return { agg, rows, fees, costoVendido, gastoAds, isAmazon, isGeneral };
    }

    /** Preferencia de corte del P&G: month (default) | prev | all */
    function readPyGPeriodMode() {
        const m = window.State.ui?.dashPyGPeriod;
        return (m === 'prev' || m === 'all') ? m : 'month';
    }

    /**
     * Rango calendario del P&G.
     * month = mes actual hasta hoy; prev = mes anterior completo; all = sin filtro.
     */
    function resolvePyGPeriod(now = new Date()) {
        const mode = readPyGPeriodMode();
        if (mode === 'all') {
            return { mode, start: null, end: null, label: 'Todo el historial' };
        }
        const y = now.getFullYear();
        const m = now.getMonth();
        if (mode === 'prev') {
            const start = new Date(y, m - 1, 1);
            const end = Calc.startOfLocalDay(new Date(y, m, 0));
            const label = start.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
            return { mode, start, end, label: label.charAt(0).toUpperCase() + label.slice(1) };
        }
        const start = new Date(y, m, 1);
        const end = Calc.startOfLocalDay(now);
        const label = start.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
        return { mode, start, end, label: label.charAt(0).toUpperCase() + label.slice(1) };
    }

    function saleInPyGRange(fecha, range) {
        if (!range || !range.start) return true;
        const d = Calc.effectiveSaleDay(fecha);
        if (!d) return false;
        if (d < range.start) return false;
        if (range.end && d > range.end) return false;
        return true;
    }

    /**
     * Recorta ctx del P&G / detalle a las ventas del rango.
     * Ads de lote son lifetime → solo se muestran en modo «Todo».
     */
    function sliceCtxForPyG(ctx, range) {
        const resolved = range || resolvePyGPeriod();
        const markets = ctx.isGeneral
            ? ['meli', 'amazon']
            : [window.State.marketplace === 'amazon' ? 'amazon' : 'meli'];
        const bonif = sumBonificacionesInRange(markets, resolved.start ? resolved : null);

        if (!resolved.start) {
            return { ...ctx, pygPeriod: resolved, bonificaciones: bonif.total, bonificacionesN: bonif.n };
        }
        const slicedRows = [];
        let cashIn = 0;
        let ganancia = 0;
        let fees = 0;
        let costoVendido = 0;
        let totalVendidas = 0;

        (ctx.rows || []).forEach(({ lote, calc }) => {
            if (!lote) return;
            const settings = settingsForTaggedLote(lote);
            const ventasAll = Array.isArray(lote.ventas) ? lote.ventas : [];

            if (ventasAll.length) {
                const ventas = ventasAll.filter(v => saleInPyGRange(v.fecha, resolved));
                if (!ventas.length) return;
                const loteSlice = { ...lote, ventas };
                const sum = sumFeesAndCogs(loteSlice, settings);
                let cash = 0;
                let util = 0;
                let uds = 0;
                ventas.forEach(v => {
                    const u = Math.max(0, Number(v.unidades) || 0);
                    const p = Number(v.precio) || 0;
                    cash += p * u;
                    uds += u;
                    util += Calc.utilidadAtPrice(loteAtSaleCost(loteSlice, v), p, settings).utilidad * u;
                });
                fees += sum.fees;
                costoVendido += sum.costoVendido;
                cashIn += cash;
                ganancia += util;
                totalVendidas += uds;
                slicedRows.push({
                    lote: loteSlice,
                    calc: {
                        ...calc,
                        cashIn: cash,
                        gananciaRealizada: util,
                        vendidas: uds,
                        gastoAds: 0,
                    },
                });
                return;
            }

            const vendidas = Math.max(0, Number(lote.vendidas) || 0);
            if (!vendidas) return;
            if (!saleInPyGRange(lote.fecha, resolved)) return;
            const c = Calc.computeLote(lote, settings);
            const sum = sumFeesAndCogs(lote, settings);
            fees += sum.fees;
            costoVendido += sum.costoVendido;
            cashIn += c.cashIn;
            ganancia += c.gananciaRealizada;
            totalVendidas += vendidas;
            slicedRows.push({
                lote,
                calc: { ...c, gastoAds: 0 },
            });
        });

        return {
            ...ctx,
            rows: slicedRows,
            fees,
            costoVendido,
            gastoAds: 0,
            bonificaciones: bonif.total,
            bonificacionesN: bonif.n,
            agg: {
                ...(ctx.agg || {}),
                cashIn,
                gananciaRealizada: ganancia,
                totalVendidas,
                margenPonderado: cashIn > 0 ? ganancia / cashIn : 0,
            },
            pygPeriod: resolved,
        };
    }

    function layPyGPeriodChips(period) {
        const mode = period?.mode || readPyGPeriodMode();
        const items = [
            { id: 'month', label: 'Mes actual' },
            { id: 'prev', label: 'Mes anterior' },
            { id: 'all', label: 'Todo' },
        ];
        return `
            <div class="dash-seg dash-pyg-period" role="group" aria-label="Corte del P&G">
                ${items.map(it => `
                    <button type="button"
                        class="dash-seg-btn${mode === it.id ? ' active' : ''}"
                        data-dash-pyg-period="${it.id}">${esc(it.label)}</button>
                `).join('')}
            </div>
        `;
    }

    function sumUtilSides(aggRows) {
        let ganancias = 0;
        let perdidas = 0;
        let nGain = 0;
        let nLoss = 0;
        collectVentaPnLRows(aggRows).forEach(r => {
            if (r.util > 0.005) {
                ganancias += r.util;
                nGain += 1;
            } else if (r.util < -0.005) {
                perdidas += Math.abs(r.util);
                nLoss += 1;
            }
        });
        return { ganancias, perdidas, nGain, nLoss };
    }

    function layPyG({ agg, fees, costoVendido, gastoAds, isAmazon, isGeneral, rows, pygPeriod, bonificaciones = 0, bonificacionesN = 0 }) {
        const bruto = agg.cashIn - costoVendido;
        const neto = agg.gananciaRealizada;
        const bonif = Number(bonificaciones) || 0;
        const resultado = neto + bonif;
        const feeLabel = isGeneral
            ? '− Fees Meli + Amazon (est.)'
            : (isAmazon
                ? '− Fees Amazon (est.)'
                : '− Fees ML + retenciones (est.)');

        const { ganancias, perdidas, nGain, nLoss } = sumUtilSides(rows);

        const ventaNeta = round2(Math.max(0, (Number(agg.cashIn) || 0) - (Number(fees) || 0)));
        const lines = [
            { label: 'Venta bruta (ingresos)', value: agg.cashIn },
            { label: feeLabel, value: -fees },
            { label: '= Venta neta', value: ventaNeta, bold: true },
            { label: '− Costo de lo vendido', value: -costoVendido },
            { label: '= Utilidad bruta est.', value: bruto },
            { label: '= Ganancia realizada', value: neto, bold: true },
        ];
        if (ganancias > 0.009 || perdidas > 0.009) {
            lines.push({
                label: `···· Ganancias${nGain ? ` (${nGain})` : ''}`,
                value: ganancias,
                sub: true,
            });
            lines.push({
                label: `···· Pérdidas${nLoss ? ` (${nLoss})` : ''}`,
                value: -perdidas,
                sub: true,
            });
        }
        lines.push({
            label: `+ Bonificaciones${bonificacionesN ? ` (${bonificacionesN})` : ''}`,
            value: bonif,
        });
        lines.push({
            label: '= Resultado neto',
            value: resultado,
            bold: true,
        });
        if ((gastoAds || 0) > 0.009) {
            lines.push({ label: 'Gasto Ads (referencia, no restado arriba)', value: -gastoAds });
        }

        return `
            <div class="dash-split-2">
                <div class="dash-panel">
                    <h3>Estado de resultados (estimado)</h3>
                    <table class="dash-table">
                        <tbody>
                            ${lines.map(l => `
                                <tr class="${l.bold ? 'is-bold' : ''} ${l.sub ? 'is-sub' : ''} ${tone(l.value)}">
                                    <td>${esc(l.label)}</td>
                                    <td class="num">${Calc.fmtMXN(l.value)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <p class="muted small" style="margin-top:12px">
                        Corte: <strong>${esc(pygPeriod?.label || resolvePyGPeriod().label)}</strong>.
                        Fees y costo al precio real de cada venta. Ganancia realizada = ganancias − pérdidas.
                        ${perdidas > 0.009
                            ? `Hay <span class="neg">${Calc.fmtMXN(perdidas)}</span> en ventas a pérdida.`
                            : ''}
                        ${(gastoAds || 0) > 0 ? 'Ads del lote aparte.' : ''}
                    </p>
                </div>
                <div class="dash-panel">
                    <h3>Composición del cash in</h3>
                    ${(() => {
                        const feePart = Math.max(0, fees);
                        const parts = neto >= 0
                            ? [
                                { label: 'Costo vendido', value: costoVendido, cls: 'c-cost' },
                                { label: 'Fees est.', value: feePart, cls: 'c-fee' },
                                { label: 'Ganancia', value: Math.max(0, neto), cls: 'c-gain' },
                            ]
                            : [
                                { label: 'Costo vendido', value: costoVendido, cls: 'c-cost' },
                                { label: 'Fees est.', value: feePart, cls: 'c-fee' },
                            ];
                        const total = neto >= 0
                            ? Math.max(agg.cashIn, 1)
                            : Math.max(costoVendido + feePart, 1);
                        return stackBars(parts, total);
                    })()}
                    ${perdidas > 0.009
                        ? `<p class="muted small" style="margin-top:8px">Pérdidas en ventas: <span class="neg">${Calc.fmtMXN(perdidas)}</span>${nLoss ? ` · ${nLoss} pedido${nLoss === 1 ? '' : 's'}` : ''} (ya restadas en la ganancia realizada).</p>`
                        : ''}
                    ${neto < -0.009
                        ? `<p class="muted small" style="margin-top:8px">Resultado neto <span class="neg">${Calc.fmtMXN(neto)}</span> (fees + costo &gt; ingresos).</p>`
                        : ''}
                    ${(gastoAds || 0) > 0 ? `
                    <p class="muted small" style="margin-top:10px">
                        Ads del lote (referencia, fuera del cash in): ${Calc.fmtMXN(gastoAds)}
                    </p>` : ''}
                    <div class="dash-mini-kpis">
                        ${mini(pygPeriod?.mode === 'all' ? 'Margen lista' : 'Margen periodo', Calc.fmtPct(agg.margenPonderado))}
                        ${mini('Uds vendidas', String(agg.totalVendidas))}
                        ${mini('Fees / cash', agg.cashIn ? Calc.fmtPct(fees / agg.cashIn) : '—')}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * P&G compacto: Ingresos (bruta + neta) → Utilidad → Bonificaciones → Resultado.
     * Venta neta = bruta − fees (mismo criterio que Caja / hero KPIs).
     */
    function layPyGCompact(ctx) {
        const { agg, fees, costoVendido, gastoAds, pygPeriod, bonificaciones = 0 } = ctx;
        const cashIn = agg.cashIn || 0;
        const feesAmt = Number(fees) || 0;
        const ventaNeta = round2(Math.max(0, cashIn - feesAmt));
        const neto = agg.gananciaRealizada || 0;
        const bonif = Number(bonificaciones) || 0;
        const resultado = neto + bonif;
        const bruto = cashIn - costoVendido;
        const marginPct = cashIn > 0 ? (neto / cashIn) : 0;
        const periodLabel = pygPeriod?.label || resolvePyGPeriod().label;
        const { ganancias, perdidas } = sumUtilSides(ctx.rows);

        const fx = (n) => UI.fxAttrs?.(n, 'mxn') || '';
        return `
            <div class="dash-pyg-sheet" aria-label="Estado de resultados del periodo · ${esc(periodLabel)} · ${agg.totalVendidas || 0} uds">
                <ol class="dash-pyg-steps">
                    <li class="dash-pyg-step is-ingresos" style="--i:1">
                        <div class="dash-pyg-step-main">
                            <span class="dash-pyg-step-n" aria-hidden="true">1</span>
                            <div class="dash-pyg-step-body">
                                <span class="dash-pyg-label">Ingresos</span>
                                <span class="dash-pyg-hint">Bruta y neta del periodo</span>
                            </div>
                            <span class="dash-pyg-amount"${fx(ventaNeta)}>${Calc.fmtMXN(ventaNeta)}</span>
                        </div>
                        <div class="dash-pyg-pair" aria-label="Venta bruta y venta neta">
                            <div class="dash-pyg-chip is-bruta" title="Precio × unidades">
                                <div class="dash-pyg-chip-top">
                                    <span class="dash-pyg-chip-k">Venta bruta</span>
                                    <span class="dash-pyg-chip-h">Lo que pagó el cliente</span>
                                </div>
                                <span class="dash-pyg-chip-v"${fx(cashIn)}>${Calc.fmtMXN(cashIn)}</span>
                            </div>
                            <span class="dash-pyg-chip-op" aria-hidden="true">→</span>
                            <div class="dash-pyg-chip is-neta" title="Venta bruta menos fees · lo que entra a Caja">
                                <div class="dash-pyg-chip-top">
                                    <span class="dash-pyg-chip-k">Venta neta</span>
                                    <span class="dash-pyg-chip-h">Bruta − fees</span>
                                </div>
                                <span class="dash-pyg-chip-v"${fx(ventaNeta)}>${Calc.fmtMXN(ventaNeta)}</span>
                            </div>
                        </div>
                    </li>
                    <li class="dash-pyg-step is-util" style="--i:2">
                        <div class="dash-pyg-step-main">
                            <span class="dash-pyg-step-n" aria-hidden="true">2</span>
                            <div class="dash-pyg-step-body">
                                <span class="dash-pyg-label">Utilidad</span>
                                <span class="dash-pyg-hint">${Calc.fmtPct(marginPct)} de margen</span>
                            </div>
                            <span class="dash-pyg-amount ${tone(neto)}"${fx(neto)}>${Calc.fmtMXN(neto)}</span>
                        </div>
                        <div class="dash-pyg-pair" aria-label="Ganancias menos pérdidas">
                            <button type="button" class="dash-pyg-chip is-gain" data-dash-pyg-filter="gain" title="Ver ventas en verde">
                                <div class="dash-pyg-chip-top">
                                    <span class="dash-pyg-chip-k">Ganancias</span>
                                    <span class="dash-pyg-chip-h">Toca para ver el detalle</span>
                                </div>
                                <span class="dash-pyg-chip-v pos"${fx(ganancias)}>${Calc.fmtMXN(ganancias)}</span>
                            </button>
                            <span class="dash-pyg-chip-op" aria-hidden="true">−</span>
                            <button type="button" class="dash-pyg-chip is-loss" data-dash-pyg-filter="loss" title="Ver ventas en rojo">
                                <div class="dash-pyg-chip-top">
                                    <span class="dash-pyg-chip-k">Pérdidas</span>
                                    <span class="dash-pyg-chip-h">Toca para ver el detalle</span>
                                </div>
                                <span class="dash-pyg-chip-v neg"${fx(perdidas ? -perdidas : 0)}>${Calc.fmtMXN(perdidas ? -perdidas : 0)}</span>
                            </button>
                        </div>
                    </li>
                    <li class="dash-pyg-step is-bonif" style="--i:3">
                        <span class="dash-pyg-step-n" aria-hidden="true">3</span>
                        <div class="dash-pyg-step-body">
                            <span class="dash-pyg-label">Bonificaciones</span>
                            <span class="dash-pyg-hint">${Math.abs(bonif) > 0.009 ? 'Se suman al resultado' : 'Edita arriba en Bonificaciones'}</span>
                        </div>
                        <span class="dash-pyg-amount ${bonif > 0.009 ? 'pos' : ''}"${fx(bonif)}>${bonif > 0.009 ? '+' : ''}${Calc.fmtMXN(bonif)}</span>
                    </li>
                </ol>

                <div class="dash-pyg-hero">
                    <span class="dash-pyg-kicker">Resultado</span>
                    <span class="dash-pyg-hero-value ${tone(resultado)}"${fx(resultado)}>${Calc.fmtMXN(resultado)}</span>
                    <span class="dash-pyg-hero-hint">Utilidad + bonificaciones</span>
                    <span class="dash-pyg-hero-meta">${esc(periodLabel)} · ${agg.totalVendidas || 0} uds</span>
                </div>

                <details class="dash-pyg-details" data-dash-pyg-details>
                    <summary>Ver desglose</summary>
                    <div class="dash-pyg-details-body">
                        ${layPyG(ctx)}
                        ${(gastoAds || 0) > 0 ? `<p class="muted small" style="margin-top:8px">Ads (referencia, no restado arriba): ${Calc.fmtMXN(gastoAds)}</p>` : ''}
                        <p class="muted small" style="margin:6px 0 0">Utilidad bruta est.: ${Calc.fmtMXN(bruto)} · Fees: ${Calc.fmtMXN(fees)}.</p>
                        <div class="dash-venta-detalle-embed">
                            <div class="dash-pyg-venta-head">
                                <h3 class="dash-venta-detalle-h" data-dash-pyg-venta-title>Detalle por venta</h3>
                                <div class="dash-pyg-venta-filters" role="group" aria-label="Filtrar por utilidad">
                                    <button type="button" class="dash-pyg-filter-btn active" data-dash-pyg-filter="all">Todas</button>
                                    <button type="button" class="dash-pyg-filter-btn" data-dash-pyg-filter="gain">Ganancias</button>
                                    <button type="button" class="dash-pyg-filter-btn" data-dash-pyg-filter="loss">Pérdidas</button>
                                </div>
                            </div>
                            ${layVentaDetalle(ctx, { variant: 'compact' })}
                            <p class="muted small dash-pyg-venta-empty" data-dash-pyg-venta-empty hidden>Sin ventas en esta categoría.</p>
                            <p class="muted small dash-venta-detalle-jump">
                                Completo en
                                <button type="button" class="dash-link-inline" data-gx-jump="gx-finanzas">Finanzas (General)</button>.
                            </p>
                        </div>
                    </div>
                </details>
            </div>
        `;
    }

    /**
     * Filas P&L por evento de venta (mismo motor que P&G).
     * Orden: utilidad asc (pérdidas primero).
     */
    function collectVentaPnLRows(aggRows) {
        const out = [];
        (aggRows || []).forEach(({ lote }) => {
            if (!lote) return;
            const settings = settingsForTaggedLote(lote);
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            const mp = lote._mp || '';
            const producto = lote.producto || lote.nombre || '';
            const asin = lote.asin || lote.sku || '';

            if (ventas.length) {
                ventas.forEach((v, idx) => {
                    const uds = Math.max(0, Number(v.unidades) || 0);
                    if (!uds) return;
                    const precio = Number(v.precio) || 0;
                    const loteAt = loteAtSaleCost(lote, v);
                    const u = Calc.utilidadAtPrice(loteAt, precio, settings);
                    const ref = (Number(u.comisionVariable) || 0) * uds;
                    const fba = (Number(u.envio) || 0) * uds;
                    const alm = (Number(u.almacenamiento) || 0) * uds;
                    const varios = (Number(u.varios) || 0) * uds;
                    const cargo = (Number(u.cargoFijo) || 0) * uds;
                    const ret = ((Number(u.retIVA) || 0) + (Number(u.retISR) || 0)) * uds;
                    const fees = ref + fba + alm + varios + cargo + ret;
                    const cost = (Number(loteAt.costo) || 0) * uds;
                    const cash = precio * uds;
                    const util = (Number(u.utilidad) || 0) * uds;
                    out.push({
                        loteId: lote.id,
                        mp,
                        asin,
                        producto,
                        fecha: v.fecha || '',
                        uds,
                        cash,
                        cost,
                        fees,
                        ref,
                        fba,
                        alm,
                        util,
                        margen: cash > 0 ? util / cash : 0,
                        legacy: false,
                        ventaIdx: idx,
                    });
                });
                return;
            }

            const vendidas = Math.max(0, Number(lote.vendidas) || 0);
            if (!vendidas) return;
            const calc = Calc.computeLote(lote, settings);
            const cash = Number(calc.cashIn) || 0;
            const util = Number(calc.gananciaRealizada) || 0;
            const cost = (Number(lote.costo) || 0) * vendidas;
            const fees = Math.max(0, cash - cost - util);
            out.push({
                loteId: lote.id,
                mp,
                asin,
                producto,
                fecha: lote.fecha || '',
                uds: vendidas,
                cash,
                cost,
                fees,
                ref: Number(calc.comisionVariable) || 0,
                fba: Number(calc.envio) || 0,
                alm: Number(calc.almacenamiento) || 0,
                util,
                margen: cash > 0 ? util / cash : 0,
                legacy: true,
                ventaIdx: -1,
            });
        });

        out.sort((a, b) => {
            if (a.util !== b.util) return a.util - b.util;
            return String(a.fecha || '').localeCompare(String(b.fecha || ''));
        });
        return out;
    }

    function fmtVentaFecha(raw) {
        if (!raw) return '—';
        const d = parseSaleDate(raw);
        if (!d) return esc(String(raw).slice(0, 10));
        return esc(fmtDMY(d));
    }

    function feesTitle(row) {
        const parts = [];
        if (row.ref) parts.push(`Ref ${Calc.fmtMXN(row.ref)}`);
        if (row.fba) parts.push(`FBA/envío ${Calc.fmtMXN(row.fba)}`);
        if (row.alm) parts.push(`Alm ${Calc.fmtMXN(row.alm)}`);
        return parts.join(' · ') || 'Fees';
    }

    /**
     * Detalle por venta — mayor del P&G.
     * variant: 'full' (Finanzas) | 'compact' (desglose Inicio).
     */
    function layVentaDetalle(ctx, opts = {}) {
        const variant = opts.variant === 'compact' ? 'compact' : 'full';
        const periodLabel = ctx?.pygPeriod?.label || '';
        const rows = collectVentaPnLRows(ctx?.rows);
        if (!rows.length) {
            return `
                <div class="dash-panel dash-venta-detalle dash-venta-detalle--${variant}">
                    <p class="muted small" style="margin:0">${periodLabel
                        ? `Sin ventas en <strong>${esc(periodLabel)}</strong>.`
                        : 'Sin ventas registradas todavía. Registra una venta en un lote para ver el desglose.'}</p>
                </div>`;
        }

        const tot = rows.reduce((a, r) => {
            a.uds += r.uds;
            a.cash += r.cash;
            a.cost += r.cost;
            a.fees += r.fees;
            a.util += r.util;
            return a;
        }, { uds: 0, cash: 0, cost: 0, fees: 0, util: 0 });
        const totMargen = tot.cash > 0 ? tot.util / tot.cash : 0;
        const nPedidos = rows.length;

        const utilSide = (u) => (u > 0.005 ? 'gain' : (u < -0.005 ? 'loss' : 'flat'));
        const tableRows = rows.map(r => `
            <tr class="is-click" data-dash-lote="${esc(r.loteId)}" data-dash-mp="${esc(r.mp)}" data-util-side="${utilSide(r.util)}" title="Abrir producto">
                <td class="dash-venta-fecha">${fmtVentaFecha(r.fecha)}${r.legacy ? ' <span class="muted" title="Sin eventos de venta">·</span>' : ''}</td>
                <td class="dash-venta-prod">
                    <span class="dash-venta-name">${esc(short(r.producto, variant === 'compact' ? 36 : 48))}</span>
                    ${r.asin ? `<span class="dash-venta-asin muted mono">${esc(r.asin)}</span>` : ''}
                </td>
                <td class="num">${r.uds}</td>
                <td class="num">${Calc.fmtMXN(r.cash)}</td>
                <td class="num">${Calc.fmtMXN(r.cost)}</td>
                <td class="num" title="${esc(feesTitle(r))}">${Calc.fmtMXN(r.fees)}</td>
                <td class="num ${tone(r.util)}">${Calc.fmtMXN(r.util)}</td>
                <td class="num ${tone(r.util)}">${Calc.fmtPct(r.margen)}</td>
            </tr>
        `).join('');

        const cards = rows.map(r => `
            <button type="button" class="dash-venta-card" data-dash-lote="${esc(r.loteId)}" data-dash-mp="${esc(r.mp)}" data-util-side="${utilSide(r.util)}">
                <div class="dash-venta-card-top">
                    <span class="dash-venta-card-name">${esc(short(r.producto, 40))}</span>
                    <span class="dash-venta-card-util mono ${tone(r.util)}">${Calc.fmtMXN(r.util)}</span>
                </div>
                <div class="dash-venta-card-meta muted small">
                    ${fmtVentaFecha(r.fecha)} · ${r.uds} ud · ${Calc.fmtMXN(r.cash)}
                    ${r.asin ? ` · <span class="mono">${esc(r.asin)}</span>` : ''}
                </div>
                <div class="dash-venta-card-grid muted small">
                    <span>Costo ${Calc.fmtMXN(r.cost)}</span>
                    <span title="${esc(feesTitle(r))}">Fees ${Calc.fmtMXN(r.fees)}</span>
                    <span class="${tone(r.util)}">${Calc.fmtPct(r.margen)}</span>
                </div>
            </button>
        `).join('');

        return `
            <div class="dash-panel dash-venta-detalle dash-venta-detalle--${variant}">
                ${variant === 'full'
                    ? `<p class="muted small dash-venta-detalle-lead">${periodLabel ? `<strong>${esc(periodLabel)}</strong> · ` : ''}Misma lógica que el P&amp;G: precio − costo − fees por cada venta. Ordenado por utilidad (pérdidas primero). Ads no restados.</p>`
                    : ''}
                <div class="dash-venta-table-wrap">
                    <table class="dash-table dash-venta-table">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Producto</th>
                                <th class="num">Uds</th>
                                <th class="num">Venta</th>
                                <th class="num">Costo</th>
                                <th class="num">Fees</th>
                                <th class="num">Util</th>
                                <th class="num">Margen</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                        <tfoot>
                            <tr class="is-bold" data-util-totals>
                                <td colspan="2">Total · ${nPedidos} pedido${nPedidos === 1 ? '' : 's'} · ${tot.uds} uds</td>
                                <td class="num">${tot.uds}</td>
                                <td class="num">${Calc.fmtMXN(tot.cash)}</td>
                                <td class="num">${Calc.fmtMXN(tot.cost)}</td>
                                <td class="num">${Calc.fmtMXN(tot.fees)}</td>
                                <td class="num ${tone(tot.util)}">${Calc.fmtMXN(tot.util)}</td>
                                <td class="num ${tone(tot.util)}">${Calc.fmtPct(totMargen)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <div class="dash-venta-cards" aria-label="Detalle por venta">
                    ${cards}
                    <div class="dash-venta-card dash-venta-card-total" data-util-totals>
                        <div class="dash-venta-card-top">
                            <span class="dash-venta-card-name">Total · ${nPedidos} pedido${nPedidos === 1 ? '' : 's'}</span>
                            <span class="dash-venta-card-util mono ${tone(tot.util)}">${Calc.fmtMXN(tot.util)}</span>
                        </div>
                        <div class="dash-venta-card-meta muted small">${tot.uds} uds · Venta ${Calc.fmtMXN(tot.cash)}</div>
                        <div class="dash-venta-card-grid muted small">
                            <span>Costo ${Calc.fmtMXN(tot.cost)}</span>
                            <span>Fees ${Calc.fmtMXN(tot.fees)}</span>
                            <span class="${tone(tot.util)}">${Calc.fmtPct(totMargen)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /** Cash de ventas marcadas Cobrado en Caja (monto en bolsitas, no bruto). */
    function sumCashCobrado(rows) {
        let cash = 0;
        (rows || []).forEach(({ lote }) => {
            const settings = settingsForTaggedLote(lote);
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            if (ventas.length) {
                ventas.forEach(v => {
                    if (!ventaIsCobrado(v)) return;
                    cash += typeof Data.ventaLiberacionAmount === 'function'
                        ? (Number(Data.ventaLiberacionAmount(lote, v, settings)) || 0)
                        : (Number(v.precio) || 0) * Math.max(0, Number(v.unidades) || 0);
                });
                return;
            }
            // Legacy: vendidas sin eventos → se trata como ya cobrado
            const vendidas = Math.max(0, Number(lote.vendidas) || 0);
            if (vendidas > 0) {
                const calc = Calc.computeLote(lote, settings);
                cash += Math.max(0, ((Number(lote.costo) || 0) + (Number(calc.utilidad) || 0)) * vendidas);
            }
        });
        return round2(cash);
    }

    function layCaja({ agg, rows }) {
        const trapped = rows
            .filter(r => r.calc.inventarioRestante > 0)
            .reduce((s, r) => s + r.calc.valorInventario, 0);
        const liberable = rows
            .filter(r => r.calc.estrategia === 'LIQUIDAR')
            .reduce((s, r) => s + r.calc.valorInventario, 0);
        const cashCobrado = sumCashCobrado(rows);
        const porCobrar = Math.max(0, round2((agg.cashIn || 0) - cashCobrado));
        return `
            <div class="dash-grid-kpi dash-grid-kpi-4">
                ${kpi('Capital en juego', Calc.fmtMXN(agg.capitalDesplegado), '', 'Costo × unidades compradas')}
                ${kpi('Cash vendido', Calc.fmtMXN(agg.cashIn), 'pos', 'Todas las ventas registradas')}
                ${kpi('Cash cobrado', Calc.fmtMXN(cashCobrado), 'pos', porCobrar > 0 ? `Por cobrar ${Calc.fmtMXN(porCobrar)}` : 'Todo marcado en Caja')}
                ${kpi('En inventario', Calc.fmtMXN(agg.valorInventario), '', `${Calc.fmtPct(agg.capitalDesplegado ? agg.valorInventario / agg.capitalDesplegado : 0)} del capital`)}
            </div>
            <div class="dash-split-2">
                <div class="dash-panel">
                    <h3>Flujo: dónde está el dinero</h3>
                    ${stackBars([
                        { label: 'Cobrado', value: cashCobrado, cls: 'c-gain' },
                        { label: 'Por cobrar', value: porCobrar, cls: 'c-ads' },
                        { label: 'Atrapado en stock', value: trapped, cls: 'c-cost' },
                    ], Math.max((agg.cashIn || 0) + trapped, 1))}
                    ${liberable > 0 ? `<p class="muted small" style="margin-top:10px">Stock en LIQUIDAR: ${Calc.fmtMXN(liberable)}</p>` : ''}
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

    // Motor de bolsitas → js/alloc.js (shim compat para callers legacy)
    const ALLOC_BUCKETS = Alloc.ALLOC_BUCKETS;
    const round2 = Alloc.round2;
    const allocMpKey = Alloc.allocMpKey;
    const emptyAllocBuckets = Alloc.emptyAllocBuckets;
    const defaultAllocPercents = Alloc.defaultAllocPercents;
    const migrateLegacyAllocMaps = Alloc.migrateLegacyAllocMaps;
    const migrateLedgerEntry = Alloc.migrateLedgerEntry;
    const normalizePercents = Alloc.normalizePercents;
    const previewPercentsForKey = Alloc.previewPercentsForKey;
    const setBucketPercent = Alloc.setBucketPercent;
    const splitByPercents = Alloc.splitByPercents;
    const addSplits = Alloc.addSplits;
    const readAllocState = Alloc.readAllocState;
    const writeAllocState = Alloc.writeAllocState;
    const persistAllocMigrations = Alloc.persistAllocMigrations;
    const applySaleLiberationWithSplits = Alloc.applySaleLiberationWithSplits;
    const reverseSaleLiberation = Alloc.reverseSaleLiberation;
    const purgeOrphanSaleLiberations = Alloc.purgeOrphanSaleLiberations;
    const reconcileAllocFromLedger = Alloc.reconcileAllocFromLedger;
    const spendFromBucket = Alloc.spendFromBucket;
    const reverseSpend = Alloc.reverseSpend;
    const listUnassignedVentas = Alloc.listUnassignedVentas;
    const readRawAlloc = Alloc.readRawAlloc;

    function newBonifId() {
        return `bf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    function normalizeBonifEntry(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const monto = Number(raw.monto);
        if (!Number.isFinite(monto) || Math.abs(monto) < 0.005) return null;
        const fecha = String(raw.fecha || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
        return {
            id: String(raw.id || newBonifId()),
            fecha,
            monto: round2(monto),
            notas: String(raw.notas || '').slice(0, 160),
        };
    }

    function readBonifStore() {
        const raw = window.State.ui?.bonificaciones;
        const clean = (list) => (Array.isArray(list) ? list : [])
            .map(normalizeBonifEntry)
            .filter(Boolean)
            .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        if (!raw || typeof raw !== 'object') return { amazon: [], meli: [] };
        return { amazon: clean(raw.amazon), meli: clean(raw.meli) };
    }

    function writeBonifStore(store) {
        window.State.ui = {
            ...window.State.ui,
            bonificaciones: {
                amazon: Array.isArray(store?.amazon) ? store.amazon : [],
                meli: Array.isArray(store?.meli) ? store.meli : [],
            },
        };
        window.State.saveUI();
    }

    function bonifMarketsForView() {
        if (window.State.ui?.mpView === 'general') return ['meli', 'amazon'];
        return [window.State.marketplace === 'amazon' ? 'amazon' : 'meli'];
    }

    function listBonificaciones(markets = bonifMarketsForView()) {
        const store = readBonifStore();
        const out = [];
        (markets || []).forEach(mp => {
            (store[mp] || []).forEach(b => out.push({ ...b, _mp: mp }));
        });
        out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        return out;
    }

    function sumBonificacionesInRange(markets, range) {
        let total = 0;
        let n = 0;
        listBonificaciones(markets).forEach(b => {
            if (range?.start) {
                const d = Calc.effectiveSaleDay(b.fecha);
                if (!d) return;
                if (d < range.start) return;
                if (range.end && d > range.end) return;
            }
            total += Number(b.monto) || 0;
            n += 1;
        });
        return { total: round2(total), n };
    }

    function bonifHeroStats(periodOrDays = 30) {
        const now = new Date();
        const range = typeof periodOrDays === 'object' && periodOrDays?.curStart
            ? periodOrDays
            : resolveSumRange(
                periodOrDays === 7 ? '7d' : periodOrDays === 365 ? 'year' : '30d',
                now,
            );
        const { curStart, curEnd, prevStart, prevEnd } = range;
        let cur = 0;
        let prev = 0;
        let nCur = 0;
        listBonificaciones(bonifMarketsForView()).forEach(b => {
            const d = Calc.effectiveSaleDay(b.fecha, now);
            if (!d) return;
            const m = Number(b.monto) || 0;
            if (inDayRange(d, curStart, curEnd)) {
                cur += m;
                nCur += 1;
            } else if (inDayRange(d, prevStart, prevEnd)) {
                prev += m;
            }
        });
        return { cur: round2(cur), prev: round2(prev), nCur };
    }

    async function openBonificacionesDialog() {
        if (!UI?.dialog) return;
        const mp = window.State.marketplace === 'amazon' ? 'amazon' : 'meli';
        const mpLabel = Data.mpBrand(mp);
        const todayIso = toISODate(new Date());

        const paintList = (wrap) => {
            const list = listBonificaciones([mp]);
            const host = wrap.querySelector('[data-bonif-list]');
            if (!host) return;
            if (!list.length) {
                host.innerHTML = '<p class="muted small" style="margin:0">Sin bonificaciones. Ej.: créditos Amazon, reembolsos de fees, cupones.</p>';
                return;
            }
            host.innerHTML = `
                <ul class="dash-bonif-list">
                    ${list.map(b => `
                        <li>
                            <div class="dash-bonif-meta">
                                <strong class="mono ${tone(b.monto)}">${Calc.fmtMXN(b.monto)}</strong>
                                <span class="muted small">${esc(fmtDMY(Calc.parseSaleDate(b.fecha) || new Date()))}</span>
                                ${b.notas ? `<span class="muted small">${esc(b.notas)}</span>` : ''}
                            </div>
                            <button type="button" class="btn btn-sm" data-bonif-del="${esc(b.id)}">Quitar</button>
                        </li>
                    `).join('')}
                </ul>`;
            host.querySelectorAll('[data-bonif-del]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.bonifDel;
                    const ok = await UI.confirm?.({
                        title: 'Quitar bonificación',
                        message: '¿Eliminar este monto del historial?',
                        primaryLabel: 'Quitar',
                        danger: true,
                    });
                    if (!ok) return;
                    const store = readBonifStore();
                    store[mp] = (store[mp] || []).filter(x => x.id !== id);
                    writeBonifStore(store);
                    paintList(wrap);
                    render();
                });
            });
        };

        const body = document.createElement('div');
        body.className = 'dash-bonif-dlg';
        body.innerHTML = `
            <p class="muted small" style="margin:0 0 12px">Bonificaciones de <strong>${esc(mpLabel)}</strong>: créditos o ajustes a favor. Entran al P&amp;G del periodo (no son ventas).</p>
            <div class="dash-bonif-form">
                <label><span>Fecha</span><input type="date" data-bonif-fecha value="${esc(todayIso)}" max="${esc(todayIso)}"></label>
                <label><span>Monto (MXN)</span><input type="number" data-bonif-monto min="0.01" step="0.01" placeholder="0.00"></label>
                <label class="wide"><span>Nota (opcional)</span><input type="text" data-bonif-notas maxlength="160" placeholder="Ej. crédito FBA, reembolso ads"></label>
            </div>
            <div data-bonif-list style="margin-top:14px"></div>
        `;

        await UI.dialog({
            title: 'Bonificaciones',
            size: 'md',
            body,
            actions: [
                { label: 'Cerrar', value: null },
                {
                    label: 'Agregar',
                    variant: 'primary',
                    value: 'add',
                    onClick: (wrap) => {
                        const fecha = wrap.querySelector('[data-bonif-fecha]')?.value;
                        const monto = Number(wrap.querySelector('[data-bonif-monto]')?.value);
                        const notas = wrap.querySelector('[data-bonif-notas]')?.value || '';
                        const entry = normalizeBonifEntry({ id: newBonifId(), fecha, monto, notas });
                        if (!entry) {
                            UI.toast?.('Fecha y monto válidos requeridos', 'warn');
                            return false;
                        }
                        const store = readBonifStore();
                        store[mp] = [entry, ...(store[mp] || [])];
                        writeBonifStore(store);
                        const montoEl = wrap.querySelector('[data-bonif-monto]');
                        const notasEl = wrap.querySelector('[data-bonif-notas]');
                        if (montoEl) montoEl.value = '';
                        if (notasEl) notasEl.value = '';
                        paintList(wrap);
                        render();
                        UI.toast?.(`Bonificación ${Calc.fmtMXN(entry.monto)} agregada`, 'success');
                        return false;
                    },
                },
            ],
            onMount: (wrap) => paintList(wrap),
        });
    }
    const writeRawAlloc = Alloc.writeRawAlloc;

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
            if (next) {
                // Evita que scroll-behavior:smooth anime desde 0 al restaurar
                const prev = next.style.scrollBehavior;
                next.style.scrollBehavior = 'auto';
                next.scrollTop = y;
                next.style.scrollBehavior = prev;
            } else {
                window.scrollTo({ top: y, left: 0, behavior: 'auto' });
            }
            if (anchorSel) {
                document.querySelector(anchorSel)
                    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        };
        requestAnimationFrame(() => {
            restore();
            requestAnimationFrame(restore);
        });
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
        const shareOf = (val) => totalBuckets > 0 ? Math.round((val / totalBuckets) * 1000) / 10 : 0;

        const bolsitasCards = ALLOC_BUCKETS.map((b, i) => {
            const val = buckets[b.key] || 0;
            const share = shareOf(val);
            const extra = b.key === 'reinversion' && unitCost > 0 && val > 0
                ? `≈ ${reinvestUds.toFixed(1)} uds al costo avg`
                : esc(b.hint);
            return `
                <div class="dash-bolsa alloc-${b.key}" data-bolsa="${b.key}" style="--bolsa-i:${i}">
                    <div class="dash-bolsa-top">
                        <div class="dash-bolsa-name">${esc(b.label)}</div>
                        <button type="button" class="dash-bolsa-use-btn" data-bolsa-use="${b.key}"
                            title="Registrar uso" aria-label="Usar dinero de ${esc(b.label)}">Usar</button>
                    </div>
                    <div class="dash-bolsa-amt" data-bolsa-amt>${Calc.fmtMXN(val)}</div>
                    <button type="button" class="dash-bolsa-share" data-bolsa-edit="${b.key}"
                        title="Ajustar %" aria-label="Ajustar porcentaje de ${esc(b.label)}">
                        <span data-bolsa-share>${percents[b.key]}% de cada venta · ${share}% del total</span>
                        <span class="dash-bolsa-adjust">Ajustar</span>
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
                    <p class="dash-alloc-lead">
                        El cobro se reparte en Caja. Toca el % para ajustar · <em>Usar</em> para restar lo gastado.
                    </p>
                    <div class="dash-alloc-actions">
                        <button type="button" class="dash-chip-btn" data-alloc-equal-pct>% iguales</button>
                        <button type="button" class="dash-chip-btn" data-alloc-reset-buckets>Vaciar</button>
                    </div>
                </div>

                <div class="dash-bolsa-hero">
                    <div class="dash-bolsa-hero-main">
                        <div class="dash-bolsa-hero-label">Total en bolsitas</div>
                        <div class="dash-bolsa-hero-value">${Calc.fmtMXN(totalBuckets)}</div>
                        <div class="dash-bolsa-hero-sub">
                            <span>Liberado ${Calc.fmtMXN(liberated)}</span>
                            ${injected > 0 ? `<span>Inyectado ${Calc.fmtMXN(injected)}</span>` : ''}
                            <span>Reglas ${pctSum}%</span>
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
                            <strong>${pendingSales.length} cobro${pendingSales.length === 1 ? '' : 's'} sin bolsitas</strong>
                            <p>
                                Marcados cobrado sin repartir.
                                Total ≈ ${Calc.fmtMXN(pendingSales.reduce((s, p) => s + p.amount, 0))}.
                            </p>
                        </div>
                        <button type="button" class="btn primary btn-sm" data-goto-caja="asignar">
                            Ir a Caja
                        </button>
                    </div>
                ` : ''}

                ${layAllocMovimientos(state)}
            </div>
        `;
    }

    /**
     * Movimientos compactos: solo últimos usos en dashboard (colapsado).
     * Los cobros viven en Caja → Historial (no llenan el panel visual).
     */
    function layAllocMovimientos(state) {
        const ledger = Array.isArray(state?.ledger) ? state.ledger : [];
        const spends = ledger
            .filter(e => e && e.type === 'spend')
            .map(e => {
                const at = Number(e.at) || 0;
                const bLabel = ALLOC_BUCKETS.find(b => b.key === e.meta?.bucket)?.label
                    || e.meta?.bucket
                    || 'Bolsita';
                const detail = [
                    bLabel,
                    e.meta?.note ? String(e.meta.note) : '',
                    `quedan ${Calc.fmtMXN(e.meta?.remaining || 0)}`,
                ].filter(Boolean).join(' · ');
                return {
                    id: e.id,
                    at,
                    fecha: new Date(at || Date.now()).toLocaleDateString('es-MX'),
                    amount: Number(e.amount) || 0,
                    detail,
                };
            })
            .sort((a, b) => b.at - a.at);
        const cobrosN = ledger.filter(e => e && e.type === 'sale').length;
        const rows = spends.slice(0, 4);
        if (!rows.length && cobrosN === 0) return '';

        const last = rows[0];
        const summary = last
            ? `Último uso −${Calc.fmtMXN(last.amount)} · ${last.detail}`
            : `${cobrosN} cobro${cobrosN === 1 ? '' : 's'} en bolsitas`;

        return `
            <details class="dash-alloc-movs">
                <summary class="dash-alloc-movs-summary">
                    <span class="dash-alloc-movs-summary-title">Movimientos</span>
                    <span class="dash-alloc-movs-summary-meta muted">${esc(summary)}</span>
                </summary>
                ${rows.length ? `
                    <div class="dash-alloc-movs-head" aria-hidden="true">
                        <span>Fecha</span>
                        <span>Tipo</span>
                        <span>Monto</span>
                        <span>Detalle</span>
                        <span></span>
                    </div>
                    <ul class="dash-alloc-movs-list">
                        ${rows.map(r => `
                            <li class="dash-alloc-movs-row is-uso">
                                <span class="dash-alloc-movs-fecha">${esc(r.fecha)}</span>
                                <span class="dash-alloc-movs-tipo">Uso</span>
                                <strong class="dash-alloc-movs-amt">−${Calc.fmtMXN(r.amount)}</strong>
                                <span class="dash-alloc-movs-detail">${esc(r.detail)}</span>
                                <button type="button" class="dash-alloc-movs-undo" data-alloc-undo-spend="${esc(r.id)}"
                                    title="Deshacer uso">Deshacer</button>
                            </li>
                        `).join('')}
                    </ul>
                ` : `
                    <p class="dash-alloc-movs-empty muted small">Sin usos registrados todavía.</p>
                `}
                <div class="dash-alloc-movs-foot">
                    <span class="muted small">${cobrosN
                        ? `${cobrosN} cobro${cobrosN === 1 ? '' : 's'} → historial en Caja`
                        : 'Los cobros se ven en Caja'}</span>
                    <button type="button" class="btn ghost btn-sm" data-goto-caja="hecho">Ver en Caja</button>
                </div>
            </details>
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
                                        <button type="button" class="dash-link-row" data-dash-lote="${esc(r.lote.id)}" data-dash-mp="${esc(r.lote._mp || '')}">
                                            <span>${esc(short(r.lote.producto, 26))}${r.lote._mp ? ` <small class="dash-mp-mini">${r.lote._mp === 'amazon' ? 'Amz' : 'Meli'}</small>` : ''}</span>
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
            const fam = r.lote.productId
                || String(r.lote.producto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                || r.lote.id;
            const key = `${r.lote._mp || ''}:${fam}`;
            const prev = map.get(key);
            if (!prev || r.calc.utilidad > prev.calc.utilidad) map.set(key, r);
        });
        return [...map.values()];
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
        root.querySelectorAll('[data-goto-caja]').forEach(btn => {
            btn.addEventListener('click', () => {
                const sub = btn.getAttribute('data-goto-caja') || 'cobrar';
                window.CajaView?.open?.(sub);
            });
        });
        root.querySelectorAll('[data-dash-goto-mp]').forEach(btn => {
            btn.addEventListener('click', () => {
                const mp = btn.dataset.dashGotoMp;
                if (!mp || !['meli', 'amazon', 'general'].includes(mp)) return;
                if (window.App?.applyMarketplaceView) window.App.applyMarketplaceView(mp);
                else document.querySelector(`.sb-mp [data-marketplace="${mp}"]`)?.click();
            });
        });
        root.querySelectorAll('[data-dash-goto-envios]').forEach(btn => {
            btn.addEventListener('click', () => {
                window.App?.switchTab?.('envios');
            });
        });
        root.querySelectorAll('[data-dash-open-bonif]').forEach(btn => {
            btn.addEventListener('click', () => { openBonificacionesDialog(); });
        });
        const applyPyGVentaFilter = (side) => {
            const next = side === 'gain' || side === 'loss' ? side : 'all';
            const details = root.querySelector('[data-dash-pyg-details]');
            if (!details) return;
            const sheet = details.closest('.dash-pyg-sheet') || details;
            details.open = true;
            sheet.querySelectorAll('[data-dash-pyg-filter]').forEach(btn => {
                const v = btn.dataset.dashPygFilter || 'all';
                if (btn.classList.contains('dash-pyg-filter-btn')) {
                    btn.classList.toggle('active', v === next);
                }
                if (btn.classList.contains('dash-pyg-chip')) {
                    btn.classList.toggle('is-active', v === next);
                }
            });
            const title = details.querySelector('[data-dash-pyg-venta-title]');
            if (title) {
                title.textContent = next === 'gain'
                    ? 'Detalle · ganancias'
                    : next === 'loss'
                        ? 'Detalle · pérdidas'
                        : 'Detalle por venta';
            }
            let visible = 0;
            details.querySelectorAll('.dash-venta-detalle [data-util-side]').forEach(el => {
                const show = next === 'all' || el.getAttribute('data-util-side') === next;
                el.hidden = !show;
                if (show) visible += 1;
            });
            details.querySelectorAll('.dash-venta-detalle [data-util-totals]').forEach(el => {
                el.hidden = next !== 'all';
            });
            const empty = details.querySelector('[data-dash-pyg-venta-empty]');
            if (empty) empty.hidden = next === 'all' || visible > 0;
            details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
        root.querySelectorAll('[data-dash-pyg-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                applyPyGVentaFilter(btn.dataset.dashPygFilter || 'all');
            });
        });
        root.querySelectorAll('[data-dash-lote]').forEach(el => {
            const open = () => openDashLote(el.dataset.dashLote, el.dataset.dashMp);
            el.addEventListener('click', open);
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open();
                }
            });
        });
        const setChartUI = (patch) => {
            window.State.ui = { ...window.State.ui, ...patch };
            window.State.saveUI();
            // Re-render del canvas entero; conservar scroll (Cobrado/Vendido, rango, etc.)
            renderPreservingScroll();
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
        root.querySelectorAll('[data-dash-sum-period]').forEach(btn => {
            btn.addEventListener('click', () => {
                const period = btn.dataset.dashSumPeriod;
                if (!SUM_PERIODS.includes(period) || period === readSumPeriod()) return;
                window.State.ui = { ...window.State.ui, dashSumPeriod: period };
                window.State.saveUI();
                renderPreservingScroll();
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
        root.querySelectorAll('[data-dash-cash]').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.dashCash === 'vendido' ? 'vendido' : 'cobrado';
                const cur = window.State.ui?.dashCashMode === 'vendido' ? 'vendido' : 'cobrado';
                if (mode === cur) return;
                setChartUI({ dashCashMode: mode });
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
        root.querySelectorAll('[data-dash-pyg-period]').forEach(btn => {
            btn.addEventListener('click', () => {
                const next = btn.dataset.dashPygPeriod;
                if (next !== 'month' && next !== 'prev' && next !== 'all') return;
                if (readPyGPeriodMode() === next) return;
                setChartUI({ dashPyGPeriod: next });
            });
        });

        const allocPanel = root.querySelector('.dash-alloc-panel');
        if (allocPanel) {
            const allocSnap = (() => {
                const s = readAllocState();
                const total = round2(ALLOC_BUCKETS.reduce((sum, b) => sum + (s.buckets[b.key] || 0), 0));
                let unitCost = 0;
                try {
                    const lotes = window.State.lotes || [];
                    let costo = 0;
                    let vendidas = 0;
                    lotes.forEach(lote => {
                        const sum = sumFeesAndCogs(lote, window.State.settings);
                        costo += sum.costoVendido;
                        vendidas += Calc.syncVendidas(lote);
                    });
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
                    if (shareEl) shareEl.textContent = `${percents[b.key]}% de cada venta · ${share}% del total`;
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
            allocPanel.querySelectorAll('[data-alloc-undo-spend]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = btn.getAttribute('data-alloc-undo-spend');
                    if (reverseSpend(id)) {
                        renderPreservingScroll('.dash-alloc-panel');
                        UI.toast?.('Uso deshecho · vuelvió a la bolsita');
                    } else {
                        UI.toast?.('No encontré ese uso', 'error');
                    }
                });
            });
        }

        const detail = root.querySelector('[data-dash-spark-detail]');
        const hits = [...root.querySelectorAll('.dash-hit, .dash-progress-col[data-dash-point]')];
        const setDetail = (el) => {
            if (!detail || !el) return;
            detail.innerHTML = formatSparkDetail(el);
            const idx = Number(el.dataset.dashPoint);
            hits.forEach(h => h.classList.toggle('is-active', Number(h.dataset.dashPoint) === idx));
            root.querySelectorAll('.dash-pt').forEach(g => {
                g.classList.toggle('is-focus', Number(g.dataset.dashPoint) === idx);
            });
            root.querySelectorAll('.dash-progress-col[data-dash-point]').forEach(col => {
                const on = Number(col.dataset.dashPoint) === idx;
                col.classList.toggle('is-active', on);
                col.classList.toggle('is-focus', on);
            });
            root.querySelectorAll('.dash-progress-xlabels [data-dash-xlabel]').forEach(span => {
                span.classList.toggle('is-focus', Number(span.dataset.dashXlabel) === idx);
            });
            root.querySelectorAll('.dash-spark-markers [data-dash-dot]').forEach(dot => {
                dot.classList.toggle('is-focus', Number(dot.dataset.dashDot) === idx);
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

        UI.countUp?.(root);
    }

    function init() {
        window.State.subscribe(() => {
            if (window.State.view !== 'dashboard') return;
            // No tumbar paneles abiertos de bolsitas / diálogo bonif mid-edit
            if (document.querySelector('#dashboard-canvas .dash-bolsa.is-editing, #dashboard-canvas .dash-bolsa.is-using, .dash-bonif-dlg, .dash-bonif-form')) {
                return;
            }
            renderPreservingScroll();
        });
    }

    return {
        init,
        render,
        applySaleLiberationWithSplits,
        reverseSaleLiberation,
        purgeOrphanSaleLiberations,
        reconcileAllocFromLedger,
        ALLOC_BUCKETS,
        splitByPercents,
        readAllocState,
        round2,
    };
})();
window.DashboardView = DashboardView;
