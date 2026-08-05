/* ==========================================================================
   Keepa Lab — investigación Amazon MX con control explícito de tokens.
   ========================================================================== */

const KeepaView = (() => {
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
        height: 380,
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
        finder: [],
        seller: null,
        deals: [],
        researchSeq: 0,
    };

    const esc = value => UI.escapeHTML(String(value ?? ''));
    const mxn = value => value == null ? '—' : Calc.fmtMXN(value);
    const num = value => value == null ? '—' : Number(value).toLocaleString('es-MX');

    function loadGraphPrefs() {
        const saved = window.State?.ui?.keepaGraph;
        if (!saved || typeof saved !== 'object') return;
        const merged = { ...GRAPH_DEFAULTS, ...saved };
        if (GRAPH_LINES.some(([key]) => merged[key])) {
            local.graph = merged;
            return;
        }
        // Sin ninguna serie la gráfica saldría vacía: volvemos al set por defecto.
        local.graph = { ...GRAPH_DEFAULTS };
        saveGraphPrefs();
    }

    function saveGraphPrefs() {
        if (!window.State?.ui) return;
        window.State.ui.keepaGraph = { ...local.graph };
        window.State.save?.();
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
                <div class="keepa-token-pill" id="keepa-token-pill">
                    <span class="muted small">Tokens</span>
                    <strong>${configured ? '…' : 'Sin key'}</strong>
                    ${configured ? '<button type="button" class="icon-btn" data-kv-action="tokens" title="Actualizar tokens">↻</button>' : ''}
                </div>
            </div>

            ${configured ? '' : `
                <div class="card keepa-config-alert">
                    <strong>${hasKey ? 'La API key no es válida' : 'Falta configurar Keepa'}</strong>
                    <span class="muted">${hasKey
                        ? 'La key guardada no tiene formato de Keepa (64 caracteres alfanuméricos). Vuelve a pegarla.'
                        : 'Pega tu Data API key en Ajustes → Keepa.'}</span>
                    <button type="button" class="btn primary sm" data-kv-action="settings">Abrir Ajustes</button>
                </div>`}

            <nav class="keepa-view-tabs" role="tablist">
                ${[
                    ['research', '🔎 Investigador'],
                    ['finder', '🧭 Product Finder'],
                    ['seller', '🏪 Vendedor'],
                    ['deals', '⚡ Deals'],
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
        if (local.section === 'finder') return renderFinder(configured);
        if (local.section === 'seller') return renderSeller(configured);
        if (local.section === 'deals') return renderDeals(configured);
        return renderResearch(configured);
    }

    function renderResearch(configured) {
        const options = knownAsins().map(row =>
            `<option value="${esc(row.asin)}">${esc(row.label)}</option>`
        ).join('');
        return `
            <section class="keepa-workspace">
                <div class="card keepa-query-card">
                    <div class="keepa-card-title">
                        <div><h3>Investigar ASIN</h3><p class="muted small">Investigar ≈ 3–5 tokens (Buy Box + rating + gráfica). Reconsultar el mismo ASIN usa caché 6h.</p></div>
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
                ${graphHtml(data)}
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
                    <div class="keepa-graph-row">
                        <button type="button" class="keepa-chip ${g.yzoom ? 'active' : ''}" data-kg-toggle="yzoom">Zoom eje Y</button>
                        <label class="keepa-graph-height"><span class="muted small">Alto</span>
                            <select id="keepa-graph-height">
                                ${[300, 380, 480, 600].map(h => `<option value="${h}" ${Number(g.height) === h ? 'selected' : ''}>${h}px</option>`).join('')}
                            </select>
                        </label>
                        <button type="button" class="btn primary sm" id="keepa-graph-apply" ${apply.disabled ? 'disabled' : ''}>${apply.label}</button>
                        ${local.graphUrl ? `<a class="btn ghost sm" href="${esc(local.graphUrl)}" target="_blank" rel="noopener">Ver grande ↗</a>` : ''}
                    </div>
                </div>
                <div class="keepa-graph-box" id="keepa-graph-box">
                    ${local.graphUrl
                        ? `<img src="${esc(local.graphUrl)}" alt="Gráfica Keepa de ${esc(data.asin)}">`
                        : '<div class="keepa-graph-loading muted">Cargando gráfica Keepa…</div>'}
                </div>
            </div>`;
    }

    function refreshGraphControls() {
        if (!local.research) return;
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

    function finderHtml() {
        if (!local.finder.length) return '<div class="keepa-empty-state"><span class="keepa-empty-icon">🧭</span><strong>Define tus filtros</strong><span class="muted small">El Finder devuelve ASINs; abre uno en el Investigador para analizarlo.</span></div>';
        return `
            <div class="card">
                <div class="keepa-card-title"><h3>${local.finder.length} ASINs encontrados</h3><span class="muted small">Investigar uno cuesta tokens adicionales.</span></div>
                <div class="keepa-finder-results">
                    ${local.finder.map((asin, i) => `
                        <button type="button" class="keepa-finder-result" data-kv-asin="${esc(asin)}">
                            <span>${i + 1}</span><code>${esc(asin)}</code><strong>Investigar →</strong>
                        </button>`).join('')}
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
                            <button type="button" class="keepa-deal-card" data-kv-asin="${esc(asin)}" ${asin ? '' : 'disabled'}>
                                <div><code>${esc(asin || 'Sin ASIN')}</code><span class="keepa-badge">${discount != null ? `−${num(discount)}%` : 'Deal'}</span></div>
                                <strong>${esc(deal.title || deal.product?.title || 'Producto Keepa')}</strong>
                                <span class="muted">${price == null ? 'Precio al investigar' : mxn(price)}</span>
                            </button>`;
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

    async function runResearch(asin, range) {
        const code = extractAsin(asin);
        if (!code) {
            UI.toast('Escribe un ASIN válido o pega el link de Amazon', 'error');
            return;
        }
        const requestSeq = ++local.researchSeq;
        if (code !== local.asin) clearGraphCache();
        local.asin = code;
        if (range) local.graph.range = Number(range);
        const box = document.getElementById('keepa-research-result');
        if (box) box.innerHTML = '<div class="keepa-empty-state"><span class="keepa-spinner"></span><strong>Consultando Keepa…</strong><span class="muted small">Resumen + Buy Box y gráfica.</span></div>';
        try {
            const data = await Keepa.fetchResearch(code);
            if (requestSeq !== local.researchSeq) return;
            local.research = data;
            if (box) box.innerHTML = researchHtml(data);
            bind(box);
            await loadGraph({ seq: requestSeq });
            if (requestSeq !== local.researchSeq) return;
            refreshTokens(false);
        } catch (err) {
            if (requestSeq !== local.researchSeq) return;
            if (box) box.innerHTML = `<div class="keepa-empty-state keepa-error"><strong>No se pudo consultar</strong><span>${esc(err.message || err)}</span></div>`;
        }
    }

    async function loadGraph({ seq = local.researchSeq } = {}) {
        if (!local.asin) return;
        const settings = { ...local.graph };
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
            }
            refreshTokens(false);
        } catch (err) {
            if (box) box.innerHTML = `<div class="keepa-empty-state keepa-error"><strong>Error ofertas</strong><span>${esc(err.message || err)}</span></div>`;
        }
    }

    async function runFinder() {
        const ok = await UI.confirm({
            title: 'Buscar en Product Finder',
            message: 'Esta búsqueda cuesta aproximadamente 10 tokens. Abrir cada resultado después consume tokens adicionales.',
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
            local.finder = Array.isArray(data.asinList) ? data.asinList : [];
            if (out) out.innerHTML = finderHtml();
            bind(out);
            refreshTokens(false);
        } catch (err) {
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
        root.querySelector('#keepa-graph-height')?.addEventListener('change', event => {
            update({ height: Number(event.target.value) || GRAPH_DEFAULTS.height });
        });
        root.querySelector('#keepa-graph-apply')?.addEventListener('click', () => loadGraph());
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
