/* ==========================================================================
   Detección de tiendas MX (Costco, Sam's, Walmart, etc.) desde URL.
   Compartido por Wishlist y Ofertas. Sin scraping: solo parseo de dominio.
   ========================================================================== */

const Stores = (() => {

    /** Dominio → tienda de compra (MX / comunes de arbitraje). */
    const STORE_RULES = [
        { id: 'costco', label: 'Costco', match: /(?:^|\.)costco\.com(?:\.mx)?$/i },
        { id: 'sams', label: "Sam's Club", match: /(?:^|\.)sams(?:club)?\.com(?:\.mx)?$/i },
        { id: 'walmart', label: 'Walmart', match: /(?:^|\.)walmart\.com(?:\.mx)?$/i },
        { id: 'bodega', label: 'Bodega Aurrera', match: /(?:^|\.)bodegaaurrera\.com(?:\.mx)?$/i },
        { id: 'liverpool', label: 'Liverpool', match: /(?:^|\.)liverpool\.com(?:\.mx)?$/i },
        { id: 'suburbia', label: 'Suburbia', match: /(?:^|\.)suburbia\.com(?:\.mx)?$/i },
        { id: 'palacio', label: 'El Palacio de Hierro', match: /(?:^|\.)elpalaciodehierro\.com(?:\.mx)?$/i },
        { id: 'coppel', label: 'Coppel', match: /(?:^|\.)coppel\.com$/i },
        { id: 'elektra', label: 'Elektra', match: /(?:^|\.)elektra\.com(?:\.mx)?$/i },
        { id: 'home_depot', label: 'Home Depot', match: /(?:^|\.)homedepot\.com(?:\.mx)?$/i },
        { id: 'office_depot', label: 'Office Depot', match: /(?:^|\.)officedepot\.com(?:\.mx)?$/i },
        { id: 'bestbuy', label: 'Best Buy', match: /(?:^|\.)bestbuy\.com(?:\.mx)?$/i },
        { id: 'sears', label: 'Sears', match: /(?:^|\.)sears\.com(?:\.mx)?$/i },
        { id: 'sanborns', label: 'Sanborns', match: /(?:^|\.)sanborns\.com(?:\.mx)?$/i },
        { id: 'soriana', label: 'Soriana', match: /(?:^|\.)soriana\.com$/i },
        { id: 'chedraui', label: 'Chedraui', match: /(?:^|\.)chedraui\.com(?:\.mx)?$/i },
        { id: 'heb', label: 'HEB', match: /(?:^|\.)heb\.com(?:\.mx)?$/i },
        { id: 'city_market', label: 'City Market', match: /(?:^|\.)citymarket\.com(?:\.mx)?$/i },
        { id: 'rappi', label: 'Rappi', match: /(?:^|\.)rappi\.com(?:\.mx)?$/i },
        { id: 'mercado_libre', label: 'Mercado Libre', match: /(?:^|\.)mercadolibre\.com(?:\.mx)?$|(?:^|\.)mercadolivre\.com|(?:^|\.)mlb\.com\.mx$/i },
        { id: 'amazon', label: 'Amazon', match: /(?:^|\.)amazon\.com(?:\.mx|\.br)?$|(?:^|\.)amzn\.to$/i },
        { id: 'shein', label: 'Shein', match: /(?:^|\.)shein\.com$/i },
        { id: 'temu', label: 'Temu', match: /(?:^|\.)temu\.com$/i },
        { id: 'aliexpress', label: 'AliExpress', match: /(?:^|\.)aliexpress\.com$/i },
    ];

    /** Solo http(s): un link pegado con `javascript:` no debe volverse ejecutable. */
    function safeUrl(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        try {
            const url = new URL(raw, window.location.origin);
            return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
        } catch {
            return '';
        }
    }

    function hostFromUrl(text) {
        const s = String(text || '').trim();
        if (!s) return '';
        try {
            const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
            return new URL(withProto).hostname.replace(/^www\./i, '').toLowerCase();
        } catch {
            return '';
        }
    }

    /** Infiera tienda del link (Costco, Sam's, Walmart, Sanborns, etc.). */
    function detectStore(text) {
        const host = hostFromUrl(text);
        if (!host) return { id: '', label: '' };
        for (const rule of STORE_RULES) {
            if (rule.match.test(host)) {
                return { id: rule.id, label: rule.label };
            }
        }
        const base = host.split('.')[0] || '';
        if (!base) return { id: '', label: '' };
        const label = base.charAt(0).toUpperCase() + base.slice(1);
        return { id: 'otra', label };
    }

    function extractAsin(text) {
        return window.Keepa?.extractAsin?.(text)
            || (() => {
                const s = String(text || '').trim();
                if (!s) return '';
                if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();
                const m = s.match(
                    /(?:\/(?:dp|gp\/product|gp\/aw\/d|product|exec\/obidos\/ASIN)|[?&]asin=)\/?([A-Z0-9]{10})\b/i
                ) || s.match(/\b([B0-9][A-Z0-9]{9})\b/i);
                return m ? m[1].toUpperCase() : '';
            })();
    }

    return {
        STORE_RULES,
        safeUrl,
        hostFromUrl,
        detectStore,
        extractAsin,
    };
})();
window.Stores = Stores;
