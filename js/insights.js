/* ==========================================================================
   Vista Insights: reglas automáticas sobre los lotes que generan
   recomendaciones accionables. Cada regla produce Alertas con severidad,
   título, descripción y (opcionalmente) una acción sugerida.
   ========================================================================== */

const InsightsView = (() => {

    // Cada regla recibe { lote, calc, agg, settings } y retorna un objeto
    // Alerta o null. Se corren en cascada; el mismo lote puede disparar varias.
    const RULES = [

        // 1. Escalar + stock crítico
        ({ lote, calc }) => {
            if (calc.estrategia !== 'ESCALAR') return null;
            if (calc.inventarioRestante > 2) return null;
            return {
                severity: 'high', kind: 'restock',
                title: `Recompra urgente: ${lote.producto}`,
                text: `Solo quedan <strong>${calc.inventarioRestante} uds</strong> de un producto ESCALAR con utilidad ${Calc.fmtMXN(calc.utilidad)}. Recompra mayoreo antes de perder tracción.`,
                lote,
            };
        },

        // 2. Liquidar con stock alto
        ({ lote, calc }) => {
            if (calc.estrategia !== 'LIQUIDAR') return null;
            if (calc.inventarioRestante < 3) return null;
            return {
                severity: 'high', kind: 'liquidate',
                title: `Rematar: ${lote.producto}`,
                text: `Utilidad negativa (<strong>${Calc.fmtMXN(calc.utilidad)}</strong>) con <strong>${calc.inventarioRestante} uds</strong> en stock. Considera bajar precio 10-15% para liberar capital.`,
                lote,
            };
        },

        // 3. Sin ventas 30+ días
        ({ lote, calc }) => {
            const fecha = lote.fecha ? new Date(lote.fecha) : null;
            if (!fecha) return null;
            const dias = Math.floor((Date.now() - fecha.getTime()) / (86400000));
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            if (ventas.length > 0) return null;
            if (dias < 30) return null;
            if (calc.inventarioRestante === 0) return null;
            return {
                severity: 'medium', kind: 'stagnant',
                title: `${lote.producto} lleva ${dias} días sin ventas`,
                text: `Considera revisar el título, agregar mejor fotografía o pausar. Precio actual ${Calc.fmtMXN(lote.precio)}.`,
                lote,
            };
        },

        // 4. Precio arriba de competencia +15%
        ({ lote }) => {
            if (!lote.precioCompetencia || lote.precioCompetencia <= 0) return null;
            const diff = lote.precio / lote.precioCompetencia - 1;
            if (diff < 0.15) return null;
            return {
                severity: 'medium', kind: 'pricing',
                title: `${lote.producto} está +${(diff * 100).toFixed(0)}% sobre competencia`,
                text: `Precio tuyo <strong>${Calc.fmtMXN(lote.precio)}</strong> vs competencia <strong>${Calc.fmtMXN(lote.precioCompetencia)}</strong>. Bajar puede acelerar ventas.`,
                lote,
            };
        },

        // 5. Escalar con margen premium (>30%)
        ({ lote, calc }) => {
            if (calc.estrategia !== 'ESCALAR') return null;
            if (calc.margen < 0.30) return null;
            if (calc.inventarioRestante === 0) return null;
            return {
                severity: 'low', kind: 'opportunity',
                title: `Oportunidad Premium: ${lote.producto}`,
                text: `Margen ${Calc.fmtPct(calc.margen)}. Excelente candidato para <strong>Ads agresivos</strong> y compra mayoreo. Tope CPA: ${Calc.fmtMXN(calc.topeCPA)}.`,
                lote,
            };
        },

        // 5b. Ads por arriba del tope CPA
        ({ lote, calc }) => {
            if (calc.adsStatus !== 'over' && calc.adsStatus !== 'near') return null;
            const sev = calc.adsStatus === 'over' ? 'high' : 'medium';
            return {
                severity: sev, kind: 'ads',
                title: `Ads ${calc.adsStatus === 'over' ? 'por arriba' : 'cerca'} del tope: ${lote.producto}`,
                text: `Gastaste <strong>${Calc.fmtMXN(calc.adsPorVenta)}</strong>/venta vs tope <strong>${Calc.fmtMXN(calc.topeCPA)}</strong> (total Ads ${Calc.fmtMXN(calc.gastoAds)}). Baja puja o pausa campaña.`,
                lote,
            };
        },

        // 6. Agotado (posible recompra)
        ({ lote, calc }) => {
            if (calc.estrategia !== 'AGOTADO') return null;
            return {
                severity: 'low', kind: 'agotado',
                title: `${lote.producto} está agotado`,
                text: `Se vendieron todas las unidades. ${calc.utilidad >= 0 ? 'Recompra si sigue rentable.' : 'No recomprar (utilidad negativa).'}`,
                lote,
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
            return order[a.severity] - order[b.severity];
        });
        return { alerts, agg };
    }

    function render() {
        const { alerts } = analyze();

        const summary = {
            high: alerts.filter(a => a.severity === 'high').length,
            medium: alerts.filter(a => a.severity === 'medium').length,
            low: alerts.filter(a => a.severity === 'low').length,
        };

        const summaryHTML = `
            <div class="stats-strip">
                <div class="stat">
                    <div class="stat-label"><span class="stat-icon">🚨</span>Alta prioridad</div>
                    <div class="stat-value ${summary.high > 0 ? 'neg' : ''}">${summary.high}</div>
                    <div class="stat-sub">Acción inmediata</div>
                </div>
                <div class="stat">
                    <div class="stat-label"><span class="stat-icon">⚠️</span>Media</div>
                    <div class="stat-value">${summary.medium}</div>
                    <div class="stat-sub">Revisar esta semana</div>
                </div>
                <div class="stat">
                    <div class="stat-label"><span class="stat-icon">💡</span>Oportunidades</div>
                    <div class="stat-value pos">${summary.low}</div>
                    <div class="stat-sub">Explorar</div>
                </div>
            </div>
        `;

        const list = alerts.length ? `
            <div class="insights-list">
                ${alerts.map(alertHTML).join('')}
            </div>
        ` : `
            <div class="card">
                <div style="text-align:center; padding:40px 20px; color: var(--text-muted)">
                    <div style="font-size:40px; margin-bottom:10px">✨</div>
                    <div><strong>Todo tranquilo por aquí.</strong></div>
                    <div class="small muted" style="margin-top:6px">No hay alertas activas. Sigue vendiendo.</div>
                </div>
            </div>
        `;

        document.getElementById('view-insights').innerHTML = `
            <div class="view-head">
                <div>
                    <h2>Insights & Alertas</h2>
                    <p class="muted">Recomendaciones automáticas según reglas de negocio y estado del inventario.</p>
                </div>
            </div>
            ${summaryHTML}
            ${list}
        `;

        document.querySelectorAll('.insight-goto').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.lote;
                LotesView.selectAndGo(id);
            });
        });
    }

    function alertHTML(alert) {
        const sevLabel = { high: 'Alta', medium: 'Media', low: 'Baja' };
        return `
            <div class="insight sev-${alert.severity}">
                <div class="insight-severity">${sevLabel[alert.severity]}</div>
                <div class="insight-body">
                    <div class="insight-title">${alert.title}</div>
                    <div class="insight-text">${alert.text}</div>
                </div>
                <div class="insight-actions">
                    <button class="btn insight-goto" data-lote="${alert.lote.id}">Ir al producto →</button>
                </div>
            </div>
        `;
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
