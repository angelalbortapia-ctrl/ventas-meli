/* ==========================================================================
   Modelo de datos + persistencia en localStorage.
   Estado global: window.State
   Schema de lote v3:
     id, productId, sku, producto, variante, tipo, fecha, categoria, notas,
     costo, unidades, precioCompetencia, precio, envio, vendidas, estatus,
     imagen,   // data URL JPEG comprimido; compartida por productId (familia)
     ventas:   [{ id, fecha, precio, unidades, notas, envioEstado?, meliOrderId?, meliItemId?,
                  cobroEstado: 'pendiente'|'cobrado', cobradoAt?,
                  asignacion?: { reinversion, reserva, ads, insumos, utilidad, asignadoAt } }]
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

    // Compat exports removidos: STORAGE_KEY / SETTINGS_KEY (usar MARKETPLACES)

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

    const ALLOC_KEYS = ['reinversion', 'reserva', 'ads', 'insumos', 'utilidad'];

    function roundMoney(n) {
        return Math.round((Number(n) || 0) * 100) / 100;
    }

    function emptyAsignacionBuckets() {
        return { reinversion: 0, reserva: 0, ads: 0, insumos: 0, utilidad: 0 };
    }

    function normalizeAsignacion(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const buckets = emptyAsignacionBuckets();
        let any = false;
        ALLOC_KEYS.forEach(k => {
            const n = Number(raw[k]);
            if (Number.isFinite(n) && n > 0) {
                buckets[k] = roundMoney(n);
                any = true;
            }
        });
        const asignadoAt = raw.asignadoAt != null ? raw.asignadoAt : null;
        const legacy = !!raw.legacy;
        if (!any && !asignadoAt && !legacy) return null;
        const out = { ...buckets };
        if (asignadoAt != null) out.asignadoAt = asignadoAt;
        if (legacy) out.legacy = true;
        return out;
    }

    function hasAsignacion(v) {
        if (!v?.asignacion || typeof v.asignacion !== 'object') return false;
        if (v.asignacion.asignadoAt != null || v.asignacion.legacy) return true;
        return ALLOC_KEYS.some(k => (Number(v.asignacion[k]) || 0) > 0);
    }

    /** Ventas sin cobroEstado (historial) → cobrado; nuevas usan pendiente vía addVenta. */
    function normalizeCobroEstado(v) {
        if (v === 'pendiente' || v === 'cobrado') return v;
        return 'cobrado';
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
            cobroEstado: normalizeCobroEstado(v.cobroEstado),
        };
        // Costo al momento de la venta (congela P&L ante reabastecimientos)
        if (v.costoUnitario != null && Number.isFinite(Number(v.costoUnitario))) {
            out.costoUnitario = Math.max(0, Number(v.costoUnitario));
        }
        const feeSnap = normalizeFeeSnap(v.feeSnap);
        if (feeSnap) out.feeSnap = feeSnap;
        if (v.cobradoAt) out.cobradoAt = v.cobradoAt;
        const asig = normalizeAsignacion(v.asignacion);
        if (asig) out.asignacion = asig;
        const oid = v.meliOrderId != null && v.meliOrderId !== '' ? String(v.meliOrderId) : '';
        const iid = v.meliItemId != null && v.meliItemId !== '' ? String(v.meliItemId) : '';
        if (oid) out.meliOrderId = oid;
        if (iid) out.meliItemId = iid;
        return out;
    }

    /** Snapshot de fees/logística al vender (editar lote no reescribe P&L histórico). */
    function snapshotFeeInputs(lote) {
        const peso = Number(lote?.pesoKg);
        return {
            envio: Math.max(0, Number(lote?.envio) || 0),
            almacenamiento: Math.max(0, Number(lote?.almacenamiento) || 0),
            varios: Math.max(0, Number(lote?.varios) || 0),
            tipo: lote?.tipo || '',
            categoriaAmazon: lote?.categoriaAmazon || '',
            pesoKg: Number.isFinite(peso) ? peso : null,
            tamanoFba: lote?.tamanoFba || '',
        };
    }

    function normalizeFeeSnap(snap) {
        if (!snap || typeof snap !== 'object') return null;
        const peso = Number(snap.pesoKg);
        const out = {
            envio: Math.max(0, Number(snap.envio) || 0),
            almacenamiento: Math.max(0, Number(snap.almacenamiento) || 0),
            varios: Math.max(0, Number(snap.varios) || 0),
            tipo: snap.tipo != null ? String(snap.tipo) : '',
            categoriaAmazon: snap.categoriaAmazon != null ? String(snap.categoriaAmazon) : '',
            tamanoFba: snap.tamanoFba != null ? String(snap.tamanoFba) : '',
        };
        if (Number.isFinite(peso)) out.pesoKg = peso;
        return out;
    }

    /** Costo unitario de la venta (congelado) o el del lote actual. */
    function ventaCostoUnitario(lote, venta) {
        const frozen = Number(venta?.costoUnitario);
        if (Number.isFinite(frozen) && frozen >= 0) return frozen;
        return Math.max(0, Number(lote?.costo) || 0);
    }

    /** Lote con costo + inputs de fee de la venta (para utilidad/P&L histórico). */
    function loteForVentaCalc(lote, venta) {
        const costo = ventaCostoUnitario(lote, venta);
        const snap = normalizeFeeSnap(venta?.feeSnap);
        if (!snap) return { ...lote, costo };
        const next = {
            ...lote,
            costo,
            envio: snap.envio,
            almacenamiento: snap.almacenamiento,
            varios: snap.varios,
        };
        if (snap.tipo) next.tipo = snap.tipo;
        if (snap.categoriaAmazon) next.categoriaAmazon = snap.categoriaAmazon;
        if (snap.pesoKg != null) next.pesoKg = snap.pesoKg;
        if (snap.tamanoFba) next.tamanoFba = snap.tamanoFba;
        return next;
    }

    /** Monto que se reparte en bolsitas: costo recuperado + utilidad neta × uds (≥ 0). */
    function ventaLiberacionAmount(lote, venta, settings = window.State?.settings) {
        const uds = Math.max(0, Number(venta?.unidades) || 0);
        const precio = Number(venta?.precio) || 0;
        if (uds <= 0 || precio <= 0) return 0;
        const loteAt = loteForVentaCalc(lote, venta);
        const costo = Number(loteAt.costo) || 0;
        let utilidad = 0;
        try {
            utilidad = Number(Calc.utilidadAtPrice(loteAt, precio, settings).utilidad) || 0;
        } catch { utilidad = 0; }
        return roundMoney(Math.max(0, (costo + utilidad) * uds));
    }

    function sumAsignacion(splits) {
        return roundMoney(ALLOC_KEYS.reduce((s, k) => s + (Number(splits?.[k]) || 0), 0));
    }

    /**
     * Si la venta ya está en el ledger de bolsitas pero sin asignacion en el objeto,
     * copia splits → asignacion (migración suave del historial).
     */
    function hydrateCobroFromLedger(lotes, mp = currentMarketplace()) {
        const market = normalizeMarketplace(mp);
        const store = window.State?.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc[market]
            : null;
        const ledger = Array.isArray(store?.ledger) ? store.ledger : [];
        const byVenta = new Map();
        ledger.forEach(e => {
            if (e?.type === 'sale' && e.meta?.ventaId) byVenta.set(String(e.meta.ventaId), e);
        });
        if (!byVenta.size) return false;
        let changed = false;
        (lotes || []).forEach(lote => {
            if (!Array.isArray(lote.ventas)) return;
            lote.ventas = lote.ventas.map(v => {
                if (hasAsignacion(v)) return v;
                const entry = byVenta.get(String(v.id));
                if (!entry) return v;
                const asig = normalizeAsignacion({
                    ...emptyAsignacionBuckets(),
                    ...entry.splits,
                    asignadoAt: entry.at || Date.now(),
                });
                changed = true;
                return {
                    ...v,
                    cobroEstado: 'cobrado',
                    cobradoAt: v.cobradoAt || entry.meta?.fecha || null,
                    asignacion: asig,
                };
            });
        });
        return changed;
    }

    function listVentasCobro(lotes = window.State?.lotes, settings = window.State?.settings) {
        const porCobrar = [];
        const porAsignar = [];
        const historial = [];
        (lotes || []).forEach(lote => {
            (lote.ventas || []).forEach(v => {
                const amount = ventaLiberacionAmount(lote, v, settings);
                const saleTotal = roundMoney((Number(v.precio) || 0) * (Number(v.unidades) || 0));
                const row = {
                    ventaId: v.id,
                    loteId: lote.id,
                    fecha: v.fecha,
                    producto: lote.producto || lote.sku || 'Producto',
                    variante: lote.variante || '',
                    sku: lote.sku || '',
                    unidades: Number(v.unidades) || 0,
                    precio: Number(v.precio) || 0,
                    saleTotal,
                    amount,
                    cobroEstado: normalizeCobroEstado(v.cobroEstado),
                    cobradoAt: v.cobradoAt || null,
                    asignacion: hasAsignacion(v) ? v.asignacion : null,
                    notas: v.notas || '',
                };
                if (row.cobroEstado === 'pendiente') porCobrar.push(row);
                else if (!row.asignacion) porAsignar.push(row);
                else historial.push(row);
            });
        });
        const byFechaDesc = (a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''));
        porCobrar.sort(byFechaDesc);
        porAsignar.sort(byFechaDesc);
        historial.sort((a, b) => {
            const ta = Number(a.asignacion?.asignadoAt) || 0;
            const tb = Number(b.asignacion?.asignadoAt) || 0;
            if (tb !== ta) return tb - ta;
            return byFechaDesc(a, b);
        });
        return { porCobrar, porAsignar, historial };
    }

    function cobroPendingCount(lotes = window.State?.lotes, settings = window.State?.settings) {
        const { porCobrar, porAsignar } = listVentasCobro(lotes, settings);
        return porCobrar.length + porAsignar.length;
    }

    function cobroKpis(lotes = window.State?.lotes, settings = window.State?.settings) {
        const { porCobrar, porAsignar, historial } = listVentasCobro(lotes, settings);
        const sumAmt = (arr) => roundMoney(arr.reduce((s, r) => s + (r.amount || 0), 0));
        const sumSale = (arr) => roundMoney(arr.reduce((s, r) => s + (r.saleTotal || 0), 0));
        return {
            ventasTotal: sumSale([...porCobrar, ...porAsignar, ...historial]),
            porCobrarN: porCobrar.length,
            porCobrarAmt: sumAmt(porCobrar),
            porAsignarN: porAsignar.length,
            porAsignarAmt: sumAmt(porAsignar),
            asignadoN: historial.length,
            asignadoAmt: sumAmt(historial),
        };
    }

    /**
     * Marca cobrado (si hace falta) y reparte en bolsitas.
     * splits debe sumar el monto de liberación (tolerancia 2 centavos).
     */
    function asignarVentaABolsitas(lote, ventaId, splits, { settings = window.State?.settings } = {}) {
        const idx = (lote.ventas || []).findIndex(x => x.id === ventaId);
        if (idx < 0) throw new Error('Venta no encontrada');
        const prev = lote.ventas[idx];
        if (hasAsignacion(prev)) throw new Error('Esta venta ya está asignada a bolsitas');
        const expected = ventaLiberacionAmount(lote, prev, settings);
        const cleaned = emptyAsignacionBuckets();
        if (expected > 0.009) {
            ALLOC_KEYS.forEach(k => {
                const n = Number(splits?.[k]);
                cleaned[k] = Number.isFinite(n) && n > 0 ? roundMoney(n) : 0;
            });
            const total = sumAsignacion(cleaned);
            if (Math.abs(total - expected) > 0.02) {
                throw new Error(`La suma (${total}) no cuadra con ${expected}`);
            }
        }
        // Liberación 0 (venta a pérdida / fees ≥ precio): marca cobrado sin mover bolsitas
        const total = sumAsignacion(cleaned);
        const asignadoAt = Date.now();
        const cobradoAt = prev.cobradoAt || new Date().toISOString();
        const updated = {
            ...prev,
            cobroEstado: 'cobrado',
            cobradoAt,
            asignacion: { ...cleaned, asignadoAt },
        };
        lote.ventas = lote.ventas.map((v, i) => (i === idx ? updated : v));
        lote.historial = [...(lote.historial || []), {
            ts: asignadoAt,
            tipo: 'asignacion-bolsitas',
            meta: { ventaId, amount: total, splits: cleaned },
        }];

        const entry = window.DashboardView?.applySaleLiberationWithSplits?.(total, cleaned, {
            ventaId,
            loteId: lote.id,
            unidades: prev.unidades,
            precio: prev.precio,
            fecha: prev.fecha,
        });
        return { venta: updated, entry, amount: total };
    }

    // Normaliza lote a schema v3 (+ campos Amazon MX).
    // `mp` debe ser el catálogo dueño del lote (nunca el marketplace “activo” por accidente).
    function normalize(l, siblings = [], mp = currentMarketplace()) {
        const market = normalizeMarketplace(mp);
        const defaultTipo = market === 'amazon' ? 'FBA' : 'Clasica';
        const ventas = Array.isArray(l.ventas) ? l.ventas.map(normalizeVenta) : [];
        const pesoRaw = l.pesoKg;
        let pesoKg = pesoRaw != null && pesoRaw !== '' && !isNaN(Number(pesoRaw))
            ? Number(pesoRaw)
            : null;
        // Si alguien pone gramos (p.ej. 907 g → 907), la tabla FBA explota.
        // FBA estándar/grande en esta app no usa >50 kg; valores mayores = gramos.
        if (pesoKg != null && pesoKg > 50) pesoKg = pesoKg / 1000;
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
            // Wishlist / arbitraje (opcionales)
            asin: String(l.asin || '').trim().toUpperCase(),
            linkCompra: String(l.linkCompra || '').trim(),
            linkAmazon: String(l.linkAmazon || '').trim(),
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
     * - Chocolate Alquimia 400g (CHOC-ALQ-400) $449 → alm 1.09 · utilidad ~$139.36
     * - COCOLI aceite coco $445 → alm 0.84 · varios 1 · utilidad $156.18
     * - Okko Hemp 1 kg (OKKO) $399 → alm 1.02 · peso ~1.1 · utilidad $45.11
     * - Pragná Sal Himalaya $169 → alm 0.68 · peso ~1.8 · utilidad $39.06
     * - Avena Farmers We Know 2.27 kg (AVENA) $279 → alm 3.90 · peso ~2.6 · utilidad $33.57
     * - St. Genéve Jabón Líquido (LAVA) $298 → alm 3.51 · peso ~4.1 · utilidad $48.60
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
            // Ojo: no matchear solo por costo 295.64 (lo comparte Okko a $399)
            const isPrasada = name.includes('prasada')
                || (Math.abs(precio - 439) < 0.01 && Math.abs(costo - 295.64) < 0.02);
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

            // Chocolate Sin Azúcar Keto Barks Alquimia 400g (CHOC-ALQ-400)
            // Calculadora Amazon MX: referido $46.45 · FBA $14.90 · alm $1.09
            // (antes caía en Hogar 15% + FBA general $53 — no cuadra)
            const isChocAlq = sku === 'CHOC-ALQ-400'
                || sku.includes('CHOC-ALQ')
                || (name.includes('chocolate') && name.includes('alquimia'))
                || (name.includes('keto') && name.includes('barks'))
                || (name.includes('chocolate') && name.includes('sin azucar') && Math.abs(precio - 449) < 0.01)
                || (Math.abs(precio - 449) < 0.01 && Math.abs(costo - 247.2) < 0.05);
            if (isChocAlq) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                const ok = cat === 'alimentacion'
                    && envio === 0
                    && varios === 0
                    && Math.abs(alm - 1.09) < 0.01
                    && peso > 0.4 && peso <= 0.5;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: 'estandar',
                    // 400 g producto; Calculadora cobra tramo ≤0.5 kg ($14.90 en banda $299–499)
                    pesoKg: (peso > 0.4 && peso <= 0.5) ? peso : 0.5,
                    almacenamiento: 1.09,
                    varios: 0,
                    envio: 0,
                }, [], 'amazon');
            }

            // COCOLI — Aceite de coco orgánico EV $445 (Calculadora Amazon MX)
            // Referido $46.03 · FBA essentials ~1.66 kg $16.85 · alm $0.84 · varios $1 → $156.18
            const isCocoli = sku === 'COCOLI'
                || (name.includes('aceite') && name.includes('coco') && name.includes('organico') && Math.abs(precio - 445) < 0.01)
                || (name.includes('aceite') && name.includes('coco') && Math.abs(precio - 445) < 0.01 && Math.abs(costo - 224.1) < 0.05)
                || (Math.abs(precio - 445) < 0.01 && Math.abs(costo - 224.1) < 0.05);
            if (isCocoli) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                const ok = cat === 'alimentacion'
                    && envio === 0
                    && Math.abs(varios - 1) < 0.01
                    && Math.abs(alm - 0.84) < 0.01
                    && peso >= 1.5 && peso <= 1.75;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: 'estandar',
                    // Calculadora usa $16.85 → tramo essentials ~1.51–1.75 kg
                    pesoKg: (peso >= 1.5 && peso <= 1.75) ? peso : 1.66,
                    almacenamiento: 0.84,
                    varios: 1,
                    envio: 0,
                }, [], 'amazon');
            }

            // Okko Hemp Orgánico Semillas 1 kg (OKKO) — Calculadora Amazon MX
            // $399: referido 12% sin IVA $41.28 · FBA essentials >1 kg $15.95 · alm $1.02 → $45.11
            const isOkko = sku === 'OKKO'
                || (name.includes('okko') && (name.includes('hemp') || name.includes('semilla')))
                || (name.includes('semillas') && name.includes('hemp'))
                || (name.includes('hemp') && name.includes('organico'))
                || (Math.abs(precio - 399) < 0.01 && Math.abs(costo - 295.64) < 0.02)
                || (Math.abs(precio - 469) < 0.01 && Math.abs(costo - 305.87) < 0.02);
            if (isOkko) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                // Snapshot vigente ($399): alm 1.02. Si aún está a $469, conservar 1.68.
                const almTarget = Math.abs(precio - 469) < 0.01 ? 1.68 : 1.02;
                const ok = cat === 'alimentacion'
                    && envio === 0
                    && varios === 0
                    && Math.abs(alm - almTarget) < 0.01
                    && peso > 1 && peso <= 1.25;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: 'estandar',
                    // 1.0 kg exacto cobra $15.40; Calculadora usa $15.95 → tramo 1.01–1.25
                    pesoKg: (peso > 1 && peso <= 1.25) ? peso : 1.1,
                    almacenamiento: almTarget,
                    varios: 0,
                    envio: 0,
                }, [], 'amazon');
            }

            // Pragná Sal del Himalaya — Calculadora Amazon MX
            // $169: referido $17.48 · FBA essentials ~1.8 kg $8.20 · alm $0.68 → $39.06
            const isSalHimalaya = sku.includes('HIMAL')
                || (name.includes('himalaya') && name.includes('sal'))
                || (name.includes('pragna') && name.includes('sal') && !name.includes('canela') && !name.includes('cajun'))
                || (Math.abs(precio - 169) < 0.01 && Math.abs(costo - 103.58) < 0.05);
            if (isSalHimalaya) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                const ok = cat === 'alimentacion'
                    && envio === 0
                    && varios === 0
                    && Math.abs(alm - 0.68) < 0.01
                    && peso > 1.75 && peso <= 2.0;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: 'estandar',
                    // $8.20 = 7.00 + 4×0.30 → tramo essentials 1.76–2.0 kg (banda $150–299)
                    pesoKg: (peso > 1.75 && peso <= 2.0) ? peso : 1.8,
                    almacenamiento: 0.68,
                    varios: 0,
                    envio: 0,
                }, [], 'amazon');
            }

            // Hojuelas de avena orgánica Farmers We Know 2.27 kg (AVENA)
            // Calculadora Amazon MX $279: referido $28.86 · FBA $9.10 · alm $3.90 → $33.57
            const isAvena = sku === 'AVENA'
                || (name.includes('avena') && (name.includes('hojuela') || name.includes('farmers') || name.includes('germinada')))
                || (name.includes('avena') && Math.abs(costo - 203.57) < 0.05)
                || (Math.abs(precio - 279) < 0.01 && Math.abs(costo - 203.57) < 0.05)
                || (Math.abs(precio - 283) < 0.01 && Math.abs(costo - 203.57) < 0.05);
            if (isAvena) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                const ok = cat === 'alimentacion'
                    && envio === 0
                    && varios === 0
                    && Math.abs(alm - 3.90) < 0.01
                    && peso >= 2.51 && peso <= 2.75;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: 'estandar',
                    // Etiqueta 2.27 kg → tabla da $8.80; Calculadora cobra $9.10 → tramo 2.51–2.75
                    pesoKg: (peso >= 2.51 && peso <= 2.75) ? peso : 2.6,
                    almacenamiento: 3.90,
                    varios: 0,
                    envio: 0,
                }, [], 'amazon');
            }

            // Member's Mark Almendras Naturales 907 g (ALME) — Calculadora Amazon MX
            // $253: referido 12% sin IVA $26.17 · FBA essentials ≤1 kg $6.90 · alm $0.87 → $71.20 (28.14%)
            // Bug típico: peso 907 (gramos) se leía como 907 kg → FBA ~$1,094.
            const isAlmendras = sku === 'ALME'
                || (name.includes('almendra') && (name.includes('member') || Math.abs(precio - 253) < 0.01))
                || (Math.abs(precio - 253) < 0.01 && Math.abs(costo - 147.86) < 0.02);
            if (isAlmendras) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                const ok = cat === 'alimentacion'
                    && envio === 0
                    && varios === 0
                    && Math.abs(alm - 0.87) < 0.01
                    && peso > 0.9 && peso <= 1.0;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: 'estandar',
                    // 907 g → 0.907 kg → essentials banda $150–299 = $6.90
                    pesoKg: (peso > 0.9 && peso <= 1.0) ? peso : 0.907,
                    almacenamiento: 0.87,
                    varios: 0,
                    envio: 0,
                }, [], 'amazon');
            }

            // Member's Mark Sustituto de Crema para Café 1 kg — Calculadora Amazon MX
            // $139: referido 12% sin IVA $14.38 · FBA essentials 1.01–1.25 kg $6.15 · alm $0.99 → $29.14 (20.96%)
            // App lo tenía en Hogar (15% + FBA general) → utilidad ~$4.
            const isMembersMarkCrema = (name.includes('member') && (name.includes('crema') || name.includes('cafe') || name.includes('sustituto')))
                || (name.includes('sustituto') && name.includes('crema') && name.includes('cafe'))
                || (Math.abs(precio - 139) < 0.01 && Math.abs(costo - 88.34) < 0.02);
            if (isMembersMarkCrema) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                const ok = cat === 'alimentacion'
                    && envio === 0
                    && varios === 0
                    && Math.abs(alm - 0.99) < 0.01
                    && peso > 1 && peso <= 1.25;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Alimentación y Gourmet',
                    categoriaAmazon: 'alimentacion',
                    tamanoFba: 'estandar',
                    // $6.15 = 6.00 + 1×0.15 → essentials tramo 1.01–1.25 kg (banda <$150)
                    pesoKg: (peso > 1 && peso <= 1.25) ? peso : 1.1,
                    almacenamiento: 0.99,
                    varios: 0,
                    envio: 0,
                }, [], 'amazon');
            }

            // Member's Mark Jabón Líquido 2 botellas — Calculadora Amazon MX
            // $345: referido 15% sin IVA $44.61 · FBA general 2.5 kg $70.50 · alm $1.31 → $76.08 (22.05%)
            // Peso físico ~2 kg da $67; la Calculadora usa peso de envío ~2.5 kg.
            const isMembersMarkJabon = sku === 'JABO'
                || (name.includes('member') && name.includes('jabon'))
                || (name.includes('members mark') && (name.includes('jabon') || name.includes('botella')))
                || (Math.abs(precio - 345) < 0.01 && Math.abs(costo - 152.5) < 0.05
                    && (name.includes('jabon') || name.includes('botella')));
            if (isMembersMarkJabon) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const peso = Number(l.pesoKg) || 0;
                const ok = envio === 0
                    && varios === 0
                    && Math.abs(alm - 1.31) < 0.01
                    && Math.abs(peso - 2.5) < 0.01;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    tamanoFba: 'estandar',
                    // $70.50 = 60 + 6×1.75 → tramo general 2.26–2.50 kg (banda $299–499)
                    pesoKg: (peso > 2.25 && peso <= 2.5) ? peso : 2.5,
                    almacenamiento: 1.31,
                    varios: 0,
                    envio: 0,
                }, [], 'amazon');
            }

            // St. Genéve Jabón Líquido (LAVA) — Calculadora Amazon MX
            // $298: referido 15% sin IVA $38.53 · FBA general ~4.1 kg $54.95 · alm $3.51 → $48.60
            // (NO es Alimentación: va a Belleza → FBA tabla general)
            const isLava = sku === 'LAVA'
                || (name.includes('geneve') && name.includes('jabon'))
                || (name.includes('st.') && name.includes('jabon'))
                || (name.includes('jabon') && name.includes('liquido') && Math.abs(costo - 152.41) < 0.05)
                || (Math.abs(precio - 298) < 0.01 && Math.abs(costo - 152.41) < 0.05)
                || (Math.abs(precio - 309) < 0.01 && Math.abs(costo - 152.41) < 0.05);
            if (isLava) {
                const alm = Number(l.almacenamiento) || 0;
                const varios = Number(l.varios) || 0;
                const envio = Number(l.envio) || 0;
                const cat = String(l.categoriaAmazon || '').toLowerCase();
                const peso = Number(l.pesoKg) || 0;
                const ok = cat === 'belleza'
                    && envio === 0
                    && varios === 0
                    && Math.abs(alm - 3.51) < 0.01
                    && peso > 4 && peso <= 4.25;
                if (ok) return l;
                changed = true;
                return normalize({
                    ...l,
                    tipo: 'FBA',
                    categoria: 'Belleza',
                    categoriaAmazon: 'belleza',
                    tamanoFba: 'estandar',
                    // $54.95 = 40 + 13×1.15 → tramo general 4.01–4.25 kg (banda $150–299)
                    pesoKg: (peso > 4 && peso <= 4.25) ? peso : 4.1,
                    almacenamiento: 3.51,
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

    function peekLotes(mp = currentMarketplace()) {
        const meta = mpMeta(mp);
        try {
            const raw = localStorage.getItem(meta.lotesKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function loadLotes(mp = currentMarketplace()) {
        const meta = mpMeta(mp);
        try {
            const raw = localStorage.getItem(meta.lotesKey);
            if (!raw) {
                // Amazon (y cualquier catálogo sin seed): NO materializar [] en storage.
                // Eso hacía que Sync empacara Amazon vacío y luego la nube borrara lo local.
                if (!meta.useSeed) return [];
                const seed = SEED.map((l, i, arr) => normalize(l, arr.slice(0, i), mp));
                saveLotes(seed, mp);
                return seed;
            }
            const migrated = migrateLotes(JSON.parse(raw), mp);
            saveLotes(migrated, mp); // persiste productIds / align
            return migrated;
        } catch (e) {
            console.error('Error cargando lotes:', e);
            if (!meta.useSeed) return [];
            return SEED.map((l, i, arr) => normalize(l, arr.slice(0, i), mp));
        }
    }

    function saveLotes(lotes, mp = currentMarketplace()) {
        const id = normalizeMarketplace(mp);
        let list = Array.isArray(lotes) ? lotes : [];
        if (id === 'amazon' && list.length) {
            list = alignAmazonRevenueCalcLotes(list);
        }
        localStorage.setItem(mpMeta(id).lotesKey, JSON.stringify(list));
        return list;
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
            // Congela costo + fees al vender (restock / editar lote no reescribe P&L)
            costoUnitario: venta.costoUnitario != null
                ? venta.costoUnitario
                : (Number(lote.costo) || 0),
            feeSnap: venta.feeSnap || snapshotFeeInputs(lote),
            // Preparación de envío (FBM / Easy Ship): por_preparar → empaquetado → etiqueta → listo → enviado
            envioEstado: venta.envioEstado,
            envioNota: venta.envioNota || '',
            meliOrderId: venta.meliOrderId,
            meliItemId: venta.meliItemId,
            // Cash en camino: cobro + bolsitas viven en Caja
            cobroEstado: venta.cobroEstado === 'cobrado' ? 'cobrado' : 'pendiente',
            cobradoAt: venta.cobradoAt,
            asignacion: venta.asignacion,
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
                cobroEstado: v.cobroEstado || 'pendiente',
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
            const skuKey = normalizeSku(inc.sku);
            if (!skuKey) {
                result.push(normalize({ ...inc, id: newId(), ventas: [], historial: [] }, result));
                added++;
                return;
            }
            const idx = result.findIndex(x => normalizeSku(x.sku) === skuKey);
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
            const key = normalizeSku(v.sku);
            if (!key) return;
            if (!bySku.has(key)) bySku.set(key, []);
            bySku.get(key).push(v);
        });
        return lotes.map(l => {
            const key = normalizeSku(l.sku);
            const rows = bySku.get(key);
            if (!rows || !rows.length) return l;
            const existingIds = new Set((l.ventas || []).map(x => x.id));
            const existingSig = new Set((l.ventas || []).map(x => `${x.fecha}|${x.unidades}|${x.precio}`));
            const add = [];
            rows.forEach(r => {
                const sig = `${r.fecha}|${r.unidades}|${r.precio}`;
                if (r.id && existingIds.has(r.id)) return;
                if (existingSig.has(sig)) return;
                add.push(normalizeVenta({
                    id: r.id || newId(),
                    fecha: r.fecha || new Date().toISOString().slice(0, 10),
                    unidades: Number(r.unidades) || 1,
                    precio: Number(r.precio) || 0,
                    notas: r.notas || '',
                    costoUnitario: r.costoUnitario != null ? r.costoUnitario : (Number(l.costo) || 0),
                    feeSnap: r.feeSnap || snapshotFeeInputs(l),
                    cobroEstado: r.cobroEstado || 'cobrado',
                }));
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
        MARKETPLACES,
        SEED,
        normalizeMarketplace,
        normalizeMpView,
        currentMarketplace,
        mpMeta,
        loadBothCatalogs,
        loadLotes,
        peekLotes,
        saveLotes,
        loadSettings,
        saveSettings,
        loadUI,
        saveUI,
        clearVentasRestoreStock,
        newId,
        autoSku,
        normalize,
        migrateLotes,
        alignAmazonRevenueCalcLotes,
        familyImage,
        setFamilyImage,
        upsertLote,
        deleteLote,
        duplicateLote,
        addVenta,
        removeVenta,
        setVentaEnvioEstado,
        asignarVentaABolsitas,
        hydrateCobroFromLedger,
        listVentasCobro,
        cobroPendingCount,
        cobroKpis,
        ventaLiberacionAmount,
        ventaCostoUnitario,
        loteForVentaCalc,
        hasAsignacion,
        emptyAsignacionBuckets,
        sumAsignacion,
        setLoteFbaInboundEstado,
        countPendingShipments,
        ENVIO_ESTADOS,
        normalizeEnvioEstado,
        normalizeSku,
        normalizeVenta,
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
    save() {
        this.lotes = Data.saveLotes(this.lotes, this.marketplace) || this.lotes;
        this.notify();
    },
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
