/* ==========================================================================
   Dashboard — Progreso · P&G · flujo de caja · Asignación · Portafolio · Ranking
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
        const mpLabel = window.State.marketplace === 'amazon' ? 'Amazon' : 'Mercado Libre';
        persistAllocMigrations();
        // Evita bolsitas fantasma (total > 0 con liberado $0 sin ventas en ledger)
        try { reconcileAllocFromLedger(allocMpKey()); } catch { /* ignore */ }

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
                            cashMode: window.State.ui?.dashCashMode === 'vendido' ? 'vendido' : 'cobrado',
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

        if (!lotesAll.length) {
            root.innerHTML = `
                <div class="dash-shell">
                    <div class="dash-body dash-body-combined">
                        <div class="dash-empty-full">
                            <h2>Vista ejecutiva vacía</h2>
                            <p class="muted">Agrega productos en Mercado Libre o Amazon para ver el consolidado.</p>
                            <div class="dash-empty-actions">
                                <button type="button" class="btn primary" data-dash-goto-mp="meli">Abrir Mercado Libre</button>
                                <button type="button" class="btn" data-dash-goto-mp="amazon">Abrir Amazon</button>
                            </div>
                        </div>
                        <section class="dash-section">
                            <h2 class="dash-section-title">Capital unificado</h2>
                            ${layCapitalUnificado(allocUnified)}
                        </section>
                    </div>
                </div>`;
            bind(root);
            return;
        }

        root.innerHTML = `
            <div class="dash-shell dash-shell-general" id="dash-general-root">
                <div class="dash-body dash-body-combined gx-body">
                    ${layGeneralExecutive(exec)}
                    <details class="gx-more" id="gx-progreso">
                        <summary class="gx-more-summary">Progreso (gráficas)</summary>
                        <div class="gx-more-body">
                            <div class="dash-chart-toggles" style="margin-bottom:12px">
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
                            ${layProgreso(lotesAll, {
                                period: chartPeriod,
                                range: chartRange,
                                showEmpty: chartShowEmpty,
                                chartType,
                                fromDate: fromResolved.iso,
                                fromPreset: fromResolved.preset,
                                cashMode: window.State.ui?.dashCashMode === 'vendido' ? 'vendido' : 'cobrado',
                            })}
                        </div>
                    </details>
                    <details class="gx-more" id="gx-finanzas">
                        <summary class="gx-more-summary">Finanzas (P&amp;G · caja · portafolio)</summary>
                        <div class="gx-more-body">
                            <div class="gx-fin-stack">
                                <div>
                                    <h3 class="gx-fin-h">P&amp;G</h3>
                                    ${layPyG(ctx)}
                                </div>
                                <div>
                                    <h3 class="gx-fin-h">Caja</h3>
                                    ${layCaja(ctx)}
                                </div>
                                <div>
                                    <h3 class="gx-fin-h">Portafolio</h3>
                                    ${layPortafolio(ctx)}
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
        const cut = Date.now() - days * 86400000;
        let uds = 0;
        (lotes || []).forEach(lote => {
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            ventas.forEach(v => {
                const d = parseSaleDate(v.fecha);
                if (!d || d.getTime() < cut) return;
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
                    const d = parseSaleDate(v.fecha);
                    if (!d || d < start) return;
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
        let winner = 'Empate';
        let line = 'Ambos canales rinden parecido; reparte según capacidad operativa.';
        if (pctMeli >= pctAmz + 8) {
            winner = 'Mercado Libre';
            line = `Meli rinde mejor por capital/rotación. Sugiere ~${pctMeli}% del próximo peso ahí.`;
        } else if (pctAmz >= pctMeli + 8) {
            winner = 'Amazon';
            line = `Amazon rinde mejor por capital/rotación. Sugiere ~${pctAmz}% del próximo peso ahí.`;
        }
        return { pctMeli, pctAmz, winner, line, scoreMeli: sM, scoreAmz: sA };
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

    const DEALS_SEED = [
        {
            id: 'seed-wm-1',
            store: 'walmart',
            title: 'Ofertas Walmart México',
            note: 'Revisa electrónicos y hogar',
            tag: 'Walmart',
            url: 'https://www.walmart.com.mx/contenido/ofertas',
        },
        {
            id: 'seed-wm-2',
            store: 'walmart',
            title: 'Walmart · Super precios',
            note: 'Ideas de recompra / sourcing',
            tag: 'Promo',
            url: 'https://www.walmart.com.mx/',
        },
        {
            id: 'seed-costco-1',
            store: 'costco',
            title: 'Costco México · ofertas',
            note: 'Mayoreo y warehouse',
            tag: 'Costco',
            url: 'https://www.costco.com.mx/',
        },
        {
            id: 'seed-costco-2',
            store: 'costco',
            title: 'Costco · Especiales del mes',
            note: 'Compara vs tu costo actual',
            tag: 'Especial',
            url: 'https://www.costco.com.mx/',
        },
    ];

    function normalizeDeal(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const store = String(raw.store || 'otro').toLowerCase();
        const title = String(raw.title || '').trim();
        const url = String(raw.url || '').trim();
        if (!title || !url) return null;
        return {
            id: String(raw.id || (`d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)),
            store: ['walmart', 'costco', 'otro'].includes(store) ? store : 'otro',
            title,
            note: String(raw.note || '').trim(),
            tag: String(raw.tag || '').trim() || (store === 'walmart' ? 'Walmart' : store === 'costco' ? 'Costco' : 'Oferta'),
            url,
        };
    }

    function loadDeals() {
        const raw = window.State.ui?.dealsTicker;
        if (Array.isArray(raw) && raw.length) {
            const list = raw.map(normalizeDeal).filter(Boolean);
            if (list.length) return list;
        }
        return DEALS_SEED.map(d => ({ ...d }));
    }

    function saveDeals(list) {
        const dealsTicker = (list || []).map(normalizeDeal).filter(Boolean);
        window.State.ui = { ...window.State.ui, dealsTicker };
        window.State.saveUI();
        return dealsTicker;
    }

    function storeLabel(store) {
        if (store === 'walmart') return 'Walmart';
        if (store === 'costco') return 'Costco';
        return 'Otro';
    }

    function layDealsTicker() {
        const deals = loadDeals();
        const items = deals.length ? deals : DEALS_SEED;
        // Duplicar pista para loop continuo
        const track = [...items, ...items].map(d => `
            <a class="gx-ticker-item store-${esc(d.store)}" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">
                <span class="gx-ticker-tag">${esc(d.tag || storeLabel(d.store))}</span>
                <span class="gx-ticker-title">${esc(d.title)}</span>
                ${d.note ? `<span class="gx-ticker-note">${esc(d.note)}</span>` : ''}
            </a>
        `).join('<span class="gx-ticker-sep" aria-hidden="true">·</span>');
        return `
            <div class="gx-ticker" role="region" aria-label="Ofertas Walmart y Costco">
                <div class="gx-ticker-label">
                    <span>Ofertas</span>
                    <button type="button" class="gx-ticker-manage" data-deals-open title="Gestionar ofertas">✎</button>
                </div>
                <div class="gx-ticker-viewport">
                    <div class="gx-ticker-track">${track}</div>
                </div>
            </div>
            <div class="gx-deals-panel" data-deals-panel hidden>
                <div class="gx-deals-panel-card">
                    <div class="gx-deals-panel-head">
                        <div>
                            <h3>Ofertas del ticker</h3>
                            <p class="muted small">Cárgalas a mano o importa un JSON. No scrapea Walmart/Costco automáticamente.</p>
                        </div>
                        <button type="button" class="icon-btn" data-deals-close aria-label="Cerrar">×</button>
                    </div>
                    <form class="gx-deals-form" data-deals-form>
                        <label class="gx-field"><span>Tienda</span>
                            <select name="store">
                                <option value="walmart">Walmart</option>
                                <option value="costco">Costco</option>
                                <option value="otro">Otro</option>
                            </select>
                        </label>
                        <label class="gx-field"><span>Título</span>
                            <input name="title" required placeholder="Ej. TV 55&quot; en oferta" maxlength="80">
                        </label>
                        <label class="gx-field"><span>Nota</span>
                            <input name="note" placeholder="Opcional" maxlength="80">
                        </label>
                        <label class="gx-field"><span>Etiqueta</span>
                            <input name="tag" placeholder="−20% / Promo" maxlength="20">
                        </label>
                        <label class="gx-field gx-field-wide"><span>URL</span>
                            <input name="url" type="url" required placeholder="https://www.walmart.com.mx/...">
                        </label>
                        <button type="submit" class="btn primary">Agregar</button>
                    </form>
                    <div class="gx-deals-tools">
                        <button type="button" class="btn" data-deals-import>Importar JSON</button>
                        <button type="button" class="btn" data-deals-export>Exportar JSON</button>
                        <button type="button" class="btn" data-deals-seed>Restaurar ejemplos</button>
                        <input type="file" accept="application/json,.json" data-deals-file hidden>
                    </div>
                    <ul class="gx-deals-list" data-deals-list>
                        ${items.map(d => `
                            <li>
                                <div>
                                    <strong>${esc(d.title)}</strong>
                                    <span class="muted small">${esc(storeLabel(d.store))} · ${esc(d.tag || '')}</span>
                                </div>
                                <button type="button" class="btn" data-deals-del="${esc(d.id)}">Quitar</button>
                            </li>
                        `).join('')}
                    </ul>
                    <p class="muted small">Formato JSON: <code>[{"store":"walmart","title":"...","url":"https://...","tag":"−15%","note":"..."}]</code></p>
                </div>
            </div>
        `;
    }

    function bindDealsTicker(root) {
        const panel = root.querySelector('[data-deals-panel]');
        const open = () => { if (panel) panel.hidden = false; };
        const close = () => { if (panel) panel.hidden = true; };
        root.querySelectorAll('[data-deals-open]').forEach(btn => btn.addEventListener('click', open));
        root.querySelectorAll('[data-deals-close]').forEach(btn => btn.addEventListener('click', close));
        panel?.addEventListener('click', (e) => {
            if (e.target === panel) close();
        });

        const form = root.querySelector('[data-deals-form]');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const next = saveDeals([
                ...loadDeals(),
                {
                    store: fd.get('store'),
                    title: fd.get('title'),
                    note: fd.get('note'),
                    tag: fd.get('tag'),
                    url: fd.get('url'),
                },
            ]);
            UI.toast?.(`Oferta agregada · ${next.length} en ticker`);
            render();
        });

        root.querySelectorAll('[data-deals-del]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.dealsDel;
                saveDeals(loadDeals().filter(d => d.id !== id));
                UI.toast?.('Oferta quitada');
                render();
            });
        });

        root.querySelectorAll('[data-deals-seed]').forEach(btn => {
            btn.addEventListener('click', () => {
                saveDeals(DEALS_SEED.map(d => ({ ...d })));
                UI.toast?.('Ejemplos restaurados');
                render();
            });
        });

        const fileInput = root.querySelector('[data-deals-file]');
        root.querySelectorAll('[data-deals-import]').forEach(btn => {
            btn.addEventListener('click', () => fileInput?.click());
        });
        fileInput?.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                const arr = Array.isArray(parsed) ? parsed : (parsed?.deals || []);
                const list = arr.map(normalizeDeal).filter(Boolean);
                if (!list.length) throw new Error('Sin ofertas válidas');
                saveDeals(list);
                UI.toast?.(`Importadas ${list.length} ofertas`);
                render();
            } catch (err) {
                UI.toast?.(err.message || 'JSON inválido', 'error');
            } finally {
                fileInput.value = '';
            }
        });

        root.querySelectorAll('[data-deals-export]').forEach(btn => {
            btn.addEventListener('click', () => {
                const blob = new Blob([JSON.stringify(loadDeals(), null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `ofertas-ticker-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                UI.toast?.('JSON exportado');
            });
        });
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
        const moreOpen = window.State.ui?.gxMoreOpen === true;
        const checklist = readDailyChecklist();

        return `
            <section class="dash-section dash-exec gx-exec" id="gx-pulso">
                <div class="gx-hero gx-hero-compact">
                    <div class="gx-hero-copy">
                        <p class="gx-brand">Ventas</p>
                        <h2 class="gx-title">Hoy</h2>
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
                        <div class="gx-hero-metric-value">${Calc.fmtMXN(monthStats.ganancia)}</div>
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
                        tone: 'neutral',
                        hint: goalCash > 0 ? `${fmtGoalPct(pctCash)} de meta` : `${monthStats.unidades} uds`,
                        foot: `Proy. ${Calc.fmtMXN(monthStats.projCash)}`,
                        progress: goalCash > 0 ? Math.min(1, Math.max(0, pctCash)) : null,
                    })}
                    ${layScoreMetric({
                        label: 'Capital atrapado',
                        value: Calc.fmtMXN(trapped),
                        tone: trapped > 0 ? 'warn' : 'ok',
                        hint: 'Inventario al costo',
                        foot: `Disponible ${Calc.fmtMXN(reinversion)}`,
                    })}
                    ${layScoreMetric({
                        label: 'Atención',
                        value: String(alertN),
                        tone: alertN > 0 ? 'bad' : 'ok',
                        hint: alertN > 0 ? 'Requieren acción' : 'Sin críticas',
                        foot: alerts.line,
                    })}
                </div>
            </section>

            <section class="dash-section gx-block" id="gx-checklist">
                <div class="gx-block-head">
                    <div>
                        <p class="gx-block-kicker">01</p>
                        <h2 class="gx-block-title">Checklist · 3 minutos</h2>
                    </div>
                    <p class="gx-block-lead">Ventas · stock crítico · una acción. Listo y listo.</p>
                </div>
                <ul class="gx-daily-check">
                    <li class="${checklist.ventas ? 'is-done' : ''}">
                        <label>
                            <input type="checkbox" data-daily-check="ventas" ${checklist.ventas ? 'checked' : ''}>
                            <span><strong>Ventas nuevas</strong><small>Registra o importa lo de hoy</small></span>
                        </label>
                        <button type="button" class="btn btn-sm" data-dash-goto-mp="meli">Ir a catálogo</button>
                    </li>
                    <li class="${checklist.stock ? 'is-done' : ''}">
                        <label>
                            <input type="checkbox" data-daily-check="stock" ${checklist.stock ? 'checked' : ''}>
                            <span><strong>Stock crítico</strong><small>${alerts.nEscLow || 0} ESCALAR bajos · ${alerts.nAgot || 0} agotados</small></span>
                        </label>
                        <button type="button" class="btn btn-sm" data-goto-insights>Insights</button>
                    </li>
                    <li class="${checklist.agenda ? 'is-done' : ''}">
                        <label>
                            <input type="checkbox" data-daily-check="agenda" ${checklist.agenda ? 'checked' : ''}>
                            <span><strong>1 acción de Agenda</strong><small>${esc(checklist.agendaHint || 'Marca un pendiente abajo')}</small></span>
                        </label>
                    </li>
                </ul>
            </section>

            <section class="dash-section gx-block" id="gx-acciones">
                <div class="gx-block-head">
                    <div>
                        <p class="gx-block-kicker">02</p>
                        <h2 class="gx-block-title">Agenda y prioridades</h2>
                    </div>
                    <p class="gx-block-lead">Qué hacer hoy con el capital.</p>
                </div>
                <div class="gx-actions dash-split-2">
                    <div class="dash-panel gx-panel">
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
                    <div class="dash-panel gx-panel">
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

            <section class="dash-section gx-block" id="gx-invmap">
                <div class="gx-block-head">
                    <div>
                        <p class="gx-block-kicker">03</p>
                        <h2 class="gx-block-title">Sano vs flojo</h2>
                    </div>
                    <p class="gx-block-lead">Cuánto capital está en margen sano (≥20%) vs flojo.</p>
                </div>
                ${layInvMarginMap(aggCombined.rows || [])}
            </section>

            <section class="dash-section gx-block" id="gx-metas">
                <div class="gx-block-head">
                    <div>
                        <p class="gx-block-kicker">04</p>
                        <h2 class="gx-block-title">Metas del mes</h2>
                    </div>
                    <p class="gx-block-lead">Objetivo simple. El pulso sigue el ritmo.</p>
                </div>
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
            </section>

            <details class="gx-more" id="gx-canales" data-gx-more-persist ${moreOpen ? 'open' : ''}>
                <summary class="gx-more-summary">Más detalle · canales, capital y ofertas Walmart/Costco</summary>
                <div class="gx-more-body">
                    <div class="gx-alloc-suggest" aria-label="Asignación sugerida de capital" style="margin-bottom:16px">
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
                    <div style="margin-top:18px">${layCapitalUnificado(allocUnified)}</div>
                    <div class="gx-ticker-wrap" id="gx-ticker" style="margin-top:18px">
                        ${layDealsTicker()}
                    </div>
                </div>
            </details>
        `;
    }

    function readDailyChecklist() {
        const key = agendaDayKey();
        const store = window.State.ui?.dailyChecklist && typeof window.State.ui.dailyChecklist === 'object'
            ? window.State.ui.dailyChecklist
            : {};
        const day = store[key] && typeof store[key] === 'object' ? store[key] : {};
        const agenda = buildAgendaForChecklistHint();
        return {
            ventas: !!day.ventas,
            stock: !!day.stock,
            agenda: !!day.agenda,
            agendaHint: agenda,
        };
    }

    function buildAgendaForChecklistHint() {
        try {
            const { set } = readAgendaDone();
            // hint from last render's agenda is rebuilt in bind; keep short
            return set.size ? 'Marca un pendiente de la agenda' : 'Revisa prioridades o crea una acción';
        } catch {
            return 'Una acción concreta';
        }
    }

    function saveDailyChecklist(patch) {
        const key = agendaDayKey();
        const store = { ...(window.State.ui?.dailyChecklist || {}) };
        store[key] = { ...(store[key] || {}), ...patch };
        window.State.ui = { ...window.State.ui, dailyChecklist: store };
        window.State.saveUI();
    }

    function fmtGoalPct(ratio) {
        if (ratio == null || !Number.isFinite(ratio)) return '—';
        return `${Math.round(ratio * 100)}%`;
    }

    function layScoreMetric({ label, value, tone, hint, foot, progress = null, primary = false }) {
        const t = tone || 'neutral';
        const bar = progress == null ? '' : `
            <div class="gx-metric-bar" aria-hidden="true">
                <span style="width:${Math.round(progress * 100)}%"></span>
            </div>`;
        return `
            <article class="gx-metric tone-${t}${primary ? ' is-primary' : ''}">
                <div class="gx-metric-top">
                    <span class="gx-metric-label">${esc(label)}</span>
                    <span class="gx-metric-status" aria-hidden="true"></span>
                </div>
                <div class="gx-metric-value">${value}</div>
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
                <div class="dash-bolsa-hero-value mono">${Calc.fmtMXN(st.total)}</div>
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
        root.querySelectorAll('[data-daily-check]').forEach(input => {
            input.addEventListener('change', () => {
                const key = input.dataset.dailyCheck;
                if (!key) return;
                saveDailyChecklist({ [key]: !!input.checked });
                input.closest('li')?.classList.toggle('is-done', input.checked);
            });
        });
        root.querySelectorAll('[data-lote-new]').forEach(btn => {
            btn.addEventListener('click', () => {
                window.LotesView?.openModal?.(null);
            });
        });
        root.querySelectorAll('[data-goto-insights]').forEach(btn => {
            btn.addEventListener('click', () => {
                window.App?.switchTab?.('insights');
            });
        });
        root.querySelectorAll('[data-goto-caja]').forEach(btn => {
            btn.addEventListener('click', () => {
                const sub = btn.getAttribute('data-goto-caja') || 'cobrar';
                window.CajaView?.open?.(sub);
            });
        });
        root.querySelectorAll('details[data-gx-more-persist]').forEach(el => {
            el.addEventListener('toggle', () => {
                window.State.ui = { ...window.State.ui, gxMoreOpen: el.open };
                window.State.saveUI();
            });
        });
        bindDealsTicker(root);
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
                ${layAsignacionReadonlyBlock('Amazon', 'amazon')}
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
                        <p class="muted small">Solo lectura · gestiona en el catálogo</p>
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

    function formatFromLabel(iso) {
        const d = parseISODate(iso);
        if (!d) return iso || '';
        return fmtDMY(d);
    }

    /** Venta ya repartida en bolsitas (Caja). No cuenta cobrado-sin-asignar ni legacy suelto. */
    function ventaIsCobrado(v) {
        return !!(v && Data.hasAsignacion?.(v));
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
        const totalGain = sum(series, 'ganancia');
        const totalUds = sum(series, 'unidades');
        const porCobrarAmt = round2(totalVendido - totalCobrado);
        const emptyHidden = !showEmpty && series.some(b => !(b.cashIn > 0 || b.ganancia > 0 || b.unidades > 0));
        const mpView = window.State.ui?.mpView;
        const mpLabel = mpView === 'general'
            ? 'General (ambos)'
            : (window.State.marketplace === 'amazon' ? 'Amazon' : 'Mercado Libre');
        const rangeHint = fromDate
            ? (fromPreset === 'month'
                ? 'Mes corriente → hoy'
                : fromPreset === 'year'
                    ? 'Año corriente → hoy'
                    : `Desde ${esc(formatFromLabel(fromDate))} hasta hoy`)
            : (period === 'years'
                ? 'Últimos años con actividad'
                : `Últimos ${range} ${period === 'weeks' ? 'semanas' : 'meses'}`);
        const modeHint = cashMode === 'cobrado'
            ? 'Solo marcado Cobrado en Caja'
            : 'Todas las ventas registradas';

        return `
            <div class="dash-prog-mode">
                <div class="dash-seg" role="group" aria-label="Vendido o cobrado">
                    <button type="button" class="dash-seg-btn${cashMode === 'cobrado' ? ' active' : ''}" data-dash-cash="cobrado">Cobrado</button>
                    <button type="button" class="dash-seg-btn${cashMode === 'vendido' ? ' active' : ''}" data-dash-cash="vendido">Vendido</button>
                </div>
                <span class="muted small">${esc(modeHint)}</span>
            </div>
            <div class="dash-grid-kpi dash-grid-kpi-3">
                ${kpi(
                    'Cobrado · periodo',
                    Calc.fmtMXN(totalCobrado),
                    cashMode === 'cobrado' ? 'pos' : '',
                    porCobrarAmt > 0.009
                        ? `Por cobrar ${Calc.fmtMXN(porCobrarAmt)}`
                        : rangeHint,
                )}
                ${kpi(
                    'Vendido · periodo',
                    Calc.fmtMXN(totalVendido),
                    cashMode === 'vendido' ? 'pos' : '',
                    rangeHint,
                )}
                ${kpi(
                    cashMode === 'cobrado' ? 'Ganancia cobrada' : 'Ganancia vendida',
                    Calc.fmtMXN(totalGain),
                    tone(totalGain),
                    `${totalUds} uds · ${esc(modeHint)}`,
                )}
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
                ${renderProgressChart(chartType, chartSeries, {
                    totalCash,
                    totalGain,
                    totalUds,
                    period,
                    cashMode,
                })}
                <p class="muted small dash-chart-note">
                    ${emptyHidden
                        ? 'Periodos vacíos ocultos. Activa «Mostrar vacíos» para ver el calendario completo.'
                        : `Gráfica = ${cashMode === 'cobrado' ? 'Cobrado' : 'Vendido'} · ${esc(mpLabel)}.`}
                </p>
            </div>
        `;
    }

    function buildProgressSeries(lotes, period, range = 12, fromISO = '', cashMode = 'cobrado') {
        const fromDate = parseISODate(fromISO);
        const mode = cashMode === 'vendido' ? 'vendido' : 'cobrado';
        const map = new Map();
        (lotes || []).forEach(lote => {
            const settings = settingsForTaggedLote(lote);
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];

            if (ventas.length) {
                ventas.forEach(v => {
                    if (mode === 'cobrado' && !ventaIsCobrado(v)) return;
                    // Cobrado: fecha de cobro (cash-basis); Vendido: fecha de venta
                    const d = mode === 'cobrado'
                        ? (parseSaleDate(v.cobradoAt) || parseSaleDate(v.fecha))
                        : parseSaleDate(v.fecha);
                    if (!d) return;
                    if (fromDate && d < fromDate) return;
                    const key = periodKey(d, period);
                    if (!map.has(key)) map.set(key, emptyBucket(key, d, period));
                    const b = map.get(key);
                    const uds = Math.max(0, Number(v.unidades) || 0);
                    const precio = Number(v.precio) || 0;
                    const loteAt = loteAtSaleCost(lote, v);
                    const u = Calc.utilidadAtPrice(loteAt, precio, settings).utilidad;
                    b.cashIn += precio * uds;
                    b.ganancia += u * uds;
                    b.unidades += uds;
                    b.pedidos += 1;
                });
                return;
            }

            // Legacy sin eventos: cuenta en ambos modos (historial viejo = ya cobrado)
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
            b.ganancia += calc.utilidad * vendidas;
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
                        ${ctx.cashMode === 'vendido' ? 'Vendido' : 'Cobrado'} ${Calc.fmtMXN(ctx.totalCash || 0)} · ${ctx.totalUds || 0} uds
                        · Último con datos: ${esc(cur.b.tip || cur.b.label || '—')}
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
            <div class="dash-progress-chart dash-progress-line" role="img" aria-label="Tendencia de ganancia y cobrado/vendido">
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

    function layPyG({ agg, fees, costoVendido, gastoAds, isAmazon, isGeneral }) {
        const bruto = agg.cashIn - costoVendido;
        const neto = agg.gananciaRealizada;
        const feeLabel = isGeneral
            ? '− Fees Meli + Amazon (est.)'
            : (isAmazon
                ? '− Fees Amazon (est.)'
                : '− Fees ML + retenciones (est.)');
        const lines = [
            { label: 'Ingresos (cash in)', value: agg.cashIn },
            { label: '− Costo de lo vendido', value: -costoVendido },
            { label: '= Utilidad bruta est.', value: bruto, bold: true },
            { label: feeLabel, value: -fees },
            { label: '= Ganancia realizada', value: neto, bold: true },
            { label: 'Gasto Ads (referencia, no restado arriba)', value: -gastoAds },
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
                        Fees y costo al precio real de cada venta. Ganancia realizada = utilidad por venta. Ads del lote aparte.
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
                    ${neto < -0.009
                        ? `<p class="muted small" style="margin-top:8px">Pérdida <span class="neg">${Calc.fmtMXN(neto)}</span> (fees + costo &gt; ingresos).</p>`
                        : ''}
                    <p class="muted small" style="margin-top:10px">
                        Ads del lote (referencia, fuera del cash in): ${Calc.fmtMXN(gastoAds)}
                    </p>
                    <div class="dash-mini-kpis">
                        ${mini('Margen lista', Calc.fmtPct(agg.margenPonderado))}
                        ${mini('Uds vendidas', String(agg.totalVendidas))}
                        ${mini('Fees / cash', agg.cashIn ? Calc.fmtPct(fees / agg.cashIn) : '—')}
                    </div>
                </div>
            </div>
        `;
    }

    /** Cash de ventas marcadas Cobrado en Caja (o legacy sin eventos). */
    function sumCashCobrado(rows) {
        let cash = 0;
        (rows || []).forEach(({ lote }) => {
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            if (ventas.length) {
                ventas.forEach(v => {
                    if (!ventaIsCobrado(v)) return;
                    cash += (Number(v.precio) || 0) * Math.max(0, Number(v.unidades) || 0);
                });
                return;
            }
            // Legacy: vendidas sin eventos → se trata como ya cobrado
            const vendidas = Math.max(0, Number(lote.vendidas) || 0);
            if (vendidas > 0) cash += (Number(lote.precio) || 0) * vendidas;
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
                // Injections/ledger reconstruyen bolsitas: no truncar (borra dinero)
                injections: Array.isArray(raw.injections) ? raw.injections : [],
                ledger: (Array.isArray(raw.ledger) ? raw.ledger : []).map(migrateLedgerEntry),
            };
            changed = true;
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
                    injections: Array.isArray(cur.injections) ? cur.injections : [],
                    ledger: Array.isArray(cur.ledger) ? cur.ledger.map(migrateLedgerEntry) : [],
                },
            },
        };
        window.State.saveUI();
    }

    /** Libera a bolsitas con splits explícitos (flujo Caja). */
    function applySaleLiberationWithSplits(amount, splits, meta = {}) {
        const amt = round2(amount);
        if (amt <= 0) return null;
        const state = readAllocState();
        if (meta?.ventaId && state.ledger.some(x => x.type === 'sale' && x.meta?.ventaId === meta.ventaId)) {
            return null;
        }
        const cleaned = emptyAllocBuckets();
        ALLOC_BUCKETS.forEach(({ key }) => {
            const n = Number(splits?.[key]);
            cleaned[key] = Number.isFinite(n) && n > 0 ? round2(n) : 0;
        });
        const entry = {
            id: `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'sale',
            amount: amt,
            at: Date.now(),
            splits: cleaned,
            meta,
        };
        writeAllocState({
            buckets: addSplits(state.buckets, cleaned, 1),
            liberated: round2(state.liberated + amt),
            ledger: [...state.ledger, entry],
        });
        return entry;
    }

    /** Cobrado sin bolsitas (rescate). Pendientes de cobro no entran aquí. */
    function listUnassignedVentas() {
        const state = readAllocState();
        const assigned = new Set(
            state.ledger.filter(x => x.type === 'sale' && x.meta?.ventaId).map(x => x.meta.ventaId),
        );
        const lists = Data.listVentasCobro?.(window.State.lotes, window.State.settings);
        const rows = lists?.porAsignar || [];
        return rows
            .filter(r => r.ventaId && !assigned.has(r.ventaId) && (r.amount || 0) > 0)
            .map(r => ({
                ventaId: r.ventaId,
                loteId: r.loteId,
                fecha: r.fecha,
                producto: r.producto,
                unidades: r.unidades,
                precio: r.precio,
                amount: r.amount,
            }));
    }

    function readRawAlloc(mp) {
        const store = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        const raw = store[mp] && typeof store[mp] === 'object' ? store[mp] : null;
        return raw || null;
    }

    function writeRawAlloc(mp, nextRaw) {
        const prev = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        window.State.ui = {
            ...window.State.ui,
            capitalAlloc: {
                ...prev,
                [mp]: nextRaw,
            },
        };
        window.State.saveUI();
    }

    function bucketsFromRaw(raw) {
        const buckets = emptyAllocBuckets();
        const src = migrateLegacyAllocMaps(raw?.buckets && typeof raw.buckets === 'object' ? raw.buckets : {});
        ALLOC_BUCKETS.forEach(({ key }) => {
            const n = Number(src[key]);
            buckets[key] = Number.isFinite(n) && n > 0 ? round2(n) : 0;
        });
        return buckets;
    }

    function sumSplits(splits) {
        const s = migrateLegacyAllocMaps(splits || {});
        return round2(ALLOC_BUCKETS.reduce((acc, b) => acc + (Number(s[b.key]) || 0), 0));
    }

    /** Si splits vienen vacíos pero hay monto, reparte con % (evita fantasmas en bolsitas). */
    function resolveSplits(amount, splits, percents) {
        const cleaned = migrateLegacyAllocMaps(splits || {});
        const sum = sumSplits(cleaned);
        const amt = round2(amount);
        if (sum > 0.009) {
            // Si el desglose no cuadra con el monto, escala al monto
            if (amt > 0 && Math.abs(sum - amt) > 0.05) {
                const scale = amt / sum;
                const out = emptyAllocBuckets();
                let used = 0;
                ALLOC_BUCKETS.forEach(({ key }, i) => {
                    if (i === ALLOC_BUCKETS.length - 1) out[key] = round2(amt - used);
                    else {
                        out[key] = round2((Number(cleaned[key]) || 0) * scale);
                        used = round2(used + out[key]);
                    }
                });
                return out;
            }
            return { ...emptyAllocBuckets(), ...cleaned };
        }
        if (amt > 0) return splitByPercents(amt, percents || defaultAllocPercents());
        return emptyAllocBuckets();
    }

    /**
     * Reconstruye buckets + liberated desde el ledger (fuente de verdad).
     * Mata fantasmas: buckets con dinero y liberated $0 sin ventas en ledger.
     */
    function reconcileAllocFromLedger(mp = allocMpKey()) {
        const raw = readRawAlloc(mp);
        if (!raw) return { changed: false, total: 0 };
        const percents = normalizePercents(raw.percents);
        const ledger = Array.isArray(raw.ledger) ? raw.ledger.map(migrateLedgerEntry) : [];
        let buckets = emptyAllocBuckets();
        let liberated = 0;
        ledger.forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            const amt = round2(entry.amount);
            const splits = resolveSplits(amt, entry.splits, percents);
            if (entry.type === 'sale') {
                buckets = addSplits(buckets, splits, 1);
                liberated = round2(liberated + (amt > 0 ? amt : sumSplits(splits)));
            } else if (entry.type === 'manual') {
                buckets = addSplits(buckets, splits, 1);
            } else if (entry.type === 'spend') {
                buckets = addSplits(buckets, splits, -1);
            }
        });
        // Inyecciones históricas (si existían fuera del ledger)
        const injections = Array.isArray(raw.injections) ? raw.injections : [];
        injections.forEach(inj => {
            const amt = round2(inj?.amount);
            if (!(amt > 0)) return;
            const splits = resolveSplits(amt, inj.splits, percents);
            buckets = addSplits(buckets, splits, 1);
        });

        const prevBuckets = bucketsFromRaw(raw);
        const prevLib = round2(Number(raw.liberated) || 0);
        const sameBuckets = ALLOC_BUCKETS.every(({ key }) =>
            round2(prevBuckets[key] || 0) === round2(buckets[key] || 0)
        );
        if (sameBuckets && prevLib === liberated) {
            return {
                changed: false,
                total: round2(ALLOC_BUCKETS.reduce((s, b) => s + (buckets[b.key] || 0), 0)),
            };
        }
        writeRawAlloc(mp, {
            ...raw,
            percents,
            buckets,
            liberated,
            ledger,
            injections,
            injected: round2(Number(raw.injected) || injections.reduce((s, x) => s + (Number(x.amount) || 0), 0)),
        });
        return {
            changed: true,
            total: round2(ALLOC_BUCKETS.reduce((s, b) => s + (buckets[b.key] || 0), 0)),
            liberated,
        };
    }

    /**
     * Quita de bolsitas el dinero de una venta.
     * 1) Busca en ledger por ventaId (string-safe)
     * 2) Si no hay entry, usa fallbackSplits (p.ej. venta.asignacion)
     * 3) Reconcilia buckets desde ledger para no dejar fantasmas
     */
    function reverseSaleLiberation(ventaId, fallbackSplits = null) {
        if (!ventaId && !fallbackSplits) return false;
        const vid = ventaId != null ? String(ventaId) : '';

        const tryMp = (mp) => {
            const raw = readRawAlloc(mp);
            if (!raw || !Array.isArray(raw.ledger)) return null;
            const idx = raw.ledger.findIndex(x =>
                x.type === 'sale' && x.meta?.ventaId != null && String(x.meta.ventaId) === vid
            );
            if (idx < 0) return null;
            return { mp, raw, idx, entry: raw.ledger[idx] };
        };

        const hit = vid
            ? (tryMp(allocMpKey()) || tryMp(allocMpKey() === 'amazon' ? 'meli' : 'amazon'))
            : null;

        if (hit) {
            const { mp, raw, idx } = hit;
            const ledger = raw.ledger.slice();
            ledger.splice(idx, 1);
            writeRawAlloc(mp, { ...raw, ledger });
            reconcileAllocFromLedger(mp);
            return true;
        }

        // Fallback: sin entry en ledger → reconstruir bolsitas (mata fantasmas)
        const mp = allocMpKey();
        const raw = readRawAlloc(mp);
        if (raw && Array.isArray(raw.ledger) && vid) {
            const filtered = raw.ledger.filter(x =>
                !(x.type === 'sale' && x.meta?.ventaId != null && String(x.meta.ventaId) === vid)
            );
            if (filtered.length !== raw.ledger.length) {
                writeRawAlloc(mp, { ...raw, ledger: filtered });
            }
        }
        const before = bucketsFromRaw(raw || {});
        const beforeTotal = round2(ALLOC_BUCKETS.reduce((s, b) => s + (before[b.key] || 0), 0));
        const rec = reconcileAllocFromLedger(mp);
        const afterTotal = rec.total || 0;
        // Si había asignacion de respaldo y el fantasma sigue (ledger vacío no bastó), resta splits
        const fallbackAmt = sumSplits(fallbackSplits);
        if (fallbackAmt > 0 && afterTotal >= beforeTotal - 0.02) {
            const cur = readRawAlloc(mp) || raw;
            const splits = resolveSplits(fallbackAmt, fallbackSplits, normalizePercents(cur?.percents));
            writeRawAlloc(mp, {
                ...cur,
                buckets: addSplits(bucketsFromRaw(cur), splits, -1),
                liberated: Math.max(0, round2((Number(cur?.liberated) || 0) - fallbackAmt)),
            });
            return true;
        }
        return !!(rec.changed || fallbackAmt > 0 || beforeTotal > afterTotal);
    }

    /**
     * Limpia entradas de ledger cuya venta ya no existe y reconcilia bolsitas.
     * mpLotes: { meli: lote[], amazon: lote[] } — si omites, solo limpia el MP activo.
     */
    function purgeOrphanSaleLiberations(mpLotes = null) {
        const targets = mpLotes && typeof mpLotes === 'object'
            ? mpLotes
            : { [allocMpKey()]: window.State.lotes };
        let n = 0;
        let total = 0;
        Object.keys(targets).forEach(mp => {
            const lotes = targets[mp];
            const alive = new Set();
            (lotes || []).forEach(l => (l.ventas || []).forEach(v => {
                if (v?.id) alive.add(String(v.id));
            }));
            const raw = readRawAlloc(mp);
            if (!raw) {
                return;
            }
            const ledger = Array.isArray(raw.ledger) ? raw.ledger : [];
            const keep = [];
            let localN = 0;
            ledger.forEach(entry => {
                if (entry?.type !== 'sale' || entry.meta?.ventaId == null) {
                    keep.push(entry);
                    return;
                }
                if (alive.has(String(entry.meta.ventaId))) {
                    keep.push(entry);
                    return;
                }
                localN += 1;
                total = round2(total + (Number(entry.amount) || sumSplits(entry.splits)));
            });
            if (localN > 0) {
                writeRawAlloc(mp, { ...raw, ledger: keep });
                n += localN;
            }
            // Siempre reconcilia: arregla fantasmas (buckets>0, liberated 0, sin sales)
            reconcileAllocFromLedger(mp);
        });
        return { n, total };
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

    /** Deshace un uso (spend): lo saca del ledger y reconstruye bolsitas. */
    function reverseSpend(entryId) {
        if (!entryId) return false;
        const mp = allocMpKey();
        const raw = readRawAlloc(mp);
        if (!raw || !Array.isArray(raw.ledger)) return false;
        const idx = raw.ledger.findIndex(x => x.type === 'spend' && String(x.id) === String(entryId));
        if (idx < 0) return false;
        const ledger = raw.ledger.slice();
        ledger.splice(idx, 1);
        writeRawAlloc(mp, { ...raw, ledger });
        reconcileAllocFromLedger(mp);
        return true;
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
                            El cobro se reparte en Caja. Si eliminas una venta, se resta de aquí.
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
                            <strong>${pendingSales.length} cobro${pendingSales.length === 1 ? '' : 's'} sin bolsitas</strong>
                            <p class="muted small">
                                Marcados cobrado sin repartir a bolsitas.
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
                ${rankCol('Por ROI', byRoi, r => (Number(r.lote.costo) > 0 ? Calc.fmtPct(r.calc.roi) : '—'), r => (Number(r.lote.costo) > 0 ? tone(r.calc.roi) : ''))}
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

    function rankCol(title, list, fmt, toneFn) {
        return `
            <div class="dash-panel">
                <h3>${esc(title)}</h3>
                <ol class="dash-rank-ol">
                    ${list.slice(0, 8).map((r, i) => `
                        <li data-dash-lote="${esc(r.lote.id)}" data-dash-mp="${esc(r.lote._mp || '')}">
                            <span class="n">${i + 1}</span>
                            <span class="name" title="${esc(r.lote.producto)}${r.lote.variante ? ' · ' + esc(r.lote.variante) : ''}">${esc(short(r.lote.producto, 28))}${r.lote.variante ? ` <small class="muted">${esc(short(r.lote.variante, 10))}</small>` : ''}${r.lote._mp ? ` <small class="dash-mp-mini">${r.lote._mp === 'amazon' ? 'Amz' : 'Meli'}</small>` : ''}</span>
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
        root.querySelectorAll('[data-goto-caja]').forEach(btn => {
            btn.addEventListener('click', () => {
                const sub = btn.getAttribute('data-goto-caja') || 'cobrar';
                window.CajaView?.open?.(sub);
            });
        });
        root.querySelectorAll('[data-dash-goto-mp]').forEach(btn => {
            btn.addEventListener('click', () => {
                const mp = btn.dataset.dashGotoMp;
                if (!mp || !['meli', 'amazon'].includes(mp)) return;
                if (window.App?.applyMarketplaceView) window.App.applyMarketplaceView(mp);
                else document.querySelector(`.sb-mp [data-marketplace="${mp}"]`)?.click();
            });
        });
        root.querySelectorAll('[data-dash-lote]').forEach(el => {
            el.addEventListener('click', () => openDashLote(el.dataset.dashLote, el.dataset.dashMp));
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
            allocPanel.querySelectorAll('[data-goto-caja]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const sub = btn.getAttribute('data-goto-caja') || 'asignar';
                    window.CajaView?.open?.(sub);
                });
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
        applySaleLiberationWithSplits,
        reverseSaleLiberation,
        purgeOrphanSaleLiberations,
        reconcileAllocFromLedger,
        spendFromBucket,
        listUnassignedVentas,
        ALLOC_BUCKETS,
        emptyAllocBuckets,
        defaultAllocPercents,
        normalizePercents,
        splitByPercents,
        readAllocState,
        round2,
    };
})();
window.DashboardView = DashboardView;
