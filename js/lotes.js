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
        mobileDetail: false,     // iPhone: lista ↔ detalle a pantalla completa
        fxEntered: false,        // entrada FX solo una vez por montaje
        fxLastFamily: null,
        sheetTab: 'catalog',     // catalog | ventas — subpestaña de Productos
        salesChart: {
            range: '12w',       // 4w | 12w | 6m | ytd
            metric: 'unidades', // unidades | cash | ganancia
            focusId: null,      // familyKey | null — filtrar curva a un producto
        },
    };

    const ENVIO_LABELS = {
        por_preparar: '📦 Por empaquetar',
        empaquetado: '📦 Empaquetado',
        etiqueta: '🏷 Con etiqueta',
        listo: '📬 Listo para llevar',
        enviado: '✅ Enviado al cliente',
    };
    /** FBA: tú mandas inventario AL almacén de Amazon (inbound). */
    const FBA_INBOUND_LABELS = {
        creando: '📝 Creando envío',
        por_enviar: '📤 Por enviar a FBA',
        en_transito: '🚚 En tránsito',
        recibido: '✅ Recibido en FBA',
    };
    const ENVIO_ESTADOS_OPTS_FBM = [
        { value: '', label: '— Sin prep.' },
        { value: 'por_preparar', label: '📦 Por empaquetar' },
        { value: 'empaquetado', label: '📦 Empaquetado' },
        { value: 'etiqueta', label: '🏷 Con etiqueta' },
        { value: 'listo', label: '📬 Listo para llevar' },
        { value: 'enviado', label: '✅ Enviado al cliente' },
    ];
    const ENVIO_ESTADOS_OPTS_FBA = [
        { value: '', label: '— Aún no' },
        { value: 'creando', label: '📝 Creando envío' },
        { value: 'por_enviar', label: '📤 Por enviar a FBA' },
        { value: 'en_transito', label: '🚚 En tránsito' },
        { value: 'recibido', label: '✅ Recibido en FBA' },
    ];

    function isMobile() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    let editing = null;
    let shellMounted = false;
    let resizerHandlers = null;

    // ---- Format helpers -------------------------------------------------
    const cls = e => ({ ESCALAR: 'esc', MANTENER: 'man', LIQUIDAR: 'liq', AGOTADO: 'ago', PAUSADA: 'pau', FINALIZADA: 'fin' }[e] || '');
    const label = e => ({
        ESCALAR: '🟢 Escalar', MANTENER: '🟡 Mantener', LIQUIDAR: '🔴 Liquidar',
        AGOTADO: '🔵 Agotado', PAUSADA: '⏸️ Pausada', FINALIZADA: '❌ Finalizada',
    }[e] || e);
    const esc = UI.escapeHTML;
    const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const familyKey = l => l.productId || normalize(l.producto || '') || ('id:' + l.id);

    /** Presentación: evita ALL CAPS ruidoso sin tocar el dato guardado. */
    function displayName(name) {
        const s = String(name || '').trim();
        if (!s) return '';
        const letters = s.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
        if (letters.length >= 4 && letters === letters.toUpperCase()) {
            return s
                .toLowerCase()
                .replace(/(^|[\s([{/.-])([\p{L}])/gu, (_, a, b) => a + b.toUpperCase());
        }
        return s;
    }

    const STRAT_PRIORITY = { LIQUIDAR: 0, MANTENER: 1, ESCALAR: 2, AGOTADO: 3, PAUSADA: 4, FINALIZADA: 5 };

    /** Variantes dadas de baja a 0 / finalizadas: no salen en chips ni en “N colores”. */
    function isVariantVisible(lote, calc) {
        const est = String(lote.estatus || '');
        if (est.includes('Finalizada')) return false;
        const uds = Number(lote.unidades) || 0;
        const rest = calc?.inventarioRestante != null
            ? calc.inventarioRestante
            : Math.max(0, uds - (Number(lote.vendidas) || 0));
        // Baja total: 0/0 y sin ventas → ocultar
        if (uds <= 0 && rest <= 0 && !(lote.ventas || []).length) return false;
        return true;
    }

    /** Variantes navegables en UI (pills / shelf / teclado), según filtros activos. */
    function listableVariants(fam) {
        if (!fam?.variants?.length) return [];
        const showFinalizadas = local.strategies.has('FINALIZADA');
        const q = normalize(local.search).trim();
        let list = (showFinalizadas || q)
            ? fam.variants.slice()
            : fam.variants.filter(v => isVariantVisible(v.lote, v.calc));
        if (local.strategies.size) {
            const filtered = list.filter(v => local.strategies.has(v.calc.estrategia));
            if (filtered.length) list = filtered;
        }
        if (local.selectedVariant) {
            const cur = fam.variants.find(v => v.lote.id === local.selectedVariant);
            if (cur && !list.some(v => v.lote.id === cur.lote.id)) list = [...list, cur];
        }
        return list;
    }

    function pickVisible(fam) {
        if (!fam?.variants?.length) return null;
        const list = listableVariants(fam);
        return list[0] || fam.variants[0];
    }

    function prepEnvioOn() {
        // Controles de estatus FBM en Productos (Amazon). Sin pestaña Envíos.
        return isAmzMarketplace();
    }

    // ---- Data pipeline --------------------------------------------------
    /** Filas individuales (lotes) que pasan filtros de búsqueda/estrategia/stock. */
    function matchingRows() {
        const q = normalize(local.search).trim();
        const showFinalizadas = local.strategies.has('FINALIZADA');
        return window.State.lotes
            .map(l => ({ lote: l, calc: Calc.computeLote(l, window.State.settings) }))
            .filter(({ lote, calc }) => {
                // Finalizada = archivo: fuera del listado activo salvo chip/filtro Finalizada o búsqueda.
                if (calc.estrategia === 'FINALIZADA' && !showFinalizadas && !q) return false;
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
            const shipPending = variants.reduce((s, v) => s + (Data.countPendingShipments?.(v.lote) || 0), 0);
            const best = variants.slice().sort((a, b) => b.calc.utilidad - a.calc.utilidad)[0];
            const estrategia = variants.slice().sort((a, b) =>
                (STRAT_PRIORITY[a.calc.estrategia] ?? 9) - (STRAT_PRIORITY[b.calc.estrategia] ?? 9)
            )[0].calc.estrategia;
            const colores = [...new Set(
                variants
                    .filter(v => isVariantVisible(v.lote, v.calc))
                    .map(v => v.lote.variante)
                    .filter(Boolean)
            )];
            const archivadas = variants.filter(v => !isVariantVisible(v.lote, v.calc)).length;
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
                archivadas,
                stockRest,
                stockTotal,
                shipPending,
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
        const view = document.getElementById('view-lotes');
        if (!view) return;
        // App vacía #view-lotes al cambiar MP: hay que recrear el wrapper.
        let canvas = document.getElementById('lotes-canvas');
        if (!canvas) {
            view.innerHTML = '<div id="lotes-canvas"></div>';
            canvas = document.getElementById('lotes-canvas');
        }
        canvas.classList.add('is-fx', 'is-studio');
        canvas.innerHTML = `
            <div class="prod-fx-stage" aria-hidden="true">
                <div class="prod-fx-wash"></div>
                <div class="prod-fx-orb prod-fx-orb-a"></div>
                <div class="prod-fx-orb prod-fx-orb-b"></div>
            </div>
            <header class="lotes-studio-head">
                <div class="lotes-studio-title-row">
                    <div class="lotes-studio-copy">
                        <p class="dash-masthead-kicker">${esc(mpKicker())}</p>
                        <h1 class="lotes-studio-title" data-sheet-title>Tu catálogo.</h1>
                        <p class="lotes-studio-lead" data-sheet-lead>Inventario, rentabilidad y estrategia en un solo lugar.</p>
                    </div>
                    <div class="view-actions">
                        <button class="btn primary lotes-add-btn" id="lotes-new"><span aria-hidden="true">＋</span> Agregar producto</button>
                    </div>
                </div>
                <nav class="lotes-sheet-tabs" role="tablist" aria-label="Secciones de Productos">
                    <button type="button" class="lotes-sheet-tab" role="tab" data-sheet-tab="catalog" aria-controls="lotes-pane-catalog">Catálogo</button>
                    <button type="button" class="lotes-sheet-tab" role="tab" data-sheet-tab="ventas" aria-controls="lotes-pane-ventas">Ventas</button>
                </nav>
                <div id="lotes-stats" class="dash-hero-kpis-band is-flow lotes-hero-kpis" aria-label="Resumen del catálogo"></div>
            </header>

            <div class="lotes-shell is-mail" id="lotes-pane-catalog" data-sheet-pane="catalog" role="tabpanel">
                <div class="lotes-mail-top">
                    <div class="lotes-toolbar">
                        <div class="grow">
                            <input type="search" id="lotes-search" placeholder="Buscar en productos" aria-label="Buscar productos">
                        </div>
                    </div>
                    <div class="chip-row lotes-mail-chips" id="lotes-chips"></div>
                    <div id="lotes-catalog-shelf"></div>
                </div>

                <div class="lotes-split" id="lotes-split">
                    <div class="lotes-list" id="lotes-list"></div>
                    <div class="lotes-resizer" id="lotes-resizer" title="Doble click para reiniciar ancho"></div>
                    <div class="lotes-detail" id="lotes-detail"></div>
                </div>
            </div>

            <div id="lotes-pane-ventas" class="lotes-ventas-pane" data-sheet-pane="ventas" role="tabpanel" hidden>
                <div id="lotes-sales-chart" class="prod-sales-host" aria-label="Ventas en el tiempo"></div>
            </div>
        `;
        bindShellEvents();
        initResizer();
        syncSheetTab();
        shellMounted = true;
    }

    function syncSheetTab() {
        const tab = local.sheetTab === 'ventas' ? 'ventas' : 'catalog';
        local.sheetTab = tab;
        const canvas = document.getElementById('lotes-canvas');
        if (canvas) canvas.dataset.sheetTab = tab;

        document.querySelectorAll('#view-lotes [data-sheet-tab]').forEach(btn => {
            const on = btn.dataset.sheetTab === tab;
            btn.classList.toggle('is-on', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
            btn.tabIndex = on ? 0 : -1;
        });
        document.querySelectorAll('#view-lotes [data-sheet-pane]').forEach(pane => {
            const on = pane.dataset.sheetPane === tab;
            pane.hidden = !on;
            pane.setAttribute('aria-hidden', on ? 'false' : 'true');
        });

        const title = document.querySelector('#view-lotes [data-sheet-title]');
        const lead = document.querySelector('#view-lotes [data-sheet-lead]');
        if (title) title.textContent = tab === 'ventas' ? 'Ventas.' : 'Tu catálogo.';
        if (lead) {
            lead.textContent = tab === 'ventas'
                ? 'Curva del catálogo, delta vs periodo anterior y qué está jalando.'
                : 'Inventario, rentabilidad y estrategia en un solo lugar.';
        }

        const stats = document.getElementById('lotes-stats');
        if (stats) stats.hidden = tab === 'ventas';
        const addBtn = document.getElementById('lotes-new');
        if (addBtn) addBtn.hidden = tab === 'ventas';
    }

    function setSheetTab(next) {
        const tab = next === 'ventas' ? 'ventas' : 'catalog';
        if (local.sheetTab === tab) {
            syncSheetTab();
            return;
        }
        local.sheetTab = tab;
        if (tab === 'catalog' && isMobile()) local.mobileDetail = false;
        syncSheetTab();
        if (tab === 'ventas') {
            refreshSalesChart();
            requestAnimationFrame(() => {
                document.getElementById('lotes-pane-ventas')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
            });
        } else {
            renderContent({ soft: true });
        }
    }

    function bindShellEvents() {
        const search = document.getElementById('lotes-search');
        const neu = document.getElementById('lotes-new');
        if (search) {
            search.addEventListener('input', e => {
                local.search = e.target.value;
                renderContent();
            });
        }
        if (neu) neu.addEventListener('click', () => openModal(null));
        document.querySelectorAll('#view-lotes [data-sheet-tab]').forEach(btn => {
            if (btn.dataset.boundSheetTab === '1') return;
            btn.dataset.boundSheetTab = '1';
            btn.addEventListener('click', () => setSheetTab(btn.dataset.sheetTab));
        });
    }

    function initResizer() {
        const split = document.getElementById('lotes-split');
        const resizer = document.getElementById('lotes-resizer');
        if (!split || !resizer) return;
        if (resizerHandlers) {
            document.removeEventListener('mousemove', resizerHandlers.move);
            document.removeEventListener('mouseup', resizerHandlers.end);
            resizerHandlers = null;
        }
        const saved = parseInt(localStorage.getItem('vm-list-width') || '380', 10);
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
            split.style.setProperty('--list-w', '380px');
            localStorage.setItem('vm-list-width', '380');
        });
        resizerHandlers = { move, end };
    }

    /** Llamar cuando App vacía #view-lotes (cambio de marketplace). */
    function invalidate() {
        shellMounted = false;
        local.fxEntered = false;
        local.fxLastFamily = null;
    }

    function settleListFx() {
        const listEl = document.getElementById('lotes-list');
        if (!listEl) return;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (reduce) return;
        listEl.classList.remove('is-list-settle');
        void listEl.offsetWidth;
        listEl.classList.add('is-list-settle');
        window.clearTimeout(local.listSettleTimer);
        local.listSettleTimer = window.setTimeout(() => {
            listEl.classList.remove('is-list-settle');
        }, 900);
    }

    function kickProdFx(familyKey, opts = {}) {
        const soft = !!opts.soft;
        const canvas = document.getElementById('lotes-canvas');
        const detail = document.getElementById('lotes-detail');
        if (!canvas) return;

        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        canvas.classList.add('is-fx');

        if (reduce) {
            canvas.classList.remove('is-fx-enter');
            local.fxEntered = true;
            return;
        }

        if (!soft && !local.fxEntered) {
            local.fxEntered = true;
            canvas.classList.add('is-fx-enter');
            window.setTimeout(() => canvas.classList.remove('is-fx-enter'), 1100);
        }
        if (!soft) UI.countUp?.(document.getElementById('lotes-stats'));

        const familyChanged = !!(familyKey && familyKey !== local.fxLastFamily);
        if (familyKey) local.fxLastFamily = familyKey;

        if (detail) {
            detail.classList.remove('is-detail-swap');
            void detail.offsetWidth;
            detail.classList.add('is-detail-swap');
        }

        if (familyChanged) {
            const active = document.querySelector('#lotes-catalog-track .prod-rail-thumb.is-active');
            if (active) {
                active.classList.remove('is-pop');
                void active.offsetWidth;
                active.classList.add('is-pop');
            }
            const activeRow = document.querySelector('#lotes-list .lotes-row.active');
            if (activeRow) {
                activeRow.classList.remove('is-bloom');
                void activeRow.offsetWidth;
                activeRow.classList.add('is-bloom');
            }
        }

        if (!soft) settleListFx();
    }

    function syncSelectionClasses() {
        document.querySelectorAll('#lotes-catalog-track [data-select-family]').forEach(card => {
            card.classList.toggle('is-active', card.dataset.selectFamily === local.selected);
        });
        document.querySelectorAll('#lotes-list [data-select]').forEach(row => {
            row.classList.toggle('active', row.dataset.select === local.selected);
        });
    }

    function ensureActiveShelfVisible() {
        const track = document.getElementById('lotes-catalog-track');
        const activeCard = track?.querySelector('.is-active');
        if (!track || !activeCard) return;
        const tRect = track.getBoundingClientRect();
        const aRect = activeCard.getBoundingClientRect();
        const pad = 12;
        if (aRect.left >= tRect.left + pad && aRect.right <= tRect.right - pad) return;
        const left = activeCard.offsetLeft - (track.clientWidth - activeCard.clientWidth) / 2;
        track.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }

    function ensureActiveRowVisible() {
        const row = document.querySelector('#lotes-list .lotes-row.active');
        if (!row) return;
        try {
            row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (_) { /* ignore */ }
    }

    // ---- Render principal ----------------------------------------------
    function render() {
        // Si App vació el DOM o el canvas desapareció, remonta el shell.
        if (!shellMounted || !document.getElementById('lotes-canvas')) {
            shellMounted = false;
            local.fxEntered = false;
            local.fxLastFamily = null;
            renderShell();
        }
        syncToolbar();
        renderContent();
    }

    function syncToolbar() {
        const s = document.getElementById('lotes-search');
        if (s && s.value !== local.search) s.value = local.search;
    }

    function renderContent(opts = {}) {
        const soft = !!opts.soft;
        const list = families();

        if (list.length && (!local.selected || !list.find(f => f.key === local.selected))) {
            local.selected = list[0].key;
            local.selectedVariant = pickVisible(list[0])?.lote?.id || null;
        } else if (!list.length) {
            local.selected = null;
            local.selectedVariant = null;
        }

        const family = list.find(f => f.key === local.selected) || null;
        if (family) {
            const stillThere = family.variants.find(v => v.lote.id === local.selectedVariant);
            // Mantener Finalizada / deep-link; solo resetear si la variante ya no existe.
            if (!stillThere) local.selectedVariant = pickVisible(family)?.lote?.id || null;
        }

        const variantRow = family
            ? family.variants.find(v => v.lote.id === local.selectedVariant) || pickVisible(family)
            : null;

        syncSheetTab();

        if (!soft) {
            const nProd = list.length;
            const nTotal = totalProductCount();
            const nVar = window.State.lotes.length;
            const statsEl = document.getElementById('lotes-stats');
            if (statsEl) statsEl.innerHTML = renderStats({ nProd, nTotal, nVar });
            const salesChartEl = document.getElementById('lotes-sales-chart');
            if (salesChartEl) salesChartEl.innerHTML = renderCatalogSalesChart();
            let catalogHost = document.getElementById('lotes-catalog-shelf');
            if (!catalogHost) {
                const mailTop = document.querySelector('#view-lotes .lotes-mail-top');
                if (mailTop) {
                    catalogHost = document.createElement('div');
                    catalogHost.id = 'lotes-catalog-shelf';
                    mailTop.appendChild(catalogHost);
                }
            }
            if (catalogHost) catalogHost.innerHTML = renderCatalogShelf(list, local.selected);
            const chipsEl = document.getElementById('lotes-chips');
            if (chipsEl) chipsEl.innerHTML = renderChips();
            const listEl = document.getElementById('lotes-list');
            if (listEl) listEl.innerHTML = renderList(list);
        } else {
            syncSelectionClasses();
        }

        const detailEl = document.getElementById('lotes-detail');
        if (detailEl && local.sheetTab === 'catalog') {
            detailEl.innerHTML = renderDetail(family, variantRow);
        }
        kickProdFx(family?.key || null, { soft });
        requestAnimationFrame(() => {
            if (local.sheetTab === 'catalog') {
                ensureActiveShelfVisible();
                ensureActiveRowVisible();
            }
        });

        const split = document.getElementById('lotes-split');
        if (split) {
            split.classList.toggle('mobile-detail-open', isMobile() && !!local.mobileDetail && !!family && local.sheetTab === 'catalog');
        }

        if (soft) {
            if (local.sheetTab === 'catalog') bindDetailEvents();
            else bindSalesChartEvents();
        } else {
            bindDynamicEvents();
        }

        if (window.Keepa?.hydrate && local.sheetTab === 'catalog') {
            const detailHost = document.getElementById('lotes-detail');
            if (detailHost) Keepa.hydrate(detailHost);
        }

        if (!soft) window.App?.refreshNavCounts?.();
    }

    function mpKicker() {
        const mp = window.State.marketplace === 'amazon' ? 'amazon' : 'meli';
        return Data.mpBrand?.(mp) || (mp === 'amazon' ? 'Amazon' : 'Mercado Libre');
    }

    // ---- KPIs tipo dashboard ------------------------------------------
    function renderStats(opts = {}) {
        const agg = Calc.aggregate(window.State.lotes, window.State.settings);
        const nProd = opts.nProd != null ? opts.nProd : totalProductCount();
        const nTotal = opts.nTotal != null ? opts.nTotal : totalProductCount();
        const nVar = opts.nVar != null ? opts.nVar : agg.rows.length;
        const utilPot = agg.rows.reduce((s, r) => s + r.calc.utilidad * r.calc.inventarioRestante, 0);
        const piezasStock = agg.rows.reduce((s, r) => s + (Number(r.calc.inventarioRestante) || 0), 0);
        const piezasCompradas = Number(agg.totalUds) || 0;
        const capital = agg.valorInventario || 0;
        const hasSales = (agg.totalVendidas || 0) > 0 || Math.abs(agg.gananciaRealizada || 0) > 0.009;
        const ganCls = !hasSales ? '' : (agg.gananciaRealizada >= 0 ? 'pos' : 'neg');
        const utilCls = utilPot >= 0 ? 'pos' : 'neg';
        const catalogFoot = nProd === nTotal
            ? `${nProd === 1 ? 'producto' : 'productos'} · ${nVar} var.`
            : `de ${nTotal} · ${nVar} var.`;
        const piezasFoot = piezasCompradas > 0
            ? `en stock · ${piezasCompradas} compradas`
            : 'Sin piezas';
        return `
            <section class="lotes-sum" aria-label="Resumen de inventario">
                <div class="lotes-sum-hero">
                    <p class="lotes-sum-eyebrow"><span aria-hidden="true"></span> Capital en inventario</p>
                    <p class="lotes-sum-figure" data-fx-num="${capital}" data-fx-fmt="mxn">${Calc.fmtMXN(capital)}</p>
                    <p class="lotes-sum-caption">Costo del stock disponible · ${piezasStock} pieza${piezasStock === 1 ? '' : 's'}</p>
                </div>
                <div class="lotes-sum-grid">
                    <article class="lotes-sum-cell" style="--cell-i:0">
                        <span class="lotes-sum-cell-name">Piezas totales</span>
                        <strong class="lotes-sum-cell-value" data-fx-num="${piezasStock}" data-fx-fmt="int">${piezasStock}</strong>
                        <span class="lotes-sum-cell-note">${esc(piezasFoot)}</span>
                    </article>
                    <article class="lotes-sum-cell" style="--cell-i:1">
                        <span class="lotes-sum-cell-name">Catálogo</span>
                        <strong class="lotes-sum-cell-value" data-fx-num="${nProd}" data-fx-fmt="int">${nProd}</strong>
                        <span class="lotes-sum-cell-note">${esc(catalogFoot)}</span>
                    </article>
                    <article class="lotes-sum-cell is-strong" style="--cell-i:2">
                        <span class="lotes-sum-cell-name">Ganancia realizada</span>
                        <strong class="lotes-sum-cell-value ${ganCls}"${hasSales ? ` data-fx-num="${agg.gananciaRealizada}" data-fx-fmt="mxn"` : ''}>${hasSales ? Calc.fmtMXN(agg.gananciaRealizada) : '—'}</strong>
                        <span class="lotes-sum-cell-note ${ganCls}">${hasSales ? `${agg.totalVendidas || 0} uds vendidas` : 'Aún sin ventas'}</span>
                    </article>
                    <article class="lotes-sum-cell" style="--cell-i:3">
                        <span class="lotes-sum-cell-name">Ganancia potencial</span>
                        <strong class="lotes-sum-cell-value ${utilCls}" data-fx-num="${utilPot}" data-fx-fmt="mxn">${Calc.fmtMXN(utilPot)}</strong>
                        <span class="lotes-sum-cell-note">Si se vende el stock</span>
                    </article>
                </div>
            </section>
        `;
    }

    // ---- Chip filters --------------------------------------------------
    function renderChips() {
        const agg = Calc.aggregate(window.State.lotes, window.State.settings);
        const counts = agg.strategyCount || {};
        const withStockN = (agg.rows || []).filter(r => r.calc.inventarioRestante > 0).length;
        const chips = [
            { key: 'ESCALAR',  cls: 'esc', label: 'Escalar' },
            { key: 'MANTENER', cls: 'man', label: 'Mantener' },
            { key: 'LIQUIDAR', cls: 'liq', label: 'Liquidar' },
            { key: 'AGOTADO',  cls: 'ago', label: 'Agotado' },
            { key: 'PAUSADA',  cls: 'pau', label: 'Pausada' },
            { key: 'FINALIZADA', cls: 'fin', label: 'Archivadas' },
        ];
        return chips.map(c => {
            const n = counts[c.key] || 0;
            const empty = n === 0 ? ' is-empty' : '';
            const tip = c.key === 'FINALIZADA'
                ? `${n} archivada${n === 1 ? '' : 's'} (Finalizada · fuera del listado activo)`
                : `${n} variante${n === 1 ? '' : 's'}`;
            return `
            <button class="chip ${c.cls}${empty} ${local.strategies.has(c.key) ? 'active' : ''}" data-chip="${c.key}" title="${tip}">
                ${c.label} <span class="chip-n">${n}</span>
            </button>`;
        }).join('') + `
            <button class="chip ${local.withStock ? 'active' : ''}${withStockN === 0 ? ' is-empty' : ''}" data-toggle="withStock" title="Solo mostrar productos con stock">
                Con stock <span class="chip-n">${withStockN}</span>
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
            const isAmz = window.State.marketplace === 'amazon';
            const noCatalog = !window.State.lotes.length;
            const onlyFin = local.strategies.size === 1 && local.strategies.has('FINALIZADA');
            return head + `<div class="lotes-empty-list">
                <h3>${noCatalog ? 'Sin productos aún.' : (onlyFin ? 'Nada archivado.' : 'Sin resultados.')}</h3>
                <p class="muted">${noCatalog
                    ? (isAmz
                        ? 'Agrega tus propios productos de Amazon (no usa los de Mercado Libre). Usa Agregar arriba.'
                        : 'Usa Agregar arriba para crear tu primer producto.')
                    : onlyFin
                        ? 'Marca un producto como Finalizada para guardarlo fuera del listado activo.'
                        : 'Ajusta los filtros o agrega un producto nuevo.'}</p>
            </div>`;
        }

        const items = list.map((f, i) => {
            const archived = f.estrategia === 'FINALIZADA'
                || f.variants.every(v => v.calc.estrategia === 'FINALIZADA');
            const colorLine = f.colores.length
                ? (f.colores.length === 1
                    ? esc(f.colores[0])
                    : `${f.colores.length} colores · ${f.colores.map(esc).join(' · ')}`)
                : (f.archivadas
                    ? 'Sin colores activos'
                    : `${f.variants.length} variante${f.variants.length === 1 ? '' : 's'}`);
            const thumbSrc = safeImageSrc(f.imagen);
            const thumb = thumbSrc
                ? `<img class="lotes-row-thumb" src="${thumbSrc}" alt="" loading="lazy">`
                : `<span class="lotes-row-thumb is-empty" aria-hidden="true"></span>`;
            const shipMeta = shipListLabel(f);
            const tooltipParts = [
                esc(f.producto),
                archived ? 'Archivada' : '',
                colorLine,
                f.categoria ? `Cat: ${esc(f.categoria)}` : '',
                `Stock ${f.stockRest}/${f.stockTotal}`,
                shipMeta ? esc(shipMeta.text) : '',
                `${Calc.fmtMXN(f.utilidad)} util · ${Calc.fmtPct(f.margen)} margen`,
            ].filter(Boolean).join(' · ');
            return `
            <div class="lotes-row ${f.key===local.selected?'active':''}${archived ? ' is-archived' : ''}" data-select="${esc(f.key)}" style="--i:${i}" title="${tooltipParts}">
                <span class="lotes-dot ${cls(f.estrategia)}" title="${label(f.estrategia)}"></span>
                ${thumb}
                <div class="lotes-info">
                    <div class="lotes-name">${esc(displayName(f.producto))}${archived ? '<span class="lotes-archive-tag">Archivada</span>' : ''}</div>
                    <div class="lotes-sub">
                        <span class="lotes-sub-primary">${colorLine}</span>
                        ${f.categoria ? `<span class="lotes-sub-cat">·</span><span class="lotes-sub-cat">${esc(f.categoria)}</span>` : ''}
                        <span>·</span>
                        <span>Stock ${f.stockRest}/${f.stockTotal}</span>
                        ${shipMeta ? `<span>·</span><span class="ship-pending-tag${shipMeta.done ? ' is-done' : ''}${shipMeta.idle ? ' is-idle' : ''}">${esc(shipMeta.text)}</span>` : ''}
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

    /**
     * Emoji + estado en lista (mismos textos que el select).
     * Siempre visible en Amazon: creando / por enviar / tránsito / recibido / FBM…
     */
    function shipListLabel(f) {
        if (!prepEnvioOn()) return null;

        // FBA: estado inbound del lote (prioridad a pendiente; si no, el primero FBA)
        const fbaVars = f.variants.filter(v => String(v.lote.tipo || '').toUpperCase() === 'FBA');
        if (fbaVars.length) {
            const pending = fbaVars.find(v => {
                const e = v.lote.fbaInboundEstado || '';
                return e && e !== 'recibido';
            });
            const pick = pending || fbaVars[0];
            const st = pick.lote.fbaInboundEstado || '';
            if (!st) return { text: '— Aún no (FBA)', idle: true, done: false };
            const text = FBA_INBOUND_LABELS[st] || st;
            return { text, done: st === 'recibido', idle: false };
        }

        // FBM: venta pendiente o última con estado
        const fbmVars = f.variants.filter(v => String(v.lote.tipo || '').toUpperCase() === 'FBM');
        if (!fbmVars.length) return null;

        let pending = null;
        let last = null;
        for (const v of fbmVars) {
            for (const venta of (v.lote.ventas || [])) {
                if (!venta.envioEstado) continue;
                last = venta;
                if (venta.envioEstado !== 'enviado' && !pending) pending = venta;
            }
        }
        if (pending) {
            const text = ENVIO_LABELS[pending.envioEstado] || pending.envioEstado;
            const extra = f.shipPending > 1 ? ` · +${f.shipPending - 1}` : '';
            return { text: text + extra, done: false, idle: false };
        }
        if (last) {
            return {
                text: ENVIO_LABELS[last.envioEstado] || last.envioEstado,
                done: last.envioEstado === 'enviado',
                idle: false,
            };
        }
        return { text: '— Sin prep. (FBM)', idle: true, done: false };
    }

    // ---- Detalle con tabs + selector de colores ------------------------
    function renderDetail(family, row) {
        if (!family || !row) {
            return `
                <div class="lotes-empty">
                    <div class="lotes-empty-mail">
                        <span class="lotes-empty-mail-mark" aria-hidden="true"></span>
                        <h3>Selecciona un producto</h3>
                        <p class="muted">El detalle aparece aquí, limpio y al instante.</p>
                    </div>
                </div>
            `;
        }
        const { lote, calc } = row;
        const visibleVariants = listableVariants(family);
        const multi = visibleVariants.length > 1;
        const imagen = safeImageSrc(family.imagen || lote.imagen || '');
        const productId = family.productId || lote.productId || '';

        const colorPills = multi ? `
            <div class="variant-pills" role="tablist" aria-label="Colores / variantes">
                ${visibleVariants.map(v => `
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

        const tipo = String(lote.tipo || '').toUpperCase();
        const logSummary = logisticaSummaryLine(lote);
        const logOpen = tipo === 'FBA'
            ? (lote.fbaInboundEstado || '') !== 'recibido'
            : tipo === 'FBM';

        return `
            <div class="lotes-detail-stack">
                <header class="lotes-detail-head lotes-act lotes-act-1">
                    <button type="button" class="btn ghost btn-sm mobile-back" data-action="mobile-back" aria-label="Volver a la lista">← Productos</button>
                    <div class="lotes-detail-topline">
                        <div class="lotes-detail-meta">
                            <code>${esc(lote.sku)}</code>
                            <span>·</span>
                            <span>${esc(lote.tipo)}</span>
                            ${lote.categoria ? `<span>·</span><span>${esc(lote.categoria)}</span>` : ''}
                            <span>·</span>
                            <span>Compra ${Calc.fmtDate(lote.fecha)}</span>
                            ${multi ? `<span>·</span><span>${visibleVariants.length} colores</span>` : ''}
                        </div>
                        <div class="lotes-detail-actions">
                            ${isAmzMarketplace() && lote.asin
                                ? `<button type="button" class="btn btn-sm" data-action="open-keepa" data-id="${lote.id}">📈 Keepa</button>`
                                : ''}
                            <button type="button" class="btn btn-sm" data-action="edit" data-id="${lote.id}">✏️ Editar</button>
                            ${calc.estrategia === 'FINALIZADA'
                                ? `<button type="button" class="btn btn-sm" data-action="status" data-id="${lote.id}">↩ Reactivar</button>`
                                : `<button type="button" class="btn btn-sm ghost" data-action="status" data-id="${lote.id}">🗄 Archivar</button>`}
                            <div class="kebab" data-kebab>
                                <button class="icon-btn" data-kebab-btn aria-label="Más acciones">⋯</button>
                                <div class="kebab-menu" data-kebab-menu hidden>
                                    <button class="kebab-item" data-action="edit"    data-id="${lote.id}">✏️ Editar ficha completa</button>
                                    <button class="kebab-item" data-action="sale"    data-id="${lote.id}">🛒 Registrar venta</button>
                                    ${calc.estrategia === 'FINALIZADA'
                                        ? ''
                                        : `<button class="kebab-item" data-action="restock" data-id="${lote.id}">📦 Reabastecer SKU</button>`}
                                    <button class="kebab-item" data-action="writeoff" data-id="${lote.id}">🗑 Baja de inventario</button>
                                    <button class="kebab-item" data-action="dup"     data-id="${lote.id}">🧬 Duplicar variante</button>
                                    <button class="kebab-item" data-action="status"  data-id="${lote.id}">🔀 Cambiar estatus</button>
                                    <div class="kebab-sep"></div>
                                    <button class="kebab-item danger" data-action="del" data-id="${lote.id}">🗑 Eliminar lote</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <section class="lotes-detail-identity">
                        <div class="lotes-detail-title-row">
                            ${imageBlock}
                            <div class="lotes-detail-title-text">
                                <h2 class="lotes-detail-name">${esc(displayName(lote.producto))}</h2>
                                ${colorPills}
                                <div class="lotes-detail-variant">
                                    ${multi ? '' : `<strong>${esc(lote.variante || '—')}</strong> · `}
                                    <span class="editable-price" data-edit-field="precio" data-id="${lote.id}" title="Click para editar precio">${Calc.fmtMXN(lote.precio)}</span>
                                    ${lote.precioCompetencia ? `· <span class="muted">Competencia: ${Calc.fmtMXN(lote.precioCompetencia)}</span>` : ''}
                                    · <span class="badge ${cls(calc.estrategia)}">${calc.estrategia === 'FINALIZADA' ? '🗄 Archivada' : label(calc.estrategia)}</span>
                                </div>
                            </div>
                        </div>
                    </section>
                </header>

                ${calc.estrategia === 'FINALIZADA' ? `
                <div class="lote-archive-banner" role="status">
                    <div class="lote-archive-banner-text">
                        <strong>Archivada</strong>
                        <span>Fuera del listado activo · sin recompra · ventas y P&amp;G intactos</span>
                    </div>
                    <button type="button" class="btn btn-sm" data-action="status" data-id="${lote.id}">Cambiar estatus</button>
                </div>` : ''}

                <section class="lotes-metrics lotes-act lotes-act-2" aria-label="Veredicto del producto">
                    <div class="lotes-hero-util ${calc.utilidad >= 0 ? 'pos' : 'neg'}">
                        <div class="lotes-hero-label">Utilidad por unidad</div>
                        <div class="lotes-hero-value">${Calc.fmtMXN(calc.utilidad)}</div>
                        <span class="lotes-hero-mark" aria-hidden="true"></span>
                    </div>
                    <div class="lotes-metrics-row">
                        <span class="lotes-metric-chip"><em>Margen</em><strong>${Calc.fmtPct(calc.margen)}</strong></span>
                        <span class="lotes-metric-chip"><em>Stock</em><strong class="editable-stock" data-edit-field="stock" data-id="${lote.id}" title="Click para editar unidades del lote">${calc.inventarioRestante}<small>/${lote.unidades}</small></strong></span>
                        <span class="lotes-metric-chip"><em>ROI</em><strong>${Calc.fmtPct(calc.roi)}</strong></span>
                    </div>
                </section>

                <section class="lotes-act lotes-act-3">
                    <nav class="detail-tabs" role="tablist">
                        ${tabs.map(t => `
                            <button class="detail-tab ${local.detailTab===t.key?'active':''}" data-detail-tab="${t.key}">${t.label}</button>
                        `).join('')}
                    </nav>

                    <div class="detail-tab-content">
                        ${renderDetailTab(lote, calc)}
                    </div>

                    ${isAmzMarketplace() ? `
                    <details class="lotes-logistica" ${logOpen ? 'open' : ''}>
                        <summary class="lotes-logistica-summary">
                            <span class="lotes-logistica-title">Logística</span>
                            <span class="lotes-logistica-status">${esc(logSummary)}</span>
                        </summary>
                        <div class="lotes-logistica-body">
                            <div class="logistica-bar" role="group" aria-label="Logística Amazon">
                                <span class="logistica-bar-label">¿Quién envía?</span>
                                <button type="button" class="logistica-opt ${tipo === 'FBA' ? 'active' : ''}"
                                    data-action="set-logistica" data-id="${lote.id}" data-tipo="FBA">
                                    FBA · Amazon
                                </button>
                                <button type="button" class="logistica-opt ${tipo === 'FBM' ? 'active' : ''}"
                                    data-action="set-logistica" data-id="${lote.id}" data-tipo="FBM">
                                    FBM · Tú envías
                                </button>
                            </div>
                            ${renderEnvioPanel(family, lote)}
                        </div>
                    </details>` : ''}

                    ${isAmzMarketplace() && lote.asin && !window.Keepa?.panelPrefs?.().off
                        ? `${renderKeepaMini(lote, calc)}
                           <div class="lotes-float-block lotes-keepa-block">
                            <h4 class="lotes-float-block-title">Keepa detalle</h4>
                            <div class="lotes-keepa" data-keepa-asin="${esc(lote.asin)}"
                                data-keepa-product-id="${esc(lote.id)}"></div>
                           </div>`
                        : ''}

                    ${renderProductShelf(family, lote)}
                </section>
            </div>
        `;
    }

    /** Swatch aproximado por nombre de variante (puntos tipo Apple Accessories). */
    function variantSwatch(name) {
        const n = normalize(name || '');
        const table = [
            ['negro', '#1d1d1f'], ['black', '#1d1d1f'], ['onyx', '#2c2c2e'],
            ['blanco', '#f2f2f7'], ['white', '#f2f2f7'], ['ivory', '#f5f0e6'],
            ['gris', '#8e8e93'], ['gray', '#8e8e93'], ['grey', '#8e8e93'], ['plata', '#c7c7cc'], ['silver', '#c7c7cc'],
            ['rojo', '#ff3b30'], ['red', '#ff3b30'], ['scarlet', '#ff3b30'],
            ['azul', '#007aff'], ['blue', '#007aff'], ['navy', '#0a4d8c'],
            ['verde', '#34c759'], ['green', '#34c759'], ['oliva', '#6b8e23'],
            ['rosa', '#ff2d55'], ['pink', '#ff2d55'], ['fucsia', '#ff2d55'],
            ['morado', '#af52de'], ['purple', '#af52de'], ['violeta', '#5856d6'],
            ['naranja', '#ff9500'], ['orange', '#ff9500'], ['amarillo', '#ffcc00'], ['yellow', '#ffcc00'],
            ['beige', '#e8d5b7'], ['café', '#8b5a2b'], ['brown', '#8b5a2b'], ['dorado', '#d4af37'], ['gold', '#d4af37'],
            ['coco', '#f3e5d0'], ['natural', '#e8dcc8'],
        ];
        for (const [key, hex] of table) {
            if (n.includes(key)) return hex;
        }
        let h = 0;
        for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
        return `hsl(${h % 360} 42% 62%)`;
    }

    /** Riel mini de thumbs (no vitrina grande). */
    function renderCatalogShelf(list, selectedKey) {
        const pool = (list || [])
            .slice()
            .sort((a, b) => (b.utilidad || 0) - (a.utilidad || 0));
        if (pool.length < 2) return '';

        const thumbs = pool.map(f => {
            const best = pickVisible(f);
            if (!best?.lote) return '';
            const img = safeImageSrc(f.imagen || best.lote.imagen || '');
            const active = f.key === selectedKey;
            return `
                <button type="button"
                    class="prod-rail-thumb${active ? ' is-active' : ''}"
                    data-select-family="${esc(f.key)}"
                    title="${esc(displayName(f.producto))} · ${Calc.fmtMXN(best.lote.precio)}">
                    ${img
                        ? `<img src="${img}" alt="" loading="lazy">`
                        : `<span class="prod-rail-ph" aria-hidden="true"></span>`}
                </button>`;
        }).filter(Boolean);

        if (!thumbs.length) return '';
        return `
            <div class="prod-rail" aria-label="Catálogo rápido">
                <div class="prod-rail-track" id="lotes-catalog-track">
                    ${thumbs.join('')}
                </div>
            </div>`;
    }

    /** Vitrina inferior del detalle: solo variantes/colores del producto actual. */
    function renderProductShelf(family, activeLote) {
        if (!family) return '';
        const variants = listableVariants(family);
        if (variants.length < 2) return '';
        const famImg = safeImageSrc(family.imagen || '');

        const dotsHtml = (activeId) => `
            <div class="prod-shelf-dots" role="group" aria-label="Variantes">
                ${variants.map(v => {
                    const hex = variantSwatch(v.lote.variante);
                    const light = /#f|#e|hsl\([^)]+9[0-9]%\)/i.test(hex) || hex === '#f2f2f7' || hex === '#f5f0e6' || hex === '#e8d5b7' || hex === '#e8dcc8' || hex === '#f3e5d0';
                    return `
                    <button type="button" class="prod-shelf-dot${v.lote.id === activeId ? ' is-active' : ''}${light ? ' is-light' : ''}"
                        data-pick-variant="${v.lote.id}"
                        style="--swatch:${hex}"
                        title="${esc(v.lote.variante || 'Variante')}"
                        aria-label="${esc(v.lote.variante || 'Variante')}"></button>`;
                }).join('')}
            </div>`;

        const cards = variants.map(v => {
            const img = safeImageSrc(v.lote.imagen || famImg || '');
            const title = v.lote.variante || displayName(v.lote.producto) || 'Variante';
            const active = v.lote.id === activeLote.id;
            return `
                <article class="prod-shelf-card${active ? ' is-active' : ''}" data-pick-variant="${v.lote.id}">
                    <div class="prod-shelf-media">
                        ${img
                            ? `<img src="${img}" alt="" loading="lazy">`
                            : `<div class="prod-shelf-ph" aria-hidden="true"></div>`}
                    </div>
                    ${dotsHtml(v.lote.id)}
                    <div class="prod-shelf-copy">
                        <h4 class="prod-shelf-title">${esc(title)}</h4>
                        <p class="prod-shelf-price">${Calc.fmtMXN(v.lote.precio)}</p>
                        <p class="prod-shelf-sub">${v.calc.inventarioRestante} uds · ${esc(label(v.calc.estrategia))}</p>
                    </div>
                </article>`;
        });

        return `
            <section class="prod-shelf" aria-label="Colores y versiones">
                <div class="prod-shelf-head">
                    <h3>Colores y versiones.</h3>
                    <div class="prod-shelf-nav">
                        <button type="button" class="prod-shelf-arrow" data-prod-shelf-scroll="-1" data-prod-shelf-track="prod-shelf-track" aria-label="Anterior">‹</button>
                        <button type="button" class="prod-shelf-arrow" data-prod-shelf-scroll="1" data-prod-shelf-track="prod-shelf-track" aria-label="Siguiente">›</button>
                    </div>
                </div>
                <div class="prod-shelf-track" id="prod-shelf-track">
                    ${cards.join('')}
                </div>
            </section>`;
    }

    function logisticaSummaryLine(lote) {
        const tipo = String(lote.tipo || '').toUpperCase();
        if (tipo === 'FBA') {
            const st = lote.fbaInboundEstado || '';
            if (!st) return 'FBA · sin estatus de inbound';
            return `FBA · ${FBA_INBOUND_LABELS[st] || st}`;
        }
        if (tipo === 'FBM') {
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            const pending = ventas.find(v => v.envioEstado && v.envioEstado !== 'enviado');
            if (pending) return `FBM · ${ENVIO_LABELS[pending.envioEstado] || pending.envioEstado}`;
            if (ventas.some(v => v.envioEstado === 'enviado')) return 'FBM · envíos al día';
            return 'FBM · tú envías';
        }
        return tipo || 'Logística';
    }

    function pctKeepa(v) {
        if (v == null || !Number.isFinite(Number(v))) return '—';
        const n = Number(v);
        return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
    }

    function renderKeepaMini(lote, calc) {
        const asin = String(lote.asin || '').trim().toUpperCase();
        const cache = window.Keepa?.readCache?.(asin);
        const bb = cache?.buyBox ?? cache?.marketPrice ?? cache?.currentPrice ?? null;
        const avg90 = cache?.avg90 ?? null;
        const vs90 = cache?.vs90 ?? (bb != null && avg90 > 0 ? (bb - avg90) / avg90 : null);
        const bsr = cache?.bsr ?? null;
        const bsrVs90 = cache?.bsrVs90 ?? null;
        const monthly = cache?.monthlySold ?? null;

        const overlays = window.KeepaChart?.overlaysFromLote?.(lote) || {};
        const breakEven = overlays.breakEven ?? null;
        let utilBb = null;
        let roiBb = null;
        if (bb != null && window.Calc?.utilidadAtPrice) {
            try {
                const u = Calc.utilidadAtPrice(lote, bb, window.State?.settings);
                utilBb = u.utilidad;
                const costo = Number(lote.costo) || 0;
                if (costo > 0) roiBb = u.utilidad / costo;
            } catch { /* ignore */ }
        }
        const gapBe = (bb != null && breakEven != null) ? bb - breakEven : null;
        const gapPrice = (bb != null && Number(lote.precio) > 0) ? Number(lote.precio) - bb : null;

        const cell = (label, value, hint = '') => `
            <div class="lotes-km-cell">
                <span class="lotes-km-label">${esc(label)}</span>
                <strong class="lotes-km-value">${value}</strong>
                ${hint ? `<span class="lotes-km-hint">${esc(hint)}</span>` : ''}
            </div>`;

        if (!cache) {
            return `
                <section class="lotes-keepa-mini lotes-float-block">
                    <div class="lotes-keepa-mini-head">
                        <h4 class="lotes-float-block-title">Mercado</h4>
                        <button type="button" class="btn ghost sm" data-action="open-keepa" data-id="${esc(lote.id)}">Cargar Keepa</button>
                    </div>
                    <p class="muted small" style="margin:0">Sin datos en caché. Abre Keepa Lab o carga Buy Box para ver BB, avg90 y BSR aquí.</p>
                </section>`;
        }

        let demanda = 'Demanda estable';
        if (bsrVs90 != null) {
            if (bsrVs90 <= -0.05) demanda = 'Demanda mejora';
            else if (bsrVs90 >= 0.08) demanda = 'Demanda empeora';
        }

        return `
            <section class="lotes-keepa-mini lotes-float-block">
                <div class="lotes-keepa-mini-head">
                    <h4 class="lotes-float-block-title">Mercado</h4>
                    <span class="muted small">${esc(cache.signalLabel || 'Keepa')}</span>
                </div>
                <div class="lotes-km-grid">
                    ${cell('BB actual', esc(Calc.fmtMXN(bb)))}
                    ${cell('Avg 90d', esc(Calc.fmtMXN(avg90)))}
                    ${cell('vs avg90', esc(pctKeepa(vs90)))}
                    ${cell('Tu precio vs BB', gapPrice == null ? '—' : esc(`${gapPrice >= 0 ? '+' : ''}${Calc.fmtMXN(gapPrice)}`))}
                    ${cell('vs break-even', gapBe == null ? '—' : esc(`${gapBe >= 0 ? '+' : ''}${Calc.fmtMXN(gapBe)}`))}
                    ${cell('Utilidad @ BB', utilBb == null ? '—' : esc(Calc.fmtMXN(utilBb)), roiBb != null ? `ROI ${pctKeepa(roiBb)}` : '')}
                    ${cell('BSR', bsr == null ? '—' : esc(Number(bsr).toLocaleString('es-MX')), pctKeepa(bsrVs90))}
                    ${cell('Ventas/mes', monthly == null ? '—' : esc(`${monthly}+`), demanda)}
                </div>
            </section>`;
    }

    function renderDetailTab(lote, calc) {
        if (local.detailTab === 'renta') return renderTabRentabilidad(lote, calc);
        if (local.detailTab === 'inv') return renderTabInventario(lote, calc);
        if (local.detailTab === 'reco') return renderTabRecomendacion(lote, calc);
        if (local.detailTab === 'hist') return renderTabHistorial(lote, calc);
        return '';
    }

    function renderTabRentabilidad(lote, calc) {
        const isAmz = window.State.marketplace === 'amazon'
            || window.State.settings?.marketplace === 'amazon';
        const adsCls = calc.adsStatus === 'over' ? 'neg'
            : calc.adsStatus === 'near' ? 'warn'
            : calc.adsStatus === 'ok' ? 'pos' : '';
        const adsMsg = {
            ok: 'Dentro del tope CPA',
            near: 'Cerca del tope CPA',
            over: 'Por arriba del tope CPA',
            sin_ventas: 'Hay Ads sin ventas aún',
            sin_tope: 'Sin tope (no Escalar/Mantener)',
            na: 'Sin gasto Ads registrado',
        }[calc.adsStatus] || '';
        const catLabel = isAmz && calc.categoriaAmazon && Calc.AMZ_CATEGORIES?.[calc.categoriaAmazon]
            ? Calc.AMZ_CATEGORIES[calc.categoriaAmazon].label
            : '';
        const comLabel = isAmz
            ? `Referido ${catLabel ? `(${catLabel}) ` : ''}(${(calc.pctComision * 100).toFixed(1)}% s/sin IVA)`
            : `Comisión Meli (${(calc.pctComision * 100).toFixed(0)}%)`;
        const envioLabel = isAmz
            ? (String(lote.tipo || '').toUpperCase() === 'FBM' ? 'Envío FBM' : 'FBA logística')
            : 'Envío al cliente';
        const envioVal = calc.envio != null ? calc.envio : (Number(lote.envio) || 0);
        const fbaNote = isAmz && calc.fbaMeta?.source === 'tabla'
            ? ` · ${calc.fbaMeta.tamano} · ${calc.fbaMeta.peso} kg`
            : (isAmz && calc.fbaMeta?.source === 'manual' ? ' · override' : '');
        // Utilidad + inversión = lo que llega por venta (precio − fees), mismo criterio que Caja.
        const recibesPorVenta = Math.max(0, (Number(lote.costo) || 0) + (Number(calc.utilidad) || 0));
        const piezas = Math.max(0, Number(calc.inventarioRestante) || 0)
            || Math.max(0, Number(lote.unidades) || 0);
        const recibesTotal = recibesPorVenta * piezas;
        const inversionPiezas = Math.max(0, Number(lote.costo) || 0) * piezas;
        const ventasReg = Array.isArray(lote.ventas) ? lote.ventas : [];
        const udsVendidas = Math.max(0, Number(calc.vendidas) || 0);
        let acumuladoVentas = 0;
        if (ventasReg.length && Data.ventaLiberacionAmount) {
            const settings = window.State.settings;
            ventasReg.forEach(v => {
                acumuladoVentas += Number(Data.ventaLiberacionAmount(lote, v, settings)) || 0;
            });
        } else if (udsVendidas > 0) {
            acumuladoVentas = recibesPorVenta * udsVendidas;
        }
        acumuladoVentas = Math.round(acumuladoVentas * 100) / 100;
        const nPedidos = ventasReg.length || (udsVendidas > 0 ? 1 : 0);

        return `
            <div class="lotes-float-block lotes-costos">
                <h4 class="lotes-float-block-title">Costos</h4>
                <div class="breakdown breakdown--costos">
                    <div class="breakdown-row"><span class="label">Precio de venta</span><span class="val">${Calc.fmtMXN(lote.precio)}</span></div>
                    <div class="breakdown-row"><span class="label">Costo unitario</span><span class="val">− ${Calc.fmtMXN(lote.costo)}</span></div>
                    <div class="breakdown-row"><span class="label">${comLabel}${isAmz && calc.referidoMinimo ? ` · mín ${Calc.fmtMXN(calc.referidoMinimo)}` : ''}</span><span class="val">− ${Calc.fmtMXN(calc.comisionVariable)}</span></div>
                    ${!isAmz && calc.cargoFijo ? `<div class="breakdown-row"><span class="label">Cargo fijo publicación</span><span class="val">− ${Calc.fmtMXN(calc.cargoFijo)}</span></div>` : ''}
                    <div class="breakdown-row"><span class="label">${envioLabel}${fbaNote}</span><span class="val">− ${Calc.fmtMXN(envioVal)}</span></div>
                    ${isAmz && (calc.almacenamiento > 0) ? `<div class="breakdown-row"><span class="label">Almacenamiento FBA</span><span class="val">− ${Calc.fmtMXN(calc.almacenamiento)}</span></div>` : ''}
                    ${isAmz && (calc.varios > 0) ? `<div class="breakdown-row"><span class="label">Varios / Otros</span><span class="val">− ${Calc.fmtMXN(calc.varios)}</span></div>` : ''}
                    ${!isAmz ? `
                    <div class="breakdown-row"><span class="label">Retención IVA SAT</span><span class="val">− ${Calc.fmtMXN(calc.retIVA)}</span></div>
                    <div class="breakdown-row"><span class="label">Retención ISR SAT</span><span class="val">− ${Calc.fmtMXN(calc.retISR)}</span></div>
                    ` : ''}
                </div>

                <div class="costos-outcome" aria-label="Resultado por unidad">
                    <div class="costos-outcome-row">
                        <div class="costos-outcome-copy">
                            <span class="costos-outcome-k">Utilidad neta</span>
                            <span class="costos-outcome-h">por unidad</span>
                        </div>
                        <span class="costos-outcome-v ${calc.utilidad >= 0 ? 'pos' : 'neg'}">${Calc.fmtMXN(calc.utilidad)}</span>
                    </div>
                    <div class="costos-outcome-row is-hero" title="Utilidad + costo · lo que entra a Caja por unidad">
                        <div class="costos-outcome-copy">
                            <span class="costos-outcome-k">Recibes por venta</span>
                            <span class="costos-outcome-h">utilidad + inversión</span>
                        </div>
                        <span class="costos-outcome-v">${Calc.fmtMXN(recibesPorVenta)}</span>
                    </div>
                </div>

                ${udsVendidas > 0 ? `
                <div class="costos-accum" title="Suma de lo que recibes en las ventas ya registradas (mismo criterio que Caja)">
                    <div class="costos-accum-top">
                        <span class="costos-accum-badge">Acumulado</span>
                        <span class="costos-accum-meta">${udsVendidas} ud · ${nPedidos} pedido${nPedidos === 1 ? '' : 's'}</span>
                    </div>
                    <div class="costos-accum-body">
                        <div class="costos-accum-copy">
                            <span class="costos-accum-k">En ventas registradas</span>
                            <span class="costos-accum-h">Lo que ya entra a Caja al marcar Cobrado</span>
                        </div>
                        <span class="costos-accum-v"${UI.fxAttrs?.(acumuladoVentas, 'mxn') || ''}>${Calc.fmtMXN(acumuladoVentas)}</span>
                    </div>
                    <span class="costos-accum-mark" aria-hidden="true"></span>
                </div>` : ''}

                ${piezas > 1 ? `
                <div class="costos-stock" aria-label="Resumen por inventario">
                    <div class="costos-stock-head">
                        <span class="costos-stock-n">${piezas}</span>
                        <span class="costos-stock-l">piezas en inventario</span>
                    </div>
                    <div class="costos-stock-grid">
                        <div class="costos-stock-cell" title="Costo unitario × ${piezas}">
                            <span class="costos-stock-k">Inversión inicial</span>
                            <span class="costos-stock-v">${Calc.fmtMXN(inversionPiezas)}</span>
                            <span class="costos-stock-h">costo × ${piezas}</span>
                        </div>
                        <div class="costos-stock-cell is-focus" title="Recibes por venta × ${piezas}">
                            <span class="costos-stock-k">Si las vendes</span>
                            <span class="costos-stock-v">${Calc.fmtMXN(recibesTotal)}</span>
                            <span class="costos-stock-h">recibes × ${piezas}</span>
                        </div>
                    </div>
                </div>` : ''}
            </div>

            <h4 style="margin-top:18px">Ads vs tope CPA</h4>
            <div class="breakdown ads-panel">
                <div class="breakdown-row">
                    <span class="label">Gasto Ads acumulado</span>
                    <span class="val editable-ads" data-edit-field="gastoAds" data-id="${lote.id}" title="Click para editar">${Calc.fmtMXN(calc.gastoAds)}</span>
                </div>
                <div class="breakdown-row"><span class="label">Tope CPA / venta</span><span class="val">${calc.topeCPA ? Calc.fmtMXN(calc.topeCPA) : '—'}</span></div>
                <div class="breakdown-row"><span class="label">Ads / venta realizada</span><span class="val ${adsCls}">${calc.vendidas > 0 ? Calc.fmtMXN(calc.adsPorVenta) : '—'}</span></div>
                <div class="breakdown-row total">
                    <span class="label">Diagnóstico Ads</span>
                    <span class="val ${adsCls}">${adsMsg}</span>
                </div>
            </div>
            <p class="muted small">Tope = utilidad × % CPA de Ajustes. Registra el gasto real de Product Ads de este SKU.</p>
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
        const visibleVariants = listableVariants(family);
        const multi = visibleVariants.length > 1;
        const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
        // Ventas: si hay varias variantes, listar las del producto con columna color
        const allVentas = multi
            ? visibleVariants.flatMap(v => (v.lote.ventas || []).map(venta => ({
                ...venta,
                variante: v.lote.variante || '—',
                loteId: v.lote.id,
                colorCls: cls(v.calc.estrategia),
            }))).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
            : ventas.map(v => ({ ...v, variante: null, loteId: lote.id }));
        const sparkHTML = ventasSparkline(allVentas, calc);

        // Stock solo de colores activos (ocultos los dados de baja a 0)
        const stockBlock = multi ? `
            <h4>Stock por color</h4>
            <div class="variant-stock-grid">
                ${visibleVariants.map(v => `
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
                    <button class="btn btn-sm" data-action="writeoff" data-id="${lote.id}">🗑 Baja</button>
                    <button class="btn btn-sm" data-action="restock" data-id="${lote.id}">📦 Reabastecer</button>
                    <button class="btn primary btn-sm" data-action="sale" data-id="${lote.id}">+ Registrar venta</button>
                </div>
            </div>
            ${(() => {
                const sug = Calc.suggestRestock?.(lote, window.State.settings, { calc });
                if (!sug) return '';
                if (sug.action === 'buy') {
                    return `<p class="prod-restock-hint">Reponer sugerido: <strong>+${sug.suggestUds} ud</strong> (~${Calc.fmtMXN(sug.cash)}) · ${esc(sug.reason)}</p>`;
                }
                if (sug.action === 'no') {
                    return `<p class="prod-restock-hint is-no">No reponer · ${esc(sug.reason)}</p>`;
                }
                return sug.vendidas > 0
                    ? `<p class="prod-restock-hint muted">${esc(sug.reason)}</p>`
                    : '';
            })()}
            ${prepEnvioOn() && String(lote.tipo || '').toUpperCase() === 'FBM' ? `
                <p class="muted small ship-help">
                    FBM: en cada venta elige el <strong>estatus de envío al cliente</strong>.
                </p>
            ` : ''}
            ${sparkHTML}
            ${allVentas.length ? `
                <table class="mini-table" style="margin-top:8px">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            ${multi ? '<th>Color</th>' : ''}
                            <th class="num">Uds.</th>
                            <th class="num">Precio</th>
                            <th class="num">Total</th>
                            ${prepEnvioOn() && String(lote.tipo || '').toUpperCase() === 'FBM' ? '<th>Envío al cliente</th>' : ''}
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
                                ${prepEnvioOn() && String(lote.tipo || '').toUpperCase() === 'FBM' ? `<td>${shipEstadoSelect(v.loteId, v)}</td>` : ''}
                                <td class="num"><button class="icon-btn" data-action="del-venta" data-lote="${v.loteId}" data-venta="${v.id}" title="Eliminar venta">×</button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : `<p class="muted small" style="margin-top:8px">Sin ventas registradas. Presiona <strong>+ Registrar venta</strong> y elige el color.</p>`}
        `;
    }

    function renderEnvioPanel(family, lote) {
        const isFba = String(lote.tipo || '').toUpperCase() === 'FBA';

        // FBA = mandar inventario a Amazon (por lote), no por venta al cliente
        if (isFba) {
            const cur = lote.fbaInboundEstado || '';
            const opts = ENVIO_ESTADOS_OPTS_FBA.map(o =>
                `<option value="${o.value}" ${o.value === cur ? 'selected' : ''}>${o.label}</option>`
            ).join('');
            const yaEnFba = cur === 'recibido';
            return `
                <div class="envio-panel envio-panel-fba">
                    <div class="envio-panel-title">Enviar a FBA (Amazon)</div>
                    <p class="muted small" style="margin:4px 0 10px">
                        Cuando mandas inventario al almacén de Amazon.
                    </p>
                    <div class="envio-panel-row" style="border-top:0;padding-top:0">
                        <div class="envio-panel-info">
                            <strong>${esc(lote.sku || lote.producto)}</strong>
                            <span class="muted">· stock ${Math.max(0, (Number(lote.unidades) || 0) - (Number(lote.vendidas) || 0))} ud</span>
                            ${yaEnFba ? `<span class="ship-badge ship-enviado">${esc(FBA_INBOUND_LABELS.recibido)}</span>` : ''}
                        </div>
                        <select class="ship-estado-select"
                            data-fba-inbound
                            data-lote="${esc(lote.id)}"
                            aria-label="Estatus envío a FBA">${opts}</select>
                    </div>
                </div>`;
        }

        // FBM = tú envías al cliente (por venta)
        const rows = family.variants.flatMap(v => (v.lote.ventas || []).map(venta => ({
            ...venta,
            loteId: v.lote.id,
            variante: v.lote.variante || '',
        }))).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

        if (!rows.length) {
            return `
                <div class="envio-panel">
                    <div class="envio-panel-title">Estatus envío al cliente</div>
                    <p class="muted small" style="margin:6px 0 10px">
                        Con FBM tú envías al comprador. Registra una venta y elige el estatus aquí.
                    </p>
                    <button type="button" class="btn primary btn-sm" data-action="sale" data-id="${lote.id}">+ Registrar venta</button>
                </div>`;
        }

        return `
            <div class="envio-panel">
                <div class="envio-panel-title">Estatus envío al cliente</div>
                <p class="muted small" style="margin:4px 0 10px">FBM: tú preparas y mandas el pedido al comprador.</p>
                <div class="envio-panel-list">
                    ${rows.slice(0, 12).map(v => `
                        <div class="envio-panel-row">
                            <div class="envio-panel-info">
                                <strong>${Calc.fmtDate(v.fecha)}</strong>
                                ${v.variante ? `<span class="muted">· ${esc(v.variante)}</span>` : ''}
                                <span class="muted">· ${v.unidades} ud · ${Calc.fmtMXN(v.precio)}</span>
                            </div>
                            ${shipEstadoSelect(v.loteId, v)}
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    function shipEstadoSelect(loteId, venta) {
        const cur = venta.envioEstado || '';
        const opts = ENVIO_ESTADOS_OPTS_FBM.map(o =>
            `<option value="${o.value}" ${o.value === cur ? 'selected' : ''}>${o.label}</option>`
        ).join('');
        return `<select class="ship-estado-select" data-ship-estado data-lote="${esc(loteId)}" data-venta="${esc(venta.id)}" aria-label="Estatus de envío">${opts}</select>`;
    }

    function isAmzMarketplace() {
        return window.State.marketplace === 'amazon'
            || window.State.settings?.marketplace === 'amazon';
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
                    Partimos del <strong>precio de venta</strong> (${Calc.fmtMXN(a.precio)}), restamos
                    ${window.State.marketplace === 'amazon'
                        ? 'comisión por referido y fulfillment/envío'
                        : 'comisión Meli, cargo fijo, envío y retenciones SAT'}.
                    El resultado es el <strong>costo máximo</strong> al que
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

        const isAmz = window.State.marketplace === 'amazon'
            || window.State.settings?.marketplace === 'amazon';
        const catName = isAmz && b.categoriaAmazon && Calc.AMZ_CATEGORIES?.[b.categoriaAmazon]
            ? Calc.AMZ_CATEGORIES[b.categoriaAmazon].label
            : '';
        const comLabel = isAmz
            ? `Referido${catName ? ` · ${catName}` : ''} (${(b.pctComision * 100).toFixed(1)}% s/sin IVA)`
            : `Comisión Meli (${(b.pctComision * 100).toFixed(0)}%)`;
        return `
            <div class="breakdown">
                <div class="breakdown-row"><span class="label">Precio de venta</span><span class="val">${Calc.fmtMXN(a.precio)}</span></div>
                <div class="breakdown-row"><span class="label">${comLabel}</span><span class="val">− ${Calc.fmtMXN(b.comisionVariable)}</span></div>
                ${!isAmz && b.cargoFijo ? `<div class="breakdown-row"><span class="label">Cargo fijo</span><span class="val">− ${Calc.fmtMXN(b.cargoFijo)}</span></div>` : ''}
                <div class="breakdown-row"><span class="label">${isAmz ? 'FBA / envío' : 'Envío'}</span><span class="val">− ${Calc.fmtMXN(b.envio)}</span></div>
                ${isAmz && b.almacenamiento > 0 ? `<div class="breakdown-row"><span class="label">Almacenamiento FBA</span><span class="val">− ${Calc.fmtMXN(b.almacenamiento)}</span></div>` : ''}
                ${isAmz && b.varios > 0 ? `<div class="breakdown-row"><span class="label">Varios / Otros</span><span class="val">− ${Calc.fmtMXN(b.varios)}</span></div>` : ''}
                ${!isAmz ? `
                <div class="breakdown-row"><span class="label">Retención IVA SAT</span><span class="val">− ${Calc.fmtMXN(b.retIVA)}</span></div>
                <div class="breakdown-row"><span class="label">Retención ISR SAT</span><span class="val">− ${Calc.fmtMXN(b.retISR)}</span></div>
                ` : ''}
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
        if (e.tipo === 'baja-inventario') {
            const motivos = {
                dano: 'Daño / defecto',
                venta_externa: 'Venta fuera del marketplace',
                merma: 'Merma / extravío',
                devolucion_proveedor: 'Devolución a proveedor',
                otro: 'Otro',
            };
            const m = motivos[e.meta.motivo] || e.meta.motivo || 'Otro';
            return `🗑 Baja de inventario — −${e.meta.unidades} uds · ${esc(m)} · valor al costo ${Calc.fmtMXN(e.meta.valorPerdido)}${e.meta.notas ? ` · ${esc(e.meta.notas)}` : ''}`;
        }
        if (e.tipo === 'envio-prep') {
            const from = ENVIO_LABELS[e.meta.from] || e.meta.from || '—';
            const to = ENVIO_LABELS[e.meta.to] || e.meta.to || '—';
            return `🚚 Envío al cliente — ${esc(from)} → <strong>${esc(to)}</strong>${e.meta.unidades ? ` · ${e.meta.unidades} uds` : ''}`;
        }
        if (e.tipo === 'fba-inbound') {
            const from = FBA_INBOUND_LABELS[e.meta.from] || e.meta.from || '—';
            const to = FBA_INBOUND_LABELS[e.meta.to] || e.meta.to || '—';
            return `📦 Envío a FBA — ${esc(from)} → <strong>${esc(to)}</strong>`;
        }
        return `• ${esc(e.tipo)}`;
    }

    // Sparkline SVG simple de ventas por semana (últimas 8 semanas).
    // ---- Ventas en el tiempo (catálogo) --------------------------------
    const SALES_RANGES = [
        { id: '4w', label: '4 sem', period: 'weeks', range: 4 },
        { id: '12w', label: '12 sem', period: 'weeks', range: 12 },
        { id: '6m', label: '6 meses', period: 'months', range: 6 },
        { id: 'ytd', label: 'YTD', period: 'months', range: 'ytd' },
    ];

    function salesRangeConfig(id = local.salesChart.range) {
        return SALES_RANGES.find(r => r.id === id) || SALES_RANGES[1];
    }

    function salesPeriodKeys(period, range, now = new Date()) {
        const keys = [];
        if (period === 'months') {
            if (range === 'ytd') {
                for (let m = 0; m <= now.getMonth(); m++) {
                    const x = new Date(now.getFullYear(), m, 1);
                    keys.push({
                        key: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`,
                        label: x.toLocaleDateString('es-MX', { month: 'short' }).replace(/\.$/, ''),
                        tip: x.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
                    });
                }
                return keys;
            }
            const count = Math.max(1, Number(range) || 6);
            const d = new Date(now.getFullYear(), now.getMonth(), 1);
            for (let i = count - 1; i >= 0; i--) {
                const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
                keys.push({
                    key: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`,
                    label: x.toLocaleDateString('es-MX', { month: 'short' }).replace(/\.$/, ''),
                    tip: x.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
                });
            }
            return keys;
        }
        const count = Math.max(1, Number(range) || 12);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const day = (today.getDay() + 6) % 7;
        const thisMon = new Date(today);
        thisMon.setDate(today.getDate() - day);
        for (let i = count - 1; i >= 0; i--) {
            const mon = new Date(thisMon);
            mon.setDate(thisMon.getDate() - i * 7);
            const key = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
            const sun = new Date(mon);
            sun.setDate(mon.getDate() + 6);
            keys.push({
                key,
                label: mon.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace(/\.$/, ''),
                tip: `${mon.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${sun.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`,
            });
        }
        return keys;
    }

    function saleBucketKey(day, period) {
        if (!day) return '';
        if (period === 'months') {
            return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;
        }
        const mon = new Date(day.getFullYear(), day.getMonth(), day.getDate());
        const wd = (mon.getDay() + 6) % 7;
        mon.setDate(mon.getDate() - wd);
        return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
    }

    function buildCatalogSalesData() {
        const cfg = salesRangeConfig();
        const period = cfg.period;
        const range = cfg.range;
        const now = new Date();
        const slots = salesPeriodKeys(period, range, now);
        const slotMap = new Map(slots.map(s => [s.key, {
            ...s,
            unidades: 0,
            cash: 0,
            ganancia: 0,
            pedidos: 0,
            products: new Map(),
        }]));
        const byProduct = new Map();
        const settings = window.State.settings;

        (window.State.lotes || []).forEach(lote => {
            const name = String(lote.producto || 'Sin nombre').trim() || 'Sin nombre';
            const pid = familyKey(lote);
            const ventas = Array.isArray(lote.ventas) ? lote.ventas : [];
            ventas.forEach(v => {
                const day = Calc.effectiveSaleDay(v.fecha, now);
                if (!day) return;
                const key = saleBucketKey(day, period);
                const bucket = slotMap.get(key);
                if (!bucket) return;
                const uds = Math.max(0, Number(v.unidades) || 0);
                const precio = Number(v.precio) || 0;
                const cash = precio * uds;
                let gain = 0;
                try {
                    const u = Calc.utilidadAtPrice(lote, precio, settings);
                    gain = (Number(u?.utilidad) || 0) * uds;
                } catch (_) {
                    gain = 0;
                }
                bucket.unidades += uds;
                bucket.cash += cash;
                bucket.ganancia += gain;
                bucket.pedidos += 1;

                if (!bucket.products.has(pid)) {
                    bucket.products.set(pid, { id: pid, name, unidades: 0, cash: 0, ganancia: 0 });
                }
                const bp = bucket.products.get(pid);
                bp.unidades += uds;
                bp.cash += cash;
                bp.ganancia += gain;
                if (name.length > bp.name.length) bp.name = name;

                if (!byProduct.has(pid)) {
                    byProduct.set(pid, {
                        id: pid,
                        name,
                        unidades: 0,
                        cash: 0,
                        ganancia: 0,
                        pedidos: 0,
                    });
                }
                const p = byProduct.get(pid);
                p.unidades += uds;
                p.cash += cash;
                p.ganancia += gain;
                p.pedidos += 1;
                if (name.length > p.name.length) p.name = name;
            });
        });

        const metric = local.salesChart.metric || 'unidades';
        const focusId = local.salesChart.focusId || null;
        let buckets = slots.map(s => {
            const b = slotMap.get(s.key);
            const top = [...b.products.values()]
                .sort((a, c) => (c[metric] || 0) - (a[metric] || 0) || c.unidades - a.unidades)
                .slice(0, 2)
                .map(p => ({
                    id: p.id,
                    name: p.name,
                    unidades: p.unidades,
                    cash: p.cash,
                    ganancia: p.ganancia,
                }));
            let unidades = b.unidades;
            let cash = b.cash;
            let ganancia = b.ganancia;
            let pedidos = b.pedidos;
            if (focusId) {
                const fp = b.products.get(focusId);
                unidades = fp?.unidades || 0;
                cash = fp?.cash || 0;
                ganancia = fp?.ganancia || 0;
                pedidos = 0;
            }
            return {
                key: b.key,
                label: b.label,
                tip: b.tip,
                unidades,
                cash,
                ganancia,
                pedidos,
                top: focusId ? top.filter(p => p.id === focusId) : top,
            };
        });
        let products = [...byProduct.values()]
            .sort((a, b) => (b[metric] || 0) - (a[metric] || 0) || b.unidades - a.unidades);
        const focusName = focusId
            ? (byProduct.get(focusId)?.name || products.find(p => p.id === focusId)?.name || null)
            : null;
        if (focusId && !byProduct.has(focusId)) {
            local.salesChart.focusId = null;
        }
        const rankedAll = products.slice(0, 8);
        products = focusId
            ? products.filter(p => p.id === focusId).slice(0, 1)
            : products.slice(0, 6);
        const totals = buckets.reduce((acc, b) => {
            acc.unidades += b.unidades;
            acc.cash += b.cash;
            acc.ganancia += b.ganancia;
            acc.pedidos += b.pedidos;
            return acc;
        }, { unidades: 0, cash: 0, ganancia: 0, pedidos: 0 });

        // Delta: último bucket con data vs el anterior con data (fallback: penúltimo)
        const withData = buckets
            .map((b, i) => ({ b, i }))
            .filter(x => x.b.unidades > 0 || x.b.cash > 0 || Math.abs(x.b.ganancia) > 0.009);
        const cur = withData.length ? withData[withData.length - 1] : null;
        const prev = withData.length >= 2 ? withData[withData.length - 2] : null;
        let delta = null;
        if (cur && prev) {
            const curV = Number(cur.b[metric]) || 0;
            const prevV = Number(prev.b[metric]) || 0;
            const diff = curV - prevV;
            const pct = Math.abs(prevV) > 0.009
                ? (diff / Math.abs(prevV)) * 100
                : (Math.abs(diff) > 0.009 ? (diff > 0 ? 100 : -100) : 0);
            delta = {
                diff,
                pct,
                curLabel: cur.b.tip || cur.b.label,
                prevLabel: prev.b.tip || prev.b.label,
                periodWord: period === 'months' ? 'mes' : 'semana',
            };
        }

        return {
            period,
            range,
            rangeId: cfg.id,
            buckets,
            products,
            rankedAll,
            totals,
            metric,
            delta,
            focusId: local.salesChart.focusId || null,
            focusName,
        };
    }

    function fmtSalesMetric(metric, n) {
        if (metric === 'unidades') return `${Math.round(n)} uds`;
        return Calc.fmtMXN(n);
    }

    function salesSmoothPath(vals, xAt, yAt) {
        const n = vals.length;
        if (!n) return '';
        const pts = vals.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
        if (n === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
        if (n === 2) {
            return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;
        }
        let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
        for (let i = 0; i < n - 1; i++) {
            const p0 = pts[i - 1] || pts[i];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[i + 2] || p2;
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
        }
        return d;
    }

    function renderSalesAreaSvg(buckets, metric) {
        const n = buckets.length;
        const vals = buckets.map(b => Number(b[metric]) || 0);
        const maxV = Math.max(1, ...vals.map(v => Math.abs(v)));
        const W = 720, H = 220, padL = 8, padR = 8, padT = 18, padB = 36;
        const xAt = i => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
        const yAt = v => padT + (1 - Math.abs(v) / maxV) * (H - padT - padB);
        const baseY = H - padB;
        const line = salesSmoothPath(vals, xAt, yAt);
        const area = n
            ? `${line} L${xAt(n - 1).toFixed(1)},${baseY} L${xAt(0).toFixed(1)},${baseY} Z`
            : '';
        const uid = `ps${Math.random().toString(36).slice(2, 8)}`;
        const focus = n - 1;
        const labels = buckets.map((b, i) => {
            const show = n <= 8 || i === 0 || i === focus || i % Math.ceil(n / 6) === 0;
            if (!show) return '';
            return `<text class="prod-sales-svg-x" x="${xAt(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(b.label)}</text>`;
        }).join('');
        const dots = vals.map((v, i) => {
            const active = i === focus || v > 0;
            if (!active && n > 10) return '';
            return `<circle class="prod-sales-dot${i === focus ? ' is-focus' : ''}" data-sales-dot="${i}" cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="${i === focus ? 5 : 3.2}" />`;
        }).join('');
        // Column hit areas for easier hover
        const colW = n <= 1 ? (W - padL - padR) : (W - padL - padR) / Math.max(1, n - 1);
        const hits = buckets.map((b, i) => {
            const cx = xAt(i);
            const x = Math.max(padL, cx - colW / 2);
            const w = Math.min(W - padR - x, colW);
            return `<rect class="prod-sales-hit" data-sales-point="${i}" x="${x.toFixed(1)}" y="${padT}" width="${Math.max(8, w).toFixed(1)}" height="${(baseY - padT).toFixed(1)}" />`;
        }).join('');

        return `
            <svg class="prod-sales-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-hidden="true">
                <defs>
                    <linearGradient id="${uid}-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="var(--prod-sales-accent)" stop-opacity="0.38"/>
                        <stop offset="55%" stop-color="var(--prod-sales-accent)" stop-opacity="0.12"/>
                        <stop offset="100%" stop-color="var(--prod-sales-accent)" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="${uid}-stroke" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stop-color="var(--prod-sales-accent-2)"/>
                        <stop offset="100%" stop-color="var(--prod-sales-accent)"/>
                    </linearGradient>
                </defs>
                <line class="prod-sales-guide" x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}"/>
                <line class="prod-sales-guide" x1="${padL}" y1="${(padT + baseY) / 2}" x2="${W - padR}" y2="${(padT + baseY) / 2}"/>
                <line class="prod-sales-guide is-base" x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}"/>
                ${area ? `<path class="prod-sales-area" d="${area}" fill="url(#${uid}-fill)"/>` : ''}
                ${line ? `<path class="prod-sales-line" d="${line}" fill="none" stroke="url(#${uid}-stroke)"/>` : ''}
                ${dots}
                ${labels}
                ${hits}
            </svg>
            <div class="prod-sales-scale" aria-hidden="true">
                <span>${esc(fmtSalesMetric(metric, maxV))}</span>
                <span>${esc(fmtSalesMetric(metric, maxV / 2))}</span>
                <span>${metric === 'unidades' ? '0' : '$0'}</span>
            </div>
            <div class="prod-sales-tip" data-sales-tip hidden></div>
        `;
    }

    function renderSalesDelta(delta, metric) {
        if (!delta) {
            return `<span class="prod-sales-delta is-na">Sin periodo previo para comparar</span>`;
        }
        const up = delta.diff >= 0;
        const tone = Math.abs(delta.diff) < 0.009 ? 'is-flat' : (up ? 'is-up' : 'is-down');
        const arrow = Math.abs(delta.diff) < 0.009 ? '●' : (up ? '▲' : '▼');
        return `
            <span class="prod-sales-delta ${tone}">
                ${arrow} ${Math.abs(delta.pct).toFixed(0)}% vs ${esc(delta.periodWord)} anterior
                <span class="prod-sales-delta-abs">${up && delta.diff > 0 ? '+' : ''}${esc(fmtSalesMetric(metric, delta.diff))}</span>
            </span>`;
    }

    function catalogHasAnySales() {
        return (window.State.lotes || []).some(lote =>
            Array.isArray(lote.ventas) && lote.ventas.some(v => (Number(v.unidades) || 0) > 0)
        );
    }

    function exportSalesCsv(data) {
        const { buckets, rankedAll, rangeId, metric, focusName } = data;
        const lines = [];
        const stamp = new Date().toISOString().slice(0, 10);
        lines.push(`# Ventas Meli · rango ${rangeId}${focusName ? ` · filtro ${focusName}` : ''} · métrica ${metric} · ${stamp}`);
        lines.push('periodo,etiqueta,unidades,vendido,ganancia');
        buckets.forEach(b => {
            lines.push([
                JSON.stringify(b.tip || b.label),
                JSON.stringify(b.label),
                b.unidades,
                (Number(b.cash) || 0).toFixed(2),
                (Number(b.ganancia) || 0).toFixed(2),
            ].join(','));
        });
        lines.push('');
        lines.push('producto,unidades,vendido,ganancia,pedidos');
        (rankedAll || []).forEach(p => {
            lines.push([
                JSON.stringify(displayName(p.name)),
                p.unidades,
                (Number(p.cash) || 0).toFixed(2),
                (Number(p.ganancia) || 0).toFixed(2),
                p.pedidos,
            ].join(','));
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ventas-${rangeId}-${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(a.href);
            a.remove();
        }, 500);
    }

    function renderCatalogSalesChart() {
        const data = buildCatalogSalesData();
        const { buckets, products, rankedAll, totals, metric, rangeId, delta, focusId, focusName } = data;
        const metricLabel = metric === 'unidades' ? 'Unidades' : (metric === 'ganancia' ? 'Ganancia' : 'Vendido');
        const rangeLabel = salesRangeConfig(rangeId).label;

        if (!catalogHasAnySales()) {
            return `
                <section class="prod-sales-panel is-empty">
                    <div class="prod-sales-head">
                        <div>
                            <p class="prod-sales-kicker">Cierre del catálogo</p>
                            <h2 class="prod-sales-title">Ventas en el tiempo</h2>
                        </div>
                    </div>
                    <p class="prod-sales-empty">Todavía no hay ventas registradas. Cuando registres movimientos en Inventario, aquí aparece la curva y qué productos están jalando.</p>
                </section>`;
        }

        const rankSource = focusId ? products : (rankedAll || products);
        const topMax = Math.max(1, ...rankSource.map(p => Math.abs(Number(p[metric]) || 0)));
        const last = buckets[buckets.length - 1] || { unidades: 0, cash: 0, ganancia: 0 };
        const lastVal = Number(last[metric]) || 0;
        const tipPayload = buckets.map(b => ({
            tip: b.tip,
            label: b.label,
            unidades: b.unidades,
            cash: b.cash,
            ganancia: b.ganancia,
            pedidos: b.pedidos,
            top: (b.top || []).map(p => ({
                name: displayName(p.name),
                unidades: p.unidades,
                cash: p.cash,
                ganancia: p.ganancia,
            })),
        }));
        const focusChip = focusId
            ? `<button type="button" class="prod-sales-focus is-on" data-sales-focus-clear title="Quitar filtro">
                    Filtrado: ${esc(displayName(focusName || 'producto'))} ×
               </button>`
            : `<span class="prod-sales-focus-hint muted small">Toca ★ en un producto para filtrar la curva</span>`;

        return `
            <section class="prod-sales-panel" data-sales-chart>
                <div class="prod-sales-head">
                    <div class="prod-sales-copy">
                        <p class="prod-sales-kicker">Cierre del catálogo</p>
                        <h2 class="prod-sales-title">Ventas en el tiempo</h2>
                        <div class="prod-sales-subrow">
                            <p class="prod-sales-sub">
                                <strong>${esc(fmtSalesMetric(metric, lastVal))}</strong>
                                <span>periodo actual · ${esc(rangeLabel)}</span>
                            </p>
                            ${renderSalesDelta(delta, metric)}
                        </div>
                        <p class="prod-sales-foot muted small">${totals.unidades} uds · ${Calc.fmtMXN(totals.cash)} · ${Calc.fmtMXN(totals.ganancia)} gan. en el rango</p>
                        <div class="prod-sales-focus-row">${focusChip}</div>
                    </div>
                    <div class="prod-sales-toggles" role="group" aria-label="Vista del gráfico">
                        <div class="prod-sales-seg" data-seg="range">
                            ${SALES_RANGES.map(r => `
                                <button type="button" class="prod-sales-tog${rangeId === r.id ? ' is-on' : ''}" data-sales-range="${r.id}">${esc(r.label)}</button>
                            `).join('')}
                        </div>
                        <div class="prod-sales-seg" data-seg="metric">
                            <button type="button" class="prod-sales-tog${metric === 'unidades' ? ' is-on' : ''}" data-sales-metric="unidades">Uds</button>
                            <button type="button" class="prod-sales-tog${metric === 'cash' ? ' is-on' : ''}" data-sales-metric="cash">$</button>
                            <button type="button" class="prod-sales-tog${metric === 'ganancia' ? ' is-on' : ''}" data-sales-metric="ganancia">Gan.</button>
                        </div>
                        <button type="button" class="prod-sales-export" data-sales-export title="Descargar CSV del rango">CSV</button>
                    </div>
                </div>
                <div class="prod-sales-body">
                    <div class="prod-sales-chart" aria-label="${esc(metricLabel)} · ${esc(rangeLabel)}" data-sales-buckets="${esc(JSON.stringify(tipPayload))}" data-sales-metric-active="${esc(metric)}">
                        ${renderSalesAreaSvg(buckets, metric)}
                    </div>
                    <aside class="prod-sales-top">
                        <div class="prod-sales-top-head">
                            <h3>Qué está vendiendo</h3>
                            <span class="muted small">${esc(metricLabel)}</span>
                        </div>
                        <ol class="prod-sales-rank">
                            ${(focusId ? products : (rankedAll || products).slice(0, 6)).length ? (focusId ? products : (rankedAll || products).slice(0, 6)).map((p, i) => {
                                const v = Number(p[metric]) || 0;
                                const pct = Math.round((Math.abs(v) / topMax) * 100);
                                const on = focusId === p.id;
                                return `
                                    <li class="prod-sales-rank-item${on ? ' is-focus' : ''}" style="--i:${i}; --pct:${pct}">
                                        <button type="button" class="prod-sales-rank-btn" data-sales-select="${esc(p.id)}" title="Abrir ${esc(p.name)}">
                                            <span class="prod-sales-rank-idx">${i + 1}</span>
                                            <span class="prod-sales-rank-main">
                                                <span class="prod-sales-rank-name">${esc(displayName(p.name))}</span>
                                                <span class="prod-sales-rank-meta">${p.unidades} uds · ${p.pedidos} venta${p.pedidos === 1 ? '' : 's'}</span>
                                                <span class="prod-sales-rank-bar" aria-hidden="true"><i></i></span>
                                            </span>
                                            <span class="prod-sales-rank-val">${esc(fmtSalesMetric(metric, v))}</span>
                                        </button>
                                        <button type="button" class="prod-sales-rank-pin${on ? ' is-on' : ''}" data-sales-focus="${esc(p.id)}" title="${on ? 'Quitar filtro' : 'Filtrar curva a este producto'}" aria-label="Filtrar">★</button>
                                    </li>`;
                            }).join('') : `<li class="prod-sales-rank-empty muted small">Sin ventas en este rango</li>`}
                        </ol>
                    </aside>
                </div>
            </section>
        `;
    }

    function ventasSparkline(ventas, calc) {
        if (!ventas.length) return '';
        const now = Date.now();
        const WEEKS = 8;
        const buckets = new Array(WEEKS).fill(0);
        let cash = 0;
        ventas.forEach(v => {
            const day = Calc.effectiveSaleDay(v.fecha, new Date(now));
            if (!day) return;
            const wIdx = Math.floor((now - day.getTime()) / (7 * 86400000));
            if (wIdx >= 0 && wIdx < WEEKS) buckets[WEEKS - 1 - wIdx] += Number(v.unidades) || 0;
            cash += (Number(v.precio) || 0) * (Number(v.unidades) || 0);
        });
        const totalUds = buckets.reduce((s, x) => s + x, 0);
        if (!totalUds) return '';
        const max = Math.max(1, ...buckets);
        const W = 300, H = 48, pad = 2;
        const step = (W - pad * 2) / Math.max(1, WEEKS - 1);
        const yAt = v => H - pad - (v / max) * (H - pad * 2);
        const pts = buckets.map((v, i) => `${(pad + i * step).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
        const area = `${pad},${H - pad} ${pts} ${pad + (WEEKS - 1) * step},${H - pad}`;
        const dots = buckets.map((v, i) => (
            `<circle cx="${(pad + i * step).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="${v > 0 ? 2.4 : 1.4}" fill="var(--primary)" opacity="${v > 0 ? 1 : 0.35}"/>`
        )).join('');
        return `
            <div class="sparkline-wrap prod-spark">
                <div class="sparkline-title">Últimas 8 semanas · ${totalUds} uds · ${Calc.fmtMXN(cash)}</div>
                <svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
                    <polygon fill="color-mix(in srgb, var(--primary) 14%, transparent)" points="${area}"/>
                    <polyline fill="none" stroke="var(--primary)" stroke-width="1.8" stroke-linejoin="round" points="${pts}"/>
                    ${dots}
                </svg>
            </div>
        `;
    }

    // ---- Eventos dinámicos ---------------------------------------------
    /** Solo nodos del panel detalle (y acciones locales) tras un soft-render. */
    function bindDetailEvents() {
        const root = document.getElementById('lotes-detail');
        if (!root) return;

        root.querySelectorAll('[data-action="mobile-back"]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                local.mobileDetail = false;
                renderContent({ soft: true });
            });
        });

        root.querySelectorAll('[data-pick-variant]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                local.selectedVariant = btn.dataset.pickVariant;
                renderContent({ soft: true });
            });
        });

        root.querySelectorAll('[data-prod-shelf-scroll]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.prodShelfTrack || 'prod-shelf-track';
                const track = document.getElementById(id)
                    || btn.closest('.prod-shelf')?.querySelector('.prod-shelf-track');
                if (!track) return;
                const delta = Number(btn.dataset.prodShelfScroll) || 0;
                track.scrollBy({ left: delta * Math.min(280, track.clientWidth * 0.85), behavior: 'smooth' });
            });
        });

        root.querySelectorAll('[data-detail-tab]').forEach(el => {
            el.addEventListener('click', () => {
                local.detailTab = el.dataset.detailTab;
                renderContent({ soft: true });
            });
        });

        bindCompraIdealControls();

        root.querySelectorAll('[data-kebab-btn]').forEach(el => {
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

        root.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                if (action === 'edit') openModal(id);
                else if (action === 'open-keepa') {
                    const lote = window.State.lotes.find(item => item.id === id);
                    if (lote?.asin) window.KeepaView?.openAsin?.(lote.asin);
                }
                else if (action === 'set-logistica') setLogistica(id, btn.dataset.tipo);
                else if (action === 'dup') duplicate(id);
                else if (action === 'del') await remove(id);
                else if (action === 'sale') await recordSale(id);
                else if (action === 'restock') await restock(id);
                else if (action === 'writeoff') await writeOff(id);
                else if (action === 'status') await changeStatus(id);
                else if (action === 'del-venta') await removeSale(btn.dataset.lote, btn.dataset.venta);
                else if (action === 'pick-image') pickProductImage(btn.dataset.productId);
                else if (action === 'clear-image') await clearProductImage(btn.dataset.productId);
            });
        });

        root.querySelectorAll('.editable-price, .editable-stock, .editable-ads').forEach(el => {
            el.addEventListener('click', async () => {
                const id = el.dataset.id;
                const field = el.dataset.editField;
                await inlineEdit(id, field);
            });
        });

        root.querySelectorAll('[data-ship-estado]').forEach(sel => {
            sel.addEventListener('change', () => {
                setVentaEnvioEstado(sel.dataset.lote, sel.dataset.venta, sel.value);
            });
        });
        root.querySelectorAll('[data-fba-inbound]').forEach(sel => {
            sel.addEventListener('change', () => {
                setFbaInboundEstado(sel.dataset.lote, sel.value);
            });
        });
    }

    function refreshSalesChart() {
        const host = document.getElementById('lotes-sales-chart');
        if (host) host.innerHTML = renderCatalogSalesChart();
        bindSalesChartEvents();
    }

    function bindSalesChartEvents() {
        document.querySelectorAll('[data-sales-select]').forEach(btn => {
            if (btn.dataset.boundSales === '1') return;
            btn.dataset.boundSales = '1';
            btn.addEventListener('click', () => {
                const key = btn.dataset.salesSelect;
                const fam = families().find(f => f.key === key);
                if (!fam) return;
                local.selected = fam.key;
                local.selectedVariant = pickVisible(fam)?.lote?.id || null;
                local.detailTab = 'inv';
                if (isMobile()) local.mobileDetail = true;
                if (local.sheetTab !== 'catalog') {
                    local.sheetTab = 'catalog';
                    syncSheetTab();
                }
                renderContent({ soft: true });
                requestAnimationFrame(() => {
                    document.getElementById('lotes-detail')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
                });
            });
        });

        document.querySelectorAll('[data-sales-range]').forEach(btn => {
            if (btn.dataset.boundSales === '1') return;
            btn.dataset.boundSales = '1';
            btn.addEventListener('click', () => {
                const id = btn.dataset.salesRange;
                if (!SALES_RANGES.some(r => r.id === id)) return;
                if (local.salesChart.range === id) return;
                local.salesChart.range = id;
                refreshSalesChart();
            });
        });

        document.querySelectorAll('[data-sales-metric]').forEach(btn => {
            if (btn.dataset.boundSales === '1') return;
            btn.dataset.boundSales = '1';
            btn.addEventListener('click', () => {
                const m = btn.dataset.salesMetric;
                if (!['unidades', 'cash', 'ganancia'].includes(m)) return;
                if (local.salesChart.metric === m) return;
                local.salesChart.metric = m;
                refreshSalesChart();
            });
        });

        document.querySelectorAll('[data-sales-focus]').forEach(btn => {
            if (btn.dataset.boundSales === '1') return;
            btn.dataset.boundSales = '1';
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const id = btn.dataset.salesFocus;
                local.salesChart.focusId = local.salesChart.focusId === id ? null : id;
                refreshSalesChart();
            });
        });
        document.querySelectorAll('[data-sales-focus-clear]').forEach(btn => {
            if (btn.dataset.boundSales === '1') return;
            btn.dataset.boundSales = '1';
            btn.addEventListener('click', () => {
                local.salesChart.focusId = null;
                refreshSalesChart();
            });
        });
        document.querySelectorAll('[data-sales-export]').forEach(btn => {
            if (btn.dataset.boundSales === '1') return;
            btn.dataset.boundSales = '1';
            btn.addEventListener('click', () => exportSalesCsv(buildCatalogSalesData()));
        });

        // Hover tooltip
        document.querySelectorAll('.prod-sales-chart').forEach(chart => {
            if (chart.dataset.boundSalesHover === '1') return;
            chart.dataset.boundSalesHover = '1';
            let buckets = [];
            try {
                buckets = JSON.parse(chart.dataset.salesBuckets || '[]');
            } catch (_) {
                buckets = [];
            }
            const metric = chart.dataset.salesMetricActive || 'unidades';
            const tip = chart.querySelector('[data-sales-tip]');
            const svg = chart.querySelector('.prod-sales-svg');

            const hide = () => {
                if (tip) tip.hidden = true;
                chart.querySelectorAll('.prod-sales-dot').forEach(d => {
                    const last = Number(d.dataset.salesDot) === buckets.length - 1;
                    d.classList.remove('is-hover');
                    d.classList.toggle('is-focus', last);
                    d.setAttribute('r', last ? '5' : '3.2');
                });
            };

            const showAt = (idx, clientX, clientY) => {
                const b = buckets[idx];
                if (!b || !tip) return;
                const topHtml = (b.top || []).length
                    ? `<div class="prod-sales-tip-top">${(b.top || []).map(p => `
                        <div><strong>${esc(p.name)}</strong> · ${esc(fmtSalesMetric(metric, Number(p[metric]) || 0))}</div>
                      `).join('')}</div>`
                    : '<div class="prod-sales-tip-top muted">Sin ventas en este periodo</div>';
                tip.innerHTML = `
                    <div class="prod-sales-tip-date">${esc(b.tip || b.label)}</div>
                    <div class="prod-sales-tip-grid">
                        <span>Uds</span><strong>${b.unidades}</strong>
                        <span>Vendido</span><strong>${esc(Calc.fmtMXN(b.cash))}</strong>
                        <span>Ganancia</span><strong class="${b.ganancia >= 0 ? 'pos' : 'neg'}">${esc(Calc.fmtMXN(b.ganancia))}</strong>
                    </div>
                    ${topHtml}
                `;
                tip.hidden = false;
                const rect = chart.getBoundingClientRect();
                let left = clientX - rect.left + 14;
                let top = clientY - rect.top - 12;
                tip.style.left = '0px';
                tip.style.top = '0px';
                const tw = tip.offsetWidth || 200;
                const th = tip.offsetHeight || 100;
                if (left + tw > rect.width - 8) left = clientX - rect.left - tw - 14;
                if (top + th > rect.height - 8) top = Math.max(8, rect.height - th - 8);
                if (top < 8) top = 8;
                if (left < 8) left = 8;
                tip.style.left = `${left}px`;
                tip.style.top = `${top}px`;

                chart.querySelectorAll('.prod-sales-dot').forEach(d => {
                    const on = Number(d.dataset.salesDot) === idx;
                    d.classList.toggle('is-hover', on);
                    d.classList.toggle('is-focus', on);
                    d.setAttribute('r', on ? '5.5' : (Number(d.dataset.salesDot) === buckets.length - 1 ? '5' : '3.2'));
                });
            };

            chart.addEventListener('pointerleave', hide);
            chart.querySelectorAll('[data-sales-point]').forEach(hit => {
                hit.addEventListener('pointerenter', e => {
                    showAt(Number(hit.dataset.salesPoint), e.clientX, e.clientY);
                });
                hit.addEventListener('pointermove', e => {
                    showAt(Number(hit.dataset.salesPoint), e.clientX, e.clientY);
                });
            });
            // Keep svg from eating events oddly on mobile
            if (svg) svg.style.touchAction = 'manipulation';
        });
    }

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
                const searchInp = document.getElementById('lotes-search');
                if (searchInp) searchInp.value = '';
                renderContent();
            });
        });

        bindSalesChartEvents();

        // Row select (familia) — misma variante visible que la vitrina
        document.querySelectorAll('#lotes-list [data-select]').forEach(row => {
            row.addEventListener('click', () => {
                local.selected = row.dataset.select;
                const fam = families().find(f => f.key === local.selected);
                local.selectedVariant = fam ? (pickVisible(fam)?.lote.id || null) : null;
                if (isMobile()) local.mobileDetail = true;
                renderContent({ soft: true });
                document.getElementById('lotes-detail')?.scrollTo?.({ top: 0, behavior: 'smooth' });
            });
            row.addEventListener('dblclick', () => {
                if (isMobile()) return;
                const fam = families().find(f => f.key === row.dataset.select);
                const id = (fam ? pickVisible(fam)?.lote.id : null) || local.selectedVariant;
                if (id) openModal(id);
            });
        });

        // Vitrina superior: selección sin remount completo
        document.querySelectorAll('#lotes-catalog-track [data-select-family]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const key = btn.dataset.selectFamily;
                const fam = families().find(f => f.key === key);
                const next = fam ? pickVisible(fam) : null;
                if (!fam || !next?.lote) return;
                local.selected = fam.key;
                local.selectedVariant = next.lote.id;
                if (isMobile()) local.mobileDetail = true;
                renderContent({ soft: true });
                document.getElementById('lotes-detail')?.scrollTo?.({ top: 0, behavior: 'smooth' });
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

        bindDetailEvents();
    }

    function setFbaInboundEstado(loteId, estado) {
        const l = window.State.lotes.find(x => x.id === loteId);
        if (!l || !Data.setLoteFbaInboundEstado) return;
        try {
            Data.setLoteFbaInboundEstado(l, estado || '');
            window.State.lotes = Data.upsertLote(window.State.lotes, l);
            window.State.save();
            renderContent();
            window.App?.refreshNavCounts?.();
            const lab = estado ? (FBA_INBOUND_LABELS[estado] || estado) : 'Aún no';
            UI.toast(`FBA: ${lab}`);
        } catch (err) {
            UI.toast(err.message || 'Error', 'error');
        }
    }

    function setVentaEnvioEstado(loteId, ventaId, estado) {
        const l = window.State.lotes.find(x => x.id === loteId);
        if (!l || !Data.setVentaEnvioEstado) return;
        try {
            Data.setVentaEnvioEstado(l, ventaId, estado || '');
            window.State.lotes = Data.upsertLote(window.State.lotes, l);
            window.State.save();
            renderContent();
            window.App?.refreshNavCounts?.();
            const lab = estado ? (ENVIO_LABELS[estado] || estado) : 'Sin preparación';
            UI.toast(`Envío: ${lab}`);
        } catch (err) {
            UI.toast(err.message || 'Error', 'error');
        }
    }

    // ---- Inline edit ---------------------------------------------------
    function setLogistica(id, tipo) {
        const lote = window.State.lotes.find(l => l.id === id);
        if (!lote) return;
        const next = String(tipo || '').toUpperCase() === 'FBM' ? 'FBM' : 'FBA';
        if (lote.tipo === next) return;
        lote.tipo = next;
        window.State.lotes = Data.upsertLote(window.State.lotes, lote);
        window.State.save();
        renderContent();
        UI.toast(next === 'FBA'
            ? 'FBA · Amazon almacena y envía'
            : 'FBM · Tú preparas el envío');
    }

    async function inlineEdit(id, field) {
        const lote = window.State.lotes.find(l => l.id === id);
        if (!lote) return;
        const opts = {
            precio: { title: 'Nuevo precio de venta', message: `Actual: ${Calc.fmtMXN(lote.precio)}`, defaultValue: String(lote.precio) },
            stock:  { title: 'Nuevas unidades totales del lote', message: `Actual: ${lote.unidades} (${lote.vendidas || 0} vendidas)`, defaultValue: String(lote.unidades) },
            gastoAds: { title: 'Gasto Ads acumulado (MXN)', message: `Actual: ${Calc.fmtMXN(lote.gastoAds || 0)}`, defaultValue: String(lote.gastoAds || 0) },
        }[field];
        if (!opts) return;
        const raw = await UI.prompt(opts);
        if (raw === null || raw === undefined) return;
        const n = parseFloat(raw);
        if (isNaN(n) || n < 0) { UI.toast('Valor inválido', 'error'); return; }

        if (field === 'precio') lote.precio = n;
        else if (field === 'stock') {
            const vendidas = Data.syncVendidasFromVentas
                ? Data.syncVendidasFromVentas(lote)
                : (Number(lote.vendidas) || 0);
            const next = Math.round(n);
            if (next < vendidas) {
                UI.toast(`No puede bajar de ${vendidas} (ya vendidas)`, 'error');
                return;
            }
            lote.unidades = next;
        }
        else if (field === 'gastoAds') lote.gastoAds = Math.round(n * 100) / 100;

        window.State.lotes = Data.upsertLote(window.State.lotes, lote);
        window.State.save();
        renderContent();
        const msg = field === 'precio' ? 'Precio actualizado'
            : field === 'stock' ? 'Stock actualizado'
            : 'Gasto Ads actualizado';
        UI.toast(msg);
    }

    // ---- Imagen de producto (familia / productId) ----------------------
    const IMG_MAX_PX = 520;
    const IMG_QUALITY = 0.72;
    const IMG_MAX_BYTES = 180_000; // ~180 KB data URL por producto

    /** Solo data:image…;base64 (lo que genera compressImageFile). Evita XSS vía src. */
    function safeImageSrc(src) {
        const s = String(src || '').trim();
        return /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(s) ? s : '';
    }

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

        if (e.key.toLowerCase() === 'n') {
            e.preventDefault();
            openModal(null);
            return;
        }

        const list = families();
        if (!list.length) return;
        const currentIdx = list.findIndex(f => f.key === local.selected);
        const variantId = local.selectedVariant;

        if (e.key === 'ArrowDown' || e.key === 'j') {
            e.preventDefault();
            const nextIdx = currentIdx < 0 ? 0 : Math.min(list.length - 1, currentIdx + 1);
            const next = list[nextIdx];
            if (next) {
                local.selected = next.key;
                local.selectedVariant = pickVisible(next)?.lote?.id || null;
                if (isMobile()) local.mobileDetail = true;
                renderContent({ soft: true });
            }
        } else if (e.key === 'ArrowUp' || e.key === 'k') {
            e.preventDefault();
            const prevIdx = currentIdx < 0 ? list.length - 1 : Math.max(0, currentIdx - 1);
            const prev = list[prevIdx];
            if (prev) {
                local.selected = prev.key;
                local.selectedVariant = pickVisible(prev)?.lote?.id || null;
                if (isMobile()) local.mobileDetail = true;
                renderContent({ soft: true });
            }
        } else if ((e.key === 'ArrowRight' || e.key === 'l') && local.selected) {
            e.preventDefault();
            const fam = list.find(f => f.key === local.selected);
            if (!fam) return;
            const visible = listableVariants(fam);
            if (visible.length < 2) return;
            const i = Math.max(0, visible.findIndex(v => v.lote.id === local.selectedVariant));
            local.selectedVariant = visible[(i + 1) % visible.length].lote.id;
            if (isMobile()) local.mobileDetail = true;
            renderContent({ soft: true });
        } else if ((e.key === 'ArrowLeft' || e.key === 'h') && local.selected) {
            e.preventDefault();
            const fam = list.find(f => f.key === local.selected);
            if (!fam) return;
            const visible = listableVariants(fam);
            if (visible.length < 2) return;
            const i = Math.max(0, visible.findIndex(v => v.lote.id === local.selectedVariant));
            local.selectedVariant = visible[(i - 1 + visible.length) % visible.length].lote.id;
            if (isMobile()) local.mobileDetail = true;
            renderContent({ soft: true });
        } else if (e.key.toLowerCase() === 'e' && variantId) {
            e.preventDefault();
            openModal(variantId);
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
            message: `Se eliminará <strong>${esc(l.producto)}</strong>${l.variante ? ` · ${esc(l.variante)}` : ''} (${esc(l.sku)}). Puedes deshacer los próximos 7 segundos con el toast.`,
            primaryLabel: 'Eliminar',
            danger: true,
        });
        if (!ok) return;
        // Snapshot para undo: catálogo + bolsitas del MP. Cubre el side-effect
        // del reverse de liberaciones sin reejecutar cálculos.
        const mp = Data.currentMarketplace();
        const snapshot = {
            mp,
            lotes: JSON.parse(JSON.stringify(window.State.lotes)),
            capitalAlloc: JSON.parse(JSON.stringify(window.State.ui?.capitalAlloc || {})),
            selectedVariant: local.selectedVariant,
        };
        (l.ventas || []).forEach(v => {
            if (!v?.id) return;
            const fallback = Data.hasAsignacion?.(v) ? { ...v.asignacion } : null;
            try {
                window.DashboardView?.reverseSaleLiberation?.(v.id, fallback);
            } catch (err) {
                console.warn('[bolsitas] reverse al borrar lote', err);
            }
        });
        window.State.lotes = Data.deleteLote(window.State.lotes, id);
        if (local.selectedVariant === id) local.selectedVariant = null;
        try {
            window.DashboardView?.purgeOrphanSaleLiberations?.({
                [Data.currentMarketplace()]: window.State.lotes,
            });
        } catch { /* ignore */ }
        window.State.save();
        renderContent();
        window.App?.refreshNavCounts?.();
        if (window.State.view === 'dashboard') window.DashboardView?.render?.();
        if (window.State.view === 'caja') window.CajaView?.render?.();
        UI.toast(`Eliminado · ${l.producto}${l.variante ? ' · ' + l.variante : ''}`, 'success', {
            action: {
                label: 'Deshacer',
                handler: () => restoreSnapshot(snapshot, 'Lote restaurado'),
            },
        });
    }

    /**
     * Restaura un snapshot capturado antes de una acción destructiva.
     * Cubre catálogo del MP + estado de bolsitas + selección UI.
     */
    function restoreSnapshot(snapshot, msg = 'Restaurado') {
        if (!snapshot) return;
        window.Sync?.holdRemote?.(4000);
        // Si el MP activo cambió, solo restauramos si el usuario sigue en el mismo.
        if (snapshot.mp && Data.currentMarketplace() !== snapshot.mp) {
            UI.toast('No se pudo deshacer: cambiaste de marketplace', 'error');
            return;
        }
        window.State.lotes = snapshot.lotes;
        window.State.ui = { ...window.State.ui, capitalAlloc: snapshot.capitalAlloc };
        if (Object.prototype.hasOwnProperty.call(snapshot, 'selectedVariant')) {
            local.selectedVariant = snapshot.selectedVariant;
        }
        window.State.save();
        window.State.saveUI();
        renderContent();
        window.App?.refreshNavCounts?.();
        if (window.State.view === 'dashboard') window.DashboardView?.render?.();
        if (window.State.view === 'caja') window.CajaView?.render?.();
        UI.toast(msg);
    }

    async function changeStatus(id) {
        const l = window.State.lotes.find(x => x.id === id);
        if (!l) return;
        const opts = [
            {
                value: '✅ Activa / En Venta',
                tone: 'activa',
                title: 'Activa',
                desc: 'En venta · aparece en el listado',
            },
            {
                value: '⏸️ Pausada',
                tone: 'pausada',
                title: 'Pausada',
                desc: 'Pausa temporal · sigue visible',
            },
            {
                value: '📦 Sin stock',
                tone: 'sin_stock',
                title: 'Sin stock',
                desc: 'Agotada · puedes reponer después',
            },
            {
                value: '❌ Finalizada',
                tone: 'finalizada',
                title: 'Finalizada · archivar',
                desc: 'Sale del listado activo · conserva ventas · sin recompra',
            },
        ];
        let picked = null;
        const choice = await UI.dialog({
            title: 'Estatus de publicación',
            body: `
                <div class="dlg-radios dlg-status-opts">${opts.map(o => `
                <label class="dlg-radio dlg-status-opt is-${o.tone} ${l.estatus === o.value ? 'active' : ''}">
                    <input type="radio" name="status-opt" value="${esc(o.value)}" ${l.estatus === o.value ? 'checked' : ''}>
                    <span class="dlg-status-copy">
                        <span class="dlg-status-title">${esc(o.title)}</span>
                        <span class="dlg-status-desc">${esc(o.desc)}</span>
                    </span>
                </label>
            `).join('')}</div>`,
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                {
                    label: 'Guardar',
                    variant: 'primary',
                    value: 'save',
                    // Leer el radio ANTES de que el diálogo destruya el DOM
                    onClick: (wrapper) => {
                        const selected = wrapper.querySelector('input[name="status-opt"]:checked');
                        if (!selected) {
                            UI.toast('Elige un estatus', 'error');
                            return false;
                        }
                        picked = selected.value;
                        return true;
                    },
                },
            ],
            onMount: (wrapper) => {
                wrapper.querySelectorAll('.dlg-radio').forEach(label => {
                    label.addEventListener('change', () => {
                        wrapper.querySelectorAll('.dlg-radio').forEach(x => x.classList.remove('active'));
                        label.classList.add('active');
                    });
                });
            },
        });
        if (choice !== 'save' || !picked) return;
        l.estatus = picked;
        window.State.lotes = Data.upsertLote(window.State.lotes, l);
        window.State.save();
        renderContent();
        window.App?.refreshNavCounts?.();
        if (String(picked).includes('Finalizada')) {
            UI.toast('Archivada · ventas conservadas; no se recomienda recompra');
        } else {
            UI.toast('Estatus actualizado');
        }
    }

    async function restock(id, opts = {}) {
        const l = window.State.lotes.find(x => x.id === id);
        if (!l) return;
        const rango = Calc.rangoCompraIdeal(l, window.State.settings);
        const stock = Math.max(0, (Number(l.unidades) || 0) - Calc.syncVendidas(l));
        const suggest = Calc.suggestRestock?.(l, window.State.settings) || null;
        const preferUds = Math.max(1, Number(opts.uds) || Number(suggest?.suggestUds) || 1);

        const form = document.createElement('div');
        form.innerHTML = `
            <p class="dlg-msg">Sumas mercancía al <strong>mismo SKU</strong> <code>${esc(l.sku)}</code>${l.variante ? ` · ${esc(l.variante)}` : ''}. El costo se recalcula como <strong>promedio ponderado</strong>; las ventas previas se conservan.</p>
            ${suggest ? `<div class="sale-stock-hint${suggest.action === 'no' ? ' is-warn' : ''}">
                Reponer: <strong>${suggest.action === 'buy' ? `+${suggest.suggestUds} ud (~${Calc.fmtMXN(suggest.cash)})` : suggest.reason}</strong>
                ${suggest.action === 'buy' ? ` · ${esc(suggest.reason)}` : ''}
            </div>` : ''}
            <div class="sale-stock-hint">
                Stock actual: <strong>${stock}</strong> disp. / ${l.unidades} del lote · costo hoy ${Calc.fmtMXN(l.costo)}
                ${rango ? `<br>Compra ideal (margen 30%–20%): <strong>${Calc.fmtMXN(rango.min)} – ${Calc.fmtMXN(rango.max)}</strong>` : ''}
            </div>
            <div class="form-grid">
                <label><span>Unidades a comprar</span><input type="number" id="r-uds" value="${preferUds}" min="1" step="1"></label>
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

    async function writeOff(id) {
        const l = window.State.lotes.find(x => x.id === id);
        if (!l) return;
        const stock = Math.max(0, (Number(l.unidades) || 0) - Calc.syncVendidas(l));
        if (stock <= 0) {
            UI.toast('No hay piezas disponibles para dar de baja', 'error');
            return;
        }

        const form = document.createElement('div');
        form.innerHTML = `
            <p class="dlg-msg">Quita piezas del inventario <strong>sin registrar venta</strong> (daño, venta fuera del marketplace, merma, etc.). Queda en el historial con el valor al costo.</p>
            <div class="sale-stock-hint">
                SKU <code>${esc(l.sku)}</code>${l.variante ? ` · ${esc(l.variante)}` : ''} ·
                disponibles: <strong>${stock}</strong> / ${l.unidades} del lote · costo ${Calc.fmtMXN(l.costo)}
            </div>
            <div class="form-grid">
                <label><span>Piezas a quitar</span><input type="number" id="w-uds" value="1" min="1" max="${stock}" step="1"></label>
                <label><span>Motivo</span>
                    <select id="w-motivo">
                        <option value="dano">Daño / defecto</option>
                        <option value="venta_externa">Venta fuera del marketplace</option>
                        <option value="merma">Merma / extravío</option>
                        <option value="devolucion_proveedor">Devolución a proveedor</option>
                        <option value="otro">Otro</option>
                    </select>
                </label>
                <label class="wide"><span>Notas (opcional)</span><input type="text" id="w-notas" placeholder="Ej. caja aplastada, vendido en efectivo…"></label>
            </div>
            <div class="sale-hint muted small" style="margin-top:10px" id="w-preview">—</div>
        `;

        const update = () => {
            const qty = parseInt(form.querySelector('#w-uds').value) || 0;
            const el = form.querySelector('#w-preview');
            if (!el) return;
            if (qty <= 0 || qty > stock) {
                el.textContent = qty > stock ? `Máximo ${stock} disponibles` : '—';
                return;
            }
            const valor = (Number(l.costo) || 0) * qty;
            el.innerHTML = `Stock → <strong>${stock - qty}</strong> disp. · valor al costo que sales: <strong>${Calc.fmtMXN(valor)}</strong>`;
        };
        setTimeout(() => {
            form.querySelectorAll('input, select').forEach(i => i.addEventListener('input', update));
            form.querySelectorAll('select').forEach(i => i.addEventListener('change', update));
            update();
        }, 30);

        const result = await UI.dialog({
            title: `Baja de inventario · ${esc(l.producto)}`,
            body: form,
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                { label: 'Quitar piezas', variant: 'danger', value: 'save' },
            ],
        });
        if (result !== 'save') return;

        const qty = parseInt(form.querySelector('#w-uds').value) || 0;
        const motivo = form.querySelector('#w-motivo').value;
        const notas = form.querySelector('#w-notas').value.trim();
        try {
            Data.writeOffLote(l, { unidades: qty, motivo, notas });
            window.State.lotes = Data.upsertLote(window.State.lotes, l);
            local.selected = familyKey(l);
            // Si la variante quedó archivada (0/0), saltar a otro color activo
            const calcAfter = Calc.computeLote(l, window.State.settings);
            const archivada = !isVariantVisible(l, calcAfter);
            if (archivada) {
                const fam = families().find(f => f.key === local.selected);
                const next = fam?.variants.find(v => isVariantVisible(v.lote, v.calc));
                local.selectedVariant = next ? next.lote.id : l.id;
            } else {
                local.selectedVariant = l.id;
            }
            window.State.save();
            renderContent();
            UI.toast(archivada
                ? `−${qty} uds dadas de baja · ${esc(l.variante || 'variante')} ya no aparece en colores`
                : `−${qty} uds dadas de baja · ${Calc.fmtMXN((Number(l.costo) || 0) * qty)} al costo`);
        } catch (err) {
            UI.toast(err.message || 'Error al dar de baja', 'error');
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
                    ${prepEnvioOn() && String(l.tipo || '').toUpperCase() === 'FBM' ? `
                    <label class="wide check-row ship-sale-check">
                        <input type="checkbox" id="s-por-enviar" checked>
                        <span><strong>Por enviar al cliente</strong>
                            <small class="muted" style="display:block;font-weight:400;margin-top:2px">
                                FBM: tú preparas el paquete. (En FBA el estatus es “mandar a Amazon”, arriba del producto.)
                            </small>
                        </span>
                    </label>` : ''}
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
        const porEnviar = !!form.querySelector('#s-por-enviar')?.checked;
        const envioEstado = porEnviar ? 'por_preparar' : '';
        const stock = Math.max(0, (Number(l.unidades) || 0) - (Number(l.vendidas) || 0));

        if (uds <= 0 || precio <= 0) { UI.toast('Datos incompletos', 'error'); return; }
        if (uds > stock) {
            UI.toast(`Solo hay ${stock} uds disponibles. Ajusta unidades del lote o baja la venta.`, 'error');
            return;
        }

        const venta = Data.addVenta(l, { fecha, precio, unidades: uds, notas, envioEstado });
        window.State.lotes = Data.upsertLote(window.State.lotes, l);
        local.selected = familyKey(l);
        local.selectedVariant = l.id;
        window.State.save();

        renderContent();
        window.App?.refreshNavCounts?.();
        UI.playMoneySound?.();
        UI.burstConfetti?.();
        const shipMsg = envioEstado && envioEstado !== 'enviado'
            ? ' · por enviar'
            : '';
        const cajaMsg = ' · por cobrar en Caja';
        UI.toast(multi
            ? `Venta registrada · ${l.variante || 'variante'} (−${uds})${shipMsg}${cajaMsg}`
            : `Venta registrada${shipMsg}${cajaMsg}`, 'success', { pulse: true });
    }

    async function removeSale(loteId, ventaId) {
        const l = window.State.lotes.find(x => x.id === loteId);
        if (!l) return;
        const ok = await UI.confirm({
            title: 'Eliminar venta',
            message: 'Se restará del inventario vendido y, si estaba en bolsitas, también se quita ese monto (útil en devoluciones). Puedes deshacer los próximos 7 segundos con el toast.',
            primaryLabel: 'Eliminar', danger: true
        });
        if (!ok) return;
        const venta = (l.ventas || []).find(x => x.id === ventaId);
        const fallbackSplits = Data.hasAsignacion?.(venta) ? { ...venta.asignacion } : null;

        const snapshot = {
            mp: Data.currentMarketplace(),
            lotes: JSON.parse(JSON.stringify(window.State.lotes)),
            capitalAlloc: JSON.parse(JSON.stringify(window.State.ui?.capitalAlloc || {})),
        };

        let reversed = false;
        try {
            reversed = !!window.DashboardView?.reverseSaleLiberation?.(ventaId, fallbackSplits);
        } catch (err) {
            console.warn('[bolsitas] reverse al borrar venta', err);
        }

        Data.removeVenta(l, ventaId);
        window.State.lotes = Data.upsertLote(window.State.lotes, l);
        window.State.save();
        renderContent();
        window.App?.refreshNavCounts?.();
        if (window.State.view === 'dashboard') window.DashboardView?.render?.();
        if (window.State.view === 'caja') window.CajaView?.render?.();
        UI.toast(reversed
            ? 'Venta eliminada · monto quitado de bolsitas'
            : 'Venta eliminada', 'success', {
            action: {
                label: 'Deshacer',
                handler: () => restoreSnapshot(snapshot, 'Venta restaurada'),
            },
        });
    }

    // ---- Modal edición -------------------------------------------------
    const FIELD_MAP = [
        ['f-sku','sku'], ['f-producto','producto'], ['f-variante','variante'],
        ['f-tipo','tipo'], ['f-fecha','fecha'], ['f-categoria','categoria'],
        ['f-costo','costo'], ['f-unidades','unidades'],
        ['f-precio-comp','precioCompetencia'], ['f-precio','precio'],
        ['f-envio','envio'], ['f-gasto-ads','gastoAds'], ['f-estatus','estatus'],
        ['f-peso-kg','pesoKg'], ['f-tamano-fba','tamanoFba'], ['f-almacenamiento','almacenamiento'],
        ['f-varios','varios'],
        ['f-asin','asin'], ['f-link-compra','linkCompra'], ['f-link-amazon','linkAmazon'],
    ];

    function openModal(id = null) {
        editing = id;
        const l = id ? window.State.lotes.find(x => x.id === id) : blankLote();
        if (!l) return;
        document.getElementById('modal-title').textContent = id ? 'Editar lote' : 'Nuevo lote';
        window.App?.refreshMarketplaceChrome?.();
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
        setTimeout(() => document.getElementById('f-producto')?.focus(), 50);
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
        const isAmz = window.State.marketplace === 'amazon';
        const s = window.State.settings || {};
        return {
            id: Data.newId(),
            productId: '',
            sku: '', producto: '', variante: '',
            tipo: isAmz ? 'FBA' : 'Clasica',
            fecha: new Date().toISOString().slice(0, 10),
            categoria: isAmz ? (s.categoriaDefault || 'hogar_cocina') : '',
            categoriaAmazon: isAmz ? (s.categoriaDefault || 'hogar_cocina') : '',
            notas: '',
            costo: 0, unidades: 1, precioCompetencia: null,
            precio: 0, envio: 0, gastoAds: 0, vendidas: 0, estatus: '✅ Activa / En Venta',
            pesoKg: isAmz ? (Number(s.pesoKgDefault) || 0.3) : null,
            tamanoFba: isAmz ? (s.tamanoFbaDefault || 'estandar') : '',
            almacenamiento: 0,
            varios: 0,
            fbaInboundEstado: '',
            ventas: [], historial: [],
            asin: '',
            linkCompra: '',
            linkAmazon: '',
        };
    }

    function setForm(l) {
        for (const [id, key] of FIELD_MAP) {
            const el = document.getElementById(id);
            if (!el) continue;
            const v = l[key];
            el.value = v === null || v === undefined ? '' : v;
        }
        const amzCat = document.getElementById('f-amz-categoria');
        if (amzCat) {
            const key = l.categoriaAmazon || l.categoria
                || window.State.settings?.categoriaDefault || 'hogar_cocina';
            const resolved = Calc.resolveAmzCategoryKey
                ? Calc.resolveAmzCategoryKey({ categoriaAmazon: key, categoria: key }, window.State.settings)
                : key;
            if ([...amzCat.options].some(o => o.value === resolved)) amzCat.value = resolved;
        }
    }

    function getForm() {
        const prev = editing ? window.State.lotes.find(x => x.id === editing) : null;
        const isAmz = window.State.marketplace === 'amazon';
        const amzCatEl = document.getElementById('f-amz-categoria');
        const amzCat = isAmz && amzCatEl ? amzCatEl.value : '';
        const pesoEl = document.getElementById('f-peso-kg');
        const tamanoEl = document.getElementById('f-tamano-fba');
        return {
            id: editing || Data.newId(),
            productId: prev?.productId || '',
            sku: document.getElementById('f-sku').value.trim(),
            producto: document.getElementById('f-producto').value.trim(),
            variante: document.getElementById('f-variante').value.trim(),
            tipo: document.getElementById('f-tipo').value,
            fecha: document.getElementById('f-fecha').value,
            categoria: isAmz && amzCat
                ? (Calc.AMZ_CATEGORIES?.[amzCat]?.label || amzCat)
                : document.getElementById('f-categoria').value.trim(),
            categoriaAmazon: isAmz ? amzCat : (prev?.categoriaAmazon || ''),
            costo: parseFloat(document.getElementById('f-costo').value) || 0,
            unidades: parseInt(document.getElementById('f-unidades').value) || 0,
            precioCompetencia: parseFloat(document.getElementById('f-precio-comp').value) || null,
            precio: parseFloat(document.getElementById('f-precio').value) || 0,
            envio: (() => {
                const raw = document.getElementById('f-envio')?.value;
                if (raw === '' || raw == null) return 0;
                const n = parseFloat(raw);
                return Number.isFinite(n) && n > 0 ? n : 0;
            })(),
            gastoAds: parseFloat(document.getElementById('f-gasto-ads')?.value) || 0,
            pesoKg: isAmz && pesoEl ? (parseFloat(pesoEl.value) || null) : (prev?.pesoKg ?? null),
            tamanoFba: isAmz && tamanoEl ? (tamanoEl.value || 'estandar') : (prev?.tamanoFba || ''),
            almacenamiento: isAmz
                ? Math.max(0, parseFloat(document.getElementById('f-almacenamiento')?.value) || 0)
                : (prev?.almacenamiento || 0),
            varios: isAmz
                ? Math.max(0, parseFloat(document.getElementById('f-varios')?.value) || 0)
                : (prev?.varios || 0),
            fbaInboundEstado: prev?.fbaInboundEstado || '',
            ventas: prev?.ventas || [],
            historial: prev?.historial || [],
            imagen: prev?.imagen || '',
            estatus: document.getElementById('f-estatus').value,
            notas: prev?.notas || '',
            // El valor del campo manda: vaciarlo debe poder borrar el dato.
            asin: (document.getElementById('f-asin')?.value || '').trim().toUpperCase(),
            linkCompra: (document.getElementById('f-link-compra')?.value || '').trim(),
            linkAmazon: (document.getElementById('f-link-amazon')?.value || '').trim(),
        };
    }

    function renderPreview() {
        const asinEl = document.getElementById('f-asin');
        const linkEl = document.getElementById('f-link-amazon');
        if (asinEl && linkEl && !asinEl.value.trim()) {
            const detected = window.Keepa?.extractAsin?.(linkEl.value);
            if (detected) asinEl.value = detected;
        }
        const l = getForm();
        const c = Calc.computeLote(l, window.State.settings);
        const isAmz = window.State.marketplace === 'amazon'
            || window.State.settings?.marketplace === 'amazon';
        const catName = isAmz && c.categoriaAmazon && Calc.AMZ_CATEGORIES?.[c.categoriaAmazon]
            ? Calc.AMZ_CATEGORIES[c.categoriaAmazon].label
            : '';
        const comLabel = isAmz
            ? `Referido${catName ? ` · ${catName}` : ''} (${(c.pctComision * 100).toFixed(1)}%)`
            : `Comisión Meli (${(c.pctComision * 100).toFixed(0)}%)`;
        const envioVal = c.envio != null ? c.envio : (Number(l.envio) || 0);
        const envioLabel = isAmz
            ? (String(l.tipo || '').toUpperCase() === 'FBM' ? 'Envío FBM' : 'FBA logística')
            : 'Envío al cliente';
        document.getElementById('calc-preview').innerHTML = `
            <div class="cp-row"><span>${comLabel}</span><span>− ${Calc.fmtMXN(c.comisionVariable)}</span></div>
            ${!isAmz && c.cargoFijo ? `<div class="cp-row"><span>Cargo fijo</span><span>− ${Calc.fmtMXN(c.cargoFijo)}</span></div>` : ''}
            <div class="cp-row"><span>${envioLabel}</span><span>− ${Calc.fmtMXN(envioVal)}</span></div>
            ${isAmz && c.almacenamiento > 0 ? `<div class="cp-row"><span>Almacenamiento FBA</span><span>− ${Calc.fmtMXN(c.almacenamiento)}</span></div>` : ''}
            ${isAmz && c.varios > 0 ? `<div class="cp-row"><span>Varios / Otros</span><span>− ${Calc.fmtMXN(c.varios)}</span></div>` : ''}
            ${!isAmz ? `
            <div class="cp-row"><span>Retención IVA</span><span>− ${Calc.fmtMXN(c.retIVA)}</span></div>
            <div class="cp-row"><span>Retención ISR</span><span>− ${Calc.fmtMXN(c.retISR)}</span></div>
            ` : ''}
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
        const prevLote = editing ? window.State.lotes.find(x => x.id === editing) : null;
        if (prevLote) {
            const vendidas = Data.syncVendidasFromVentas
                ? Data.syncVendidasFromVentas(prevLote)
                : (Number(prevLote.vendidas) || 0);
            if (Number(l.unidades) < vendidas) {
                UI.toast(`Las unidades no pueden bajar de ${vendidas} (ya vendidas)`, 'error');
                return;
            }
        }
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
        UI.toast(isNew ? 'Lote creado' : 'Lote actualizado', 'success', { pulse: true });
    }

    // ---- API pública para otros módulos --------------------------------
    function selectAndGo(id) {
        window.App && window.App.switchTab('lotes');
        const lote = window.State.lotes.find(l => l.id === id);
        if (!lote) {
            local.selected = null;
            local.selectedVariant = null;
            render();
            UI.toast?.('Producto no encontrado en este catálogo', 'error');
            return false;
        }
        local.selected = familyKey(lote);
        local.selectedVariant = lote.id;
        render();
        return true;
    }

    /**
     * Crea un lote Amazon desde Wishlist (1 ud) y abre el modal para ajustar.
     */
    function createFromWishlist(item) {
        if (!item || window.State.marketplace !== 'amazon') {
            UI.toast?.('Solo disponible en Amazon', 'error');
            return null;
        }
        if (item.loteId) {
            const exists = window.State.lotes.find(l => l.id === item.loteId);
            if (exists) {
                window.App?.switchTab('lotes');
                openModal(exists.id);
                return exists;
            }
        }

        const settings = window.State.settings || {};
        const catKey = item.categoriaAmazon
            || settings.categoriaDefault
            || 'hogar_cocina';
        const catLabel = Calc.AMZ_CATEGORIES?.[catKey]?.label || catKey;
        const producto = (item.titulo || '').trim()
            || (item.asin ? `ASIN ${item.asin}` : '')
            || (item.tienda ? `${item.tienda} · prospecto` : 'Producto wishlist');
        const existentes = window.State.lotes.map(x => x.sku).filter(Boolean);
        const sku = Data.autoSku(producto, '', existentes);

        const noteParts = [];
        if (item.tienda) noteParts.push(`Tienda: ${item.tienda}`);
        if (item.asin) noteParts.push(`ASIN: ${item.asin}`);
        if (item.linkCompra) noteParts.push(`Compra: ${item.linkCompra}`);
        if (item.linkAmazon) noteParts.push(`Amazon: ${item.linkAmazon}`);
        if (item.nota) noteParts.push(item.nota);

        const tipo = item.tipo === 'FBM' ? 'FBM' : 'FBA';
        const storageHint = typeof Calc.estimateStorageMxnPerUnit === 'function'
            ? Calc.estimateStorageMxnPerUnit({
                pesoKg: settings.pesoKgDefault,
                tamanoFba: settings.tamanoFbaDefault,
            }, settings)
            : 0;
        const lote = {
            ...blankLote(),
            id: Data.newId(),
            sku,
            producto,
            tipo,
            categoria: catLabel,
            categoriaAmazon: catKey,
            costo: Number(item.costo) || 0,
            precio: Number(item.precioMercado) || 0,
            unidades: 1,
            asin: String(item.asin || '').trim().toUpperCase(),
            linkCompra: String(item.linkCompra || '').trim(),
            linkAmazon: String(item.linkAmazon || '').trim(),
            almacenamiento: storageHint > 0 ? storageHint : 0,
            fbaInboundEstado: tipo === 'FBA' ? 'creando' : '',
            notas: noteParts.join('\n'),
            historial: [{
                ts: Date.now(),
                tipo: 'wishlist',
                meta: { wishlistId: item.id, tienda: item.tienda || '' },
            }],
        };

        window.State.lotes = Data.upsertLote(window.State.lotes, lote);
        local.selected = familyKey(lote);
        local.selectedVariant = lote.id;
        window.State.save();
        window.App?.switchTab('lotes');
        openModal(lote.id);
        UI.toast('Producto creado · ajusta unidades si hace falta');
        return lote;
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

    return { init, render, invalidate, openModal, selectAndGo, createFromWishlist, restock };
})();
window.LotesView = LotesView;
