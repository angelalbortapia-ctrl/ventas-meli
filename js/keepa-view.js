/* ==========================================================================
   Keepa Lab — investigación Amazon MX con control explícito de tokens.
   ========================================================================== */

const KeepaView = (() => {
    const GRAPH_HEIGHT = 520;
    const GRAPH_DEFAULTS = {
        range: 90,
        amazon: true,
        new: true,
        used: false,
        bb: true,
        salesrank: true,
        fba: false,
        fbm: false,
        ld: false,
        wd: false,
        yzoom: false,
        height: GRAPH_HEIGHT,
    };

    const GRAPH_LINES = [
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

    const GRAPH_RANGES = [
        [7, '7d'], [30, '30d'], [90, '90d'], [180, '6m'], [365, '1a'], [730, '2a'],
    ];

    const GRAPH_PRESETS = {
        precio: { amazon: true, new: true, bb: true, used: false, fba: false, fbm: false, salesrank: false, ld: false, wd: false },
        demanda: { amazon: true, new: true, bb: true, used: false, fba: false, fbm: false, salesrank: true, ld: false, wd: false },
        competencia: { amazon: true, new: false, bb: true, used: false, fba: true, fbm: true, salesrank: false, ld: false, wd: false },
        mia: { ...(window.KeepaChart?.PRESET_MIA || {
            amazon: false, new: false, bb: true, used: false, fba: false, fbm: false, salesrank: true, ld: false, wd: false, yzoom: true,
        }) },
    };

    /** Caché de imágenes ya pagadas: alternar filtros vistos no vuelve a cobrar tokens. */
    const GRAPH_CACHE_MAX = 12;
    const graphCache = new Map();

    const local = {
        section: 'research',
        asin: '',
        research: null,
        graphUrl: '',
        graphKey: '',
        graph: { ...GRAPH_DEFAULTS },
        graphView: 'compare', /* official | ours | compare */
        finder: {
            asins: [],
            cards: {},
            page: 0,
            pageSize: 12,
            totalResults: null,
            searched: false,
            selection: null,
        },
        libQuery: '',
        seller: null,
        deals: [],
        researchSeq: 0,
        compareResearch: null,
        compareAsin: '',
        ixState: null,
    };

    const esc = value => UI.escapeHTML(String(value ?? ''));
    const mxn = value => value == null ? '—' : Calc.fmtMXN(value);
    const num = value => value == null ? '—' : Number(value).toLocaleString('es-MX');

    function loadGraphPrefs() {
        const saved = window.State?.ui?.keepaGraph;
        if (saved && typeof saved === 'object') {
            const merged = { ...GRAPH_DEFAULTS, ...saved, height: GRAPH_HEIGHT };
            if (GRAPH_LINES.some(([key]) => merged[key])) {
                local.graph = merged;
            } else {
                // Sin ninguna serie la gráfica saldría vacía: volvemos al set por defecto.
                local.graph = { ...GRAPH_DEFAULTS };
                saveGraphPrefs();
            }
        }
        const view = window.State?.ui?.keepaGraphView;
        if (view === 'official' || view === 'ours' || view === 'compare') {
            local.graphView = view;
        }
    }

    function saveGraphPrefs() {
        if (!window.State?.ui) return;
        window.State.ui.keepaGraph = { ...local.graph };
        window.State.ui.keepaGraphView = local.graphView;
        window.State.save?.();
    }

    function rangeLabel(days) {
        const n = Number(days) || 90;
        const hit = GRAPH_RANGES.find(([v]) => v === n)
            || [[3650, 'Máx']].find(([v]) => v === n);
        return hit ? hit[1] : `${n}d`;
    }

    function bbPointsInRange(data, rangeDays) {
        const pts = data?.history?.bb?.points;
        if (!Array.isArray(pts) || !pts.length) return [];
        const days = Math.max(1, Number(rangeDays) || 90);
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        return pts.filter(p => p?.t >= cutoff && Number.isFinite(p.v));
    }

    function bbExtremaInRange(data, rangeDays) {
        const inRange = bbPointsInRange(data, rangeDays);
        if (!inRange.length) return null;
        let min = inRange[0];
        let max = inRange[0];
        inRange.forEach(p => {
            if (p.v < min.v) min = p;
            if (p.v > max.v) max = p;
        });
        return { min: min.v, max: max.v, minT: min.t, maxT: max.t };
    }

    function pctTxt(v) {
        if (v == null || !Number.isFinite(Number(v))) return '—';
        const n = Number(v);
        return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
    }

    function daysAgoLabel(ts) {
        if (!Number.isFinite(ts)) return '—';
        const days = Math.max(0, Math.round((Date.now() - ts) / 86400000));
        if (days <= 0) return 'hoy';
        if (days === 1) return 'hace 1 día';
        return `hace ${days} días`;
    }

    function linkedLoteFor(data) {
        return window.KeepaChart?.linkedLote?.(data?.asin)
            || (window.State?.lotes || []).find(l =>
                String(l.asin || '').trim().toUpperCase() === String(data?.asin || '').trim().toUpperCase()
            )
            || null;
    }

    function buildOfficialInsights(data) {
        const range = Number(local.graph.range) || 90;
        const bb = data?.buyBox ?? data?.marketPrice ?? data?.currentPrice ?? null;
        const avg90 = data?.avg90 ?? null;
        const vsAvg = (bb != null && avg90 > 0) ? (bb - avg90) / avg90 : (data?.vs90 ?? null);
        const extrema = bbExtremaInRange(data, range);
        const lookbackPts = bbPointsInRange(data, 90);

        let daysUnder = 0;
        if (avg90 > 0 && lookbackPts.length) {
            const daySet = new Set();
            lookbackPts.forEach(p => {
                if (p.v < avg90 * 0.995) daySet.add(new Date(p.t).toDateString());
            });
            daysUnder = daySet.size;
        }

        const lote = linkedLoteFor(data);
        const overlays = window.KeepaChart?.overlaysFromLote?.(lote) || {};
        const breakEven = overlays.breakEven ?? null;
        const costo = Number(lote?.costo) || null;
        const tuPrecio = Number(lote?.precio) || null;
        let utilBb = null;
        let margenBb = null;
        let roiBb = null;
        if (lote && bb != null && window.Calc?.utilidadAtPrice) {
            try {
                const u = Calc.utilidadAtPrice(lote, bb, window.State?.settings);
                utilBb = u.utilidad;
                margenBb = u.margen;
                if (costo > 0 && utilBb != null) roiBb = utilBb / costo;
            } catch { /* ignore */ }
        }

        const gapBe = (bb != null && breakEven != null) ? bb - breakEven : null;
        const gapTuPrecio = (bb != null && tuPrecio != null) ? tuPrecio - bb : null;

        const bsr = data?.bsr ?? null;
        const bsrVs90 = data?.bsrVs90 ?? null;
        let demandaTone = 'neutral';
        let demandaTxt = 'Sin señal clara de BSR';
        if (bsrVs90 != null) {
            // BSR: negativo = mejora (número más bajo)
            if (bsrVs90 <= -0.05) {
                demandaTone = 'good';
                demandaTxt = 'Demanda mejora vs 90d';
            } else if (bsrVs90 >= 0.08) {
                demandaTone = 'bad';
                demandaTxt = 'Demanda empeora vs 90d';
            } else {
                demandaTone = 'neutral';
                demandaTxt = 'Demanda estable vs 90d';
            }
        }

        return {
            range,
            bb,
            avg90,
            vsAvg,
            extrema,
            daysUnder,
            minT: extrema?.minT ?? null,
            tuPrecio,
            gapTuPrecio,
            gapBe,
            utilBb,
            margenBb,
            roiBb,
            hasLote: Boolean(lote),
            bsr,
            bsrVs90,
            monthlySold: data?.monthlySold ?? null,
            demandaTone,
            demandaTxt,
        };
    }

    function indCell(label, value, hint = '') {
        return `
            <div class="keepa-ind-cell">
                <span class="keepa-ind-label">${esc(label)}</span>
                <strong class="keepa-ind-value">${value}</strong>
                ${hint ? `<span class="keepa-ind-hint">${esc(hint)}</span>` : ''}
            </div>`;
    }

    function officialInsightsHtml(data) {
        const s = buildOfficialInsights(data);

        return `
            <div class="keepa-official-insights" id="keepa-official-insights">
                <section class="keepa-ind-block">
                    <h4>Snapshot · ${esc(rangeLabel(s.range))}</h4>
                    <div class="keepa-ind-grid">
                        ${indCell('BB actual', esc(mxn(s.bb)))}
                        ${indCell('Avg 90d', esc(mxn(s.avg90)))}
                        ${indCell('Min', esc(mxn(s.extrema?.min)), s.minT != null ? daysAgoLabel(s.minT) : '')}
                        ${indCell('Max', esc(mxn(s.extrema?.max)))}
                        ${indCell('vs avg90', esc(pctTxt(s.vsAvg)))}
                        ${indCell('Días bajo avg', s.avg90 != null ? esc(String(s.daysUnder)) : '—', 'en 90d')}
                    </div>
                </section>

                <section class="keepa-ind-block">
                    <h4>Tu operación vs mercado</h4>
                    ${s.hasLote ? `
                        <div class="keepa-ind-grid">
                            ${indCell('Tu precio', esc(mxn(s.tuPrecio)), s.gapTuPrecio != null
                                ? (s.gapTuPrecio > 0 ? `${mxn(s.gapTuPrecio)} sobre BB` : `${mxn(Math.abs(s.gapTuPrecio))} bajo BB`)
                                : '')}
                            ${indCell('vs break-even', s.gapBe == null ? '—' : esc(`${s.gapBe >= 0 ? '+' : ''}${mxn(s.gapBe)}`))}
                            ${indCell('Utilidad @ BB', esc(mxn(s.utilBb)), s.margenBb != null ? pctTxt(s.margenBb) : '')}
                            ${indCell('ROI @ BB', esc(pctTxt(s.roiBb)))}
                        </div>` : `
                        <p class="muted small keepa-ind-empty">Sin lote con este ASIN. Vincúlalo en Productos para ver margen y break-even.</p>`}
                </section>

                <section class="keepa-ind-block">
                    <h4>Demanda</h4>
                    <div class="keepa-ind-grid keepa-ind-grid-3">
                        ${indCell('BSR', s.bsr == null ? '—' : esc(Number(s.bsr).toLocaleString('es-MX')))}
                        ${indCell('BSR vs 90d', esc(pctTxt(s.bsrVs90)))}
                        ${indCell('Ventas/mes', s.monthlySold == null ? '—' : esc(`${s.monthlySold}+`))}
                    </div>
                    <p class="keepa-ind-demand tone-${esc(s.demandaTone)}">${esc(s.demandaTxt)}</p>
                </section>
            </div>`;
    }

    function refreshOfficialInsights() {
        const host = document.getElementById('keepa-official-insights');
        if (host && local.research) {
            const holder = document.createElement('div');
            holder.innerHTML = officialInsightsHtml(local.research);
            const next = holder.firstElementChild;
            if (next) host.replaceWith(next);
        }
        const syncBtn = document.getElementById('keepa-dual-sync');
        if (syncBtn) {
            const apply = graphApplyState(local.asin);
            syncBtn.disabled = apply.disabled;
            syncBtn.textContent = apply.disabled && local.graphUrl
                ? 'PNG sincronizado'
                : (graphCache.has(graphKeyFor(local.asin, local.graph))
                    ? 'Sincronizar PNG (caché)'
                    : 'Sincronizar PNG · 1 token');
        }
    }

    function dualChartsHtml(data) {
        const view = local.graphView || 'compare';
        const apply = graphApplyState(data.asin);
        const syncLabel = apply.disabled && local.graphUrl
            ? 'PNG sincronizado'
            : (graphCache.has(graphKeyFor(data.asin, local.graph))
                ? 'Sincronizar PNG (caché)'
                : 'Sincronizar PNG · 1 token');
        return `
            <div class="keepa-dual" id="keepa-dual" data-view="${esc(view)}">
                <div class="keepa-dual-toolbar">
                    <div class="keepa-chip-group" role="group" aria-label="Vista de gráficas">
                        <button type="button" class="keepa-chip${view === 'official' ? ' active' : ''}" data-kv-graph-view="official">Solo oficial</button>
                        <button type="button" class="keepa-chip${view === 'ours' ? ' active' : ''}" data-kv-graph-view="ours">Solo nuestra</button>
                        <button type="button" class="keepa-chip${view === 'compare' ? ' active' : ''}" data-kv-graph-view="compare">Oficial + nuestra</button>
                    </div>
                    <button type="button" class="btn primary sm" id="keepa-dual-sync" ${apply.disabled ? 'disabled' : ''}>${esc(syncLabel)}</button>
                </div>
                <div class="keepa-dual-grid">
                    <div class="keepa-dual-official keepa-dual-col">
                        <div class="keepa-dual-col-label">Oficial Keepa</div>
                        ${graphHtml(data)}
                        ${officialInsightsHtml(data)}
                    </div>
                    <div class="keepa-dual-ours keepa-dual-col">
                        <div class="keepa-dual-col-label">Nuestra lectura</div>
                        <div id="keepa-ix-host" class="keepa-ix-host keepa-ix-host-panel"></div>
                    </div>
                </div>
            </div>`;
    }

    function graphKeyFor(asin, settings) {
        try {
            return window.Keepa?.graphParams?.(asin, settings)?.toString() || '';
        } catch {
            return '';
        }
    }

    function touchGraph(key) {
        if (!graphCache.has(key)) return null;
        const url = graphCache.get(key);
        graphCache.delete(key);
        graphCache.set(key, url);
        return url;
    }

    function cacheGraph(key, url) {
        if (graphCache.has(key)) {
            const prev = graphCache.get(key);
            graphCache.delete(key);
            if (prev && prev !== url && prev !== local.graphUrl) URL.revokeObjectURL(prev);
        }
        graphCache.set(key, url);
        while (graphCache.size > GRAPH_CACHE_MAX) {
            let victim = null;
            for (const candidate of graphCache.keys()) {
                if (candidate !== local.graphKey) {
                    victim = candidate;
                    break;
                }
            }
            if (!victim) victim = graphCache.keys().next().value;
            const stale = graphCache.get(victim);
            graphCache.delete(victim);
            if (stale && stale !== local.graphUrl) URL.revokeObjectURL(stale);
        }
    }

    function clearGraphCache() {
        graphCache.forEach(url => URL.revokeObjectURL(url));
        graphCache.clear();
        local.graphUrl = '';
        local.graphKey = '';
    }

    function knownAsins() {
        const rows = [];
        (window.State.lotes || []).forEach(lote => {
            if (lote.asin) rows.push({ asin: lote.asin, label: lote.producto || lote.sku || lote.asin });
        });
        (window.State.ui?.wishlistAmazon || []).forEach(item => {
            if (item.asin) rows.push({ asin: item.asin, label: item.titulo || item.asin });
        });
        const seen = new Set();
        return rows.filter(row => {
            const key = String(row.asin).toUpperCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function render() {
        const root = document.getElementById('view-keepa');
        if (!root) return;
        loadGraphPrefs();
        if (window.State.marketplace !== 'amazon') {
            root.innerHTML = '<div class="view-head"><div><h2>Keepa Lab</h2><p class="muted">Cambia a Amazon para investigar productos.</p></div></div>';
            return;
        }
        const hasKey = window.Keepa?.hasKey?.();
        const configured = hasKey && window.Keepa?.keyLooksValid?.() !== false;
        root.innerHTML = `
            <div class="view-head keepa-view-head">
                <div>
                    <h2>Keepa Lab</h2>
                    <p class="muted">Precio histórico, demanda, Buy Box, ofertas, Finder y vendedores · Amazon MX.</p>
                </div>
                <div class="keepa-head-actions">
                    ${configured ? `
                        <button type="button" class="btn ghost btn-sm" data-kv-action="scan-catalog"
                            title="Escanea ASINs del catálogo con stock (recompra / BSR / precio)">Escanear catálogo</button>
                    ` : ''}
                    <div class="keepa-token-pill" id="keepa-token-pill">
                        <span class="muted small">Tokens</span>
                        <strong>${configured ? '…' : 'Sin key'}</strong>
                        ${configured ? '<button type="button" class="icon-btn" data-kv-action="tokens" title="Actualizar tokens">↻</button>' : ''}
                    </div>
                </div>
            </div>

            ${configured ? '' : `
                <div class="card keepa-config-alert">
                    <strong>${hasKey ? 'La API key no es válida' : 'Falta configurar Keepa'}</strong>
                    <span class="muted">${hasKey
                        ? 'La key guardada no tiene formato de Keepa (40–80 caracteres alfanuméricos). Vuelve a pegarla.'
                        : 'Pega tu Data API key en Ajustes → Keepa.'}</span>
                    <button type="button" class="btn primary sm" data-kv-action="settings">Abrir Ajustes</button>
                </div>`}

            <nav class="keepa-view-tabs" role="tablist">
                ${[
                    ['research', 'Investigador'],
                    ['library', 'Biblioteca'],
                    ['finder', 'Product Finder'],
                    ['seller', 'Vendedor'],
                    ['deals', 'Deals'],
                ].map(([key, label]) => `
                    <button type="button" class="detail-tab ${local.section === key ? 'active' : ''}"
                        data-kv-section="${key}" role="tab">${label}</button>
                `).join('')}
            </nav>

            <div class="keepa-view-body">
                ${renderSection(configured)}
            </div>
        `;
        bind(root);
        if (configured) refreshTokens(false);
    }

    function renderSection(configured) {
        if (local.section === 'library') return renderLibrary(configured);
        if (local.section === 'finder') return renderFinder(configured);
        if (local.section === 'seller') return renderSeller(configured);
        if (local.section === 'deals') return renderDeals(configured);
        return renderResearch(configured);
    }

    function vitrineTone(i) {
        return `tone-${(i % 4) + 1}`;
    }

    function ageLabel(at) {
        if (!at) return '';
        const days = Math.max(0, Math.round((Date.now() - Number(at)) / 86400000));
        if (days <= 0) return 'Hoy';
        if (days === 1) return 'Hace 1 día';
        if (days < 14) return `Hace ${days} días`;
        if (days < 60) return `Hace ${Math.round(days / 7)} sem.`;
        const months = Math.max(1, Math.round(days / 30));
        return `Hace ${months} mes${months === 1 ? '' : 'es'}`;
    }

    /** Foto de Productos (familia/lote) por ASIN — prioriza lo subido en el catálogo. */
    function catalogImageForAsin(asin) {
        const code = String(asin || '').trim().toUpperCase();
        if (!code) return '';
        const lotes = window.State?.lotes || [];
        const hit = lotes.find(l => String(l.asin || '').trim().toUpperCase() === code);
        if (!hit) return '';
        const fam = window.Data?.familyImage?.(lotes, hit.productId) || '';
        const raw = hit.imagen || fam || '';
        const s = String(raw || '').trim();
        if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(s)) return s;
        if (/^https?:\/\//i.test(s)) return s;
        return '';
    }

    /** Tarjeta vitrina (estilo Apple Store) — Biblioteca / Finder */
    function vitrineCardHtml(row, opts = {}) {
        const i = opts.index || 0;
        const asin = row.asin || '';
        const title = row.title || asin;
        const price = row.buyBox ?? row.currentPrice ?? row.amazon ?? null;
        const tag = row.signalLabel
            || (row.bsr != null ? `BSR ${num(row.bsr)}` : 'Sin señal aún');
        const priceLine = price == null
            ? 'Precio al abrir'
            : `${mxn(price)}${row.avg90 != null ? ` · avg90 ${mxn(row.avg90)}` : ''}`;
        const img = catalogImageForAsin(asin)
            || row.image
            || window.Keepa?.readCache?.(asin)?.image
            || '';
        const media = img
            ? `<img src="${esc(img)}" alt="" loading="lazy">`
            : `<div class="keepa-vitrine-ph" aria-hidden="true"></div>`;
        const primary = opts.mode === 'library'
            ? `<button type="button" class="btn primary sm" data-kv-lib-open="${esc(asin)}">Abrir</button>
               <button type="button" class="btn ghost sm" data-kv-lib-update="${esc(asin)}">Actualizar</button>
               <button type="button" class="btn ghost sm" data-kv-lib-remove="${esc(asin)}" title="Quitar">✕</button>`
            : `<button type="button" class="btn primary sm" data-kv-asin="${esc(asin)}">Investigar</button>
               <button type="button" class="btn ghost sm" data-kv-wishlist="${esc(asin)}"
                   data-kv-wish-title="${esc(row.title || '')}"
                   data-kv-wish-price="${price != null ? esc(String(price)) : ''}">+ Wishlist</button>`;
        const stale = opts.mode === 'library' && row.at && (Date.now() - row.at > 7 * 86400000);
        return `
            <article class="keepa-vitrine-card ${vitrineTone(i)}${stale ? ' is-stale' : ''}${opts.bare ? ' is-bare' : ''}">
                <div class="keepa-vitrine-copy">
                    <code class="keepa-vitrine-asin">${esc(asin)}</code>
                    <h4 class="keepa-vitrine-title">${esc(title)}</h4>
                    <p class="keepa-vitrine-tag">${esc(tag)}${row.monthlySold != null ? ` · ${num(row.monthlySold)}+/mes` : ''}</p>
                    <p class="keepa-vitrine-price">${esc(priceLine)}</p>
                    ${opts.mode === 'library' && row.at
                        ? `<p class="keepa-vitrine-age${stale ? ' is-stale' : ''}">${esc(ageLabel(row.at))}${stale ? ' · conviene actualizar' : ''}</p>`
                        : ''}
                </div>
                <div class="keepa-vitrine-media">${media}</div>
                <div class="keepa-vitrine-actions">${primary}</div>
            </article>`;
    }

    function renderLibrary() {
        const q = String(local.libQuery || '').trim().toLowerCase();
        const all = window.Keepa?.listLibrary?.() || [];
        const rows = q
            ? all.filter(r =>
                String(r.asin || '').toLowerCase().includes(q)
                || String(r.title || '').toLowerCase().includes(q)
                || String(r.signalLabel || '').toLowerCase().includes(q))
            : all;
        if (!all.length) {
            return `
                <section class="keepa-workspace keepa-vitrine-workspace">
                    <header class="keepa-vitrine-hero">
                        <h2>Biblioteca.</h2>
                        <p>Cada investigación se guarda aquí. Reabrir no gasta tokens.</p>
                    </header>
                    <div class="keepa-empty-state">
                        <strong>Aún no hay ASINs guardados</strong>
                        <span class="muted small">Investiga uno y vuelve: aquí vive tu vitrina local.</span>
                        <button type="button" class="btn primary sm" data-kv-jump="research">Ir a Investigar</button>
                    </div>
                </section>`;
        }
        return `
            <section class="keepa-workspace keepa-vitrine-workspace">
                <header class="keepa-vitrine-hero">
                    <div>
                        <h2>Lo guardado.</h2>
                        <p>${all.length} ASIN${all.length === 1 ? '' : 's'} en este dispositivo · Abrir gratis · Actualizar gasta tokens.</p>
                    </div>
                    <label class="keepa-vitrine-search">
                        <span class="sr-only">Buscar en biblioteca</span>
                        <input type="search" id="keepa-lib-search" placeholder="Buscar ASIN o título…" value="${esc(local.libQuery || '')}">
                    </label>
                </header>
                ${!rows.length ? `
                    <div class="keepa-empty-state">
                        <strong>Sin coincidencias</strong>
                        <span class="muted small">Prueba otro término.</span>
                    </div>` : `
                <div class="keepa-vitrine">
                    <div class="keepa-vitrine-nav" aria-hidden="true">
                        <button type="button" class="keepa-vitrine-arrow" data-kv-vitrine-scroll="-1" aria-label="Anterior">‹</button>
                        <button type="button" class="keepa-vitrine-arrow" data-kv-vitrine-scroll="1" aria-label="Siguiente">›</button>
                    </div>
                    <div class="keepa-vitrine-track" id="keepa-lib-track">
                        ${rows.map((row, i) => vitrineCardHtml(row, { mode: 'library', index: i })).join('')}
                    </div>
                </div>`}
            </section>`;
    }

    function renderResearch(configured) {
        const options = knownAsins().map(row =>
            `<option value="${esc(row.asin)}">${esc(row.label)}</option>`
        ).join('');
        return `
            <section class="keepa-workspace">
                <div class="card keepa-query-card">
                    <div class="keepa-card-title">
                        <div><h3>Investigar ASIN</h3><p class="muted small">≈ 3–5 tokens (Buy Box + historial). Se guarda solo en Biblioteca (este dispositivo). Reabrir desde ahí es gratis; Actualizar vuelve a gastar tokens.</p></div>
                    </div>
                    <form id="keepa-research-form" class="keepa-inline-form">
                        <label class="keepa-grow"><span>ASIN o link de Amazon</span>
                            <input id="keepa-research-asin" list="keepa-known-asins" autocomplete="off"
                                placeholder="B0XXXXXXXX o amazon.com.mx/dp/…" value="${esc(local.asin)}">
                            <datalist id="keepa-known-asins">${options}</datalist>
                        </label>
                        <button type="submit" class="btn primary" ${configured ? '' : 'disabled'}>Investigar</button>
                    </form>
                </div>
                <div id="keepa-research-result">
                    ${local.research ? researchHtml(local.research) : `
                        <div class="keepa-empty-state">
                            <span class="keepa-empty-icon">📈</span>
                            <strong>Escribe un ASIN para comenzar</strong>
                            <span class="muted small">Verás si el precio está bajo, estabilidad, BSR, ventas mensuales y quién tiene la Buy Box.</span>
                        </div>`}
                </div>
            </section>
        `;
    }

    function researchHtml(data) {
        const categories = (data.categoryTree || []).slice(-2).map(c => c.name).filter(Boolean).join(' › ');
        const linked = (window.State.lotes || []).filter(lote =>
            String(lote.asin || '').trim().toUpperCase() === String(data.asin || '').trim().toUpperCase()
        );
        const linkedIds = linked.map(lote => lote.id).join(',');
        return `
            <article class="card keepa-research-card">
                <div class="keepa-product-head">
                    ${data.image ? `<img src="${esc(data.image)}" alt="" class="keepa-product-image">` : ''}
                    <div class="keepa-grow">
                        <div class="keepa-product-eyebrow">
                            <code>${esc(data.asin)}</code>
                            ${data.brand ? `<span>${esc(data.brand)}</span>` : ''}
                        </div>
                        <h3>${esc(data.title || data.asin)}</h3>
                        ${categories ? `<p class="muted small">${esc(categories)}</p>` : ''}
                    </div>
                    <span class="keepa-badge" data-signal="${esc(data.signal)}">${esc(data.signalLabel)}</span>
                </div>
                ${linked.length ? `
                    <div class="keepa-product-link">
                        <div>
                            <span class="muted small">Producto vinculado</span>
                            <strong>${esc(linked[0].producto)}${linked.length > 1 ? ` · ${linked.length} variantes` : ''}</strong>
                        </div>
                        <button type="button" class="btn ghost sm" data-kv-product="${esc(linked[0].id)}">Ver en Productos</button>
                        ${data.marketPrice != null ? `
                            <button type="button" class="btn sm" data-kv-apply-price="${esc(linkedIds)}"
                                data-kv-price="${esc(data.marketPrice)}">Usar ${mxn(data.marketPrice)} como competencia</button>
                        ` : ''}
                    </div>
                ` : `
                    <div class="keepa-product-link is-unlinked">
                        <span class="muted small">Este ASIN todavía no está vinculado a un producto. Agrégalo al editar su ficha.</span>
                    </div>
                `}
                <div class="keepa-research-kpis">
                    ${kpi('Buy Box actual', mxn(data.buyBox))}
                    ${kpi('Amazon retail', mxn(data.amazonRetail))}
                    ${kpi('Promedio 30d', mxn(data.avg30))}
                    ${kpi('Promedio 90d', mxn(data.avg90))}
                    ${kpi('BSR actual', num(data.bsr))}
                    ${kpi('Ventas/mes', data.monthlySold == null ? '—' : `${num(data.monthlySold)}+`)}
                    ${kpi('Rating', data.rating == null ? '—' : `${data.rating.toFixed(1)} ★`)}
                    ${kpi('Reviews', num(data.reviews))}
                    ${kpi('Ofertas cargadas', num(data.offerCount || 0))}
                </div>
                <div class="keepa-buybox">
                    <div>
                        <span class="muted small">Buy Box</span>
                        <strong>${data.buyBoxIsAmazon ? 'Amazon' : (data.buyBoxSellerId ? esc(data.buyBoxSellerId) : 'Sin identificar')}</strong>
                    </div>
                    <span class="badge">${data.buyBoxIsFBA ? 'FBA' : (data.buyBoxSellerId ? 'FBM / otro' : '—')}</span>
                    ${data.buyBoxSellerId ? `<button class="btn ghost sm" data-kv-seller="${esc(data.buyBoxSellerId)}">Ver vendedor</button>` : ''}
                    <a class="btn ghost sm" href="https://www.amazon.com.mx/dp/${esc(data.asin)}" target="_blank" rel="noopener">Amazon ↗</a>
                    <a class="btn ghost sm" href="https://keepa.com/#!product/11-${esc(data.asin)}" target="_blank" rel="noopener">Keepa ↗</a>
                </div>
                ${dualChartsHtml(data)}
                <div class="keepa-result-actions">
                    <button type="button" class="btn" data-kv-action="offers">Cargar 20 ofertas + stock</button>
                    <span class="muted small">Esta consulta es más cara (aprox. +6 tokens por cada 10 ofertas).</span>
                </div>
                ${offersHtml(data.offers)}
            </article>
        `;
    }

    function graphApplyState(asin) {
        const g = local.graph;
        if (!GRAPH_LINES.some(([key]) => g[key])) return { label: 'Elige una serie', disabled: true };
        const key = graphKeyFor(asin, g);
        if (local.graphUrl && key === local.graphKey) return { label: 'Gráfica al día', disabled: true };
        return { label: graphCache.has(key) ? 'Aplicar (en caché)' : 'Aplicar · 1 token', disabled: false };
    }

    function graphHtml(data) {
        const g = local.graph;
        const apply = graphApplyState(data.asin);
        return `
            <div class="keepa-graph-panel">
                <div class="keepa-graph-controls" id="keepa-graph-controls">
                    <div class="keepa-graph-row">
                        <span class="muted small">Rango</span>
                        <div class="keepa-chip-group">
                            ${GRAPH_RANGES.map(([value, label]) => `
                                <button type="button" class="keepa-chip ${Number(g.range) === value ? 'active' : ''}"
                                    data-kg-range="${value}">${label}</button>
                            `).join('')}
                        </div>
                        <div class="keepa-chip-group keepa-graph-presets">
                            <button type="button" class="keepa-chip" data-kg-preset="precio">Solo precios</button>
                            <button type="button" class="keepa-chip" data-kg-preset="demanda">Precio + BSR</button>
                            <button type="button" class="keepa-chip" data-kg-preset="competencia">FBA vs FBM</button>
                            <button type="button" class="keepa-chip" data-kg-preset="mia">Mi operación</button>
                        </div>
                    </div>
                    <div class="keepa-graph-row">
                        <span class="muted small">Series</span>
                        <div class="keepa-chip-group">
                            ${GRAPH_LINES.map(([key, label]) => `
                                <button type="button" class="keepa-chip ${g[key] ? 'active' : ''}"
                                    data-kg-line="${key}">${label}</button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="keepa-graph-row keepa-graph-row-actions">
                        <button type="button" class="keepa-chip ${g.yzoom ? 'active' : ''}" data-kg-toggle="yzoom">Zoom eje Y</button>
                        <button type="button" class="btn primary sm" id="keepa-graph-apply" ${apply.disabled ? 'disabled' : ''}>${apply.label}</button>
                        ${local.graphUrl ? `<a class="btn ghost sm" href="${esc(local.graphUrl)}" target="_blank" rel="noopener">Ver grande ↗</a>` : ''}
                    </div>
                </div>
                <div class="keepa-graph-box" id="keepa-graph-box">
                    ${local.graphUrl
                        ? `<img src="${esc(local.graphUrl)}" alt="Gráfica Keepa de ${esc(data.asin)}">`
                        : '<div class="keepa-graph-loading muted">Cargando gráfica Keepa…</div>'}
                </div>
                <p class="muted small keepa-graph-caption">PNG oficial · 1 token al aplicar. La lectura interactiva usa el historial ya cargado.</p>
            </div>`;
    }

    function mountInteractiveChart() {
        const host = document.getElementById('keepa-ix-host');
        if (!host || !local.research || !window.KeepaChart) return;
        const prev = local.ixState || {};
        // Sync compare from chart state if user loaded it inside the chart.
        if (prev.compareData) {
            local.compareResearch = prev.compareData;
            local.compareAsin = prev.compareAsin || '';
        }
        local.ixState = KeepaChart.mount(host, {
            data: local.research,
            compareData: local.compareResearch,
            compareAsin: local.compareAsin,
            graph: local.graph,
            compact: false,
            hidden: prev.hidden || {},
            hrefHidden: prev.hrefHidden || {},
            mode: prev.mode || '',
            brush: prev.brush || null,
            pins: prev.pins || [],
            showAreas: prev.showAreas !== false,
            overlays: KeepaChart.overlaysFromLote(KeepaChart.linkedLote(local.research.asin)),
            onGraphChange: (g) => {
                local.graph = { ...local.graph, ...g };
                saveGraphPrefs();
                syncGraphChipsOnly();
                refreshOfficialInsights();
            },
            onApplyBuyBox: (price, lote) => {
                if (!lote?.id || price == null) return;
                applyCompetitionPrice(String(lote.id), price);
            },
        });
        if (local.ixState) {
            local.ixState.onAfterRemount = () => refreshOfficialInsights();
        }
        refreshOfficialInsights();
    }

    function refreshInteractiveChart() {
        mountInteractiveChart();
    }

    function syncGraphChipsOnly() {
        const panel = document.getElementById('keepa-graph-controls');
        if (!panel) return;
        const g = local.graph;
        panel.querySelectorAll('[data-kg-range]').forEach(chip => {
            chip.classList.toggle('active', Number(chip.dataset.kgRange) === Number(g.range));
        });
        panel.querySelectorAll('[data-kg-line]').forEach(chip => {
            chip.classList.toggle('active', Boolean(g[chip.dataset.kgLine]));
        });
        panel.querySelector('[data-kg-toggle="yzoom"]')?.classList.toggle('active', Boolean(g.yzoom));
        const button = panel.querySelector('#keepa-graph-apply');
        if (button) {
            const apply = graphApplyState(local.asin);
            button.disabled = apply.disabled;
            button.textContent = apply.label;
        }
        refreshOfficialInsights();
    }

    function setGraphView(view) {
        if (view !== 'official' && view !== 'ours' && view !== 'compare') return;
        local.graphView = view;
        saveGraphPrefs();
        const shell = document.getElementById('keepa-dual');
        if (shell) {
            shell.dataset.view = view;
            shell.querySelectorAll('[data-kv-graph-view]').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.kvGraphView === view);
            });
        }
        // Remount interactive if becoming visible again (host may have been empty-sized)
        if (view !== 'official') refreshInteractiveChart();
    }

    function refreshGraphControls() {
        if (!local.research) return;
        syncGraphChipsOnly();
        // La gráfica propia reacciona al instante; el PNG sigue pidiendo “Aplicar”.
        refreshInteractiveChart();
        refreshOfficialInsights();
    }

    function kpi(label, value) {
        return `<div class="kpi-mini"><div class="kpi-mini-label">${label}</div><div class="kpi-mini-value">${value}</div></div>`;
    }

    function offersHtml(offers) {
        if (!Array.isArray(offers) || !offers.length) return '<div id="keepa-offers"></div>';
        return `
            <div id="keepa-offers" class="keepa-offers">
                <h4>Ofertas actuales</h4>
                <div class="keepa-offer-list">
                    ${offers.map((offer, i) => `
                        <div class="keepa-offer-row">
                            <span class="mono">${i + 1}</span>
                            <strong>${mxn(offer.price)}</strong>
                            <span>${offer.isFBA ? 'FBA' : 'FBM'}</span>
                            ${offer.isPrime ? '<span class="badge">Prime</span>' : ''}
                            <button class="btn ghost sm" data-kv-seller="${esc(offer.sellerId)}">${esc(offer.sellerId || 'Seller')}</button>
                            <span class="muted">Stock ${offer.stock == null ? '—' : num(offer.stock)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    function renderFinder(configured) {
        return `
            <section class="keepa-workspace">
                <div class="card">
                    <div class="keepa-card-title">
                        <div><h3>Product Finder · Amazon MX</h3><p class="muted small">Busca en la base de Keepa. Cada búsqueda cuesta aprox. 10 tokens.</p></div>
                        <a class="btn ghost sm" href="https://keepa.com/#!finder" target="_blank" rel="noopener">Finder avanzado ↗</a>
                    </div>
                    <form id="keepa-finder-form" class="keepa-finder-grid">
                        <label class="wide"><span>Palabras en título</span><input id="kf-title" placeholder="Ej. café, almendras, jabón"></label>
                        <label><span>Precio mínimo (MXN)</span><input id="kf-price-min" type="number" min="0" step="1"></label>
                        <label><span>Precio máximo (MXN)</span><input id="kf-price-max" type="number" min="0" step="1"></label>
                        <label><span>BSR máximo</span><input id="kf-bsr-max" type="number" min="1" step="1" placeholder="50000"></label>
                        <label><span>Ventas/mes mín.</span><input id="kf-sales-min" type="number" min="0" step="1" placeholder="50"></label>
                        <label><span>Rating mínimo</span><input id="kf-rating-min" type="number" min="0" max="5" step="0.1" placeholder="4"></label>
                        <label><span>Resultados</span><select id="kf-limit"><option>50</option><option>100</option></select></label>
                        <label><span>Ordenar</span><select id="kf-sort"><option value="current_SALES">Mejor BSR</option><option value="monthlySold">Más ventas</option><option value="current_BUY_BOX_SHIPPING">Menor precio</option></select></label>
                        <button type="submit" class="btn primary" ${configured ? '' : 'disabled'}>Buscar productos</button>
                    </form>
                </div>
                <div id="keepa-finder-results">${finderHtml()}</div>
            </section>`;
    }

    function finderPageSlice() {
        const f = local.finder;
        const size = f.pageSize || 12;
        const start = (f.page || 0) * size;
        return {
            start,
            size,
            asins: (f.asins || []).slice(start, start + size),
            pages: Math.max(1, Math.ceil((f.asins?.length || 0) / size)),
        };
    }

    function finderCardHtml(asin, index) {
        const card = local.finder.cards?.[asin];
        return vitrineCardHtml(card || { asin }, {
            mode: 'finder',
            index,
            bare: !card,
        });
    }

    function finderHtml() {
        const f = local.finder;
        if (!f.searched) {
            return `
                <div class="keepa-empty-state">
                    <span class="keepa-empty-icon">🧭</span>
                    <strong>Define tus filtros</strong>
                    <span class="muted small">Busca oportunidades en Amazon MX. Luego abre una ficha en Investigador.</span>
                </div>`;
        }
        if (!f.asins.length) {
            return `
                <div class="keepa-empty-state">
                    <span class="keepa-empty-icon">∅</span>
                    <strong>Sin resultados</strong>
                    <span class="muted small">Prueba aflojar BSR, precio o palabras del título.</span>
                </div>`;
        }
        const slice = finderPageSlice();
        const totalLabel = f.totalResults != null
            ? `${num(f.totalResults)} en Keepa · mostrando ${f.asins.length}`
            : `${f.asins.length} ASINs`;
        const missing = slice.asins.filter(a => !f.cards[a]).length;
        return `
            <div class="card keepa-finder-board">
                <div class="keepa-card-title">
                    <div>
                        <h3>${esc(totalLabel)}</h3>
                        <span class="muted small">Página ${slice.start / slice.size + 1} / ${slice.pages}. Investigar uno cuesta tokens extra.</span>
                    </div>
                    <div class="keepa-finder-pager">
                        <button type="button" class="btn ghost sm" data-kv-finder-page="-1" ${f.page <= 0 ? 'disabled' : ''}>←</button>
                        <button type="button" class="btn ghost sm" data-kv-finder-page="1" ${f.page >= slice.pages - 1 ? 'disabled' : ''}>→</button>
                        ${missing ? `<button type="button" class="btn sm" data-kv-finder-enrich>~${missing} fichas · ~${missing} tok</button>` : ''}
                    </div>
                </div>
                <div class="keepa-vitrine keepa-vitrine-grid">
                    <div class="keepa-vitrine-track is-grid">
                        ${slice.asins.map((asin, i) => finderCardHtml(asin, slice.start + i)).join('')}
                    </div>
                </div>
            </div>`;
    }

    function renderSeller(configured) {
        return `
            <section class="keepa-workspace">
                <div class="card keepa-query-card">
                    <div class="keepa-card-title"><div><h3>Analizar vendedor</h3><p class="muted small">Rating, reseñas y catálogo del seller · aprox. 1 token.</p></div></div>
                    <form id="keepa-seller-form" class="keepa-inline-form">
                        <label class="keepa-grow"><span>Seller ID</span><input id="keepa-seller-id" placeholder="Ej. A1XXXXXXXXXXXXX"></label>
                        <button type="submit" class="btn primary" ${configured ? '' : 'disabled'}>Consultar</button>
                    </form>
                </div>
                <div id="keepa-seller-result">${sellerHtml(local.seller)}</div>
            </section>`;
    }

    function sellerHtml(data) {
        if (!data) return '<div class="keepa-empty-state"><span class="keepa-empty-icon">🏪</span><strong>Busca un vendedor</strong><span class="muted small">Puedes tomar el Seller ID desde la Buy Box o una oferta.</span></div>';
        return `
            <article class="card">
                <div class="keepa-card-title"><div><span class="muted small">Vendedor</span><h3>${esc(data.sellerName || data.name || data.sellerId || 'Seller')}</h3></div></div>
                <div class="keepa-research-kpis">
                    ${kpi('Rating positivo', data.currentRating == null ? '—' : `${num(data.currentRating)}%`)}
                    ${kpi('Calificaciones', num(data.currentRatingCount))}
                    ${kpi('Última actualización', data.lastUpdate ? 'Disponible' : '—')}
                </div>
                <p class="muted small">El storefront completo (lista de ASINs) cuesta tokens extra; por eso no se pide aquí.</p>
            </article>`;
    }

    function renderDeals(configured) {
        return `
            <section class="keepa-workspace">
                <div class="card">
                    <div class="keepa-card-title">
                        <div><h3>Keepa Deals · Amazon MX</h3><p class="muted small">Busca caídas recientes de precio · aprox. 5 tokens por hasta 150 deals.</p></div>
                        <a class="btn ghost sm" href="https://keepa.com/#!deals" target="_blank" rel="noopener">Deals avanzado ↗</a>
                    </div>
                    <form id="keepa-deals-form" class="keepa-finder-grid">
                        <label class="wide"><span>Palabras en título</span><input id="kd-title" placeholder="Ej. café, hogar, electrónicos"></label>
                        <label><span>Descuento mínimo (%)</span><input id="kd-discount" type="number" min="1" max="99" value="20"></label>
                        <label><span>Precio máximo (MXN)</span><input id="kd-price-max" type="number" min="1" step="1"></label>
                        <label><span>BSR máximo</span><input id="kd-bsr-max" type="number" min="1" step="1" placeholder="100000"></label>
                        <label><span>Rating mínimo</span><input id="kd-rating-min" type="number" min="0" max="5" step="0.1" placeholder="4"></label>
                        <button type="submit" class="btn primary" ${configured ? '' : 'disabled'}>Buscar deals</button>
                    </form>
                </div>
                <div id="keepa-deals-results">${dealsHtml()}</div>
                <div class="keepa-opportunity-grid">
                    <article class="card"><span class="keepa-op-icon">📉</span><h3>Valida el histórico</h3><p class="muted">Un descuento puede ser artificial. Abre el ASIN y confirma el precio contra 90/365 días.</p><button class="btn" data-kv-jump="research">Investigar ASIN</button></article>
                    <article class="card"><span class="keepa-op-icon">🏆</span><h3>Confirma demanda</h3><p class="muted">BSR y ventas mensuales son señales, no ventas garantizadas. Cruza también margen y competencia.</p><button class="btn" data-kv-jump="finder">Abrir Finder</button></article>
                </div>
                <div class="card keepa-token-guide">
                    <h3>Control de consumo</h3>
                    <p><strong>Resumen:</strong> ~1 token/ASIN · <strong>gráfica:</strong> 1 · <strong>Buy Box:</strong> puede sumar 2 · <strong>20 ofertas:</strong> ~12 extra · <strong>Finder:</strong> ~10.</p>
                    <p class="muted small">Los costos exactos dependen de tu plan y parámetros de Keepa. Ventas Meli nunca consulta ofertas automáticamente.</p>
                </div>
            </section>`;
    }

    function dealsHtml() {
        if (!local.deals.length) {
            return '<div class="keepa-empty-state"><span class="keepa-empty-icon">⚡</span><strong>Busca bajadas recientes</strong><span class="muted small">Después valida cada oportunidad en el Investigador antes de comprar.</span></div>';
        }
        return `
            <div class="card">
                <div class="keepa-card-title"><h3>${local.deals.length} deals encontrados</h3><span class="muted small">Toca un ASIN para investigarlo.</span></div>
                <div class="keepa-deals-grid">
                    ${local.deals.map(deal => {
                        const asin = deal.asin || deal.product?.asin || '';
                        // Keepa: deltaPercent[priceType][interval] · Buy Box=18 · semana=1.
                        const discRaw = Number(deal.deltaPercent?.[18]?.[1]);
                        const discount = Number.isFinite(discRaw) ? Math.abs(discRaw) : null;
                        const priceRaw = Number(
                            deal.current?.[18]
                            ?? deal.current?.[0]
                        );
                        const price = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw / 100 : null;
                        return `
                            <div class="keepa-deal-wrap">
                                <button type="button" class="keepa-deal-card" data-kv-asin="${esc(asin)}" ${asin ? '' : 'disabled'}>
                                    <div><code>${esc(asin || 'Sin ASIN')}</code><span class="keepa-badge">${discount != null ? `−${num(discount)}%` : 'Deal'}</span></div>
                                    <strong>${esc(deal.title || deal.product?.title || 'Producto Keepa')}</strong>
                                    <span class="muted">${price == null ? 'Precio al investigar' : mxn(price)}</span>
                                </button>
                                ${asin ? `<button type="button" class="btn ghost btn-sm" data-kv-wishlist="${esc(asin)}" data-kv-wish-title="${esc(deal.title || deal.product?.title || '')}" data-kv-wish-price="${price != null ? price : ''}">+ Wishlist</button>` : ''}
                            </div>`;
                    }).join('')}
                </div>
            </div>`;
    }

    function extractAsin(value) {
        return window.Keepa?.extractAsin?.(value) || '';
    }

    async function refreshTokens(showToast = true) {
        const pill = document.getElementById('keepa-token-pill');
        if (!pill || !Keepa.hasKey()) return;
        try {
            const data = await Keepa.tokenStatus();
            const left = data.tokensLeft ?? data.tokens ?? '—';
            const refill = data.refillRate ?? data.refillIn ?? null;
            pill.querySelector('strong').textContent = num(left);
            pill.title = refill == null ? 'Tokens disponibles' : `Recarga: ${refill}/min`;
            if (showToast) UI.toast('Tokens actualizados');
        } catch (err) {
            pill.querySelector('strong').textContent = 'Error';
            pill.title = err.message || 'Error Keepa';
            if (showToast) UI.toast(err.message || 'Error Keepa', 'error');
        }
    }

    function showResearchData(data, { loadPng = true } = {}) {
        local.research = data;
        local.asin = data?.asin || local.asin;
        local.section = 'research';
        const root = document.getElementById('view-keepa');
        if (root && !document.getElementById('keepa-research-result')) {
            render();
        }
        const box = document.getElementById('keepa-research-result');
        if (box) {
            box.innerHTML = researchHtml(data);
            bind(box);
            mountInteractiveChart();
        } else {
            render();
            const again = document.getElementById('keepa-research-result');
            if (again && local.research) {
                again.innerHTML = researchHtml(local.research);
                bind(again);
                mountInteractiveChart();
            }
        }
        if (loadPng) loadGraph();
    }

    async function runResearch(asin, range, { force = false, fromLibrary = false } = {}) {
        const code = extractAsin(asin);
        if (!code) {
            UI.toast('Escribe un ASIN válido o pega el link de Amazon', 'error');
            return;
        }
        // Abrir desde biblioteca sin gastar tokens
        if (fromLibrary && !force) {
            const saved = Keepa.readLibrary?.(code);
            if (saved?.history) {
                const requestSeq = ++local.researchSeq;
                if (code !== local.asin) {
                    clearGraphCache();
                    local.compareResearch = null;
                    local.compareAsin = '';
                    local.ixState = null;
                }
                local.asin = code;
                if (range) local.graph.range = Number(range);
                if (requestSeq !== local.researchSeq) return;
                showResearchData(saved, { loadPng: false });
                UI.toast('Abierto desde biblioteca · sin tokens');
                return;
            }
        }
        const requestSeq = ++local.researchSeq;
        if (code !== local.asin) {
            clearGraphCache();
            local.compareResearch = null;
            local.compareAsin = '';
            local.ixState = null;
        }
        local.asin = code;
        if (range) local.graph.range = Number(range);
        local.section = 'research';
        if (!document.getElementById('keepa-research-result')) render();
        const box = document.getElementById('keepa-research-result');
        if (box) box.innerHTML = '<div class="keepa-empty-state"><span class="keepa-spinner"></span><strong>Consultando Keepa…</strong><span class="muted small">Resumen + historial + gráfica Keepa.</span></div>';
        try {
            const data = await Keepa.fetchResearch(code, { force });
            if (requestSeq !== local.researchSeq) return;
            showResearchData(data, { loadPng: true });
            if (force) UI.toast('Biblioteca actualizada', 'success', { pulse: true });
            refreshTokens(false);
        } catch (err) {
            if (requestSeq !== local.researchSeq) return;
            if (box) box.innerHTML = `<div class="keepa-empty-state keepa-error"><strong>No se pudo consultar</strong><span>${esc(err.message || err)}</span></div>`;
        }
    }

    async function loadGraph({ seq = local.researchSeq } = {}) {
        if (!local.asin) return;
        const settings = { ...local.graph, height: GRAPH_HEIGHT };
        if (!GRAPH_LINES.some(([key]) => settings[key])) {
            UI.toast('Activa al menos una serie para dibujar la gráfica', 'error');
            return;
        }
        const key = graphKeyFor(local.asin, settings);
        const box = document.getElementById('keepa-graph-box');
        const cached = touchGraph(key);
        if (cached) {
            local.graphUrl = cached;
            local.graphKey = key;
            rerenderGraphPanel();
            return;
        }
        if (box) box.innerHTML = '<div class="keepa-graph-loading muted"><span class="keepa-spinner"></span> Generando gráfica…</div>';
        try {
            const blob = await Keepa.graphImage(local.asin, settings);
            if (seq !== local.researchSeq) return;
            const url = URL.createObjectURL(blob);
            local.graphUrl = url;
            local.graphKey = key;
            cacheGraph(key, url);
            rerenderGraphPanel();
            refreshTokens(false);
        } catch (err) {
            if (seq !== local.researchSeq) return;
            const target = document.getElementById('keepa-graph-box');
            if (target) target.innerHTML = `<div class="keepa-graph-loading keepa-error">${esc(err.message || 'No se pudo cargar la gráfica')}</div>`;
            refreshGraphControls();
        }
    }

    function rerenderGraphPanel() {
        if (!local.research) return;
        const panel = document.querySelector('.keepa-graph-panel');
        if (!panel) return;
        const holder = document.createElement('div');
        holder.innerHTML = graphHtml(local.research);
        const next = holder.firstElementChild;
        if (!next) return;
        panel.replaceWith(next);
        bindGraph(next);
        refreshOfficialInsights();
    }

    function openAsin(asin, { range } = {}) {
        const code = extractAsin(asin);
        if (!code) {
            UI.toast('El producto no tiene un ASIN válido', 'error');
            return;
        }
        local.section = 'research';
        local.asin = code;
        window.App?.switchTab?.('keepa');
        runResearch(code, range);
    }

    function applyCompetitionPrice(ids, price) {
        const idSet = new Set(String(ids || '').split(',').filter(Boolean));
        const amount = Number(price);
        if (!idSet.size || !Number.isFinite(amount) || amount <= 0) return;
        let updated = 0;
        window.State.lotes = window.State.lotes.map(lote => {
            if (!idSet.has(lote.id)) return lote;
            updated++;
            return {
                ...lote,
                precioCompetencia: amount,
                historial: [
                    ...(Array.isArray(lote.historial) ? lote.historial : []),
                    { ts: new Date().toISOString(), tipo: 'keepa_precio', meta: { precioCompetencia: amount } },
                ],
            };
        });
        window.State.save();
        UI.toast(`Precio Keepa aplicado a ${updated} variante${updated === 1 ? '' : 's'}`);
        const box = document.getElementById('keepa-research-result');
        if (box && local.research) {
            box.innerHTML = researchHtml(local.research);
            bind(box);
        }
    }

    async function loadOffers() {
        if (!local.asin) return;
        const ok = await UI.confirm({
            title: 'Cargar ofertas y stock',
            message: 'Keepa cobra aproximadamente 6 tokens por cada bloque de 10 ofertas. Esta consulta pedirá 20 ofertas.',
            primaryLabel: 'Usar tokens',
        });
        if (!ok) return;
        const box = document.getElementById('keepa-research-result');
        if (box) box.innerHTML = '<div class="keepa-empty-state"><span class="keepa-spinner"></span><strong>Consultando ofertas…</strong></div>';
        try {
            // Reutiliza la caché de 6 h; un segundo clic no vuelve a cobrar tokens.
            local.research = await Keepa.fetchResearch(local.asin, { offers: 20, force: false });
            if (box) {
                box.innerHTML = researchHtml(local.research);
                bind(box);
                mountInteractiveChart();
            }
            refreshTokens(false);
        } catch (err) {
            if (box) box.innerHTML = `<div class="keepa-empty-state keepa-error"><strong>Error ofertas</strong><span>${esc(err.message || err)}</span></div>`;
        }
    }

    async function enrichFinderPage() {
        const slice = finderPageSlice();
        const need = slice.asins.filter(a => !local.finder.cards[a]);
        if (!need.length) return 0;
        const rows = await Keepa.fetchProductsLight(need);
        rows.forEach(row => {
            if (row?.asin) local.finder.cards[row.asin] = row;
        });
        return rows.length;
    }

    async function runFinder() {
        const pageSize = local.finder.pageSize || 12;
        const ok = await UI.confirm({
            title: 'Buscar en Product Finder',
            message: `La búsqueda cuesta ~10 tokens. Después cargamos fichas de la 1ª página (~${pageSize} tokens: título, BB, BSR). Investigar uno cuesta aparte.`,
            primaryLabel: 'Buscar',
        });
        if (!ok) return;
        const get = id => document.getElementById(id)?.value?.trim();
        const selection = {
            page: 0,
            perPage: Math.max(50, Number(get('kf-limit')) || 50),
            sort: [[get('kf-sort') || 'current_SALES', get('kf-sort') === 'monthlySold' ? 'desc' : 'asc']],
        };
        if (get('kf-title')) selection.title = get('kf-title');
        if (get('kf-price-min')) selection.current_BUY_BOX_SHIPPING_gte = Math.round(Number(get('kf-price-min')) * 100);
        if (get('kf-price-max')) selection.current_BUY_BOX_SHIPPING_lte = Math.round(Number(get('kf-price-max')) * 100);
        if (get('kf-bsr-max')) selection.current_SALES_lte = Number(get('kf-bsr-max'));
        if (get('kf-sales-min')) selection.monthlySold_gte = Number(get('kf-sales-min'));
        if (get('kf-rating-min')) selection.current_RATING_gte = Math.round(Number(get('kf-rating-min')) * 10);
        const out = document.getElementById('keepa-finder-results');
        if (out) out.innerHTML = '<div class="keepa-empty-state"><span class="keepa-spinner"></span><strong>Buscando oportunidades…</strong></div>';
        try {
            const data = await Keepa.productFinder(selection);
            const asins = Array.isArray(data.asinList) ? data.asinList : [];
            local.finder = {
                asins,
                cards: {},
                page: 0,
                pageSize,
                totalResults: Number.isFinite(Number(data.totalResults)) ? Number(data.totalResults) : null,
                searched: true,
                selection,
            };
            if (asins.length) {
                if (out) out.innerHTML = '<div class="keepa-empty-state"><span class="keepa-spinner"></span><strong>Cargando fichas…</strong></div>';
                try { await enrichFinderPage(); }
                catch (enrichErr) {
                    UI.toast?.(enrichErr.message || 'Fichas parciales', 'error');
                }
            }
            if (out) out.innerHTML = finderHtml();
            bind(out);
            refreshTokens(false);
        } catch (err) {
            local.finder.searched = true;
            local.finder.asins = [];
            if (out) out.innerHTML = `<div class="keepa-empty-state keepa-error"><strong>Error Finder</strong><span>${esc(err.message || err)}</span></div>`;
        }
    }

    async function runSeller(id) {
        const out = document.getElementById('keepa-seller-result');
        if (out) out.innerHTML = '<div class="keepa-empty-state"><span class="keepa-spinner"></span><strong>Consultando vendedor…</strong></div>';
        try {
            const raw = await Keepa.sellerInfo(id);
            local.seller = raw.sellers?.[String(id).toUpperCase()]
                || Object.values(raw.sellers || {})[0]
                || raw.seller
                || raw;
            if (out) out.innerHTML = sellerHtml(local.seller);
            refreshTokens(false);
        } catch (err) {
            if (out) out.innerHTML = `<div class="keepa-empty-state keepa-error"><strong>Error</strong><span>${esc(err.message || err)}</span></div>`;
        }
    }

    async function runDeals() {
        const ok = await UI.confirm({
            title: 'Buscar Keepa Deals',
            message: 'Esta consulta cuesta aproximadamente 5 tokens y puede devolver hasta 150 oportunidades.',
            primaryLabel: 'Buscar deals',
        });
        if (!ok) return;
        const get = id => document.getElementById(id)?.value?.trim();
        const filters = {
            isFilterEnabled: true,
            isRangeEnabled: true,
            deltaPercentRange: [Number(get('kd-discount')) || 20, 100],
        };
        if (get('kd-title')) filters.titleSearch = get('kd-title');
        if (get('kd-price-max')) filters.currentRange = [0, Math.round(Number(get('kd-price-max')) * 100)];
        if (get('kd-bsr-max')) filters.salesRankRange = [1, Number(get('kd-bsr-max'))];
        if (get('kd-rating-min')) filters.minRating = Math.round(Number(get('kd-rating-min')) * 10);
        const out = document.getElementById('keepa-deals-results');
        if (out) out.innerHTML = '<div class="keepa-empty-state"><span class="keepa-spinner"></span><strong>Buscando deals…</strong></div>';
        try {
            const data = await Keepa.deals(filters);
            local.deals = data.dr || data.deals || [];
            if (out) out.innerHTML = dealsHtml();
            bind(out);
            refreshTokens(false);
        } catch (err) {
            if (out) out.innerHTML = `<div class="keepa-empty-state keepa-error"><strong>Error Deals</strong><span>${esc(err.message || err)}</span></div>`;
        }
    }

    function bindGraph(root) {
        if (!root) return;
        const update = patch => {
            Object.assign(local.graph, patch);
            saveGraphPrefs();
            refreshGraphControls();
        };
        root.querySelectorAll('[data-kg-range]').forEach(chip => {
            chip.addEventListener('click', () => update({ range: Number(chip.dataset.kgRange) }));
        });
        root.querySelectorAll('[data-kg-line]').forEach(chip => {
            chip.addEventListener('click', () => update({ [chip.dataset.kgLine]: !local.graph[chip.dataset.kgLine] }));
        });
        root.querySelectorAll('[data-kg-preset]').forEach(chip => {
            chip.addEventListener('click', () => update(GRAPH_PRESETS[chip.dataset.kgPreset] || {}));
        });
        root.querySelector('[data-kg-toggle="yzoom"]')?.addEventListener('click', () => update({ yzoom: !local.graph.yzoom }));
        root.querySelector('#keepa-graph-apply')?.addEventListener('click', () => loadGraph());
        root.querySelectorAll('[data-kv-graph-view]').forEach(btn => {
            btn.addEventListener('click', () => setGraphView(btn.dataset.kvGraphView));
        });
        root.querySelector('#keepa-dual-sync')?.addEventListener('click', async () => {
            UI.toast?.('Sincronizando PNG al periodo actual…');
            await loadGraph();
            refreshOfficialInsights();
        });
    }

    function bind(root) {
        if (!root) return;
        bindGraph(root);
        root.querySelectorAll('[data-kv-section]').forEach(button => {
            button.addEventListener('click', () => {
                local.section = button.dataset.kvSection;
                render();
            });
        });
        root.querySelectorAll('[data-kv-jump]').forEach(button => {
            button.addEventListener('click', () => {
                local.section = button.dataset.kvJump;
                render();
            });
        });
        root.querySelectorAll('[data-kv-asin]').forEach(button => {
            button.addEventListener('click', () => {
                local.section = 'research';
                local.asin = button.dataset.kvAsin;
                render();
                runResearch(local.asin);
            });
        });
        root.querySelectorAll('[data-kv-finder-page]').forEach(button => {
            button.addEventListener('click', async () => {
                const delta = Number(button.dataset.kvFinderPage) || 0;
                const slice = finderPageSlice();
                const next = Math.max(0, Math.min(slice.pages - 1, (local.finder.page || 0) + delta));
                if (next === local.finder.page) return;
                local.finder.page = next;
                const out = document.getElementById('keepa-finder-results');
                const need = finderPageSlice().asins.filter(a => !local.finder.cards[a]);
                if (need.length) {
                    const ok = await UI.confirm({
                        title: 'Cargar fichas de esta página',
                        message: `~${need.length} tokens para título, Buy Box y BSR de esta página.`,
                        primaryLabel: 'Cargar',
                    });
                    if (ok) {
                        try { await enrichFinderPage(); refreshTokens(false); }
                        catch (err) { UI.toast?.(err.message || 'No se pudieron cargar fichas', 'error'); }
                    }
                }
                if (out) {
                    out.innerHTML = finderHtml();
                    bind(out);
                }
            });
        });
        root.querySelector('[data-kv-finder-enrich]')?.addEventListener('click', async () => {
            const need = finderPageSlice().asins.filter(a => !local.finder.cards[a]);
            if (!need.length) return;
            const ok = await UI.confirm({
                title: 'Cargar fichas',
                message: `~${need.length} tokens para completar título, Buy Box y BSR.`,
                primaryLabel: 'Cargar',
            });
            if (!ok) return;
            try {
                await enrichFinderPage();
                const out = document.getElementById('keepa-finder-results');
                if (out) {
                    out.innerHTML = finderHtml();
                    bind(out);
                }
                refreshTokens(false);
            } catch (err) {
                UI.toast?.(err.message || 'No se pudieron cargar fichas', 'error');
            }
        });
        root.querySelectorAll('[data-kv-wishlist]').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const asin = button.dataset.kvWishlist;
                const title = button.dataset.kvWishTitle || '';
                const precio = Number(button.dataset.kvWishPrice) || 0;
                WishlistView?.addFromKeepa?.({
                    asin,
                    title,
                    precio,
                    note: 'Desde Keepa Lab',
                });
            });
        });
        root.querySelector('[data-kv-action="scan-catalog"]')?.addEventListener('click', async () => {
            const btn = root.querySelector('[data-kv-action="scan-catalog"]');
            if (btn) btn.disabled = true;
            try {
                const res = await Keepa.scanCatalogAlerts({ limit: 12 });
                UI.toast(`Keepa · ${res.scanned} ASINs · ${res.alerts.length} alerta${res.alerts.length === 1 ? '' : 's'}`);
                window.App?.switchTab?.('insights');
            } catch (err) {
                UI.toast(err.message || 'No se pudo escanear', 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });
        root.querySelectorAll('[data-kv-seller]').forEach(button => {
            button.addEventListener('click', () => {
                const id = button.dataset.kvSeller;
                if (!id) return;
                local.section = 'seller';
                render();
                const input = document.getElementById('keepa-seller-id');
                if (input) input.value = id;
                runSeller(id);
            });
        });
        root.querySelectorAll('[data-kv-product]').forEach(button => {
            button.addEventListener('click', () => window.LotesView?.selectAndGo?.(button.dataset.kvProduct));
        });
        root.querySelectorAll('[data-kv-apply-price]').forEach(button => {
            button.addEventListener('click', () => {
                applyCompetitionPrice(button.dataset.kvApplyPrice, button.dataset.kvPrice);
            });
        });
        root.querySelector('[data-kv-action="tokens"]')?.addEventListener('click', () => refreshTokens(true));
        root.querySelector('[data-kv-action="settings"]')?.addEventListener('click', () => window.App?.switchTab?.('settings'));
        root.querySelector('[data-kv-action="offers"]')?.addEventListener('click', loadOffers);
        root.querySelector('#keepa-research-form')?.addEventListener('submit', event => {
            event.preventDefault();
            runResearch(document.getElementById('keepa-research-asin')?.value);
        });
        root.querySelector('#keepa-lib-search')?.addEventListener('input', e => {
            local.libQuery = e.target.value || '';
            render();
            const input = document.getElementById('keepa-lib-search');
            if (input) {
                input.focus();
                const len = input.value.length;
                input.setSelectionRange(len, len);
            }
        });
        root.querySelectorAll('[data-kv-vitrine-scroll]').forEach(btn => {
            btn.addEventListener('click', () => {
                const track = document.getElementById('keepa-lib-track');
                if (!track) return;
                const delta = Number(btn.dataset.kvVitrineScroll) || 0;
                const step = Math.min(320, track.clientWidth * 0.8) * delta;
                track.scrollBy({ left: step, behavior: 'smooth' });
            });
        });
        root.querySelectorAll('[data-kv-lib-open]').forEach(btn => {
            btn.addEventListener('click', () => {
                runResearch(btn.dataset.kvLibOpen, null, { fromLibrary: true });
            });
        });
        root.querySelectorAll('[data-kv-lib-update]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const asin = btn.dataset.kvLibUpdate;
                const ok = await UI.confirm({
                    title: 'Actualizar ASIN',
                    message: 'Se volverá a consultar Keepa (~3–5 tokens) y se reemplazará lo guardado en la biblioteca.',
                    primaryLabel: 'Actualizar',
                });
                if (!ok) return;
                runResearch(asin, null, { force: true });
            });
        });
        root.querySelectorAll('[data-kv-lib-remove]').forEach(btn => {
            btn.addEventListener('click', () => {
                Keepa.removeLibrary?.(btn.dataset.kvLibRemove);
                UI.toast('Quitado de la biblioteca');
                if (local.section === 'library') render();
            });
        });
        root.querySelector('#keepa-finder-form')?.addEventListener('submit', event => {
            event.preventDefault();
            runFinder();
        });
        root.querySelector('#keepa-seller-form')?.addEventListener('submit', event => {
            event.preventDefault();
            runSeller(document.getElementById('keepa-seller-id')?.value);
        });
        root.querySelector('#keepa-deals-form')?.addEventListener('submit', event => {
            event.preventDefault();
            runDeals();
        });
    }

    return { render, openAsin };
})();
window.KeepaView = KeepaView;
