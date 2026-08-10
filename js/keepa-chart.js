/* ==========================================================================
   KeepaChart — gráfica interactiva propia (historial Keepa + overlays de negocio).
   Usada en Keepa Lab y (compacta) en Productos.
   ========================================================================== */

const KeepaChart = (() => {
    /* Series = bandas del arcoíris iOS; el chrome del panel sigue minimal Apple. */
    const COLORS = {
        amazon: '#FF9F0A',   /* orange */
        new: '#0A84FF',      /* blue */
        bb: '#30D158',       /* green */
        used: '#8E8E93',     /* gray */
        fba: '#BF5AF2',      /* purple */
        fbm: '#5E5CE6',      /* indigo */
        salesrank: '#FF375F',/* pink */
        ld: '#FFD60A',       /* yellow */
        wd: '#64D2FF',       /* teal */
        compare: '#00C7BE',  /* mint */
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

    const PRESET_MIA = {
        amazon: false, new: false, bb: true, used: false,
        fba: false, fbm: false, salesrank: true, ld: false, wd: false,
        yzoom: true,
    };

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
        const colorShift = opts.colorShift || null;
        return LINE_KEYS
            .filter(([key]) => graph[key] && !hidden[key] && history[key]?.points?.length)
            .map(([key, label]) => {
                const raw = filterByRange(history[key].points, graph.range, brush);
                return {
                    key: prefix + key,
                    srcKey: key,
                    label: prefix ? `${label} · B` : label,
                    kind: history[key].kind || (key === 'salesrank' ? 'rank' : 'price'),
                    color: colorShift || COLORS[key] || '#1d1d1f',
                    dashed: Boolean(prefix),
                    points: downsample(raw),
                };
            })
            .filter(s => s.points.length > 1);
    }

    function signalBadges(data, overlays) {
        const badges = [];
        const price = data?.buyBox ?? data?.marketPrice ?? data?.currentPrice;
        const avg90 = data?.avg90;
        if (price != null && avg90 > 0 && price < avg90 * 0.92) {
            badges.push({ tone: 'good', text: 'Recompra · bajo avg90' });
        } else if (price != null && avg90 > 0 && price > avg90 * 1.08) {
            badges.push({ tone: 'warn', text: 'Precio caro vs 90d' });
        }
        if (data?.vs90 != null && data?.bsrVs90 != null) {
            if (data.vs90 < -0.05 && data.bsrVs90 < 0) {
                badges.push({ tone: 'good', text: 'Precio baja + BSR mejora' });
            } else if (data.vs90 > 0.05 && data.bsrVs90 > 0.1) {
                badges.push({ tone: 'bad', text: 'Precio sube + BSR empeora' });
            }
        }
        const alert = readAlert(data?.asin);
        if (alert != null && price != null && price <= alert) {
            badges.push({ tone: 'good', text: `Alerta: BB ≤ ${mxn(alert)}` });
        }
        if (overlays?.costo != null && price != null) {
            const edge = price - overlays.costo;
            badges.push({
                tone: edge >= 0 ? 'good' : 'bad',
                text: `vs costo ${edge >= 0 ? '+' : ''}${mxn(edge)}`,
            });
        }
        return badges;
    }

    function html(opts = {}) {
        const data = opts.data;
        const compare = opts.compareData || null;
        const graph = opts.graph || {};
        const compact = Boolean(opts.compact);
        const showAreas = opts.showAreas !== false;
        const hidden = opts.hidden || {};
        const brush = opts.brush || null;
        const overlays = opts.overlays || overlaysFromLote(linkedLote(data?.asin));
        const uid = opts.uid || `ix-${Math.random().toString(36).slice(2, 8)}`;

        let series = buildSeries(data, graph, { hidden, brush });
        if (compare?.history) {
            series = series.concat(buildSeries(compare, graph, {
                hidden, brush, prefix: 'c:', colorShift: COLORS.compare,
            }));
        }

        const alertBelow = readAlert(data?.asin);
        const badges = signalBadges(data, overlays);

        if (!series.length) {
            const hasHistory = data?.history && Object.keys(data.history).length > 0;
            return `
                <section class="keepa-ix-panel float-surface${compact ? ' is-compact' : ''}" data-keepa-ix="${esc(uid)}">
                    <div class="keepa-ix-head">
                        <div>
                            <h3>Gráfica interactiva</h3>
                            <p class="muted small">Historial Keepa + tu operación.</p>
                        </div>
                    </div>
                    <div class="keepa-ix-empty muted small">
                        ${hasHistory
                            ? 'Activa una serie con datos en el rango (o quita el zoom).'
                            : 'Sin historial. Vuelve a cargar el ASIN con Investigar / Buy Box.'}
                    </div>
                </section>`;
        }

        const W = compact ? 720 : 960;
        const H = compact ? 240 : 340;
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
        const refVals = [overlays.costo, overlays.precio, overlays.breakEven, overlays.avg90 ?? data?.avg90]
            .filter(v => v != null && Number.isFinite(v));
        let pMin = priceVals.length ? Math.min(...priceVals, ...refVals) : 0;
        let pMax = priceVals.length ? Math.max(...priceVals, ...refVals) : 1;
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
        if (avg90 != null && avg90 > pMin) {
            const yTop = yPrice(Math.min(avg90, pMax));
            const yBot = pad.t + plotH;
            avgZone = `<rect class="keepa-ix-avgzone" x="${pad.l}" y="${yTop.toFixed(1)}"
                width="${plotW}" height="${Math.max(0, yBot - yTop).toFixed(1)}" />`;
        }

        const hrefLines = [
            { key: 'costo', v: overlays.costo, color: '#FF453A', label: 'Costo' },
            { key: 'be', v: overlays.breakEven, color: '#FF9F0A', label: 'Break-even' },
            { key: 'precio', v: overlays.precio, color: '#0A84FF', label: 'Tu precio' },
            { key: 'avg90', v: avg90, color: '#30D158', label: 'Avg 90d', dash: '5 4' },
            { key: 'alert', v: alertBelow, color: '#BF5AF2', label: 'Alerta', dash: '2 3' },
        ].filter(h => h.v != null && h.v >= pMin && h.v <= pMax);

        const hrefSvg = hrefLines.map(h => {
            const y = yPrice(h.v).toFixed(1);
            return `
                <line class="keepa-ix-href" x1="${pad.l}" x2="${pad.l + plotW}" y1="${y}" y2="${y}"
                    stroke="${esc(h.color)}" stroke-dasharray="${h.dash || '0'}" />
                <text class="keepa-ix-href-label" x="${pad.l + 4}" y="${(Number(y) - 4).toFixed(1)}"
                    fill="${esc(h.color)}">${esc(h.label)} ${esc(mxn(h.v))}</text>`;
        }).join('');

        // Min / max on primary price series (bb → amazon → new)
        const primary = priceSeries.find(s => s.srcKey === 'bb')
            || priceSeries.find(s => s.srcKey === 'amazon')
            || priceSeries[0];
        let extrema = '';
        if (primary?.points?.length) {
            let mn = primary.points[0];
            let mx = primary.points[0];
            primary.points.forEach(p => {
                if (p.v < mn.v) mn = p;
                if (p.v > mx.v) mx = p;
            });
            extrema = `
                <g class="keepa-ix-extrema">
                    <circle cx="${xAt(mn.t).toFixed(1)}" cy="${yPrice(mn.v).toFixed(1)}" r="4" fill="#30D158" stroke="#fff" stroke-width="1.5"/>
                    <text x="${xAt(mn.t).toFixed(1)}" y="${(yPrice(mn.v) - 8).toFixed(1)}" text-anchor="middle" class="keepa-ix-extrema-lbl">min ${esc(mxn(mn.v))}</text>
                    <circle cx="${xAt(mx.t).toFixed(1)}" cy="${yPrice(mx.v).toFixed(1)}" r="4" fill="#FF375F" stroke="#fff" stroke-width="1.5"/>
                    <text x="${xAt(mx.t).toFixed(1)}" y="${(yPrice(mx.v) - 8).toFixed(1)}" text-anchor="middle" class="keepa-ix-extrema-lbl">max ${esc(mxn(mx.v))}</text>
                </g>`;
        }

        const ventas = (overlays.ventas || []).filter(v => v.t >= tMin && v.t <= tMax);
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
            return `<path class="keepa-ix-line${thick}" data-ix-key="${esc(s.key)}" d="${d}" fill="none" stroke="${esc(s.color)}"${dash} />`;
        }).join('');

        const grads = priceSeries.filter(s => !s.dashed).slice(0, 2).map(s => `
            <linearGradient id="${uid}-fill-${esc(s.key)}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${esc(s.color)}" stop-opacity="0.16"/>
                <stop offset="100%" stop-color="${esc(s.color)}" stop-opacity="0"/>
            </linearGradient>`).join('');

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
            },
            series: series.map(s => ({
                key: s.key, srcKey: s.srcKey, label: s.label, kind: s.kind, color: s.color, points: s.points,
            })),
            pins: opts.pins || [],
        };

        const legendKeys = LINE_KEYS.filter(([key]) => data?.history?.[key]?.points?.length);

        return `
            <section class="keepa-ix-panel float-surface${compact ? ' is-compact' : ''}" data-keepa-ix="${esc(uid)}">
                <div class="keepa-ix-head">
                    <div>
                        <h3>Gráfica interactiva${compare ? ' · vs competencia' : ''}</h3>
                        <p class="muted small">Misma lectura Keepa · pin A/B · zoom por arrastre · sin tokens al cambiar series.</p>
                    </div>
                    ${badges.length ? `
                        <div class="keepa-ix-badges">
                            ${badges.map(b => `<span class="keepa-badge keepa-ix-badge tone-${esc(b.tone)}">${esc(b.text)}</span>`).join('')}
                        </div>` : ''}
                </div>
                <div class="keepa-graph-controls">
                    <div class="keepa-graph-row">
                        <span class="muted small">Series</span>
                        <div class="keepa-chip-group">
                            ${legendKeys.map(([key, label]) => `
                                <button type="button" class="keepa-chip keepa-ix-leg${hidden[key] ? '' : ' active'}"
                                    data-ix-leg="${esc(key)}" style="--c:${esc(COLORS[key])}">
                                    <i class="keepa-ix-dot" style="background:${esc(COLORS[key])}"></i>${esc(label)}
                                </button>`).join('')}
                        </div>
                    </div>
                    <div class="keepa-graph-row">
                        <span class="muted small">Vista</span>
                        <div class="keepa-chip-group">
                            <button type="button" class="keepa-chip${showAreas ? ' active' : ''}" data-ix-act="areas">Áreas</button>
                            <button type="button" class="keepa-chip${graph.yzoom ? ' active' : ''}" data-ix-act="yzoom">Zoom Y</button>
                            <button type="button" class="keepa-chip" data-ix-act="preset-mia">Mi operación</button>
                            <button type="button" class="keepa-chip" data-ix-act="reset-zoom" ${brush ? '' : 'disabled'}>Reset zoom</button>
                        </div>
                        <div class="keepa-chip-group keepa-graph-presets">
                            <button type="button" class="keepa-chip" data-ix-act="export-csv">CSV</button>
                            <button type="button" class="keepa-chip" data-ix-act="export-png">PNG</button>
                        </div>
                    </div>
                    ${compact ? '' : `
                    <div class="keepa-graph-row keepa-ix-extra-row">
                        <label class="keepa-ix-field">
                            <span class="muted small">Comparar</span>
                            <input type="text" data-ix-compare placeholder="ASIN o link" value="${esc(opts.compareAsin || '')}">
                        </label>
                        <button type="button" class="btn ghost sm" data-ix-act="compare">Cargar</button>
                        ${compare ? `<button type="button" class="btn ghost sm" data-ix-act="compare-clear">Quitar</button>` : ''}
                        <label class="keepa-ix-field">
                            <span class="muted small">Alerta BB ≤</span>
                            <input type="number" min="0" step="1" data-ix-alert placeholder="MXN"
                                value="${alertBelow != null ? esc(alertBelow) : ''}">
                        </label>
                        <button type="button" class="btn ghost sm" data-ix-act="alert-save">Guardar alerta</button>
                    </div>`}
                </div>
                <div class="keepa-graph-box keepa-ix-chart">
                    <svg class="keepa-ix-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Historial Keepa">
                        <defs>${grads}</defs>
                        <rect class="keepa-ix-plot" x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" />
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
                        <line class="keepa-ix-cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + plotH}" hidden />
                        <g class="keepa-ix-pins"></g>
                        <g class="keepa-ix-dots"></g>
                        <rect class="keepa-ix-hit" x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}"
                            fill="transparent" tabindex="0" aria-label="Explorar historial" />
                    </svg>
                    <textarea class="keepa-ix-meta" hidden>${JSON.stringify(meta).replace(/</g, '\\u003c')}</textarea>
                </div>
                <p class="muted small keepa-ix-tip">Pasa el cursor · clic pin A/B · arrastra para zoom.</p>
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
            // Empty state — still wire toolbar if any
            wireChrome(panel, state);
            return;
        }

        let meta;
        try { meta = JSON.parse(metaEl.value || '{}'); }
        catch { return; }

        const cross = panel.querySelector('.keepa-ix-cross');
        const dots = panel.querySelector('.keepa-ix-dots');
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
        const plotHSafe = () => meta.plotH;

        const paintTip = (t, x) => {
            if (cross) {
                cross.setAttribute('x1', x.toFixed(1));
                cross.setAttribute('x2', x.toFixed(1));
                cross.removeAttribute('hidden');
            }
            if (dots) dots.innerHTML = '';
            const rows = [];
            let primaryPrice = null;
            meta.series.forEach(s => {
                const pt = nearestPoint(s.points, t);
                if (!pt) return;
                if (s.kind === 'price' && (s.srcKey === 'bb' || primaryPrice == null)) primaryPrice = pt.v;
                const y = s.kind === 'rank' ? yRank(pt.v) : yPrice(pt.v);
                if (dots) {
                    dots.insertAdjacentHTML('beforeend',
                        `<circle cx="${xAt(pt.t).toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${s.color}" stroke="#fff" stroke-width="1.5"/>`);
                }
                const val = s.kind === 'rank'
                    ? `#${Math.round(pt.v).toLocaleString('es-MX')}`
                    : mxn(pt.v);
                rows.push(`<span style="color:${s.color}"><strong>${esc(s.label)}</strong> ${esc(val)}</span>`);
            });

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
            }
            if (pins.length === 2) {
                const pa = nearestPoint(
                    meta.series.find(s => s.srcKey === 'bb')?.points
                        || meta.series.find(s => s.kind === 'price')?.points || [],
                    pins[0].t
                );
                const pb = nearestPoint(
                    meta.series.find(s => s.srcKey === 'bb')?.points
                        || meta.series.find(s => s.kind === 'price')?.points || [],
                    pins[1].t
                );
                if (pa && pb && pa.v > 0) {
                    deltas.push(`A→B ${pct((pb.v - pa.v) / pa.v)} (${mxn(pa.v)} → ${mxn(pb.v)})`);
                }
            }

            const when = new Date(t).toLocaleString('es-MX', {
                day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            });
            tip.innerHTML = `<strong>${esc(when)}</strong> · ${rows.join(' · ')}`
                + (deltas.length ? `<br><span class="keepa-ix-deltas">${deltas.map(esc).join(' · ')}</span>` : '');
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
                // Pin A / B
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
            cross?.setAttribute('hidden', '');
            if (dots) dots.innerHTML = '';
        });
        paintPins();
        wireChrome(panel, state);
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
        panel.querySelector('[data-ix-act="areas"]')?.addEventListener('click', () => {
            state.showAreas = state.showAreas === false ? true : false;
            remount(panel, state);
        });
        panel.querySelector('[data-ix-act="yzoom"]')?.addEventListener('click', () => {
            state.graph = { ...state.graph, yzoom: !state.graph.yzoom };
            state.onGraphChange?.(state.graph);
            remount(panel, state);
        });
        panel.querySelector('[data-ix-act="preset-mia"]')?.addEventListener('click', () => {
            state.graph = { ...state.graph, ...PRESET_MIA };
            state.hidden = {};
            state.onGraphChange?.(state.graph);
            remount(panel, state);
            UI.toast?.('Preset: Buy Box + BSR + zoom Y');
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
            try {
                UI.toast?.('Cargando ASIN a comparar…');
                const cmp = await Keepa.fetchResearch(asin);
                state.compareData = cmp;
                state.compareAsin = asin;
                remount(panel, state);
            } catch (err) {
                UI.toast?.(err.message || 'Error al comparar', 'error');
            }
        });
        panel.querySelector('[data-ix-act="compare-clear"]')?.addEventListener('click', () => {
            state.compareData = null;
            state.compareAsin = '';
            remount(panel, state);
        });
        panel.querySelector('[data-ix-act="alert-save"]')?.addEventListener('click', () => {
            const v = Number(panel.querySelector('[data-ix-alert]')?.value);
            writeAlert(state.data?.asin, Number.isFinite(v) && v > 0 ? v : null);
            remount(panel, state);
            UI.toast?.(Number.isFinite(v) && v > 0
                ? `Alerta guardada: Buy Box ≤ ${mxn(v)}`
                : 'Alerta eliminada');
            // Aviso inmediato si ya está por debajo
            const price = state.data?.buyBox ?? state.data?.currentPrice;
            if (Number.isFinite(v) && price != null && price <= v) {
                UI.toast?.(`⚡ ${state.data.asin}: Buy Box ${mxn(price)} ≤ ${mxn(v)}`, 'success', { pulse: true });
            }
        });
    }

    /** Inserta/reemplaza gráfica en un contenedor. */
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
            brush: opts.brush || null,
            pins: opts.pins || [],
            onGraphChange: opts.onGraphChange || null,
            onAfterRemount: null,
        };
        // avg90 on overlays for zone
        state.overlays = { ...state.overlays, avg90: opts.data?.avg90 ?? null };

        const holder = document.createElement('div');
        holder.innerHTML = html(state);
        const panel = holder.firstElementChild;
        container.innerHTML = '';
        container.appendChild(panel);
        state.onAfterRemount = (next) => {
            /* panel reference updates via remount */
        };
        bind(panel, state);
        return state;
    }

    function renderHtml(opts) {
        return html(opts);
    }

    return {
        COLORS,
        LINE_KEYS,
        PRESET_MIA,
        overlaysFromLote,
        linkedLote,
        readAlert,
        writeAlert,
        html: renderHtml,
        mount,
        bind,
    };
})();
window.KeepaChart = KeepaChart;
