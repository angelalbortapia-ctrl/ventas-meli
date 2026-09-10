/* ==========================================================================
   SerpAPI — Google Shopping MX + Immersive Product vía /api/serpapi/* (serve.py).
   ========================================================================== */

const SerpApi = (() => {
    const KEY_MIN = 20;

    function getApiKey() {
        return String(window.State?.ui?.serpApiKey || '').trim();
    }

    function setApiKey(key) {
        window.State.ui = { ...window.State.ui, serpApiKey: String(key || '').trim() };
        const prev = window.__skipSync;
        window.__skipSync = true;
        try {
            window.State.saveUI();
        } finally {
            window.__skipSync = prev;
        }
    }

    function hasKey() {
        return getApiKey().length >= KEY_MIN;
    }

    function keyLooksValid(key = getApiKey()) {
        const k = String(key || '').trim();
        return k.length >= KEY_MIN && !/\s/.test(k);
    }

    function requireKey() {
        const key = getApiKey();
        if (!key) throw new Error('Falta API key de SerpAPI en Ajustes');
        if (!keyLooksValid(key)) {
            throw new Error('La API key de SerpAPI no parece válida. Vuelve a pegarla en Ajustes.');
        }
        return key;
    }

    async function proxyGet(path, params = {}) {
        const key = requireKey();
        const qs = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v == null || v === '') return;
            if (typeof v === 'boolean') {
                if (v) qs.set(k, 'true');
                return;
            }
            qs.set(k, String(v));
        });
        const url = `/api/serpapi/${path}${qs.toString() ? `?${qs}` : ''}`;
        let res;
        try {
            res = await fetch(url, {
                headers: { 'X-SerpApi-Key': key, Accept: 'application/json' },
                cache: 'no-store',
            });
        } catch (err) {
            throw new Error(
                'No se pudo hablar con el proxy local. ¿Corrés python3 serve.py?'
            );
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || data.message || `SerpAPI HTTP ${res.status}`);
        }
        if (data.error) throw new Error(String(data.error));
        return data;
    }

    /**
     * Google Shopping MX. ~1 crédito (o gratis si cache SerpAPI ~1h).
     * Opts: minPrice, maxPrice, location, onSale, freeShipping, sortBy (1|2), noCache
     */
    async function shopping(query, opts = {}) {
        const q = String(query || '').trim();
        if (!q) throw new Error('Escribe qué buscar');
        return proxyGet('shopping', {
            q,
            gl: opts.gl || 'mx',
            hl: opts.hl || 'es',
            google_domain: opts.googleDomain || 'google.com.mx',
            location: opts.location || 'Mexico City, Mexico',
            min_price: opts.minPrice,
            max_price: opts.maxPrice,
            sort_by: opts.sortBy,
            shoprs: opts.shoprs,
            on_sale: opts.onSale ? 'true' : '',
            free_shipping: opts.freeShipping ? 'true' : '',
            no_cache: opts.noCache ? 'true' : '',
        });
    }

    /**
     * Popup Immersive: todas las tiendas del mismo producto.
     * page_token viene de un hit Shopping (immersive_product_page_token).
     * more_stores=true → hasta ~13 sellers. ~1 crédito.
     */
    async function immersiveProduct(pageToken, opts = {}) {
        const token = String(pageToken || '').trim();
        if (!token) throw new Error('Falta page_token Immersive');
        return proxyGet('immersive', {
            page_token: token,
            more_stores: opts.moreStores === false ? '' : 'true',
            next_page_token: opts.nextPageToken || '',
        });
    }

    async function accountStatus() {
        return proxyGet('account');
    }

    return {
        getApiKey,
        setApiKey,
        hasKey,
        keyLooksValid,
        shopping,
        immersiveProduct,
        accountStatus,
    };
})();

window.SerpApi = SerpApi;
