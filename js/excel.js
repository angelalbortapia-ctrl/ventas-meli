/* ==========================================================================
   Importar / Exportar Excel usando SheetJS.
   Espeja la estructura de Lotes_Operaciones del Negocio.xlsx original.
   ========================================================================== */

const ExcelIO = (() => {

    const HEADERS_MELI = [
        'SKU', 'Producto', 'Color / Variante', 'Categoría', 'Tipo Publicación', 'Fecha de Captura',
        'Costo', 'Unidades', 'Inversión Total Lote (MXN)',
        'Precio Competencia', 'Precio de Venta (MXN)',
        '% Comisión Meli', 'Comisión Variable (MXN)', 'Cargo Fijo (<$299 MXN)',
        'Envío al Cliente', 'Retención IVA SAT (8%)', 'Retención ISR SAT (2.5%)',
        'Utilidad Neta Real', 'Margen Neto %', 'ROI Unitario %',
        'Inventario Restante', 'Unidades Vendidas', 'Estatus Publicación',
        'Estrategia', 'Tope Máximo CPA (Ads)', 'Gasto Ads (MXN)',
    ];

    const HEADERS_AMAZON = [
        'SKU', 'Producto', 'Color / Variante', 'Categoría Amazon', 'Logística', 'Fecha de Captura',
        'Costo', 'Unidades', 'Inversión Total Lote (MXN)',
        'Precio Competencia', 'Precio de Venta (MXN)',
        '% Referido Amazon', 'Comisión Referido (MXN)', 'Tarifa mín. referido',
        'FBA / Envío (MXN)', 'Almacenamiento FBA (MXN)', 'Varios (MXN)', 'Peso kg', 'Tamaño FBA',
        'Utilidad Neta Real', 'Margen Neto %', 'ROI Unitario %',
        'Inventario Restante', 'Unidades Vendidas', 'Estatus Publicación',
        'Estrategia', 'Tope Máximo CPA (Ads)', 'Gasto Ads (MXN)',
    ];

    function headersFor(settings) {
        return (settings?.marketplace === 'amazon') ? HEADERS_AMAZON : HEADERS_MELI;
    }

    function importFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
                    const sheetName = pickSheet(wb.SheetNames, 'lote');
                    if (!sheetName) return reject(new Error('No se encontró la pestaña Lotes_Operaciones'));
                    const ws = wb.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
                    let lotes = rows
                        .filter(r => r['SKU'] || r['Producto'])
                        .map(rowToLote);
                    const ventas = readVentasSheet(wb);
                    if (ventas.length) {
                        lotes = Data.attachVentasBySku(lotes, ventas);
                    }
                    resolve({ lotes, ventasCount: ventas.length });
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }

    function pickSheet(names, needle) {
        const target = names.find(n => n.toLowerCase().includes(needle));
        return target || (needle === 'lote' ? names[0] : null);
    }

    function readVentasSheet(wb) {
        const name = pickSheet(wb.SheetNames, 'venta');
        if (!name) return [];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
        return rows.map(r => {
            const sku = (r['SKU'] || r['Sku'] || '').toString().trim();
            if (!sku) return null;
            const fechaRaw = r['Fecha'] || r['fecha'];
            let fecha = '';
            if (fechaRaw instanceof Date) fecha = fechaRaw.toISOString().slice(0, 10);
            else if (typeof fechaRaw === 'string') fecha = fechaRaw.slice(0, 10);
            else fecha = new Date().toISOString().slice(0, 10);
            const unidades = Number(r['Unidades'] ?? r['uds'] ?? 1) || 1;
            const precio = Number(r['Precio'] ?? r['precio'] ?? 0) || 0;
            return {
                id: Data.newId(),
                sku,
                fecha,
                unidades,
                precio,
                notas: (r['Notas'] || r['notas'] || '').toString(),
            };
        }).filter(Boolean);
    }

    function rowToLote(r) {
        const num = k => {
            const v = r[k];
            if (v === null || v === undefined || v === '') return null;
            const n = Number(v);
            return isNaN(n) ? null : n;
        };
        const fechaRaw = r['Fecha de Captura'];
        let fecha = '';
        if (fechaRaw instanceof Date) fecha = fechaRaw.toISOString().slice(0, 10);
        else if (typeof fechaRaw === 'string') fecha = fechaRaw.slice(0, 10);

        const catAmz = (r['Categoría Amazon'] || '').toString().trim();
        const cat = (r['Categoría'] || catAmz || '').toString().trim();
        const tipoRaw = (r['Logística'] || r['Tipo Publicación'] || '').toString().trim();
        return {
            id: Data.newId(),
            sku: (r['SKU'] || '').toString().trim(),
            producto: (r['Producto'] || '').toString().trim(),
            variante: (r['Color / Variante'] || '').toString().trim(),
            categoria: cat,
            categoriaAmazon: catAmz,
            tipo: tipoRaw || (window.State?.marketplace === 'amazon' ? 'FBA' : 'Clasica'),
            fecha,
            costo: num('Costo') ?? 0,
            unidades: num('Unidades') ?? 0,
            precioCompetencia: num('Precio Competencia'),
            precio: num('Precio de Venta (MXN)') ?? 0,
            envio: num('Envío al Cliente') ?? num('FBA / Envío (MXN)') ?? 0,
            gastoAds: num('Gasto Ads (MXN)') ?? 0,
            vendidas: num('Unidades Vendidas') ?? 0,
            estatus: (r['Estatus Publicación'] || '✅ Activa / En Venta').toString().trim(),
            pesoKg: num('Peso kg'),
            tamanoFba: (r['Tamaño FBA'] || '').toString().trim() || '',
            almacenamiento: num('Almacenamiento FBA (MXN)') ?? 0,
            varios: num('Varios (MXN)') ?? 0,
        };
    }

    function exportFile(lotes, settings, filename = 'Negocio.xlsx') {
        const wb = XLSX.utils.book_new();
        const isAmz = settings?.marketplace === 'amazon';
        const headers = headersFor(settings);

        const rows = [headers];
        lotes.forEach(l => {
            const c = Calc.computeLote(l, settings);
            if (isAmz) {
                const catKey = c.categoriaAmazon || l.categoriaAmazon || '';
                const catLabel = (Calc.AMZ_CATEGORIES && Calc.AMZ_CATEGORIES[catKey]?.label) || l.categoria || catKey;
                rows.push([
                    l.sku,
                    l.producto,
                    l.variante,
                    catLabel,
                    l.tipo,
                    l.fecha ? new Date(l.fecha) : '',
                    l.costo,
                    l.unidades,
                    (Number(l.costo) || 0) * (Number(l.unidades) || 0),
                    l.precioCompetencia ?? '',
                    l.precio,
                    c.pctComision,
                    c.comisionVariable,
                    c.referidoMinimo ?? 8,
                    // Vacío si viene de tabla FBA: reimportar no debe congelar el fee como override
                    (c.fbaMeta?.source === 'tabla' ? '' : c.envio),
                    (c.almacenamiento ?? Number(l.almacenamiento)) || 0,
                    (c.varios ?? Number(l.varios)) || 0,
                    l.pesoKg ?? '',
                    l.tamanoFba || c.fbaMeta?.tamano || '',
                    c.utilidad,
                    c.margen,
                    c.roi,
                    c.inventarioRestante,
                    l.vendidas,
                    l.estatus,
                    strategyLabel(c.estrategia),
                    c.topeCPA,
                    Number(l.gastoAds) || 0,
                ]);
            } else {
                rows.push([
                    l.sku,
                    l.producto,
                    l.variante,
                    l.categoria || '',
                    l.tipo,
                    l.fecha ? new Date(l.fecha) : '',
                    l.costo,
                    l.unidades,
                    (Number(l.costo) || 0) * (Number(l.unidades) || 0),
                    l.precioCompetencia ?? '',
                    l.precio,
                    c.pctComision,
                    c.comisionVariable,
                    c.cargoFijo,
                    l.envio,
                    c.retIVA,
                    c.retISR,
                    c.utilidad,
                    c.margen,
                    c.roi,
                    c.inventarioRestante,
                    l.vendidas,
                    l.estatus,
                    strategyLabel(c.estrategia),
                    c.topeCPA,
                    Number(l.gastoAds) || 0,
                ]);
            }
        });
        const ws1 = XLSX.utils.aoa_to_sheet(rows);
        ws1['!cols'] = headers.map(h => ({ wch: Math.max(12, Math.min(28, h.length + 2)) }));
        XLSX.utils.book_append_sheet(wb, ws1, 'Lotes_Operaciones');

        const agg = Calc.aggregate(lotes, settings);
        const resumenRows = [
            ['Capital Total Desplegado:', 'Retorno de Capital (Cash In):', 'Ganancia Neta Realizada:', 'Valor del Inventario en Bodega:', 'Margen Ponderado'],
            [agg.capitalDesplegado, agg.cashIn, agg.gananciaRealizada, agg.valorInventario, agg.margenPonderado],
            [],
            [],
            ['(SKU)', 'Total Piezas Importadas', 'Total Vendido', 'Stock Disponible', 'Margen Ponderado', 'Diagnóstico', 'Estrategia'],
            ...agg.rows.map(({ lote, calc }) => [
                lote.sku,
                lote.unidades,
                lote.vendidas,
                calc.inventarioRestante,
                calc.margen,
                (Number(lote.unidades) || 0) > 0 && (Number(lote.vendidas) || 0) === 0 ? 'Sin ventas aún' : 'En rotación',
                strategyLabel(calc.estrategia),
            ]),
        ];
        const ws2 = XLSX.utils.aoa_to_sheet(resumenRows);
        XLSX.utils.book_append_sheet(wb, ws2, 'Resumen_General');

        const ventasFlat = [];
        lotes.forEach(l => {
            (l.ventas || []).forEach(v => {
                ventasFlat.push([l.sku, l.producto, v.fecha, v.unidades, v.precio, v.unidades * v.precio, v.notas || '']);
            });
        });
        if (ventasFlat.length) {
            const ventasRows = [
                ['SKU', 'Producto', 'Fecha', 'Unidades', 'Precio', 'Total', 'Notas'],
                ...ventasFlat,
            ];
            const ws3 = XLSX.utils.aoa_to_sheet(ventasRows);
            XLSX.utils.book_append_sheet(wb, ws3, 'Ventas');
        }

        XLSX.writeFile(wb, filename);
    }

    function strategyLabel(s) {
        return {
            ESCALAR: '🟢 ESCALAR',
            MANTENER: '🟡 MANTENER',
            LIQUIDAR: '🔴 LIQUIDAR',
            AGOTADO: '🔵 AGOTADO',
            PAUSADA: '⏸️ PAUSADA',
            FINALIZADA: '❌ FINALIZADA',
        }[s] || s;
    }

    return { importFile, exportFile };
})();
window.ExcelIO = ExcelIO;
