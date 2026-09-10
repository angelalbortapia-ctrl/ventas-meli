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

    /** Ring arcoíris — 1 ciclo al completar sync / guardar. */
    let _pulseTimer = 0;
    let _pulseCooldownAt = 0;
    function pulseRainbow() {
        if (typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }
        const now = Date.now();
        if (now - _pulseCooldownAt < 900) return;
        _pulseCooldownAt = now;
        const root = document.documentElement;
        root.classList.remove('is-rainbow-pulse');
        // Forzar reflow para reiniciar la animación si ya estaba activa.
        void root.offsetWidth;
        root.classList.add('is-rainbow-pulse');
        clearTimeout(_pulseTimer);
        _pulseTimer = setTimeout(() => {
            root.classList.remove('is-rainbow-pulse');
        }, 1200);
    }

    // Toast (única instancia).
    // BC: toast(msg, kind, 2400) sigue funcionando.
    // Nueva firma: toast(msg, kind, { duration, action, pulse }).
    function toast(msg, kind = 'success', options) {
        const el = document.getElementById('toast');
        if (!el) return;
        let duration = 2400;
        let action = null;
        let pulse = false;
        if (typeof options === 'number') {
            duration = options;
        } else if (options && typeof options === 'object') {
            if (Number.isFinite(options.duration)) duration = options.duration;
            if (options.pulse) pulse = true;
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
        if (pulse && kind !== 'error') pulseRainbow();
    }

    // --- Helpers ---
    function escapeHTML(s) {
        return String(s ?? '').replace(/[&<>"']/g, ch => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[ch]));
    }

    /**
     * Confeti de celebración.
     * opts.intensity: 'full' (venta) | 'light' (cobrado / lote)
     */
    function burstConfetti(opts = {}) {
        try {
            if (typeof window.matchMedia === 'function'
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                return;
            }
            const light = opts.intensity === 'light';
            document.querySelectorAll('.ui-confetti').forEach((el) => el.remove());
            const host = document.createElement('div');
            host.className = light ? 'ui-confetti is-light' : 'ui-confetti';
            host.setAttribute('aria-hidden', 'true');
            const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#ff2d55', '#ffffff'];
            const n = light ? 28 : 64;
            for (let i = 0; i < n; i++) {
                const p = document.createElement('i');
                const side = i % 2 === 0 ? -1 : 1;
                const x = (light ? 6 + Math.random() * 28 : 8 + Math.random() * 42) * side;
                const drift = x + (Math.random() * 28 - 14);
                const rot = Math.floor(Math.random() * 720 - 360);
                const delay = Math.random() * (light ? 0.1 : 0.18);
                const dur = (light ? 0.85 : 1.15) + Math.random() * (light ? 0.35 : 0.55);
                const w = 5 + Math.floor(Math.random() * 7);
                const h = 8 + Math.floor(Math.random() * 10);
                p.style.setProperty('--x', `${x}vw`);
                p.style.setProperty('--dx', `${drift}vw`);
                p.style.setProperty('--r', `${rot}deg`);
                p.style.setProperty('--d', `${delay}s`);
                p.style.setProperty('--t', `${dur}s`);
                p.style.setProperty('--c', colors[i % colors.length]);
                p.style.width = `${w}px`;
                p.style.height = `${h}px`;
                if (i % 5 === 0) p.classList.add('is-round');
                host.appendChild(p);
            }
            document.body.appendChild(host);
            window.setTimeout(() => host.remove(), light ? 1600 : 2200);
        } catch (_) { /* ignore */ }
    }

    /** Caja registradora al registrar venta (cajón + campana). */
    let _audioCtx = null;
    function playMoneySound() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!_audioCtx) _audioCtx = new AC();
            const ctx = _audioCtx;
            const run = () => {
                const t0 = ctx.currentTime + 0.01;
                const master = ctx.createGain();
                master.gain.value = 0.85;
                master.connect(ctx.destination);

                // 1) Golpe mecánico del cajón
                const thud = ctx.createOscillator();
                const thudG = ctx.createGain();
                thud.type = 'sine';
                thud.frequency.setValueAtTime(95, t0);
                thud.frequency.exponentialRampToValueAtTime(48, t0 + 0.09);
                thudG.gain.setValueAtTime(0.0001, t0);
                thudG.gain.exponentialRampToValueAtTime(0.55, t0 + 0.008);
                thudG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
                thud.connect(thudG);
                thudG.connect(master);
                thud.start(t0);
                thud.stop(t0 + 0.14);

                // 2) “Cha” — ruido corto del mecanismo
                const nLen = Math.max(1, Math.floor(ctx.sampleRate * 0.07));
                const noiseBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
                const data = noiseBuf.getChannelData(0);
                for (let i = 0; i < nLen; i++) {
                    data[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
                }
                const noise = ctx.createBufferSource();
                noise.buffer = noiseBuf;
                const noiseBp = ctx.createBiquadFilter();
                noiseBp.type = 'bandpass';
                noiseBp.frequency.value = 1800;
                noiseBp.Q.value = 0.85;
                const noiseG = ctx.createGain();
                noiseG.gain.setValueAtTime(0.0001, t0);
                noiseG.gain.exponentialRampToValueAtTime(0.28, t0 + 0.004);
                noiseG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
                noise.connect(noiseBp);
                noiseBp.connect(noiseG);
                noiseG.connect(master);
                noise.start(t0);
                noise.stop(t0 + 0.08);

                // 3) Campana “ching” metálica
                const bellAt = t0 + 0.05;
                const ring = (freq, start, dur, gain, type = 'triangle') => {
                    const osc = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc.type = type;
                    osc.frequency.setValueAtTime(freq, start);
                    g.gain.setValueAtTime(0.0001, start);
                    g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
                    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
                    osc.connect(g);
                    g.connect(master);
                    osc.start(start);
                    osc.stop(start + dur + 0.02);
                };
                ring(1568, bellAt, 0.55, 0.22);           // G6
                ring(2093, bellAt + 0.015, 0.7, 0.16);    // C7
                ring(3136, bellAt + 0.03, 0.45, 0.08);    // G7
                ring(4186, bellAt + 0.04, 0.35, 0.04, 'sine');
            };
            if (ctx.state === 'suspended') {
                ctx.resume().then(run).catch(() => {});
            } else {
                run();
            }
        } catch (_) { /* sin audio / autoplay bloqueado */ }
    }

    /** Atributos HTML para un número animable. */
    function fxAttrs(n, fmt = 'mxn') {
        const num = Number(n);
        if (!Number.isFinite(num)) return '';
        return ` data-fx-num="${num}" data-fx-fmt="${fmt}"`;
    }

    /** Limpia fingerprint de reconteo en el scope de countUp. */
    function clearCountFx(root) {
        const scope = typeof root === 'string' ? document.querySelector(root) : root;
        if (!scope?.dataset) return;
        delete scope.dataset.fxFingerprint;
    }

    function easeOutExpo(t) {
        return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    function formatFx(n, fmt) {
        if (fmt === 'mxn') return (window.Calc?.fmtMXN || ((x) => String(x)))(n);
        if (fmt === 'pct') return (window.Calc?.fmtPct || ((x) => `${Math.round(x * 100)}%`))(n);
        if (fmt === 'signed-mxn') {
            const s = (window.Calc?.fmtMXN || ((x) => String(x)))(n);
            return n > 0.009 ? `+${s}` : s;
        }
        return String(Math.round(n));
    }

    /**
     * Reconteo marcado en [data-fx-num] dentro de root.
     * Reanima si cambian los valores, o con force (p. ej. al entrar a la vista).
     */
    function countUp(root = document, opts = {}) {
        const scope = typeof root === 'string' ? document.querySelector(root) : (root || document);
        if (!scope?.querySelectorAll) return;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        const force = !!opts.force;
        const dur = Number(opts.duration) > 0 ? Number(opts.duration) : 1100;
        const stagger = Number.isFinite(opts.stagger) ? opts.stagger : 85;
        const nodes = [...scope.querySelectorAll('[data-fx-num]')];
        if (!nodes.length) return;

        const fingerprint = nodes.map((el) => `${el.dataset.fxFmt || 'int'}:${el.dataset.fxNum}`).join('|');
        if (!force && scope.dataset && scope.dataset.fxFingerprint === fingerprint) {
            nodes.forEach((el) => {
                const target = Number(el.dataset.fxNum);
                const fmt = el.dataset.fxFmt || 'int';
                if (Number.isFinite(target)) el.textContent = formatFx(target, fmt);
                el.classList.remove('is-counting');
            });
            return;
        }
        if (scope.dataset) scope.dataset.fxFingerprint = fingerprint;

        nodes.forEach((el, i) => {
            const target = Number(el.dataset.fxNum);
            if (!Number.isFinite(target)) return;
            const fmt = el.dataset.fxFmt || 'int';
            if (reduce) {
                el.textContent = formatFx(target, fmt);
                el.classList.remove('is-counting');
                return;
            }
            const from = 0;
            const delay = i * stagger;
            const t0 = performance.now() + delay;
            el.classList.add('is-counting');
            el.textContent = formatFx(from, fmt);
            const tick = (now) => {
                if (now < t0) {
                    requestAnimationFrame(tick);
                    return;
                }
                const p = Math.min(1, (now - t0) / dur);
                const eased = easeOutExpo(p);
                el.textContent = formatFx(from + (target - from) * eased, fmt);
                if (p < 1) {
                    requestAnimationFrame(tick);
                } else {
                    el.textContent = formatFx(target, fmt);
                    el.classList.remove('is-counting');
                    el.classList.add('is-count-done');
                    window.setTimeout(() => el.classList.remove('is-count-done'), 420);
                }
            };
            requestAnimationFrame(tick);
        });
    }

    return {
        dialog,
        confirm,
        prompt,
        importWizard,
        backupChoice,
        bottomSheet,
        toast,
        pulseRainbow,
        escapeHTML,
        playMoneySound,
        burstConfetti,
        fxAttrs,
        clearCountFx,
        countUp,
    };
})();
window.UI = UI;
