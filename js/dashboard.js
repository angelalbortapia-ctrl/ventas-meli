/* ==========================================================================
   Dashboard / Inicio — carta de presentación del negocio.
   Jerarquía: resultado → exposición → acción de hoy → pulso → capital
   atrapado → tops (secundario). Sin tablas densas.
   ========================================================================== */

const DashboardView = (() => {

    const ACTION_CUE = {
        restock: 'Recompra ya',
        liquidate: 'Baja precio o remata',
        stagnant: 'Revisa listing o pausa',
        pricing: 'Ajusta precio',
        opportunity: 'Sube Ads con tope',
        ads: 'Baja puja o pausa Ads',
        agotado: 'Evalúa recompra',
    };

    function render() {
        const root = document.getElementById('dashboard-canvas');
        if (!root) return;

        const lotes = window.State.lotes || [];
        if (!lotes.length) {
            root.innerHTML = emptyOnboarding();
            bind(root);
            return;
        }

        const agg = Calc.aggregate(lotes, window.State.settings);
        const { alerts } = InsightsView.analyze();
        const high = alerts.filter(a => a.severity === 'high');
        const focus = alerts.slice(0, 5);

        const escN = agg.strategyCount.ESCALAR || 0;
        const manN = agg.strategyCount.MANTENER || 0;
        const liqN = agg.strategyCount.LIQUIDAR || 0;
        const agoN = agg.strategyCount.AGOTADO || 0;
        const activeLots = agg.rows.filter(r =>
            !['PAUSADA', 'FINALIZADA'].includes(r.calc.estrategia)
        ).length;

        const trapped = [...agg.rows]
            .filter(r => r.calc.inventarioRestante > 0)
            .sort((a, b) => {
                // Primero poca rotación; desempate por $ atrapado
                const rot = a.calc.rotacion - b.calc.rotacion;
                if (Math.abs(rot) > 0.001) return rot;
                return b.calc.valorInventario - a.calc.valorInventario;
            })
            .slice(0, 5);

        const trappedTotal = trapped.reduce((s, r) => s + r.calc.valorInventario, 0);

        const top = [...agg.rows]
            .filter(r => r.calc.utilidad > 0)
            .sort((a, b) => b.calc.utilidad - a.calc.utilidad)
            .slice(0, 3);

        const ganTone = agg.gananciaRealizada >= 0 ? 'pos' : 'neg';
        const dateLbl = new Intl.DateTimeFormat('es-MX', {
            weekday: 'long', day: 'numeric', month: 'long',
        }).format(new Date());

        root.innerHTML = `
            <section class="dash-hero">
                <div class="dash-hero-brand">Ventas Meli</div>
                <p class="dash-hero-date">${esc(dateLbl)}</p>
                <p class="dash-hero-label">Ganancia realizada</p>
                <div class="dash-hero-value ${ganTone}">${Calc.fmtMXN(agg.gananciaRealizada)}</div>
                <p class="dash-hero-sub">
                    Cash in ${Calc.fmtMXN(agg.cashIn)} · ${agg.totalVendidas} uds vendidas ·
                    margen lista ${Calc.fmtPct(agg.margenPonderado)}
                </p>
                <div class="dash-hero-actions">
                    <button type="button" class="btn primary" data-dash-go="lotes">Ver productos</button>
                    <button type="button" class="btn" data-dash-new>+ Nuevo lote</button>
                    ${high.length ? `
                        <button type="button" class="btn" data-dash-go="insights">
                            ${high.length} urgentes
                        </button>
                    ` : `
                        <button type="button" class="btn" data-dash-go="insights">Insights</button>
                    `}
                </div>
            </section>

            <section class="dash-strip" aria-label="Dinero en juego">
                ${stat('Capital desplegado', Calc.fmtMXN(agg.capitalDesplegado), `${agg.rows.length} lotes · ${agg.totalUds} uds`)}
                ${stat('Inventario', Calc.fmtMXN(agg.valorInventario), 'capital en stock')}
                ${stat('Cash in', Calc.fmtMXN(agg.cashIn), 'ventas cobradas')}
                ${stat('Activos', String(activeLots), `${escN} escalar · ${liqN} liquidar`)}
            </section>

            <section class="dash-panel dash-today">
                <div class="dash-section-head dash-section-head-row">
                    <div>
                        <h3>Qué hacer hoy</h3>
                        <p class="muted small">${
                            focus.length
                                ? `${focus.length} prioridad${focus.length === 1 ? '' : 'es'} · toca para abrir el lote`
                                : 'Sin alertas urgentes'
                        }</p>
                    </div>
                    ${alerts.length > 5 ? `
                        <button type="button" class="btn btn-sm" data-dash-go="insights">Ver todas</button>
                    ` : ''}
                </div>
                ${focus.length ? `
                    <ul class="dash-actions">
                        ${focus.map(a => actionRow(a)).join('')}
                    </ul>
                ` : `
                    <div class="dash-empty dash-empty-ok">
                        <p><strong>Todo en orden por ahora.</strong></p>
                        <p class="muted small">Registra una venta o revisa rotación abajo para liberar capital.</p>
                        <div class="dash-empty-actions">
                            <button type="button" class="btn primary btn-sm" data-dash-go="lotes">Ir a productos</button>
                        </div>
                    </div>
                `}
            </section>

            <section class="dash-pulse">
                <div class="dash-section-head">
                    <h3>Pulso de estrategia</h3>
                    <p class="muted small">Cómo está tu portafolio</p>
                </div>
                <div class="dash-pulse-track" role="img" aria-label="Distribución de estrategia">
                    ${pulseSeg('esc', escN, agg.rows.length)}
                    ${pulseSeg('man', manN, agg.rows.length)}
                    ${pulseSeg('liq', liqN, agg.rows.length)}
                    ${pulseSeg('ago', agoN, agg.rows.length)}
                </div>
                <div class="dash-pulse-legend">
                    ${leg('esc', 'Escalar', escN)}
                    ${leg('man', 'Mantener', manN)}
                    ${leg('liq', 'Liquidar', liqN)}
                    ${leg('ago', 'Agotado', agoN)}
                </div>
            </section>

            <section class="dash-panel dash-trapped">
                <div class="dash-section-head dash-section-head-row">
                    <div>
                        <h3>Capital atrapado</h3>
                        <p class="muted small">Stock que menos rota · ${Calc.fmtMXN(trappedTotal)} en estos SKUs</p>
                    </div>
                </div>
                <ul class="dash-rot">
                    ${trapped.length ? trapped.map(({ lote, calc }) => {
                        const pct = Math.round(Math.min(100, calc.rotacion * 100));
                        return `
                        <li class="dash-rot-row" data-dash-lote="${esc(lote.id)}">
                            <div class="dash-rot-top">
                                <span class="dash-rot-name">${esc(lote.producto)}${lote.variante ? ` · ${esc(lote.variante)}` : ''}</span>
                                <span class="dash-rot-money">${Calc.fmtMXN(calc.valorInventario)}</span>
                            </div>
                            <div class="dash-rot-bar"><div class="dash-rot-fill" style="width:${pct}%"></div></div>
                            <div class="dash-rot-meta">
                                ${calc.inventarioRestante} uds · rotación ${pct}% · ${diagnostico(lote, calc)}
                            </div>
                        </li>`;
                    }).join('') : `
                        <li class="dash-empty">Sin inventario pendiente — todo vendido o sin stock.</li>
                    `}
                </ul>
            </section>

            ${top.length ? `
            <section class="dash-panel dash-tops">
                <div class="dash-section-head">
                    <h3>Más rentables</h3>
                    <p class="muted small">Utilidad neta por unidad · top 3</p>
                </div>
                <ul class="dash-rank">
                    ${top.map(({ lote, calc }, i) => `
                        <li class="dash-rank-row" data-dash-lote="${esc(lote.id)}">
                            <span class="dash-rank-n">${i + 1}</span>
                            <div class="dash-rank-body">
                                <div class="dash-rank-name">${esc(lote.producto)}</div>
                                <div class="dash-rank-meta">${esc(lote.variante || lote.sku || '—')}</div>
                            </div>
                            <div class="dash-rank-nums">
                                <div class="pos">${Calc.fmtMXN(calc.utilidad)}</div>
                                <div class="muted small">${Calc.fmtPct(calc.margen)}</div>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </section>
            ` : ''}
        `;

        bind(root);
    }

    function emptyOnboarding() {
        return `
            <section class="dash-hero dash-hero-empty">
                <div class="dash-hero-brand">Ventas Meli</div>
                <p class="dash-hero-label">Tu cockpit de lotes</p>
                <div class="dash-hero-value">Empieza aquí</div>
                <p class="dash-hero-sub">
                    Registra tu primer lote o importa un Excel para ver ganancia,
                    capital atrapado y qué hacer hoy.
                </p>
                <div class="dash-hero-actions">
                    <button type="button" class="btn primary" data-dash-new>+ Nuevo lote</button>
                    <button type="button" class="btn" data-dash-import>Importar Excel</button>
                </div>
            </section>
            <section class="dash-panel">
                <div class="dash-section-head">
                    <h3>Qué verás en Inicio</h3>
                    <p class="muted small">Cuando tengas datos, esta pestaña responde en 10 segundos</p>
                </div>
                <ul class="dash-onboard-list">
                    <li><strong>Ganancia realizada</strong> — si el negocio va bien o mal</li>
                    <li><strong>Dinero en juego</strong> — capital, inventario y cash in</li>
                    <li><strong>Qué hacer hoy</strong> — recompras, remates y Ads</li>
                    <li><strong>Capital atrapado</strong> — stock que no rota</li>
                </ul>
            </section>
        `;
    }

    function actionRow(a) {
        const cue = ACTION_CUE[a.kind] || 'Revisar';
        const sevLbl = a.severity === 'high' ? 'Alta' : a.severity === 'medium' ? 'Media' : 'Idea';
        const short = shortActionText(a);
        return `
            <li class="dash-action sev-${a.severity}" data-dash-lote="${esc(a.lote?.id || '')}">
                <span class="dash-action-sev">${sevLbl}</span>
                <div class="dash-action-body">
                    <div class="dash-action-title">${esc(a.title)}</div>
                    <div class="dash-action-text">${esc(short)}</div>
                    <div class="dash-action-cue">${esc(cue)} →</div>
                </div>
            </li>`;
    }

    function shortActionText(a) {
        const plain = stripHtmlPlain(a.text);
        if (plain.length <= 110) return plain;
        return plain.slice(0, 107).trimEnd() + '…';
    }

    function stripHtmlPlain(html) {
        const d = document.createElement('div');
        d.innerHTML = html || '';
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function stat(label, value, sub) {
        return `
            <div class="dash-stat">
                <div class="dash-stat-label">${label}</div>
                <div class="dash-stat-value">${value}</div>
                <div class="dash-stat-sub">${sub}</div>
            </div>`;
    }

    function pulseSeg(cls, n, total) {
        if (!total || !n) return '';
        const w = (n / total) * 100;
        return `<div class="dash-pulse-seg ${cls}" style="width:${w}%" title="${n}"></div>`;
    }

    function leg(cls, label, n) {
        return `<span class="dash-leg"><i class="dash-leg-dot ${cls}"></i>${label} <strong>${n}</strong></span>`;
    }

    function diagnostico(lote, calc) {
        const uds = Number(lote.unidades) || 0;
        const vendidas = Number(lote.vendidas) || 0;
        if (!uds) return '—';
        const pct = vendidas / uds;
        if (vendidas === 0) return 'Sin ventas';
        if (pct >= 1) return 'Agotado';
        if (pct >= 0.7) return 'Vendiendo bien';
        if (pct >= 0.3) return 'Fluido';
        return 'Lenta';
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function bind(root) {
        root.querySelectorAll('[data-dash-go]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                window.App?.switchTab(btn.dataset.dashGo);
            });
        });
        root.querySelectorAll('[data-dash-new]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                window.App?.switchTab('lotes');
                LotesView.openModal(null);
            });
        });
        root.querySelectorAll('[data-dash-import]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                document.getElementById('btn-import')?.click();
            });
        });
        root.querySelectorAll('[data-dash-lote]').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.dashLote;
                if (!id || !window.LotesView?.selectAndGo) return;
                LotesView.selectAndGo(id);
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
