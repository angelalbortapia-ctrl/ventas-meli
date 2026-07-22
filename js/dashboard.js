/* ==========================================================================
   Dashboard / Inicio — briefing matutino del negocio.
   Visual: hero teatral, dinero tipográfico, hoy con peso, capital atrapado.
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
        const focusAll = alerts;
        const focus = focusAll.slice(0, 3);
        const moreCount = Math.max(0, focusAll.length - 3);

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
                const rot = a.calc.rotacion - b.calc.rotacion;
                if (Math.abs(rot) > 0.001) return rot;
                return b.calc.valorInventario - a.calc.valorInventario;
            })
            .slice(0, 5);

        const trappedTotal = trapped.reduce((s, r) => s + r.calc.valorInventario, 0);
        const trappedPct = agg.valorInventario > 0
            ? Math.round((trappedTotal / agg.valorInventario) * 100)
            : 0;

        const top = [...agg.rows]
            .filter(r => r.calc.utilidad > 0)
            .sort((a, b) => b.calc.utilidad - a.calc.utilidad)
            .slice(0, 3);

        const ganTone = gananciaTone(agg.gananciaRealizada);
        const dateLbl = new Intl.DateTimeFormat('es-MX', {
            weekday: 'long', day: 'numeric', month: 'long',
        }).format(new Date());

        const insightsLink = high.length
            ? `${high.length} urgente${high.length === 1 ? '' : 's'}`
            : 'Insights';

        root.innerHTML = `
            <section class="dash-hero dash-anim">
                <div class="dash-hero-top">
                    <div class="dash-hero-brand">Ventas Meli</div>
                    <p class="dash-hero-date">${esc(dateLbl)}</p>
                </div>
                <p class="dash-hero-label">Ganancia realizada</p>
                <div class="dash-hero-value ${ganTone}">${Calc.fmtMXN(agg.gananciaRealizada)}</div>
                <p class="dash-hero-sub">
                    Cash in ${Calc.fmtMXN(agg.cashIn)} · ${agg.totalVendidas} uds ·
                    margen ${Calc.fmtPct(agg.margenPonderado)}
                </p>
                <div class="dash-hero-actions">
                    <button type="button" class="btn primary" data-dash-go="lotes">Ver productos</button>
                    <button type="button" class="dash-text-link" data-dash-go="insights">${esc(insightsLink)}</button>
                </div>
            </section>

            <section class="dash-money" aria-label="Dinero en juego">
                <div class="dash-money-item dash-money-emph">
                    <span class="dash-money-label">Capital</span>
                    <span class="dash-money-value">${Calc.fmtMXN(agg.capitalDesplegado)}</span>
                </div>
                <div class="dash-money-item dash-money-emph">
                    <span class="dash-money-label">Inventario</span>
                    <span class="dash-money-value">${Calc.fmtMXN(agg.valorInventario)}</span>
                </div>
                <div class="dash-money-item">
                    <span class="dash-money-label">Cash in</span>
                    <span class="dash-money-value">${Calc.fmtMXN(agg.cashIn)}</span>
                </div>
                <div class="dash-money-item">
                    <span class="dash-money-label">Activos</span>
                    <span class="dash-money-value">${activeLots}</span>
                    <span class="dash-money-hint">${escN}↑ ${liqN}↓</span>
                </div>
            </section>

            <section class="dash-today dash-anim-delay">
                <div class="dash-section-head dash-section-head-row">
                    <div>
                        <h3>Qué hacer hoy</h3>
                        <p class="muted small">${
                            focus.length
                                ? 'Tres decisiones que mueven capital · toca el lote'
                                : 'Sin alertas urgentes'
                        }</p>
                    </div>
                </div>
                ${focus.length ? `
                    <ul class="dash-actions">
                        ${focus.map(a => actionRow(a)).join('')}
                    </ul>
                    ${moreCount ? `
                        <button type="button" class="dash-more-link" data-dash-go="insights">
                            Ver ${moreCount} más
                        </button>
                    ` : ''}
                ` : `
                    <div class="dash-empty dash-empty-ok">
                        <p><strong>Todo en orden por ahora.</strong></p>
                        <p class="muted small">Revisa capital atrapado abajo o registra una venta.</p>
                        <button type="button" class="dash-text-link dash-text-link-dark" data-dash-go="lotes">Ir a productos</button>
                    </div>
                `}
            </section>

            <section class="dash-pulse">
                <div class="dash-section-head dash-section-head-inline">
                    <h3>Portafolio</h3>
                    <div class="dash-pulse-legend">
                        ${leg('esc', 'Escalar', escN)}
                        ${leg('man', 'Mantener', manN)}
                        ${leg('liq', 'Liquidar', liqN)}
                        ${leg('ago', 'Agotado', agoN)}
                    </div>
                </div>
                <div class="dash-pulse-track" role="img" aria-label="Distribución de portafolio">
                    ${pulseSeg('esc', escN, agg.rows.length)}
                    ${pulseSeg('man', manN, agg.rows.length)}
                    ${pulseSeg('liq', liqN, agg.rows.length)}
                    ${pulseSeg('ago', agoN, agg.rows.length)}
                </div>
            </section>

            <section class="dash-trapped">
                <div class="dash-section-head">
                    <h3>Capital atrapado</h3>
                    <p class="muted small">
                        ${Calc.fmtMXN(trappedTotal)} en rotación lenta
                        ${agg.valorInventario > 0 ? ` · <strong>${trappedPct}%</strong> del inventario` : ''}
                    </p>
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
                        <li class="dash-empty">Sin inventario pendiente.</li>
                    `}
                </ul>
            </section>

            ${top.length ? `
            <section class="dash-tops">
                <span class="dash-tops-label">Mejores</span>
                <div class="dash-tops-line">
                    ${top.map(({ lote, calc }, i) => `
                        <button type="button" class="dash-tops-chip" data-dash-lote="${esc(lote.id)}">
                            <span class="dash-tops-n">${i + 1}</span>
                            ${esc(lote.producto)}
                            <span class="dash-tops-val">${Calc.fmtMXN(calc.utilidad)}</span>
                        </button>
                    `).join('<span class="dash-tops-sep">·</span>')}
                </div>
            </section>
            ` : ''}
        `;

        bind(root);
        requestAnimationFrame(() => root.classList.add('dash-ready'));
    }

    function gananciaTone(n) {
        if (!Number.isFinite(n) || Math.abs(n) < 1) return 'flat';
        return n > 0 ? 'pos' : 'neg';
    }

    function emptyOnboarding() {
        return `
            <section class="dash-hero dash-hero-empty dash-anim">
                <div class="dash-hero-brand">Ventas Meli</div>
                <p class="dash-hero-label">Tu cockpit de lotes</p>
                <div class="dash-hero-value flat">Empieza aquí</div>
                <p class="dash-hero-sub">
                    Registra tu primer lote o importa un Excel para ver ganancia,
                    capital atrapado y qué hacer hoy.
                </p>
                <div class="dash-hero-actions">
                    <button type="button" class="btn primary" data-dash-new>+ Nuevo lote</button>
                    <button type="button" class="dash-text-link" data-dash-import>Importar Excel</button>
                </div>
            </section>
            <section class="dash-onboard">
                <h3>Qué verás en Inicio</h3>
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
        const short = shortActionText(a);
        return `
            <li class="dash-action sev-${a.severity}" data-dash-lote="${esc(a.lote?.id || '')}">
                <div class="dash-action-body">
                    <div class="dash-action-title">${esc(a.title)}</div>
                    <div class="dash-action-text">${esc(short)}</div>
                    <div class="dash-action-cue">${esc(cue)} →</div>
                </div>
            </li>`;
    }

    function shortActionText(a) {
        const plain = stripHtmlPlain(a.text);
        if (plain.length <= 96) return plain;
        return plain.slice(0, 93).trimEnd() + '…';
    }

    function stripHtmlPlain(html) {
        const d = document.createElement('div');
        d.innerHTML = html || '';
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
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
        root.classList.remove('dash-ready');
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
