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

    const DEFAULT_SETTINGS = {
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
    };

    function effectiveSettings(settings = {}) {
        const s = { ...DEFAULT_SETTINGS, ...settings };
        // RESICO manda sobre el slider ISR si está activo
        if (s.resico) s.retencionISR = 0.01;
        return s;
    }

    function comisionPct(tipo, s = DEFAULT_SETTINGS) {
        const t = String(tipo || '').toLowerCase();
        if (t.startsWith('prem')) return s.comisionPremium;
        return s.comisionClasica;
    }

    /** Costo máximo de adquisición para lograr un margen objetivo al precio de lista. */
    function costoIdeal(lote, margenObjetivo = 0.25, settings = DEFAULT_SETTINGS) {
        const s = effectiveSettings(settings);
        const precio = Number(lote.precio) || 0;
        if (precio <= 0) return null;
        const pctComision = comisionPct(lote.tipo, s);
        const comisionVariable = precio * pctComision;
        const cargoFijo = precio > 0 && precio < s.umbralCargoFijo ? s.cargoFijo : 0;
        const envio = Number(lote.envio) || 0;
        const precioSinIVA = precio / 1.16;
        const retIVA = precioSinIVA * s.retencionIVA;
        const retISR = precioSinIVA * s.retencionISR;
        const fees = comisionVariable + cargoFijo + envio + retIVA + retISR;
        // utilidad = precio - costo - fees = margen * precio
        // costo = precio - fees - margen*precio
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
        const fees = at.comisionVariable + at.cargoFijo + (Number(lote.envio) || 0) + at.retIVA + at.retISR;
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
                envio: Number(lote.envio) || 0,
                retIVA: at.retIVA,
                retISR: at.retISR,
                pctComision: at.pctComision,
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

    /** Utilidad neta por unidad a un precio de venta dado (fees ML + SAT). */
    function utilidadAtPrice(lote, precioVenta, settings = DEFAULT_SETTINGS) {
        const s = effectiveSettings(settings);
        const costo = Number(lote.costo) || 0;
        const precio = Number(precioVenta) || 0;
        const envio = Number(lote.envio) || 0;
        const pctComision = comisionPct(lote.tipo, s);
        const comisionVariable = precio * pctComision;
        const cargoFijo = precio > 0 && precio < s.umbralCargoFijo ? s.cargoFijo : 0;
        const precioSinIVA = precio > 0 ? precio / 1.16 : 0;
        const retIVA = precioSinIVA * s.retencionIVA;
        const retISR = precioSinIVA * s.retencionISR;
        const utilidad = precio - costo - comisionVariable - cargoFijo - envio - retIVA - retISR;
        return { utilidad, margen: precio > 0 ? utilidad / precio : 0, pctComision, comisionVariable, cargoFijo, retIVA, retISR };
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
        const roi = costo > 0 ? utilidad / costo : 0;

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
            retIVA,
            retISR,
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
            recs.push({
                cls: 'warn', icon: '❌',
                title: 'Publicación finalizada',
                text: `No está activa en Mercado Libre. Stock restante: <strong>${stock}</strong>. Reactiva o liquida el inventario físico.`,
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
    };
})();
