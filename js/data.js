/* ==========================================================================
   Modelo de datos + persistencia en localStorage.
   Estado global: window.State
   Schema de lote v3:
     id, productId, sku, producto, variante, tipo, fecha, categoria, notas,
     costo, unidades, precioCompetencia, precio, envio, vendidas, estatus,
     imagen,   // data URL JPEG comprimido; compartida por productId (familia)
     ventas:   [{ id, fecha, precio, unidades, notas }]
     historial:[{ ts, tipo, meta }]
   vendidas se deriva de ventas[] cuando hay eventos (una sola verdad).
   productId agrupa variantes del mismo producto (estable, no por typo de nombre).
   ========================================================================== */

const Data = (() => {

    const STORAGE_KEY = 'ventas-meli:v1';
    const SETTINGS_KEY = 'ventas-meli:settings:v1';
    const UI_KEY = 'ventas-meli:ui:v1';

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

    // Normaliza lote a schema v3.
    function normalize(l, siblings = []) {
        const ventas = Array.isArray(l.ventas) ? l.ventas : [];
        const out = {
            id: l.id || newId(),
            productId: resolveProductId(l, siblings),
            sku: l.sku || '',
            producto: l.producto || '',
            variante: l.variante || '',
            tipo: l.tipo || 'Clasica',
            fecha: l.fecha || new Date().toISOString().slice(0, 10),
            categoria: l.categoria || '',
            notas: l.notas || '',
            costo: Number(l.costo) || 0,
            unidades: Number(l.unidades) || 0,
            precioCompetencia: l.precioCompetencia != null && l.precioCompetencia !== '' ? Number(l.precioCompetencia) : null,
            precio: Number(l.precio) || 0,
            envio: Number(l.envio) || 0,
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
    function migrateLotes(rawList) {
        const byName = new Map();
        const out = [];
        rawList.forEach(raw => {
            const key = productNameKey(raw.producto);
            let productId = raw.productId;
            if (!productId && key && byName.has(key)) productId = byName.get(key);
            if (!productId) productId = 'p-' + newId();
            if (key) byName.set(key, productId);
            out.push(normalize({ ...raw, productId }, out));
        });
        return out;
    }

    function loadLotes() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                const seed = SEED.map((l, i, arr) => normalize(l, arr.slice(0, i)));
                saveLotes(seed);
                return seed;
            }
            const migrated = migrateLotes(JSON.parse(raw));
            saveLotes(migrated); // persiste productIds
            return migrated;
        } catch (e) {
            console.error('Error cargando lotes:', e);
            return SEED.map((l, i, arr) => normalize(l, arr.slice(0, i)));
        }
    }

    function saveLotes(lotes) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lotes));
    }

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return { ...Calc.DEFAULT_SETTINGS };
            return { ...Calc.DEFAULT_SETTINGS, ...JSON.parse(raw) };
        } catch (e) {
            return { ...Calc.DEFAULT_SETTINGS };
        }
    }

    function saveSettings(settings) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function loadUI() {
        try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); }
        catch { return {}; }
    }
    function saveUI(ui) {
        localStorage.setItem(UI_KEY, JSON.stringify(ui));
    }

    function resetAll() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(SETTINGS_KEY);
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
    function addVenta(lote, venta) {
        const v = {
            id: newId(),
            fecha: venta.fecha || new Date().toISOString().slice(0, 10),
            precio: Number(venta.precio) || Number(lote.precio) || 0,
            unidades: Number(venta.unidades) || 1,
            notas: venta.notas || '',
        };
        lote.ventas = [...(lote.ventas || []), v];
        lote.vendidas = syncVendidasFromVentas(lote);
        lote.historial = [...(lote.historial || []), {
            ts: Date.now(),
            tipo: 'venta',
            meta: { ventaId: v.id, fecha: v.fecha, unidades: v.unidades, precio: v.precio }
        }];
        return v;
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
     * Merge por SKU: actualiza campos de catálogo/precio del existente;
     * conserva id, productId, ventas e historial. SKUs nuevos se agregan.
     * Returns { lotes, updated, added }.
     */
    function mergeBySku(existing, incoming) {
        const result = existing.map(l => ({ ...l }));
        let updated = 0;
        let added = 0;

        incoming.forEach(raw => {
            const inc = normalize(raw, result);
            const skuKey = String(inc.sku || '').trim().toLowerCase();
            if (!skuKey) {
                // Sin SKU: agregar como nuevo
                result.push(normalize({ ...inc, id: newId(), ventas: [], historial: [] }, result));
                added++;
                return;
            }
            const idx = result.findIndex(x => String(x.sku || '').trim().toLowerCase() === skuKey);
            if (idx >= 0) {
                const prev = result[idx];
                const merged = normalize({
                    ...prev,
                    // Campos que vienen del Excel (catálogo)
                    producto: inc.producto || prev.producto,
                    variante: inc.variante || prev.variante,
                    categoria: inc.categoria || prev.categoria,
                    tipo: inc.tipo || prev.tipo,
                    fecha: inc.fecha || prev.fecha,
                    costo: inc.costo,
                    unidades: inc.unidades,
                    precioCompetencia: inc.precioCompetencia,
                    precio: inc.precio,
                    envio: inc.envio,
                    estatus: inc.estatus || prev.estatus,
                    // Conservar identidad y eventos
                    id: prev.id,
                    productId: prev.productId,
                    imagen: prev.imagen || '',
                    ventas: prev.ventas,
                    historial: prev.historial,
                    // vendidas se recalcula desde ventas
                }, result);
                result[idx] = merged;
                updated++;
            } else {
                // Nuevo SKU: heredar productId si el nombre ya existe
                const sameName = result.find(s => productNameKey(s.producto) === productNameKey(inc.producto));
                result.push(normalize({
                    ...inc,
                    id: newId(),
                    productId: sameName ? sameName.productId : inc.productId,
                    ventas: [],
                    historial: [],
                    vendidas: 0,
                }, result));
                added++;
            }
        });

        return { lotes: result, updated, added };
    }

    function categorias(lotes) {
        return Array.from(new Set(lotes.map(l => l.categoria).filter(Boolean))).sort();
    }

    return {
        STORAGE_KEY,
        SETTINGS_KEY,
        SEED,
        loadLotes,
        saveLotes,
        loadSettings,
        saveSettings,
        loadUI,
        saveUI,
        resetAll,
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
        restockLote,
        mergeBySku,
        productNameKey,
        categorias,
    };
})();

window.State = {
    lotes: [],
    settings: {},
    ui: {},
    view: 'lotes',
    subscribers: new Set(),
    subscribe(fn) { this.subscribers.add(fn); return () => this.subscribers.delete(fn); },
    notify() { this.subscribers.forEach(fn => fn()); },
    save() { Data.saveLotes(this.lotes); this.notify(); },
    saveSettings() { Data.saveSettings(this.settings); this.notify(); },
    saveUI() { Data.saveUI(this.ui); },
};
