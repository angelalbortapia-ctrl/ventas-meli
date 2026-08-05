/* ==========================================================================
   Keepa — precio / BSR / rating vía API (Amazon MX = domain 11).
   El navegador no puede pegarle directo (CORS): usa /api/keepa/* del serve.py.
   ========================================================================== */

const Keepa = (() => {
    const DOMAIN_MX = 11;
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h · ahorra tokens
    const RESEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
    const IDX = {
        AMAZON: 0,
        NEW: 1,
        SALES: 3,
        RATING: 16,
        REVIEWS: 17,
        BUY_BOX: 18,
    };
    const pendingProduct = new Map();
    const pendingResearch = new Map();
    const pendingGraph = new Map();
    const researchCache = new Map();

    function getApiKey() {
        return String(window.State?.ui?.keepaApiKey || '').trim();
    }

    function setApiKey(key) {
        window.State.ui = { ...window.State.ui, keepaApiKey: String(key || '').trim() };
        // No empujar a Sync: la key es del dispositivo
        const prev = window.__skipSync;
        window.__skipSync = true;
        try {
            window.State.saveUI();
        } finally {
            window.__skipSync = prev;
        }
    }

    // Las keys de Keepa son alfanuméricas de 64; validarlo evita gastar llamadas
    // cuando el gestor de contraseñas del navegador rellena el campo por error.
    const KEY_PATTERN = /^[A-Za-z0-9]{40,80}$/;

    function keyLooksValid(key = getApiKey()) {
        return KEY_PATTERN.test(String(key || '').trim());
    }

    function hasKey() {
        return getApiKey().length >= 20;
    }

    function requireKey() {
        const key = getApiKey();
        if (!key) throw new Error('Falta API key de Keepa en Ajustes');
        if (!keyLooksValid(key)) {
            throw new Error('La API key guardada no tiene formato de Keepa (64 caracteres alfanuméricos). Vuelve a pegarla en Ajustes → Keepa.');
        }
        return key;
    }

    function cacheStore() {
        if (!window.State.ui) window.State.ui = {};
        if (!window.State.ui.keepaCache || typeof window.State.ui.keepaCache !== 'object') {
            window.State.ui.keepaCache = {};
        }
        return window.State.ui.keepaCache;
    }

    function readCache(asin) {
        const row = cacheStore()[asin];
        if (!row || !row.at || !row.data) return null;
        if (Date.now() - row.at > CACHE_TTL_MS) return null;
        const data = row.data;
        // Compatibilidad con resúmenes guardados antes de añadir fuente y comparativos.
        if (data.currentPrice == null && data.amazon != null) {
            return {
                ...data,
                currentPrice: data.amazon,
                priceSource: data.priceSource || 'Mercado',
                vs90: data.avg90 > 0 ? (data.amazon - data.avg90) / data.avg90 : null,
                bsrVs90: data.bsrAvg90 > 0 ? (data.bsr - data.bsrAvg90) / data.bsrAvg90 : null,
            };
        }
        return data;
    }

    function writeCache(asin, data) {
        const store = { ...cacheStore(), [asin]: { at: Date.now(), data } };
        // Limitar a 80 ASINs
        const entries = Object.entries(store).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
        window.State.ui = {
            ...window.State.ui,
            keepaCache: Object.fromEntries(entries.slice(0, 80)),
        };
        const prevB = window.__skipBackupDirty;
        const prevS = window.__skipSync;
        window.__skipBackupDirty = true;
        window.__skipSync = true;
        try {
            window.State.saveUI();
        } finally {
            window.__skipBackupDirty = prevB;
            window.__skipSync = prevS;
        }
    }

    function centsToMxn(v) {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return null;
        return n / 100;
    }

    function pickCurrent(arr, idx) {
        if (!Array.isArray(arr) || arr[idx] == null) return null;
        return centsToMxn(arr[idx]);
    }

    function pickStat(stats, field, idx) {
        const series = stats?.[field];
        if (!Array.isArray(series) || series[idx] == null) return null;
        const v = Number(series[idx]);
        if (!Number.isFinite(v) || v < 0) return null;
        // ranking / counts no van /100
        if (idx === IDX.SALES || idx === IDX.REVIEWS) return v;
        if (idx === IDX.RATING) return v / 10; // 45 → 4.5
        return v / 100;
    }

    function summarizeProduct(product) {
        if (!product) return null;
        const stats = product.stats || {};
        const current = Array.isArray(stats.current) ? stats.current : (product.csv || []).map(col => {
            if (!Array.isArray(col) || col.length < 2) return -1;
            return col[col.length - 1];
        });

        const priceCandidates = [
            { value: pickCurrent(current, IDX.BUY_BOX), source: 'Buy Box', idx: IDX.BUY_BOX },
            { value: pickCurrent(current, IDX.AMAZON), source: 'Amazon', idx: IDX.AMAZON },
            { value: pickCurrent(current, IDX.NEW), source: 'Nuevo 3P', idx: IDX.NEW },
        ];
        const selectedPrice = priceCandidates.find(row => row.value != null)
            || { value: null, source: 'Sin precio', idx: IDX.BUY_BOX };
        const currentPrice = selectedPrice.value;
        const avg30 = pickStat(stats, 'avg30', selectedPrice.idx)
            ?? pickStat(stats, 'avg30', IDX.BUY_BOX)
            ?? pickStat(stats, 'avg30', IDX.AMAZON)
            ?? pickStat(stats, 'avg30', IDX.NEW);
        const avg90 = pickStat(stats, 'avg90', selectedPrice.idx)
            ?? pickStat(stats, 'avg90', IDX.BUY_BOX)
            ?? pickStat(stats, 'avg90', IDX.AMAZON)
            ?? pickStat(stats, 'avg90', IDX.NEW);
        const bsr = pickStat(stats, 'current', IDX.SALES);
        const bsrAvg90 = pickStat(stats, 'avg90', IDX.SALES);
        const rating = pickStat(stats, 'current', IDX.RATING);
        const reviews = pickStat(stats, 'current', IDX.REVIEWS);
        const drop30 = (currentPrice != null && avg30 != null && avg30 > 0)
            ? (currentPrice - avg30) / avg30
            : null;
        const vs90 = (currentPrice != null && avg90 != null && avg90 > 0)
            ? (currentPrice - avg90) / avg90
            : null;
        const bsrVs90 = (bsr != null && bsrAvg90 != null && bsrAvg90 > 0)
            ? (bsr - bsrAvg90) / bsrAvg90
            : null;

        let signal = 'na';
        let signalLabel = 'Sin señal';
        if (vs90 != null) {
            if (vs90 <= -0.08) {
                signal = 'low';
                signalLabel = 'Bajo vs 90d';
            } else if (vs90 >= 0.08) {
                signal = 'high';
                signalLabel = 'Alto vs 90d';
            } else {
                signal = 'fair';
                signalLabel = 'Cerca del promedio';
            }
        }

        const amazonRetail = pickCurrent(current, IDX.AMAZON);
        return {
            asin: product.asin,
            title: product.title || '',
            // `amazon` se conserva por compatibilidad con Wishlist y código anterior
            // (es el precio de mercado elegido, no necesariamente Amazon retail).
            amazon: currentPrice,
            amazonRetail,
            currentPrice,
            priceSource: selectedPrice.source,
            avg30,
            avg90,
            bsr,
            bsrAvg90,
            bsrVs90,
            rating,
            reviews,
            monthlySold: Number(product.monthlySold) > 0 ? Number(product.monthlySold) : null,
            drop30,
            vs90,
            signal,
            signalLabel,
            image: Array.isArray(product.imagesCSV)
                ? null
                : (typeof product.imagesCSV === 'string' && product.imagesCSV
                    ? `https://images-na.ssl-images-amazon.com/images/I/${product.imagesCSV.split(',')[0]}`
                    : null),
            fetchedAt: new Date().toISOString(),
        };
    }

    /** Keepa devuelve `error` como objeto {type, message}: sin esto se ve "[object Object]". */
    function describeError(data, status) {
        const err = data && data.error;
        if (err && typeof err === 'object') {
            const parts = [err.type, err.message].filter(part => typeof part === 'string' && part);
            if (parts.length) return parts.join(' · ');
        }
        if (typeof err === 'string' && err.trim()) return err;
        if (typeof data?.message === 'string' && data.message.trim()) return data.message;
        return `Keepa HTTP ${status}`;
    }

    async function proxyFetch(pathWithQuery) {
        const key = requireKey();
        const res = await fetch(`/api/keepa/${pathWithQuery.replace(/^\//, '')}`, {
            headers: { 'X-Keepa-Key': key },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(describeError(data, res.status));
        return data;
    }

    async function proxyFetchBlob(pathWithQuery) {
        const key = requireKey();
        const res = await fetch(`/api/keepa/${pathWithQuery.replace(/^\//, '')}`, {
            headers: { 'X-Keepa-Key': key },
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(describeError(data, res.status));
        }
        return res.blob();
    }

    async function proxyPost(path, payload) {
        const key = requireKey();
        const res = await fetch(`/api/keepa/${path.replace(/^\//, '')}`, {
            method: 'POST',
            headers: {
                'X-Keepa-Key': key,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload || {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(describeError(data, res.status));
        return data;
    }

    async function fetchProduct(asin, { force = false, statsDays = 90 } = {}) {
        const code = String(asin || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(code)) throw new Error('ASIN inválido');
        if (!force) {
            const hit = readCache(code);
            if (hit) return hit;
            if (pendingProduct.has(code)) return pendingProduct.get(code);
        }
        const pending = (async () => {
            const raw = await proxyFetch(
                `product?domain=${DOMAIN_MX}&asin=${encodeURIComponent(code)}&stats=${statsDays}&history=0&rating=1`
            );
            const product = Array.isArray(raw.products) ? raw.products[0] : null;
            if (!product) throw new Error('Keepa no devolvió el producto (ASIN / tokens / dominio MX)');
            const summary = summarizeProduct(product);
            writeCache(code, summary);
            return summary;
        })();
        pendingProduct.set(code, pending);
        try {
            return await pending;
        } finally {
            pendingProduct.delete(code);
        }
    }

    /** Extrae ASIN de link Amazon o texto suelto. */
    function extractAsin(text) {
        const s = String(text || '').trim();
        if (!s) return '';
        if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();
        const m = s.match(
            /(?:\/(?:dp|gp\/product|gp\/aw\/d)|[?&]asin=)\/?([A-Z0-9]{10})\b/i
        ) || s.match(/\b([A-Z0-9]{10})\b/);
        return m ? m[1].toUpperCase() : '';
    }

    async function tokenStatus() {
        return proxyFetch('token');
    }

    function latestOfferPrice(offer) {
        const csv = offer?.offerCSV;
        if (!Array.isArray(csv) || csv.length < 3) return null;
        const price = Number(csv[csv.length - 2]);
        const shipping = Number(csv[csv.length - 1]);
        if (!Number.isFinite(price) || price < 0) return null;
        return (price + (Number.isFinite(shipping) && shipping > 0 ? shipping : 0)) / 100;
    }

    function latestOfferStock(offer) {
        const csv = offer?.stockCSV;
        if (!Array.isArray(csv) || csv.length < 2) return null;
        const stock = Number(csv[csv.length - 1]);
        return Number.isFinite(stock) && stock >= 0 ? stock : null;
    }

    function summarizeResearch(product) {
        const summary = summarizeProduct(product);
        if (!summary) return null;
        const stats = product.stats || {};
        const buyBoxPriceRaw = Number(stats.buyBoxPrice);
        const buyBoxShippingRaw = Number(stats.buyBoxShipping);
        const buyBox = Number.isFinite(buyBoxPriceRaw) && buyBoxPriceRaw >= 0
            ? (buyBoxPriceRaw + (Number.isFinite(buyBoxShippingRaw) && buyBoxShippingRaw > 0 ? buyBoxShippingRaw : 0)) / 100
            : pickStat(stats, 'current', IDX.BUY_BOX);
        const rawOffers = Array.isArray(product.offers) ? product.offers : [];
        const liveIdx = Array.isArray(product.liveOffersOrder) && product.liveOffersOrder.length
            ? product.liveOffersOrder
            : rawOffers.map((_, i) => i);
        const offers = liveIdx
            .map(i => rawOffers[i])
            .filter(Boolean)
            .map(offer => ({
                sellerId: offer.sellerId || '',
                price: latestOfferPrice(offer),
                isFBA: !!offer.isFBA,
                isPrime: !!offer.isPrime,
                condition: offer.condition ?? null,
                stock: latestOfferStock(offer),
            }));
        return {
            ...summary,
            brand: product.brand || '',
            manufacturer: product.manufacturer || '',
            monthlySold: Number(product.monthlySold) > 0 ? Number(product.monthlySold) : null,
            buyBox,
            marketPrice: buyBox ?? summary.amazon,
            buyBoxSellerId: ['-1', '-2'].includes(String(stats.buyBoxSellerId))
                ? ''
                : (stats.buyBoxSellerId || ''),
            buyBoxIsAmazon: stats.buyBoxIsAmazon === true,
            buyBoxIsFBA: stats.buyBoxIsFBA === true,
            availabilityAmazon: product.availabilityAmazon ?? null,
            offerCount: offers.length,
            offers,
            rootCategory: product.rootCategory ?? null,
            categoryTree: Array.isArray(product.categoryTree) ? product.categoryTree : [],
        };
    }

    async function fetchResearch(asin, { offers = 0, statsDays = 90, force = false } = {}) {
        const code = String(asin || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(code)) throw new Error('ASIN inválido');
        const offerCount = Math.max(0, Math.min(100, Number(offers) || 0));
        const cacheKey = `${code}:o${offerCount}:s${statsDays}`;
        if (!force) {
            const hit = researchCache.get(cacheKey);
            if (hit && Date.now() - hit.at < RESEARCH_CACHE_TTL_MS) return hit.data;
            if (pendingResearch.has(cacheKey)) return pendingResearch.get(cacheKey);
        }
        const pending = (async () => {
            const params = new URLSearchParams({
                domain: String(DOMAIN_MX),
                asin: code,
                stats: String(statsDays),
                history: '0',
                rating: '1',
                buybox: '1',
            });
            if (offerCount) {
                params.set('offers', String(Math.max(20, offerCount)));
                params.set('stock', '1');
            }
            const raw = await proxyFetch(`product?${params}`);
            const product = Array.isArray(raw.products) ? raw.products[0] : null;
            if (!product) throw new Error('Keepa no devolvió el producto');
            const data = summarizeResearch(product);
            writeCache(code, summarizeProduct(product));
            researchCache.set(cacheKey, { at: Date.now(), data });
            return data;
        })();
        pendingResearch.set(cacheKey, pending);
        try {
            return await pending;
        } finally {
            pendingResearch.delete(cacheKey);
        }
    }

    const GRAPH_LINES = ['amazon', 'new', 'used', 'salesrank', 'bb', 'fba', 'fbm', 'ld', 'wd'];

    /** Query canónica de la gráfica: sirve como clave de caché. */
    function graphParams(asin, options = {}) {
        const code = String(asin || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(code)) throw new Error('ASIN inválido');
        const params = new URLSearchParams({
            domain: String(DOMAIN_MX),
            asin: code,
            range: String(Math.max(1, Math.min(3650, Number(options.range) || 90))),
            width: String(Math.max(500, Math.min(2000, Number(options.width) || 1000))),
            height: String(Math.max(200, Math.min(800, Number(options.height) || 360))),
        });
        GRAPH_LINES.forEach(line => {
            if (options[line] != null) params.set(line, options[line] ? '1' : '0');
        });
        if (options.yzoom) params.set('yzoom', '1');
        return params;
    }

    async function graphImage(asin, options = {}) {
        const params = graphParams(asin, options);
        const key = params.toString();
        if (pendingGraph.has(key)) return pendingGraph.get(key);
        const pending = proxyFetchBlob(`graphimage?${params}`);
        pendingGraph.set(key, pending);
        try {
            return await pending;
        } finally {
            pendingGraph.delete(key);
        }
    }

    async function productFinder(selection) {
        const query = {
            ...selection,
            page: Math.max(0, Number(selection?.page) || 0),
            // Keepa Product Finder exige mínimo 50.
            perPage: Math.max(50, Math.min(100, Number(selection?.perPage) || 50)),
        };
        const params = new URLSearchParams({
            domain: String(DOMAIN_MX),
            selection: JSON.stringify(query),
        });
        return proxyFetch(`query?${params}`);
    }

    async function sellerInfo(sellerId) {
        const id = String(sellerId || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{8,20}$/.test(id)) throw new Error('Seller ID inválido');
        const params = new URLSearchParams({ domain: String(DOMAIN_MX), seller: id });
        return proxyFetch(`seller?${params}`);
    }

    async function deals(filters = {}) {
        return proxyPost('deal', {
            domainId: DOMAIN_MX,
            page: 0,
            // Buy Box con envío: más útil para arbitraje que Amazon Retail.
            priceTypes: [IDX.BUY_BOX],
            sortType: 4,
            dateRange: 1,
            ...filters,
        });
    }

    /** Preferencias del panel en la ficha de Productos. */
    function panelPrefs() {
        const ui = window.State?.ui || {};
        return {
            off: ui.keepaPanelOff === true,
            // Por defecto plegado: expandir es opt-in y ahorra ~1 token por ficha.
            collapsed: ui.keepaPanelCollapsed !== false,
        };
    }

    function setPanelPref(patch) {
        window.State.ui = { ...window.State.ui, ...patch };
        window.State.saveUI?.();
    }

    function renderCollapsedBar(summary, { productId = '' } = {}) {
        const safe = (v) => UI.escapeHTML(String(v ?? ''));
        const toggle = `
            <button type="button" class="keepa-collapse-toggle" data-keepa-action="expand" aria-expanded="false">
                <span class="keepa-chevron">▸</span>
                <strong>Inteligencia Keepa</strong>
            </button>`;
        if (!summary) {
            return `
                <div class="keepa-panel keepa-collapsed" data-keepa-product-id="${safe(productId)}">
                    ${toggle}
                    <span class="muted small">Sin consultar · abrir usa ~1 token</span>
                </div>`;
        }
        const price = summary.marketPrice ?? summary.currentPrice ?? summary.amazon;
        return `
            <div class="keepa-panel keepa-collapsed" data-keepa-signal="${safe(summary.signal)}"
                data-keepa-product-id="${safe(productId)}">
                ${toggle}
                <span class="keepa-badge">${safe(summary.signalLabel)}</span>
                <span class="mono">${price == null ? '—' : Calc.fmtMXN(price)}</span>
                <span class="muted">BSR ${summary.bsr == null ? '—' : Number(summary.bsr).toLocaleString('es-MX')}</span>
                <span class="muted small">desde caché</span>
            </div>`;
    }

    function renderPanel(summary, { compact = false, productId = '', detailed = false } = {}) {
        if (!summary) {
            return `<div class="keepa-panel keepa-empty muted small">Sin datos Keepa</div>`;
        }
        const px = (v) => (v == null ? '—' : Calc.fmtMXN(v));
        const n = (v) => (v == null ? '—' : Number(v).toLocaleString('es-MX'));
        const pct = (v) => (v == null ? '—' : Calc.fmtPct(v));
        const safe = (v) => UI.escapeHTML(String(v ?? ''));
        const currentPrice = summary.marketPrice ?? summary.currentPrice ?? summary.amazon;
        const updated = summary.fetchedAt
            ? new Date(summary.fetchedAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
            : '—';
        if (compact) {
            return `
                <div class="keepa-panel keepa-compact" data-keepa-signal="${safe(summary.signal)}">
                    <span class="keepa-badge">${safe(summary.signalLabel)}</span>
                    <span class="mono">${px(currentPrice)}</span>
                    <span class="muted">· avg90 ${px(summary.avg90)}</span>
                    <span class="muted">· BSR ${n(summary.bsr)}</span>
                </div>`;
        }
        const buyBoxOwner = detailed
            ? (summary.buyBoxIsAmazon
                ? 'Amazon'
                : (summary.buyBoxSellerId ? safe(summary.buyBoxSellerId) : 'Sin identificar'))
            : 'Cargar detalle';
        const fulfillment = detailed
            ? (summary.buyBoxIsAmazon || summary.buyBoxIsFBA ? 'FBA' : (summary.buyBoxSellerId ? 'FBM / otro' : '—'))
            : '—';
        const controls = productId ? `
            <div class="keepa-panel-actions">
                <button type="button" class="btn sm" data-keepa-action="apply"
                    data-product-id="${safe(productId)}" data-price="${safe(currentPrice ?? '')}"
                    ${currentPrice == null ? 'disabled' : ''}>Usar como competencia</button>
                <button type="button" class="btn ghost sm" data-keepa-action="details"
                    title="Buy Box y ventas mensuales; la respuesta se conserva 6 horas">
                    ${detailed ? 'Actualizar detalle · 3–5 tokens' : 'Cargar Buy Box · 3–5 tokens'}
                </button>
                <button type="button" class="btn ghost sm" data-keepa-action="refresh"
                    title="Ignora la caché y vuelve a consultar el resumen">Actualizar resumen · ~1 token</button>
                <button type="button" class="btn ghost sm" data-keepa-action="lab">Gráfica y análisis ↗</button>
            </div>` : '';
        return `
            <div class="keepa-panel keepa-product-summary" data-keepa-signal="${safe(summary.signal)}">
                <div class="keepa-head">
                    ${productId ? `
                        <button type="button" class="keepa-collapse-toggle" data-keepa-action="collapse" aria-expanded="true">
                            <span class="keepa-chevron">▾</span>
                            <span class="keepa-head-text">
                                <strong>Inteligencia Keepa</strong>
                                <span class="muted keepa-source">ASIN ${safe(summary.asin)} · actualizado ${safe(updated)}</span>
                            </span>
                        </button>
                    ` : `
                        <div>
                            <strong>Inteligencia Keepa</strong>
                            <span class="muted keepa-source">ASIN ${safe(summary.asin)} · actualizado ${safe(updated)}</span>
                        </div>
                    `}
                    <span class="keepa-badge">${safe(summary.signalLabel)}</span>
                </div>
                <div class="keepa-grid">
                    <div><span class="muted">Precio actual · ${safe(summary.priceSource || 'Mercado')}</span><strong class="mono">${px(currentPrice)}</strong></div>
                    <div><span class="muted">Prom. 30d</span><strong class="mono">${px(summary.avg30)}</strong></div>
                    <div><span class="muted">Prom. 90d</span><strong class="mono">${px(summary.avg90)}</strong></div>
                    <div><span class="muted">Precio vs 90d</span><strong class="mono">${pct(summary.vs90)}</strong></div>
                    <div><span class="muted">BSR actual</span><strong class="mono">${n(summary.bsr)}</strong></div>
                    <div><span class="muted">BSR vs prom. 90d</span><strong class="mono">${pct(summary.bsrVs90)}</strong></div>
                    <div><span class="muted">Ventas estimadas / mes</span><strong class="mono">${summary.monthlySold == null ? '—' : `${n(summary.monthlySold)}+`}</strong></div>
                    <div><span class="muted">Rating</span><strong class="mono">${summary.rating != null ? `${summary.rating.toFixed(1)} ★` : '—'}</strong></div>
                    <div><span class="muted">Reviews</span><strong class="mono">${n(summary.reviews)}</strong></div>
                    <div><span class="muted">Buy Box</span><strong class="mono">${buyBoxOwner}</strong></div>
                    <div><span class="muted">Logística Buy Box</span><strong class="mono">${fulfillment}</strong></div>
                </div>
                ${controls}
            </div>`;
    }

    async function confirmTokenUse(title, message, primaryLabel) {
        if (!window.UI?.confirm) return window.confirm(message);
        return UI.confirm({ title, message, primaryLabel });
    }

    function applyCompetitionPrice(productId, price, meta = {}) {
        const value = Number(price);
        if (!Number.isFinite(value) || value <= 0) {
            UI.toast('Keepa no devolvió un precio aplicable', 'error');
            return;
        }
        if (!productId) {
            UI.toast('No se pudo identificar el producto de esta ficha', 'error');
            return;
        }
        const lotes = window.State.lotes || [];
        if (!lotes.some(lote => String(lote.id) === String(productId))) {
            UI.toast('Ese producto ya no está en el catálogo activo', 'error');
            return;
        }
        window.State.lotes = lotes.map(lote => {
            if (String(lote.id) !== String(productId)) return lote;
            return {
                ...lote,
                precioCompetencia: value,
                historial: [
                    ...(Array.isArray(lote.historial) ? lote.historial : []),
                    {
                        ts: new Date().toISOString(),
                        tipo: 'keepa_precio',
                        meta: { precioCompetencia: value, asin: meta.asin || '', fuente: meta.source || 'Keepa' },
                    },
                ],
            };
        });
        window.State.save();
        UI.toast(`${Calc.fmtMXN(value)} aplicado como precio de competencia`);
        window.LotesView?.render?.();
    }

    /**
     * Delegación en document: los paneles se reinyectan con innerHTML en cada
     * render de Productos/Wishlist, así que los listeners directos se perdían y
     * los botones quedaban muertos.
     */
    let delegationBound = false;

    function bindDelegation() {
        if (delegationBound || typeof document === 'undefined') return;
        delegationBound = true;
        document.addEventListener('click', event => {
            const btn = event.target?.closest?.('[data-keepa-action]');
            if (!btn) return;
            const host = btn.closest('[data-keepa-asin]');
            if (!host) return;
            event.preventDefault();
            handlePanelAction(btn.getAttribute('data-keepa-action'), btn, host);
        });
    }

    async function handlePanelAction(action, btn, host) {
        const asin = host.getAttribute('data-keepa-asin') || '';
        const productId = host.getAttribute('data-keepa-product-id') || '';
        const detailed = host.getAttribute('data-keepa-detailed') === '1';

        if (action === 'collapse') {
            setPanelPref({ keepaPanelCollapsed: true });
            hydrateNode(host);
            return;
        }
        if (action === 'expand') {
            setPanelPref({ keepaPanelCollapsed: false });
            hydrateNode(host);
            return;
        }
        if (action === 'lab') {
            window.KeepaView?.openAsin?.(asin);
            return;
        }
        if (action === 'apply') {
            const cached = readCache(asin);
            const price = btn.getAttribute('data-price')
                || cached?.marketPrice
                || cached?.currentPrice
                || cached?.amazon;
            applyCompetitionPrice(productId, price, {
                asin,
                source: cached?.priceSource || 'Keepa',
            });
            return;
        }
        if (action === 'consult' || action === 'refresh') {
            const force = action === 'refresh';
            const ok = await confirmTokenUse(
                force ? 'Actualizar resumen Keepa' : 'Consultar Keepa',
                force
                    ? 'Se ignorará la caché de 6 horas. Esta consulta consume aproximadamente 1 token.'
                    : 'Se pedirá el resumen de este ASIN (~1 token). El resultado se reutiliza 6 horas.',
                force ? 'Actualizar' : 'Consultar'
            );
            if (!ok) return;
            await fetchInto(host, () => fetchProduct(asin, { force }), 'Actualizando resumen…', false);
            return;
        }
        if (action === 'details') {
            const ok = await confirmTokenUse(
                'Cargar Buy Box y demanda',
                'Se consultarán Buy Box, vendedor, logística y ventas mensuales. Puede consumir aproximadamente 3–5 tokens; el resultado se reutiliza durante 6 horas.',
                'Usar tokens'
            );
            if (!ok) return;
            await fetchInto(
                host,
                () => fetchResearch(asin, { force: detailed }),
                'Consultando Buy Box y demanda…',
                true
            );
        }
    }

    async function fetchInto(host, task, loadingText, detailed) {
        const compact = host.getAttribute('data-keepa-compact') === '1';
        const productId = host.getAttribute('data-keepa-product-id') || '';
        host.innerHTML = `<div class="keepa-panel keepa-loading muted small">${UI.escapeHTML(loadingText)}</div>`;
        try {
            const data = await task();
            host.setAttribute('data-keepa-detailed', detailed ? '1' : '0');
            host.innerHTML = renderPanel(data, { compact, productId, detailed });
        } catch (err) {
            host.innerHTML = `<div class="keepa-panel keepa-error muted small">${UI.escapeHTML(err.message || 'Error Keepa')}</div>`;
        }
    }

    async function hydrateNode(el) {
        if (!el) return;
        bindDelegation();
        const asin = el.getAttribute('data-keepa-asin') || '';
        const compact = el.getAttribute('data-keepa-compact') === '1';
        const productId = el.getAttribute('data-keepa-product-id') || '';
        const options = { compact, productId, detailed: false };
        el.setAttribute('data-keepa-detailed', '0');

        if (panelPrefs().off) {
            el.innerHTML = '';
            el.hidden = true;
            return;
        }
        el.hidden = false;
        if (!hasKey()) {
            el.innerHTML = `<div class="keepa-panel keepa-empty muted small">Configura Keepa API en Ajustes</div>`;
            return;
        }

        // La caché no necesita red: se muestra aunque la key esté mal escrita.
        const cached = readCache(asin);

        // Compacto (Wishlist): nunca consulta sola; pedir datos es opt-in.
        if (compact) {
            el.innerHTML = cached
                ? renderPanel(cached, options)
                : `<div class="keepa-panel keepa-compact keepa-collapsed">
                        <button type="button" class="btn ghost sm" data-keepa-action="consult">Consultar Keepa · ~1 token</button>
                   </div>`;
            return;
        }
        // Plegado tampoco consulta: solo muestra lo que ya está en caché.
        if (panelPrefs().collapsed) {
            el.innerHTML = renderCollapsedBar(cached, { productId });
            return;
        }
        if (cached) {
            el.innerHTML = renderPanel(cached, options);
            return;
        }
        if (!keyLooksValid()) {
            el.innerHTML = `<div class="keepa-panel keepa-error muted small">La API key guardada no tiene formato de Keepa (64 caracteres alfanuméricos). Vuelve a pegarla en Ajustes → Keepa.</div>`;
            return;
        }
        el.innerHTML = `<div class="keepa-panel keepa-loading muted small">Consultando Keepa…</div>`;
        try {
            const data = await fetchProduct(asin);
            el.innerHTML = renderPanel(data, options);
        } catch (err) {
            el.innerHTML = `<div class="keepa-panel keepa-error muted small">${UI.escapeHTML(err.message || 'Error Keepa')}</div>`;
        }
    }

    async function hydrate(root) {
        if (!root) return;
        const nodes = root.querySelectorAll('[data-keepa-asin]');
        for (const el of nodes) {
            await hydrateNode(el);
        }
    }

    return {
        DOMAIN_MX,
        getApiKey,
        setApiKey,
        hasKey,
        keyLooksValid,
        extractAsin,
        fetchProduct,
        fetchResearch,
        graphImage,
        graphParams,
        productFinder,
        sellerInfo,
        deals,
        tokenStatus,
        renderPanel,
        hydrate,
        readCache,
        panelPrefs,
        setPanelPref,
    };
})();
window.Keepa = Keepa;
