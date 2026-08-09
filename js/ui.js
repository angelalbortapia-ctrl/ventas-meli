/* ==========================================================================
   UI helpers: modales propios (confirm / prompt / alert / dialog / wizard),
   toasts, tooltips livianos. Todo se hostea en #dialog-host.
   ========================================================================== */

const UI = (() => {

    // Host lazy: si no existe, se crea al vuelo.
    function host() {
        let h = document.getElementById('dialog-host');
        if (!h) {
            h = document.createElement('div');
            h.id = 'dialog-host';
            document.body.appendChild(h);
        }
        return h;
    }

    // Dialog genérico. Devuelve Promise que se resuelve con el value
    // de la acción clickeada (o null si se cierra con Esc/backdrop).
    function dialog({ title, body, actions = [], size = 'md', dismissable = true, onMount }) {
        return new Promise(resolve => {
            const id = 'dlg-' + Math.random().toString(36).slice(2, 8);
            const wrapper = document.createElement('div');
            wrapper.className = 'dlg-wrap';
            wrapper.dataset.id = id;
            wrapper.innerHTML = `
                <div class="dlg-backdrop" data-dismiss></div>
                <div class="dlg-panel dlg-size-${size}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
                    <header class="dlg-head">
                        <h3 id="${id}-title">${title || ''}</h3>
                        ${dismissable ? '<button class="icon-btn" data-dismiss aria-label="Cerrar">×</button>' : ''}
                    </header>
                    <div class="dlg-body">${typeof body === 'string' ? body : ''}</div>
                    <footer class="dlg-foot">
                        ${actions.map((a, i) => `
                            <button class="btn ${a.variant || ''}" data-action="${i}">${escapeHTML(a.label)}</button>
                        `).join('')}
                    </footer>
                </div>
            `;
            host().appendChild(wrapper);

            // Si body es un nodo, montarlo
            if (body instanceof Node) {
                const bodyEl = wrapper.querySelector('.dlg-body');
                bodyEl.innerHTML = '';
                bodyEl.appendChild(body);
            }

            const close = value => {
                wrapper.classList.add('closing');
                setTimeout(() => { wrapper.remove(); resolve(value); }, 100);
                document.removeEventListener('keydown', onKey);
            };

            const onKey = e => {
                if (!dismissable) return;
                if (e.key === 'Escape') { e.preventDefault(); close(null); }
                if (e.key === 'Enter' && !e.target.matches('textarea')) {
                    const primary = wrapper.querySelector('.btn.primary');
                    if (primary && document.activeElement && document.activeElement.tagName !== 'BUTTON') {
                        e.preventDefault(); primary.click();
                    }
                }
            };
            document.addEventListener('keydown', onKey);

            wrapper.querySelectorAll('[data-dismiss]').forEach(el => {
                if (dismissable) el.addEventListener('click', () => close(null));
            });
            wrapper.querySelectorAll('[data-action]').forEach(el => {
                el.addEventListener('click', () => {
                    const idx = parseInt(el.dataset.action, 10);
                    const action = actions[idx];
                    const result = action.value !== undefined ? action.value : action.label;
                    if (action.onClick) {
                        const r = action.onClick(wrapper);
                        if (r === false) return;
                    }
                    close(result);
                });
            });

            if (onMount) onMount(wrapper);

            const focusable = wrapper.querySelector('input, select, textarea, .btn.primary');
            if (focusable) setTimeout(() => focusable.focus(), 60);
        });
    }

    async function confirm({ title = 'Confirmar', message = '', primaryLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false } = {}) {
        const result = await dialog({
            title,
            body: `<p class="dlg-msg">${message}</p>`,
            size: 'sm',
            actions: [
                { label: cancelLabel, variant: 'ghost', value: false },
                { label: primaryLabel, variant: danger ? 'danger' : 'primary', value: true },
            ],
        });
        return result === true;
    }

    async function prompt({ title = 'Introduce un valor', message = '', defaultValue = '', placeholder = '', primaryLabel = 'Aceptar', cancelLabel = 'Cancelar' } = {}) {
        let inputRef = null;
        const result = await dialog({
            title,
            body: `
                ${message ? `<p class="dlg-msg">${message}</p>` : ''}
                <input type="text" class="dlg-input" placeholder="${escapeHTML(placeholder)}" value="${escapeHTML(defaultValue)}">
            `,
            size: 'sm',
            actions: [
                { label: cancelLabel, variant: 'ghost', value: null },
                {
                    label: primaryLabel,
                    variant: 'primary',
                    onClick: wrapper => { inputRef = wrapper.querySelector('.dlg-input'); return true; },
                    value: true,
                },
            ],
        });
        if (result === true && inputRef) return inputRef.value;
        // El input siempre existe: obtener el valor si el usuario le dio Enter
        return result === true ? '' : null;
    }

    // Wizard de import: pregunta reemplazar o agregar tras validar el archivo.
    async function importWizard({ count = 0, sample = [] } = {}) {
        const sampleHTML = sample.slice(0, 3).map(l => `
            <li><code>${escapeHTML(l.sku || '—')}</code> · ${escapeHTML(l.producto || '—')} <span class="muted small">${escapeHTML(l.variante || '')}</span></li>
        `).join('');

        return dialog({
            title: 'Importar Excel',
            size: 'md',
            body: `
                <p class="dlg-msg">Se detectaron <strong>${count} lote(s)</strong> en el archivo.</p>
                ${sample.length ? `
                    <div class="dlg-sample">
                        <div class="dlg-sample-title">Muestra:</div>
                        <ul>${sampleHTML}</ul>
                    </div>
                ` : ''}
                <p class="dlg-msg muted small"><strong>Catálogo</strong> actualiza precios/datos sin pisar stock ni costo. <strong>Completo</strong> también trae unidades/costo del Excel. Las ventas de la hoja Ventas se importan si existen.</p>
            `,
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                { label: 'Fusionar catálogo', variant: 'primary', value: 'merge' },
                { label: 'Fusionar completo', variant: '', value: 'merge-full' },
                { label: 'Reemplazar todo', variant: 'danger', value: 'replace' },
            ],
        });
    }

    // Wizard de respaldo: exportar o importar JSON.
    async function backupChoice() {
        return dialog({
            title: 'Respaldo de datos',
            size: 'sm',
            body: `<p class="dlg-msg">Los datos viven en <strong>este navegador</strong> (localStorage). Un wipe o cambio de máquina puede borrarlos. Exporta JSON con frecuencia.</p>`,
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                { label: 'Importar respaldo', variant: '', value: 'import' },
                { label: 'Exportar JSON', variant: 'primary', value: 'export' },
            ],
        });
    }

    /**
     * Bottom-sheet móvil (slide-up + backdrop + drag-down para cerrar).
     * items: [{ id, icon (data-icon name), label, hint?, badge?, danger?, tone? }]
     * onPick(id) se llama al elegir. La sheet se cierra sola tras onPick.
     * Devuelve un handle { close() } por si se necesita cerrar externamente.
     */
    function bottomSheet({ title = '', items = [], onPick, onClose } = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'bsheet-wrap';
        wrap.hidden = true;
        wrap.innerHTML = `
            <div class="bsheet-backdrop" data-close></div>
            <div class="bsheet-panel" role="dialog" aria-modal="true" aria-label="${escapeHTML(title || 'Más opciones')}">
                <div class="bsheet-handle" aria-hidden="true"></div>
                ${title ? `
                    <header class="bsheet-head">
                        <h3 class="bsheet-title">${escapeHTML(title)}</h3>
                    </header>
                ` : ''}
                <div class="bsheet-body">
                    ${items.map(it => `
                        <button type="button" class="bsheet-item" data-pick="${escapeHTML(it.id)}">
                            <span class="bsheet-item-icon" data-icon="${escapeHTML(it.icon || 'more')}"></span>
                            <span class="bsheet-item-body">
                                <span class="bsheet-item-label">${escapeHTML(it.label || '')}</span>
                                ${it.hint ? `<span class="bsheet-item-hint">${escapeHTML(it.hint)}</span>` : ''}
                            </span>
                            ${it.badge != null && it.badge !== 0 && it.badge !== '' && !it.hideBadge
                                ? `<span class="bsheet-item-badge ${it.tone === 'mute' ? 'is-mute' : ''}">${escapeHTML(String(it.badge))}</span>`
                                : ''}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
        host().appendChild(wrap);
        window.Icons?.hydrate?.(wrap);

        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            wrap.classList.remove('is-open');
            document.removeEventListener('keydown', onKey);
            setTimeout(() => { wrap.remove(); if (onClose) onClose(); }, 220);
        };
        const onKey = e => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        };

        // Drag-down: si el usuario arrastra el panel > 60px hacia abajo, cerrar.
        const panel = wrap.querySelector('.bsheet-panel');
        let startY = null;
        let dY = 0;
        const onTouchStart = e => {
            const t = e.touches?.[0];
            if (!t) return;
            // Sólo arrancar drag si el touch inició en el handle/header o parte alta.
            const rect = panel.getBoundingClientRect();
            if (t.clientY - rect.top > 60) { startY = null; return; }
            startY = t.clientY;
            dY = 0;
            panel.style.transition = 'none';
        };
        const onTouchMove = e => {
            if (startY == null) return;
            const t = e.touches?.[0];
            if (!t) return;
            dY = Math.max(0, t.clientY - startY);
            panel.style.transform = `translateY(${dY}px)`;
        };
        const onTouchEnd = () => {
            if (startY == null) return;
            panel.style.transition = '';
            if (dY > 60) close();
            else panel.style.transform = '';
            startY = null; dY = 0;
        };
        panel.addEventListener('touchstart', onTouchStart, { passive: true });
        panel.addEventListener('touchmove', onTouchMove, { passive: true });
        panel.addEventListener('touchend', onTouchEnd);
        panel.addEventListener('touchcancel', onTouchEnd);

        wrap.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
        wrap.querySelectorAll('[data-pick]').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.getAttribute('data-pick');
                close();
                if (typeof onPick === 'function') {
                    // Cerrar primero (para que el switchTab no compita con el DOM del sheet)
                    setTimeout(() => onPick(id), 40);
                }
            });
        });
        document.addEventListener('keydown', onKey);

        // Mostrar tras un tick para animar
        requestAnimationFrame(() => {
            wrap.hidden = false;
            requestAnimationFrame(() => wrap.classList.add('is-open'));
        });

        return { close };
    }

    // Toast (única instancia).
    // BC: toast(msg, kind, 2400) sigue funcionando.
    // Nueva firma: toast(msg, kind, { duration, action: { label, handler, ttl } }).
    function toast(msg, kind = 'success', options) {
        const el = document.getElementById('toast');
        if (!el) return;
        let duration = 2400;
        let action = null;
        if (typeof options === 'number') {
            duration = options;
        } else if (options && typeof options === 'object') {
            if (Number.isFinite(options.duration)) duration = options.duration;
            if (options.action && typeof options.action.handler === 'function') {
                action = options.action;
                // Con acción, damos margen para reaccionar.
                if (!Number.isFinite(options.duration)) duration = 7000;
            }
        }
        el.className = 'toast ' + kind + (action ? ' has-action' : '');
        el.innerHTML = '';
        const msgSpan = document.createElement('span');
        msgSpan.className = 'toast-msg';
        msgSpan.textContent = msg;
        el.appendChild(msgSpan);
        if (action) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'toast-action';
            btn.textContent = action.label || 'Deshacer';
            let done = false;
            btn.addEventListener('click', () => {
                if (done) return;
                done = true;
                try { action.handler(); }
                catch (err) { console.warn('[toast action]', err); }
                el.hidden = true;
                clearTimeout(el._t);
            });
            el.appendChild(btn);
        }
        el.hidden = false;
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.hidden = true; }, duration);
    }

    // --- Helpers ---
    function escapeHTML(s) {
        return String(s ?? '').replace(/[&<>"']/g, ch => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[ch]));
    }

    /** Cha-ching corto al registrar venta (Meli y Amazon). */
    let _audioCtx = null;
    function playMoneySound() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!_audioCtx) _audioCtx = new AC();
            const ctx = _audioCtx;
            if (ctx.state === 'suspended') ctx.resume();
            const t0 = ctx.currentTime;

            const ding = (freq, start, dur, gain = 0.18) => {
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, t0 + start);
                osc.frequency.exponentialRampToValueAtTime(freq * 0.85, t0 + start + dur);
                g.gain.setValueAtTime(0.0001, t0 + start);
                g.gain.exponentialRampToValueAtTime(gain, t0 + start + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
                osc.connect(g);
                g.connect(ctx.destination);
                osc.start(t0 + start);
                osc.stop(t0 + start + dur + 0.02);
            };

            // “cha” + “ching”
            ding(980, 0, 0.12, 0.16);
            ding(1310, 0.08, 0.22, 0.2);
            ding(1760, 0.12, 0.35, 0.12);
        } catch (_) { /* sin audio / autoplay bloqueado */ }
    }

    return {
        dialog,
        confirm,
        prompt,
        importWizard,
        backupChoice,
        bottomSheet,
        toast,
        escapeHTML,
        playMoneySound,
    };
})();
window.UI = UI;
