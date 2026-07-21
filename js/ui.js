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

    async function alert({ title = 'Aviso', message = '', kind = 'info' } = {}) {
        await dialog({
            title,
            body: `<p class="dlg-msg dlg-msg-${kind}">${message}</p>`,
            size: 'sm',
            actions: [{ label: 'Entendido', variant: 'primary', value: true }],
        });
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
                <p class="dlg-msg muted small">Elige cómo integrarlos. <strong>Fusionar por SKU</strong> actualiza los existentes sin duplicar ni borrar ventas.</p>
            `,
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                { label: 'Fusionar por SKU', variant: '', value: 'merge' },
                { label: 'Reemplazar todo', variant: 'primary', value: 'replace' },
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

    // Toast (única instancia).
    function toast(msg, kind = 'success', duration = 2400) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.className = 'toast ' + kind;
        el.textContent = msg;
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

    return {
        dialog,
        confirm,
        alert,
        prompt,
        importWizard,
        backupChoice,
        toast,
        escapeHTML,
    };
})();
