/* ==========================================================================
   Wishlist Amazon — prospectos de arbitraje
   Pegás link + costo + precio de mercado → utilidad / margen / ROI.
   Estados: listo · comprado · no_procede
   ========================================================================== */

const WishlistView = (() => {

    const STATUSES = {
        listo: { label: 'Listo', hint: 'Sí procede · por comprar' },
        comprado: { label: 'Comprado', hint: 'Ya lo compraste' },
        no_procede: { label: 'No procede', hint: 'Descartado' },
    };

    const local = {
        filter: 'listo',
        editingId: null,
    };

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
        { id: 'soriana', label: 'Soriana', match: /(?:^|\.)soriana\.com$/i },
        { id: 'chedraui', label: 'Chedraui', match: /(?:^|\.)chedraui\.com(?:\.mx)?$/i },
        { id: 'heb', label: 'HEB', match: /(?:^|\.)heb\.com(?:\.mx)?$/i },
        { id: 'city_market', label: 'City Market', match: /(?:^|\.)citymarket\.com(?:\.mx)?$/i },
        { id: 'mercado_libre', label: 'Mercado Libre', match: /(?:^|\.)mercadolibre\.com(?:\.mx)?$|(?:^|\.)mercadolivre\.com|(?:^|\.)mlb\.com\.mx$/i },
        { id: 'amazon', label: 'Amazon', match: /(?:^|\.)amazon\.com(?:\.mx|\.br)?$|(?:^|\.)amzn\.to$/i },
        { id: 'shein', label: 'Shein', match: /(?:^|\.)shein\.com$/i },
        { id: 'temu', label: 'Temu', match: /(?:^|\.)temu\.com$/i },
        { id: 'aliexpress', label: 'AliExpress', match: /(?:^|\.)aliexpress\.com$/i },
    ];

    function esc(s) {
        return UI.escapeHTML(String(s ?? ''));
    }

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

    /** Infiera tienda del link (Costco, Sam's, etc.). */
    function detectStore(text) {
        const host = hostFromUrl(text);
        if (!host) return { id: '', label: '' };
        for (const rule of STORE_RULES) {
            if (rule.match.test(host)) {
                return { id: rule.id, label: rule.label };
            }
        }
        // Fallback: primer segmento del dominio capitalizado
        const base = host.split('.')[0] || '';
        if (!base) return { id: '', label: '' };
        const label = base.charAt(0).toUpperCase() + base.slice(1);
        return { id: 'otra', label };
    }

    function isAmazonView() {
        return window.State.marketplace === 'amazon'
            && window.State.ui?.mpView !== 'general';
    }

    function loadItems() {
        const raw = window.State.ui?.wishlistAmazon;
        return Array.isArray(raw) ? raw.map(normalizeItem).filter(Boolean) : [];
    }

    function saveItems(items) {
        window.State.ui = { ...window.State.ui, wishlistAmazon: items };
        window.State.saveUI();
    }

    function normalizeItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const status = STATUSES[raw.status] ? raw.status : 'listo';
        const tipo = String(raw.tipo || 'FBA').toUpperCase() === 'FBM' ? 'FBM' : 'FBA';

        let linkCompra = String(raw.linkCompra || '').trim();
        let linkAmazon = String(raw.linkAmazon || '').trim();
        const legacy = String(raw.link || '').trim();
        if (legacy) {
            const det = detectStore(legacy);
            const asinLegacy = extractAsin(legacy);
            if (!linkAmazon && (det.id === 'amazon' || asinLegacy)) {
                linkAmazon = legacy;
            } else if (!linkCompra) {
                linkCompra = legacy;
            }
        }

        let asin = String(raw.asin || '').trim().toUpperCase();
        if (!asin) asin = extractAsin(linkAmazon) || extractAsin(linkCompra);

        let tienda = String(raw.tienda || '').trim();
        if (!tienda) {
            tienda = detectStore(linkCompra).label || detectStore(linkAmazon).label;
        }

        return {
            id: raw.id || Data.newId(),
            linkCompra,
            linkAmazon,
            // alias legado (compat)
            link: linkCompra || linkAmazon,
            asin,
            tienda,
            titulo: String(raw.titulo || '').trim(),
            costo: Math.max(0, Number(raw.costo) || 0),
            precioMercado: Math.max(0, Number(raw.precioMercado) || 0),
            tipo,
            categoriaAmazon: String(raw.categoriaAmazon || '').trim(),
            nota: String(raw.nota || '').trim(),
            status,
            loteId: raw.loteId ? String(raw.loteId) : '',
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
        };
    }

    /** Extrae ASIN de URLs amazon.com / amazon.com.mx /dp/ /gp/product/ */
    function extractAsin(text) {
        return window.Keepa?.extractAsin?.(text)
            || (() => {
                const s = String(text || '').trim();
                if (!s) return '';
                if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();
                const m = s.match(
                    /(?:\/(?:dp|gp\/product|gp\/aw\/d)|[?&]asin=)\/?([A-Z0-9]{10})\b/i
                );
                return m ? m[1].toUpperCase() : '';
            })();
    }

    function metricsFor(item) {
        try {
            const base = Calc.defaultsFor('amazon');
            const settings = {
                ...base,
                ...(window.State.settings || {}),
                marketplace: 'amazon',
            };
            const lote = {
                costo: Number(item.costo) || 0,
                tipo: item.tipo || 'FBA',
                categoriaAmazon: item.categoriaAmazon || settings.categoriaDefault || 'otros',
                pesoKg: item.pesoKg != null ? item.pesoKg : (Number(settings.pesoKgDefault) || 0.3),
                tamanoFba: item.tamanoFba || settings.tamanoFbaDefault || 'estandar',
                envio: 0,
            };
            const precio = Number(item.precioMercado) || 0;
            const u = Calc.utilidadAtPrice(lote, precio, settings);
            const costo = Number(item.costo) || 0;
            const roi = costo > 0 ? u.utilidad / costo : 0;
            return {
                utilidad: u.utilidad,
                margen: u.margen,
                roi,
                fees: (u.comisionVariable || 0) + (u.cargoFijo || 0)
                    + (u.envio || 0) + (u.almacenamiento || 0) + (u.varios || 0)
                    + (u.retIVA || 0) + (u.retISR || 0),
                pctComision: u.pctComision,
                ok: true,
            };
        } catch (err) {
            console.warn('[wishlist] metrics', err);
            return { utilidad: 0, margen: 0, roi: 0, fees: 0, pctComision: 0, ok: false };
        }
    }

    function reinversionDisponible() {
        const store = window.State.ui?.capitalAlloc?.amazon;
        const n = Number(store?.buckets?.reinversion);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function pendingCount() {
        if (!isAmazonView()) return 0;
        return loadItems().filter(i => i.status === 'listo').length;
    }

    function sortedFiltered(items) {
        if (local.filter === 'all') local.filter = 'listo';
        let list = items.slice();
        if (local.filter !== 'all') {
            list = list.filter(i => i.status === local.filter);
        }
        list.sort((a, b) => metricsFor(b).roi - metricsFor(a).roi);
        return list;
    }

    function previewHtml(itemLike) {
        const m = metricsFor(itemLike);
        if (!(itemLike.costo > 0 && itemLike.precioMercado > 0)) {
            return `<div class="wl-preview wl-preview-empty muted small">Escribe costo y precio Amazon para ver el retorno.</div>`;
        }
        const tone = m.margen >= 0.2 ? 'pos' : m.margen >= 0.1 ? 'warn' : 'neg';
        return `
            <div class="wl-preview wl-preview-compact wl-tone-${tone}" role="status">
                <div class="wl-kv">
                    <span class="muted">Retorno</span>
                    <strong class="mono">${Calc.fmtPct(m.roi)}</strong>
                </div>
                <div class="wl-kv">
                    <span class="muted">Margen</span>
                    <strong class="mono">${Calc.fmtPct(m.margen)}</strong>
                </div>
                <div class="wl-kv">
                    <span class="muted">Utilidad / ud</span>
                    <strong class="mono">${Calc.fmtMXN(m.utilidad)}</strong>
                </div>
            </div>
        `;
    }

    function readForm(root) {
        const g = id => root.querySelector(`#${id}`);
        const linkCompra = (g('wl-link-compra')?.value || '').trim();
        const linkAmazon = (g('wl-link-amazon')?.value || '').trim();
        const asin = extractAsin(linkAmazon) || extractAsin(linkCompra);
        const tienda = detectStore(linkCompra).label || detectStore(linkAmazon).label;
        const prev = local.editingId
            ? loadItems().find(i => i.id === local.editingId)
            : null;
        const settings = window.State.settings || {};
        return normalizeItem({
            id: local.editingId || Data.newId(),
            linkCompra,
            linkAmazon,
            asin,
            tienda: tienda || prev?.tienda || '',
            titulo: (g('wl-titulo')?.value || '').trim(),
            costo: Number(g('wl-costo')?.value) || 0,
            precioMercado: Number(g('wl-precio')?.value) || 0,
            tipo: prev?.tipo || 'FBA',
            categoriaAmazon: prev?.categoriaAmazon || settings.categoriaDefault || 'otros',
            nota: prev?.nota || '',
            loteId: prev?.loteId || '',
            status: 'listo',
            createdAt: prev?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    }

    function upsert(item, status) {
        const next = { ...item, status, updatedAt: new Date().toISOString() };
        const items = loadItems();
        const idx = items.findIndex(i => i.id === next.id);
        if (idx >= 0) items[idx] = { ...items[idx], ...next };
        else items.unshift(next);
        saveItems(items);
        local.editingId = null;
        local.filter = status === 'no_procede' ? 'no_procede'
            : (status === 'comprado' ? 'comprado' : 'listo');
        render();
        UI.toast(status === 'no_procede'
            ? 'Marcado: no procede'
            : (idx >= 0 ? 'Guardado' : 'Agregado'));
    }

    function markComprado(id) {
        const items = loadItems();
        const idx = items.findIndex(i => i.id === id);
        if (idx < 0) return;
        const item = items[idx];

        if (item.loteId && window.State.lotes.some(l => l.id === item.loteId)) {
            items[idx] = { ...item, status: 'comprado', updatedAt: new Date().toISOString() };
            saveItems(items);
            local.filter = 'comprado';
            window.App?.switchTab('lotes');
            LotesView.openModal(item.loteId);
            return;
        }

        const lote = LotesView.createFromWishlist?.(item);
        if (!lote) return;

        const fresh = loadItems();
        const i = fresh.findIndex(x => x.id === id);
        if (i >= 0) {
            fresh[i] = {
                ...fresh[i],
                status: 'comprado',
                loteId: lote.id,
                updatedAt: new Date().toISOString(),
            };
            saveItems(fresh);
        }
        local.filter = 'comprado';
        window.App?.refreshNavCounts?.();
    }

    function setStatus(id, status) {
        if (status === 'comprado') {
            markComprado(id);
            return;
        }
        const items = loadItems();
        const idx = items.findIndex(i => i.id === id);
        if (idx < 0) return;
        items[idx] = { ...items[idx], status, updatedAt: new Date().toISOString() };
        saveItems(items);
        render();
    }

    function removeItem(id) {
        saveItems(loadItems().filter(i => i.id !== id));
        if (local.editingId === id) local.editingId = null;
        render();
        UI.toast('Eliminado');
    }

    function card(item) {
        const m = metricsFor(item);
        const tone = m.margen >= 0.2 ? 'pos' : m.margen >= 0.1 ? 'warn' : 'neg';
        const title = item.titulo
            || item.asin
            || (item.tienda ? `Prospecto · ${item.tienda}` : 'Sin nombre');
        const primary = item.status === 'comprado' && item.loteId
            ? `<button type="button" class="btn primary btn-sm" data-wl-open-lote="${esc(item.loteId)}">Ver producto</button>`
            : item.status === 'comprado' && !item.loteId
                ? `<button type="button" class="btn primary btn-sm" data-wl-status="comprado" data-id="${esc(item.id)}">Crear producto</button>`
                : item.status === 'listo'
                    ? `<button type="button" class="btn primary btn-sm" data-wl-status="comprado" data-id="${esc(item.id)}">Ya lo compré</button>`
                    : `<button type="button" class="btn ghost btn-sm" data-wl-status="listo" data-id="${esc(item.id)}">Volver a listo</button>`;

        return `
            <article class="wl-card wl-status-${esc(item.status)} wl-tone-${tone}">
                <div class="wl-card-main">
                    <div class="wl-card-top">
                        <div>
                            <div class="wl-card-meta">
                                ${item.tienda ? `<span class="wl-store">${esc(item.tienda)}</span>` : ''}
                                ${item.asin ? `<code>${esc(item.asin)}</code>` : ''}
                            </div>
                            <h4 class="wl-card-title">${esc(title)}</h4>
                        </div>
                        <div class="wl-card-roi mono">
                            <strong>${Calc.fmtPct(m.roi)}</strong>
                            <span class="muted">retorno</span>
                        </div>
                    </div>
                    <div class="wl-card-line">
                        <span class="mono">${Calc.fmtMXN(item.costo)}</span>
                        <span class="muted">→</span>
                        <span class="mono">${Calc.fmtMXN(item.precioMercado)}</span>
                        <span class="muted">·</span>
                        <span class="mono">${Calc.fmtPct(m.margen)} margen</span>
                        <span class="muted">·</span>
                        <span class="mono">${Calc.fmtMXN(m.utilidad)}/ud</span>
                    </div>
                    ${item.asin ? `<div class="wl-keepa" data-keepa-asin="${esc(item.asin)}" data-keepa-compact="1"></div>` : ''}
                </div>
                <div class="wl-card-actions">
                    ${item.linkCompra ? `<a class="btn ghost btn-sm" href="${esc(item.linkCompra)}" target="_blank" rel="noopener">Compra</a>` : ''}
                    ${item.linkAmazon ? `<a class="btn ghost btn-sm" href="${esc(item.linkAmazon)}" target="_blank" rel="noopener">Amazon</a>` : ''}
                    ${primary}
                    <details class="wl-more">
                        <summary class="btn ghost btn-sm" aria-label="Más">⋯</summary>
                        <div class="wl-more-menu">
                            <button type="button" data-wl-edit="${esc(item.id)}">Editar</button>
                            ${item.status !== 'no_procede' ? `<button type="button" data-wl-status="no_procede" data-id="${esc(item.id)}">No procede</button>` : ''}
                            ${item.status === 'no_procede' ? `<button type="button" data-wl-status="listo" data-id="${esc(item.id)}">Listo</button>` : ''}
                            <button type="button" class="danger" data-wl-del="${esc(item.id)}">Eliminar</button>
                        </div>
                    </details>
                </div>
            </article>
        `;
    }

    function formDefaults() {
        const editing = local.editingId
            ? loadItems().find(i => i.id === local.editingId)
            : null;
        return editing || {
            linkCompra: '', linkAmazon: '', asin: '', tienda: '',
            titulo: '', costo: '', precioMercado: '',
        };
    }

    function render() {
        const root = document.getElementById('view-wishlist');
        if (!root) return;
        if (!isAmazonView()) {
            root.innerHTML = `
                <div class="view-head"><div><h2>Wishlist</h2>
                <p class="muted">Cambia a Amazon para usarla.</p></div></div>`;
            return;
        }

        const items = loadItems();
        const shown = sortedFiltered(items);
        const counts = {
            listo: items.filter(i => i.status === 'listo').length,
            comprado: items.filter(i => i.status === 'comprado').length,
            no_procede: items.filter(i => i.status === 'no_procede').length,
        };
        const rein = reinversionDisponible();
        const d = formDefaults();
        const previewItem = {
            costo: Number(d.costo) || 0,
            precioMercado: Number(d.precioMercado) || 0,
            tipo: d.tipo || 'FBA',
            categoriaAmazon: d.categoriaAmazon || window.State.settings?.categoriaDefault || '',
        };
        const storeHint = d.tienda
            || detectStore(d.linkCompra || '').label
            || '';

        root.innerHTML = `
            <div class="view-head wl-head">
                <div>
                    <h2>Wishlist</h2>
                    <p class="muted">Links + números. Al comprar, se crea el producto.</p>
                </div>
                <div class="wl-capital-inline" title="Reinversión Amazon">
                    <span class="muted small">Para comprar</span>
                    <strong class="mono">${Calc.fmtMXN(rein)}</strong>
                </div>
            </div>

            <div class="card wl-form-card">
                ${local.editingId ? `<p class="wl-editing muted small">Editando prospecto</p>` : ''}
                <div class="form-grid wl-form">
                    <label class="wide">
                        <span>Link compra</span>
                        <input type="text" id="wl-link-compra" inputmode="url" autocomplete="off"
                            placeholder="Pega link de Costco, Sam's, Walmart…" value="${esc(d.linkCompra || '')}">
                        <span class="wl-detect" id="wl-detect-tienda">${storeHint
                            ? `<span class="wl-store">${esc(storeHint)}</span>`
                            : `<span class="muted small">La tienda aparece al pegar el link</span>`}</span>
                    </label>
                    <label class="wide">
                        <span>Link Amazon</span>
                        <input type="text" id="wl-link-amazon" inputmode="url" autocomplete="off"
                            placeholder="Pega link amazon.com.mx/dp/…" value="${esc(d.linkAmazon || '')}">
                        <span class="wl-detect" id="wl-detect-asin">${d.asin
                            ? `<code>${esc(d.asin)}</code>`
                            : `<span class="muted small">El ASIN aparece al pegar el link</span>`}</span>
                    </label>
                    <label class="wide">
                        <span>Nombre <small>opcional</small></span>
                        <input type="text" id="wl-titulo" placeholder="Cómo lo reconoces" value="${esc(d.titulo || '')}">
                    </label>
                    <label>
                        <span>Costo compra (MXN)</span>
                        <input type="number" id="wl-costo" min="0" step="0.01" inputmode="decimal" placeholder="Ej. 180" value="${d.costo !== '' && d.costo != null ? esc(d.costo) : ''}">
                    </label>
                    <label>
                        <span>Precio Amazon (MXN)</span>
                        <input type="number" id="wl-precio" min="0" step="0.01" inputmode="decimal" placeholder="Ej. 449" value="${d.precioMercado !== '' && d.precioMercado != null ? esc(d.precioMercado) : ''}">
                    </label>
                </div>
                <div id="wl-live-preview">${previewHtml(previewItem)}</div>
                <div class="wl-form-actions">
                    <button type="button" class="btn primary" id="wl-save-listo">${local.editingId ? 'Guardar' : 'Agregar'}</button>
                    ${local.editingId ? `<button type="button" class="btn ghost" id="wl-cancel-edit">Cancelar</button>` : ''}
                </div>
            </div>

            <div class="wl-toolbar">
                <div class="dash-seg" role="tablist" aria-label="Filtro">
                    ${[
                        ['listo', 'Listos', counts.listo],
                        ['comprado', 'Comprados', counts.comprado],
                        ['no_procede', 'No', counts.no_procede],
                    ].map(([k, label, n]) => `
                        <button type="button" class="dash-seg-btn${local.filter === k ? ' active' : ''}"
                            data-wl-filter="${k}" role="tab">${label} ${n}</button>
                    `).join('')}
                </div>
            </div>

            ${shown.length
                ? `<div class="wl-list">${shown.map(card).join('')}</div>`
                : `<p class="muted small wl-empty">Nada aquí todavía.</p>`
            }
        `;

        bind(root);
        if (window.Keepa?.hydrate) Keepa.hydrate(root);
    }

    function refreshPreview(root) {
        const box = root.querySelector('#wl-live-preview');
        if (!box) return;
        const item = readForm(root);
        box.innerHTML = previewHtml(item);

        const tiendaEl = root.querySelector('#wl-detect-tienda');
        if (tiendaEl) {
            const store = item.tienda || detectStore(item.linkCompra || '').label;
            tiendaEl.innerHTML = store
                ? `<span class="wl-store">${esc(store)}</span>`
                : `<span class="muted small">La tienda aparece al pegar el link</span>`;
        }
        const asinEl = root.querySelector('#wl-detect-asin');
        if (asinEl) {
            asinEl.innerHTML = item.asin
                ? `<code>${esc(item.asin)}</code>`
                : `<span class="muted small">El ASIN aparece al pegar el link</span>`;
        }
    }

    function formIsDirty(root) {
        const ids = ['wl-link-compra', 'wl-link-amazon', 'wl-titulo', 'wl-costo', 'wl-precio'];
        return ids.some(id => {
            const el = root.querySelector(`#${id}`);
            return el && String(el.value || '').trim() !== '';
        });
    }

    function bind(root) {
        const onPreview = () => refreshPreview(root);
        const bindLive = (el) => {
            if (!el) return;
            el.addEventListener('input', onPreview);
            el.addEventListener('change', onPreview);
            el.addEventListener('paste', () => setTimeout(onPreview, 0));
            el.addEventListener('keyup', onPreview);
        };
        ['wl-link-compra', 'wl-link-amazon', 'wl-costo', 'wl-precio'].forEach(id => {
            bindLive(root.querySelector(`#${id}`));
        });

        root.querySelector('#wl-save-listo')?.addEventListener('click', () => {
            const item = readForm(root);
            if (!item.linkCompra && !item.linkAmazon && !item.asin) {
                UI.toast('Pega al menos un link', 'error');
                return;
            }
            if (!(item.costo > 0) || !(item.precioMercado > 0)) {
                UI.toast('Faltan costo y precio', 'error');
                return;
            }
            const status = local.editingId
                ? (loadItems().find(i => i.id === local.editingId)?.status || 'listo')
                : 'listo';
            upsert(item, status);
        });

        root.querySelector('#wl-cancel-edit')?.addEventListener('click', () => {
            local.editingId = null;
            render();
        });

        root.querySelectorAll('[data-wl-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                local.filter = btn.getAttribute('data-wl-filter') || 'listo';
                render();
            });
        });

        root.querySelectorAll('[data-wl-edit]').forEach(btn => {
            btn.addEventListener('click', () => {
                local.editingId = btn.getAttribute('data-wl-edit');
                render();
                root.querySelector('#wl-link-compra')?.focus();
                root.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });

        root.querySelectorAll('[data-wl-status]').forEach(btn => {
            btn.addEventListener('click', () => {
                setStatus(btn.getAttribute('data-id'), btn.getAttribute('data-wl-status'));
            });
        });

        root.querySelectorAll('[data-wl-open-lote]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-wl-open-lote');
                window.App?.switchTab('lotes');
                // Ver = abrir la ficha, no el formulario de edición.
                if (LotesView.selectAndGo) LotesView.selectAndGo(id);
                else LotesView.openModal(id);
            });
        });

        root.querySelectorAll('[data-wl-del]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await UI.confirm({
                    title: 'Eliminar de Wishlist',
                    message: 'Se eliminará este producto de la Wishlist. ¿Continuar?',
                    primaryLabel: 'Eliminar',
                    danger: true,
                });
                if (ok) removeItem(btn.getAttribute('data-wl-del'));
            });
        });
    }

    function init() {
        window.State.subscribe(() => {
            if (window.State.view !== 'wishlist') return;
            const root = document.getElementById('view-wishlist');
            // No pisar el form si el usuario está escribiendo / ya llenó campos
            if (root && (root.contains(document.activeElement) || formIsDirty(root))) return;
            render();
        });
    }

    return {
        init,
        render,
        pendingCount,
        isEnabled: isAmazonView,
    };
})();
window.WishlistView = WishlistView;
