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

    function esc(s) {
        return UI.escapeHTML(String(s ?? ''));
    }

    const detectStore = (text) => window.Stores?.detectStore?.(text) || { id: '', label: '' };
    const safeUrl = (value) => window.Stores?.safeUrl?.(value) || '';
    const extractAsin = (text) => window.Stores?.extractAsin?.(text)
        || window.Keepa?.extractAsin?.(text)
        || '';

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

    async function seedInboundPipeline(lote) {
        if (!lote || String(lote.tipo || '').toUpperCase() !== 'FBA') return;
        try {
            if (!lote.fbaInboundEstado && Data.setLoteFbaInboundEstado) {
                Data.setLoteFbaInboundEstado(lote, 'creando');
                window.State.lotes = Data.upsertLote(window.State.lotes, lote);
                window.State.save();
            }
        } catch (err) {
            console.warn('[Wishlist] inbound seed', err);
        }
        const raw = await UI.prompt?.({
            title: 'Costo de envío a FBA (opcional)',
            message: 'Si Amazon ya te cobró (o sabes el monto), regístralo como cargo. Déjalo vacío para saltar.',
            placeholder: 'ej. 130',
            primaryLabel: 'Registrar cargo',
            cancelLabel: 'Ahora no',
        });
        if (raw == null || String(raw).trim() === '') return;
        try {
            const entry = Freight.addCharge({
                amount: raw,
                note: `Wishlist · ${lote.producto || lote.sku || 'inbound'}`,
                loteId: lote.id,
            });
            UI.toast(`Inbound listo · cargo ${Calc.fmtMXN(entry.amount)}`);
            window.App?.switchTab?.('envios');
        } catch (err) {
            UI.toast(err.message || 'No se pudo registrar el flete', 'error');
        }
    }

    async function markComprado(id) {
        const items = loadItems();
        const idx = items.findIndex(i => i.id === id);
        if (idx < 0) return;
        const item = items[idx];

        if (item.loteId && window.State.lotes.some(l => l.id === item.loteId)) {
            items[idx] = { ...item, status: 'comprado', updatedAt: new Date().toISOString() };
            saveItems(items);
            local.filter = 'comprado';
            const lote = window.State.lotes.find(l => l.id === item.loteId);
            window.App?.switchTab('lotes');
            LotesView.openModal(item.loteId);
            await seedInboundPipeline(lote);
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
        await seedInboundPipeline(lote);
    }

    /** Alta rápida desde Keepa / Ofertas. */
    function addFromKeepa({ asin, title = '', precio = 0, note = '', silent = false } = {}) {
        const code = String(asin || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(code)) {
            UI.toast('ASIN inválido', 'error');
            return null;
        }
        if (!isAmazonView()) {
            window.App?.applyMarketplaceView?.('amazon', { toast: false });
        }
        const items = loadItems();
        const existing = items.find(i => String(i.asin || '').toUpperCase() === code && i.status !== 'no_procede');
        if (existing) {
            local.filter = existing.status === 'comprado' ? 'comprado' : 'listo';
            local.editingId = existing.id;
            if (!silent) {
                window.App?.switchTab?.('ofertas');
                window.OfertasView?.showGuardados?.();
                UI.toast('Ya estaba en Guardados');
            }
            return existing;
        }
        const next = normalizeItem({
            id: `wl-${Date.now().toString(36)}`,
            asin: code,
            titulo: title || `ASIN ${code}`,
            precioMercado: Number(precio) || 0,
            costo: 0,
            linkAmazon: `https://www.amazon.com.mx/dp/${code}`,
            nota: note || 'Desde Keepa',
            status: 'listo',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        if (!next) {
            UI.toast('No se pudo agregar', 'error');
            return null;
        }
        saveItems([next, ...items]);
        local.filter = 'listo';
        local.editingId = next.id;
        if (!silent) {
            window.App?.switchTab?.('ofertas');
            window.OfertasView?.showGuardados?.();
            UI.toast('Guardado · completa el costo');
        }
        return next;
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
        if (window.State.view === 'ofertas') window.OfertasView?.render?.();
        else render();
    }

    function removeItem(id) {
        const before = loadItems();
        const target = before.find(i => i.id === id);
        if (!target) return;
        saveItems(before.filter(i => i.id !== id));
        if (local.editingId === id) local.editingId = null;
        if (window.State.view === 'ofertas') window.OfertasView?.render?.();
        else render();
        const label = target.titulo || target.asin || 'ítem';
        UI.toast(`Eliminado · ${label}`, 'success', {
            action: {
                label: 'Deshacer',
                handler: () => {
                    saveItems(before);
                    if (window.State.view === 'ofertas') window.OfertasView?.render?.();
                    else render();
                    UI.toast('Guardados restaurados');
                },
            },
        });
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
                ? `<button type="button" class="btn primary btn-sm" data-wl-status="comprado" data-id="${esc(item.id)}">→ Producto</button>`
                : item.status === 'listo'
                    ? `<button type="button" class="btn primary btn-sm" data-wl-status="comprado" data-id="${esc(item.id)}">→ Producto</button>`
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
                    ${safeUrl(item.linkCompra) ? `<a class="btn ghost btn-sm" href="${esc(safeUrl(item.linkCompra))}" target="_blank" rel="noopener">Compra</a>` : ''}
                    ${safeUrl(item.linkAmazon) ? `<a class="btn ghost btn-sm" href="${esc(safeUrl(item.linkAmazon))}" target="_blank" rel="noopener">Amazon</a>` : ''}
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
        // Wishlist vive dentro de Ofertas → Guardados
        if (window.State.view === 'wishlist') {
            window.App?.switchTab?.('ofertas');
            window.OfertasView?.showGuardados?.();
            return;
        }
        const host = document.getElementById('of-guardados-host');
        if (host) {
            renderEmbedded(host);
            return;
        }
        const root = document.getElementById('view-wishlist');
        if (root) {
            root.innerHTML = `
                <div class="view-head">
                    <div>
                        <h2>Guardados</h2>
                        <p class="muted">Se movió a <strong>Ofertas → Guardados</strong>.</p>
                    </div>
                    <button type="button" class="btn primary" data-wl-goto-ofertas>Abrir Guardados</button>
                </div>`;
            root.querySelector('[data-wl-goto-ofertas]')?.addEventListener('click', () => {
                window.App?.switchTab?.('ofertas');
                window.OfertasView?.showGuardados?.();
            });
        }
    }

    function renderEmbedded(host) {
        if (!host) return;
        const items = loadItems().filter(i => i.status === 'listo' || i.status === 'comprado');
        const listo = items.filter(i => i.status === 'listo');
        const comprado = items.filter(i => i.status === 'comprado');
        const shown = [...listo, ...comprado];
        host.innerHTML = `
            <div class="of-guardados-panel">
                <p class="muted small of-guardados-lead">Prospectos listos para comprar o convertir a producto (ASIN + costo + FBA/FBM).</p>
                ${shown.length
                    ? `<div class="of-list wl-embedded-list">${shown.map(card).join('')}</div>`
                    : `<p class="muted small of-empty">Nada guardado. Desde el radar usa <strong>Guardar</strong>.</p>`}
            </div>`;
        bindEmbedded(host);
        if (window.Keepa?.hydrate) Keepa.hydrate(host);
    }

    function bindEmbedded(root) {
        root.querySelectorAll('[data-wl-status]').forEach(btn => {
            btn.addEventListener('click', () => {
                setStatus(btn.getAttribute('data-id'), btn.getAttribute('data-wl-status'));
            });
        });
        root.querySelectorAll('[data-wl-open-lote]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-wl-open-lote');
                if (!id) return;
                window.App?.switchTab?.('lotes');
                window.LotesView?.openModal?.(id);
            });
        });
        root.querySelectorAll('[data-wl-del]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await UI.confirm({
                    title: 'Eliminar guardado',
                    message: 'Se quitará de Guardados. ¿Continuar?',
                    primaryLabel: 'Eliminar',
                    danger: true,
                });
                if (ok) removeItem(btn.getAttribute('data-wl-del'));
            });
        });
        root.querySelectorAll('[data-wl-edit]').forEach(btn => {
            btn.addEventListener('click', () => {
                local.editingId = btn.getAttribute('data-wl-edit');
                // Abrir Ofertas form no aplica; toast to edit via full modal later
                UI.toast('Edita costo/ASIN al convertir, o desde Keepa');
            });
        });
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
            if (window.State.view !== 'ofertas') return;
            const host = document.getElementById('of-guardados-host');
            if (!host) return;
            renderEmbedded(host);
        });
    }

    return {
        init,
        render,
        renderEmbedded,
        pendingCount,
        isEnabled: isAmazonView,
        addFromKeepa,
    };
})();
window.WishlistView = WishlistView;
