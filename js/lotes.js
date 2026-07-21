/* ==========================================================================
   Vista Lotes — Inbox + Split resizable.
   Componentes: stats strip, chips multi-select, sorts, kebab menu,
   tabs en detalle (Rentabilidad · Inventario · Sugerencias · Historial),
   registro de ventas, sparkline, inline edit de precio y stock.
   ========================================================================== */

const LotesView = (() => {

    const local = {
        search: '',
        strategies: new Set(),   // Multi-select
        withStock: false,
        selected: null,          // familyKey (producto normalizado)
        selectedVariant: null,   // id del lote/variante activa
        sort: { key: 'utilidad', dir: 'desc' },
        detailTab: 'renta',
        margenObjetivoPct: 25,   // % editable en Sugerencias → compra ideal
    };

    let editing = null;
    let shellMounted = false;

    // ---- Format helpers -------------------------------------------------
    const cls = e => ({ ESCALAR: 'esc', MANTENER: 'man', LIQUIDAR: 'liq', AGOTADO: 'ago', PAUSADA: 'pau', FINALIZADA: 'fin' }[e] || '');
    const label = e => ({
        ESCALAR: '🟢 Escalar', MANTENER: '🟡 Mantener', LIQUIDAR: '🔴 Liquidar',
        AGOTADO: '🔵 Agotado', PAUSADA: '⏸️ Pausada', FINALIZADA: '❌ Finalizada',
    }[e] || e);
    const esc = UI.escapeHTML;
    const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const familyKey = l => l.productId || normalize(l.producto || '') || ('id:' + l.id);

    const STRAT_PRIORITY = { LIQUIDAR: 0, MANTENER: 1, ESCALAR: 2, AGOTADO: 3, PAUSADA: 4, FINALIZADA: 5 };

    // ---- Data pipeline --------------------------------------------------
    /** Filas individuales (lotes) que pasan filtros de búsqueda/estrategia/stock. */
    function matchingRows() {
        const q = normalize(local.search).trim();
        return window.State.lotes
            .map(l => ({ lote: l, calc: Calc.computeLote(l, window.State.settings) }))
            .filter(({ lote, calc }) => {
                if (local.strategies.size && !local.strategies.has(calc.estrategia)) return false;
                if (local.withStock && calc.inventarioRestante === 0) return false;
                if (!q) return true;
                return normalize(lote.sku).includes(q)
                    || normalize(lote.producto).includes(q)
                    || normalize(lote.variante).includes(q)
                    || normalize(lote.categoria).includes(q);
            });
    }

    /**
     * Agrupa lotes por nombre de producto.
     * La familia incluye TODAS las variantes del producto (aunque el filtro
     * solo haya matcheado una), para que el detalle muestre todos los colores.
     */
    function families() {
        const matched = matchingRows();
        const matchedKeys = new Set(matched.map(r => familyKey(r.lote)));
        const settings = window.State.settings;

        const byKey = new Map();
        window.State.lotes.forEach(l => {
            const key = familyKey(l);
            if (!matchedKeys.has(key)) return;
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push({
                lote: l,
                calc: Calc.computeLote(l, settings),
            });
        });

        const list = [...byKey.entries()].map(([key, variants]) => {
            variants.sort((a, b) => (a.lote.variante || '').localeCompare(b.lote.variante || '', 'es'));
            const stockRest = variants.reduce((s, v) => s + v.calc.inventarioRestante, 0);
            const stockTotal = variants.reduce((s, v) => s + (Number(v.lote.unidades) || 0), 0);
            const best = variants.slice().sort((a, b) => b.calc.utilidad - a.calc.utilidad)[0];
            const estrategia = variants.slice().sort((a, b) =>
                (STRAT_PRIORITY[a.calc.estrategia] ?? 9) - (STRAT_PRIORITY[b.calc.estrategia] ?? 9)
            )[0].calc.estrategia;
            const colores = [...new Set(variants.map(v => v.lote.variante).filter(Boolean))];
            const productId = variants[0].lote.productId;
            const imagen = Data.familyImage(window.State.lotes, productId)
                || variants.map(v => v.lote.imagen).find(Boolean)
                || '';
            return {
                key,
                productId,
                producto: variants[0].lote.producto,
                categoria: variants[0].lote.categoria,
                imagen,
                variants,
                colores,
                stockRest,
                stockTotal,
                utilidad: best.calc.utilidad,
                margen: best.calc.margen,
                roi: best.calc.roi,
                precio: Number(best.lote.precio) || 0,
                rotacion: variants.reduce((s, v) => s + v.calc.rotacion, 0) / variants.length,
                fecha: variants.map(v => v.lote.fecha || '').sort().reverse()[0],
                estrategia,
            };
        });

        return list.sort(compareFamilies);
    }

    function compareFamilies(a, b) {
        const { key, dir } = local.sort;
        const get = f => ({
            utilidad: f.utilidad,
            margen: f.margen,
            roi: f.roi,
            precio: f.precio,
            stock: f.stockRest,
            rotacion: f.rotacion,
            fecha: f.fecha || '',
            producto: f.producto || '',
        }[key]);
        const va = get(a), vb = get(b);
        if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        return dir === 'asc' ? va - vb : vb - va;
    }

    function totalProductCount() {
        return new Set(window.State.lotes.map(l => familyKey(l))).size;
    }

    // ---- Shell (una vez) ------------------------------------------------
    function renderShell() {
        document.getElementById('lotes-canvas').innerHTML = `
            <div class="view-head">
                <div>
                    <h2>Productos</h2>
                    <p class="muted" id="lotes-header-sub"></p>
                </div>
                <div class="view-actions">
                    <button class="btn primary" id="lotes-new">+ Agregar producto</button>
                </div>
            </div>

            <div class="stats-strip" id="lotes-stats"></div>

            <div class="lotes-shell">
                <div class="lotes-toolbar">
                    <div class="grow">
                        <input type="search" id="lotes-search" placeholder="Filtrar por SKU, nombre, variante o categoría…">
                    </div>
                    <div class="chip-row" id="lotes-chips"></div>
                </div>

                <div class="lotes-split" id="lotes-split">
                    <div class="lotes-list" id="lotes-list"></div>
                    <div class="lotes-resizer" id="lotes-resizer" title="Doble click para reiniciar ancho"></div>
                    <div class="lotes-detail" id="lotes-detail"></div>
                </div>
            </div>
        `;
        bindShellEvents();
        initResizer();
        shellMounted = true;
    }

    function bindShellEvents() {
        document.getElementById('lotes-search').addEventListener('input', e => {
            local.search = e.target.value;
            renderContent();
        });
        document.getElementById('lotes-new').addEventListener('click', () => openModal(null));
    }

    function initResizer() {
        const split = document.getElementById('lotes-split');
        const resizer = document.getElementById('lotes-resizer');
        const saved = parseInt(localStorage.getItem('vm-list-width') || '400', 10);
        if (!isNaN(saved) && saved >= 280 && saved <= 700) {
            split.style.setProperty('--list-w', saved + 'px');
        }
        let dragging = false;
        const start = e => {
            dragging = true;
            resizer.classList.add('dragging');
            document.body.classList.add('resizing');
            e.preventDefault();
        };
        const move = e => {
            if (!dragging) return;
            const rect = split.getBoundingClientRect();
            let w = Math.round(e.clientX - rect.left);
            w = Math.max(280, Math.min(700, w));
            split.style.setProperty('--list-w', w + 'px');
        };
        const end = () => {
            if (!dragging) return;
            dragging = false;
            resizer.classList.remove('dragging');
            document.body.classList.remove('resizing');
            const w = split.style.getPropertyValue('--list-w').replace('px', '').trim();
            if (w) localStorage.setItem('vm-list-width', w);
        };
        resizer.addEventListener('mousedown', start);
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', end);
        resizer.addEventListener('dblclick', () => {
            split.style.setProperty('--list-w', '400px');
            localStorage.setItem('vm-list-width', '400');
        });
    }

    // ---- Render principal ----------------------------------------------
    function render() {
        if (!shellMounted) renderShell();
        syncToolbar();
        renderContent();
    }

    function syncToolbar() {
        const s = document.getElementById('lotes-search');
        if (s && s.value !== local.search) s.value = local.search;
    }

    function renderContent() {
        const list = families();
        if (list.length && (!local.selected || !list.find(f => f.key === local.selected))) {
            local.selected = list[0].key;
            local.selectedVariant = list[0].variants[0].lote.id;
        } else if (!list.length) {
            local.selected = null;
            local.selectedVariant = null;
        }

        const family = list.find(f => f.key === local.selected) || null;
        if (family) {
            const stillThere = family.variants.find(v => v.lote.id === local.selectedVariant);
            if (!stillThere) local.selectedVariant = family.variants[0].lote.id;
        }

        const variantRow = family
            ? family.variants.find(v => v.lote.id === local.selectedVariant) || family.variants[0]
            : null;

        const nProd = list.length;
        const nTotal = totalProductCount();
        const nVar = window.State.lotes.length;
        const subEl = document.getElementById('lotes-header-sub');
        if (subEl) {
            subEl.textContent = nProd === nTotal
                ? `${nProd} producto${nProd === 1 ? '' : 's'} · ${nVar} variante${nVar === 1 ? '' : 's'} · Arrastra la línea vertical para redimensionar`
                : `${nProd} de ${nTotal} productos · ${nVar} variantes · Arrastra la línea vertical para redimensionar`;
        }

        document.getElementById('lotes-stats').innerHTML = renderStats();
        document.getElementById('lotes-chips').innerHTML = renderChips();
        document.getElementById('lotes-list').innerHTML = renderList(list);
        document.getElementById('lotes-detail').innerHTML = renderDetail(family, variantRow);

        bindDynamicEvents();

        const sbCount = document.getElementById('sb-count-lotes');
        if (sbCount) sbCount.textContent = nTotal;
        const alertBadge = document.getElementById('sb-count-insights');
        if (alertBadge && window.InsightsView) {
            const c = InsightsView.alertCount();
            alertBadge.textContent = c;
            alertBadge.classList.toggle('badge-alert', c > 0);
        }
    }

    // ---- Stats strip ---------------------------------------------------
    function renderStats() {
        const agg = Calc.aggregate(window.State.lotes, window.State.settings);
        const nProd = totalProductCount();
        const escN = agg.strategyCount.ESCALAR || 0;
        const manN = agg.strategyCount.MANTENER || 0;
        const liqN = agg.strategyCount.LIQUIDAR || 0;
        const agoN = agg.strategyCount.AGOTADO || 0;
        const pauN = agg.strategyCount.PAUSADA || 0;
        const activos = agg.rows.filter(r => r.calc.inventarioRestante > 0).length;
        const utilPot = agg.rows.reduce((s, r) => s + r.calc.utilidad * r.calc.inventarioRestante, 0);
        const total = agg.rows.length || 1;

        return `
            <div class="stat">
                <div class="stat-label"><span class="stat-icon">📦</span>Productos</div>
                <div class="stat-value">${nProd}</div>
                <div class="stat-sub">${agg.rows.length} variante${agg.rows.length === 1 ? '' : 's'} · ${activos} con stock</div>
            </div>
            <div class="stat">
                <div class="stat-label"><span class="stat-icon">💰</span>Capital desplegado</div>
                <div class="stat-value">${Calc.fmtMXN(agg.capitalDesplegado)}</div>
                <div class="stat-sub">Inventario al costo: ${Calc.fmtMXN(agg.valorInventario)}</div>
            </div>
            <div class="stat">
                <div class="stat-label"><span class="stat-icon">📈</span>Ganancia realizada</div>
                <div class="stat-value ${agg.gananciaRealizada >= 0 ? 'pos' : 'neg'}">${Calc.fmtMXN(agg.gananciaRealizada)}</div>
                <div class="stat-sub">Por precio real de cada venta</div>
            </div>
            <div class="stat">
                <div class="stat-label"><span class="stat-icon">🎯</span>Utilidad potencial</div>
                <div class="stat-value ${utilPot >= 0 ? 'pos' : 'neg'}">${Calc.fmtMXN(utilPot)}</div>
                <div class="stat-sub">Al vender inventario restante</div>
            </div>
            <div class="stat stat-dist">
                <div class="stat-label"><span class="stat-icon">🚦</span>Semáforo de estrategia</div>
                <div class="dist-track">
                    <div class="dist-seg esc" style="width:${(escN/total)*100}%"></div>
                    <div class="dist-seg man" style="width:${(manN/total)*100}%"></div>
                    <div class="dist-seg liq" style="width:${(liqN/total)*100}%"></div>
                    <div class="dist-seg ago" style="width:${(agoN/total)*100}%"></div>
                    <div class="dist-seg pau" style="width:${(pauN/total)*100}%"></div>
                </div>
                <div class="dist-legend">
                    <button class="d-leg" data-strat="ESCALAR"><span class="d esc"></span>Escalar ${escN}</button>
                    <button class="d-leg" data-strat="MANTENER"><span class="d man"></span>Mantener ${manN}</button>
                    <button class="d-leg" data-strat="LIQUIDAR"><span class="d liq"></span>Liquidar ${liqN}</button>
                    ${agoN > 0 ? `<button class="d-leg" data-strat="AGOTADO"><span class="d ago"></span>Agotado ${agoN}</button>` : ''}
                    ${pauN > 0 ? `<button class="d-leg" data-strat="PAUSADA"><span class="d pau"></span>Pausada ${pauN}</button>` : ''}
                </div>
            </div>
        `;
    }

    // ---- Chip filters --------------------------------------------------
    function renderChips() {
        const chips = [
            { key: 'ESCALAR',  cls: 'esc', label: '🟢 Escalar' },
            { key: 'MANTENER', cls: 'man', label: '🟡 Mantener' },
            { key: 'LIQUIDAR', cls: 'liq', label: '🔴 Liquidar' },
            { key: 'AGOTADO',  cls: 'ago', label: '🔵 Agotado' },
            { key: 'PAUSADA',  cls: 'pau', label: '⏸️ Pausada' },
        ];
        return chips.map(c => `
            <button class="chip ${c.cls} ${local.strategies.has(c.key) ? 'active' : ''}" data-chip="${c.key}">
                ${c.label}
            </button>
        `).join('') + `
            <button class="chip ${local.withStock ? 'active' : ''}" data-toggle="withStock" title="Solo mostrar productos con stock">
                📦 Con stock
            </button>
            ${local.strategies.size || local.withStock ? `
                <button class="chip chip-clear" data-clear-filters>× Limpiar</button>
            ` : ''}
        `;
    }

    // ---- Lista tipo inbox (agrupada por producto) ----------------------
    function renderList(list) {
        const head = `
            <div class="lotes-list-head">
                <span>${list.length} producto${list.length===1?'':'s'}</span>
                <div class="lotes-list-head-actions">
                    <select class="lotes-sort-select" id="lotes-sort-select">
                        <option value="utilidad" ${local.sort.key==='utilidad'?'selected':''}>Utilidad</option>
                        <option value="margen"  ${local.sort.key==='margen'?'selected':''}>Margen</option>
                        <option value="roi"     ${local.sort.key==='roi'?'selected':''}>ROI</option>
                        <option value="stock"   ${local.sort.key==='stock'?'selected':''}>Stock</option>
                        <option value="rotacion" ${local.sort.key==='rotacion'?'selected':''}>Rotación</option>
                        <option value="precio"  ${local.sort.key==='precio'?'selected':''}>Precio</option>
                        <option value="fecha"   ${local.sort.key==='fecha'?'selected':''}>Fecha</option>
                        <option value="producto" ${local.sort.key==='producto'?'selected':''}>Nombre</option>
                    </select>
                    <button class="lotes-sort-dir" data-sort-dir title="Alternar dirección">
                        ${local.sort.dir === 'asc' ? '↑' : '↓'}
                    </button>
                </div>
            </div>
        `;

        if (!list.length) {
            return head + `<div class="lotes-empty-list">
                <div style="font-size:32px; opacity:0.35; margin-bottom:8px">🔍</div>
                <div>Sin resultados. Ajusta filtros o crea un nuevo lote.</div>
            </div>`;
        }

        const items = list.map(f => {
            const colorLine = f.colores.length
                ? (f.colores.length === 1
                    ? esc(f.colores[0])
                    : `${f.colores.length} colores · ${f.colores.map(esc).join(' · ')}`)
                : `${f.variants.length} variante${f.variants.length === 1 ? '' : 's'}`;
            const thumb = f.imagen
                ? `<img class="lotes-row-thumb" src="${f.imagen}" alt="" loading="lazy">`
                : `<span class="lotes-row-thumb is-empty" aria-hidden="true"></span>`;
            return `
            <div class="lotes-row ${f.key===local.selected?'active':''}" data-select="${esc(f.key)}">
                <span class="lotes-dot ${cls(f.estrategia)}" title="${label(f.estrategia)}"></span>
                ${thumb}
                <div class="lotes-info">
                    <div class="lotes-name">${esc(f.producto)}</div>
                    <div class="lotes-sub">
                        <span>${colorLine}</span>
                        ${f.categoria ? `<span>·</span><span>${esc(f.categoria)}</span>` : ''}
                        <span>·</span>
                        <span>Stock ${f.stockRest}/${f.stockTotal}</span>
                    </div>
                </div>
                <div class="lotes-metric ${f.utilidad>=0?'pos':'neg'}">
                    ${Calc.fmtMXN(f.utilidad)}
                    <small>${Calc.fmtPct(f.margen)} margen</small>
                </div>
            </div>`;
        }).join('');

        return head + items;
    }

    // ---- Detalle con tabs + selector de colores ------------------------
    function renderDetail(family, row) {
        if (!family || !row) {
            return `
                <div class="lotes-empty">
                    <div>
                        <div class="lotes-empty-icon">📦</div>
                        <div><strong>Selecciona un producto</strong></div>
                        <div class="small muted" style="margin-top:4px">Su desglose y recomendaciones aparecerán aquí</div>
                    </div>
                </div>
            `;
        }
        const { lote, calc } = row;
        const multi = family.variants.length > 1;
        const imagen = family.imagen || lote.imagen || '';
        const productId = family.productId || lote.productId || '';

        const colorPills = multi ? `
            <div class="variant-pills" role="tablist" aria-label="Colores / variantes">
                ${family.variants.map(v => `
                    <button type="button"
                        class="variant-pill ${v.lote.id === lote.id ? 'active' : ''}"
                        data-pick-variant="${v.lote.id}"
                        title="${esc(v.lote.sku)} · Stock ${v.calc.inventarioRestante}/${v.lote.unidades}">
                        <span class="variant-pill-dot ${cls(v.calc.estrategia)}"></span>
                        <span class="variant-pill-name">${esc(v.lote.variante || 'Sin color')}</span>
                        <span class="variant-pill-stock">${v.calc.inventarioRestante}</span>
                    </button>
                `).join('')}
            </div>
        ` : '';

        const imageBlock = `
            <div class="product-image" data-product-image="${esc(productId)}">
                ${imagen
                    ? `<button type="button" class="product-image-thumb-btn" data-action="pick-image" data-product-id="${esc(productId)}" title="Cambiar imagen" aria-label="Cambiar imagen">
                        <img class="product-image-thumb" src="${imagen}" alt="Foto de ${esc(lote.producto)}">
                       </button>`
                    : `<button type="button" class="product-image-placeholder" data-action="pick-image" data-product-id="${esc(productId)}" title="Agregar imagen" aria-label="Agregar imagen">
                        <span class="product-image-ph-icon" aria-hidden="true"></span>
                        <span>Agregar imagen</span>
                       </button>`}
                <div class="product-image-actions">
                    <button type="button" class="btn ghost sm" data-action="pick-image" data-product-id="${esc(productId)}">${imagen ? 'Cambiar' : 'Subir'}</button>
                    ${imagen ? `<button type="button" class="btn ghost sm danger-text" data-action="clear-image" data-product-id="${esc(productId)}">Quitar</button>` : ''}
                </div>
            </div>
        `;

        const tabs = [
            { key: 'renta', label: 'Rentabilidad' },
            { key: 'inv',   label: 'Inventario' },
            { key: 'reco',  label: 'Sugerencias' },
            { key: 'hist',  label: `Historial${lote.historial?.length ? ` (${lote.historial.length})` : ''}` },
        ];

        return `
            <div class="lotes-detail-head">
                <div class="lotes-detail-topline">
                    <div class="lotes-detail-meta">
                        <code>${esc(lote.sku)}</code>
                        <span>·</span>
                        <span>${esc(lote.tipo)}</span>
                        ${lote.categoria ? `<span>·</span><span>${esc(lote.categoria)}</span>` : ''}
                        <span>·</span>
                        <span>Compra ${Calc.fmtDate(lote.fecha)}</span>
                        ${multi ? `<span>·</span><span>${family.variants.length} colores</span>` : ''}
                    </div>
                    <div class="kebab" data-kebab>
                        <button class="icon-btn" data-kebab-btn aria-label="Más acciones">⋯</button>
                        <div class="kebab-menu" data-kebab-menu hidden>
                            <button class="kebab-item" data-action="edit"    data-id="${lote.id}">✏️ Editar</button>
                            <button class="kebab-item" data-action="sale"    data-id="${lote.id}">🛒 Registrar venta</button>
                            <button class="kebab-item" data-action="restock" data-id="${lote.id}">📦 Reabastecer SKU</button>
                            <button class="kebab-item" data-action="dup"     data-id="${lote.id}">🧬 Duplicar variante</button>
                            <button class="kebab-item" data-action="status"  data-id="${lote.id}">🔀 Cambiar estatus</button>
                            <div class="kebab-sep"></div>
                            <button class="kebab-item danger" data-action="del" data-id="${lote.id}">🗑 Eliminar lote</button>
                        </div>
                    </div>
                </div>
                <div class="lotes-detail-title-row">
                    ${imageBlock}
                    <div class="lotes-detail-title-text">
                        <h2 class="lotes-detail-name">${esc(lote.producto)}</h2>
                        ${colorPills}
                        <div class="lotes-detail-variant">
                            ${multi ? '' : `<strong>${esc(lote.variante || '—')}</strong> · `}
                            <span class="editable-price" data-edit-field="precio" data-id="${lote.id}" title="Click para editar precio">${Calc.fmtMXN(lote.precio)}</span>
                            ${lote.precioCompetencia ? `· <span class="muted">Competencia: ${Calc.fmtMXN(lote.precioCompetencia)}</span>` : ''}
                            · <span class="badge ${cls(calc.estrategia)}">${label(calc.estrategia)}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="kpi-grid-detail">
                <div class="kpi-mini">
                    <div class="kpi-mini-label">Utilidad</div>
                    <div class="kpi-mini-value ${calc.utilidad>=0?'pos':'neg'}">${Calc.fmtMXN(calc.utilidad)}</div>
                </div>
                <div class="kpi-mini">
                    <div class="kpi-mini-label">Margen</div>
                    <div class="kpi-mini-value">${Calc.fmtPct(calc.margen)}</div>
                </div>
                <div class="kpi-mini">
                    <div class="kpi-mini-label">Stock</div>
                    <div class="kpi-mini-value editable-stock" data-edit-field="stock" data-id="${lote.id}" title="Click para editar unidades del lote">${calc.inventarioRestante}<small style="opacity:0.5">/${lote.unidades}</small></div>
                </div>
                ${(() => {
                    const r = Calc.rangoCompraIdeal(lote, window.State.settings);
                    if (!r) return `
                        <div class="kpi-mini kpi-ideal">
                            <div class="kpi-mini-label">Compra ideal</div>
                            <div class="kpi-mini-value">—</div>
                        </div>`;
                    const verdictCls = r.verdict === 'excelente' ? 'pos' : r.verdict === 'caro' ? 'neg' : '';
                    const verdictTxt = r.verdict === 'excelente' ? '≥30% OK'
                        : r.verdict === 'sano' ? '20–30% OK'
                        : r.verdict === 'caro' ? 'arriba del tope' : '';
                    return `
                        <div class="kpi-mini kpi-ideal" title="Costo máx. para margen 30% → 20% al precio de venta actual (ya descontando comisión, envío y SAT)">
                            <div class="kpi-mini-label">Compra ideal</div>
                            <div class="kpi-mini-value ${verdictCls}">${Calc.fmtMXN(r.min)}–${Calc.fmtMXN(r.max)}</div>
                            <div class="kpi-mini-hint">para 30%–20% · hoy ${Calc.fmtMXN(r.actual)} ${verdictTxt}</div>
                        </div>`;
                })()}
            </div>

            <nav class="detail-tabs" role="tablist">
                ${tabs.map(t => `
                    <button class="detail-tab ${local.detailTab===t.key?'active':''}" data-detail-tab="${t.key}">${t.label}</button>
                `).join('')}
            </nav>

            <div class="detail-tab-content">
                ${renderDetailTab(lote, calc)}
            </div>
        `;
    }

    function renderDetailTab(lote, calc) {
        if (local.detailTab === 'renta') return renderTabRentabilidad(lote, calc);
        if (local.detailTab === 'inv') return renderTabInventario(lote, calc);
        if (local.detailTab === 'reco') return renderTabRecomendacion(lote, calc);
        if (local.detailTab === 'hist') return renderTabHistorial(lote, calc);
        return '';
    }

    function renderTabRentabilidad(lote, calc) {
        return `
            <h4>Desglose por unidad</h4>
            <div class="breakdown">
                <div class="breakdown-row"><span class="label">Precio de venta</span><span class="val">${Calc.fmtMXN(lote.precio)}</span></div>
                <div class="breakdown-row"><span class="label">Costo unitario</span><span class="val">− ${Calc.fmtMXN(lote.costo)}</span></div>
                <div class="breakdown-row"><span class="label">Comisión Meli (${(calc.pctComision*100).toFixed(0)}%)</span><span class="val">− ${Calc.fmtMXN(calc.comisionVariable)}</span></div>
                ${calc.cargoFijo ? `<div class="breakdown-row"><span class="label">Cargo fijo publicación</span><span class="val">− ${Calc.fmtMXN(calc.cargoFijo)}</span></div>` : ''}
                <div class="breakdown-row"><span class="label">Envío al cliente</span><span class="val">− ${Calc.fmtMXN(lote.envio)}</span></div>
                <div class="breakdown-row"><span class="label">Retención IVA SAT</span><span class="val">− ${Calc.fmtMXN(calc.retIVA)}</span></div>
                <div class="breakdown-row"><span class="label">Retención ISR SAT</span><span class="val">− ${Calc.fmtMXN(calc.retISR)}</span></div>
                <div class="breakdown-row total">
                    <span class="label">Utilidad neta por unidad</span>
                    <span class="val ${calc.utilidad>=0?'pos':'neg'}">${Calc.fmtMXN(calc.utilidad)}</span>
                </div>
            </div>
        `;
    }

    function renderTabInventario(lote, calc) {
        const family = families().find(f => f.key === familyKey(lote))
            || {
                variants: [{ lote, calc }],
                colores: lote.variante ? [lote.variante] : [],
                stockRest: calc.inventarioRestante,
                stockTotal: Number(lote.unidades) || 0,
            };
        const multi = family.variants.length > 1;
        const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
        const sparkHTML = ventasSparkline(ventas, calc);

        // Stock de todas las variantes del producto
        const stockBlock = multi ? `
            <h4>Stock por color</h4>
            <div class="variant-stock-grid">
                ${family.variants.map(v => `
                    <button type="button"
                        class="variant-stock-card ${v.lote.id === lote.id ? 'active' : ''}"
                        data-pick-variant="${v.lote.id}">
                        <div class="vsc-top">
                            <span class="variant-pill-dot ${cls(v.calc.estrategia)}"></span>
                            <strong>${esc(v.lote.variante || 'Sin color')}</strong>
                        </div>
                        <div class="vsc-stock">${v.calc.inventarioRestante}<small>/${v.lote.unidades}</small></div>
                        <div class="vsc-sub">${v.lote.vendidas || 0} vendida${(v.lote.vendidas || 0) === 1 ? '' : 's'}</div>
                    </button>
                `).join('')}
            </div>
            <div class="breakdown" style="margin-top:12px">
                <div class="breakdown-row total">
                    <span class="label">Stock total del producto</span>
                    <span class="val">${family.stockRest}<small style="opacity:.5">/${family.stockTotal}</small></span>
                </div>
            </div>
        ` : `
            <h4>Inversión y rotación del lote</h4>
            <div class="breakdown">
                <div class="breakdown-row"><span class="label">Unidades del lote</span><span class="val">${lote.unidades}</span></div>
                <div class="breakdown-row"><span class="label">Unidades vendidas</span><span class="val">${lote.vendidas || 0}</span></div>
                <div class="breakdown-row"><span class="label">Inventario restante</span><span class="val">${calc.inventarioRestante}</span></div>
                <div class="breakdown-row"><span class="label">Rotación</span><span class="val">${Calc.fmtPct(calc.rotacion)}</span></div>
                <div class="breakdown-row"><span class="label">Inversión total</span><span class="val">${Calc.fmtMXN(calc.inversion)}</span></div>
                <div class="breakdown-row"><span class="label">Cash In (ventas)</span><span class="val">${Calc.fmtMXN(calc.cashIn)}</span></div>
                <div class="breakdown-row total">
                    <span class="label">Ganancia realizada</span>
                    <span class="val ${calc.gananciaRealizada>=0?'pos':'neg'}">${Calc.fmtMXN(calc.gananciaRealizada)}</span>
                </div>
            </div>
        `;

        // Ventas: si hay varias variantes, listar las del producto con columna color
        const allVentas = multi
            ? family.variants.flatMap(v => (v.lote.ventas || []).map(venta => ({
                ...venta,
                variante: v.lote.variante || '—',
                loteId: v.lote.id,
                colorCls: cls(v.calc.estrategia),
            }))).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
            : ventas.map(v => ({ ...v, variante: null, loteId: lote.id }));

        return `
            ${stockBlock}

            ${multi ? `
                <h4 style="margin-top:18px">${esc(lote.variante || 'Variante')} · detalle</h4>
                <div class="breakdown">
                    <div class="breakdown-row"><span class="label">SKU</span><span class="val"><code>${esc(lote.sku)}</code></span></div>
                    <div class="breakdown-row"><span class="label">Rotación</span><span class="val">${Calc.fmtPct(calc.rotacion)}</span></div>
                    <div class="breakdown-row"><span class="label">Inversión</span><span class="val">${Calc.fmtMXN(calc.inversion)}</span></div>
                    <div class="breakdown-row"><span class="label">Cash In</span><span class="val">${Calc.fmtMXN(calc.cashIn)}</span></div>
                    <div class="breakdown-row total">
                        <span class="label">Ganancia realizada</span>
                        <span class="val ${calc.gananciaRealizada>=0?'pos':'neg'}">${Calc.fmtMXN(calc.gananciaRealizada)}</span>
                    </div>
                </div>
            ` : ''}

            <div class="section-flex">
                <h4>${multi ? 'Ventas del producto' : 'Registro de ventas'}</h4>
                <div class="section-flex-actions">
                    <button class="btn btn-sm" data-action="restock" data-id="${lote.id}">📦 Reabastecer</button>
                    <button class="btn primary btn-sm" data-action="sale" data-id="${lote.id}">+ Registrar venta</button>
                </div>
            </div>
            ${!multi ? sparkHTML : ''}
            ${allVentas.length ? `
                <table class="mini-table" style="margin-top:8px">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            ${multi ? '<th>Color</th>' : ''}
                            <th class="num">Uds.</th>
                            <th class="num">Precio</th>
                            <th class="num">Total</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allVentas.map(v => `
                            <tr>
                                <td>${Calc.fmtDate(v.fecha)}</td>
                                ${multi ? `<td><span class="color-chip"><span class="variant-pill-dot ${v.colorCls || ''}"></span>${esc(v.variante)}</span></td>` : ''}
                                <td class="num">${v.unidades}</td>
                                <td class="num">${Calc.fmtMXN(v.precio)}</td>
                                <td class="num">${Calc.fmtMXN(v.precio * v.unidades)}</td>
                                <td class="num"><button class="icon-btn" data-action="del-venta" data-lote="${v.loteId}" data-venta="${v.id}" title="Eliminar venta">×</button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : `<p class="muted small" style="margin-top:8px">Sin ventas registradas. Presiona <strong>+ Registrar venta</strong> y elige el color.</p>`}
        `;
    }

    function renderTabRecomendacion(lote, calc) {
        const recs = Calc.getRecomendaciones(lote, calc);
        const recsHTML = recs.map(rec => `
            <div class="recomend ${rec.cls === 'danger' ? 'danger' : rec.cls === 'warn' ? 'warn' : ''}">
                <span class="recomend-icon">${rec.icon}</span>
                <div class="recomend-text">
                    <strong>${rec.title}</strong>
                    <div style="margin-top:4px">${rec.text}</div>
                </div>
            </div>
        `).join('');

        return `
            ${renderCompraIdealSection(lote)}
            <h4 style="margin-top:18px">Acciones sugeridas</h4>
            ${recsHTML || `<p class="muted small">Sin sugerencias adicionales por ahora.</p>`}
        `;
    }

    function renderCompraIdealSection(lote) {
        const pct = Number(local.margenObjetivoPct);
        const margen = (Number.isFinite(pct) ? pct : 25) / 100;
        const a = Calc.analisisCostoIdeal(lote, margen, window.State.settings);

        if (!a) {
            return `
                <section class="compra-ideal" id="compra-ideal-panel" data-lote-id="${esc(lote.id)}">
                    <h4>Costo de adquisición ideal</h4>
                    <p class="muted small">Define un precio de venta para calcular el costo máximo de compra.</p>
                </section>
            `;
        }

        return `
            <section class="compra-ideal" id="compra-ideal-panel" data-lote-id="${esc(lote.id)}">
                <h4>Costo de adquisición ideal</h4>
                <p class="ci-explain muted small">
                    Partimos del <strong>precio de venta</strong> (${Calc.fmtMXN(a.precio)}), restamos comisión Meli,
                    cargo fijo, envío y retenciones SAT. El resultado es el <strong>costo máximo</strong> al que
                    deberías comprar para lograr el margen objetivo.
                </p>
                <div class="ci-margen-row">
                    <label class="ci-margen-label">
                        <span>Margen objetivo</span>
                        <span class="ci-margen-input-wrap">
                            <input type="number" id="ci-margen" value="${Number.isFinite(pct) ? pct : 25}" min="5" max="60" step="1" inputmode="decimal">
                            <span class="ci-margen-suffix">%</span>
                        </span>
                    </label>
                    <div class="ci-margen-presets" role="group" aria-label="Márgenes rápidos">
                        ${[20, 25, 30].map(p => `
                            <button type="button" class="ci-preset ${p === Math.round(margen * 100) ? 'active' : ''}" data-margen-preset="${p}">${p}%</button>
                        `).join('')}
                    </div>
                </div>
                <div id="compra-ideal-body">
                    ${compraIdealBodyHTML(a)}
                </div>
            </section>
        `;
    }

    function compraIdealBodyHTML(a) {
        const b = a.breakdown;
        const verdictMap = {
            mejor: {
                cls: '',
                icon: '✅',
                title: 'Por debajo del tope',
                text: `Tu costo actual (${Calc.fmtMXN(a.actual)}) está <strong>${Calc.fmtMXN(Math.abs(a.diff))}</strong> bajo el ideal.
                    Margen actual <strong>${Calc.fmtPct(a.margenActual)}</strong> vs objetivo <strong>${Calc.fmtPct(a.margenObjetivo)}</strong>.`,
            },
            en_objetivo: {
                cls: '',
                icon: '🎯',
                title: 'En el costo ideal',
                text: `Compraste muy cerca del tope para ${Calc.fmtPct(a.margenObjetivo)}. Margen actual: <strong>${Calc.fmtPct(a.margenActual)}</strong>.`,
            },
            arriba: {
                cls: 'warn',
                icon: '⚠️',
                title: 'Arriba del costo ideal',
                text: `Tu costo actual (${Calc.fmtMXN(a.actual)}) supera el tope por <strong>${Calc.fmtMXN(a.diff)}</strong>.
                    Para ${Calc.fmtPct(a.margenObjetivo)} deberías comprar a lo sumo <strong>${Calc.fmtMXN(a.ideal)}</strong>.
                    Hoy tu margen es <strong>${Calc.fmtPct(a.margenActual)}</strong>.`,
            },
        };
        const v = verdictMap[a.verdict] || verdictMap.en_objetivo;
        const diffCls = a.diff > 0.5 ? 'neg' : a.diff < -0.5 ? 'pos' : '';

        return `
            <div class="breakdown">
                <div class="breakdown-row"><span class="label">Precio de venta</span><span class="val">${Calc.fmtMXN(a.precio)}</span></div>
                <div class="breakdown-row"><span class="label">Comisión Meli (${(b.pctComision * 100).toFixed(0)}%)</span><span class="val">− ${Calc.fmtMXN(b.comisionVariable)}</span></div>
                ${b.cargoFijo ? `<div class="breakdown-row"><span class="label">Cargo fijo</span><span class="val">− ${Calc.fmtMXN(b.cargoFijo)}</span></div>` : ''}
                <div class="breakdown-row"><span class="label">Envío</span><span class="val">− ${Calc.fmtMXN(b.envio)}</span></div>
                <div class="breakdown-row"><span class="label">Retención IVA SAT</span><span class="val">− ${Calc.fmtMXN(b.retIVA)}</span></div>
                <div class="breakdown-row"><span class="label">Retención ISR SAT</span><span class="val">− ${Calc.fmtMXN(b.retISR)}</span></div>
                <div class="breakdown-row"><span class="label">Margen objetivo (${Calc.fmtPct(a.margenObjetivo)})</span><span class="val">− ${Calc.fmtMXN(a.precio * a.margenObjetivo)}</span></div>
                <div class="breakdown-row total">
                    <span class="label">Costo ideal máx. de compra</span>
                    <span class="val pos">${Calc.fmtMXN(a.ideal)}</span>
                </div>
            </div>
            <div class="ci-compare">
                <div class="ci-compare-item">
                    <div class="ci-compare-label">Tu costo actual</div>
                    <div class="ci-compare-value">${Calc.fmtMXN(a.actual)}</div>
                </div>
                <div class="ci-compare-item">
                    <div class="ci-compare-label">Costo ideal</div>
                    <div class="ci-compare-value pos">${Calc.fmtMXN(a.ideal)}</div>
                </div>
                <div class="ci-compare-item">
                    <div class="ci-compare-label">Diferencia</div>
                    <div class="ci-compare-value ${diffCls}">${a.diff > 0 ? '+' : ''}${Calc.fmtMXN(a.diff)}</div>
                </div>
            </div>
            <div class="recomend ${v.cls}" style="margin-top:12px;margin-bottom:0">
                <span class="recomend-icon">${v.icon}</span>
                <div class="recomend-text">
                    <strong>${v.title}</strong>
                    <div style="margin-top:4px">${v.text}</div>
                </div>
            </div>
        `;
    }

    function refreshCompraIdealBody(loteId) {
        const body = document.getElementById('compra-ideal-body');
        if (!body) return;
        const lote = window.State.lotes.find(x => x.id === loteId);
        if (!lote) return;
        const pct = Number(local.margenObjetivoPct);
        const margen = (Number.isFinite(pct) ? Math.min(60, Math.max(5, pct)) : 25) / 100;
        const a = Calc.analisisCostoIdeal(lote, margen, window.State.settings);
        if (!a) {
            body.innerHTML = `<p class="muted small">No se pudo calcular.</p>`;
            return;
        }
        body.innerHTML = compraIdealBodyHTML(a);
        document.querySelectorAll('[data-margen-preset]').forEach(btn => {
            btn.classList.toggle('active', Number(btn.dataset.margenPreset) === Math.round(margen * 100));
        });
    }

    function bindCompraIdealControls() {
        const panel = document.getElementById('compra-ideal-panel');
        if (!panel) return;
        const loteId = panel.dataset.loteId;
        const input = document.getElementById('ci-margen');
        if (input) {
            input.addEventListener('input', () => {
                let pct = Number(input.value);
                if (!Number.isFinite(pct)) return;
                pct = Math.min(60, Math.max(5, pct));
                local.margenObjetivoPct = pct;
                refreshCompraIdealBody(loteId);
            });
            input.addEventListener('change', () => {
                let pct = Number(input.value);
                if (!Number.isFinite(pct)) pct = 25;
                pct = Math.min(60, Math.max(5, pct));
                local.margenObjetivoPct = pct;
                input.value = String(pct);
                refreshCompraIdealBody(loteId);
            });
        }
        document.querySelectorAll('[data-margen-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
                const pct = Number(btn.dataset.margenPreset);
                local.margenObjetivoPct = pct;
                if (input) input.value = String(pct);
                refreshCompraIdealBody(loteId);
            });
        });
    }

    function renderTabHistorial(lote, calc) {
        const eventos = [...(lote.historial || [])].reverse();
        if (!eventos.length) {
            return `<p class="muted small">Sin eventos registrados aún.</p>`;
        }
        return `
            <ul class="timeline">
                ${eventos.map(e => `
                    <li class="tl-item">
                        <div class="tl-dot"></div>
                        <div class="tl-body">
                            <div class="tl-time">${new Date(e.ts).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</div>
                            <div class="tl-title">${eventDescription(e)}</div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    function eventDescription(e) {
        if (e.tipo === 'creacion') return `📦 Producto creado — <code>${esc(e.meta.sku)}</code>`;
        if (e.tipo === 'edicion') {
            const changes = (e.meta.changes || []).map(c => `<code>${c.field}</code>: ${esc(c.from)} → ${esc(c.to)}`).join(', ');
            return `✏️ Editado — ${changes || 'sin cambios detectados'}`;
        }
        if (e.tipo === 'venta') {
            return `🛒 Venta registrada — ${e.meta.unidades} uds. a ${Calc.fmtMXN(e.meta.precio)}`;
        }
        if (e.tipo === 'venta-cancelada') {
            return `↩️ Venta cancelada — ${e.meta.unidades} uds.`;
        }
        if (e.tipo === 'reabastecimiento') {
            return `📦 Reabastecimiento — +${e.meta.unidades} uds a ${Calc.fmtMXN(e.meta.costoUnitario)} · costo promedio ${Calc.fmtMXN(e.meta.costoAnterior)} → ${Calc.fmtMXN(e.meta.costoPromedio)}${e.meta.notas ? ` · ${esc(e.meta.notas)}` : ''}`;
        }
        return `• ${esc(e.tipo)}`;
    }

    // Sparkline SVG simple de ventas por semana (últimas 8 semanas).
    function ventasSparkline(ventas, calc) {
        if (!ventas.length) return '';
        const now = Date.now();
        const WEEKS = 8;
        const buckets = new Array(WEEKS).fill(0);
        ventas.forEach(v => {
            const d = new Date(v.fecha).getTime();
            const wIdx = Math.floor((now - d) / (7 * 86400000));
            if (wIdx >= 0 && wIdx < WEEKS) buckets[WEEKS - 1 - wIdx] += Number(v.unidades) || 0;
        });
        const max = Math.max(1, ...buckets);
        const W = 300, H = 40, step = W / (WEEKS - 1);
        const pts = buckets.map((v, i) => `${i * step},${H - (v / max) * H}`).join(' ');
        const dots = buckets.map((v, i) => `<circle cx="${i * step}" cy="${H - (v / max) * H}" r="2.5" fill="var(--primary)"/>`).join('');
        return `
            <div class="sparkline-wrap">
                <div class="sparkline-title">Ventas últimas 8 semanas · Total ${buckets.reduce((s, x) => s + x, 0)} uds</div>
                <svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
                    <polyline fill="none" stroke="var(--primary)" stroke-width="1.5" points="${pts}"/>
                    ${dots}
                </svg>
            </div>
        `;
    }

    // ---- Eventos dinámicos ---------------------------------------------
    function bindDynamicEvents() {
        // Chip filters
        document.querySelectorAll('.chip[data-chip]').forEach(el => {
            el.addEventListener('click', () => {
                const key = el.dataset.chip;
                if (local.strategies.has(key)) local.strategies.delete(key);
                else local.strategies.add(key);
                renderContent();
            });
        });
        document.querySelectorAll('.chip[data-toggle="withStock"]').forEach(el => {
            el.addEventListener('click', () => { local.withStock = !local.withStock; renderContent(); });
        });
        document.querySelectorAll('[data-clear-filters]').forEach(el => {
            el.addEventListener('click', () => {
                local.strategies.clear();
                local.withStock = false;
                local.search = '';
                renderContent();
            });
        });

        // Distribution legend chips
        document.querySelectorAll('[data-strat]').forEach(el => {
            el.addEventListener('click', () => {
                const key = el.dataset.strat;
                if (local.strategies.has(key)) local.strategies.delete(key);
                else local.strategies.add(key);
                renderContent();
            });
        });

        // Row select (familia)
        document.querySelectorAll('[data-select]').forEach(row => {
            row.addEventListener('click', () => {
                local.selected = row.dataset.select;
                const fam = families().find(f => f.key === local.selected);
                local.selectedVariant = fam ? fam.variants[0].lote.id : null;
                renderContent();
            });
            row.addEventListener('dblclick', () => {
                const fam = families().find(f => f.key === row.dataset.select);
                const id = fam?.variants[0]?.lote.id || local.selectedVariant;
                if (id) openModal(id);
            });
        });

        // Color / variante picker
        document.querySelectorAll('[data-pick-variant]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                local.selectedVariant = btn.dataset.pickVariant;
                renderContent();
            });
        });

        // Sort
        const sortSel = document.getElementById('lotes-sort-select');
        if (sortSel) sortSel.addEventListener('change', e => {
            local.sort.key = e.target.value;
            renderContent();
        });
        document.querySelectorAll('[data-sort-dir]').forEach(el => {
            el.addEventListener('click', () => {
                local.sort.dir = local.sort.dir === 'asc' ? 'desc' : 'asc';
                renderContent();
            });
        });

        // Detail tabs
        document.querySelectorAll('[data-detail-tab]').forEach(el => {
            el.addEventListener('click', () => {
                local.detailTab = el.dataset.detailTab;
                renderContent();
            });
        });

        bindCompraIdealControls();

        // Kebab menu
        document.querySelectorAll('[data-kebab-btn]').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                const menu = el.closest('[data-kebab]').querySelector('[data-kebab-menu]');
                menu.hidden = !menu.hidden;
                if (!menu.hidden) {
                    const onDocClick = () => { menu.hidden = true; document.removeEventListener('click', onDocClick); };
                    setTimeout(() => document.addEventListener('click', onDocClick), 10);
                }
            });
        });

        // Actions (kebab + inline)
        document.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                if (action === 'edit') openModal(id);
                else if (action === 'dup') duplicate(id);
                else if (action === 'del') await remove(id);
                else if (action === 'sale') await recordSale(id);
                else if (action === 'restock') await restock(id);
                else if (action === 'status') await changeStatus(id);
                else if (action === 'del-venta') await removeSale(btn.dataset.lote, btn.dataset.venta);
                else if (action === 'pick-image') pickProductImage(btn.dataset.productId);
                else if (action === 'clear-image') await clearProductImage(btn.dataset.productId);
            });
        });

        // Inline edit (price, stock)
        document.querySelectorAll('.editable-price, .editable-stock').forEach(el => {
            el.addEventListener('click', async () => {
                const id = el.dataset.id;
                const field = el.dataset.editField;
                await inlineEdit(id, field);
            });
        });
    }

    // ---- Inline edit ---------------------------------------------------
    async function inlineEdit(id, field) {
        const lote = window.State.lotes.find(l => l.id === id);
        if (!lote) return;
        const opts = {
            precio: { title: 'Nuevo precio de venta', message: `Actual: ${Calc.fmtMXN(lote.precio)}`, defaultValue: String(lote.precio) },
            stock:  { title: 'Nuevas unidades totales del lote', message: `Actual: ${lote.unidades} (${lote.vendidas || 0} vendidas)`, defaultValue: String(lote.unidades) },
        }[field];
        if (!opts) return;
        const raw = await UI.prompt(opts);
        if (raw === null || raw === undefined) return;
        const n = parseFloat(raw);
        if (isNaN(n) || n < 0) { UI.toast('Valor inválido', 'error'); return; }

        if (field === 'precio') lote.precio = n;
        else if (field === 'stock') lote.unidades = Math.round(n);

        window.State.lotes = Data.upsertLote(window.State.lotes, lote);
        window.State.save();
        renderContent();
        UI.toast(field === 'precio' ? 'Precio actualizado' : 'Stock actualizado');
    }

    // ---- Imagen de producto (familia / productId) ----------------------
    const IMG_MAX_PX = 520;
    const IMG_QUALITY = 0.72;
    const IMG_MAX_BYTES = 180_000; // ~180 KB data URL por producto

    function compressImageFile(file) {
        return new Promise((resolve, reject) => {
            if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type)) {
                reject(new Error('Usa JPG, PNG o WebP'));
                return;
            }
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                try {
                    let { width: w, height: h } = img;
                    const scale = Math.min(1, IMG_MAX_PX / Math.max(w, h));
                    w = Math.max(1, Math.round(w * scale));
                    h = Math.max(1, Math.round(h * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    let quality = IMG_QUALITY;
                    let dataUrl = canvas.toDataURL('image/jpeg', quality);
                    while (dataUrl.length > IMG_MAX_BYTES && quality > 0.4) {
                        quality -= 0.08;
                        dataUrl = canvas.toDataURL('image/jpeg', quality);
                    }
                    URL.revokeObjectURL(url);
                    if (dataUrl.length > IMG_MAX_BYTES * 1.4) {
                        reject(new Error('La imagen sigue siendo muy grande. Prueba otra más liviana.'));
                        return;
                    }
                    resolve(dataUrl);
                } catch (err) {
                    URL.revokeObjectURL(url);
                    reject(err);
                }
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('No se pudo leer la imagen'));
            };
            img.src = url;
        });
    }

    function pickProductImage(productId) {
        if (!productId) { UI.toast('Producto sin identificador', 'error'); return; }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
        input.hidden = true;
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.remove();
            if (!file) return;
            try {
                const dataUrl = await compressImageFile(file);
                Data.setFamilyImage(window.State.lotes, productId, dataUrl);
                try {
                    window.State.save();
                } catch (err) {
                    Data.setFamilyImage(window.State.lotes, productId, '');
                    const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
                    UI.toast(quota
                        ? 'Almacenamiento lleno. Quita imágenes de otros productos o exporta un respaldo.'
                        : 'No se pudo guardar la imagen', 'error');
                    return;
                }
                renderContent();
                UI.toast('Imagen guardada');
            } catch (err) {
                UI.toast(err.message || 'Error al procesar imagen', 'error');
            }
        });
        document.body.appendChild(input);
        input.click();
    }

    async function clearProductImage(productId) {
        if (!productId) return;
        const ok = await UI.confirm({
            title: 'Quitar imagen',
            message: 'Se eliminará la foto de este producto (compartida por todas las variantes / colores).',
            primaryLabel: 'Quitar',
            danger: true,
        });
        if (!ok) return;
        Data.setFamilyImage(window.State.lotes, productId, '');
        window.State.save();
        renderContent();
        UI.toast('Imagen eliminada');
    }

    // ---- Atajos teclado ------------------------------------------------
    function isTypingInField() {
        const a = document.activeElement;
        return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
    }

    function handleKey(e) {
        if (window.State.view !== 'lotes') return;
        if (document.getElementById('modal-lote') && !document.getElementById('modal-lote').hidden) return;
        if (document.getElementById('palette-host') && document.getElementById('palette-host').innerHTML) return;
        if (isTypingInField()) return;

        const list = families();
        if (!list.length) return;
        const currentIdx = list.findIndex(f => f.key === local.selected);
        const variantId = local.selectedVariant;

        if (e.key === 'ArrowDown' || e.key === 'j') {
            e.preventDefault();
            const next = list[Math.min(list.length - 1, Math.max(0, currentIdx) + 1)];
            if (next) {
                local.selected = next.key;
                local.selectedVariant = next.variants[0].lote.id;
                renderContent();
            }
        } else if (e.key === 'ArrowUp' || e.key === 'k') {
            e.preventDefault();
            const prev = list[Math.max(0, currentIdx - 1)];
            if (prev) {
                local.selected = prev.key;
                local.selectedVariant = prev.variants[0].lote.id;
                renderContent();
            }
        } else if ((e.key === 'ArrowRight' || e.key === 'l') && local.selected) {
            // Siguiente color dentro del producto
            e.preventDefault();
            const fam = list.find(f => f.key === local.selected);
            if (!fam || fam.variants.length < 2) return;
            const i = fam.variants.findIndex(v => v.lote.id === local.selectedVariant);
            const next = fam.variants[(i + 1) % fam.variants.length];
            local.selectedVariant = next.lote.id;
            renderContent();
        } else if ((e.key === 'ArrowLeft' || e.key === 'h') && local.selected) {
            e.preventDefault();
            const fam = list.find(f => f.key === local.selected);
            if (!fam || fam.variants.length < 2) return;
            const i = fam.variants.findIndex(v => v.lote.id === local.selectedVariant);
            const prev = fam.variants[(i - 1 + fam.variants.length) % fam.variants.length];
            local.selectedVariant = prev.lote.id;
            renderContent();
        } else if (e.key.toLowerCase() === 'e' && variantId) {
            e.preventDefault();
            openModal(variantId);
        } else if (e.key.toLowerCase() === 'n') {
            e.preventDefault();
            openModal(null);
        } else if (e.key.toLowerCase() === 'd' && variantId) {
            e.preventDefault();
            duplicate(variantId);
        } else if (e.key.toLowerCase() === 's' && variantId) {
            e.preventDefault();
            recordSale(variantId);
        }
    }

    // ---- CRUD Actions --------------------------------------------------
    function duplicate(id) {
        const l = window.State.lotes.find(x => x.id === id);
        if (!l) return;
        const copy = Data.duplicateLote(l);
        window.State.lotes.push(copy);
        window.State.save();
        local.selected = familyKey(copy);
        local.selectedVariant = copy.id;
        renderContent();
        UI.toast('Variante duplicada');
    }

    async function remove(id) {
        const l = window.State.lotes.find(x => x.id === id);
        if (!l) return;
        const ok = await UI.confirm({
            title: 'Eliminar lote',
            message: `Se eliminará <strong>${esc(l.producto)}</strong>${l.variante ? ` · ${esc(l.variante)}` : ''} (${esc(l.sku)}). Esta acción no se puede deshacer.`,
            primaryLabel: 'Eliminar',
            danger: true,
        });
        if (!ok) return;
        window.State.lotes = Data.deleteLote(window.State.lotes, id);
        if (local.selectedVariant === id) local.selectedVariant = null;
        window.State.save();
        renderContent();
        UI.toast('Lote eliminado');
    }

    async function changeStatus(id) {
        const l = window.State.lotes.find(x => x.id === id);
        if (!l) return;
        const opts = ['✅ Activa / En Venta', '⏸️ Pausada', '📦 Sin stock', '❌ Finalizada'];
        const choice = await UI.dialog({
            title: 'Cambiar estatus de publicación',
            body: `<div class="dlg-radios">${opts.map(o => `
                <label class="dlg-radio ${l.estatus === o ? 'active' : ''}">
                    <input type="radio" name="status-opt" value="${esc(o)}" ${l.estatus === o ? 'checked' : ''}>
                    ${esc(o)}
                </label>
            `).join('')}</div>`,
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                { label: 'Guardar', variant: 'primary', value: 'save' },
            ],
        });
        if (choice !== 'save') return;
        const selected = document.querySelector('input[name="status-opt"]:checked');
        if (!selected) return;
        l.estatus = selected.value;
        window.State.lotes = Data.upsertLote(window.State.lotes, l);
        window.State.save();
        renderContent();
        UI.toast('Estatus actualizado');
    }

    async function restock(id) {
        const l = window.State.lotes.find(x => x.id === id);
        if (!l) return;
        const rango = Calc.rangoCompraIdeal(l, window.State.settings);
        const stock = Math.max(0, (Number(l.unidades) || 0) - Calc.syncVendidas(l));

        const form = document.createElement('div');
        form.innerHTML = `
            <p class="dlg-msg">Sumas mercancía al <strong>mismo SKU</strong> <code>${esc(l.sku)}</code>${l.variante ? ` · ${esc(l.variante)}` : ''}. El costo se recalcula como <strong>promedio ponderado</strong>; las ventas previas se conservan.</p>
            <div class="sale-stock-hint">
                Stock actual: <strong>${stock}</strong> disp. / ${l.unidades} del lote · costo hoy ${Calc.fmtMXN(l.costo)}
                ${rango ? `<br>Compra ideal (margen 30%–20%): <strong>${Calc.fmtMXN(rango.min)} – ${Calc.fmtMXN(rango.max)}</strong>` : ''}
            </div>
            <div class="form-grid">
                <label><span>Unidades a comprar</span><input type="number" id="r-uds" value="1" min="1" step="1"></label>
                <label><span>Costo unitario de esta compra (MXN)</span><input type="number" id="r-costo" value="${l.costo}" step="0.01" min="0"></label>
                <label class="wide"><span>Notas (opcional)</span><input type="text" id="r-notas" placeholder="Ej. pedido proveedor #123"></label>
            </div>
            <div class="sale-hint muted small" style="margin-top:10px" id="r-preview">—</div>
        `;

        const update = () => {
            const qty = parseInt(form.querySelector('#r-uds').value) || 0;
            const cNew = parseFloat(form.querySelector('#r-costo').value);
            const el = form.querySelector('#r-preview');
            if (!el || qty <= 0 || isNaN(cNew)) { if (el) el.textContent = '—'; return; }
            const udsPrev = Number(l.unidades) || 0;
            const udsNext = udsPrev + qty;
            const avg = ((Number(l.costo) || 0) * udsPrev + cNew * qty) / udsNext;
            const probe = { ...l, costo: avg };
            const calc = Calc.computeLote(probe, window.State.settings);
            const vsIdeal = rango
                ? (cNew <= rango.min ? '✅ dentro de zona 30%+'
                    : cNew <= rango.max ? '🟡 zona 20–30%'
                    : '🔴 arriba del tope 20%')
                : '';
            el.innerHTML = `Nuevo costo promedio: <strong>${Calc.fmtMXN(avg)}</strong> · margen lista ${Calc.fmtPct(calc.margen)} · stock → ${stock + qty}/${udsNext} ${vsIdeal}`;
        };
        setTimeout(() => {
            form.querySelectorAll('input').forEach(i => i.addEventListener('input', update));
            update();
        }, 30);

        const result = await UI.dialog({
            title: `Reabastecer · ${esc(l.producto)}`,
            body: form,
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                { label: 'Sumar al lote', variant: 'primary', value: 'save' },
            ],
        });
        if (result !== 'save') return;

        const qty = parseInt(form.querySelector('#r-uds').value) || 0;
        const costoUnitario = parseFloat(form.querySelector('#r-costo').value);
        const notas = form.querySelector('#r-notas').value.trim();
        if (qty <= 0 || isNaN(costoUnitario) || costoUnitario < 0) {
            UI.toast('Datos inválidos', 'error');
            return;
        }
        if (rango && costoUnitario > rango.max) {
            const ok = await UI.confirm({
                title: 'Costo por arriba del ideal',
                message: `El tope para margen 20% es <strong>${Calc.fmtMXN(rango.max)}</strong> y vas a comprar a <strong>${Calc.fmtMXN(costoUnitario)}</strong>. ¿Continuar igual?`,
                primaryLabel: 'Comprar igual',
                danger: true,
            });
            if (!ok) return;
        }

        try {
            Data.restockLote(l, { unidades: qty, costoUnitario, notas });
            window.State.lotes = Data.upsertLote(window.State.lotes, l);
            local.selected = familyKey(l);
            local.selectedVariant = l.id;
            window.State.save();
            renderContent();
            UI.toast(`+${qty} uds · costo promedio ${Calc.fmtMXN(l.costo)}`);
        } catch (err) {
            UI.toast(err.message || 'Error al reabastecer', 'error');
        }
    }

    async function recordSale(id) {
        const seed = window.State.lotes.find(x => x.id === id);
        if (!seed) return;

        const siblings = window.State.lotes
            .filter(l => familyKey(l) === familyKey(seed))
            .map(l => ({ lote: l, calc: Calc.computeLote(l, window.State.settings) }))
            .sort((a, b) => (a.lote.variante || '').localeCompare(b.lote.variante || '', 'es'));
        const multi = siblings.length > 1;

        let currentId = id;
        const getLote = () => window.State.lotes.find(x => x.id === currentId);

        const form = document.createElement('div');
        form.className = 'sale-form';

        const renderForm = () => {
            const l = getLote();
            const stock = Math.max(0, (Number(l.unidades) || 0) - (Number(l.vendidas) || 0));
            const colorPicker = multi ? `
                <div class="sale-color-block">
                    <div class="sale-color-label">¿Qué color se vendió?</div>
                    <div class="variant-pills sale-pills">
                        ${siblings.map(v => {
                            const rest = Math.max(0, (Number(v.lote.unidades) || 0) - (Number(v.lote.vendidas) || 0));
                            return `
                            <button type="button"
                                class="variant-pill ${v.lote.id === currentId ? 'active' : ''} ${rest === 0 ? 'soldout' : ''}"
                                data-sale-variant="${v.lote.id}">
                                <span class="variant-pill-dot ${cls(v.calc.estrategia)}"></span>
                                <span class="variant-pill-name">${esc(v.lote.variante || 'Sin color')}</span>
                                <span class="variant-pill-stock">${rest} disp.</span>
                            </button>`;
                        }).join('')}
                    </div>
                </div>
            ` : '';

            form.innerHTML = `
                ${colorPicker}
                <div class="sale-stock-hint">
                    Stock disponible${multi ? ` · <strong>${esc(l.variante || '—')}</strong>` : ''}:
                    <strong>${stock}</strong> de ${l.unidades}
                    <code class="muted" style="margin-left:6px">${esc(l.sku)}</code>
                </div>
                <div class="form-grid">
                    <label><span>Fecha</span><input type="date" id="s-fecha" value="${new Date().toISOString().slice(0, 10)}"></label>
                    <label><span>Unidades</span><input type="number" id="s-uds" value="1" min="1" step="1" max="${Math.max(1, stock)}"></label>
                    <label class="wide"><span>Precio real de venta (MXN)</span><input type="number" id="s-precio" value="${l.precio}" step="0.01"></label>
                    <label class="wide"><span>Notas (opcional)</span><input type="text" id="s-notas" placeholder="Ej. venta con envío gratis"></label>
                </div>
                <div class="sale-hint muted small" style="margin-top:10px">
                    📊 Utilidad esperada: <strong id="s-util-preview">—</strong>
                    <span class="muted"> · se descuenta del stock de este color</span>
                </div>
            `;

            const update = () => {
                const lote = getLote();
                const precio = parseFloat(form.querySelector('#s-precio').value) || 0;
                const uds = parseInt(form.querySelector('#s-uds').value) || 0;
                const clone = { ...lote, precio };
                const c = Calc.computeLote(clone, window.State.settings);
                const el = form.querySelector('#s-util-preview');
                if (el) el.textContent = `${Calc.fmtMXN(c.utilidad * uds)} (${Calc.fmtMXN(c.utilidad)}/uds)`;
            };

            form.querySelectorAll('input').forEach(i => i.addEventListener('input', update));
            form.querySelectorAll('[data-sale-variant]').forEach(btn => {
                btn.addEventListener('click', () => {
                    currentId = btn.dataset.saleVariant;
                    local.selectedVariant = currentId;
                    renderForm();
                });
            });
            update();
        };

        renderForm();

        const result = await UI.dialog({
            title: `Registrar venta · ${esc(seed.producto)}`,
            body: form,
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                { label: 'Registrar', variant: 'primary', value: 'save' },
            ],
        });
        if (result !== 'save') return;

        const l = getLote();
        if (!l) return;

        const fecha = form.querySelector('#s-fecha').value;
        const uds = parseInt(form.querySelector('#s-uds').value) || 0;
        const precio = parseFloat(form.querySelector('#s-precio').value) || 0;
        const notas = form.querySelector('#s-notas').value;
        const stock = Math.max(0, (Number(l.unidades) || 0) - (Number(l.vendidas) || 0));

        if (uds <= 0 || precio <= 0) { UI.toast('Datos incompletos', 'error'); return; }
        if (uds > stock) {
            const ok = await UI.confirm({
                title: 'Stock insuficiente',
                message: `Registraste <strong>${uds}</strong> uds de <strong>${esc(l.variante || l.producto)}</strong> pero solo hay <strong>${stock}</strong> disponibles. ¿Continuar de todos modos?`,
                primaryLabel: 'Continuar',
                danger: true,
            });
            if (!ok) return;
        }

        Data.addVenta(l, { fecha, precio, unidades: uds, notas });
        window.State.lotes = Data.upsertLote(window.State.lotes, l);
        local.selected = familyKey(l);
        local.selectedVariant = l.id;
        window.State.save();
        renderContent();
        UI.toast(multi
            ? `Venta registrada · ${l.variante || 'variante'} (−${uds})`
            : 'Venta registrada');
    }

    async function removeSale(loteId, ventaId) {
        const l = window.State.lotes.find(x => x.id === loteId);
        if (!l) return;
        const ok = await UI.confirm({
            title: 'Eliminar venta',
            message: 'Se restará del contador de vendidas y se registrará en el historial.',
            primaryLabel: 'Eliminar', danger: true
        });
        if (!ok) return;
        Data.removeVenta(l, ventaId);
        window.State.lotes = Data.upsertLote(window.State.lotes, l);
        window.State.save();
        renderContent();
        UI.toast('Venta eliminada');
    }

    // ---- Modal edición -------------------------------------------------
    const FIELD_MAP = [
        ['f-sku','sku'], ['f-producto','producto'], ['f-variante','variante'],
        ['f-tipo','tipo'], ['f-fecha','fecha'], ['f-categoria','categoria'],
        ['f-costo','costo'], ['f-unidades','unidades'],
        ['f-precio-comp','precioCompetencia'], ['f-precio','precio'],
        ['f-envio','envio'], ['f-estatus','estatus'],
    ];

    function openModal(id = null) {
        editing = id;
        const l = id ? window.State.lotes.find(x => x.id === id) : blankLote();
        if (!l) return;
        document.getElementById('modal-title').textContent = id ? 'Editar lote' : 'Nuevo lote';
        setForm(l);
        // Vendidas: solo lectura, derivadas de ventas
        const vendidasEl = document.getElementById('f-vendidas');
        if (vendidasEl) {
            const sync = Calc.syncVendidas(l);
            vendidasEl.value = sync;
            vendidasEl.readOnly = true;
            vendidasEl.title = 'Se calcula solo con “Registrar venta”. No se edita a mano.';
        }
        const modal = document.getElementById('modal-lote');
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        activateModalTab('identidad');
        renderPreview();
        renderCategoriaDatalist();
        setTimeout(() => document.getElementById('f-producto').focus(), 50);
    }

    function closeModal() {
        const modal = document.getElementById('modal-lote');
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        editing = null;
    }

    function activateModalTab(name) {
        document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.modalTab === name));
        document.querySelectorAll('.modal-panel-tab').forEach(p => p.hidden = p.dataset.modalPanel !== name);
    }

    function renderCategoriaDatalist() {
        const dl = document.getElementById('cat-list');
        if (!dl) return;
        const cats = Data.categorias(window.State.lotes);
        dl.innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join('');
    }

    function blankLote() {
        return {
            id: Data.newId(),
            productId: '',
            sku: '', producto: '', variante: '', tipo: 'Clasica',
            fecha: new Date().toISOString().slice(0, 10),
            categoria: '', notas: '',
            costo: 0, unidades: 1, precioCompetencia: null,
            precio: 0, envio: 0, vendidas: 0, estatus: '✅ Activa / En Venta',
            ventas: [], historial: [],
        };
    }

    function setForm(l) {
        for (const [id, key] of FIELD_MAP) {
            const el = document.getElementById(id);
            if (!el) continue;
            const v = l[key];
            el.value = v === null || v === undefined ? '' : v;
        }
    }

    function getForm() {
        const prev = editing ? window.State.lotes.find(x => x.id === editing) : null;
        return {
            id: editing || Data.newId(),
            productId: prev?.productId || '',
            sku: document.getElementById('f-sku').value.trim(),
            producto: document.getElementById('f-producto').value.trim(),
            variante: document.getElementById('f-variante').value.trim(),
            tipo: document.getElementById('f-tipo').value,
            fecha: document.getElementById('f-fecha').value,
            categoria: document.getElementById('f-categoria').value.trim(),
            costo: parseFloat(document.getElementById('f-costo').value) || 0,
            unidades: parseInt(document.getElementById('f-unidades').value) || 0,
            precioCompetencia: parseFloat(document.getElementById('f-precio-comp').value) || null,
            precio: parseFloat(document.getElementById('f-precio').value) || 0,
            envio: parseFloat(document.getElementById('f-envio').value) || 0,
            ventas: prev?.ventas || [],
            historial: prev?.historial || [],
            estatus: document.getElementById('f-estatus').value,
            notas: prev?.notas || '',
        };
    }

    function renderPreview() {
        const l = getForm();
        const c = Calc.computeLote(l, window.State.settings);
        document.getElementById('calc-preview').innerHTML = `
            <div class="cp-row"><span>Comisión Meli (${(c.pctComision*100).toFixed(0)}%)</span><span>− ${Calc.fmtMXN(c.comisionVariable)}</span></div>
            ${c.cargoFijo ? `<div class="cp-row"><span>Cargo fijo</span><span>− ${Calc.fmtMXN(c.cargoFijo)}</span></div>` : ''}
            <div class="cp-row"><span>Envío al cliente</span><span>− ${Calc.fmtMXN(l.envio)}</span></div>
            <div class="cp-row"><span>Retención IVA</span><span>− ${Calc.fmtMXN(c.retIVA)}</span></div>
            <div class="cp-row"><span>Retención ISR</span><span>− ${Calc.fmtMXN(c.retISR)}</span></div>
            <div class="cp-row"><span>Costo unitario</span><span>− ${Calc.fmtMXN(l.costo)}</span></div>
            <div class="cp-row total ${c.utilidad >= 0 ? 'pos' : 'neg'}">
                <span>Utilidad neta por unidad</span>
                <span>${Calc.fmtMXN(c.utilidad)} · ${Calc.fmtPct(c.margen)} · ROI ${Calc.fmtPct(c.roi)}</span>
            </div>
            <div class="cp-row total">
                <span>Estrategia</span>
                <span>${label(c.estrategia)} ${c.estrategia === 'ESCALAR' ? `· Tope CPA ${Calc.fmtMXN(c.topeCPA)}` : ''}</span>
            </div>
        `;
    }

    function save() {
        const l = getForm();
        if (!l.producto) { UI.toast('Falta el nombre del producto', 'error'); return; }
        if (!l.sku) {
            const existentes = window.State.lotes.map(x => x.sku).filter(Boolean);
            l.sku = Data.autoSku(l.producto, l.variante, existentes);
        }
        const isNew = !editing;
        window.State.lotes = Data.upsertLote(window.State.lotes, l);
        local.selected = familyKey(l);
        local.selectedVariant = l.id;
        window.State.save();
        closeModal();
        renderContent();
        UI.toast(isNew ? 'Lote creado' : 'Lote actualizado');
    }

    // ---- API pública para otros módulos --------------------------------
    function selectAndGo(id) {
        window.App && window.App.switchTab('lotes');
        const lote = window.State.lotes.find(l => l.id === id);
        if (lote) {
            local.selected = familyKey(lote);
            local.selectedVariant = lote.id;
        } else {
            local.selected = null;
            local.selectedVariant = id;
        }
        if (shellMounted) renderContent();
    }

    // ---- Init ----------------------------------------------------------
    function init() {
        document.getElementById('btn-save').addEventListener('click', save);
        document.querySelectorAll('#modal-lote [data-close]').forEach(el => el.addEventListener('click', closeModal));
        document.querySelectorAll('.modal-tab').forEach(el => {
            el.addEventListener('click', () => activateModalTab(el.dataset.modalTab));
        });
        document.querySelectorAll('#modal-lote input, #modal-lote select').forEach(el => {
            el.addEventListener('input', renderPreview);
            el.addEventListener('change', renderPreview);
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !document.getElementById('modal-lote').hidden) closeModal();
        });
        document.addEventListener('keydown', handleKey);

        window.State.subscribe(() => {
            if (window.State.view === 'lotes') render();
        });

        render();
    }

    return { init, render, openModal, selectAndGo };
})();
