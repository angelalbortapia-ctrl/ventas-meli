/* ==========================================================================
   Ofertas — radar retail → Amazon
   Pegás link Amazon → saca ASIN → Keepa + Shopping (mismo producto en retail).
   También captura manual / bookmarklet de Costco / Sam's / Walmart, etc.
   ========================================================================== */

const OfertasView = (() => {

    const STATUSES = {
        vigilando: { label: 'Vigilando', hint: 'En el radar' },
        viable: { label: 'Viable', hint: 'Conviene comprar' },
        descartada: { label: 'Descartada', hint: 'No procede' },
    };

    const DRAFT_KEY = 'vm:ofertaDraft';

    const local = {
        filter: 'revisar',
        editingId: null,
        /** Prefill desde bookmarklet / hash #oferta=… */
        draft: null,
        /** Solo hits de tiendas retail conocidas (oculta Amazon puro) */
        serpRetailOnly: true,
        serpBusyId: null,
        /** Conserva el form Shopping entre re-renders */
        serpDraft: { asin: '', query: '' },
    };

    function esc(s) {
        return UI.escapeHTML(String(s ?? ''));
    }

    const detectStore = (text) => window.Stores?.detectStore?.(text) || { id: '', label: '' };
    const safeUrl = (value) => window.Stores?.safeUrl?.(value) || '';
    const extractAsin = (text) => window.Stores?.extractAsin?.(text)
        || window.Keepa?.extractAsin?.(text)
        || '';

    function isAmazonView() {
        return window.State.marketplace === 'amazon'
            && window.State.ui?.mpView !== 'general';
    }

    function loadItems() {
        const raw = window.State.ui?.ofertasRetail;
        return Array.isArray(raw) ? raw.map(normalizeItem).filter(Boolean) : [];
    }

    function saveItems(items) {
        window.State.ui = { ...window.State.ui, ofertasRetail: items };
        window.State.saveUI();
    }

    function loadWatches() {
        const raw = window.State.ui?.ofertasSerpWatches;
        return Array.isArray(raw) ? raw.map(normalizeWatch).filter(Boolean) : [];
    }

    function saveWatches(watches) {
        window.State.ui = { ...window.State.ui, ofertasSerpWatches: watches };
        window.State.saveUI();
    }

    function normalizeWatch(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const query = String(raw.query || '').trim();
        const asin = String(raw.asin || '').trim().toUpperCase()
            || extractAsin(raw.linkAmazon || '')
            || extractAsin(query);
        // ASIN-first: basta con ASIN; query vacío = Shopping usa título Keepa
        if (!asin && !query) return null;
        const hits = Array.isArray(raw.hits)
            ? raw.hits.map(h => ({
                title: String(h.title || '').trim(),
                source: String(h.source || '').trim(),
                price: String(h.price || '').trim(),
                extracted_price: Number(h.extracted_price) > 0 ? Number(h.extracted_price) : null,
                old_price: String(h.old_price || '').trim(),
                extracted_old_price: Number(h.extracted_old_price) > 0
                    ? Number(h.extracted_old_price)
                    : null,
                link: String(h.link || h.product_link || '').trim(),
                product_id: String(h.product_id || '').trim(),
                thumbnail: String(h.thumbnail || '').trim(),
                position: h.position,
                rating: Number(h.rating) > 0 ? Number(h.rating) : null,
                reviews: Number(h.reviews) > 0 ? Number(h.reviews) : null,
                delivery: String(h.delivery || h.shipping || '').trim(),
                shipping_extracted: Number(h.shipping_extracted) >= 0
                    ? Number(h.shipping_extracted)
                    : null,
                extracted_total: Number(h.extracted_total) > 0 ? Number(h.extracted_total) : null,
                tag: String(h.tag || '').trim(),
                discount_label: String(h.discount_label || h.discount || '').trim(),
                immersive: !!h.immersive,
                immersive_product_page_token: String(h.immersive_product_page_token || '').trim(),
            })).filter(h => h.title || h.link || h.extracted_price)
            : [];
        return {
            id: raw.id || Data.newId(),
            query,
            asin,
            linkAmazon: String(raw.linkAmazon || '').trim()
                || (asin ? `https://www.amazon.com.mx/dp/${asin}` : ''),
            amazonPrice: Number(raw.amazonPrice) > 0 ? Number(raw.amazonPrice) : 0,
            amazonPriceSource: String(raw.amazonPriceSource || '').trim(),
            keepaTitle: String(raw.keepaTitle || '').trim(),
            keepaBsr: Number(raw.keepaBsr) > 0 ? Number(raw.keepaBsr) : null,
            keepaMonthlySold: Number(raw.keepaMonthlySold) > 0 ? Number(raw.keepaMonthlySold) : null,
            shopQueryUsed: String(raw.shopQueryUsed || '').trim(),
            matchMode: String(raw.matchMode || '').trim(),
            immersiveTitle: String(raw.immersiveTitle || '').trim(),
            immersiveRating: Number(raw.immersiveRating) > 0 ? Number(raw.immersiveRating) : null,
            immersiveReviews: Number(raw.immersiveReviews) > 0 ? Number(raw.immersiveReviews) : null,
            immersiveBrand: String(raw.immersiveBrand || '').trim(),
            titleMatchScore: Number(raw.titleMatchScore) >= 0 ? Number(raw.titleMatchScore) : null,
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
            lastRunAt: raw.lastRunAt || null,
            lastError: String(raw.lastError || '').trim(),
            lastKeepaError: String(raw.lastKeepaError || '').trim(),
            hits,
        };
    }

    function storeFromHit(hit) {
        const src = String(hit?.source || '').trim();
        const link = String(hit?.link || hit?.product_link || '').trim();
        const host = window.Stores?.hostFromUrl?.(link) || '';
        const googleLink = /google\./i.test(host)
            || /shopping\.google|google\.[^/]+\/shopping/i.test(link);

        const matchSource = (text) => {
            const raw = String(text || '').trim();
            if (!raw) return { id: '', label: '' };
            const low = raw.toLowerCase();
            if (/^google(\s|$)/i.test(raw) || low === 'google shopping') {
                return { id: '', label: '' };
            }
            const rules = window.Stores?.STORE_RULES || [];
            for (const r of rules) {
                const labelLow = String(r.label || '').toLowerCase();
                const idLow = String(r.id || '').replace(/_/g, ' ');
                if (labelLow && low.includes(labelLow)) return { id: r.id, label: r.label };
                if (idLow && low.includes(idLow)) return { id: r.id, label: r.label };
                if (r.id === 'sams' && /sam'?s/.test(low)) return { id: r.id, label: r.label };
                if (r.id === 'amazon' && /amazon/.test(low)) return { id: r.id, label: r.label };
            }
            return { id: 'otra', label: raw };
        };

        // SerpAPI `source` = comerciante; los links suelen ser redirects de Google.
        const fromSrc = matchSource(src);
        if (googleLink) {
            if (fromSrc.label) return fromSrc;
            return { id: 'otra', label: src || 'Google Shopping' };
        }

        const urlDet = detectStore(link);
        if (urlDet.id && urlDet.id !== 'otra' && !/^google$/i.test(urlDet.label)) {
            return urlDet;
        }
        if (fromSrc.label) return fromSrc;
        if (urlDet.label && !/^google$/i.test(urlDet.label)) return urlDet;
        return { id: 'otra', label: src || urlDet.label || 'Tienda' };
    }

    /** Mejor precio por tienda en el search (chips de resumen). */
    function storePriceSummary(watch) {
        const amzRef = watchAmazonPrice(watch).price || 0;
        const map = new Map();
        (watch?.hits || []).forEach(h => {
            if (isJunkOfferTitle(h.title) || isJunkOfferTitle(h.source)) return;
            if (isUsOnlyStoreLink(h.link)) return;
            const store = storeFromHit(h);
            const cost = landedCost(h, 0, amzRef);
            if (!(cost.landed > 0) || !store.label) return;
            if (local.serpRetailOnly && store.id === 'amazon') return;
            const prev = map.get(store.label);
            if (prev == null || cost.landed < prev.price) {
                map.set(store.label, {
                    label: store.label,
                    id: store.id,
                    price: cost.landed,
                    hit: h,
                });
            }
        });
        return [...map.values()].sort((a, b) => a.price - b.price);
    }

    /** Agrupa ofertas del MISMO producto. Prioridad: product_id SerpAPI → match estricto. */
    function clusterHits(hits) {
        const byId = new Map();
        const singles = [];

        (hits || []).forEach((hit, origIdx) => {
            const pid = String(hit.product_id || '').trim();
            if (pid) {
                if (!byId.has(pid)) {
                    byId.set(pid, {
                        title: hit.title || 'Sin título',
                        thumbnail: hit.thumbnail || '',
                        product_id: pid,
                        offers: [],
                    });
                }
                const c = byId.get(pid);
                c.offers.push({ hit, origIdx });
                if (!c.thumbnail && hit.thumbnail) c.thumbnail = hit.thumbnail;
                if ((hit.title || '').length > (c.title || '').length) c.title = hit.title;
                return;
            }
            singles.push({ hit, origIdx });
        });

        const clusters = [...byId.values()];
        singles.forEach(({ hit, origIdx }) => {
            let best = { i: -1, score: 0 };
            clusters.forEach((c, i) => {
                const m = titlesSameProduct(c.title, hit.title);
                if (m.ok && m.score > best.score) best = { i, score: m.score };
            });
            if (best.i >= 0) {
                clusters[best.i].offers.push({ hit, origIdx });
                if (!clusters[best.i].thumbnail && hit.thumbnail) {
                    clusters[best.i].thumbnail = hit.thumbnail;
                }
            } else {
                clusters.push({
                    title: hit.title || 'Sin título',
                    thumbnail: hit.thumbnail || '',
                    product_id: '',
                    offers: [{ hit, origIdx }],
                });
            }
        });
        return clusters;
    }

    function visibleClusters(watch) {
        const amzRef = watchAmazonPrice(watch).price || 0;
        const all = (Array.isArray(watch?.hits) ? watch.hits : [])
            .filter(h => !isJunkOfferTitle(h.title) && !isJunkOfferTitle(h.source));
        const clusters = clusterHits(all).map(c => {
            const byStore = new Map();
            c.offers.forEach(o => {
                const store = storeFromHit(o.hit);
                if (store.id !== 'amazon' && isUsOnlyStoreLink(o.hit?.link, store)) return;
                // No uses Amazon Shopping USD como fila “real” si hay Keepa
                if (store.id === 'amazon' && amzRef > 0) return;
                const key = `${store.id || 'otra'}::${store.label || 'Tienda'}`;
                const cost = landedCost(o.hit, Number(o.hit.extracted_price) || Number(o.hit.extracted_total) || 0, amzRef, store);
                const prev = byStore.get(key);
                const better = !prev
                    || costQuality(cost, amzRef) > costQuality(prev.cost, amzRef)
                    || (costQuality(cost, amzRef) === costQuality(prev.cost, amzRef)
                        && cost.landed > 0
                        && cost.landed < (prev.cost.landed || 1e12));
                if (better) {
                    byStore.set(key, {
                        ...o,
                        store,
                        price: cost.landed,
                        cost,
                        disc: hitDiscount(o.hit),
                    });
                }
            });

            let storeOffers = [...byStore.values()];
            const amz = amazonPriceForCluster(c, watch);

            if (local.serpRetailOnly) {
                storeOffers = storeOffers.filter(o => o.store.id !== 'amazon');
            }
            if (amz.matched && amz.price > 0 && !storeOffers.some(o => o.store.id === 'amazon')) {
                storeOffers.push({
                    hit: { title: c.title, extracted_price: amz.price, source: 'Amazon', link: '' },
                    origIdx: -1,
                    store: {
                        id: 'amazon',
                        label: amz.source === 'keepa' ? 'Amazon · Keepa' : 'Amazon',
                    },
                    price: amz.price,
                    cost: { unit: amz.price, ship: 0, landed: amz.price, basis: 'keepa', currency: 'MXN' },
                    disc: { label: '', old: 0 },
                    synthetic: true,
                });
            }

            const ranked = rankStoreOffers(watch, storeOffers, amz.price);
            const retailSorted = ranked.filter(r => !r.hide);
            const amazonRows = storeOffers.filter(o => o.store.id === 'amazon');
            const rankedKeys = new Set(retailSorted.map(r => `${r.store.id}::${r.store.label}`));
            storeOffers = [
                ...retailSorted,
                ...amazonRows.filter(o => !rankedKeys.has(`${o.store.id}::${o.store.label}`)),
            ];

            const best = retailSorted.find(r => r.verdict?.key === 'buy' && r.margin?.ok && r.margin.roi <= 2.5)
                || retailSorted.find(r => r.verdict?.key === 'maybe' && r.margin?.ok && r.margin.roi <= 2.5)
                || retailSorted.find(r => r.margin?.ok && r.margin.roi > 0 && r.margin.roi <= 2.5)
                || null;
            let m = { ok: false, utilidad: 0, margen: 0, roi: 0, precio: amz.price || 0, unmatched: !amz.matched };
            if (best?.margin?.ok) m = best.margin;

            return {
                title: c.title,
                thumbnail: c.thumbnail,
                product_id: c.product_id || '',
                storeOffers,
                ranked: retailSorted,
                amazon: amz,
                margin: m,
                roi: m?.ok ? m.roi : null,
                bestOffer: best,
            };
        });

        const filtered = local.serpRetailOnly
            ? clusters.filter(c => c.storeOffers.some(o => o.store.id !== 'amazon'))
            : clusters.filter(c => c.storeOffers.length > 0);

        const hasRoi = filtered.some(c => c.roi != null && c.roi > 0);
        return filtered.sort((a, b) => {
            if (hasRoi) {
                const ra = a.roi == null ? -Infinity : a.roi;
                const rb = b.roi == null ? -Infinity : b.roi;
                if (rb !== ra) return rb - ra;
            }
            const pa = a.bestOffer?.cost?.landed || 1e12;
            const pb = b.bestOffer?.cost?.landed || 1e12;
            return pa - pb;
        }).slice(0, 20);
    }

    /** Precio Amazon del cluster: con ASIN vigilado, Keepa manda (no el $12.99 USD de Shopping). */
    function amazonPriceForCluster(cluster, watch) {
        const asin = String(watch?.asin || '').trim().toUpperCase();
        if (asin) {
            const fromKeepa = effectiveAmazonPrice({
                asin,
                precioAmazon: Number(watch?.amazonPrice) > 0 ? Number(watch.amazonPrice) : 0,
            });
            if (fromKeepa.price > 0) {
                return {
                    price: fromKeepa.price,
                    source: fromKeepa.source || 'keepa',
                    matched: true,
                    score: 1,
                };
            }
        }

        const offers = cluster?.offers || [];
        let bestInCluster = null;
        offers.forEach(o => {
            if (storeFromHit(o.hit).id !== 'amazon') return;
            const norm = normalizePriceMxn(o.hit, 0);
            if (!(norm.mxn > 0) || norm.suspectUsd) return;
            if (!bestInCluster || norm.mxn < bestInCluster.price) {
                bestInCluster = { price: norm.mxn, source: 'shopping', matched: true, score: 0.5 };
            }
        });
        if (bestInCluster) return bestInCluster;
        return { price: 0, source: 'none', matched: false, score: 0 };
    }

    function parseMoneyLoose(value) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
        const s = String(value || '').replace(/[^0-9.,]/g, '');
        if (!s) return 0;
        let norm = s;
        // 1,299.50 (US) / 1.299,50 (MX) / 12,99 (decimal)
        if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
            norm = s.replace(/,/g, '');
        } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
            norm = s.replace(/\./g, '').replace(',', '.');
        } else if (s.includes(',') && s.includes('.')) {
            norm = s.lastIndexOf(',') > s.lastIndexOf('.')
                ? s.replace(/\./g, '').replace(',', '.')
                : s.replace(/,/g, '');
        } else if (s.includes(',')) {
            // "1,299" miles → 1299; "12,99" decimal → 12.99
            norm = /^\d{1,3}(,\d{3})+$/.test(s)
                ? s.replace(/,/g, '')
                : s.replace(',', '.');
        }
        const parsed = parseFloat(norm);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    function usdMxnRate() {
        const n = Number(window.State?.settings?.tipoCambioUsd
            ?? window.State?.settings?.usdMxn
            ?? window.State?.ui?.usdMxn);
        return Number.isFinite(n) && n >= 10 && n <= 40 ? n : 17.5;
    }

    function detectPriceCurrency(priceStr) {
        const s = String(priceStr || '').trim();
        if (!s) return '';
        if (/US\s*\$|USD|U\$S/i.test(s)) return 'USD';
        if (/MX\s*\$|MXN|\bMN\b/i.test(s)) return 'MXN';
        return '';
    }

    /** Heurística: bare $ muy bajo vs Amazon MX → sospecha USD. */
    function inferCurrency(hit, rawUnit, refAmzMxn, mxRetail) {
        const explicit = detectPriceCurrency(hit?.price)
            || detectPriceCurrency(hit?.total)
            || detectPriceCurrency(hit?.old_price);
        if (explicit) return explicit;
        if (mxRetail) return 'MXN';
        const priceStr = String(hit?.price || hit?.total || '');
        if (refAmzMxn > 0 && rawUnit > 0 && rawUnit < refAmzMxn * 0.15
            && /\$/.test(priceStr) && !/MX/i.test(priceStr)) {
            return 'USD';
        }
        return '';
    }

    function isJunkOfferTitle(title) {
        const t = String(title || '').toLowerCase();
        if (!t || t.length < 4) return true;
        return /item_title|google_cloud_translation|translation_test|test_for_us|_placeholder|lorem ipsum|product_title_here/.test(t);
    }

    function isUsOnlyStoreLink(link, store = null) {
        // Tiendas MX conocidas: Immersive a veces usa hosts .com — no descartar
        if (store && isMxRetailStore(store)) return false;
        const url = String(link || '');
        try {
            const host = new URL(url).hostname.toLowerCase();
            if (/\.com\.mx$/i.test(host)) return false;
            if (/(^|\.)amazon\.com$/i.test(host)) return true;
            if (/(^|\.)ebay\.com$/i.test(host)) return true;
            if (/(^|\.)walmart\.com$/i.test(host)) return true;
            if (/(^|\.)target\.com$/i.test(host)) return true;
            // Sam's/Costco .com sin store MX → US
            if (/(^|\.)samsclub\.com$/i.test(host)) return true;
            if (/(^|\.)costco\.com$/i.test(host)) return true;
        } catch (_) { /* google redirect u otro */ }
        return false;
    }

    function isMxRetailStore(store) {
        const id = String(store?.id || '');
        const label = String(store?.label || '').toLowerCase();
        const trusted = new Set([
            'costco', 'sams', 'walmart', 'bodega', 'liverpool', 'suburbia', 'palacio',
            'coppel', 'elektra', 'home_depot', 'office_depot', 'soriana', 'chedraui',
            'heb', 'city_market', 'mercado_libre', 'rappi', 'sanborns', 'sears', 'bestbuy',
        ]);
        if (trusted.has(id)) return true;
        if (/sam'?s|costco|walmart|rappi|mercado\s*libre|bodega|soriana|chedraui|heb/i.test(label)) {
            return true;
        }
        return false;
    }

    /** Calidad del costo para elegir entre hits de la misma tienda. */
    function costQuality(cost, amzRef = 0) {
        if (!cost) return -3;
        if (cost.invalid || !(cost.landed > 0)) return -2;
        if (amzRef > 0 && cost.landed < amzRef * 0.22) return -1;
        if (cost.needsVerify) return 1;
        if (amzRef > 0 && cost.landed > amzRef * 1.5) return 1;
        return 2;
    }

    /** ¿El precio cae en banda creíble vs Amazon MX? */
    function priceBandScore(n, refAmzMxn) {
        if (!(n > 0) || !(refAmzMxn > 0)) return -50;
        const ratio = n / refAmzMxn;
        if (ratio >= 0.35 && ratio <= 1.05) return 20 - Math.abs(0.65 - ratio) * 10;
        if (ratio >= 0.28 && ratio <= 1.2) return 12;
        if (ratio >= 0.22 && ratio <= 1.35) return 5;
        if (ratio >= 0.18 && ratio <= 1.6) return 1;
        return -Math.abs(Math.log(ratio || 1e-6));
    }

    /**
     * Candidatos de anaquel (sin envío Google).
     * Incluye total−99 / total−ship cuando Google mete fee o precio por unidad raro.
     */
    function pickRawPriceCandidates(hit, { shelfOnly = false } = {}) {
        const out = [];
        const push = (n, src) => {
            if (Number.isFinite(n) && n > 0) out.push({ n, src });
        };
        const unit = Number(hit?.extracted_price) > 0
            ? Number(hit.extracted_price)
            : parseMoneyLoose(hit?.price);
        const ship = Number(hit?.shipping_extracted);
        const total = Number(hit?.extracted_total) > 0
            ? Number(hit.extracted_total)
            : parseMoneyLoose(hit?.total);

        push(unit, 'extracted');
        push(parseMoneyLoose(hit?.price), 'price_str');

        if (shelfOnly) {
            // Paquete sin fee: total − envío
            if (total > 0 && Number.isFinite(ship) && ship > 0 && total > ship + 1) {
                push(total - ship, 'total_minus_ship');
            }
            // Precio ya incluye +$99 (sin total separado)
            if (unit > 0 && Number.isFinite(ship) && Math.abs(ship - 99) < 0.51 && unit > ship + 1) {
                push(unit - ship, 'unit_minus_ship');
            }
            if (total > 0 && unit > 0 && Math.abs(total - (unit + 99)) < 0.08) {
                push(unit, 'unit_not_plus99');
            } else if (total > 99 && Number.isFinite(ship) && Math.abs(ship - 99) < 0.51) {
                push(total - ship, 'total_minus_ship');
            }
            // Total como anaquel solo si no es unit+$99
            if (total > 0 && (!unit || total > unit * 1.15)) {
                push(total, 'total_as_shelf');
            }
        } else {
            push(total, 'total');
            push(parseMoneyLoose(hit?.total), 'total_str');
        }

        const seen = new Set();
        return out.filter(x => {
            if (!shelfOnly && (x.src === 'total' || x.src === 'total_str') && unit > 0) {
                if (Number.isFinite(ship) && ship > 0 && Math.abs(x.n - (unit + ship)) < 0.05) return false;
                if (Math.abs(x.n - (unit + 99)) < 0.05) return false;
            }
            // En shelf: no uses total crudo si es unit+99
            if (shelfOnly && x.src === 'total_as_shelf' && unit > 0
                && Math.abs(x.n - (unit + 99)) < 0.08) return false;
            const k = x.n.toFixed(2);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    function pickBestRawPrice(hit, refAmzMxn = 0, { shelfOnly = false } = {}) {
        const cands = pickRawPriceCandidates(hit, { shelfOnly });
        if (!cands.length) {
            const fallback = Number(hit?.extracted_price) > 0
                ? Number(hit.extracted_price)
                : parseMoneyLoose(hit?.price);
            return fallback > 0 ? fallback : 0;
        }
        if (!refAmzMxn) {
            // Sin Keepa aún: preferí strip de +$99 sobre extracted crudo
            const stripped = cands.find(c =>
                c.src === 'unit_minus_ship' || c.src === 'total_minus_ship' || c.src === 'unit_not_plus99'
            );
            const shelf = cands.find(c => c.src === 'extracted' || c.src === 'price_str');
            return (stripped || shelf || cands[0]).n;
        }

        const scored = cands.map(({ n, src }) => {
            let score = priceBandScore(n, refAmzMxn);
            if (src === 'extracted' || src === 'price_str' || src === 'unit_not_plus99') score += 1.5;
            if (src === 'total_minus_ship' || src === 'unit_minus_ship') score += 1.2;
            if (src === 'total' || src === 'total_str' || src === 'total_as_shelf') score -= 2;
            // Castigá precios ridículos aunque no haya mejor candidato
            if (n < refAmzMxn * 0.2) score -= 15;
            if (n < refAmzMxn * 0.12) score -= 25;
            return { n, score, src };
        });
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        // Si el “mejor” sigue bajo la banda mínima, devolvélo igual (normalize lo marca inválido)
        return best?.n || 0;
    }

    /**
     * Normaliza precio a MXN.
     * Solo convierte USD explícito o sospechoso (bare $ irreal vs Amazon).
     * Tiendas MX / club: precio de anaquel, NUNCA +$99 envío de Google.
     * Umbrales alineados con offerSanity: inválido <25% o >2.2× Amazon.
     */
    function normalizePriceMxn(hit, refAmzMxn = 0, store = null) {
        const st = store || storeFromHit(hit);
        const mxRetail = isMxRetailStore(st);
        const club = isMembershipClub(st?.id);
        const shelfOnly = mxRetail || club;

        let rawUnit = pickBestRawPrice(hit, refAmzMxn > 0 ? refAmzMxn : 0, { shelfOnly })
            || (Number(hit?.extracted_price) > 0
                ? Number(hit.extracted_price)
                : parseMoneyLoose(hit?.price));
        const rawShip = Number(hit?.shipping_extracted);
        const rawTotal = Number(hit?.extracted_total);
        const cur = inferCurrency(hit, rawUnit, refAmzMxn, mxRetail);

        const rate = usdMxnRate();
        let currency = cur || 'MXN';
        let converted = false;
        let invalid = false;
        let invalidReason = '';
        let needsVerify = false;

        if (cur === 'USD') {
            currency = 'USD';
            converted = true;
        }

        const mult = converted ? rate : 1;
        let unit = rawUnit > 0 ? rawUnit * mult : 0;

        // Club/retail: si el unit elegido parece incluir +$99 de Google, restalo
        if (shelfOnly && unit > 0 && Number.isFinite(rawShip) && rawShip > 0) {
            const extracted = Number(hit?.extracted_price) > 0 ? Number(hit.extracted_price) * mult : 0;
            if (extracted > 0
                && Math.abs(unit - (extracted + rawShip * mult)) < 0.08) {
                unit = extracted;
            }
            if (Math.abs(rawShip - 99) < 0.51) {
                const stripped = unit - rawShip * mult;
                if (stripped > 0 && refAmzMxn > 0
                    && priceBandScore(stripped, refAmzMxn) > priceBandScore(unit, refAmzMxn) + 1) {
                    unit = stripped;
                }
            }
        }
        if (shelfOnly && Number(hit?.extracted_price) > 0 && unit > 0) {
            const shelf = Number(hit.extracted_price) * mult;
            if (Math.abs(unit - (shelf + 99 * mult)) < 0.05) unit = shelf;
            if (Math.abs(unit - (shelf + 99)) < 0.05) unit = shelf;
        }

        const ship = (!shelfOnly && Number.isFinite(rawShip) && rawShip > 0)
            ? rawShip * mult
            : 0;
        let landed = unit;
        let basis = 'unit';
        if (!shelfOnly
            && Number.isFinite(rawTotal) && rawTotal > rawUnit && rawTotal < rawUnit * 3) {
            landed = rawTotal * mult;
            basis = 'total';
        } else if (ship > 0) {
            landed = unit + ship;
            basis = 'unit+ship';
        }
        if (shelfOnly) {
            landed = unit;
            basis = 'shelf';
        }

        // Sanity vs Amazon
        if (refAmzMxn > 0 && landed > 0) {
            const ratio = landed / refAmzMxn;
            if (ratio < 0.12 || ratio > 2.8) {
                invalid = true;
                invalidReason = ratio < 0.12
                    ? 'Precio irreal vs Amazon MX'
                    : 'Precio demasiado alto vs Amazon';
            } else if (ratio < 0.28 || ratio > 1.7) {
                needsVerify = true;
            }
        }

        if (converted && refAmzMxn > 0 && landed > 0 && !invalid) {
            if (landed < refAmzMxn * 0.12 || landed > refAmzMxn * 2.8) {
                invalid = true;
                invalidReason = 'USD convertido sigue irreal vs Amazon';
                landed = 0;
            }
        }

        const finalLanded = invalid ? 0 : (shelfOnly ? unit : landed);
        return {
            mxn: finalLanded,
            unit: invalid ? 0 : unit,
            ship: shelfOnly || invalid ? 0 : ship,
            landed: finalLanded,
            currency,
            converted,
            suspectUsd: cur === 'USD' && !mxRetail,
            invalid,
            invalidReason,
            needsVerify,
            rate: converted ? rate : null,
            rawUnit,
            basis: shelfOnly ? 'shelf' : basis,
        };
    }

    function hitDiscount(hit) {
        const now = Number(hit?.extracted_price) || parseMoneyLoose(hit?.price) || 0;
        const old = Number(hit?.extracted_old_price) || parseMoneyLoose(hit?.old_price) || 0;
        if (now > 0 && old > now) {
            const save = old - now;
            const pct = save / old;
            return {
                pct,
                save,
                old,
                label: hit?.discount_label || `−${Math.round(pct * 100)}%`,
            };
        }
        if (hit?.discount_label) {
            return { pct: 0, save: 0, old: 0, label: String(hit.discount_label) };
        }
        return { pct: 0, save: 0, old: 0, label: '' };
    }

    function offerSanity(cost, amzMxn) {
        if (cost?.invalid) {
            return { ok: false, reason: cost.invalidReason || 'Precio inválido' };
        }
        if (!(cost?.landed > 0) || !(amzMxn > 0)) {
            return { ok: false, reason: 'Sin precio' };
        }
        if (cost.landed < amzMxn * 0.18) {
            return { ok: false, reason: 'Demasiado barato vs Amazon MX' };
        }
        if (cost.landed > amzMxn * 2.5) {
            return { ok: false, reason: 'Más caro que Amazon' };
        }
        return { ok: true, reason: '' };
    }

    function titleTokens(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/gi, ' ')
            .split(/\s+/)
            .filter(t => t.length > 1);
    }

    const TITLE_STOP = new Set([
        'de', 'la', 'el', 'los', 'las', 'del', 'una', 'uno', 'un', 'y', 'o', 'en', 'con', 'sin',
        'para', 'por', 'the', 'and', 'or', 'of', 'a', 'ml', 'gr', 'g', 'kg', 'oz', 'pack',
        'pieza', 'piezas', 'pza', 'pzas', 'uds', 'ud', 'unidad', 'unidades', 'nuevo', 'nueva',
        'original', 'oferta', 'envio', 'gratis', 'amazon', 'walmart', 'costco', 'sams',
    ]);

    /** Tokens distintivos (sin stopwords genéricas). */
    function distinctiveTokens(text) {
        return titleTokens(text).filter(t => !TITLE_STOP.has(t) && !/^\d+$/.test(t));
    }

    /** Tamaños/cantidades del título: 200ml, 50g, etc. */
    function sizeSignatures(text) {
        const out = [];
        const re = /(\d+(?:[.,]\d+)?)\s*(ml|mll|g|gr|gramos?|kg|oz|l|lt|lts|litros?|pcs?|pzas?)/gi;
        let m;
        while ((m = re.exec(String(text || ''))) !== null) {
            const n = m[1].replace(',', '.');
            let u = m[2].toLowerCase();
            if (u === 'gr' || u === 'gramos' || u === 'gramo') u = 'g';
            if (u === 'mll') u = 'ml';
            if (u === 'lt' || u === 'lts' || u === 'litro' || u === 'litros') u = 'l';
            if (u === 'pza' || u === 'pzas' || u === 'pcs' || u === 'pc') u = 'pz';
            out.push(`${n}${u}`);
        }
        return out;
    }

    function normalizeTitleKey(text) {
        return distinctiveTokens(text).join(' ');
    }

    /**
     * ¿Mismo producto? Estricto:
     * - si ambos tienen tamaño (ml/g…) y no coinciden → no
     * - overlap alto de tokens distintivos (no solo la marca)
     */
    function titlesSameProduct(a, b) {
        const ta = distinctiveTokens(a);
        const tb = distinctiveTokens(b);
        if (!ta.length || !tb.length) return { ok: false, score: 0 };

        const sizesA = sizeSignatures(a);
        const sizesB = sizeSignatures(b);
        if (sizesA.length && sizesB.length) {
            const setB = new Set(sizesB);
            if (!sizesA.some(s => setB.has(s))) {
                return { ok: false, score: 0 };
            }
        }

        const setB = new Set(tb);
        const inter = ta.filter(t => setB.has(t));
        const union = new Set([...ta, ...tb]).size;
        const jaccard = union > 0 ? inter.length / union : 0;
        const coverA = inter.length / ta.length;
        const coverB = inter.length / tb.length;

        // Misma clave normalizada
        if (normalizeTitleKey(a) && normalizeTitleKey(a) === normalizeTitleKey(b)) {
            return { ok: true, score: 1 };
        }

        // Exigir overlap real de características (no solo "nivea")
        const ok = inter.length >= 3
            && jaccard >= 0.62
            && Math.min(coverA, coverB) >= 0.55;

        // Títulos cortos: casi idénticos
        const shortOk = ta.length <= 3 && tb.length <= 3
            && inter.length >= 2
            && jaccard >= 0.8;

        return { ok: ok || shortOk, score: jaccard };
    }

    function keepaTitleForAsin(asin) {
        const code = String(asin || '').trim().toUpperCase();
        if (!code) return '';
        const snap = keepaSnap(code);
        return String(snap?.title || '').trim();
    }

    /**
     * Precio Amazon POR hit (no reutilizar el ASIN del watch en todos).
     * 1) Si el hit es Amazon → su precio
     * 2) Mismo product_id en un hit Amazon del search
     * 3) Match estricto de título vs hits Amazon
     * 4) Keepa del ASIN del watch solo con match estricto de título
     */
    function amazonPriceForHit(hit, watch) {
        const store = storeFromHit(hit);
        const amzWatch = Number(watch?.amazonPrice) || 0;
        if (store.id === 'amazon') {
            const norm = normalizePriceMxn(hit, amzWatch, store);
            const own = norm.landed > 0 ? norm.landed : (Number(hit?.extracted_price) || 0);
            if (own > 0 && !norm.invalid) {
                return { price: own, source: 'shopping', matched: true, score: 1 };
            }
        }

        const hitTitle = String(hit?.title || '');
        const hitPid = String(hit?.product_id || '').trim();
        const list = Array.isArray(watch?.hits) ? watch.hits : [];
        let best = { price: 0, source: 'none', matched: false, score: 0 };

        list.forEach(other => {
            if (other === hit) return;
            if (storeFromHit(other).id !== 'amazon') return;
            const norm = normalizePriceMxn(other, amzWatch, { id: 'amazon', label: 'Amazon' });
            const p = norm.landed > 0 ? norm.landed : (Number(other.extracted_price) || 0);
            if (!(p > 0) || norm.invalid) return;

            const otherPid = String(other.product_id || '').trim();
            if (hitPid && otherPid && hitPid === otherPid) {
                best = { price: p, source: 'shopping', matched: true, score: 1 };
                return;
            }

            const m = titlesSameProduct(hitTitle, other.title);
            if (m.ok && m.score > best.score) {
                best = { price: p, source: 'shopping', matched: true, score: m.score };
            }
        });
        if (best.matched) return best;

        const asin = String(watch?.asin || '').trim().toUpperCase();
        if (asin) {
            const kTitle = keepaTitleForAsin(asin);
            if (kTitle) {
                const m = titlesSameProduct(hitTitle, kTitle);
                if (m.ok) {
                    const fromKeepa = effectiveAmazonPrice({
                        asin,
                        precioAmazon: amzWatch > 0 ? amzWatch : 0,
                    });
                    if (fromKeepa.price > 0) {
                        return {
                            price: fromKeepa.price,
                            source: fromKeepa.source || 'keepa',
                            matched: true,
                            score: m.score,
                        };
                    }
                }
            }
        }

        return { price: 0, source: 'none', matched: false, score: best.score || 0 };
    }

    /** Precio de referencia del watch (header): Keepa ASIN o — */
    function watchAmazonPrice(watch) {
        const manual = Number(watch?.amazonPrice) || 0;
        if (manual > 0) {
            return {
                price: manual,
                source: watch.amazonPriceSource || 'keepa',
            };
        }
        if (watch?.asin) {
            const fromKeepa = effectiveAmazonPrice({ asin: watch.asin, precioAmazon: 0 });
            if (fromKeepa.price > 0) return fromKeepa;
        }
        return { price: 0, source: 'none' };
    }

    /** Costo efectivo en MXN (convierte USD si hace falta). */
    function landedCost(hit, fallbackPrice = 0, refAmzMxn = 0, store = null) {
        const base = hit && typeof hit === 'object' ? { ...hit } : {};
        if (!(Number(base.extracted_price) > 0) && fallbackPrice > 0) {
            base.extracted_price = fallbackPrice;
        }
        const st = store || storeFromHit(base);
        const norm = normalizePriceMxn(base, refAmzMxn, st);
        return {
            unit: norm.unit,
            ship: norm.ship,
            landed: norm.landed || norm.unit,
            basis: norm.converted ? `${norm.basis}:${norm.currency}` : norm.basis,
            currency: norm.currency,
            converted: norm.converted,
            suspectUsd: norm.suspectUsd,
            invalid: !!norm.invalid,
            invalidReason: norm.invalidReason || '',
            needsVerify: !!norm.needsVerify,
            rate: norm.rate,
            rawUnit: norm.rawUnit,
        };
    }

    /**
     * Veredicto por oferta retail vs Amazon/Keepa + demanda.
     * buy | maybe | skip
     */
    function offerVerdict(m, watch, cost = {}) {
        const landed = Number(cost.landed) || 0;
        const amz = Number(watchAmazonPrice(watch).price) || Number(m?.precio) || 0;
        const sanity = offerSanity(cost, amz);
        const roi = m?.ok ? m.roi : null;
        const util = m?.ok ? m.utilidad : null;
        const monthly = Number(watch?.keepaMonthlySold) || 0;
        const bsr = Number(watch?.keepaBsr) || 0;
        const demandOk = monthly >= 50 || (bsr > 0 && bsr <= 80000);
        const demandWeak = bsr > 0 && bsr > 250000 && monthly < 20;

        if (!sanity.ok) {
            return {
                key: 'skip',
                label: 'Descartar',
                reason: sanity.reason,
                score: -1,
            };
        }
        if (!m?.ok || !(landed > 0)) {
            return {
                key: 'skip',
                label: 'Sin datos',
                reason: 'Falta precio Amazon (Keepa) o costo retail',
                score: -1,
            };
        }
        // ROI disparatado = moneda/producto mal matcheado
        if (roi > 2.5) {
            return {
                key: 'skip',
                label: 'Dudoso',
                reason: `ROI ${Calc.fmtPct(roi)} irreal — no confiar`,
                score: -2,
            };
        }
        if (util <= 0 || roi < 0) {
            return {
                key: 'skip',
                label: 'Descartar',
                reason: util <= 0 ? 'Utilidad negativa tras fees' : 'ROI negativo',
                score: roi,
            };
        }
        const fxNote = cost.converted ? ` · conv. USD×${cost.rate}` : '';
        if (roi >= 0.25 && (!demandWeak || demandOk)) {
            return {
                key: 'buy',
                label: 'Comprar',
                reason: (demandOk
                    ? `ROI ${Calc.fmtPct(roi)} y demanda OK`
                    : `ROI alto ${Calc.fmtPct(roi)} — validá rotación`) + fxNote,
                score: roi + (demandOk ? 0.05 : 0),
            };
        }
        if (roi >= 0.15) {
            return {
                key: demandWeak ? 'maybe' : 'buy',
                label: demandWeak ? 'Revisar' : 'Comprar',
                reason: (demandWeak
                    ? `ROI ${Calc.fmtPct(roi)} pero BSR flojo`
                    : `ROI ${Calc.fmtPct(roi)} razonable`) + fxNote,
                score: roi,
            };
        }
        if (roi >= 0.08) {
            return {
                key: 'maybe',
                label: 'Revisar',
                reason: `ROI justo (${Calc.fmtPct(roi)}) — solo si movés volumen${fxNote}`,
                score: roi,
            };
        }
        return {
            key: 'skip',
            label: 'Descartar',
            reason: `ROI bajo (${Calc.fmtPct(roi)})`,
            score: roi,
        };
    }

    function isMembershipClub(storeId) {
        const id = String(storeId || '');
        return id === 'sams' || id === 'costco';
    }

    /** Sam's/Costco: ignorá “+$99 envío” de Google (membresía / pickup). */
    function deliveryNote(hit, store, cost) {
        if (isMembershipClub(store?.id)) return '';
        if (cost?.ship > 0) return `+${Calc.fmtMXN(cost.ship)} envío`;
        const raw = String(hit?.delivery || '').trim();
        if (!raw) return '';
        // Basura típica Immersive
        if (/\+?\s*\$?\s*99\b/i.test(raw) && isMxRetailStore(store)) return '';
        return raw;
    }

    /** Rankea ofertas retail con ROI + veredicto (todo en MXN vs Keepa). */
    function rankStoreOffers(watch, storeOffers, amzPrice) {
        const rows = [];
        (storeOffers || []).forEach(o => {
            if (o.synthetic || o.store?.id === 'amazon') return;
            if (isJunkOfferTitle(o.hit?.title) || isJunkOfferTitle(o.hit?.source)) {
                rows.push({
                    ...o,
                    cost: o.cost || landedCost(o.hit, o.price, amzPrice),
                    margin: { ok: false },
                    verdict: {
                        key: 'skip',
                        label: 'Basura',
                        reason: 'Título inválido de Google',
                        score: -9,
                    },
                });
                return;
            }
            if (isUsOnlyStoreLink(o.hit?.link, o.store) || /^ebay\b/i.test(String(o.store?.label || o.hit?.source || ''))) {
                rows.push({
                    ...o,
                    cost: o.cost || landedCost(o.hit, o.price, amzPrice),
                    margin: { ok: false },
                    verdict: {
                        key: 'skip',
                        label: 'US',
                        reason: 'Tienda / listing US — ignorar',
                        score: -8,
                    },
                    hide: true,
                });
                return;
            }

            const cost = landedCost(o.hit, o.price, amzPrice, o.store);

            // Precio basura / irreal: no inventes ROI ni ensucies la tabla
            if (cost.invalid || !(cost.landed > 0)) {
                rows.push({
                    ...o,
                    cost,
                    margin: { ok: false },
                    price: 0,
                    verdict: {
                        key: 'skip',
                        label: 'Dato malo',
                        reason: cost.invalidReason || 'Sin precio usable',
                        score: -7,
                    },
                    hide: true,
                });
                return;
            }

            if (cost.needsVerify) {
                rows.push({
                    ...o,
                    cost,
                    margin: { ok: false },
                    price: cost.landed,
                    verdict: {
                        key: 'maybe',
                        label: 'Verificar',
                        reason: 'Confirmá en el link — Google a veces falla',
                        score: 0.03,
                    },
                });
                return;
            }

            const margin = metricsFor({
                costo: cost.landed,
                asin: watch?.asin || '',
                precioAmazon: amzPrice,
                titulo: o.hit?.title || watch?.keepaTitle || '',
                linkTienda: o.hit?.link || '',
                tienda: o.store?.label || '',
            });
            let verdict = offerVerdict(margin, watch, cost);
            rows.push({ ...o, cost, margin, verdict, price: cost.landed });
        });
        rows.sort((a, b) => (b.verdict?.score ?? -99) - (a.verdict?.score ?? -99));
        return rows;
    }

    function buildRecommendations(watch, clusters) {
        const amzWatch = watchAmazonPrice(watch);
        const ranked = [];
        (clusters || []).forEach(c => {
            const amzPrice = (c.amazon?.price > 0) ? c.amazon.price : amzWatch.price;
            const rows = (Array.isArray(c.ranked) && c.ranked.length)
                ? c.ranked
                : rankStoreOffers(watch, c.storeOffers, amzPrice);
            rows.filter(r => !r.hide).forEach(r => {
                ranked.push({
                    ...r,
                    clusterTitle: c.title,
                    productKey: c.product_id || c.title || '',
                    _amzPrice: amzPrice,
                });
            });
        });
        // Dedup por producto + tienda (no mezclar Costco de otro cluster)
        const byKey = new Map();
        ranked.forEach(r => {
            const key = `${r.productKey}::${r.store?.id || ''}::${r.store?.label || ''}`;
            const prev = byKey.get(key);
            if (!prev || (r.verdict?.score ?? -99) > (prev.verdict?.score ?? -99)) {
                byKey.set(key, r);
            }
        });
        const all = [...byKey.values()].sort(
            (a, b) => (b.verdict?.score ?? -99) - (a.verdict?.score ?? -99)
        );
        const buy = all.filter(r => r.verdict?.key === 'buy');
        const maybe = all.filter(r => r.verdict?.key === 'maybe');
        const skip = all.filter(r => r.verdict?.key === 'skip');

        let headline = 'Sin recomendación clara';
        let detail = 'Actualizá o revisá precio Amazon / costos.';
        let tone = 'muted';
        const top = buy[0] || maybe[0] || null;
        const amz = { price: top?._amzPrice || amzWatch.price, source: amzWatch.source };
        if (buy[0]) {
            headline = `Comprá en ${buy[0].store.label}`;
            detail = `${buy[0].verdict.reason} · landed ${Calc.fmtMXN(buy[0].cost.landed)} → Amazon ${Calc.fmtMXN(amz.price)}`;
            tone = 'pos';
        } else if (maybe[0]) {
            headline = `Revisá ${maybe[0].store.label}`;
            detail = maybe[0].verdict.reason;
            tone = 'warn';
        } else if (skip.length && amz.price > 0) {
            headline = 'No conviene ahora';
            detail = skip[0]?.verdict?.reason || 'Ninguna tienda da ROI suficiente';
            tone = 'neg';
        }

        const demand = [];
        if (watch.keepaMonthlySold) {
            demand.push(`~${Math.round(watch.keepaMonthlySold)} uds/mes (Keepa)`);
        }
        if (watch.keepaBsr) {
            demand.push(`BSR ${Math.round(watch.keepaBsr).toLocaleString('es-MX')}`);
        }
        if (watch.immersiveTitle && watch.keepaTitle
            && !titlesSameProduct(watch.immersiveTitle, watch.keepaTitle).ok) {
            demand.push('⚠ Título Immersive ≠ Keepa — verificá que sea el mismo producto');
        }

        return { headline, detail, tone, top, buy, maybe, skip, all, amz, demand };
    }

    /** Query corta para Shopping a partir del título Keepa (mismo producto). */
    function shoppingQueryFromTitle(title) {
        const tokens = distinctiveTokens(title).slice(0, 8);
        if (tokens.length >= 3) return tokens.join(' ');
        const raw = String(title || '').trim().replace(/\s+/g, ' ');
        return raw.slice(0, 90);
    }

    /** Deja solo hits del mismo producto que el título Keepa/ASIN. */
    function filterHitsToProduct(hits, productTitle) {
        const title = String(productTitle || '').trim();
        if (!title) return Array.isArray(hits) ? hits.slice() : [];
        const list = hits || [];
        const strict = list.filter(h => titlesSameProduct(h.title, title).ok);
        if (strict.length) return strict;
        // Fallback suave: overlap de tokens (si el estricto deja 0, Ofertas “no sirve”)
        const soft = list.filter(h => {
            const m = immersiveTitleMatchesKeepa(h.title, title);
            return m.ok || m.score >= 0.35;
        });
        return soft.slice(0, 30);
    }

    async function refreshWatchAmazonPrice(watch, { force = true } = {}) {
        const asin = String(watch?.asin || '').trim().toUpperCase();
        if (!asin) {
            return {
                amazonPrice: 0,
                amazonPriceSource: '',
                keepaTitle: '',
                keepaBsr: null,
                keepaMonthlySold: null,
                keepaOk: false,
                keepaError: 'Falta ASIN',
            };
        }
        let keepaError = '';
        if (window.Keepa?.hasKey?.() && window.Keepa?.fetchProduct) {
            try {
                await Keepa.fetchProduct(asin, { force: !!force });
            } catch (err) {
                keepaError = err.message || String(err);
                console.warn('[ofertas] Keepa refresh', err);
            }
        } else {
            keepaError = 'Sin key Keepa en Ajustes';
        }
        const fromKeepa = effectiveAmazonPrice({ asin, precioAmazon: 0 });
        const keepaTitle = keepaTitleForAsin(asin) || String(watch.keepaTitle || '').trim();
        const snap = keepaSnap(asin);
        const bsr = Number(snap?.bsr ?? snap?.salesRank ?? snap?.currentSalesRank);
        const monthly = Number(snap?.monthlySold);
        return {
            amazonPrice: fromKeepa.price || 0,
            amazonPriceSource: fromKeepa.price > 0 ? (fromKeepa.source || 'keepa') : '',
            keepaTitle,
            keepaBsr: Number.isFinite(bsr) && bsr > 0 ? bsr : null,
            keepaMonthlySold: Number.isFinite(monthly) && monthly > 0 ? monthly : null,
            keepaOk: fromKeepa.price > 0 || !!keepaTitle,
            keepaError: keepaTitle ? keepaError : (keepaError || 'Keepa no devolvió título'),
        };
    }

    /** Score título Shopping vs Keepa; prioriza token Immersive. Lista rankeada. */
    function rankImmersiveSeeds(results, productTitle) {
        const title = String(productTitle || '').trim();
        const scored = (results || []).map(hit => {
            const match = title ? titlesSameProduct(hit.title, title) : { ok: false, score: 0 };
            const token = String(hit.immersive_product_page_token || '').trim();
            let score = Number(match.score) || 0;
            if (match.ok) score += 10;
            if (token) score += 5;
            if (hit.multiple_sources) score += 1;
            if (Number(hit.extracted_price) > 0) score += 0.2;
            return { hit, token, ok: !!match.ok, score, jaccard: Number(match.score) || 0 };
        }).filter(x => x.token);

        scored.sort((a, b) => {
            if (a.ok !== b.ok) return a.ok ? -1 : 1;
            return b.score - a.score;
        });
        return scored;
    }

    function pickImmersiveSeed(results, productTitle) {
        const ranked = rankImmersiveSeeds(results, productTitle);
        if (ranked[0]?.ok) return ranked[0];
        const soft = [...ranked].sort((a, b) => b.jaccard - a.jaccard)[0];
        if (soft && soft.jaccard >= 0.32) return soft;
        return ranked[0] || null;
    }

    function immersiveTitleMatchesKeepa(immTitle, keepaTitle) {
        const a = String(immTitle || '').trim();
        const b = String(keepaTitle || '').trim();
        if (!a || !b) return { ok: false, score: 0 };
        const m = titlesSameProduct(a, b);
        if (m.ok) return m;
        // Soft: overlap de tokens distintivos (Keepa suele ser más largo)
        const ta = distinctiveTokens(a);
        const tb = distinctiveTokens(b);
        const setB = new Set(tb);
        const inter = ta.filter(t => setB.has(t));
        const cover = ta.length ? inter.length / ta.length : 0;
        const score = Math.max(m.score, cover * 0.85);
        return { ok: inter.length >= 2 && cover >= 0.4, score };
    }

    function hitsFromImmersive(product, stores, seed) {
        const title = String(product?.title || seed?.title || '').trim();
        const thumbs = Array.isArray(product?.thumbnails) ? product.thumbnails : [];
        const thumb = thumbs[0] || seed?.thumbnail || '';
        const pid = String(seed?.product_id || '').trim();
        return (stores || []).map((s, i) => {
            const extracted = Number(s.extracted_price) > 0 ? Number(s.extracted_price) : null;
            const total = Number(s.extracted_total) > 0 ? Number(s.extracted_total) : null;
            // NUNCA copiar total → extracted_price (rompe el strip de +$99)
            return {
                title: String(s.title || title).trim(),
                source: String(s.name || '').trim(),
                price: String(s.price || '').trim(),
                extracted_price: extracted,
                old_price: String(s.original_price || '').trim(),
                extracted_old_price: Number(s.extracted_original_price) > 0
                    ? Number(s.extracted_original_price)
                    : null,
                link: String(s.link || '').trim(),
                product_id: pid,
                thumbnail: thumb,
                position: i + 1,
                rating: Number(s.rating) > 0
                    ? Number(s.rating)
                    : (Number(product?.rating) > 0 ? Number(product.rating) : null),
                reviews: Number(s.reviews) > 0
                    ? Number(s.reviews)
                    : (Number(product?.reviews) > 0 ? Number(product.reviews) : null),
                delivery: String(s.shipping || '').trim(),
                shipping_extracted: Number(s.shipping_extracted) >= 0
                    ? Number(s.shipping_extracted)
                    : null,
                extracted_total: total,
                total: String(s.total || '').trim(),
                tag: String(s.tag || '').trim(),
                discount_label: String(s.discount || '').trim(),
                immersive: true,
            };
        }).filter(h => {
            if (!(h.source || h.link || h.extracted_price || h.extracted_total)) return false;
            if (isJunkOfferTitle(h.title) || isJunkOfferTitle(h.source)) return false;
            return true;
        });
    }

    /**
     * Flujo ASIN-first + Immersive:
     * 1) Keepa → título + Buy Box
     * 2) Shopping MX (token immersive)
     * 3) Immersive → todas las tiendas del mismo producto
     * 4) Fallback: hits filtrados por título si no hay token
     */
    async function runWatchSearch(watchId, { save = true } = {}) {
        const watches = loadWatches();
        const idx = watches.findIndex(w => w.id === watchId);
        if (idx < 0) return;
        const watch = watches[idx];
        if (!String(watch.asin || '').trim()) {
            UI.toast('Esta vigilancia necesita un ASIN de Amazon', 'error');
            return;
        }
        if (!window.SerpApi?.hasKey?.()) {
            UI.toast('Pega tu SerpAPI key en Ajustes', 'error');
            return;
        }
        if (!window.Keepa?.hasKey?.()) {
            UI.toast('Pega tu Keepa key en Ajustes (hace falta el título del ASIN)', 'error');
            return;
        }

        local.serpBusyId = watchId;
        render();
        try {
            const amz = await refreshWatchAmazonPrice(watch, { force: true });
            const productTitle = amz.keepaTitle || watch.keepaTitle || '';
            if (!productTitle) {
                throw new Error(amz.keepaError || 'Keepa no trajo el título del ASIN');
            }

            const override = String(watch.query || '').trim();
            const asin = String(watch.asin || '').trim().toUpperCase();
            const baseQ = override || shoppingQueryFromTitle(productTitle);
            if (!baseQ) throw new Error('No hay texto para buscar en Shopping');

            // Preferí ASIN + tokens: Google Shopping MX a menudo indexa el código
            const queryAttempts = [];
            if (override) {
                queryAttempts.push(override);
            } else {
                queryAttempts.push(`${asin} ${distinctiveTokens(productTitle).slice(0, 5).join(' ')}`.trim());
                queryAttempts.push(baseQ);
                const shortQ = distinctiveTokens(productTitle).slice(0, 5).join(' ');
                if (shortQ && shortQ !== baseQ) queryAttempts.push(shortQ);
            }

            let rawHits = [];
            let usedQuery = queryAttempts[0];
            let seedList = [];

            for (const q of queryAttempts) {
                const data = await SerpApi.shopping(q, { location: 'Mexico City, Mexico' });
                rawHits = Array.isArray(data.results) ? data.results : [];
                usedQuery = q;
                seedList = rankImmersiveSeeds(rawHits, productTitle);
                if (seedList.some(s => s.ok) || seedList.some(s => s.jaccard >= 0.35)) break;
                if (rawHits.length >= 5 && seedList.length) break;
            }

            let hits = [];
            let matchMode = 'shopping';
            let immersiveMeta = {
                immersiveTitle: '',
                immersiveRating: null,
                immersiveReviews: null,
                immersiveBrand: '',
                titleMatchScore: null,
            };

            const trySeeds = seedList.slice(0, 3);
            for (const seed of trySeeds) {
                if (!seed?.token || !SerpApi.immersiveProduct) continue;
                try {
                    const imm = await SerpApi.immersiveProduct(seed.token, { moreStores: true });
                    const stores = Array.isArray(imm.stores) ? imm.stores : [];
                    const product = imm.product || {};
                    const immTitle = String(product.title || seed.hit.title || '').trim();
                    const match = immersiveTitleMatchesKeepa(immTitle, productTitle);
                    // Match fuerte, o soft con overlap real (antes el soft <0.45 traía basura US)
                    if (!match.ok && match.score < 0.45) continue;

                    const built = hitsFromImmersive(product, stores, seed.hit);
                    if (!built.length) continue;

                    hits = built;
                    matchMode = match.ok ? 'immersive' : 'immersive_soft';
                    immersiveMeta = {
                        immersiveTitle: immTitle,
                        immersiveRating: Number(product.rating) > 0 ? Number(product.rating) : null,
                        immersiveReviews: Number(product.reviews) > 0 ? Number(product.reviews) : null,
                        immersiveBrand: String(product.brand || '').trim(),
                        titleMatchScore: Math.round(match.score * 100) / 100,
                    };
                    break;
                } catch (immErr) {
                    console.warn('[ofertas] Immersive', immErr);
                }
            }

            if (!hits.length) {
                hits = filterHitsToProduct(rawHits, productTitle);
                matchMode = hits.length ? 'shopping_filter' : 'none';
            }

            watches[idx] = {
                ...watch,
                keepaTitle: productTitle,
                keepaBsr: amz.keepaBsr,
                keepaMonthlySold: amz.keepaMonthlySold,
                shopQueryUsed: usedQuery,
                matchMode,
                ...immersiveMeta,
                hits,
                amazonPrice: amz.amazonPrice,
                amazonPriceSource: amz.amazonPriceSource,
                lastRunAt: new Date().toISOString(),
                lastError: '',
                lastKeepaError: amz.keepaError || '',
                updatedAt: new Date().toISOString(),
            };
            if (save) saveWatches(watches);

            local.serpDraft = { asin: '', query: '' };
            const modeLabel = matchMode === 'immersive' || matchMode === 'immersive_soft'
                ? 'Immersive'
                : (matchMode === 'shopping_filter' ? 'Shopping filtrado' : 'sin match');
            UI.toast(
                hits.length
                    ? `${hits.length} tiendas · ${modeLabel} · Keepa ${amz.amazonPrice > 0 ? Calc.fmtMXN(amz.amazonPrice) : 'OK'}`
                    : `Keepa OK, pero no halló el producto en Shopping (buscó: ${usedQuery})`
            );
        } catch (err) {
            watches[idx] = {
                ...watch,
                lastError: err.message || String(err),
                updatedAt: new Date().toISOString(),
            };
            if (save) saveWatches(watches);
            UI.toast(err.message || 'Error al actualizar', 'error');
        } finally {
            local.serpBusyId = null;
            render();
        }
    }

    function updateSerpAsinDetect(root) {
        const input = root?.querySelector('#of-serp-asin');
        const el = root?.querySelector('#of-serp-asin-detect');
        if (!el || !input) return;
        const raw = String(input.value || '');
        local.serpDraft.asin = raw;
        const asin = extractAsin(raw);
        if (asin) {
            el.className = 'of-detect is-ok';
            el.innerHTML = `<span class="of-chip of-chip-ok">ASIN <code>${esc(asin)}</code></span>`;
        } else if (raw.trim()) {
            el.className = 'of-detect is-warn';
            el.innerHTML = `<span class="of-chip of-chip-warn">No encontré ASIN — usá el link completo /dp/…</span>`;
        } else {
            el.className = 'of-detect';
            el.innerHTML = `<span class="muted small">El ASIN se detecta al pegar el link de Amazon MX</span>`;
        }
    }

    function captureSerpDraft(root) {
        local.serpDraft = {
            asin: String(root?.querySelector('#of-serp-asin')?.value || local.serpDraft.asin || ''),
            query: String(root?.querySelector('#of-serp-q')?.value || local.serpDraft.query || ''),
        };
    }

    function addWatchFromForm(root) {
        captureSerpDraft(root);
        const asinRaw = String(local.serpDraft.asin || '').trim();
        const query = String(local.serpDraft.query || '').trim();
        const asin = extractAsin(asinRaw);
        if (!asin || asin.length !== 10) {
            UI.toast('Pegá el link de Amazon MX (o el ASIN de 10 caracteres)', 'error');
            return null;
        }
        const linkAmazon = /^https?:\/\//i.test(asinRaw)
            ? asinRaw
            : `https://www.amazon.com.mx/dp/${asin}`;
        const watch = normalizeWatch({
            query,
            asin,
            linkAmazon,
            hits: [],
        });
        if (!watch) {
            UI.toast('No se pudo crear la vigilancia', 'error');
            return null;
        }
        const watches = loadWatches();
        const existing = watches.findIndex(w => w.asin === asin);
        if (existing >= 0) {
            watches[existing] = {
                ...watches[existing],
                query,
                linkAmazon,
                updatedAt: new Date().toISOString(),
            };
            saveWatches(watches);
            UI.toast('Ya existía esa vigilancia — se actualiza');
            return watches[existing];
        }
        watches.unshift(watch);
        saveWatches(watches);
        return watch;
    }

    function applyHitToDraft(watch, hit) {
        const store = storeFromHit(hit);
        const link = safeUrl(hit.link) || String(hit.link || '').trim();
        const amzWatch = watchAmazonPrice(watch);
        const amz = amzWatch.price > 0 ? amzWatch : amazonPriceForHit(hit, watch);
        const cost = landedCost(
            hit,
            Number(hit.extracted_price) || Number(hit.extracted_total) || 0,
            amz.price || 0,
            store
        );
        local.editingId = null;
        local.draft = {
            linkTienda: store.id === 'amazon' ? '' : link,
            linkAmazon: watch?.asin && (amz.source === 'keepa' || amzWatch.price > 0)
                ? `https://www.amazon.com.mx/dp/${watch.asin}`
                : (store.id === 'amazon' ? link : ''),
            asin: (watch?.asin && (amz.source === 'keepa' || amzWatch.price > 0))
                ? watch.asin
                : (extractAsin(link) || ''),
            titulo: String(hit.title || watch?.keepaTitle || '').trim(),
            costo: cost.landed > 0 ? Math.round(cost.landed * 100) / 100 : 0,
            precioAmazon: amz.matched !== false && amz.price > 0 ? amz.price : (amzWatch.price || 0),
            nota: `Google Shopping · ${store.label || hit.source || 'tienda'}`,
            tienda: store.id === 'amazon' ? '' : (store.label || hit.source || ''),
        };
        render();
        document.getElementById('of-link-tienda')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        UI.toast('Listo en el formulario — revisá y guardá');
    }

    function serpSectionHtml() {
        const watches = loadWatches();
        const hasKey = window.SerpApi?.hasKey?.();
        const hasKeepa = window.Keepa?.hasKey?.();
        const draftAsin = esc(local.serpDraft.asin || '');
        const draftQ = esc(local.serpDraft.query || '');
        const canRun = hasKey && hasKeepa;
        const steps = [
            ['Link', 'Pegás Amazon'],
            ['Keepa', 'Título + BB'],
            ['Shopping', 'Encuentra ítem'],
            ['Immersive', 'Todas las tiendas'],
            ['ROI', '¿Conviene?'],
        ];

        return `
            <section class="of-shopping card">
                <div class="of-shopping-head">
                    <div>
                        <p class="of-eyebrow">Radar Shopping MX</p>
                        <h3>Investigar producto Amazon</h3>
                        <p class="muted small of-lede">
                            Pegá el link → ASIN → Keepa → Shopping → <strong>Immersive</strong>
                            (todas las tiendas del mismo producto) → ROI.
                        </p>
                    </div>
                    <div class="of-shopping-keys">
                        ${hasKeepa
                            ? '<span class="of-key-pill is-ok">Keepa</span>'
                            : '<a class="of-key-pill is-miss" href="#" data-goto-settings-serp data-goto-keepa>Keepa</a>'}
                        ${hasKey
                            ? '<span class="of-key-pill is-ok">SerpAPI</span>'
                            : '<a class="of-key-pill is-miss" href="#" data-goto-settings-serp>SerpAPI</a>'}
                    </div>
                </div>

                <ol class="of-flow-steps" aria-label="Flujo">
                    ${steps.map(([label, hint], i) => `
                        <li class="of-flow-step">
                            <span class="of-flow-num">${i + 1}</span>
                            <span class="of-flow-copy">
                                <strong>${esc(label)}</strong>
                                <span>${esc(hint)}</span>
                            </span>
                        </li>
                    `).join('')}
                </ol>

                ${!canRun ? `
                    <div class="of-alert">
                        Falta configurar
                        ${!hasKeepa ? '<strong>Keepa</strong>' : ''}
                        ${!hasKeepa && !hasKey ? ' y ' : ''}
                        ${!hasKey ? '<strong>SerpAPI</strong>' : ''}
                        en Ajustes para investigar.
                    </div>
                ` : ''}

                <form class="of-serp-form" id="of-serp-form" onsubmit="return false">
                    <label class="of-serp-link-label">
                        <span>Link Amazon MX</span>
                        <input type="text" id="of-serp-asin"
                            placeholder="https://www.amazon.com.mx/dp/B0…  o  B0XXXXXXXXX"
                            value="${draftAsin}"
                            autocomplete="off" inputmode="url" spellcheck="false">
                        <span id="of-serp-asin-detect" class="of-detect"></span>
                    </label>

                    <div class="of-serp-toolbar">
                        <label class="check-row of-serp-filter">
                            <input type="checkbox" id="of-serp-retail" ${local.serpRetailOnly ? 'checked' : ''}>
                            <span>Solo retail</span>
                        </label>
                        <div class="of-serp-actions">
                            <button type="button" class="btn ghost" id="of-serp-add"
                                ${hasKey || hasKeepa ? '' : 'disabled'}>Solo guardar</button>
                            <button type="submit" class="btn primary" id="of-serp-add-run"
                                ${canRun ? '' : 'disabled'}>Investigar</button>
                        </div>
                    </div>

                    <details class="of-serp-advanced"${local.serpDraft.query ? ' open' : ''}>
                        <summary>Búsqueda avanzada (opcional)</summary>
                        <label>
                            <span>Override Shopping</span>
                            <input type="text" id="of-serp-q"
                                placeholder="Vacío = usa el título que trae Keepa"
                                value="${draftQ}"
                                autocomplete="off">
                        </label>
                        <p class="muted small">Solo si Shopping no encuentra el producto con el título de Keepa.</p>
                    </details>
                </form>

                ${watches.length
                    ? `<div class="of-serp-watches">
                            <div class="of-serp-watches-head">
                                <h4>Vigilancias</h4>
                                <span class="muted small">${watches.length}</span>
                            </div>
                            ${watches.map(serpWatchHtml).join('')}
                       </div>`
                    : `<div class="of-empty-panel">
                            <strong>Sin vigilancias todavía</strong>
                            <span class="muted small">Pegá un link de Amazon y tocá Investigar.</span>
                       </div>`}
            </section>
        `;
    }

    function serpWatchHtml(w) {
        const busy = local.serpBusyId === w.id;
        const clusters = visibleClusters(w);
        const summary = storePriceSummary(w);
        const amz = watchAmazonPrice(w);
        const when = w.lastRunAt
            ? new Date(w.lastRunAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
            : 'nunca';
        const canRun = window.SerpApi?.hasKey?.() && window.Keepa?.hasKey?.() && w.asin;
        const title = w.keepaTitle || w.immersiveTitle || w.query || w.asin || 'Producto';
        const amzHref = safeUrl(w.linkAmazon)
            || (w.asin ? `https://www.amazon.com.mx/dp/${encodeURIComponent(w.asin)}` : '');
        const ratingTxt = w.immersiveRating
            ? `★ ${w.immersiveRating}${w.immersiveReviews ? ` (${Number(w.immersiveReviews).toLocaleString('es-MX')})` : ''}`
            : '';
        const bsrTxt = w.keepaBsr ? `BSR ${Math.round(w.keepaBsr).toLocaleString('es-MX')}` : '';
        const soldTxt = w.keepaMonthlySold ? `~${Math.round(w.keepaMonthlySold)}/mes` : '';
        const modeChip = (w.matchMode === 'immersive' || w.matchMode === 'immersive_soft')
            ? `<span class="of-chip of-chip-ok">Immersive${w.matchMode === 'immersive_soft' ? ' ~' : ''}</span>`
            : (w.matchMode === 'shopping_filter'
                ? '<span class="of-chip of-chip-warn">Shopping filtrado</span>'
                : '');
        const rec = buildRecommendations(w, clusters);
        const bestRoi = rec.top?.margin?.ok && rec.top.margin.roi <= 2.5
            ? rec.top.margin.roi
            : clusters.reduce((best, c) => {
                const r = c.margin?.ok && c.margin.roi <= 2.5 ? c.margin.roi : null;
                if (r == null) return best;
                return best == null || r > best ? r : best;
            }, null);

        return `
            <article class="of-watch${busy ? ' is-busy' : ''}" data-serp-id="${esc(w.id)}">
                <div class="of-watch-head">
                    <div class="of-watch-title">
                        <div class="of-watch-badges">
                            <code class="of-asin">${esc(w.asin || '—')}</code>
                            ${modeChip}
                            ${busy ? '<span class="of-chip of-chip-busy">Actualizando…</span>' : ''}
                            ${w.lastError ? '<span class="of-chip of-chip-warn">Error</span>' : ''}
                        </div>
                        <h3>${esc(title)}</h3>
                        <div class="of-watch-meta">
                            ${w.keepaTitle && w.immersiveTitle && w.keepaTitle !== w.immersiveTitle
                                ? `<span class="muted small">Keepa: ${esc(w.keepaTitle.slice(0, 72))}${w.keepaTitle.length > 72 ? '…' : ''}</span>`
                                : ''}
                            ${w.immersiveBrand ? `<span class="of-store">${esc(w.immersiveBrand)}</span>` : ''}
                            ${ratingTxt ? `<span class="muted small">${esc(ratingTxt)}</span>` : ''}
                            ${bsrTxt ? `<span class="muted small">· ${esc(bsrTxt)}</span>` : ''}
                            ${soldTxt ? `<span class="muted small">· ${esc(soldTxt)}</span>` : ''}
                            <span class="muted small">· Última: ${esc(when)}</span>
                        </div>
                    </div>
                    <div class="of-watch-actions">
                        ${amzHref ? `<a class="btn ghost btn-sm" href="${esc(amzHref)}" target="_blank" rel="noopener">Amazon</a>` : ''}
                        <button type="button" class="btn primary btn-sm" data-serp-run="${esc(w.id)}"
                            ${busy || !canRun ? 'disabled' : ''}>
                            ${busy ? '…' : 'Actualizar'}
                        </button>
                        <button type="button" class="btn ghost btn-sm" data-serp-del="${esc(w.id)}">Quitar</button>
                    </div>
                </div>

                ${w.lastRunAt ? recommendationsHtml(w, rec) : ''}

                <div class="of-watch-kpis">
                    <div class="kpi-mini">
                        <div class="kpi-mini-label">Amazon</div>
                        <div class="kpi-mini-value">${amz.price > 0 ? Calc.fmtMXN(amz.price) : '—'}</div>
                    </div>
                    <div class="kpi-mini">
                        <div class="kpi-mini-label">Tiendas</div>
                        <div class="kpi-mini-value">${summary.length || (w.hits || []).length || 0}</div>
                    </div>
                    <div class="kpi-mini">
                        <div class="kpi-mini-label">Mejor retail</div>
                        <div class="kpi-mini-value">${rec.top ? Calc.fmtMXN(rec.top.cost.landed) : (summary[0] ? Calc.fmtMXN(summary[0].price) : '—')}</div>
                        <div class="muted small">${rec.top ? esc(rec.top.store.label) : (summary[0] ? esc(summary[0].label) : '')}</div>
                    </div>
                    <div class="kpi-mini">
                        <div class="kpi-mini-label">Mejor ROI</div>
                        <div class="kpi-mini-value ${bestRoi != null && bestRoi >= 0.2 ? 'pos' : bestRoi != null && bestRoi < 0 ? 'neg' : ''}">${bestRoi != null ? Calc.fmtPct(bestRoi) : '—'}</div>
                    </div>
                    <div class="kpi-mini">
                        <div class="kpi-mini-label">Demanda</div>
                        <div class="kpi-mini-value" style="font-size:14px">${soldTxt ? esc(soldTxt) : (bsrTxt ? esc(bsrTxt) : '—')}</div>
                    </div>
                </div>

                ${w.lastError ? `<p class="of-serp-err">${esc(w.lastError)}</p>` : ''}
                ${w.lastKeepaError && !(amz.price > 0) ? `<p class="of-serp-err">Keepa: ${esc(w.lastKeepaError)}</p>` : ''}

                ${clusters.length ? `
                    <div class="of-product-list">
                        ${clusters.map((c, i) => serpClusterHtml(w, c, i)).join('')}
                    </div>
                ` : `<div class="of-empty-panel of-empty-panel-sm">
                        <strong>${w.lastRunAt ? 'Sin tiendas del mismo producto' : 'Sin datos aún'}</strong>
                        <span class="muted small">${w.lastRunAt
                            ? 'Shopping no indexó este ítem, o Immersive no trajo sellers.'
                            : 'Tocá Actualizar.'}</span>
                     </div>`}
            </article>
        `;
    }

    function recommendationsHtml(watch, rec) {
        if (!rec) return '';
        const topRows = (rec.buy.length ? rec.buy : rec.maybe).slice(0, 3);
        return `
            <div class="of-rec of-rec-${esc(rec.tone)}">
                <div class="of-rec-main">
                    <span class="of-rec-kicker">Recomendación</span>
                    <strong class="of-rec-headline">${esc(rec.headline)}</strong>
                    <p class="of-rec-detail">${esc(rec.detail)}</p>
                    ${rec.demand.length
                        ? `<p class="of-rec-demand muted small">${rec.demand.map(esc).join(' · ')}</p>`
                        : ''}
                </div>
                ${topRows.length ? `
                    <ol class="of-rec-list">
                        ${topRows.map((r, i) => {
                            const href = safeUrl(r.hit?.link) || '';
                            const vCls = r.verdict?.key === 'buy' ? 'buy' : (r.verdict?.key === 'maybe' ? 'maybe' : 'skip');
                            return `
                                <li class="of-rec-item is-${vCls}">
                                    <span class="of-rec-rank">${i + 1}</span>
                                    <div class="of-rec-item-body">
                                        <strong>${esc(r.store.label)}</strong>
                                        <span class="muted small">${esc(r.verdict?.label || '')} · ROI ${r.margin?.ok ? Calc.fmtPct(r.margin.roi) : '—'} · ${Calc.fmtMXN(r.cost.landed)}</span>
                                    </div>
                                    <div class="of-rec-item-actions">
                                        ${href ? `<a class="btn ghost btn-sm" href="${esc(href)}" target="_blank" rel="noopener">Ver</a>` : ''}
                                        ${r.origIdx >= 0 ? `<button type="button" class="btn primary btn-sm" data-serp-to-radar="${esc(watch.id)}" data-hit-orig="${r.origIdx}">Al radar</button>` : ''}
                                    </div>
                                </li>
                            `;
                        }).join('')}
                    </ol>
                ` : ''}
            </div>
        `;
    }

    function serpClusterHtml(watch, cluster, clusterIdx) {
        const m = cluster.margin;
        const amz = cluster.amazon || {};
        const tone = m?.ok
            ? (m.margen >= 0.2 ? 'pos' : m.margen >= 0.1 ? 'warn' : 'neg')
            : '';
        const best = cluster.bestOffer || cluster.storeOffers.find(o => o.store.id !== 'amazon') || null;
        const bestPrice = best?.cost?.landed || best?.price || 0;
        const amzPrice = amz.matched && amz.price > 0 ? amz.price : (m?.ok ? m.precio : 0);

        return `
            <article class="of-product-card${tone ? ` wl-tone-${tone}` : ''}" data-serp-cluster="${esc(watch.id)}" data-cluster-idx="${clusterIdx}">
                <div class="of-product-top">
                    ${cluster.thumbnail
                        ? `<img class="of-product-thumb" src="${esc(cluster.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
                        : '<div class="of-product-thumb is-empty" aria-hidden="true"></div>'}
                    <div class="of-product-main">
                        <h4 class="of-product-title">${esc(cluster.title || 'Sin título')}</h4>
                        <div class="wl-card-line">
                            <span class="mono">${bestPrice > 0 ? Calc.fmtMXN(bestPrice) : '—'}</span>
                            <span class="muted">landed → Amazon</span>
                            <span class="mono">${amzPrice > 0 ? Calc.fmtMXN(amzPrice) : '—'}</span>
                            ${m?.ok
                                ? `<span class="muted">·</span><span class="mono">${Calc.fmtPct(m.margen)} margen</span><span class="muted">·</span><span class="mono">${Calc.fmtMXN(m.utilidad)}/ud</span>`
                                : (amz.matched
                                    ? '<span class="muted">· sin oferta retail viable</span>'
                                    : '<span class="muted">· sin match Amazon</span>')}
                        </div>
                    </div>
                    <div class="wl-card-roi mono">
                        <strong>${m?.ok ? Calc.fmtPct(m.roi) : '—'}</strong>
                        <span class="muted">ROI</span>
                    </div>
                </div>

                <div class="of-stores">
                    <div class="of-store-list">
                        <div class="of-store-row of-store-head of-store-row-rec">
                            <span>#</span>
                            <span>Tienda</span>
                            <span>Landed</span>
                            <span>ROI</span>
                            <span>Señal</span>
                            <span></span>
                        </div>
                        ${cluster.storeOffers.map((o, i) => {
                            const href = o.synthetic ? '' : (safeUrl(o.hit.link) || '');
                            const isAmz = o.store.id === 'amazon';
                            const cost = o.cost || landedCost(o.hit, o.price, 0, o.store);
                            const priceTxt = cost.landed > 0 ? Calc.fmtMXN(cost.landed) : (o.hit.price || '—');
                            const ship = deliveryNote(o.hit, o.store, cost);
                            const priceTitle = cost.converted && cost.rawUnit && !cost.invalid
                                ? `US$${Number(cost.rawUnit).toFixed(2)} → MXN`
                                : (cost.needsVerify
                                    ? 'Confirmá precio en el link'
                                    : (o.verdict?.reason || ''));
                            const verdict = o.verdict || null;
                            const roiOk = o.margin?.ok && o.margin.roi <= 2.5;
                            const roiTxt = roiOk ? Calc.fmtPct(o.margin.roi) : '—';
                            const vKey = verdict?.key || '';
                            const vLabel = verdict?.label || (isAmz ? 'Ref.' : '—');
                            const isBest = !isAmz && best && o.store?.id === best.store?.id
                                && o.store?.label === best.store?.label
                                && best.verdict?.key === 'buy';
                            return `
                                <div class="of-store-row of-store-row-rec${isAmz ? ' is-amazon' : ''}${isBest ? ' is-best' : ''}${vKey ? ` is-v-${vKey}` : ''}">
                                    <span class="mono muted">${i + 1}</span>
                                    <span class="of-store-cell">
                                        <span class="wl-store">${esc(o.store.label || 'Tienda')}</span>
                                        ${isBest ? '<span class="of-chip of-chip-ok of-chip-best">Mejor</span>' : ''}
                                        ${ship ? `<span class="muted small of-store-ship">${esc(ship)}</span>` : ''}
                                    </span>
                                    <strong class="mono" title="${esc(priceTitle)}">${esc(priceTxt)}</strong>
                                    <span class="mono ${roiOk && o.margin.roi >= 0.2 ? 'pos' : roiOk && o.margin.roi < 0 ? 'neg' : ''}">${esc(roiTxt)}</span>
                                    <span>${vKey
                                        ? `<span class="of-verdict of-verdict-${esc(vKey)}" title="${esc(verdict?.reason || '')}">${esc(vLabel)}</span>`
                                        : `<span class="muted">${esc(vLabel)}</span>`}</span>
                                    <span class="of-store-row-actions">
                                        ${href ? `<a class="btn ghost btn-sm" href="${esc(href)}" target="_blank" rel="noopener">Ver</a>` : ''}
                                        ${!o.synthetic && o.origIdx >= 0 ? `
                                            <button type="button" class="btn primary btn-sm"
                                                data-serp-to-radar="${esc(watch.id)}"
                                                data-hit-orig="${o.origIdx}">Al radar</button>
                                        ` : ''}
                                    </span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </article>
        `;
    }

    function normalizeItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const status = STATUSES[raw.status] ? raw.status : 'vigilando';
        const tipo = String(raw.tipo || 'FBA').toUpperCase() === 'FBM' ? 'FBM' : 'FBA';

        let linkTienda = String(raw.linkTienda || raw.linkCompra || '').trim();
        let linkAmazon = String(raw.linkAmazon || '').trim();
        const legacy = String(raw.link || '').trim();
        if (legacy && !linkTienda && !linkAmazon) {
            const det = detectStore(legacy);
            if (det.id === 'amazon' || extractAsin(legacy)) linkAmazon = legacy;
            else linkTienda = legacy;
        }

        let asin = String(raw.asin || '').trim().toUpperCase();
        if (!asin) asin = extractAsin(linkAmazon) || extractAsin(linkTienda);

        let tienda = String(raw.tienda || '').trim();
        if (!tienda) tienda = detectStore(linkTienda).label || detectStore(linkAmazon).label;

        return {
            id: raw.id || Data.newId(),
            linkTienda,
            linkAmazon,
            asin,
            tienda,
            titulo: String(raw.titulo || '').trim(),
            costo: Math.max(0, Number(raw.costo) || 0),
            precioAmazon: Math.max(0, Number(raw.precioAmazon ?? raw.precioMercado) || 0),
            tipo,
            categoriaAmazon: String(raw.categoriaAmazon || '').trim(),
            nota: String(raw.nota || '').trim(),
            status,
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
        };
    }

    function keepaSnap(asin) {
        const code = String(asin || '').trim().toUpperCase();
        if (!code) return null;
        const cached = window.Keepa?.readCache?.(code);
        if (cached) return cached;
        const lib = window.Keepa?.readLibrary?.(code);
        if (!lib) return null;
        return {
            ...lib,
            buyBox: lib.buyBox ?? null,
            currentPrice: lib.buyBox ?? null,
            amazon: lib.buyBox ?? lib.amazonRetail ?? null,
            bsr: lib.bsr ?? null,
            bsrAvg90: lib.bsrAvg90 ?? null,
            avg90: lib.avg90 ?? null,
            monthlySold: lib.monthlySold ?? null,
            signalLabel: lib.signalLabel || '',
        };
    }

    /** Precio Amazon efectivo: manual, o Buy Box / precio de caché Keepa. */
    function effectiveAmazonPrice(item) {
        const manual = Number(item.precioAmazon) || 0;
        if (manual > 0) return { price: manual, source: 'manual' };
        const k = keepaSnap(item.asin);
        const bb = Number(k?.buyBox ?? k?.marketPrice ?? k?.currentPrice ?? k?.amazon);
        if (Number.isFinite(bb) && bb > 0) return { price: bb, source: 'keepa' };
        return { price: 0, source: 'none' };
    }

    function metricsFor(item) {
        const { price: precio, source } = effectiveAmazonPrice(item);
        try {
            const base = Calc.defaultsFor('amazon');
            const settings = {
                ...base,
                ...(window.State.settings || {}),
                marketplace: 'amazon',
            };
            const lote = {
                costo: Number(item.costo) || 0,
                tipo: item.tipo || 'FBA',
                categoriaAmazon: item.categoriaAmazon || settings.categoriaDefault || 'otros',
                pesoKg: Number(settings.pesoKgDefault) || 0.3,
                tamanoFba: settings.tamanoFbaDefault || 'estandar',
                envio: 0,
            };
            if (!(precio > 0) || !(lote.costo > 0)) {
                return { utilidad: 0, margen: 0, roi: 0, fees: 0, precio, source, ok: false };
            }
            const u = Calc.utilidadAtPrice(lote, precio, settings);
            const costo = lote.costo;
            const roi = costo > 0 ? u.utilidad / costo : 0;
            return {
                utilidad: u.utilidad,
                margen: u.margen,
                roi,
                fees: (u.comisionVariable || 0) + (u.cargoFijo || 0)
                    + (u.envio || 0) + (u.almacenamiento || 0) + (u.varios || 0)
                    + (u.retIVA || 0) + (u.retISR || 0),
                precio,
                source,
                ok: true,
            };
        } catch (err) {
            console.warn('[ofertas] metrics', err);
            return { utilidad: 0, margen: 0, roi: 0, fees: 0, precio, source, ok: false };
        }
    }

    /** Señal de demanda Keepa (sin gastar tokens: solo caché). */
    function sellSignal(item) {
        const k = keepaSnap(item.asin);
        if (!k) {
            return {
                key: 'sin_datos',
                label: item.asin ? 'Sin Keepa en caché' : 'Falta ASIN',
                hint: item.asin
                    ? 'Abre Keepa Lab y consulta el ASIN (~1 token)'
                    : 'Pega el link o ASIN de Amazon MX',
            };
        }
        const bsr = Number(k.bsr ?? k.salesRank ?? k.currentSalesRank);
        const bsr90 = Number(k.bsrAvg90 ?? k.salesRankAvg90);
        const avg90 = Number(k.avg90);
        const price = Number(k.buyBox ?? k.marketPrice ?? k.currentPrice ?? k.amazon);
        const monthly = Number(k.monthlySold);
        const drops = Number.isFinite(bsr) && Number.isFinite(bsr90) && bsr90 > 0 && bsr < bsr90 * 0.85;
        const hot = (Number.isFinite(bsr) && bsr > 0 && bsr <= 80000)
            || (Number.isFinite(monthly) && monthly >= 50);
        const okPrice = Number.isFinite(price) && price > 0;

        if (hot || drops) {
            return {
                key: 'vende',
                label: 'Se mueve en Amazon',
                hint: [
                    Number.isFinite(monthly) && monthly > 0 ? `${Math.round(monthly)}+/mes` : null,
                    Number.isFinite(bsr) ? `BSR ${Math.round(bsr)}` : null,
                    Number.isFinite(bsr90) ? `avg90 ${Math.round(bsr90)}` : null,
                ].filter(Boolean).join(' · ') || (okPrice ? `BB ${Calc.fmtMXN(price)}` : 'Keepa en caché'),
            };
        }
        if (Number.isFinite(bsr) && bsr > 250000) {
            return {
                key: 'flojo',
                label: 'Poca rotación',
                hint: `BSR ${Math.round(bsr)} — revisa si vale la pena`,
            };
        }
        return {
            key: 'neutro',
            label: k.signalLabel || 'Con datos Keepa',
            hint: [
                Number.isFinite(monthly) && monthly > 0 ? `${Math.round(monthly)}+/mes` : null,
                Number.isFinite(bsr) ? `BSR ${Math.round(bsr)}` : null,
                okPrice ? `BB ${Calc.fmtMXN(price)}` : null,
                Number.isFinite(avg90) && avg90 > 0 ? `avg90 ${Calc.fmtMXN(avg90)}` : null,
            ].filter(Boolean).join(' · ') || 'Consulta Keepa Lab para refrescar',
        };
    }

    function pendingCount() {
        if (!isAmazonView()) return 0;
        const radar = loadItems().filter(i => i.status === 'vigilando' || i.status === 'viable').length;
        const guardados = window.WishlistView?.pendingCount?.() || 0;
        return radar + guardados;
    }

    function b64urlDecode(s) {
        const pad = '='.repeat((4 - (s.length % 4)) % 4);
        const b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/') + pad;
        try {
            return decodeURIComponent(escape(atob(b64)));
        } catch {
            try { return atob(b64); } catch { return ''; }
        }
    }

    /** Normaliza payload del bookmarklet → campos del form. */
    function normalizeDraft(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const url = safeUrl(raw.u || raw.url || raw.link || '');
        const titulo = String(raw.t || raw.titulo || raw.title || '').trim().slice(0, 200);
        let costo = Number(raw.p ?? raw.costo ?? raw.price);
        if (!Number.isFinite(costo) || costo <= 0) costo = 0;
        if (!url && !titulo && !(costo > 0)) return null;

        const store = detectStore(url);
        const asin = extractAsin(url);
        const isAmz = store.id === 'amazon' || !!asin;
        return {
            linkTienda: isAmz ? '' : url,
            linkAmazon: isAmz ? url : '',
            asin: asin || '',
            titulo,
            costo,
            precioAmazon: 0,
            nota: '',
            tienda: isAmz ? '' : (store.label || ''),
        };
    }

    function acceptDraft(raw) {
        const d = normalizeDraft(raw);
        if (!d) return false;
        local.editingId = null;
        local.draft = d;
        local.filter = 'revisar';
        try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
        return true;
    }

    /** Lee #oferta=… o sessionStorage y deja el form listo. */
    function consumeIncomingDraft() {
        let payload = null;
        const hash = String(location.hash || '');
        const m = hash.match(/^#oferta=([A-Za-z0-9_-]+)/);
        if (m) {
            try {
                payload = JSON.parse(b64urlDecode(m[1]));
            } catch { payload = null; }
            history.replaceState({}, '', location.pathname + location.search);
        }
        if (!payload) {
            try {
                const raw = sessionStorage.getItem(DRAFT_KEY);
                if (raw) payload = JSON.parse(raw);
            } catch { payload = null; }
        }
        if (!payload) return false;
        return acceptDraft(payload);
    }

    /**
     * Bookmarklet: en la página de Costco/Walmart/… lee título + precio y abre
     * esta app con #oferta=… (mismo origen donde arrastraste el favorito).
     */
    function bookmarkletHref() {
        const origin = String(location.origin || '').replace(/\/$/, '');
        // Sin sessionStorage: el bookmarklet corre en el dominio de la tienda.
        const body = `(function(){var O=${JSON.stringify(origin)};function txt(el){return(el&&(el.content||el.getAttribute&&el.getAttribute('content')||el.textContent||'')||'').trim()}function num(s){s=String(s||'').replace(/[^0-9.,]/g,'');if(!s)return 0;if(s.indexOf(',')>s.indexOf('.'))s=s.replace(/\\./g,'').replace(',','.');else s=s.replace(/,/g,'');var n=parseFloat(s);return isFinite(n)&&n>0?n:0}function price(){var sels=['meta[property="product:price:amount"]','meta[property="og:price:amount"]','meta[itemprop="price"]','[itemprop="price"]','[data-price]','[data-product-price]','.price-current','.sales-price','.product-price','.price'];for(var i=0;i<sels.length;i++){var el=document.querySelector(sels[i]);if(!el)continue;var v=num(el.getAttribute('content')||el.getAttribute('data-price')||el.getAttribute('data-product-price')||txt(el));if(v)return v}var bodyTxt=document.body?document.body.innerText:'';var m=bodyTxt.match(/\\$\\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)/);return m?num(m[1]):0}function title(){return txt(document.querySelector('meta[property="og:title"]'))||txt(document.querySelector('h1'))||document.title||''}var data={u:location.href,t:title().slice(0,200),p:price(),ts:Date.now()};var enc=btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');var url=O+'/#oferta='+enc;var w=window.open(url,'_blank');if(!w)location.href=url})();`;
        return `javascript:${body}`;
    }

    function emptyForm() {
        return {
            linkTienda: '', linkAmazon: '', titulo: '', costo: '', precioAmazon: '', nota: '', asin: '',
        };
    }

    function upsert(partial, status = 'vigilando') {
        const items = loadItems();
        const now = new Date().toISOString();
        const base = normalizeItem({
            ...partial,
            status,
            updatedAt: now,
            createdAt: partial.createdAt || now,
        });
        if (!base) return;
        if (local.editingId) {
            const idx = items.findIndex(i => i.id === local.editingId);
            if (idx >= 0) {
                items[idx] = normalizeItem({
                    ...items[idx],
                    ...base,
                    id: items[idx].id,
                    createdAt: items[idx].createdAt,
                    status: status || items[idx].status,
                    updatedAt: now,
                });
            }
            local.editingId = null;
        } else {
            items.unshift(base);
        }
        saveItems(items);
        local.draft = null;
        render();
        window.App?.refreshNavCounts?.();
        UI.toast(status === 'viable' ? 'Marcada viable' : 'Oferta guardada');
    }

    function setStatus(id, status) {
        if (!STATUSES[status]) return;
        const items = loadItems().map(i => (
            i.id === id ? { ...i, status, updatedAt: new Date().toISOString() } : i
        ));
        saveItems(items);
        render();
        window.App?.refreshNavCounts?.();
    }

    function removeItem(id) {
        saveItems(loadItems().filter(i => i.id !== id));
        if (local.editingId === id) local.editingId = null;
        render();
        window.App?.refreshNavCounts?.();
    }

    function sendToWishlist(id) {
        const item = loadItems().find(i => i.id === id);
        if (!item) return;
        const asin = item.asin || extractAsin(item.linkAmazon);
        if (!asin && !item.linkAmazon) {
            UI.toast('Necesitas ASIN o link Amazon', 'error');
            return;
        }
        if (!(item.costo > 0)) {
            UI.toast('Completa el costo en tienda', 'error');
            return;
        }
        const m = metricsFor(item);
        if (window.WishlistView?.addFromKeepa && asin) {
            const created = WishlistView.addFromKeepa({
                asin,
                title: item.titulo || '',
                precio: m.precio || item.precioAmazon || 0,
                note: [
                    item.tienda ? `Retail: ${item.tienda}` : null,
                    item.linkTienda || null,
                    item.nota || null,
                    'Desde Ofertas',
                ].filter(Boolean).join(' · '),
                silent: true,
            });
            if (created) {
                const wl = Array.isArray(window.State.ui?.wishlistAmazon)
                    ? window.State.ui.wishlistAmazon.slice()
                    : [];
                const idx = wl.findIndex(w => w.id === created.id
                    || (asin && String(w.asin || '').toUpperCase() === asin));
                if (idx >= 0) {
                    wl[idx] = {
                        ...wl[idx],
                        linkCompra: item.linkTienda || wl[idx].linkCompra,
                        linkAmazon: item.linkAmazon || wl[idx].linkAmazon,
                        costo: item.costo || wl[idx].costo,
                        precioMercado: m.precio || item.precioAmazon || wl[idx].precioMercado,
                        tienda: item.tienda || wl[idx].tienda,
                        titulo: item.titulo || wl[idx].titulo,
                        tipo: item.tipo === 'FBM' ? 'FBM' : 'FBA',
                        updatedAt: new Date().toISOString(),
                    };
                    window.State.ui = { ...window.State.ui, wishlistAmazon: wl };
                    window.State.saveUI();
                }
                const offers = loadItems().map(o => (
                    o.id === id
                        ? { ...o, status: 'viable', updatedAt: new Date().toISOString() }
                        : o
                ));
                saveItems(offers);
                window.App?.refreshNavCounts?.();
                UI.toast('Guardado en Ofertas → Guardados');
                local.filter = 'guardados';
                render();
            }
            return;
        }
        UI.toast('Guardados no disponible', 'error');
    }

    function convertToProduct(id) {
        const item = loadItems().find(i => i.id === id);
        if (!item) return;
        const asin = item.asin || extractAsin(item.linkAmazon);
        if (!asin) {
            UI.toast('Necesitas ASIN Amazon', 'error');
            return;
        }
        if (!(item.costo > 0)) {
            UI.toast('Completa el costo en tienda', 'error');
            return;
        }
        const m = metricsFor(item);
        const prospect = {
            asin,
            titulo: item.titulo || '',
            costo: item.costo,
            precioMercado: m.precio || item.precioAmazon || 0,
            linkCompra: item.linkTienda || '',
            linkAmazon: item.linkAmazon || (asin ? `https://www.amazon.com.mx/dp/${asin}` : ''),
            tienda: item.tienda || '',
            tipo: item.tipo === 'FBM' ? 'FBM' : 'FBA',
            categoriaAmazon: item.categoriaAmazon || '',
            nota: item.nota || 'Desde Ofertas',
        };
        const lote = window.LotesView?.createFromWishlist?.(prospect);
        if (lote) {
            setStatus(id, 'viable');
            UI.toast('Producto creado — ajusta unidades si hace falta');
        }
    }

    function showGuardados() {
        local.filter = 'guardados';
        render();
    }

    function readForm(root) {
        const linkTienda = String(root.querySelector('#of-link-tienda')?.value || '').trim();
        const linkAmazon = String(root.querySelector('#of-link-amazon')?.value || '').trim();
        const titulo = String(root.querySelector('#of-titulo')?.value || '').trim();
        const costo = Number(root.querySelector('#of-costo')?.value) || 0;
        const precioAmazon = Number(root.querySelector('#of-precio')?.value) || 0;
        const nota = String(root.querySelector('#of-nota')?.value || '').trim();
        const store = detectStore(linkTienda);
        const asin = extractAsin(linkAmazon) || extractAsin(linkTienda);
        return {
            id: local.editingId || undefined,
            linkTienda,
            linkAmazon,
            titulo,
            costo,
            precioAmazon,
            nota,
            tienda: store.label,
            asin,
            tipo: 'FBA',
        };
    }

    function previewHtml(item) {
        const m = metricsFor(item);
        const sig = sellSignal(item);
        if (!(item.costo > 0) && !(m.precio > 0) && !item.asin) {
            return `<p class="muted small of-preview-empty">Pega el link de la tienda y el ASIN / link de Amazon para ver margen y señal de venta.</p>`;
        }
        const utilCls = m.ok && m.utilidad >= 0 ? 'pos' : (m.ok ? 'neg' : '');
        const priceNote = m.source === 'keepa'
            ? 'precio Keepa (caché)'
            : (m.source === 'manual' ? 'precio manual' : 'sin precio Amazon');
        return `
            <div class="of-preview" aria-live="polite">
                <div class="of-preview-metrics">
                    <div>
                        <span class="muted small">Amazon</span>
                        <strong>${m.precio > 0 ? Calc.fmtMXN(m.precio) : '—'}</strong>
                        <span class="muted small">${esc(priceNote)}</span>
                    </div>
                    <div>
                        <span class="muted small">Utilidad est.</span>
                        <strong class="${utilCls}">${m.ok ? Calc.fmtMXN(m.utilidad) : '—'}</strong>
                    </div>
                    <div>
                        <span class="muted small">Margen</span>
                        <strong class="${utilCls}">${m.ok ? Calc.fmtPct(m.margen) : '—'}</strong>
                    </div>
                    <div>
                        <span class="muted small">ROI</span>
                        <strong class="${utilCls}">${m.ok ? Calc.fmtPct(m.roi) : '—'}</strong>
                    </div>
                </div>
                <p class="of-signal is-${esc(sig.key)}">
                    <strong>${esc(sig.label)}</strong>
                    <span class="muted small">${esc(sig.hint)}</span>
                </p>
            </div>
        `;
    }

    function card(item) {
        const m = metricsFor(item);
        const sig = sellSignal(item);
        const hrefTienda = safeUrl(item.linkTienda);
        const hrefAmz = safeUrl(item.linkAmazon)
            || (item.asin ? `https://www.amazon.com.mx/dp/${encodeURIComponent(item.asin)}` : '');
        const title = item.titulo || item.tienda || item.asin || 'Sin título';
        const utilCls = m.ok && m.utilidad >= 0 ? 'pos' : (m.ok ? 'neg' : '');

        return `
            <article class="of-card" data-of-id="${esc(item.id)}">
                <div class="of-card-top">
                    <div class="of-card-title">
                        <strong>${esc(title)}</strong>
                        <div class="of-card-meta">
                            ${item.tienda ? `<span class="of-store">${esc(item.tienda)}</span>` : ''}
                            ${item.asin ? `<code>${esc(item.asin)}</code>` : ''}
                            <span class="of-status-pill of-status-${esc(item.status)}">${esc(STATUSES[item.status]?.label || item.status)}</span>
                            <span class="of-signal-pill is-${esc(sig.key)}">${esc(sig.label)}</span>
                        </div>
                    </div>
                    <div class="of-card-nums">
                        <div><span class="muted small">Costo</span><strong>${item.costo > 0 ? Calc.fmtMXN(item.costo) : '—'}</strong></div>
                        <div><span class="muted small">Amazon</span><strong>${m.precio > 0 ? Calc.fmtMXN(m.precio) : '—'}</strong></div>
                        <div><span class="muted small">Util.</span><strong class="${utilCls}">${m.ok ? Calc.fmtMXN(m.utilidad) : '—'}</strong></div>
                    </div>
                </div>
                <p class="muted small of-card-hint">${esc(sig.hint)}</p>
                ${item.nota ? `<p class="of-note">${esc(item.nota)}</p>` : ''}
                ${item.asin ? `<div class="of-keepa" data-keepa-asin="${esc(item.asin)}" data-keepa-compact="1"></div>` : ''}
                <div class="of-card-actions">
                    ${hrefTienda ? `<a class="btn ghost btn-sm" href="${esc(hrefTienda)}" target="_blank" rel="noopener">Tienda</a>` : ''}
                    ${hrefAmz ? `<a class="btn ghost btn-sm" href="${esc(hrefAmz)}" target="_blank" rel="noopener">Amazon</a>` : ''}
                    ${item.asin ? `<button type="button" class="btn ghost btn-sm" data-of-keepa="${esc(item.asin)}">Keepa</button>` : ''}
                    <button type="button" class="btn ghost btn-sm" data-of-wishlist="${esc(item.id)}">Guardar</button>
                    ${(item.asin || extractAsin(item.linkAmazon)) && item.costo > 0
                        ? `<button type="button" class="btn primary btn-sm" data-of-convert="${esc(item.id)}">→ Producto</button>`
                        : ''}
                    <button type="button" class="btn ghost btn-sm" data-of-edit="${esc(item.id)}">Editar</button>
                    ${item.status !== 'viable' ? `<button type="button" class="btn primary btn-sm" data-of-status="viable" data-id="${esc(item.id)}">Viable</button>` : ''}
                    ${item.status !== 'vigilando' ? `<button type="button" class="btn ghost btn-sm" data-of-status="vigilando" data-id="${esc(item.id)}">Vigilar</button>` : ''}
                    ${item.status !== 'descartada' ? `<button type="button" class="btn ghost btn-sm" data-of-status="descartada" data-id="${esc(item.id)}">Descartar</button>` : ''}
                    <button type="button" class="btn ghost btn-sm" data-of-del="${esc(item.id)}">Eliminar</button>
                </div>
            </article>
        `;
    }

    function render() {
        const root = document.getElementById('view-ofertas');
        if (!root) return;
        if (!isAmazonView()) {
            root.innerHTML = `
                <div class="view-head">
                    <div>
                        <h2>Ofertas</h2>
                        <p class="muted">Cambia a Amazon para comparar tiendas (Costco, Sam's, Walmart…) con Amazon MX.</p>
                    </div>
                </div>`;
            return;
        }

        const items = loadItems();
        const guardadosN = window.WishlistView?.pendingCount?.() || 0;
        // Legacy filters → Por revisar
        if (local.filter === 'vigilando' || local.filter === 'viable' || local.filter === 'descartada') {
            local.filter = 'revisar';
        }
        const counts = {
            revisar: items.filter(i => i.status === 'vigilando' || i.status === 'viable').length,
            guardados: guardadosN,
            descartada: items.filter(i => i.status === 'descartada').length,
        };
        const isGuardados = local.filter === 'guardados';
        const isRevisar = local.filter === 'revisar';
        const shown = isGuardados
            ? []
            : items
                .filter(i => i.status === 'vigilando' || i.status === 'viable')
                .sort((a, b) => {
                    const va = a.status === 'viable' ? 0 : 1;
                    const vb = b.status === 'viable' ? 0 : 1;
                    if (va !== vb) return va - vb;
                    return metricsFor(b).roi - metricsFor(a).roi;
                });
        const descartadas = items
            .filter(i => i.status === 'descartada')
            .sort((a, b) => metricsFor(b).roi - metricsFor(a).roi);

        const editing = local.editingId
            ? items.find(i => i.id === local.editingId)
            : null;
        const d = editing || local.draft || emptyForm();
        const previewItem = editing || local.draft || {
            linkTienda: '', linkAmazon: '', titulo: '', costo: 0, precioAmazon: 0, asin: '', tienda: '',
        };
        const draftHint = !editing && local.draft
            ? `<p class="of-draft-banner">Datos del bookmarklet listos — revisá el ASIN de Amazon y guardá.</p>`
            : '';

        root.innerHTML = `
            <div class="view-head of-head">
                <div>
                    <h2>Ofertas</h2>
                    <p class="muted">Link Amazon → ASIN → Keepa + Shopping · radar manual abajo.</p>
                </div>
            </div>

            ${serpSectionHtml()}

            <section class="of-radar-block">
                <div class="of-section-head">
                    <div>
                        <p class="of-eyebrow">Seguimiento</p>
                        <h3>Radar</h3>
                        <p class="muted small">Por revisar · Guardados. Descartadas quedan archivadas abajo.</p>
                    </div>
                </div>
                <div class="of-toolbar">
                    <div class="dash-seg" role="tablist" aria-label="Filtro">
                        ${[
                            ['revisar', 'Por revisar', counts.revisar],
                            ['guardados', 'Guardados', counts.guardados],
                        ].map(([k, label, n]) => `
                            <button type="button" class="dash-seg-btn${local.filter === k ? ' active' : ''}"
                                data-of-filter="${k}" role="tab">${label} ${n}</button>
                        `).join('')}
                    </div>
                </div>
                ${isGuardados
                    ? `<div id="of-guardados-host" class="of-guardados-host"></div>`
                    : (shown.length
                        ? `<div class="of-list">${shown.map(card).join('')}</div>`
                        : `<p class="muted small of-empty">Nada por revisar todavía.</p>`)
                }
                ${isRevisar && descartadas.length ? `
                    <details class="of-archived">
                        <summary class="muted small">Descartadas (${descartadas.length})</summary>
                        <div class="of-list of-archived-list">${descartadas.map(card).join('')}</div>
                    </details>` : ''}
            </section>

            ${draftHint}

            <section class="of-manual-block card">
                <div class="of-section-head">
                    <div>
                        <p class="of-eyebrow">Captura</p>
                        <h3>Manual / bookmarklet</h3>
                        <p class="muted small">Pegá link + costo, o usá el bookmarklet desde la página de la tienda.</p>
                    </div>
                    <a class="btn ghost btn-sm of-bookmark-link" href="#" title="Arrastrá a favoritos">Bookmarklet</a>
                </div>
                <div class="of-form-grid">
                    <label class="of-wide">
                        <span>Link tienda</span>
                        <input type="url" id="of-link-tienda" placeholder="https://…" value="${esc(d.linkTienda || '')}" autocomplete="off">
                        <span id="of-detect-tienda" class="of-detect"></span>
                    </label>
                    <label class="of-wide">
                        <span>Link / ASIN Amazon MX</span>
                        <input type="text" id="of-link-amazon" placeholder="ASIN o https://www.amazon.com.mx/dp/…" value="${esc(d.linkAmazon || d.asin || '')}" autocomplete="off">
                        <span id="of-detect-asin" class="of-detect"></span>
                    </label>
                    <label class="of-wide">
                        <span>Título</span>
                        <input type="text" id="of-titulo" placeholder="Nombre del producto" value="${esc(d.titulo || '')}" autocomplete="off">
                    </label>
                    <label>
                        <span>Costo en tienda (MXN)</span>
                        <input type="number" id="of-costo" min="0" step="0.01" inputmode="decimal" placeholder="Ej. 299" value="${d.costo !== '' && d.costo != null && d.costo !== 0 ? esc(d.costo) : ''}">
                    </label>
                    <label>
                        <span>Precio Amazon (opcional)</span>
                        <input type="number" id="of-precio" min="0" step="0.01" inputmode="decimal" placeholder="Si vacío, usa Keepa caché" value="${d.precioAmazon !== '' && d.precioAmazon != null && d.precioAmazon !== 0 ? esc(d.precioAmazon) : ''}">
                    </label>
                    <label class="of-wide">
                        <span>Nota</span>
                        <input type="text" id="of-nota" placeholder="Promo, membresía…" value="${esc(d.nota || '')}" autocomplete="off">
                    </label>
                </div>
                <div id="of-live-preview">${previewHtml(previewItem)}</div>
                <div class="of-form-actions">
                    <button type="button" class="btn primary" id="of-save">${local.editingId ? 'Guardar' : 'Agregar al radar'}</button>
                    ${local.editingId ? `<button type="button" class="btn ghost" id="of-cancel-edit">Cancelar</button>` : ''}
                    ${!local.editingId && local.draft ? `<button type="button" class="btn ghost" id="of-clear-draft">Limpiar borrador</button>` : ''}
                </div>
            </section>
        `;
        bind(root);
        refreshPreview(root);
        if (window.Keepa?.hydrate) Keepa.hydrate(root);
        window.Icons?.hydrate?.(root);
        if (local.filter === 'guardados') {
            const host = root.querySelector('#of-guardados-host');
            if (host) window.WishlistView?.renderEmbedded?.(host);
        }
    }

    function refreshPreview(root) {
        const box = root.querySelector('#of-live-preview');
        if (!box) return;
        const item = normalizeItem(readForm(root)) || readForm(root);
        box.innerHTML = previewHtml(item);

        const tiendaEl = root.querySelector('#of-detect-tienda');
        if (tiendaEl) {
            const store = item.tienda || detectStore(item.linkTienda || '').label;
            tiendaEl.innerHTML = store
                ? `<span class="of-store">${esc(store)}</span>`
                : `<span class="muted small">La tienda aparece al pegar el link</span>`;
        }
        const asinEl = root.querySelector('#of-detect-asin');
        if (asinEl) {
            asinEl.innerHTML = item.asin
                ? `<code>${esc(item.asin)}</code>`
                : `<span class="muted small">El ASIN aparece al pegar el link de Amazon</span>`;
        }
    }

    function formIsDirty(root) {
        return ['of-link-tienda', 'of-link-amazon', 'of-titulo', 'of-costo', 'of-precio', 'of-nota']
            .some(id => {
                const el = root.querySelector(`#${id}`);
                return el && String(el.value || '').trim() !== '';
            });
    }

    function bind(root) {
        const onPreview = () => refreshPreview(root);
        const bindLive = (el) => {
            if (!el) return;
            el.addEventListener('input', onPreview);
            el.addEventListener('change', onPreview);
            el.addEventListener('paste', () => setTimeout(onPreview, 0));
        };
        ['of-link-tienda', 'of-link-amazon', 'of-costo', 'of-precio'].forEach(id => {
            bindLive(root.querySelector(`#${id}`));
        });

        root.querySelector('#of-save')?.addEventListener('click', () => {
            const item = readForm(root);
            if (!item.linkTienda && !item.linkAmazon && !item.asin) {
                UI.toast('Pega el link de la tienda o el ASIN', 'error');
                return;
            }
            if (!(item.costo > 0)) {
                UI.toast('Falta el costo en tienda', 'error');
                return;
            }
            const status = local.editingId
                ? (loadItems().find(i => i.id === local.editingId)?.status || 'vigilando')
                : 'vigilando';
            upsert(item, status);
        });

        root.querySelector('#of-cancel-edit')?.addEventListener('click', () => {
            local.editingId = null;
            render();
        });

        root.querySelector('#of-clear-draft')?.addEventListener('click', () => {
            local.draft = null;
            render();
        });

        // Evita navegar si alguien hace click (el uso real es arrastrar a favoritos)
        const bm = root.querySelector('.of-bookmark-link');
        if (bm) {
            bm.setAttribute('href', bookmarkletHref());
            bm.addEventListener('click', (e) => {
                e.preventDefault();
                UI.toast('Arrastrá “Enviar a Ofertas” a la barra de favoritos');
            });
        }

        root.querySelector('#of-serp-retail')?.addEventListener('change', (e) => {
            captureSerpDraft(root);
            local.serpRetailOnly = !!e.target.checked;
            render();
        });

        root.querySelectorAll('[data-goto-settings-serp]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const toKeepa = el.hasAttribute('data-goto-keepa');
                window.App?.switchTab?.('settings');
                setTimeout(() => {
                    const id = toKeepa ? 'set-keepa-key' : 'set-serpapi-key';
                    const target = document.getElementById(id) || document.getElementById('set-serpapi-key');
                    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target?.focus();
                }, 80);
            });
        });

        const serpAsinInput = root.querySelector('#of-serp-asin');
        if (serpAsinInput) {
            updateSerpAsinDetect(root);
            serpAsinInput.addEventListener('input', () => updateSerpAsinDetect(root));
            serpAsinInput.addEventListener('paste', () => {
                setTimeout(() => updateSerpAsinDetect(root), 0);
            });
        }
        root.querySelector('#of-serp-q')?.addEventListener('input', (e) => {
            local.serpDraft.query = String(e.target.value || '');
        });

        root.querySelector('#of-serp-add')?.addEventListener('click', () => {
            const w = addWatchFromForm(root);
            if (w) {
                UI.toast('Vigilancia guardada');
                render();
            }
        });

        const runFromForm = async () => {
            const w = addWatchFromForm(root);
            if (!w) return;
            render();
            await runWatchSearch(w.id);
        };

        root.querySelector('#of-serp-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            runFromForm();
        });

        root.querySelector('#of-serp-add-run')?.addEventListener('click', (e) => {
            e.preventDefault();
            runFromForm();
        });

        root.querySelectorAll('[data-serp-run]').forEach(btn => {
            btn.addEventListener('click', () => runWatchSearch(btn.getAttribute('data-serp-run')));
        });

        root.querySelectorAll('[data-serp-del]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-serp-del');
                const ok = await UI.confirm({
                    title: 'Quitar vigilancia',
                    message: 'Se borrará la búsqueda y sus resultados cacheados.',
                    primaryLabel: 'Quitar',
                    danger: true,
                });
                if (!ok) return;
                saveWatches(loadWatches().filter(w => w.id !== id));
                render();
            });
        });

        root.querySelectorAll('[data-serp-to-radar]').forEach(btn => {
            btn.addEventListener('click', () => {
                const watchId = btn.getAttribute('data-serp-to-radar');
                const orig = Number(btn.getAttribute('data-hit-orig'));
                const watch = loadWatches().find(w => w.id === watchId);
                if (!watch) return;
                const hit = Array.isArray(watch.hits) ? watch.hits[orig] : null;
                if (!hit) return;
                applyHitToDraft(watch, hit);
            });
        });

        root.querySelectorAll('[data-of-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                local.filter = btn.getAttribute('data-of-filter') || 'revisar';
                render();
            });
        });

        root.querySelectorAll('[data-of-edit]').forEach(btn => {
            btn.addEventListener('click', () => {
                local.editingId = btn.getAttribute('data-of-edit');
                render();
                root.querySelector('#of-link-tienda')?.focus();
                root.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });

        root.querySelectorAll('[data-of-status]').forEach(btn => {
            btn.addEventListener('click', () => {
                setStatus(btn.getAttribute('data-id'), btn.getAttribute('data-of-status'));
            });
        });

        root.querySelectorAll('[data-of-keepa]').forEach(btn => {
            btn.addEventListener('click', () => {
                window.KeepaView?.openAsin?.(btn.getAttribute('data-of-keepa'));
            });
        });

        root.querySelectorAll('[data-of-wishlist]').forEach(btn => {
            btn.addEventListener('click', () => sendToWishlist(btn.getAttribute('data-of-wishlist')));
        });
        root.querySelectorAll('[data-of-convert]').forEach(btn => {
            btn.addEventListener('click', () => convertToProduct(btn.getAttribute('data-of-convert')));
        });

        root.querySelectorAll('[data-of-del]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await UI.confirm({
                    title: 'Eliminar oferta',
                    message: 'Se quitará del radar. ¿Continuar?',
                    primaryLabel: 'Eliminar',
                    danger: true,
                });
                if (ok) removeItem(btn.getAttribute('data-of-del'));
            });
        });
    }

    function init() {
        window.State.subscribe(() => {
            if (window.State.view !== 'ofertas') return;
            const root = document.getElementById('view-ofertas');
            if (root && (root.contains(document.activeElement) || formIsDirty(root))) return;
            render();
        });
        window.addEventListener('hashchange', () => {
            window.App?.openOfertasDraft?.();
        });
    }

    /** Llamado desde App al arrancar / al recibir hash #oferta= */
    function openDraftFromUrl() {
        return consumeIncomingDraft();
    }

    function hasDraft() {
        return !!local.draft;
    }

    return {
        init,
        render,
        pendingCount,
        isEnabled: isAmazonView,
        openDraftFromUrl,
        acceptDraft,
        hasDraft,
        showGuardados,
    };
})();
window.OfertasView = OfertasView;
