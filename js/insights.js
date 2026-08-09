/* ==========================================================================
   Insights — vista única: Matriz + Comprar + Estancados + Precios
   ========================================================================== */

const InsightsView = (() => {

    // Reglas para badge de alertas (sidebar)
    const RULES = [
        ({ lote, calc }) => {
            if (calc.estrategia !== 'ESCALAR' || calc.inventarioRestante > 2) return null;
            return {
                severity: 'high', kind: 'restock',
                title: `Recompra urgente: ${lote.producto}`,
                text: `Solo quedan <strong>${calc.inventarioRestante} uds</strong> ESCALAR · utilidad ${Calc.fmtMXN(calc.utilidad)}.`,
                lote, calc,
            };
        },
        ({ lote, calc }) => {
            if (calc.estrategia !== 'LIQUIDAR' || calc.inventarioRestante < 3) return null;
            return {
                severity: 'high', kind: 'liquidate',
                title: `Rematar: ${lote.producto}`,
                text: `Utilidad <strong>${Calc.fmtMXN(calc.utilidad)}</strong> con <strong>${calc.inventarioRestante} uds</strong> atrapadas.`,
                lote, calc,
            };
        },
        ({ lote, calc }) => {
            const fecha = lote.fecha ? new Date(lote.fecha) : null;
            if (!fecha || calc.inventarioRestante === 0) return null;
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            if (ventas.length > 0) return null;
            const dias = Math.floor((Date.now() - fecha.getTime()) / 86400000);
            if (dias < 30) return null;
            return {
                severity: 'medium', kind: 'stagnant',
                title: `${lote.producto}: ${dias} días sin ventas`,
                text: `Stock ${calc.inventarioRestante} · ${Calc.fmtMXN(calc.valorInventario)} atrapados.`,
                lote, calc, dias,
            };
        },
        ({ lote, calc }) => {
            if (!lote.precioCompetencia || lote.precioCompetencia <= 0) return null;
            const diff = lote.precio / lote.precioCompetencia - 1;
            if (diff < 0.15) return null;
            return {
                severity: 'medium', kind: 'pricing',
                title: `${lote.producto} +${(diff * 100).toFixed(0)}% vs competencia`,
                text: `Tuyo ${Calc.fmtMXN(lote.precio)} · comp. ${Calc.fmtMXN(lote.precioCompetencia)}.`,
                lote, calc, diff,
            };
        },
        ({ lote, calc }) => {
            if (calc.estrategia !== 'ESCALAR' || calc.margen < 0.30 || !calc.inventarioRestante) return null;
            const isAmz = window.State.marketplace === 'amazon'
                || window.State.settings?.marketplace === 'amazon';
            return {
                severity: 'low', kind: 'opportunity',
                title: isAmz
                    ? `Escalar con Ads: ${lote.producto}`
                    : `Premium: ${lote.producto}`,
                text: isAmz
                    ? `Margen ${Calc.fmtPct(calc.margen)} · tope CPA ${Calc.fmtMXN(calc.topeCPA)}. Considera Sponsored Products.`
                    : `Margen ${Calc.fmtPct(calc.margen)} · tope CPA ${Calc.fmtMXN(calc.topeCPA)}.`,
                lote, calc,
            };
        },
        ({ lote, calc }) => {
            if (calc.adsStatus !== 'over' && calc.adsStatus !== 'near') return null;
            return {
                severity: calc.adsStatus === 'over' ? 'high' : 'medium',
                kind: 'ads',
                title: `Ads ${calc.adsStatus === 'over' ? 'sobre' : 'cerca del'} tope: ${lote.producto}`,
                text: `${Calc.fmtMXN(calc.adsPorVenta)}/venta vs tope ${Calc.fmtMXN(calc.topeCPA)}.`,
                lote, calc,
            };
        },
        ({ lote, calc }) => {
            if (calc.estrategia !== 'AGOTADO') return null;
            const hadDemand = (calc.vendidas || 0) > 0 || (Array.isArray(lote.ventas) && lote.ventas.length > 0);
            return {
                severity: hadDemand ? 'high' : 'low',
                kind: 'stockout',
                title: `Stockout: ${lote.producto}`,
                text: calc.utilidad >= 0
                    ? (hadDemand ? 'Sin piezas y hubo demanda — recompra o pausa Ads.' : 'Candidato a recompra si sigue la demanda.')
                    : 'No recomprar (utilidad negativa).',
                lote, calc,
            };
        },
    ];

    function analyze() {
        const agg = Calc.aggregate(window.State.lotes, window.State.settings);
        const alerts = [];
        for (const { lote, calc } of agg.rows) {
            for (const rule of RULES) {
                try {
                    const alert = rule({ lote, calc, agg, settings: window.State.settings });
                    if (alert) alerts.push(alert);
                } catch (e) { console.error('Rule failed:', e); }
            }
        }
        alerts.sort((a, b) => {
            const order = { high: 0, medium: 1, low: 2 };
            return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
        });
        return { alerts, agg };
    }

    function render() {
        const root = document.getElementById('view-insights');
        if (!root) return;

        const lotes = window.State.lotes || [];
        const { agg } = analyze();
        const ctx = { agg, rows: agg.rows, lotes };

        const momo = buildMoMo(lotes);
        root.innerHTML = `
            <div class="ins-shell">
                <div class="ins-body ins-body-combined">
                    ${lotes.length ? `
                        <section class="ins-section">
                            <h2 class="ins-section-title">Este mes vs el pasado</h2>
                            ${layMoMo(momo)}
                        </section>
                        <section class="ins-section">
                            <h2 class="ins-section-title">Matriz</h2>
                            ${layMatriz(ctx)}
                        </section>
                        <section class="ins-section">
                            <h2 class="ins-section-title">Comprar</h2>
                            ${layComprar(ctx)}
                        </section>
                        <section class="ins-section">
                            <h2 class="ins-section-title">Estancados</h2>
                            ${layEstancados(ctx)}
                        </section>
                        <section class="ins-section">
                            <h2 class="ins-section-title">Precios</h2>
                            ${layPrecios(ctx)}
                        </section>
                    ` : emptyState()}
                </div>
            </div>
        `;
        bind(root);
    }

    /**
     * Comparativo mes/mes usando ventas fechadas. Compara:
     *  - Mes actual completo (a día de hoy) vs mes anterior completo.
     *  - Mes actual acumulado (día 1..hoy) vs mismo tramo del mes anterior
     *    (día 1..min(hoy, últimoDía)) — es el número justo para saber
     *    si vamos mejor o peor con datos comparables.
     */
    function buildMoMo(lotes) {
        const now = new Date();
        const yThis = now.getFullYear();
        const mThis = now.getMonth();
        const startThis = new Date(yThis, mThis, 1);
        const dayNow = now.getDate();
        const prev = new Date(yThis, mThis - 1, 1);
        const yPrev = prev.getFullYear();
        const mPrev = prev.getMonth();
        const startPrev = new Date(yPrev, mPrev, 1);
        const daysPrev = new Date(yPrev, mPrev + 1, 0).getDate();
        const cutPrev = new Date(yPrev, mPrev, Math.min(dayNow, daysPrev), 23, 59, 59, 999);

        const empty = () => ({ cashIn: 0, ganancia: 0, uds: 0, ventas: 0 });
        const thisFull = empty();
        const thisMtd = empty();
        const prevFull = empty();
        const prevMtd = empty();

        const settings = window.State.settings;
        (lotes || []).forEach(lote => {
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            ventas.forEach(v => {
                const d = parseDate(v.fecha);
                if (!d) return;
                const uds = Math.max(0, Number(v.unidades) || 0);
                if (uds <= 0) return;
                const precio = Number(v.precio) || 0;
                const util = Calc.utilidadAtPrice(loteCostAtSale(lote, v), precio, settings).utilidad;
                const bucket = (b) => {
                    b.cashIn += precio * uds;
                    b.ganancia += util * uds;
                    b.uds += uds;
                    b.ventas += 1;
                };
                if (d >= startThis) {
                    bucket(thisFull);
                    bucket(thisMtd);
                } else if (d >= startPrev) {
                    bucket(prevFull);
                    if (d <= cutPrev) bucket(prevMtd);
                }
            });
        });
        return {
            monthLabelThis: startThis.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
            monthLabelPrev: startPrev.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
            dayNow,
            daysPrev,
            thisMtd, prevMtd,
            thisFull, prevFull,
        };
    }

    /** Costo unitario histórico (si la venta lo tiene) o el actual del lote. */
    function loteCostAtSale(lote, v) {
        const costoAtSale = Number(v.costoAtSale);
        if (Number.isFinite(costoAtSale) && costoAtSale > 0) {
            return { ...lote, costo: costoAtSale };
        }
        return lote;
    }

    function parseDate(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function layMoMo(m) {
        if (!m) return '';
        const noPrev = m.prevMtd.uds === 0 && m.prevFull.uds === 0;
        const cards = [
            momCard('Cash in', m.thisMtd.cashIn, m.prevMtd.cashIn, Calc.fmtMXN, m),
            momCard('Utilidad', m.thisMtd.ganancia, m.prevMtd.ganancia, Calc.fmtMXN, m),
            momCard('Unidades', m.thisMtd.uds, m.prevMtd.uds, (n) => `${Math.round(n)} ud`, m),
            momCard('Ventas', m.thisMtd.ventas, m.prevMtd.ventas, (n) => `${Math.round(n)}`, m),
        ].join('');
        const totals = noPrev
            ? '<p class="muted small ins-note">Sin ventas registradas el mes pasado — cuando acumules historia aparecerá el comparativo real.</p>'
            : `<p class="muted small ins-note">
                    Mes actual (día ${m.dayNow}) vs mismo tramo del mes pasado (día 1 al ${Math.min(m.dayNow, m.daysPrev)}).
                    Mes pasado completo: <strong>${Calc.fmtMXN(m.prevFull.cashIn)}</strong> cash in ·
                    <strong>${Calc.fmtMXN(m.prevFull.ganancia)}</strong> utilidad ·
                    <strong>${Math.round(m.prevFull.uds)}</strong> ud.
                </p>`;
        return `
            <div class="ins-kpis ins-momom">${cards}</div>
            ${totals}
        `;
    }

    function momCard(label, cur, prev, fmt, m) {
        const delta = cur - prev;
        const pct = prev > 0 ? (delta / prev) * 100 : (cur > 0 ? 100 : 0);
        const tone = delta > 0.0001 ? 'pos' : (delta < -0.0001 ? 'neg' : '');
        const sign = delta > 0 ? '+' : '';
        const arrow = delta > 0.0001 ? '▲' : (delta < -0.0001 ? '▼' : '·');
        const prevLabel = m.monthLabelPrev.split(' ')[0];
        const sub = prev <= 0
            ? `vs ${prevLabel}: —`
            : `vs ${prevLabel}: ${fmt(prev)}`;
        const deltaTxt = prev > 0
            ? `${arrow} ${sign}${pct.toFixed(1)}%`
            : (cur > 0 ? '▲ nuevo' : '· sin dato');
        return `
            <div class="ins-kpi ins-mom-card">
                <div class="ins-kpi-label">${esc(label)}</div>
                <div class="ins-kpi-value">${fmt(cur)}</div>
                <div class="ins-kpi-sub ins-mom-delta ${tone}">${deltaTxt}</div>
                <div class="ins-kpi-sub muted small">${sub}</div>
            </div>`;
    }

    function layMatriz({ rows }) {
        const active = rows.filter(r => !['PAUSADA', 'FINALIZADA'].includes(r.calc.estrategia));
        const medM = median(active.map(r => r.calc.margen));
        const medR = median(active.map(r => r.calc.rotacion));
        const quad = { estrellas: [], vacas: [], interrogantes: [], perros: [] };
        active.forEach(r => {
            const hiM = r.calc.margen >= medM;
            // Si la mediana de rotación es 0, solo cuenta como “alta” quien ya vendió
            const hiR = medR <= 0 ? r.calc.rotacion > 0 : r.calc.rotacion >= medR;
            if (hiM && hiR) quad.estrellas.push(r);
            else if (hiM && !hiR) quad.vacas.push(r);
            else if (!hiM && hiR) quad.interrogantes.push(r);
            else quad.perros.push(r);
        });
        return `
            <div class="ins-kpis">
                ${kpi('Estrellas', quad.estrellas.length, 'pos', 'Alto margen + alta rotación')}
                ${kpi('Vacas', quad.vacas.length, '', 'Margen alto, rota poco')}
                ${kpi('Interrogantes', quad.interrogantes.length, '', 'Rota, margen flojo')}
                ${kpi('Perros', quad.perros.length, quad.perros.length ? 'neg' : '', 'Bajo margen + lenta')}
            </div>
            <div class="ins-quad">
                ${quadCard('Estrellas — empujar', quad.estrellas, 'good')}
                ${quadCard('Vacas — activar rotación', quad.vacas, '')}
                ${quadCard('Interrogantes — subir margen', quad.interrogantes, '')}
                ${quadCard('Perros — liquidar / pausar', quad.perros, 'bad')}
            </div>
            <p class="muted small ins-note">Corte en mediana del catálogo (margen ${Calc.fmtPct(medM)} · rotación ${Math.round(medR * 100)}%).</p>
        `;
    }

    function quadCard(title, list, cls) {
        return `
            <div class="ins-panel ${cls}">
                <h3>${esc(title)} <span class="muted">${list.length}</span></h3>
                ${list.slice(0, 6).map(r => `
                    <button type="button" class="ins-row" data-ins-lote="${esc(r.lote.id)}">
                        <span>${esc(short(r.lote.producto, 28))}</span>
                        <span class="num">${Calc.fmtPct(r.calc.margen)} · ${Math.round(r.calc.rotacion * 100)}%</span>
                    </button>
                `).join('') || '<p class="muted small">Vacío</p>'}
            </div>`;
    }

    function layComprar({ rows }) {
        const yes = rows
            .filter(r =>
                (r.calc.estrategia === 'ESCALAR' || r.calc.estrategia === 'AGOTADO') &&
                r.calc.utilidad > 0 &&
                r.calc.margen >= 0.12
            )
            .sort((a, b) => b.calc.utilidad - a.calc.utilidad);
        const no = rows
            .filter(r =>
                r.calc.estrategia === 'LIQUIDAR' ||
                r.calc.utilidad < 0 ||
                (r.calc.inventarioRestante > 0 && r.calc.vendidas === 0 && diasSinVenta(r.lote) >= 45)
            )
            .sort((a, b) => a.calc.utilidad - b.calc.utilidad);
        return `
            <div class="ins-split">
                <div class="ins-panel good">
                    <h3>Sí reponer / comprar</h3>
                    ${table(yes.slice(0, 12), [
                        ['Producto', r => name(r)],
                        ['Estado', r => esc(r.calc.estrategia)],
                        ['Utilidad', r => Calc.fmtMXN(r.calc.utilidad), 'num'],
                        ['Margen', r => Calc.fmtPct(r.calc.margen), 'num'],
                    ], 'Ningún candidato claro')}
                </div>
                <div class="ins-panel bad">
                    <h3>No comprar más</h3>
                    ${table(no.slice(0, 12), [
                        ['Producto', r => name(r)],
                        ['Estado', r => esc(r.calc.estrategia)],
                        ['Utilidad', r => Calc.fmtMXN(r.calc.utilidad), 'num'],
                        ['Stock', r => r.calc.inventarioRestante, 'num'],
                    ], 'Sin vetos — catálogo limpio')}
                </div>
            </div>
        `;
    }

    function layEstancados({ rows }) {
        const list = rows
            .filter(r => r.calc.inventarioRestante > 0)
            .map(r => ({ ...r, dias: diasSinVenta(r.lote) }))
            .sort((a, b) => {
                if (a.calc.rotacion !== b.calc.rotacion) return a.calc.rotacion - b.calc.rotacion;
                return b.calc.valorInventario - a.calc.valorInventario;
            });
        const trapped = list.reduce((s, r) => s + r.calc.valorInventario, 0);
        const dead = list.filter(r => r.dias >= 30 || r.calc.vendidas === 0);
        return `
            <div class="ins-kpis">
                ${kpi('$ atrapado', Calc.fmtMXN(trapped), trapped ? 'neg' : '', 'Con stock')}
                ${kpi('Sin movimiento', dead.length, dead.length ? 'neg' : '', '0 ventas o ≥30 días')}
            </div>
            <div class="ins-panel">
                <h3>Rotación lenta → capital dormido</h3>
                ${table(list.slice(0, 15), [
                    ['Producto', r => name(r)],
                    ['Stock', r => r.calc.inventarioRestante, 'num'],
                    ['Rotación', r => Math.round(r.calc.rotacion * 100) + '%', 'num'],
                    ['Días', r => r.dias == null ? '—' : r.dias, 'num'],
                    ['$ stock', r => Calc.fmtMXN(r.calc.valorInventario), 'num'],
                ])}
            </div>
        `;
    }

    function layPrecios({ rows }) {
        const withComp = rows
            .filter(r => r.lote.precioCompetencia > 0)
            .map(r => {
                const diff = r.lote.precio / r.lote.precioCompetencia - 1;
                return { ...r, diff };
            })
            .sort((a, b) => b.diff - a.diff);
        const caro = withComp.filter(r => r.diff >= 0.10);
        const barato = withComp.filter(r => r.diff <= -0.05);
        return `
            <div class="ins-kpis">
                ${kpi('Con competencia', withComp.length, '', 'Tienen precio ref.')}
                ${kpi('Más caros ≥10%', caro.length, caro.length ? 'neg' : '', 'Riesgo de no convertir')}
                ${kpi('Más baratos', barato.length, 'pos', 'Posible margen a recuperar')}
            </div>
            <div class="ins-panel">
                <h3>Gap de precio</h3>
                ${table(withComp, [
                    ['Producto', r => name(r)],
                    ['Tu precio', r => Calc.fmtMXN(r.lote.precio), 'num'],
                    ['Competencia', r => Calc.fmtMXN(r.lote.precioCompetencia), 'num'],
                    ['Gap', r => (r.diff >= 0 ? '+' : '') + (r.diff * 100).toFixed(0) + '%', 'num'],
                    ['Estrategia', r => esc(r.calc.estrategia)],
                ], 'Carga precio competencia en el lote para ver gaps')}
            </div>
        `;
    }

    function emptyState() {
        return `
            <div class="ins-empty">
                <h2>Sin lotes aún</h2>
                <p class="muted">Cuando tengas productos, aquí verás matriz, compras, estancados y precios.</p>
                <button type="button" class="btn primary" data-ins-new>+ Nuevo lote</button>
            </div>`;
    }

    function table(rows, cols, emptyMsg) {
        if (!rows.length) return `<p class="muted small">${esc(emptyMsg || 'Sin datos')}</p>`;
        return `
            <table class="ins-table">
                <thead><tr>${cols.map(c => `<th class="${c[2] === 'num' ? 'num' : ''}">${esc(c[0])}</th>`).join('')}</tr></thead>
                <tbody>
                    ${rows.map(r => `
                        <tr data-ins-lote="${esc(r.lote.id)}" class="is-click">
                            ${cols.map(c => {
                                const v = c[1](r);
                                return `<td class="${c[2] === 'num' ? 'num' : ''}">${typeof v === 'number' ? v : v}</td>`;
                            }).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }

    function kpi(label, value, t, sub) {
        return `
            <div class="ins-kpi">
                <div class="ins-kpi-label">${esc(label)}</div>
                <div class="ins-kpi-value ${t || ''}">${value}</div>
                ${sub ? `<div class="ins-kpi-sub">${esc(sub)}</div>` : ''}
            </div>`;
    }

    function name(r) {
        return esc(short(r.lote.producto + (r.lote.variante ? ' · ' + r.lote.variante : ''), 36));
    }

    function diasSinVenta(lote) {
        const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
        let last = null;
        if (ventas.length) {
            last = new Date(ventas[ventas.length - 1].fecha);
        } else if (lote.fecha) {
            last = new Date(lote.fecha);
        }
        if (!last || isNaN(last)) return null;
        return Math.floor((Date.now() - last.getTime()) / 86400000);
    }

    function median(arr) {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
        root.querySelectorAll('[data-ins-new]').forEach(btn => {
            btn.addEventListener('click', () => {
                window.App?.switchTab('lotes');
                LotesView.openModal(null);
            });
        });
        root.querySelectorAll('[data-ins-lote]').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.insLote;
                if (id && window.LotesView?.selectAndGo) LotesView.selectAndGo(id);
            });
        });
    }

    function alertCount() {
        return analyze().alerts.filter(a => a.severity === 'high' || a.severity === 'medium').length;
    }

    function init() {
        window.State.subscribe(() => {
            if (window.State.view === 'insights') render();
        });
    }

    return { init, render, analyze, alertCount };
})();
window.InsightsView = InsightsView;
