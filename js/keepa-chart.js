/* ==========================================================================
   KeepaChart — gráfica interactiva (historial + decisión de compra/venta).
   Usada en Keepa Lab y (compacta) en Productos.
   ========================================================================== */

const KeepaChart = (() => {
    /* Series = bandas del arcoíris iOS; el chrome del panel sigue minimal Apple. */
    const COLORS = {
        amazon: '#FF9F0A',
        new: '#0A84FF',
        bb: '#64D2FF',   /* azul clarito (antes verde iOS) */
        used: '#8E8E93',
        fba: '#BF5AF2',
        fbm: '#5E5CE6',
        salesrank: '#FF375F',
        ld: '#FFD60A',
        wd: '#40C8E0',
    };
    /* Serie B (VS ASIN): misma familia, tono más saturado / distinto */
    const COMPARE_COLORS = {
        amazon: '#E08900',
        new: '#64D2FF',
        bb: '#00C7BE',
        used: '#AEAEB2',
        fba: '#DA8FFF',
        fbm: '#7D7AFF',
        salesrank: '#FF6482',
        ld: '#FFD426',
        wd: '#70D7E7',
    };

    const LINE_KEYS = [
        ['amazon', 'Amazon'],
        ['new', 'Nuevo 3P'],
        ['bb', 'Buy Box'],
        ['used', 'Usado'],
        ['fba', 'FBA'],
        ['fbm', 'FBM'],
        ['salesrank', 'BSR'],
        ['ld', 'Lightning'],
        ['wd', 'Oferta semanal'],
    ];

    const RANGE_CHIPS = [
        [7, '7d'],
        [30, '30d'],
        [90, '90d'],
        [180, '6m'],
        [365, '1a'],
        [730, '2a'],
        [3650, 'Máx'],
    ];

    const PRESET_MIA = {
        amazon: false, new: false, bb: true, used: false,
        fba: false, fbm: false, salesrank: true, ld: false, wd: false,
        yzoom: true,
    };
    /* Comprar: cazar dip — BB + Nuevo + BSR */
    const PRESET_COMPRAR = {
        amazon: false, new: true, bb: true, used: false,
        fba: false, fbm: false, salesrank: true, ld: false, wd: false,
        yzoom: true,
    };
    /* Vender: fijar precio — BB + Amazon retail */
    const PRESET_VENDER = {
        amazon: true, new: false, bb: true, used: false,
        fba: false, fbm: false, salesrank: false, ld: false, wd: false,
        yzoom: true,
    };
    const PRESET_COMPETENCIA = {
        amazon: true, new: false, bb: true, used: false,
        fba: true, fbm: true, salesrank: true, ld: false, wd: false,
        yzoom: true,
    };

    /* true = referencia OCULTA */
    const MODE_HREF = {
        comprar: { costo: true, be: false, precio: true, avg90: false, alert: false, ventas: true },
        vender: { costo: false, be: false, precio: false, avg90: true, alert: true, ventas: false },
        competencia: { costo: true, be: true, precio: true, avg90: false, alert: true, ventas: true },
        mia: { costo: false, be: false, precio: false, avg90: false, alert: false, ventas: false },
    };

    const HREF_KEYS = [
        ['costo', 'Costo'],
        ['be', 'Break-even'],
        ['precio', 'Tu precio'],
        ['avg90', 'Avg 90d'],
        ['alert', 'Alerta'],
        ['ventas', 'Ventas mías'],
    ];

    const esc = v => (window.UI?.escapeHTML
        ? UI.escapeHTML(String(v ?? ''))
        : String(v ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[ch])));
    const mxn = v => (v == null || !Number.isFinite(Number(v))
        ? '—'
        : (window.Calc?.fmtMXN ? Calc.fmtMXN(v) : `$${Number(v).toFixed(2)}`));
    const pct = v => (v == null || !Number.isFinite(Number(v))
        ? '—'
        : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);

    function downsample(points, max = 420) {
        if (!Array.isArray(points) || points.length <= max) return points || [];
        const step = (points.length - 1) / (max - 1);
        const out = [];
        for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
        return out;
    }

    function filterByRange(points, rangeDays, brush) {
        let list = points || [];
        if (brush?.tMin != null && brush?.tMax != null) {
            list = list.filter(p => p.t >= brush.tMin && p.t <= brush.tMax);
        } else {
            const days = Math.max(1, Number(rangeDays) || 90);
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            list = list.filter(p => p.t >= cutoff);
        }
        return list;
    }

    function nearestPoint(points, t) {
        if (!points?.length) return null;
        let best = points[0];
        let bestDist = Math.abs(points[0].t - t);
        for (let i = 1; i < points.length; i++) {
            const d = Math.abs(points[i].t - t);
            if (d < bestDist) { best = points[i]; bestDist = d; }
        }
        return best;
    }

    function valueNear(points, t, windowMs = 36 * 3600 * 1000) {
        const pt = nearestPoint(points, t);
        if (!pt || Math.abs(pt.t - t) > windowMs) return null;
        return pt.v;
    }

    function breakEvenPrice(lote) {
        if (!lote || !window.Calc?.utilidadAtPrice) return null;
        const settings = window.State?.settings;
        const seed = Math.max(Number(lote.precio) || 0, Number(lote.costo) || 0, 50);
        let lo = 1;
        let hi = Math.max(seed * 4, 200);
        for (let i = 0; i < 28; i++) {
            const mid = (lo + hi) / 2;
            const u = Calc.utilidadAtPrice(lote, mid, settings).utilidad;
            if (u >= 0) hi = mid;
            else lo = mid;
        }
        return Number.isFinite(hi) ? hi : null;
    }

    function utilAt(lote, price) {
        if (!lote || price == null || !window.Calc?.utilidadAtPrice) return null;
        try {
            return Calc.utilidadAtPrice(lote, price, window.State?.settings);
        } catch {
            return null;
        }
    }

    function overlaysFromLote(lote) {
        if (!lote) return {};
        const ventas = (lote.ventas || [])
            .filter(v => v?.fecha)
            .map(v => {
                const t = Date.parse(String(v.fecha).length <= 10
                    ? `${v.fecha}T12:00:00`
                    : v.fecha);
                if (!Number.isFinite(t)) return null;
                return {
                    t,
                    precio: Number(v.precio) || 0,
                    unidades: Number(v.unidades) || 0,
                };
            })
            .filter(Boolean);
        return {
            costo: Number(lote.costo) || null,
            precio: Number(lote.precio) || null,
            breakEven: breakEvenPrice(lote),
            ventas,
            producto: lote.producto || '',
            asin: lote.asin || '',
            loteId: lote.id || '',
        };
    }

    function linkedLote(asin) {
        const code = String(asin || '').trim().toUpperCase();
        if (!code) return null;
        return (window.State?.lotes || []).find(l =>
            String(l.asin || '').trim().toUpperCase() === code
        ) || null;
    }

    function readAlert(asin) {
        const map = window.State?.ui?.keepaPriceAlerts;
        if (!map || typeof map !== 'object') return null;
        const row = map[String(asin || '').toUpperCase()];
        const below = Number(row?.below);
        return Number.isFinite(below) && below > 0 ? below : null;
    }

    function writeAlert(asin, below) {
        if (!window.State?.ui) return;
        const key = String(asin || '').toUpperCase();
        const prev = { ...(window.State.ui.keepaPriceAlerts || {}) };
        if (below == null || !(Number(below) > 0)) delete prev[key];
        else prev[key] = { below: Number(below), at: Date.now() };
        window.State.ui = { ...window.State.ui, keepaPriceAlerts: prev };
        const skip = window.__skipSync;
        window.__skipSync = true;
        try { window.State.saveUI?.(); }
        finally { window.__skipSync = skip; }
    }

    function buildSeries(data, graph, opts = {}) {
        const history = data?.history || {};
        const hidden = opts.hidden || {};
        const brush = opts.brush || null;
        const prefix = opts.prefix || '';
        const colorMap = opts.colorMap || null;
        return LINE_KEYS
            .filter(([key]) => {
                const hideKey = prefix ? prefix + key : key;
                return graph[key] && !hidden[hideKey] && history[key]?.points?.length;
            })
            .map(([key, label]) => {
                const raw = filterByRange(history[key].points, graph.range, brush);
                const palette = colorMap || COLORS;
                return {
                    key: prefix + key,
                    srcKey: key,
                    label: prefix ? `${label} · B` : label,
                    kind: history[key].kind || (key === 'salesrank' ? 'rank' : 'price'),
                    color: palette[key] || COLORS[key] || '#1d1d1f',
                    dashed: Boolean(prefix),
                    points: downsample(raw),
                };
            })
            .filter(s => s.points.length > 1);
    }

    function primaryExtrema(points) {
        if (!points?.length) return null;
        let mn = points[0];
        let mx = points[0];
        points.forEach(p => {
            if (p.v < mn.v) mn = p;
            if (p.v > mx.v) mx = p;
        });
        return { min: mn, max: mx };
    }

    function decisionScore(data, overlays) {
        const price = data?.buyBox ?? data?.marketPrice ?? data?.currentPrice ?? null;
        const avg90 = data?.avg90 ?? overlays?.avg90 ?? null;
        const vs90 = data?.vs90 != null
            ? data.vs90
            : (price != null && avg90 > 0 ? (price - avg90) / avg90 : null);
        const alert = readAlert(data?.asin);
        const lote = linkedLote(data?.asin);
        const atBb = utilAt(lote, price);
        const utilAtBb = atBb?.utilidad ?? null;
        const margenAtBb = atBb?.margen ?? null;
        const be = overlays?.breakEven ?? null;
        const gapBe = (price != null && be != null) ? price - be : null;

        let action = 'Revisar';
        let tone = 'warn';
        let why = 'Cruza precio, margen y BSR antes de decidir.';

        const cheap = vs90 != null && vs90 <= -0.08;
        const expensive = vs90 != null && vs90 >= 0.08;
        const alertHit = alert != null && price != null && price <= alert;
        const profitOk = utilAtBb != null && utilAtBb >= 0;
        const profitBad = utilAtBb != null && utilAtBb < 0;
        const bsrBad = data?.bsrVs90 != null && data.bsrVs90 > 0.1;
        const belowList = overlays?.precio != null && price != null && price < overlays.precio * 0.97;

        if (alertHit || (cheap && !profitBad && !bsrBad)) {
            action = 'Comprar';
            tone = 'good';
            why = alertHit
                ? `Buy Box tocó tu alerta (${mxn(alert)}).`
                : `BB ${pct(vs90)} vs avg90${profitOk ? ` · utilidad ${mxn(utilAtBb)}/ud` : ''}.`;
        } else if (profitBad) {
            action = 'Esperar';
            tone = 'bad';
            why = `Al BB pierdes ${mxn(utilAtBb)}/ud. Espera dip o baja costo.`;
        } else if (belowList && profitOk) {
            action = 'Listar / bajar';
            tone = 'warn';
            why = `BB bajo tu precio${margenAtBb != null ? ` · margen ${pct(margenAtBb)}` : ''}. Ajusta para competir.`;
        } else if (expensive) {
            action = 'Esperar';
            tone = 'warn';
            why = `BB ${pct(vs90)} sobre avg90 — caro para recomprar.`;
        } else if (bsrBad && expensive) {
            action = 'Revisar';
            tone = 'bad';
            why = 'Precio alto y BSR empeora: evita entrar ahora.';
        }

        const kpis = [
            { label: 'BB vs 90d', value: pct(vs90) },
            {
                label: 'Margen @ BB',
                value: margenAtBb != null ? pct(margenAtBb) : '—',
            },
            {
                label: 'vs break-even',
                value: gapBe != null ? `${gapBe >= 0 ? '+' : ''}${mxn(gapBe)}` : '—',
            },
        ];
        if (data?.monthlySold != null) {
            kpis.push({ label: 'Ventas/mes', value: `${Number(data.monthlySold)}+` });
        } else if (data?.bsrVs90 != null) {
            kpis.push({ label: 'BSR vs 90d', value: pct(data.bsrVs90) });
        }
        if (alert != null) {
            const dist = price != null ? price - alert : null;
            kpis.push({
                label: 'Alerta',
                value: dist == null ? mxn(alert) : `${dist <= 0 ? '✓ ' : ''}${mxn(alert)}`,
            });
        }

        return {
            action, tone, why, kpis,
            price, utilAtBb, margenAtBb, gapBe, alert,
            hasLote: Boolean(lote),
            loteId: lote?.id || overlays?.loteId || '',
        };
    }

    function decisionHtml(decision, compact) {
        if (!decision) return '';
        const kpis = compact ? decision.kpis.slice(0, 2) : decision.kpis;
        return `
            <div class="keepa-ix-decision tone-${esc(decision.tone)}">
                <div class="keepa-ix-verdict">
                    <span class="keepa-ix-verdict-action">${esc(decision.action)}</span>
                    <p class="keepa-ix-verdict-why">${esc(decision.why)}</p>
                </div>
                <div class="keepa-ix-decision-kpis">
                    ${kpis.map(k => `
                        <div class="keepa-ix-dk">
                            <span class="keepa-ix-dk-label">${esc(k.label)}</span>
                            <strong class="keepa-ix-dk-value">${esc(k.value)}</strong>
                        </div>`).join('')}
                </div>
            </div>`;
    }

    function applyMode(state, mode) {
        const map = {
            comprar: PRESET_COMPRAR,
            vender: PRESET_VENDER,
            competencia: PRESET_COMPETENCIA,
            mia: PRESET_MIA,
        };
        const preset = map[mode];
        if (!preset) return;
        state.mode = mode;
        state.graph = { ...state.graph, ...preset };
        state.hidden = {};
        state.hrefHidden = { ...(MODE_HREF[mode] || {}) };
        state.onGraphChange?.(state.graph);
    }

    function html(opts = {}) {
        const data = opts.data;
        const compare = opts.compareData || null;
        const graph = opts.graph || {};
        const compact = Boolean(opts.compact);
        const showAreas = opts.showAreas !== false;
        const hidden = opts.hidden || {};
        const hrefHidden = opts.hrefHidden || {};
        const brush = opts.brush || null;
        const mode = opts.mode || '';
        const overlays = opts.overlays || overlaysFromLote(linkedLote(data?.asin));
        const uid = opts.uid || `ix-${Math.random().toString(36).slice(2, 8)}`;
        const decision = decisionScore(data, { ...overlays, avg90: overlays.avg90 ?? data?.avg90 });

        let series = buildSeries(data, graph, { hidden, brush });
        if (compare?.history) {
            series = series.concat(buildSeries(compare, graph, {
                hidden, brush, prefix: 'c:', colorMap: COMPARE_COLORS,
            }));
        }

        const alertBelow = readAlert(data?.asin);

        if (!series.length) {
            const hasHistory = data?.history && Object.keys(data.history).length > 0;
            return `
                <section class="keepa-ix-panel keepa-ix-stack${compact ? ' float-surface is-compact' : ''}" data-keepa-ix="${esc(uid)}">
                    <div class="keepa-ix-head keepa-ix-block">
                        <div>
                            <h3>Historial · decisión</h3>
                            <p class="muted small">Historial Keepa + tu operación.</p>
                        </div>
                    </div>
                    ${decisionHtml(decision, compact)}
                    <div class="keepa-ix-empty muted small keepa-ix-block">
                        ${hasHistory
                            ? 'Activa una serie con datos en el rango (o quita el zoom).'
                            : 'Sin historial. Vuelve a cargar el ASIN con Investigar / Buy Box.'}
                    </div>
                </section>`;
        }

        const W = compact ? 720 : 1100;
        const H = compact ? 260 : 520;
        const pad = { l: 54, r: 54, t: 16, b: 34 };
        const plotW = W - pad.l - pad.r;
        const plotH = H - pad.t - pad.b;

        const allT = series.flatMap(s => s.points.map(p => p.t));
        const tMin = Math.min(...allT);
        const tMax = Math.max(...allT);
        const tSpan = Math.max(1, tMax - tMin);

        const priceSeries = series.filter(s => s.kind === 'price');
        const rankSeries = series.filter(s => s.kind === 'rank');
        const priceVals = priceSeries.flatMap(s => s.points.map(p => p.v));
        const refCandidates = [
            !hrefHidden.costo ? overlays.costo : null,
            !hrefHidden.precio ? overlays.precio : null,
            !hrefHidden.be ? overlays.breakEven : null,
            !hrefHidden.avg90 ? (overlays.avg90 ?? data?.avg90) : null,
            !hrefHidden.alert ? alertBelow : null,
        ].filter(v => v != null && Number.isFinite(v));
        let pMin = priceVals.length ? Math.min(...priceVals, ...refCandidates) : 0;
        let pMax = priceVals.length ? Math.max(...priceVals, ...refCandidates) : 1;
        if (graph.yzoom && priceVals.length) {
            const padY = Math.max(1, (pMax - pMin) * 0.1);
            pMin = Math.max(0, pMin - padY);
            pMax = pMax + padY;
        } else {
            pMin = 0;
            pMax = Math.max(pMax * 1.06, 1);
        }
        const pSpan = Math.max(0.01, pMax - pMin);

        const rankVals = rankSeries.flatMap(s => s.points.map(p => p.v));
        let rMin = rankVals.length ? Math.min(...rankVals) : 1;
        let rMax = rankVals.length ? Math.max(...rankVals) : 100;
        if (rMin === rMax) { rMin = Math.max(1, rMin * 0.8); rMax = rMax * 1.2; }
        const rPad = (rMax - rMin) * 0.06;
        rMin = Math.max(1, rMin - rPad);
        rMax = rMax + rPad;
        const rSpan = Math.max(1, rMax - rMin);

        const xAt = t => pad.l + ((t - tMin) / tSpan) * plotW;
        const yPrice = v => pad.t + (1 - (v - pMin) / pSpan) * plotH;
        const yRank = v => pad.t + ((v - rMin) / rSpan) * plotH;

        const avg90 = overlays.avg90 ?? data?.avg90;
        let avgZone = '';
        if (!hrefHidden.avg90 && avg90 != null && avg90 > pMin) {
            const yTop = yPrice(Math.min(avg90, pMax));
            const yBot = pad.t + plotH;
            avgZone = `<rect class="keepa-ix-avgzone" x="${pad.l}" y="${yTop.toFixed(1)}"
                width="${plotW}" height="${Math.max(0, yBot - yTop).toFixed(1)}" />`;
        }

        const hrefLines = [
            { key: 'costo', v: overlays.costo, color: '#FF453A', label: 'Costo' },
            { key: 'be', v: overlays.breakEven, color: '#FF9F0A', label: 'Break-even' },
            { key: 'precio', v: overlays.precio, color: '#0A84FF', label: 'Tu precio' },
            { key: 'avg90', v: avg90, color: '#5E5CE6', label: 'Avg 90d', dash: '5 4' },
            { key: 'alert', v: alertBelow, color: '#BF5AF2', label: 'Alerta', dash: '2 3' },
        ].filter(h => !hrefHidden[h.key] && h.v != null && h.v >= pMin && h.v <= pMax);

        const hrefSvg = hrefLines.map(h => {
            const y = yPrice(h.v).toFixed(1);
            return `
                <line class="keepa-ix-href" x1="${pad.l}" x2="${pad.l + plotW}" y1="${y}" y2="${y}"
                    stroke="${esc(h.color)}" stroke-dasharray="${h.dash || '0'}" />
                <text class="keepa-ix-href-label" x="${pad.l + 4}" y="${(Number(y) - 4).toFixed(1)}"
                    fill="${esc(h.color)}">${esc(h.label)} ${esc(mxn(h.v))}</text>`;
        }).join('');

        const primary = priceSeries.find(s => s.srcKey === 'bb')
            || priceSeries.find(s => s.srcKey === 'amazon')
            || priceSeries[0];
        const extremaPts = primaryExtrema(primary?.points);
        let extrema = '';
        if (extremaPts) {
            const { min: mn, max: mx } = extremaPts;
            extrema = `
                <g class="keepa-ix-extrema">
                    <circle class="keepa-ix-pulse-ring" cx="${xAt(mn.t).toFixed(1)}" cy="${yPrice(mn.v).toFixed(1)}" r="8" fill="none" stroke="#0A84FF"/>
                    <circle class="keepa-ix-extremum" cx="${xAt(mn.t).toFixed(1)}" cy="${yPrice(mn.v).toFixed(1)}" r="4" fill="#0A84FF" stroke="#fff" stroke-width="1.5"/>
                    <text x="${xAt(mn.t).toFixed(1)}" y="${(yPrice(mn.v) - 8).toFixed(1)}" text-anchor="middle" class="keepa-ix-extrema-lbl">min ${esc(mxn(mn.v))}</text>
                    <circle class="keepa-ix-pulse-ring keepa-ix-pulse-ring-b" cx="${xAt(mx.t).toFixed(1)}" cy="${yPrice(mx.v).toFixed(1)}" r="8" fill="none" stroke="#BF5AF2"/>
                    <circle class="keepa-ix-extremum" cx="${xAt(mx.t).toFixed(1)}" cy="${yPrice(mx.v).toFixed(1)}" r="4" fill="#BF5AF2" stroke="#fff" stroke-width="1.5"/>
                    <text x="${xAt(mx.t).toFixed(1)}" y="${(yPrice(mx.v) - 8).toFixed(1)}" text-anchor="middle" class="keepa-ix-extrema-lbl">max ${esc(mxn(mx.v))}</text>
                </g>`;
        }

        const showVentas = !hrefHidden.ventas;
        const ventas = showVentas
            ? (overlays.ventas || []).filter(v => v.t >= tMin && v.t <= tMax)
            : [];
        const ventasSvg = ventas.map(v => `
            <g class="keepa-ix-sale" data-tip="${esc(`${v.unidades} ud · ${mxn(v.precio)}`)}">
                <circle cx="${xAt(v.t).toFixed(1)}" cy="${yPrice(v.precio || pMin).toFixed(1)}"
                    r="${Math.min(6, 3 + Math.sqrt(v.unidades || 1))}" fill="#0A84FF" fill-opacity="0.92" stroke="#fff" stroke-width="1.2"/>
            </g>`).join('');

        const baseY = (pad.t + plotH).toFixed(1);
        const areas = showAreas ? priceSeries.filter(s => !s.dashed).slice(0, 2).map(s => {
            const d = s.points.map((p, i) =>
                `${i ? 'L' : 'M'}${xAt(p.t).toFixed(1)},${yPrice(p.v).toFixed(1)}`
            ).join(' ');
            const lastX = xAt(s.points[s.points.length - 1].t).toFixed(1);
            const firstX = xAt(s.points[0].t).toFixed(1);
            return `<path class="keepa-ix-area" d="${d} L${lastX},${baseY} L${firstX},${baseY} Z" fill="url(#${uid}-fill-${esc(s.key)})" />`;
        }).join('') : '';

        const paths = series.map(s => {
            const yAt = s.kind === 'rank' ? yRank : yPrice;
            const d = s.points.map((p, i) =>
                `${i ? 'L' : 'M'}${xAt(p.t).toFixed(1)},${yAt(p.v).toFixed(1)}`
            ).join(' ');
            const thick = s.srcKey === 'bb' || s.srcKey === 'salesrank' ? ' is-emphasis' : '';
            const dash = s.dashed ? ' stroke-dasharray="5 4"' : '';
            const glow = thick ? ` filter="url(#${uid}-glow)"` : '';
            return `<path class="keepa-ix-line${thick}" data-ix-key="${esc(s.key)}" d="${d}" fill="none" stroke="${esc(s.color)}"${dash}${glow} />`;
        }).join('');

        const grads = priceSeries.filter(s => !s.dashed).slice(0, 2).map(s => `
            <linearGradient id="${uid}-fill-${esc(s.key)}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${esc(s.color)}" stop-opacity="0.16"/>
                <stop offset="100%" stop-color="${esc(s.color)}" stop-opacity="0"/>
            </linearGradient>`).join('');
        const fxDefs = `
            <linearGradient id="${uid}-wash" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#FFD60A" stop-opacity="0.07"/>
                <stop offset="25%" stop-color="#FF375F" stop-opacity="0.05"/>
                <stop offset="50%" stop-color="#BF5AF2" stop-opacity="0.06"/>
                <stop offset="75%" stop-color="#0A84FF" stop-opacity="0.07"/>
                <stop offset="100%" stop-color="#64D2FF" stop-opacity="0.06"/>
            </linearGradient>
            <filter id="${uid}-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="1.8" result="blur"/>
                <feMerge>
                    <feMergeNode in="blur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>`;
        const washSvg = `<rect class="keepa-ix-wash" x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="url(#${uid}-wash)" />`;

        const yTicks = 4;
        const priceTicks = Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = pMax - (i / yTicks) * pSpan;
            return { y: pad.t + (i / yTicks) * plotH, label: mxn(v) };
        });
        const rankTicks = rankSeries.length ? Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = rMin + (i / yTicks) * rSpan;
            return { y: pad.t + (i / yTicks) * plotH, label: Math.round(v).toLocaleString('es-MX') };
        }) : [];
        const dateTicks = Array.from({ length: 5 }, (_, i) => {
            const t = tMin + (i / 4) * tSpan;
            return {
                x: xAt(t),
                label: new Date(t).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
            };
        });

        const meta = {
            uid, tMin, tMax, pad, W, H, plotW, plotH,
            pMin, pMax, rMin, rMax,
            avg90: avg90 ?? null,
            overlays: {
                costo: overlays.costo ?? null,
                precio: overlays.precio ?? null,
                breakEven: overlays.breakEven ?? null,
                loteId: overlays.loteId || '',
            },
            minPoint: extremaPts?.min || null,
            series: series.map(s => ({
                key: s.key, srcKey: s.srcKey, label: s.label, kind: s.kind, color: s.color, points: s.points,
            })),
            pins: opts.pins || [],
        };

        const legendKeys = LINE_KEYS.filter(([key]) => data?.history?.[key]?.points?.length);
        const compareLegendKeys = compare
            ? LINE_KEYS.filter(([key]) => compare.history?.[key]?.points?.length)
            : [];
        const rangeVal = Number(graph.range) || 90;
        const bbPrice = decision.price;
        const showApplyBb = Boolean(decision.hasLote && bbPrice != null);
        const compareLabel = opts.compareAsin
            ? `VS ${String(opts.compareAsin).toUpperCase()}`
            : 'VS ASIN';

        return `
            <section class="keepa-ix-panel keepa-ix-stack${compact ? ' float-surface is-compact' : ''}" data-keepa-ix="${esc(uid)}">
                <div class="keepa-ix-head keepa-ix-block">
                    <div>
                        <h3>Historial · decisión${compare ? ` · ${esc(compareLabel)}` : ''}</h3>
                        <p class="muted small">Arrastra = zoom · clic = pin A/B · modos cambian la lectura.</p>
                    </div>
                </div>
                <div class="keepa-ix-block keepa-ix-decision-wrap">
                    ${decisionHtml(decision, compact)}
                </div>
                <div class="keepa-graph-controls keepa-ix-controls keepa-ix-block">
                    <div class="keepa-graph-row keepa-ix-period-row">
                        <span class="muted small">Periodo</span>
                        <div class="keepa-chip-group keepa-ix-period-chips" role="group" aria-label="Periodo del historial">
                            ${RANGE_CHIPS.map(([value, label]) => `
                                <button type="button" class="keepa-chip keepa-ix-period${rangeVal === value ? ' active' : ''}"
                                    data-ix-range="${value}" aria-pressed="${rangeVal === value ? 'true' : 'false'}">${label}</button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="keepa-graph-row keepa-ix-tool-row">
                        <span class="muted small">Modo</span>
                        <div class="keepa-chip-group">
                            <button type="button" class="keepa-chip${mode === 'comprar' ? ' active' : ''}" data-ix-mode="comprar">Comprar</button>
                            <button type="button" class="keepa-chip${mode === 'vender' ? ' active' : ''}" data-ix-mode="vender">Vender</button>
                            <button type="button" class="keepa-chip${mode === 'competencia' ? ' active' : ''}" data-ix-mode="competencia">Competencia</button>
                            <button type="button" class="keepa-chip${mode === 'mia' ? ' active' : ''}" data-ix-mode="mia">Mi operación</button>
                        </div>
                    </div>
                    <div class="keepa-graph-row keepa-ix-tool-row">
                        <span class="muted small">Series${compare ? ' · A' : ''}</span>
                        <div class="keepa-chip-group">
                            ${legendKeys.map(([key, label]) => `
                                <button type="button" class="keepa-chip keepa-ix-leg${hidden[key] ? '' : ' active'}"
                                    data-ix-leg="${esc(key)}" style="--c:${esc(COLORS[key])}">
                                    <i class="keepa-ix-dot" style="background:${esc(COLORS[key])}"></i>${esc(label)}
                                </button>`).join('')}
                        </div>
                    </div>
                    ${compare && compareLegendKeys.length ? `
                    <div class="keepa-graph-row keepa-ix-tool-row">
                        <span class="muted small">Series · B</span>
                        <div class="keepa-chip-group">
                            ${compareLegendKeys.map(([key, label]) => {
                                const ck = `c:${key}`;
                                const color = COMPARE_COLORS[key] || COLORS[key];
                                return `
                                <button type="button" class="keepa-chip keepa-ix-leg${hidden[ck] ? '' : ' active'}"
                                    data-ix-leg="${esc(ck)}" style="--c:${esc(color)}">
                                    <i class="keepa-ix-dot" style="background:${esc(color)}"></i>${esc(label)} · B
                                </button>`;
                            }).join('')}
                        </div>
                    </div>` : ''}
                    <div class="keepa-graph-row keepa-ix-tool-row">
                        <span class="muted small">Referencias</span>
                        <div class="keepa-chip-group">
                            ${HREF_KEYS.map(([key, label]) => `
                                <button type="button" class="keepa-chip${hrefHidden[key] ? '' : ' active'}"
                                    data-ix-href="${esc(key)}">${esc(label)}</button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="keepa-graph-row keepa-ix-tool-row">
                        <span class="muted small">Acciones</span>
                        <div class="keepa-chip-group">
                            <button type="button" class="keepa-chip${showAreas ? ' active' : ''}" data-ix-act="areas">Áreas</button>
                            <button type="button" class="keepa-chip${graph.yzoom ? ' active' : ''}" data-ix-act="yzoom">Zoom Y</button>
                            <button type="button" class="keepa-chip" data-ix-act="goto-min" ${extremaPts ? '' : 'disabled'}>Ir a mínimo</button>
                            <button type="button" class="keepa-chip" data-ix-act="alert-min" ${extremaPts ? '' : 'disabled'}>Alerta = mínimo</button>
                            ${showApplyBb ? `<button type="button" class="keepa-chip" data-ix-act="apply-bb">Usar BB (${esc(mxn(bbPrice))})</button>` : ''}
                            <button type="button" class="keepa-chip" data-ix-act="reset-zoom" ${brush ? '' : 'disabled'}>Reset zoom</button>
                            <button type="button" class="keepa-chip" data-ix-act="export-csv">CSV</button>
                            <button type="button" class="keepa-chip" data-ix-act="export-png">PNG</button>
                        </div>
                    </div>
                    ${compact ? '' : `
                    <div class="keepa-graph-row keepa-ix-extra-row keepa-ix-tool-row">
                        <label class="keepa-ix-field">
                            <span class="muted small">VS ASIN</span>
                            <input type="text" data-ix-compare placeholder="ASIN o link competidor" value="${esc(opts.compareAsin || '')}">
                        </label>
                        <button type="button" class="btn ghost sm" data-ix-act="compare">Cargar B · ~3–5 tok</button>
                        ${compare ? `<button type="button" class="btn ghost sm" data-ix-act="compare-clear">Quitar B</button>` : ''}
                        <label class="keepa-ix-field">
                            <span class="muted small">Alerta BB ≤</span>
                            <input type="number" min="0" step="1" data-ix-alert placeholder="MXN"
                                value="${alertBelow != null ? esc(alertBelow) : ''}">
                        </label>
                        <button type="button" class="btn ghost sm" data-ix-act="alert-save">Guardar alerta</button>
                    </div>`}
                </div>
                <div class="keepa-graph-box keepa-ix-chart keepa-ix-block">
                    <svg class="keepa-ix-svg keepa-ix-svg-fx" viewBox="0 0 ${W} ${H}" role="img" aria-label="Historial Keepa">
                        <defs>${grads}${fxDefs}</defs>
                        <rect class="keepa-ix-plot" x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" />
                        ${washSvg}
                        ${avgZone}
                        ${priceTicks.map(tick => `
                            <line class="keepa-ix-grid" x1="${pad.l}" x2="${pad.l + plotW}" y1="${tick.y.toFixed(1)}" y2="${tick.y.toFixed(1)}" />
                            <text class="keepa-ix-axis keepa-ix-axis-l" x="${pad.l - 8}" y="${tick.y.toFixed(1)}" dy="0.35em" text-anchor="end">${esc(tick.label)}</text>
                        `).join('')}
                        ${rankTicks.map(tick => `
                            <text class="keepa-ix-axis keepa-ix-axis-r" x="${pad.l + plotW + 8}" y="${tick.y.toFixed(1)}" dy="0.35em" text-anchor="start">${esc(tick.label)}</text>
                        `).join('')}
                        ${dateTicks.map(tick => `
                            <text class="keepa-ix-axis keepa-ix-axis-x" x="${tick.x.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(tick.label)}</text>
                        `).join('')}
                        ${hrefSvg}
                        ${areas}
                        ${paths}
                        ${extrema}
                        ${ventasSvg}
                        <rect class="keepa-ix-brush" hidden x="0" y="${pad.t}" width="0" height="${plotH}" />
                        <line class="keepa-ix-cross keepa-ix-cross-v" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + plotH}" hidden />
                        <line class="keepa-ix-cross keepa-ix-cross-h" x1="${pad.l}" x2="${pad.l + plotW}" y1="0" y2="0" hidden />
                        <g class="keepa-ix-pins"></g>
                        <g class="keepa-ix-dots"></g>
                        <g class="keepa-ix-tags"></g>
                        <rect class="keepa-ix-hit" x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}"
                            fill="transparent" tabindex="0" aria-label="Explorar historial" />
                    </svg>
                    <div class="keepa-ix-float-tip" hidden></div>
                    <div class="keepa-ix-period-overlay" aria-hidden="true">
                        ${RANGE_CHIPS.map(([value, label]) => `
                            <button type="button" class="keepa-ix-period-mini${rangeVal === value ? ' active' : ''}"
                                data-ix-range="${value}">${label}</button>
                        `).join('')}
                    </div>
                    <textarea class="keepa-ix-meta" hidden>${JSON.stringify(meta).replace(/</g, '\\u003c')}</textarea>
                </div>
                <p class="muted small keepa-ix-tip">Periodo arriba · cursor = etiquetas · clic pin A/B · arrastra = zoom.</p>
            </section>`;
    }

    function exportCsv(meta, data) {
        const rows = [['serie', 'fecha_iso', 'valor']];
        (meta.series || []).forEach(s => {
            (s.points || []).forEach(p => {
                rows.push([s.label, new Date(p.t).toISOString(), p.v]);
            });
        });
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `keepa-${data?.asin || 'chart'}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        UI.toast?.('CSV exportado');
    }

    async function exportPng(panel, asin) {
        const svg = panel.querySelector('.keepa-ix-svg');
        if (!svg) return;
        const xml = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        const rect = svg.viewBox.baseVal;
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = rect.width || 960;
        canvas.height = rect.height || 340;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `keepa-${asin || 'chart'}.png`;
        a.click();
        UI.toast?.('PNG exportado');
    }

    function remount(panel, state) {
        const holder = document.createElement('div');
        holder.innerHTML = html(state);
        const next = holder.firstElementChild;
        if (!next) return;
        panel.replaceWith(next);
        bind(next, state);
        state.onAfterRemount?.(next);
    }

    function bind(root, state) {
        const panel = root.matches?.('[data-keepa-ix]')
            ? root
            : root.querySelector?.('[data-keepa-ix]');
        if (!panel) return;

        const svg = panel.querySelector('.keepa-ix-svg');
        const hit = panel.querySelector('.keepa-ix-hit');
        const tip = panel.querySelector('.keepa-ix-tip');
        const metaEl = panel.querySelector('.keepa-ix-meta');
        if (!svg || !hit || !tip || !metaEl) {
            wireChrome(panel, state);
            return;
        }

        let meta;
        try { meta = JSON.parse(metaEl.value || '{}'); }
        catch { return; }

        const crossV = panel.querySelector('.keepa-ix-cross-v') || panel.querySelector('.keepa-ix-cross');
        const crossH = panel.querySelector('.keepa-ix-cross-h');
        const dots = panel.querySelector('.keepa-ix-dots');
        const tagsG = panel.querySelector('.keepa-ix-tags');
        const floatTip = panel.querySelector('.keepa-ix-float-tip');
        const chartBox = panel.querySelector('.keepa-ix-chart');
        const pinsG = panel.querySelector('.keepa-ix-pins');
        const brushEl = panel.querySelector('.keepa-ix-brush');
        const pad = meta.pad;
        const pSpan = Math.max(0.01, meta.pMax - meta.pMin);
        const rSpan = Math.max(1, meta.rMax - meta.rMin);
        const tSpan = Math.max(1, meta.tMax - meta.tMin);
        const xAt = t => pad.l + ((t - meta.tMin) / tSpan) * meta.plotW;
        const yPrice = v => pad.t + (1 - (v - meta.pMin) / pSpan) * meta.plotH;
        const yRank = v => pad.t + ((v - meta.rMin) / rSpan) * meta.plotH;
        const clientToT = clientX => {
            const rect = svg.getBoundingClientRect();
            const scaleX = meta.W / Math.max(1, rect.width);
            const x = (clientX - rect.left) * scaleX;
            const clamped = Math.max(pad.l, Math.min(pad.l + meta.plotW, x));
            return {
                x: clamped,
                t: meta.tMin + ((clamped - pad.l) / meta.plotW) * tSpan,
            };
        };

        const pins = Array.isArray(state.pins) ? state.pins.slice(0, 2) : [];
        const plotHSafe = () => meta.plotH;
        const paintPins = () => {
            if (!pinsG) return;
            pinsG.innerHTML = pins.map((pin, i) => `
                <line x1="${xAt(pin.t).toFixed(1)}" x2="${xAt(pin.t).toFixed(1)}"
                    y1="${pad.t}" y2="${pad.t + plotHSafe()}" stroke="${i ? '#FF9F0A' : '#0A84FF'}"
                    stroke-width="1.25" stroke-dasharray="3 3"/>
                <circle cx="${xAt(pin.t).toFixed(1)}" cy="${pad.t + 8}" r="4" fill="${i ? '#FF9F0A' : '#0A84FF'}" stroke="#fff"/>
                <text x="${xAt(pin.t).toFixed(1)}" y="${pad.t + 22}" text-anchor="middle"
                    class="keepa-ix-pin-lbl">${i ? 'B' : 'A'}</text>
            `).join('');
        };

        const lote = linkedLote(state.data?.asin);
        const hideFloat = () => {
            if (floatTip) floatTip.hidden = true;
            if (tagsG) tagsG.innerHTML = '';
            crossV?.setAttribute('hidden', '');
            crossH?.setAttribute('hidden', '');
            if (dots) dots.innerHTML = '';
        };

        const paintTip = (t, x) => {
            if (crossV) {
                crossV.setAttribute('x1', x.toFixed(1));
                crossV.setAttribute('x2', x.toFixed(1));
                crossV.removeAttribute('hidden');
            }
            if (dots) dots.innerHTML = '';
            if (tagsG) tagsG.innerHTML = '';
            const rows = [];
            const floatRows = [];
            let primaryPrice = null;
            let primaryY = null;
            let tagSlot = 0;
            meta.series.forEach(s => {
                const pt = nearestPoint(s.points, t);
                if (!pt) return;
                if (s.kind === 'price' && (s.srcKey === 'bb' || primaryPrice == null)) {
                    primaryPrice = pt.v;
                    primaryY = yPrice(pt.v);
                }
                const y = s.kind === 'rank' ? yRank(pt.v) : yPrice(pt.v);
                const cx = xAt(pt.t);
                if (dots) {
                    dots.insertAdjacentHTML('beforeend',
                        `<circle class="keepa-ix-hover-dot" cx="${cx.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${s.color}" stroke="#fff" stroke-width="1.6"/>`);
                }
                const val = s.kind === 'rank'
                    ? `#${Math.round(pt.v).toLocaleString('es-MX')}`
                    : mxn(pt.v);
                rows.push(`<span style="color:${s.color}"><strong>${esc(s.label)}</strong> ${esc(val)}</span>`);
                floatRows.push(`<div class="keepa-ix-float-row"><i style="background:${esc(s.color)}"></i><span>${esc(s.label)}</span><strong>${esc(val)}</strong></div>`);

                // Etiqueta pegada al punto (solo primeras 4 series para no saturar)
                if (tagsG && tagSlot < 4) {
                    const label = `${s.label} ${val}`;
                    const approxW = Math.min(148, 28 + label.length * 6.2);
                    const flip = cx + 10 + approxW > pad.l + meta.plotW;
                    const tx = flip ? cx - 10 - approxW : cx + 10;
                    const ty = Math.max(pad.t + 4, Math.min(pad.t + meta.plotH - 22, y - 10 + tagSlot * 2));
                    tagsG.insertAdjacentHTML('beforeend', `
                        <g class="keepa-ix-tag" transform="translate(${tx.toFixed(1)},${ty.toFixed(1)})">
                            <rect width="${approxW.toFixed(0)}" height="20" rx="6" ry="6"
                                fill="#ffffff" stroke="${esc(s.color)}" stroke-width="1.2" fill-opacity="0.96"/>
                            <circle cx="9" cy="10" r="3.2" fill="${esc(s.color)}"/>
                            <text x="16" y="13.5">${esc(label)}</text>
                        </g>`);
                    tagSlot++;
                }
            });

            if (crossH && primaryY != null) {
                crossH.setAttribute('y1', primaryY.toFixed(1));
                crossH.setAttribute('y2', primaryY.toFixed(1));
                crossH.removeAttribute('hidden');
            }

            const deltas = [];
            if (primaryPrice != null) {
                const dayAgo = valueNear(
                    meta.series.find(s => s.srcKey === 'bb')?.points
                        || meta.series.find(s => s.kind === 'price')?.points,
                    t - 86400000
                );
                if (dayAgo != null && dayAgo > 0) {
                    deltas.push(`vs 1d ${pct((primaryPrice - dayAgo) / dayAgo)}`);
                }
                if (meta.avg90 > 0) {
                    deltas.push(`vs 90d ${pct((primaryPrice - meta.avg90) / meta.avg90)}`);
                }
                if (meta.overlays?.costo != null) {
                    deltas.push(`vs costo ${pct((primaryPrice - meta.overlays.costo) / meta.overlays.costo)}`);
                }
                const u = utilAt(lote, primaryPrice);
                if (u) {
                    deltas.push(
                        `Si listas aquí: ${mxn(u.utilidad)}/ud (${pct(u.margen)} margen)`
                    );
                    if (meta.overlays?.costo != null) {
                        const edge = primaryPrice - meta.overlays.costo;
                        deltas.push(
                            edge >= 0
                                ? `Si compras aquí: +${mxn(edge)} sobre costo`
                                : `Si compras aquí: ${mxn(edge)} bajo costo`
                        );
                    }
                }
            }
            if (pins.length === 2) {
                const pts = meta.series.find(s => s.srcKey === 'bb')?.points
                    || meta.series.find(s => s.kind === 'price')?.points || [];
                const pa = nearestPoint(pts, pins[0].t);
                const pb = nearestPoint(pts, pins[1].t);
                if (pa && pb && pa.v > 0) {
                    deltas.push(`A→B ${pct((pb.v - pa.v) / pa.v)} (${mxn(pa.v)} → ${mxn(pb.v)})`);
                }
            }

            const when = new Date(t).toLocaleString('es-MX', {
                day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            });
            tip.innerHTML = `<strong>${esc(when)}</strong> · ${rows.join(' · ')}`
                + (deltas.length ? `<br><span class="keepa-ix-deltas">${deltas.map(esc).join(' · ')}</span>` : '');

            if (floatTip && chartBox) {
                floatTip.hidden = false;
                floatTip.innerHTML = `
                    <div class="keepa-ix-float-when">${esc(when)}</div>
                    ${floatRows.join('')}
                    ${deltas.length ? `<div class="keepa-ix-float-deltas">${deltas.slice(0, 3).map(esc).join('<br>')}</div>` : ''}
                `;
                const svgRect = svg.getBoundingClientRect();
                const boxRect = chartBox.getBoundingClientRect();
                const scaleX = svgRect.width / Math.max(1, meta.W);
                const scaleY = svgRect.height / Math.max(1, meta.H);
                const tipW = floatTip.offsetWidth || 180;
                const tipH = floatTip.offsetHeight || 120;
                let left = (x * scaleX) + (svgRect.left - boxRect.left) + 14;
                let top = ((primaryY != null ? primaryY : pad.t + 40) * scaleY) + (svgRect.top - boxRect.top) - tipH / 2;
                if (left + tipW > boxRect.width - 8) left = (x * scaleX) + (svgRect.left - boxRect.left) - tipW - 14;
                if (top < 8) top = 8;
                if (top + tipH > boxRect.height - 8) top = Math.max(8, boxRect.height - tipH - 8);
                floatTip.style.left = `${left.toFixed(0)}px`;
                floatTip.style.top = `${top.toFixed(0)}px`;
            }
        };

        let dragging = false;
        let dragStartX = 0;
        let dragStartT = 0;
        let moved = false;

        hit.addEventListener('pointerdown', e => {
            hit.setPointerCapture?.(e.pointerId);
            const { x, t } = clientToT(e.clientX);
            dragging = true;
            moved = false;
            dragStartX = x;
            dragStartT = t;
            if (brushEl) {
                brushEl.removeAttribute('hidden');
                brushEl.setAttribute('x', x.toFixed(1));
                brushEl.setAttribute('width', '0');
            }
            paintTip(t, x);
        });
        hit.addEventListener('pointermove', e => {
            const { x, t } = clientToT(e.clientX);
            if (dragging) {
                if (Math.abs(x - dragStartX) > 6) moved = true;
                if (brushEl) {
                    const left = Math.min(dragStartX, x);
                    brushEl.setAttribute('x', left.toFixed(1));
                    brushEl.setAttribute('width', Math.abs(x - dragStartX).toFixed(1));
                }
            }
            paintTip(t, x);
        });
        hit.addEventListener('pointerup', e => {
            const { x, t } = clientToT(e.clientX);
            if (dragging && moved && Math.abs(x - dragStartX) > 18) {
                const t0 = Math.min(dragStartT, t);
                const t1 = Math.max(dragStartT, t);
                state.brush = { tMin: t0, tMax: t1 };
                state.pins = pins;
                remount(panel, state);
                return;
            }
            if (dragging && !moved) {
                if (pins.length >= 2) pins.length = 0;
                pins.push({ t });
                state.pins = pins.slice();
                paintPins();
                paintTip(t, x);
            }
            dragging = false;
            brushEl?.setAttribute('hidden', '');
        });
        hit.addEventListener('pointerleave', () => {
            if (dragging) return;
            hideFloat();
        });
        paintPins();
        animateChartFx(svg);
        wireChrome(panel, state);
    }

    function animateChartFx(svg) {
        if (!svg || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
        svg.classList.add('is-fx-ready');
        svg.querySelectorAll('.keepa-ix-line').forEach((path, i) => {
            let len = 0;
            try { len = path.getTotalLength(); } catch { return; }
            if (!(len > 0)) return;
            path.style.strokeDasharray = `${len}`;
            path.style.strokeDashoffset = `${len}`;
            path.style.opacity = '0.15';
            // force layout before transition
            path.getBoundingClientRect();
            path.style.transition =
                `stroke-dashoffset 0.95s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.07}s, opacity 0.45s ease ${i * 0.05}s`;
            requestAnimationFrame(() => {
                path.style.strokeDashoffset = '0';
                path.style.opacity = '1';
            });
            window.setTimeout(() => {
                path.style.strokeDasharray = '';
                path.style.strokeDashoffset = '';
                path.style.transition = '';
                path.style.opacity = '';
            }, 1300 + i * 80);
        });
    }

    function wireChrome(panel, state) {
        panel.querySelectorAll('[data-ix-leg]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.ixLeg;
                state.hidden = { ...(state.hidden || {}) };
                state.hidden[key] = !state.hidden[key];
                remount(panel, state);
            });
        });
        panel.querySelectorAll('[data-ix-href]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.ixHref;
                state.hrefHidden = { ...(state.hrefHidden || {}) };
                state.hrefHidden[key] = !state.hrefHidden[key];
                remount(panel, state);
            });
        });
        panel.querySelectorAll('[data-ix-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                applyMode(state, btn.dataset.ixMode);
                remount(panel, state);
                const labels = {
                    comprar: 'Modo Comprar: BB + Nuevo + BSR · avg90 + alerta + break-even',
                    vender: 'Modo Vender: BB + Amazon · tu precio + break-even + ventas',
                    competencia: 'Modo Competencia: BB + Amazon + FBA/FBM + BSR',
                    mia: 'Modo Mi operación: BB + BSR · tus refs',
                };
                UI.toast?.(labels[btn.dataset.ixMode] || 'Modo aplicado');
            });
        });
        panel.querySelectorAll('[data-ix-range]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                const range = Number(btn.dataset.ixRange);
                if (!Number.isFinite(range) || range <= 0) return;
                if (Number(state.graph?.range) === range && !state.brush) return;
                state.graph = { ...state.graph, range };
                state.brush = null;
                state.pins = [];
                state.onGraphChange?.(state.graph);
                remount(panel, state);
                const label = RANGE_CHIPS.find(([v]) => v === range)?.[1] || `${range}d`;
                UI.toast?.(`Periodo: ${label}`);
            });
        });
        panel.querySelector('[data-ix-act="areas"]')?.addEventListener('click', () => {
            state.showAreas = state.showAreas === false ? true : false;
            remount(panel, state);
        });
        panel.querySelector('[data-ix-act="yzoom"]')?.addEventListener('click', () => {
            state.graph = { ...state.graph, yzoom: !state.graph.yzoom };
            state.onGraphChange?.(state.graph);
            remount(panel, state);
        });
        panel.querySelector('[data-ix-act="goto-min"]')?.addEventListener('click', () => {
            const metaEl = panel.querySelector('.keepa-ix-meta');
            let meta;
            try { meta = JSON.parse(metaEl?.value || '{}'); } catch { return; }
            const mn = meta.minPoint;
            if (!mn?.t) return;
            const padMs = 7 * 24 * 60 * 60 * 1000;
            state.brush = { tMin: mn.t - padMs, tMax: mn.t + padMs };
            state.pins = [{ t: mn.t }];
            remount(panel, state);
            UI.toast?.(`Mínimo ${mxn(mn.v)}`);
        });
        panel.querySelector('[data-ix-act="alert-min"]')?.addEventListener('click', () => {
            const metaEl = panel.querySelector('.keepa-ix-meta');
            let meta;
            try { meta = JSON.parse(metaEl?.value || '{}'); } catch { return; }
            const mn = meta.minPoint;
            if (!mn?.v) return;
            const v = Math.round(mn.v * 100) / 100;
            writeAlert(state.data?.asin, v);
            state.hrefHidden = { ...(state.hrefHidden || {}), alert: false };
            remount(panel, state);
            UI.toast?.(`Alerta: Buy Box ≤ ${mxn(v)}`);
            const price = state.data?.buyBox ?? state.data?.currentPrice;
            if (price != null && price <= v) {
                UI.toast?.(`${state.data.asin}: BB ${mxn(price)} ya ≤ alerta`, 'success', { pulse: true });
            }
        });
        panel.querySelector('[data-ix-act="apply-bb"]')?.addEventListener('click', () => {
            const price = state.data?.buyBox ?? state.data?.marketPrice ?? state.data?.currentPrice;
            const lote = linkedLote(state.data?.asin);
            if (price == null || !lote) {
                UI.toast?.('Sin lote linkeado o Buy Box', 'error');
                return;
            }
            if (typeof state.onApplyBuyBox === 'function') {
                state.onApplyBuyBox(price, lote);
                return;
            }
            UI.toast?.(`Buy Box sugerido: ${mxn(price)} (aplica desde Keepa Lab o edita el lote)`);
        });
        panel.querySelector('[data-ix-act="reset-zoom"]')?.addEventListener('click', () => {
            state.brush = null;
            remount(panel, state);
        });
        panel.querySelector('[data-ix-act="export-csv"]')?.addEventListener('click', () => {
            const metaEl = panel.querySelector('.keepa-ix-meta');
            try {
                exportCsv(JSON.parse(metaEl?.value || '{}'), state.data);
            } catch { /* ignore */ }
        });
        panel.querySelector('[data-ix-act="export-png"]')?.addEventListener('click', () => {
            exportPng(panel, state.data?.asin).catch(() => UI.toast?.('No se pudo exportar PNG', 'error'));
        });
        panel.querySelector('[data-ix-act="compare"]')?.addEventListener('click', async () => {
            const raw = panel.querySelector('[data-ix-compare]')?.value || '';
            const asin = window.Keepa?.extractAsin?.(raw) || String(raw).trim().toUpperCase();
            if (!/^[A-Z0-9]{10}$/.test(asin)) {
                UI.toast?.('ASIN inválido', 'error');
                return;
            }
            if (asin === String(state.data?.asin || '').toUpperCase()) {
                UI.toast?.('Elige un ASIN distinto al principal', 'error');
                return;
            }
            try {
                if (state.compareAsin === asin && state.compareData) {
                    remount(panel, state);
                    return;
                }
                const ok = await UI.confirm({
                    title: 'Cargar ASIN B',
                    message: `Se investigará ${asin} para superponer su historial (~3–5 tokens si no está en caché).`,
                    primaryLabel: 'Cargar B',
                });
                if (!ok) return;
                UI.toast?.(`Cargando ${asin}…`);
                const cmp = await Keepa.fetchResearch(asin);
                state.compareData = cmp;
                state.compareAsin = asin;
                remount(panel, state);
                UI.toast?.(`VS ${asin} listo`, 'success');
            } catch (err) {
                UI.toast?.(err.message || 'Error al comparar', 'error');
            }
        });
        panel.querySelector('[data-ix-act="compare-clear"]')?.addEventListener('click', () => {
            state.compareData = null;
            state.compareAsin = '';
            remount(panel, state);
            UI.toast?.('Serie B quitada');
        });
        panel.querySelector('[data-ix-act="alert-save"]')?.addEventListener('click', () => {
            const v = Number(panel.querySelector('[data-ix-alert]')?.value);
            writeAlert(state.data?.asin, Number.isFinite(v) && v > 0 ? v : null);
            remount(panel, state);
            UI.toast?.(Number.isFinite(v) && v > 0
                ? `Alerta guardada: Buy Box ≤ ${mxn(v)}`
                : 'Alerta eliminada');
            const price = state.data?.buyBox ?? state.data?.currentPrice;
            if (Number.isFinite(v) && price != null && price <= v) {
                UI.toast?.(`${state.data.asin}: Buy Box ${mxn(price)} ≤ ${mxn(v)}`, 'success', { pulse: true });
            }
        });
    }

    function mount(container, opts = {}) {
        if (!container) return null;
        const state = {
            data: opts.data,
            compareData: opts.compareData || null,
            compareAsin: opts.compareAsin || '',
            graph: { ...(opts.graph || {}) },
            overlays: opts.overlays || overlaysFromLote(linkedLote(opts.data?.asin)),
            compact: Boolean(opts.compact),
            showAreas: opts.showAreas !== false,
            hidden: { ...(opts.hidden || {}) },
            hrefHidden: { ...(opts.hrefHidden || {}) },
            mode: opts.mode || '',
            brush: opts.brush || null,
            pins: opts.pins || [],
            onGraphChange: opts.onGraphChange || null,
            onApplyBuyBox: opts.onApplyBuyBox || null,
            onAfterRemount: null,
        };
        state.overlays = { ...state.overlays, avg90: opts.data?.avg90 ?? null };

        const holder = document.createElement('div');
        holder.innerHTML = html(state);
        const panel = holder.firstElementChild;
        container.innerHTML = '';
        container.appendChild(panel);
        bind(panel, state);
        return state;
    }

    return {
        COLORS,
        LINE_KEYS,
        PRESET_MIA,
        PRESET_COMPRAR,
        PRESET_VENDER,
        PRESET_COMPETENCIA,
        decisionScore,
        overlaysFromLote,
        linkedLote,
        readAlert,
        writeAlert,
        html,
        mount,
        bind,
    };
})();
window.KeepaChart = KeepaChart;
