/* ==========================================================================
   Modelo de datos + persistencia en localStorage.
   Estado global: window.State
   Schema de lote v3:
     id, productId, sku, producto, variante, tipo, fecha, categoria, notas,
     costo, unidades, precioCompetencia, precio, envio, vendidas, estatus,
     imagen,   // data URL JPEG comprimido; compartida por productId (familia)
     ventas:   [{ id, fecha, precio, unidades, notas, envioEstado?, meliOrderId?, meliItemId? }]
     historial:[{ ts, tipo, meta }]
   vendidas se deriva de ventas[] cuando hay eventos (una sola verdad).
   productId agrupa variantes del mismo producto (estable, no por typo de nombre).
   ========================================================================== */

const Data = (() => {

    const UI_KEY = 'ventas-meli:ui:v1';

    /** Catálogos separados por marketplace (no se mezclan productos). */
    const MARKETPLACES = {
        meli: {
            id: 'meli',
            label: 'Mercado Libre',
            short: 'Meli',
            lotesKey: 'ventas-meli:v1',
            settingsKey: 'ventas-meli:settings:v1',
            useSeed: true,
        },
        amazon: {
            id: 'amazon',
            label: 'Amazon',
            short: 'Amazon',
            lotesKey: 'ventas-amazon:v1',
            settingsKey: 'ventas-amazon:settings:v1',
            useSeed: false,
        },
    };

    // Compat: claves históricas de Meli
    const STORAGE_KEY = MARKETPLACES.meli.lotesKey;
    const SETTINGS_KEY = MARKETPLACES.meli.settingsKey;

    function normalizeMarketplace(mp) {
        return mp === 'amazon' ? 'amazon' : 'meli';
    }

    /** Vista del switcher: catálogo real o resumen combinado. */
    function normalizeMpView(v) {
        if (v === 'general' || v === 'amazon' || v === 'meli') return v;
        return 'meli';
    }

    function currentMarketplace() {
        return normalizeMarketplace(window.State?.marketplace);
    }

    function mpMeta(mp = currentMarketplace()) {
        return MARKETPLACES[normalizeMarketplace(mp)];
    }

    /** Lee ambos catálogos (sin cambiar State). Lotes llevan `_mp` en memoria. */
    function loadBothCatalogs() {
        const tag = (lotes, mp) => (lotes || []).map(l => ({ ...l, _mp: mp }));
        return {
            meli: {
                lotes: tag(loadLotes('meli'), 'meli'),
                settings: loadSettings('meli'),
            },
            amazon: {
                lotes: tag(loadLotes('amazon'), 'amazon'),
                settings: loadSettings('amazon'),
            },
        };
    }

    const PRODUCT_IDS = {
        palomera: 'p-palomera',
        aspiradora: 'p-aspiradora',
        controlador: 'p-controlador',
        monitor: 'p-monitor',
        rallador: 'p-rallador',
        lampara: 'p-lampara',
        bano: 'p-bano-6p',
    };

    // Seed inicial (9 variantes / 7 productos del Excel Negocio.xlsx).
    const SEED = [
        { id: '1', productId: PRODUCT_IDS.palomera,    sku: 'PAL-ELÉ-AIR-ROJ-01', producto: 'Palomera Eléctrica De Aire Caliente Sin Aceite Roja', variante: 'Rojo',   tipo: 'Clasica', fecha: '2026-07-19', categoria: 'Cocina',  costo: 225,    unidades: 3, precioCompetencia: 469, precio: 499, envio: 84.5, vendidas: 0, estatus: '✅ Activa / En Venta' },
        { id: '2', productId: PRODUCT_IDS.aspiradora,  sku: 'ASP-3-EN-NEG-01',    producto: 'Aspiradora 3 En 1',                                    variante: 'Negra',  tipo: 'Clasica', fecha: '2026-07-19', categoria: 'Hogar',   costo: 60,     unidades: 3, precioCompetencia: 141, precio: 199, envio: 52.4, vendidas: 0, estatus: '✅ Activa / En Venta' },
        { id: '3', productId: PRODUCT_IDS.controlador, sku: 'CON-JUE-MIN-GRI-01', producto: 'Controlador De Juego Mini Máquina Dos Controles Generico', variante: 'Gris', tipo: 'Premium', fecha: '2026-07-19', categoria: 'Gaming',  costo: 147.25, unidades: 4, precioCompetencia: 390, precio: 379, envio: 59.6, vendidas: 0, estatus: '✅ Activa / En Venta' },
        { id: '4', productId: PRODUCT_IDS.monitor,     sku: 'MON-PRE-ART-BLA-01', producto: 'Monitor De Presión Arterial Pulso Baumanómetro Digital Brazo', variante: 'Blanco', tipo: 'Clasica', fecha: '2026-07-19', categoria: 'Salud',   costo: 84,   unidades: 2, precioCompetencia: 223, precio: 223, envio: 56.0, vendidas: 0, estatus: '✅ Activa / En Venta' },
        { id: '5', productId: PRODUCT_IDS.rallador,    sku: 'RAL-COR-PIC-NEG-01', producto: 'Rallador Cortador Picadora De Verduras Fruta',          variante: 'Negro',  tipo: 'Premium', fecha: '2026-07-19', categoria: 'Cocina',  costo: 119,    unidades: 3, precioCompetencia: 339, precio: 339, envio: 66.1, vendidas: 0, estatus: '✅ Activa / En Venta' },
        { id: '6', productId: PRODUCT_IDS.lampara,     sku: 'LÁM-ESC-CON-ROJ-01', producto: 'Lámpara De Escritorio Con Espacio Ajustable En Forma De Luna', variante: 'Roja', tipo: 'Clasica', fecha: '2026-07-19', categoria: 'Hogar',   costo: 36,   unidades: 2, precioCompetencia: 129, precio: 249, envio: 67.6, vendidas: 0, estatus: '✅ Activa / En Venta' },
        { id: '7', productId: PRODUCT_IDS.bano,        sku: 'JUE-ACC-BAÑ-ROS-01', producto: 'Juego De Accesorios De Baño De 6 Piezas',               variante: 'Rosa',   tipo: 'Clasica', fecha: '2026-07-19', categoria: 'Baño',    costo: 259,    unidades: 1, precioCompetencia: 453, precio: 599, envio: 74.5, vendidas: 0, estatus: '✅ Activa / En Venta' },
        { id: '8', productId: PRODUCT_IDS.bano,        sku: 'JUE-ACC-BAÑ-GRI-01', producto: 'Juego De Accesorios De Baño De 6 Piezas',               variante: 'Gris',   tipo: 'Clasica', fecha: '2026-07-19', categoria: 'Baño',    costo: 259,    unidades: 1, precioCompetencia: 453, precio: 599, envio: 74.5, vendidas: 0, estatus: '✅ Activa / En Venta' },
        { id: '9', productId: PRODUCT_IDS.bano,        sku: 'JUE-ACC-BAÑ-BLA-01', producto: 'Juego De Accesorios De Baño De 6 Piezas',               variante: 'Blanco', tipo: 'Clasica', fecha: '2026-07-19', categoria: 'Baño',    costo: 259,    unidades: 1, precioCompetencia: 453, precio: 599, envio: 74.5, vendidas: 0, estatus: '✅ Activa / En Venta' },
    ];

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function productNameKey(producto) {
        return String(producto || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    /** Asigna productId estable: reusa el de siblings con mismo nombre, o crea uno nuevo. */
    function resolveProductId(l, siblings = []) {
        if (l.productId) return l.productId;
        const key = productNameKey(l.producto);
        if (key) {
            const match = siblings.find(s => s.productId && productNameKey(s.producto) === key);
            if (match) return match.productId;
        }
        return 'p-' + newId();
    }

    function syncVendidasFromVentas(l) {
        if (Array.isArray(l.ventas) && l.ventas.length) {
            return l.ventas.reduce((s, v) => s + (Number(v.unidades) || 0), 0);
        }
        return Number(l.vendidas) || 0;
    }

    /** SKU comparable para match Excel / ML import. */
    function normalizeSku(sku) {
        return String(sku || '').trim().toLowerCase();
    }

    function normalizeVenta(v) {
        const out = {
            id: v.id || newId(),
            fecha: v.fecha || new Date().toISOString().slice(0, 10),
            precio: Number(v.precio) || 0,
            unidades: Number(v.unidades) || 1,
            notas: v.notas || '',
            envioEstado: normalizeEnvioEstado(v.envioEstado),
            envioNota: v.envioNota || '',
        };
        const oid = v.meliOrderId != null && v.meliOrderId !== '' ? String(v.meliOrderId) : '';
        const iid = v.meliItemId != null && v.meliItemId !== '' ? String(v.meliItemId) : '';
        if (oid) out.meliOrderId = oid;
        if (iid) out.meliItemId = iid;
        return out;
    }

    function meliOrderLineKey(orderId, sku) {
        return `${String(orderId || '')}::${normalizeSku(sku)}`;
    }

    function hasMeliOrderLine(lotes, orderId, sku) {
        if (!orderId) return false;
        return (lotes || []).some(l =>
            (l.ventas || []).some(v => {
                if (!v.meliOrderId) return false;
                if (String(v.meliOrderId) !== String(orderId)) return false;
                return normalizeSku(l.sku) === normalizeSku(sku);
            })
        );
    }

    /**
     * Importa filas normalizadas de ML a lotes Meli existentes (match por SKU).
     * No crea lotes. Dedup por meliOrderId + sku.
     * rows: [{ orderId, sku, fecha, precio, unidades, titulo, itemId }]
     */
    function importMeliOrders(lotes, rows = []) {
        const result = {
            lotes: lotes || [],
            imported: 0,
            duplicates: 0,
            unmatched: [],
        };
        if (!rows.length) return result;

        const bySku = new Map();
        (result.lotes || []).forEach((l, idx) => {
            const key = normalizeSku(l.sku);
            if (!key) return;
            if (!bySku.has(key)) bySku.set(key, []);
            bySku.get(key).push(idx);
        });

        const seenKeys = new Set();
        (result.lotes || []).forEach(l => {
            (l.ventas || []).forEach(v => {
                if (v.meliOrderId) {
                    seenKeys.add(meliOrderLineKey(v.meliOrderId, l.sku));
                }
            });
        });

        const next = result.lotes.map(l => ({ ...l, ventas: [...(l.ventas || [])], historial: [...(l.historial || [])] }));

        rows.forEach(r => {
            const sku = normalizeSku(r.sku);
            const orderId = String(r.orderId || '');
            if (!sku) {
                result.unmatched.push({
                    orderId,
                    sku: '',
                    titulo: r.titulo || '',
                    reason: 'sin_sku',
                });
                return;
            }
            const idxs = bySku.get(sku);
            if (!idxs || !idxs.length) {
                result.unmatched.push({
                    orderId,
                    sku: r.sku || '',
                    titulo: r.titulo || '',
                    reason: 'sin_lote',
                });
                return;
            }
            const lineKey = meliOrderLineKey(orderId, sku);
            if (orderId && seenKeys.has(lineKey)) {
                result.duplicates++;
                return;
            }
            const lote = next[idxs[0]];
            const title = String(r.titulo || '').slice(0, 80);
            const notas = [`ML #${orderId}`, title].filter(Boolean).join(' · ');
            addVenta(lote, {
                fecha: r.fecha,
                precio: r.precio,
                unidades: r.unidades,
                notas,
                meliOrderId: orderId,
                meliItemId: r.itemId || '',
            });
            if (orderId) seenKeys.add(lineKey);
            result.imported++;
        });

        result.lotes = next.map(l => normalize(l, next, 'meli'));
        return result;
    }

    // Normaliza lote a schema v3 (+ campos Amazon MX).
    // `mp` debe ser el catálogo dueño del lote (nunca el marketplace “activo” por accidente).
    function normalize(l, siblings = [], mp = currentMarketplace()) {
        const market = normalizeMarketplace(mp);
        const defaultTipo = market === 'amazon' ? 'FBA' : 'Clasica';
        const ventas = Array.isArray(l.ventas) ? l.ventas.map(normalizeVenta) : [];
        const pesoRaw = l.pesoKg;
        const pesoKg = pesoRaw != null && pesoRaw !== '' && !isNaN(Number(pesoRaw))
            ? Number(pesoRaw)
            : null;
        const out = {
            id: l.id || newId(),
            productId: resolveProductId(l, siblings),
            sku: l.sku || '',
            producto: l.producto || '',
            variante: l.variante || '',
            tipo: l.tipo || defaultTipo,
            fecha: l.fecha || new Date().toISOString().slice(0, 10),
            categoria: l.categoria || '',
            // Amazon: clave de tabla de referido + logística FBA
            categoriaAmazon: l.categoriaAmazon || '',
            pesoKg,
            tamanoFba: l.tamanoFba || '',
            // Amazon FBA: costo de almacenamiento estimado por unidad (Revenue Calculator)
            almacenamiento: Math.max(0, Number(l.almacenamiento) || 0),
            // Amazon: “Varios / Otros” de la Calculadora de ingresos (p.ej. $1)
            varios: Math.max(0, Number(l.varios) || 0),
            // Amazon FBA: estatus de mandar inventario AL almacén de Amazon (inbound)
            fbaInboundEstado: normalizeFbaInboundEstado(l.fbaInboundEstado),
            notas: l.notas || '',
            costo: Number(l.costo) || 0,
            unidades: Number(l.unidades) || 0,
            precioCompetencia: l.precioCompetencia != null && l.precioCompetencia !== '' ? Number(l.precioCompetencia) : null,
            precio: Number(l.precio) || 0,
            envio: Number(l.envio) || 0,
            gastoAds: Math.max(0, Number(l.gastoAds) || 0),
            estatus: l.estatus || '✅ Activa / En Venta',
            imagen: typeof l.imagen === 'string' ? l.imagen : '',
            ventas,
            historial: Array.isArray(l.historial) ? l.historial : [],
        };
        out.vendidas = syncVendidasFromVentas(out);
        return out;
    }

    /** Imagen compartida de la familia (primera no vacía). */
    function familyImage(lotes, productId) {
        if (!productId) return '';
        const hit = lotes.find(l => l.productId === productId && l.imagen);
        return hit ? hit.imagen : '';
    }

    /**
     * Asigna o limpia la imagen de la familia (productId).
     * Se guarda una sola copia (en el lote de id más estable) para no
     * multiplicar base64 en localStorage por cada color/variante.
     */
    function setFamilyImage(lotes, productId, imagen) {
        if (!productId) return lotes;
        const img = typeof imagen === 'string' ? imagen : '';
        const siblings = lotes.filter(l => l.productId === productId)
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (!siblings.length) return lotes;
        siblings.forEach((l, i) => { l.imagen = i === 0 ? img : ''; });
        return lotes;
    }

    /** Migra lote[] asegurando productId compartido por nombre legacy. */
    function migrateLotes(rawList, mp = currentMarketplace()) {
        const market = normalizeMarketplace(mp);
        const byName = new Map();
        const out = [];
        rawList.forEach(raw => {
            const key = productNameKey(raw.producto);
            let productId = raw.productId;
            if (!productId && key && byName.has(key)) productId = byName.get(key);
            if (!productId) productId = 'p-' + newId();
            if (key) byName.set(key, productId);
            out.push(normalize({ ...raw, productId }, out, market));
        });
        return market === 'amazon' ? alignAmazonRevenueCalcLotes(out) : out;
    }

    /**
     * Alinea lotes Amazon con snapshots de la Calculadora de ingresos MX.
     * - Prasada aceite coco $439 → alm 1.75 · utilidad $78
     * - Kirkland crema avellanas (CCREMA) $459 → alm 0.75 · utilidad $87.15
     * También corrige categoría/override FBA rotos en aceites de coco.
     */
    function alignAmazonRevenueCalcLotes(lotes) {
        let changed = false;
        const next = lotes.map(l => {
            const sku = String(l.sku || '').toUpperCase().trim();
            const name = String(l.producto || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const precio = Number(l.precio) || 0;
            const costo = Number(l.costo) || 0;

            // Prasada 2.28 L — Calculadora Amazon MX (ene–sept)
            const isPrasada = (Math.abs(precio - 439) < 0.01 && Math.abs(costo - 295.64) < 0.02)
                || name.includes('prasada');
            if (isPrasada) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                if (Math.abs(alm - 1.75) < 0.01 && varios === 0 && envio === 0 && cat === 'alimentacion') {
                    return l;
                }
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: l.tamanoFba || 'estandar',
                    pesoKg: Number(l.pesoKg) > 0 ? Number(l.pesoKg) : 2.28,
                    almacenamiento: 1.75,
                    varios: 0,
                    envio: 0,
                }, [], 'amazon');
            }

            // Kirkland Crema de Avellanas 2-pack (CCREMA) — Calculadora Amazon MX
            // Referido 12% sin IVA $47.48 · FBA essentials ~2.01–2.25 kg $17.75 · alm $0.75
            const isCcrema = sku === 'CCREMA'
                || (name.includes('kirkland') && name.includes('avellana'))
                || (name.includes('crema') && name.includes('avellana') && name.includes('cacao'))
                || (Math.abs(precio - 459) < 0.01 && Math.abs(costo - 305.87) < 0.02);
            if (isCcrema) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                const ok = cat === 'alimentacion'
                    && envio === 0
                    && varios === 0
                    && Math.abs(alm - 0.75) < 0.01
                    && peso >= 2.01 && peso <= 2.25;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: 'estandar',
                    // 2.0 kg cae en $17.30; Calculadora usa $17.75 → tramo 2.01–2.25
                    pesoKg: (peso >= 2.01 && peso <= 2.25) ? peso : 2.1,
                    almacenamiento: 0.75,
                    varios: 0,
                    envio: 0,
                }, [], 'amazon');
            }

            // PRAGNA Canela Molida (CANEMOLI) — Calculadora Amazon MX
            // Referido $50.41 · FBA essentials ~0.7 kg $15.10 · alm $0.43 → utilidad $249.15
            const isCanela = sku === 'CANEMOLI'
                || (name.includes('canela') && name.includes('pragna'))
                || (name.includes('canela') && name.includes('molida') && Math.abs(precio - 487.29) < 0.02)
                || (Math.abs(precio - 487.29) < 0.02 && Math.abs(costo - 172.2) < 0.05);
            if (isCanela) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                const ok = cat === 'alimentacion'
                    && envio === 0
                    && varios === 0
                    && Math.abs(alm - 0.43) < 0.01
                    && peso > 0.6 && peso <= 0.7;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: 'estandar',
                    // 771 g de producto; Calculadora usa tarifa del tramo ≤0.7 kg ($15.10)
                    pesoKg: (peso > 0.6 && peso <= 0.7) ? peso : 0.7,
                    almacenamiento: 0.43,
                    varios: 0,
                    envio: 0,
                    costo: Math.abs(costo - 172.2) < 0.15 ? 172.2 : costo,
                }, [], 'amazon');
            }

            // Pragna Condimento Cajun 690 g — Calculadora Amazon MX
            // Referido $30.83 · FBA essentials ~0.8 kg $6.70 · alm $0.45 → utilidad $90.67
            const isCajun = sku.includes('CAJUN')
                || (name.includes('cajun') && name.includes('pragna'))
                || (name.includes('condimento') && name.includes('cajun'))
                || (Math.abs(precio - 298) < 0.01 && Math.abs(costo - 169.35) < 0.02);
            if (isCajun) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                const ok = cat === 'alimentacion'
                    && envio === 0
                    && varios === 0
                    && Math.abs(alm - 0.45) < 0.01
                    && peso > 0.7 && peso <= 0.8;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: 'estandar',
                    // 690 g producto; Calculadora usa tramo ≤0.8 kg ($6.70 en banda $150–299)
                    pesoKg: (peso > 0.7 && peso <= 0.8) ? peso : 0.8,
                    almacenamiento: 0.45,
                    varios: 0,
                    envio: 0,
                }, [], 'amazon');
            }

            const isCocoOil = sku === 'COCOLI'
                || (name.includes('aceite') && name.includes('coco'));
            if (!isCocoOil) return l;

            const cat = String(l.categoriaAmazon || '').toLowerCase();
            const envio = Number(l.envio) || 0;
            const needsFix = cat !== 'alimentacion' || envio > 30;
            if (!needsFix) return l;

            changed = true;
            const peso = Number(l.pesoKg) || 0;
            return normalize({
                ...l,
                tipo: String(l.tipo || 'FBA').toUpperCase() === 'FBM' ? 'FBM' : 'FBA',
                categoria: 'Alimentación y Gourmet',
                categoriaAmazon: 'alimentacion',
                tamanoFba: l.tamanoFba || 'estandar',
                pesoKg: peso > 0 ? peso : null,
                envio: envio > 30 ? 0 : envio,
            }, [], 'amazon');
        });
        return changed ? next : lotes;
    }

    function loadLotes(mp = currentMarketplace()) {
        const meta = mpMeta(mp);
        try {
            const raw = localStorage.getItem(meta.lotesKey);
            if (!raw) {
                if (!meta.useSeed) {
                    saveLotes([], mp);
                    return [];
                }
                const seed = SEED.map((l, i, arr) => normalize(l, arr.slice(0, i), mp));
                saveLotes(seed, mp);
                return seed;
            }
            const migrated = migrateLotes(JSON.parse(raw), mp);
            saveLotes(migrated, mp); // persiste productIds
            return migrated;
        } catch (e) {
            console.error('Error cargando lotes:', e);
            if (!meta.useSeed) return [];
            return SEED.map((l, i, arr) => normalize(l, arr.slice(0, i), mp));
        }
    }

    function saveLotes(lotes, mp = currentMarketplace()) {
        localStorage.setItem(mpMeta(mp).lotesKey, JSON.stringify(lotes));
    }

    function loadSettings(mp = currentMarketplace()) {
        const id = normalizeMarketplace(mp);
        const base = Calc.defaultsFor ? Calc.defaultsFor(id) : { ...Calc.DEFAULT_SETTINGS, marketplace: id };
        try {
            const raw = localStorage.getItem(mpMeta(id).settingsKey);
            if (!raw) return { ...base, marketplace: id };
            const parsed = JSON.parse(raw) || {};
            // Quitar meta de sync si quedó persistida por error
            delete parsed._amazon;
            delete parsed._marketplace;
            delete parsed._syncMeta;
            return { ...base, ...parsed, marketplace: id };
        } catch (e) {
            return { ...base, marketplace: id };
        }
    }

    function saveSettings(settings, mp = currentMarketplace()) {
        const id = normalizeMarketplace(mp);
        const clean = { ...(settings || {}), marketplace: id };
        delete clean._amazon;
        delete clean._marketplace;
        delete clean._syncMeta;
        localStorage.setItem(mpMeta(id).settingsKey, JSON.stringify(clean));
    }

    function loadUI() {
        try {
            const raw = localStorage.getItem(UI_KEY) || '{}';
            const ui = JSON.parse(raw) || {};
            const before = JSON.stringify(ui);
            // Preferencias de layouts / gráficas viejas ya no aplican
            delete ui.insightLayout;
            delete ui.insightLayoutId;
            delete ui.dashLayout;
            delete ui.dashLayoutId;
            delete ui.dashChartProposal;
            delete ui.dashChartStyle;
            delete ui.dashChartMetric;
            // Migrar filtros de gráfica legado (año/mes/semana → YYYY-MM-DD)
            if (ui.dashChartFrom && !/^\d{4}-\d{2}-\d{2}$/.test(String(ui.dashChartFrom))) {
                const s = String(ui.dashChartFrom).trim();
                let iso = '';
                if (/^W-(\d{4})-(\d{2})-(\d{2})$/.test(s)) {
                    const m = s.match(/^W-(\d{4})-(\d{2})-(\d{2})$/);
                    iso = `${m[1]}-${m[2]}-${m[3]}`;
                } else if (/^\d{4}-\d{2}$/.test(s)) {
                    iso = `${s}-01`;
                } else if (/^\d{4}$/.test(s)) {
                    iso = `${s}-01-01`;
                }
                ui.dashChartFrom = iso;
            }
            if (ui.dashChartFromPreset !== 'month' && ui.dashChartFromPreset !== 'year') {
                delete ui.dashChartFromPreset;
            }
            if (ui.capitalAlloc != null && typeof ui.capitalAlloc !== 'object') {
                delete ui.capitalAlloc;
            }
            if (ui.marketplace !== 'amazon') ui.marketplace = 'meli';
            ui.mpView = normalizeMpView(
                ui.mpView === 'general' ? 'general' : (ui.mpView || ui.marketplace)
            );
            const after = JSON.stringify(ui);
            if (after !== before) {
                try { localStorage.setItem(UI_KEY, after); } catch { /* ignore */ }
            }
            return ui;
        } catch {
            return {};
        }
    }
    function saveUI(ui) {
        localStorage.setItem(UI_KEY, JSON.stringify(ui));
    }

    function resetAll() {
        Object.values(MARKETPLACES).forEach(meta => {
            localStorage.removeItem(meta.lotesKey);
            localStorage.removeItem(meta.settingsKey);
        });
        localStorage.removeItem(UI_KEY);
    }

    /**
     * Borra todas las ventas y restaura unidades al seed original (por SKU).
     * En Amazon (sin seed) solo limpia ventas y mantiene unidades.
     */
    function clearVentasRestoreStock(lotes, mp = currentMarketplace()) {
        const useSeed = mpMeta(mp).useSeed;
        const bySku = useSeed ? Object.fromEntries(SEED.map(s => [s.sku, s])) : {};
        let ventasCleared = 0;
        const next = (lotes || []).map(l => {
            const seed = bySku[l.sku];
            const hadVentas = (Array.isArray(l.ventas) && l.ventas.length) || (Number(l.vendidas) || 0) > 0;
            if (hadVentas) ventasCleared += Array.isArray(l.ventas) ? l.ventas.length : 1;
            const estatus = seed
                ? (seed.estatus || '✅ Activa / En Venta')
                : (String(l.estatus || '').toLowerCase().includes('sin stock')
                    ? '✅ Activa / En Venta'
                    : l.estatus);
            return normalize({
                ...l,
                unidades: seed ? seed.unidades : (Number(l.unidades) || 0),
                ventas: [],
                vendidas: 0,
                estatus,
            }, []);
        });
        return { lotes: next, ventasCleared };
    }

    function autoSku(producto, variante, existentes) {
        const clean = s => String(s || '')
            .toUpperCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Z0-9 ]/g, '')
            .trim();
        const words = clean(producto).split(/\s+/).filter(Boolean).slice(0, 3);
        const parts = words.map(w => w.slice(0, 3));
        if (variante) parts.push(clean(variante).slice(0, 3));
        const base = parts.join('-') || 'SKU';
        let i = 1;
        while (existentes.includes(`${base}-${String(i).padStart(2, '0')}`)) i++;
        return `${base}-${String(i).padStart(2, '0')}`;
    }

    function upsertLote(lotes, lote) {
        // Si no trae productId, hereda de hermanos con mismo nombre o del existente
        const siblings = lotes.filter(x => x.id !== lote.id);
        const l = normalize(lote, siblings);
        // Si cambia el nombre y hay hermano con ese nombre, alinear productId
        const sameName = siblings.find(s => productNameKey(s.producto) === productNameKey(l.producto));
        if (sameName && !lote.productId) l.productId = sameName.productId;

        const idx = lotes.findIndex(x => x.id === l.id);
        if (idx >= 0) {
            const prev = lotes[idx];
            // vendidas nunca se edita a mano: siempre desde ventas
            l.ventas = Array.isArray(lote.ventas) ? lote.ventas : (prev.ventas || []);
            l.vendidas = syncVendidasFromVentas(l);
            if (!lote.productId) l.productId = prev.productId || l.productId;
            // imagen: conservar si el upsert no la trae (edits de formulario)
            if (lote.imagen === undefined) l.imagen = prev.imagen || '';

            const changes = diffLote(prev, l);
            if (changes.length) {
                l.historial = [...(prev.historial || []), {
                    ts: Date.now(),
                    tipo: 'edicion',
                    meta: { changes }
                }];
            } else {
                l.historial = prev.historial;
            }
            lotes[idx] = l;
        } else {
            l.historial = [...(l.historial || []), {
                ts: Date.now(),
                tipo: 'creacion',
                meta: { sku: l.sku, producto: l.producto, productId: l.productId }
            }];
            lotes.push(l);
        }
        return lotes;
    }

    function diffLote(a, b) {
        const keys = ['sku','producto','variante','tipo','fecha','categoria','costo','unidades','precio','envio','estatus','productId','precioCompetencia','notas'];
        const out = [];
        for (const k of keys) {
            const va = a[k], vb = b[k];
            if (String(va ?? '') !== String(vb ?? '')) {
                out.push({ field: k, from: va, to: vb });
            }
        }
        return out;
    }

    function deleteLote(lotes, id) {
        const doomed = lotes.find(l => l.id === id);
        const next = lotes.filter(l => l.id !== id);
        // Si el lote borrado guardaba la foto de familia, muévela a un hermano.
        if (doomed?.productId && doomed.imagen) {
            const sib = next
                .filter(l => l.productId === doomed.productId)
                .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
            if (sib && !sib.imagen) sib.imagen = doomed.imagen;
        }
        return next;
    }

    function duplicateLote(lote) {
        return normalize({
            ...lote,
            id: newId(),
            productId: lote.productId, // misma familia
            sku: (lote.sku || '') + '-COPIA',
            imagen: '', // la foto de familia ya vive en otro lote del productId
            vendidas: 0,
            ventas: [],
            historial: [],
        }, []);
    }

    // ---- Ventas individuales ------------------------------------------------
    const ENVIO_ESTADOS = ['por_preparar', 'empaquetado', 'etiqueta', 'listo', 'enviado'];
    /** Inbound a FBA (mandar inventario a Amazon). */
    const FBA_INBOUND_ESTADOS = ['creando', 'por_enviar', 'en_transito', 'recibido'];

    function normalizeEnvioEstado(v) {
        const s = String(v || '').trim();
        return ENVIO_ESTADOS.includes(s) ? s : '';
    }

    function addVenta(lote, venta) {
        const v = normalizeVenta({
            id: newId(),
            fecha: venta.fecha || new Date().toISOString().slice(0, 10),
            precio: Number(venta.precio) || Number(lote.precio) || 0,
            unidades: Number(venta.unidades) || 1,
            notas: venta.notas || '',
            // Preparación de envío (FBM / Easy Ship): por_preparar → empaquetado → etiqueta → listo → enviado
            envioEstado: venta.envioEstado,
            envioNota: venta.envioNota || '',
            meliOrderId: venta.meliOrderId,
            meliItemId: venta.meliItemId,
        });
        lote.ventas = [...(lote.ventas || []), v];
        lote.vendidas = syncVendidasFromVentas(lote);
        lote.historial = [...(lote.historial || []), {
            ts: Date.now(),
            tipo: 'venta',
            meta: {
                ventaId: v.id,
                fecha: v.fecha,
                unidades: v.unidades,
                precio: v.precio,
                envioEstado: v.envioEstado || '',
                meliOrderId: v.meliOrderId || '',
            }
        }];
        return v;
    }

    function normalizeFbaInboundEstado(v) {
        const s = String(v || '').trim();
        // migrar claves viejas → nuevas
        const legacy = {
            por_preparar: 'por_enviar',
            empaquetado: 'en_transito',
            etiqueta: 'en_transito',
            listo: 'en_transito',
            enviado: 'recibido',
        };
        if (FBA_INBOUND_ESTADOS.includes(s)) return s;
        if (legacy[s]) return legacy[s];
        return '';
    }

    function setVentaEnvioEstado(lote, ventaId, estado, { notas = '' } = {}) {
        const idx = (lote.ventas || []).findIndex(x => x.id === ventaId);
        if (idx < 0) throw new Error('Venta no encontrada');
        const next = normalizeEnvioEstado(estado);
        const prev = lote.ventas[idx];
        const updated = {
            ...prev,
            envioEstado: next,
            envioNota: notas !== '' ? notas : (prev.envioNota || ''),
        };
        lote.ventas = lote.ventas.map((v, i) => (i === idx ? updated : v));
        lote.historial = [...(lote.historial || []), {
            ts: Date.now(),
            tipo: 'envio-prep',
            meta: {
                ventaId,
                from: prev.envioEstado || '',
                to: next,
                unidades: prev.unidades,
                notas: updated.envioNota || '',
            },
        }];
        return updated;
    }

    /** Estatus de mandar inventario al almacén FBA (no es envío al cliente). */
    function setLoteFbaInboundEstado(lote, estado, { notas = '' } = {}) {
        const next = normalizeFbaInboundEstado(estado);
        const from = lote.fbaInboundEstado || '';
        lote.fbaInboundEstado = next;
        lote.historial = [...(lote.historial || []), {
            ts: Date.now(),
            tipo: 'fba-inbound',
            meta: {
                from,
                to: next,
                notas: notas || '',
            },
        }];
        return lote;
    }

    function countPendingShipments(lote) {
        const tipo = String(lote.tipo || '').toUpperCase();
        if (tipo === 'FBA') {
            const e = lote.fbaInboundEstado || '';
            return e && e !== 'recibido' ? 1 : 0;
        }
        return (lote.ventas || []).filter(v => {
            const e = v.envioEstado;
            return e && e !== 'enviado';
        }).length;
    }

    function removeVenta(lote, ventaId) {
        const v = (lote.ventas || []).find(x => x.id === ventaId);
        lote.ventas = (lote.ventas || []).filter(x => x.id !== ventaId);
        lote.vendidas = syncVendidasFromVentas(lote);
        if (v) {
            lote.historial = [...(lote.historial || []), {
                ts: Date.now(),
                tipo: 'venta-cancelada',
                meta: { ventaId: v.id, fecha: v.fecha, unidades: v.unidades, precio: v.precio }
            }];
        }
        return lote;
    }

    /**
     * Reabastece el mismo SKU/lote: suma unidades y recalcula costo promedio ponderado.
     * Conserva ventas e historial.
     */
    function restockLote(lote, { unidades, costoUnitario, notas = '' } = {}) {
        const qty = Math.max(0, Math.round(Number(unidades) || 0));
        const costoNuevo = Number(costoUnitario);
        if (qty <= 0 || isNaN(costoNuevo) || costoNuevo < 0) {
            throw new Error('Cantidad o costo inválidos');
        }
        const udsPrev = Number(lote.unidades) || 0;
        const costoPrev = Number(lote.costo) || 0;
        const udsNext = udsPrev + qty;
        const costoPromedio = udsNext > 0
            ? ((costoPrev * udsPrev) + (costoNuevo * qty)) / udsNext
            : costoNuevo;

        lote.historial = [...(lote.historial || []), {
            ts: Date.now(),
            tipo: 'reabastecimiento',
            meta: {
                unidades: qty,
                costoUnitario: costoNuevo,
                costoAnterior: costoPrev,
                costoPromedio,
                unidadesAntes: udsPrev,
                unidadesDespues: udsNext,
                notas: notas || '',
            }
        }];
        lote.unidades = udsNext;
        lote.costo = Math.round(costoPromedio * 100) / 100;
        // Si estaba "sin stock" o agotado visualmente, reactivar
        const est = String(lote.estatus || '');
        if (est.includes('Sin stock') || est.includes('Finalizada')) {
            lote.estatus = '✅ Activa / En Venta';
        }
        lote.vendidas = syncVendidasFromVentas(lote);
        return lote;
    }

    /**
     * Baja de inventario (daño, venta fuera, merma, etc.): reduce unidades del lote
     * sin registrar venta. Nunca deja unidades por debajo de vendidas.
     */
    function writeOffLote(lote, { unidades, motivo = 'otro', notas = '' } = {}) {
        const qty = Math.max(0, Math.round(Number(unidades) || 0));
        if (qty <= 0) throw new Error('Indica cuántas piezas quitar');
        const udsPrev = Number(lote.unidades) || 0;
        const vendidas = syncVendidasFromVentas(lote);
        const stockDisp = Math.max(0, udsPrev - vendidas);
        if (qty > stockDisp) {
            throw new Error(`Solo hay ${stockDisp} disponible${stockDisp === 1 ? '' : 's'} (no puedes bajar por debajo de las vendidas)`);
        }
        const udsNext = udsPrev - qty;
        const costoUnit = Number(lote.costo) || 0;
        const valorPerdido = Math.round(costoUnit * qty * 100) / 100;
        const motivoKey = String(motivo || 'otro');
        lote.historial = [...(lote.historial || []), {
            ts: Date.now(),
            tipo: 'baja-inventario',
            meta: {
                unidades: qty,
                motivo: motivoKey,
                notas: notas || '',
                costoUnitario: costoUnit,
                valorPerdido,
                unidadesAntes: udsPrev,
                unidadesDespues: udsNext,
                stockDisponibleAntes: stockDisp,
                stockDisponibleDespues: stockDisp - qty,
            },
        }];
        lote.unidades = udsNext;
        lote.vendidas = vendidas;
        const stockAfter = udsNext - vendidas;
        if (stockAfter <= 0) {
            const est = String(lote.estatus || '');
            if (vendidas > 0) {
                if (est.includes('Activa') || est.includes('En Venta')) {
                    lote.estatus = '📦 Sin stock';
                }
            } else if (udsNext <= 0) {
                // Baja total sin ventas: archivar para que no figure como color activo
                lote.estatus = '❌ Finalizada';
            }
        }
        return lote;
    }

    /**
     * Merge por SKU.
     * mode:
     *  - 'catalog' (default): actualiza precios/catálogo; NO pisa unidades/costo/stock operativo
     *  - 'full': también actualiza costo y unidades desde Excel
     * Conserva id, productId, ventas, historial, imagen, gastoAds.
     */
    function mergeBySku(existing, incoming, { mode = 'catalog' } = {}) {
        const result = existing.map(l => ({ ...l }));
        let updated = 0;
        let added = 0;

        incoming.forEach(raw => {
            const inc = normalize(raw, result);
            const skuKey = String(inc.sku || '').trim().toLowerCase();
            if (!skuKey) {
                result.push(normalize({ ...inc, id: newId(), ventas: [], historial: [] }, result));
                added++;
                return;
            }
            const idx = result.findIndex(x => String(x.sku || '').trim().toLowerCase() === skuKey);
            if (idx >= 0) {
                const prev = result[idx];
                const base = {
                    ...prev,
                    producto: inc.producto || prev.producto,
                    variante: inc.variante || prev.variante,
                    categoria: inc.categoria || prev.categoria,
                    tipo: inc.tipo || prev.tipo,
                    fecha: inc.fecha || prev.fecha,
                    precioCompetencia: inc.precioCompetencia,
                    precio: inc.precio,
                    envio: inc.envio,
                    estatus: inc.estatus || prev.estatus,
                    id: prev.id,
                    productId: prev.productId,
                    imagen: prev.imagen || '',
                    gastoAds: prev.gastoAds || 0,
                    ventas: prev.ventas,
                    historial: prev.historial,
                };
                if (mode === 'full') {
                    base.costo = inc.costo;
                    base.unidades = inc.unidades;
                }
                // Si incoming trae ventas (p.ej. hoja Ventas), fusionar por id
                if (Array.isArray(inc.ventas) && inc.ventas.length) {
                    const ids = new Set((prev.ventas || []).map(v => v.id));
                    const extra = inc.ventas.filter(v => v.id && !ids.has(v.id));
                    base.ventas = [...(prev.ventas || []), ...extra];
                }
                result[idx] = normalize(base, result);
                updated++;
            } else {
                const sameName = result.find(s => productNameKey(s.producto) === productNameKey(inc.producto));
                result.push(normalize({
                    ...inc,
                    id: newId(),
                    productId: sameName ? sameName.productId : inc.productId,
                    ventas: Array.isArray(inc.ventas) ? inc.ventas : [],
                    historial: [],
                    vendidas: 0,
                }, result));
                added++;
            }
        });

        return { lotes: result, updated, added };
    }

    /** Adjunta ventas importadas (por SKU) a lotes existentes/nuevos. */
    function attachVentasBySku(lotes, ventasRows = []) {
        if (!ventasRows.length) return lotes;
        const bySku = new Map();
        ventasRows.forEach(v => {
            const key = String(v.sku || '').trim().toLowerCase();
            if (!key) return;
            if (!bySku.has(key)) bySku.set(key, []);
            bySku.get(key).push(v);
        });
        return lotes.map(l => {
            const key = String(l.sku || '').trim().toLowerCase();
            const rows = bySku.get(key);
            if (!rows || !rows.length) return l;
            const existingIds = new Set((l.ventas || []).map(x => x.id));
            const existingSig = new Set((l.ventas || []).map(x => `${x.fecha}|${x.unidades}|${x.precio}`));
            const add = [];
            rows.forEach(r => {
                const sig = `${r.fecha}|${r.unidades}|${r.precio}`;
                if (r.id && existingIds.has(r.id)) return;
                if (existingSig.has(sig)) return;
                add.push({
                    id: r.id || newId(),
                    fecha: r.fecha || new Date().toISOString().slice(0, 10),
                    unidades: Number(r.unidades) || 1,
                    precio: Number(r.precio) || 0,
                    notas: r.notas || '',
                });
            });
            if (!add.length) return l;
            const next = normalize({ ...l, ventas: [...(l.ventas || []), ...add] }, lotes);
            return next;
        });
    }

    function categorias(lotes) {
        return Array.from(new Set(lotes.map(l => l.categoria).filter(Boolean))).sort();
    }

    return {
        STORAGE_KEY,
        SETTINGS_KEY,
        MARKETPLACES,
        SEED,
        normalizeMarketplace,
        normalizeMpView,
        currentMarketplace,
        mpMeta,
        loadBothCatalogs,
        loadLotes,
        saveLotes,
        loadSettings,
        saveSettings,
        loadUI,
        saveUI,
        resetAll,
        clearVentasRestoreStock,
        newId,
        autoSku,
        normalize,
        migrateLotes,
        familyImage,
        setFamilyImage,
        upsertLote,
        deleteLote,
        duplicateLote,
        addVenta,
        removeVenta,
        setVentaEnvioEstado,
        setLoteFbaInboundEstado,
        countPendingShipments,
        ENVIO_ESTADOS,
        normalizeEnvioEstado,
        normalizeSku,
        normalizeVenta,
        hasMeliOrderLine,
        importMeliOrders,
        restockLote,
        writeOffLote,
        mergeBySku,
        attachVentasBySku,
        productNameKey,
        categorias,
    };
})();
window.Data = Data;

window.State = {
    marketplace: 'meli',
    lotes: [],
    settings: {},
    ui: {},
    view: 'dashboard',
    subscribers: new Set(),
    subscribe(fn) { this.subscribers.add(fn); return () => this.subscribers.delete(fn); },
    notify() { this.subscribers.forEach(fn => fn()); },
    save() { Data.saveLotes(this.lotes, this.marketplace); this.notify(); },
    saveSettings() { Data.saveSettings(this.settings, this.marketplace); this.notify(); },
    saveUI() { Data.saveUI(this.ui); },
    /** Cambia de marketplace guardando el catálogo activo y cargando el otro. */
    switchMarketplace(mp) {
        const next = Data.normalizeMarketplace(mp);
        if (next === this.marketplace) return;
        Data.saveLotes(this.lotes, this.marketplace);
        Data.saveSettings(this.settings, this.marketplace);
        this.marketplace = next;
        this.ui = { ...this.ui, marketplace: next };
        this.saveUI();
        this.lotes = Data.loadLotes(next);
        this.settings = Data.loadSettings(next);
        this.notify();
    },
};
