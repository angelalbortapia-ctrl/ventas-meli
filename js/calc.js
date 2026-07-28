/* ==========================================================================
   Motor de cálculo — funciones puras.
     IVA SAT  = (Precio / 1.16) * 0.08   (retención Meli por defecto)
     ISR SAT  = (Precio / 1.16) * 0.025  (sin RFC; 0.01 en RESICO)
     Comisión = Precio * %Meli           (Clásica 15%, Premium 20%)
     CargoFijo si Precio < umbral
     Utilidad = Precio - Costo - Comisión - CargoFijo - Envío - IVA - ISR
     Margen   = Utilidad / Precio
     ROI      = Utilidad / Costo
     Semáforo:  <umbralLiquidar → LIQUIDAR
                >=umbralEscalar → ESCALAR
                entre           → MANTENER
                inv=0           → AGOTADO
     Tope CPA = Utilidad * %CPA (solo ESCALAR).
   ========================================================================== */

const Calc = (() => {

    const DEFAULT_SETTINGS_MELI = {
        marketplace: 'meli',
        comisionClasica: 0.15,
        comisionPremium: 0.20,
        // Cargo fijo aprox. ML MX (publicaciones bajo umbral). Ajusta en Ajustes.
        cargoFijo: 35,
        umbralCargoFijo: 299,
        retencionIVA: 0.08,
        retencionISR: 0.025,      // sin RFC
        resico: false,            // true → ISR 1% (RESICO con RFC)
        umbralLiquidar: 50,
        umbralEscalar: 80,
        topeCPA: 0.40,
        comisionReferido: 0.12,
        tarifaFulfillmentDefault: 55,
    };

    /**
     * Amazon MX (Seller Central / Revenue Calculator).
     * Referido: % de categoría sobre precio sin IVA (precio ÷ 1.16), máx. con mínimo $8.
     *   Cuadra con la Calculadora de ingresos (ej. $459.99 · 12% → $47.59).
     * FBA = tabla por tamaño × peso × banda de precio (si lote.envio vacío).
     * Almacenamiento = lote.almacenamiento (MXN/ud, opcional; calculadora lo estima aparte).
     * Varios = lote.varios (MXN/ud, opcional; p.ej. $1 “Otros” de la Calculadora de ingresos).
     */
    const DEFAULT_SETTINGS_AMAZON = {
        marketplace: 'amazon',
        comisionReferido: 0.15,          // fallback / override manual
        tarifaReferidoMinima: 8,         // MXN por artículo
        usarTablaCategorias: true,       // false → solo comisionReferido fijo
        referidoSobreSinIVA: true,       // true = igual que Revenue Calculator MX
        prepEnvioActivo: true,           // vista Envíos + marcar pedidos por preparar
        categoriaDefault: 'hogar_cocina',
        usarTablaFba: true,              // false → solo tarifaFulfillmentDefault / lote.envio
        tarifaFulfillmentDefault: 64,    // Estándar ~0.3 kg, precio ≥ $499
        tamanoFbaDefault: 'estandar',    // sobre | estandar | grande
        pesoKgDefault: 0.3,
        comisionClasica: 0.15,
        comisionPremium: 0.15,
        cargoFijo: 0,
        umbralCargoFijo: 0,
        retencionIVA: 0,
        retencionISR: 0,
        resico: false,
        umbralLiquidar: 50,
        umbralEscalar: 80,
        topeCPA: 0.40,
    };

    /** Categorías oficiales Amazon MX (referido % con IVA). */
    const AMZ_CATEGORIES = {
        acc_amazon:          { label: 'Accesorios dispositivos Amazon', pct: 0.45 },
        bebe:                { label: 'Productos para bebé', pct: 0.15 },
        electronica:         { label: 'Electrónicos', pct: 0.10 },
        acc_electronica:     { label: 'Accesorios electrónicos', tier: { upTo: 2000, low: 0.15, high: 0.08 } },
        muebles:             { label: 'Muebles', pct: 0.15 },
        colchones:           { label: 'Colchones', pct: 0.15 },
        patio:               { label: 'Patio y Jardín', pct: 0.15 },
        alimentacion:        { label: 'Alimentación y Gourmet', band: { upTo: 500, low: 0.12, high: 0.15 } },
        hogar_cocina:        { label: 'Hogar y Cocina', pct: 0.15 },
        electrodomesticos:   { label: 'Electrodomésticos', pct: 0.15 },
        musica:              { label: 'Instrumentos musicales', pct: 0.15 },
        oficina:             { label: 'Oficina y Papelería', pct: 0.10 },
        deportes:            { label: 'Deportes y Aire libre', pct: 0.15 },
        computadoras:        { label: 'Computadoras', pct: 0.10 },
        mascotas:            { label: 'Mascotas', pct: 0.15 },
        herramientas:        { label: 'Herramientas y Mejoras del hogar', pct: 0.15 },
        herramientas_elec:   { label: 'Herramientas eléctricas', pct: 0.12 },
        juguetes:            { label: 'Juguetes y Juegos', band: { upTo: 300, low: 0.08, high: 0.15 } },
        multimedia:          { label: 'Multimedia (Libros, DVD, Música)', pct: 0.15 },
        videojuegos:         { label: 'Videojuegos y Accesorios', pct: 0.15 },
        consolas:            { label: 'Videoconsolas', pct: 0.08 },
        automotriz:          { label: 'Automotriz y Motocicletas', pct: 0.12 },
        neumaticos:          { label: 'Neumáticos', pct: 0.10 },
        belleza:             { label: 'Belleza', band: { upTo: 200, low: 0.12, high: 0.15 } },
        salud:               { label: 'Salud y Cuidado personal', band: { upTo: 200, low: 0.12, high: 0.15 } },
        alcohol:             { label: 'Bebidas alcohólicas', pct: 0.08 },
        ropa:                { label: 'Ropa y Accesorios', pct: 0.15 },
        calzado:             { label: 'Calzado', pct: 0.15 },
        lentes:              { label: 'Lentes y accesorios', pct: 0.15 },
        bolsos:              { label: 'Mochilas, Bolsos y Equipaje', pct: 0.15 },
        relojes:             { label: 'Relojes', tier: { upTo: 5000, low: 0.16, high: 0.05 } },
        joyeria:             { label: 'Joyería', pct: 0.15 },
        industria:           { label: 'Industria, Empresas y Ciencia', pct: 0.14 },
        otros:               { label: 'Todo lo demás', pct: 0.15 },
    };

    /** Alias texto libre → clave (para categorías ya tipadas a mano). */
    const AMZ_CAT_ALIASES = {
        cocina: 'hogar_cocina', hogar: 'hogar_cocina', 'hogar y cocina': 'hogar_cocina',
        gaming: 'videojuegos', videojuegos: 'videojuegos', electronica: 'electronica',
        electrónicos: 'electronica', electronicos: 'electronica', salud: 'salud',
        belleza: 'belleza', juguetes: 'juguetes', deportes: 'deportes', baño: 'hogar_cocina',
        bano: 'hogar_cocina', oficina: 'oficina', mascotas: 'mascotas', ropa: 'ropa',
        computadoras: 'computadoras', bebe: 'bebe', bebés: 'bebe',
        alimentacion: 'alimentacion', alimentos: 'alimentacion', gourmet: 'alimentacion',
        chocolate: 'alimentacion', comida: 'alimentacion', 'alimentacion y gourmet': 'alimentacion',
    };

    /**
     * Tabla FBA general (no Salud/Alimentación/Alcohol).
     * Bandas precio: 0=<150, 1=150–299, 2=299–499, 3=≥499
     * Valores = [tarifa base por tramo de peso…] + addPerExtra
     */
    const FBA_GENERAL = {
        sobre: {
            // tramos: 0-0.1, 0.1-0.2, 0.2-0.3, 0.3-0.4, >0.4 (usa último + extra no aplica igual)
            weights: [0.1, 0.2, 0.3, 0.4, Infinity],
            bands: [
                [27.00, 27.20, 27.40, 27.60, 27.80],
                [33.00, 34.00, 35.00, 36.00, 37.00],
                [49.00, 50.00, 51.00, 52.00, 53.00],
                [60.00, 60.40, 60.80, 61.20, 61.50],
            ],
        },
        estandar: {
            weights: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, Infinity],
            bands: [
                [28.00, 28.05, 28.10, 28.15, 28.20, 28.25, 28.30, 28.35, 28.40, 28.45, 28.50],
                [33.00, 34.00, 35.00, 36.00, 37.00, 37.50, 38.00, 38.50, 39.00, 39.50, 40.00],
                [50.00, 51.00, 52.00, 53.00, 54.00, 55.00, 56.00, 57.00, 58.00, 59.00, 60.00],
                [61.80, 63.00, 64.00, 66.00, 67.00, 68.30, 69.60, 71.00, 72.00, 72.70, 72.80],
            ],
            // extra por cada 0.25 kg sobre 1 kg
            extraAfter1kg: [1.15, 1.15, 1.75, 1.50],
        },
        grande: {
            // base 0–1 kg; luego + por 0.5 kg hasta 50; simplificado
            base1kg: [32.00, 38.00, 61.00, 75.40],
            per05_to50: [2.80, 2.80, 3.10, 3.75],
        },
    };

    /** Misma estructura, tarifas reducidas Salud / Alimentación / Alcohol. */
    const FBA_ESSENTIALS = {
        sobre: {
            weights: [0.1, 0.2, 0.3, 0.4, Infinity],
            bands: [
                [4.50, 4.60, 4.70, 4.80, 4.90],
                [5.50, 5.60, 5.70, 5.80, 5.90],
                [14.00, 14.10, 14.20, 14.30, 14.40],
                [60.00, 60.40, 60.80, 61.20, 61.50],
            ],
        },
        estandar: {
            weights: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, Infinity],
            bands: [
                [5.00, 5.10, 5.20, 5.30, 5.40, 5.50, 5.60, 5.70, 5.80, 5.90, 6.00],
                [6.00, 6.10, 6.20, 6.30, 6.40, 6.50, 6.60, 6.70, 6.80, 6.90, 7.00],
                [14.50, 14.60, 14.70, 14.80, 14.90, 15.00, 15.10, 15.20, 15.30, 15.40, 15.50],
                [61.80, 63.00, 64.00, 66.00, 67.00, 68.30, 69.60, 71.00, 72.00, 72.70, 72.80],
            ],
            extraAfter1kg: [0.15, 0.30, 0.45, 1.50],
        },
        grande: {
            base1kg: [5.20, 6.20, 15.50, 75.40],
            per05_to50: [0.25, 0.50, 0.75, 3.75],
        },
    };

    const DEFAULT_SETTINGS = DEFAULT_SETTINGS_MELI;

    function defaultsFor(marketplace = 'meli') {
        return marketplace === 'amazon'
            ? { ...DEFAULT_SETTINGS_AMAZON }
            : { ...DEFAULT_SETTINGS_MELI };
    }

    function effectiveSettings(settings = {}) {
        const mp = settings.marketplace === 'amazon' ? 'amazon' : 'meli';
        const s = { ...defaultsFor(mp), ...settings, marketplace: mp };
        // RESICO manda sobre el slider ISR si está activo (solo Meli)
        if (mp === 'meli' && s.resico) s.retencionISR = 0.01;
        return s;
    }

    function amzCategoryList() {
        return Object.entries(AMZ_CATEGORIES).map(([id, c]) => ({ id, label: c.label }));
    }

    function resolveAmzCategoryKey(lote, settings = {}) {
        const s = effectiveSettings(settings);
        const raw = String(lote?.categoriaAmazon || lote?.categoria || s.categoriaDefault || 'otros').trim();
        if (AMZ_CATEGORIES[raw]) return raw;
        const norm = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (AMZ_CAT_ALIASES[norm]) return AMZ_CAT_ALIASES[norm];
        // match por label parcial
        for (const [id, c] of Object.entries(AMZ_CATEGORIES)) {
            const lab = c.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (lab.includes(norm) || norm.includes(lab.slice(0, 8))) return id;
        }
        return s.categoriaDefault && AMZ_CATEGORIES[s.categoriaDefault] ? s.categoriaDefault : 'otros';
    }

    function amzReferralPct(precio, categoryKey) {
        const cat = AMZ_CATEGORIES[categoryKey] || AMZ_CATEGORIES.otros;
        const p = Number(precio) || 0;
        if (cat.tier) {
            if (p <= 0) return cat.tier.low;
            if (p <= cat.tier.upTo) return cat.tier.low;
            // tasa efectiva ponderada para display; el fee se calcula aparte
            return (cat.tier.upTo * cat.tier.low + (p - cat.tier.upTo) * cat.tier.high) / p;
        }
        if (cat.band) return p <= cat.band.upTo ? cat.band.low : cat.band.high;
        return cat.pct;
    }

    function amzReferralFeeAmount(precio, categoryKey, settings = {}) {
        const s = effectiveSettings(settings);
        const p = Number(precio) || 0;
        const min = Number(s.tarifaReferidoMinima) || 8;
        // Revenue Calculator MX aplica el % sobre precio sin IVA (÷ 1.16).
        // Umbrales de banda/tier siguen siendo sobre el precio de lista.
        const base = s.referidoSobreSinIVA !== false && p > 0 ? p / 1.16 : p;
        if (!s.usarTablaCategorias) {
            const pct = Number(s.comisionReferido) || 0.15;
            return Math.max(base * pct, min);
        }
        const cat = AMZ_CATEGORIES[categoryKey] || AMZ_CATEGORIES.otros;
        let fee;
        if (cat.tier) {
            // Misma lógica oficial, luego ÷ 1.16 si referidoSobreSinIVA
            if (p <= cat.tier.upTo) fee = p * cat.tier.low;
            else fee = cat.tier.upTo * cat.tier.low + (p - cat.tier.upTo) * cat.tier.high;
            if (s.referidoSobreSinIVA !== false) fee = fee / 1.16;
        } else if (cat.band) {
            fee = base * (p <= cat.band.upTo ? cat.band.low : cat.band.high);
        } else {
            fee = base * cat.pct;
        }
        return Math.max(fee, min);
    }

    function amzPriceBandIndex(precio) {
        const p = Number(precio) || 0;
        if (p < 150) return 0;
        if (p < 299) return 1;
        if (p < 499) return 2;
        return 3;
    }

    function amzIsEssentialsCategory(categoryKey) {
        return categoryKey === 'salud' || categoryKey === 'alimentacion' || categoryKey === 'alcohol';
    }

    function lookupFbaTier(table, tamano, peso, band) {
        const size = table[tamano] || table.estandar;
        if (tamano === 'grande') {
            const base = size.base1kg[band];
            const w = Math.max(0, Number(peso) || 0);
            if (w <= 1) return base;
            const steps = Math.ceil((Math.min(w, 50) - 1) / 0.5);
            return base + steps * size.per05_to50[band];
        }
        const weights = size.weights;
        const rates = size.bands[band];
        const w = Math.max(0, Number(peso) || 0);
        let idx = weights.findIndex(limit => w <= limit);
        if (idx < 0) idx = rates.length - 1;
        let fee = rates[Math.min(idx, rates.length - 1)];
        if (w > 1 && size.extraAfter1kg) {
            const extraSteps = Math.ceil((w - 1) / 0.25);
            fee = rates[rates.length - 1] + extraSteps * size.extraAfter1kg[band];
        }
        return fee;
    }

    function amzFbaFee(lote, precio, settings = {}) {
        const s = effectiveSettings(settings);
        const override = Number(lote.envio);
        if (override > 0) return { fee: override, source: 'manual' };
        if (!s.usarTablaFba) {
            return { fee: Number(s.tarifaFulfillmentDefault) || 0, source: 'default' };
        }
        const catKey = resolveAmzCategoryKey(lote, s);
        const table = amzIsEssentialsCategory(catKey) ? FBA_ESSENTIALS : FBA_GENERAL;
        const tamano = String(lote.tamanoFba || s.tamanoFbaDefault || 'estandar').toLowerCase();
        const sizeKey = tamano.startsWith('sob') ? 'sobre' : tamano.startsWith('gran') ? 'grande' : 'estandar';
        const peso = Number(lote.pesoKg);
        const pesoEff = Number.isFinite(peso) && peso > 0 ? peso : (Number(s.pesoKgDefault) || 0.3);
        const band = amzPriceBandIndex(precio);
        const fee = lookupFbaTier(table, sizeKey, pesoEff, band);
        return { fee, source: 'tabla', tamano: sizeKey, peso: pesoEff, band };
    }

    function comisionPct(tipo, s = DEFAULT_SETTINGS, lote = null) {
        const st = effectiveSettings(s);
        if (st.marketplace === 'amazon') {
            if (!st.usarTablaCategorias) return Number(st.comisionReferido) || 0.15;
            const precio = Number(lote?.precio) || 0;
            const key = resolveAmzCategoryKey(lote || {}, st);
            return amzReferralPct(precio, key);
        }
        const t = String(tipo || '').toLowerCase();
        if (t.startsWith('prem')) return st.comisionPremium;
        return st.comisionClasica;
    }

    /** Costo máximo de adquisición para lograr un margen objetivo al precio de lista. */
    function costoIdeal(lote, margenObjetivo = 0.25, settings = DEFAULT_SETTINGS) {
        const s = effectiveSettings(settings);
        const precio = Number(lote.precio) || 0;
        if (precio <= 0) return null;
        const at = utilidadAtPrice(lote, precio, s);
        const fulfill = at.envio != null ? at.envio : (Number(lote.envio) || 0);
        const alm = at.almacenamiento != null ? at.almacenamiento : (Number(lote.almacenamiento) || 0);
        const varios = at.varios != null ? at.varios : Math.max(0, Number(lote.varios) || 0);
        const fees = at.comisionVariable + at.cargoFijo + at.retIVA + at.retISR + fulfill + alm + varios;
        const costo = precio * (1 - margenObjetivo) - fees;
        return Math.max(0, costo);
    }

    /**
     * Compara costo actual vs costo ideal para un margen objetivo.
     * Partiendo del precio de venta, descuenta fees (comisión, cargo fijo, envío, SAT).
     */
    function analisisCostoIdeal(lote, margenObjetivo = 0.25, settings = DEFAULT_SETTINGS) {
        const s = effectiveSettings(settings);
        const precio = Number(lote.precio) || 0;
        if (precio <= 0) return null;
        const ideal = costoIdeal(lote, margenObjetivo, s);
        if (ideal == null) return null;
        const actual = Number(lote.costo) || 0;
        const at = utilidadAtPrice(lote, precio, s);
        const envioFee = at.envio != null ? at.envio : (Number(lote.envio) || 0);
        const alm = at.almacenamiento != null ? at.almacenamiento : (Number(lote.almacenamiento) || 0);
        const varios = at.varios != null ? at.varios : Math.max(0, Number(lote.varios) || 0);
        const fees = at.comisionVariable + at.cargoFijo + envioFee + alm + varios + at.retIVA + at.retISR;
        const diff = actual - ideal; // + = compraste más caro que el tope
        let verdict = 'en_objetivo';
        if (diff > 0.5) verdict = 'arriba';
        else if (diff < -0.5) verdict = 'mejor';
        return {
            precio,
            ideal,
            actual,
            fees,
            margenObjetivo,
            margenActual: at.margen,
            utilidadActual: at.utilidad,
            diff,
            verdict,
            breakdown: {
                comisionVariable: at.comisionVariable,
                cargoFijo: at.cargoFijo,
                envio: envioFee,
                almacenamiento: alm,
                retIVA: at.retIVA,
                retISR: at.retISR,
                pctComision: at.pctComision,
                categoriaAmazon: at.categoriaAmazon,
                referidoMinimo: at.referidoMinimo,
            },
        };
    }

    /** Rango sano de compra: [tope para 30% margen, tope para 20% margen]. */
    function rangoCompraIdeal(lote, settings = DEFAULT_SETTINGS) {
        const para30 = costoIdeal(lote, 0.30, settings);
        const para20 = costoIdeal(lote, 0.20, settings);
        if (para30 == null || para20 == null) return null;
        const actual = Number(lote.costo) || 0;
        let verdict = 'ok'; // dentro del rango
        if (actual > para20) verdict = 'caro';      // por arriba del tope 20%
        else if (actual <= para30) verdict = 'excelente'; // permite ≥30%
        else verdict = 'sano'; // entre 20 y 30
        return {
            min: para30,   // costo máx para 30%
            max: para20,   // costo máx para 20%
            actual,
            verdict,
            margenSiComprasEn: (costo) => {
                const u = utilidadAtPrice({ ...lote, costo }, lote.precio, settings);
                return u.margen;
            },
        };
    }

    /** Utilidad neta por unidad (Meli+SAT o Amazon referido+fulfillment). */
    function utilidadAtPrice(lote, precioVenta, settings = DEFAULT_SETTINGS) {
        const s = effectiveSettings(settings);
        const costo = Number(lote.costo) || 0;
        const precio = Number(precioVenta) || 0;

        if (s.marketplace === 'amazon') {
            const catKey = resolveAmzCategoryKey(lote, s);
            const comisionVariable = amzReferralFeeAmount(precio, catKey, s);
            // % de categoría (p.ej. 12%), no fee/precio (~10.3% efectivo)
            const pctComision = precio > 0 ? amzReferralPct(precio, catKey) : comisionPct(lote.tipo, s, lote);
            const tipo = String(lote.tipo || 'FBA').toUpperCase();
            let envio = 0;
            let fbaMeta = null;
            if (tipo === 'FBM') {
                envio = Number(lote.envio) || 0; // tu costo real de envío
            } else {
                fbaMeta = amzFbaFee(lote, precio, s);
                envio = fbaMeta.fee;
            }
            const almacenamiento = Math.max(0, Number(lote.almacenamiento) || 0);
            const varios = Math.max(0, Number(lote.varios) || 0);
            const utilidad = precio - costo - comisionVariable - envio - almacenamiento - varios;
            return {
                utilidad,
                margen: precio > 0 ? utilidad / precio : 0,
                pctComision,
                comisionVariable,
                cargoFijo: 0,
                envio,
                almacenamiento,
                varios,
                retIVA: 0,
                retISR: 0,
                categoriaAmazon: catKey,
                referidoMinimo: Number(s.tarifaReferidoMinima) || 8,
                fbaMeta,
            };
        }

        let envio = Number(lote.envio) || 0;
        const pctComision = comisionPct(lote.tipo, s, lote);
        const comisionVariable = precio * pctComision;
        const cargoFijo = precio > 0 && s.umbralCargoFijo > 0 && precio < s.umbralCargoFijo ? s.cargoFijo : 0;
        const precioSinIVA = precio > 0 ? precio / 1.16 : 0;
        const retIVA = precioSinIVA * s.retencionIVA;
        const retISR = precioSinIVA * s.retencionISR;
        const utilidad = precio - costo - comisionVariable - cargoFijo - envio - retIVA - retISR;
        return { utilidad, margen: precio > 0 ? utilidad / precio : 0, pctComision, comisionVariable, cargoFijo, envio, retIVA, retISR };
    }

    function syncVendidas(lote) {
        if (Array.isArray(lote.ventas) && lote.ventas.length) {
            return lote.ventas.reduce((s, v) => s + (Number(v.unidades) || 0), 0);
        }
        return Number(lote.vendidas) || 0;
    }

    function estatusKey(estatus) {
        const t = String(estatus || '').toLowerCase();
        if (t.includes('paus')) return 'pausada';
        if (t.includes('final')) return 'finalizada';
        if (t.includes('sin stock') || t.includes('agot')) return 'sin_stock';
        return 'activa';
    }

    function computeLote(lote, settings = DEFAULT_SETTINGS) {
        const s = effectiveSettings(settings);

        const costo = Number(lote.costo) || 0;
        const precio = Number(lote.precio) || 0;
        const unidades = Number(lote.unidades) || 0;
        const envio = Number(lote.envio) || 0;
        const vendidas = syncVendidas(lote);
        const gastoAds = Math.max(0, Number(lote.gastoAds) || 0);

        const unit = utilidadAtPrice(lote, precio, s);
        const { utilidad, margen, pctComision, comisionVariable, cargoFijo, retIVA, retISR } = unit;
        const envioEfectivo = unit.envio != null ? unit.envio : envio;
        const almacenamiento = unit.almacenamiento != null
            ? unit.almacenamiento
            : Math.max(0, Number(lote.almacenamiento) || 0);
        const varios = unit.varios != null
            ? unit.varios
            : Math.max(0, Number(lote.varios) || 0);
        const roi = costo > 0 ? utilidad / costo : 0;
        const categoriaAmazon = unit.categoriaAmazon || null;
        const referidoMinimo = unit.referidoMinimo || null;
        const fbaMeta = unit.fbaMeta || null;

        const inversion = costo * unidades;
        const inventarioRestante = Math.max(0, unidades - vendidas);
        const rotacion = unidades > 0 ? vendidas / unidades : 0;

        // Cash-in y ganancia REALIZADA: precio de cada venta (no el de lista)
        let cashIn = 0;
        let gananciaRealizada = 0;
        if (Array.isArray(lote.ventas) && lote.ventas.length) {
            lote.ventas.forEach(v => {
                const uds = Number(v.unidades) || 0;
                const p = Number(v.precio) || 0;
                cashIn += p * uds;
                gananciaRealizada += utilidadAtPrice(lote, p, s).utilidad * uds;
            });
        } else {
            // Legacy: sin eventos de venta, estima con precio de lista
            cashIn = precio * vendidas;
            gananciaRealizada = utilidad * vendidas;
        }

        const valorInventario = costo * inventarioRestante;
        const est = estatusKey(lote.estatus);

        let estrategia;
        // Estatus de publicación manda sobre el semáforo económico
        if (est === 'finalizada') estrategia = 'FINALIZADA';
        else if (est === 'pausada') estrategia = 'PAUSADA';
        else if (est === 'sin_stock' || (inventarioRestante === 0 && vendidas > 0)) estrategia = 'AGOTADO';
        else if (utilidad < s.umbralLiquidar) estrategia = 'LIQUIDAR';
        else if (utilidad >= s.umbralEscalar) estrategia = 'ESCALAR';
        else estrategia = 'MANTENER';

        const topeCPA = (estrategia === 'ESCALAR' || estrategia === 'MANTENER')
            ? utilidad * s.topeCPA
            : 0;
        // Ads: gasto total del SKU vs tope por unidad × ventas realizadas
        const adsPorVenta = vendidas > 0 ? gastoAds / vendidas : (gastoAds > 0 ? gastoAds : 0);
        const topeAdsAcumulado = topeCPA * Math.max(vendidas, 0);
        let adsStatus = 'na'; // sin tope o sin gasto
        if (topeCPA > 0 && (gastoAds > 0 || vendidas > 0)) {
            if (vendidas === 0 && gastoAds > 0) adsStatus = 'sin_ventas';
            else if (adsPorVenta > topeCPA * 1.05) adsStatus = 'over';
            else if (adsPorVenta > topeCPA * 0.85) adsStatus = 'near';
            else adsStatus = 'ok';
        } else if (gastoAds > 0 && topeCPA <= 0) {
            adsStatus = 'sin_tope';
        }

        return {
            pctComision,
            comisionVariable,
            cargoFijo,
            envio: envioEfectivo,
            almacenamiento,
            varios,
            retIVA,
            retISR,
            categoriaAmazon,
            referidoMinimo,
            fbaMeta,
            utilidad,
            margen,
            roi,
            inversion,
            inventarioRestante,
            rotacion,
            cashIn,
            gananciaRealizada,
            valorInventario,
            estrategia,
            topeCPA,
            gastoAds,
            adsPorVenta,
            topeAdsAcumulado,
            adsStatus,
            vendidas,
            estatusKey: est,
        };
    }

    // Retorna array de recomendaciones (más específicas primero).
    function getRecomendaciones(lote, calc) {
        const recs = [];
        const stock = calc.inventarioRestante;
        const uds = Number(lote.unidades) || 0;
        const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
        const fechaCaptura = lote.fecha ? new Date(lote.fecha) : null;
        const diasEnListado = fechaCaptura ? Math.floor((Date.now() - fechaCaptura.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        const ultimaVenta = ventas.length ? new Date(ventas[ventas.length - 1].fecha) : null;
        const diasSinVender = ultimaVenta ? Math.floor((Date.now() - ultimaVenta.getTime()) / (1000 * 60 * 60 * 24)) : diasEnListado;

        if (calc.estrategia === 'FINALIZADA') {
            const mpLabel = (lote?._mp === 'amazon'
                || window.State?.marketplace === 'amazon'
                || String(lote?.tipo || '').toUpperCase() === 'FBA'
                || String(lote?.tipo || '').toUpperCase() === 'FBM')
                ? 'Amazon' : 'Mercado Libre';
            recs.push({
                cls: 'warn', icon: '❌',
                title: 'Publicación finalizada',
                text: `No está activa en ${mpLabel}. Stock restante: <strong>${stock}</strong>. Reactiva o liquida el inventario físico.`,
            });
            return recs;
        }

        if (calc.estrategia === 'PAUSADA') {
            recs.push({
                cls: 'warn', icon: '⏸️',
                title: 'Publicación pausada',
                text: `No genera ventas mientras esté pausada. Utilidad unitaria potencial: <strong>${fmtMXN(calc.utilidad)}</strong>. Reactiva si quieres rotar el stock (${stock} uds).`,
            });
            if (stock > 0 && calc.utilidad >= 0) {
                recs.push({
                    cls: 'good', icon: '▶️',
                    title: 'Candidato a reactivar',
                    text: `Hay stock y el margen listado no está en rojo. Considera reactivar antes de liquidar.`,
                });
            }
            return recs;
        }

        if (calc.estrategia === 'AGOTADO') {
            recs.push({
                cls: 'good', icon: '✅',
                title: 'Producto agotado',
                text: `Ya vendiste todas las <strong>${uds} unidades</strong>. ${calc.vendidas > 0 ? `Utilidad realizada: <strong>${fmtMXN(calc.gananciaRealizada)}</strong>.` : ''} Considera <strong>recomprar</strong> si sigue rentable a precio actual.`,
            });
            return recs;
        }

        if (calc.estrategia === 'LIQUIDAR') {
            recs.push({
                cls: 'danger', icon: '🚨',
                title: 'Producto en pérdida efectiva',
                text: `La utilidad neta (<strong>${fmtMXN(calc.utilidad)}</strong>) es menor al umbral mínimo. Recomendación: <strong>rematar el stock actual</strong>, no recomprar ni invertir en Ads.`,
            });
            if (stock >= 5) {
                recs.push({
                    cls: 'danger', icon: '📉',
                    title: 'Stock alto con margen negativo',
                    text: `Tienes <strong>${stock} uds</strong> restantes. Considera bajar el precio <strong>10-15%</strong> para acelerar liquidación y liberar capital.`,
                });
            }
            return recs;
        }

        if (calc.estrategia === 'ESCALAR') {
            const escalarBase = {
                cls: 'good', icon: '🔥',
                title: 'Producto estrella',
                text: `La utilidad neta es sana. Puedes destinar hasta <strong>${fmtMXN(calc.topeCPA)}</strong> por venta en Ads (CPA) y seguir ganando.`,
            };
            recs.push(escalarBase);
            if (stock <= 2) {
                recs.push({
                    cls: 'warn', icon: '📦',
                    title: 'Stock crítico',
                    text: `Solo quedan <strong>${stock} uds</strong>. Con esta rentabilidad, <strong>recompra mayoreo YA</strong> antes de que se agote.`,
                });
            }
            if (calc.margen >= 0.30) {
                recs.push({
                    cls: 'good', icon: '💎',
                    title: 'Margen premium (' + fmtPct(calc.margen) + ')',
                    text: `El margen es excelente. Buen candidato para escalar Ads agresivamente y buscar mayoreo con proveedor.`,
                });
            }
            return recs;
        }

        // MANTENER
        recs.push({
            cls: 'warn', icon: '⚠️',
            title: 'Rentabilidad moderada',
            text: `Utilidad <strong>${fmtMXN(calc.utilidad)}</strong>: se vende de forma orgánica pero no aguanta Ads. Mantén el stock, evalúa bajar costo o subir precio antes de recomprar.`,
        });

        if (diasSinVender >= 30 && diasEnListado >= 30) {
            recs.push({
                cls: 'warn', icon: '🐌',
                title: 'Sin ventas hace ' + diasSinVender + ' días',
                text: `Considera <strong>ajustar el precio</strong>, mejorar título/fotos, o pausar publicación si no rota.`,
            });
        }

        if (lote.precioCompetencia && lote.precio > lote.precioCompetencia * 1.15) {
            recs.push({
                cls: 'warn', icon: '💸',
                title: 'Precio por arriba de competencia',
                text: `Tu precio (<strong>${fmtMXN(lote.precio)}</strong>) es ${((lote.precio / lote.precioCompetencia - 1) * 100).toFixed(0)}% mayor al de competencia (<strong>${fmtMXN(lote.precioCompetencia)}</strong>). Bajar puede acelerar ventas.`,
            });
        }

        return recs;
    }

    function aggregate(lotes, settings = DEFAULT_SETTINGS) {
        let capitalDesplegado = 0;
        let cashIn = 0;
        let gananciaRealizada = 0;
        let valorInventario = 0;
        const strategyCount = { ESCALAR: 0, MANTENER: 0, LIQUIDAR: 0, AGOTADO: 0, PAUSADA: 0, FINALIZADA: 0 };
        let totalUds = 0;
        let totalVendidas = 0;
        let sumaWeightedMargen = 0;

        const rows = lotes.map(l => {
            const c = computeLote(l, settings);
            capitalDesplegado += c.inversion;
            cashIn += c.cashIn;
            gananciaRealizada += c.gananciaRealizada;
            valorInventario += c.valorInventario;
            strategyCount[c.estrategia] = (strategyCount[c.estrategia] || 0) + 1;
            totalUds += Number(l.unidades) || 0;
            totalVendidas += c.vendidas;
            sumaWeightedMargen += c.margen * (Number(l.unidades) || 0);
            return { lote: l, calc: c };
        });

        const margenPonderado = totalUds > 0 ? sumaWeightedMargen / totalUds : 0;

        return {
            capitalDesplegado,
            cashIn,
            gananciaRealizada,
            valorInventario,
            margenPonderado,
            totalUds,
            totalVendidas,
            strategyCount,
            rows,
        };
    }

    function fmtMXN(n) {
        if (n === null || n === undefined || isNaN(n)) return '—';
        return '$' + Number(n).toLocaleString('es-MX', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    function fmtPct(n) {
        if (n === null || n === undefined || isNaN(n)) return '—';
        return (Number(n) * 100).toFixed(1) + '%';
    }

    function fmtDate(d) {
        if (!d) return '—';
        try {
            return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch { return String(d); }
    }

    return {
        DEFAULT_SETTINGS,
        DEFAULT_SETTINGS_MELI,
        DEFAULT_SETTINGS_AMAZON,
        AMZ_CATEGORIES,
        defaultsFor,
        effectiveSettings,
        computeLote,
        utilidadAtPrice,
        costoIdeal,
        analisisCostoIdeal,
        rangoCompraIdeal,
        syncVendidas,
        estatusKey,
        aggregate,
        getRecomendaciones,
        fmtMXN,
        fmtPct,
        fmtDate,
        comisionPct,
        amzCategoryList,
        resolveAmzCategoryKey,
        amzReferralFeeAmount,
        amzFbaFee,
    };
})();
window.Calc = Calc;
