/* ==========================================================================
   Vista Ajustes: umbrales, retenciones, comisiones, tope CPA + Supabase sync.
   ========================================================================== */

const SettingsView = (() => {

    const FIELDS = [
        ['set-com-clasica',     'comisionClasica',    v => v / 100,  v => (v * 100).toFixed(2)],
        ['set-com-premium',     'comisionPremium',    v => v / 100,  v => (v * 100).toFixed(2)],
        ['set-cargo-fijo',      'cargoFijo',          v => v,        v => v],
        ['set-umbral-cargo',    'umbralCargoFijo',    v => v,        v => v],
        ['set-iva',             'retencionIVA',       v => v / 100,  v => (v * 100).toFixed(2)],
        ['set-isr',             'retencionISR',       v => v / 100,  v => (v * 100).toFixed(2)],
        ['set-umbral-liquidar', 'umbralLiquidar',     v => v,        v => v],
        ['set-umbral-escalar',  'umbralEscalar',      v => v,        v => v],
        ['set-cpa',             'topeCPA',            v => v / 100,  v => (v * 100).toFixed(2)],
    ];

    function loadIntoForm() {
        const s = window.State.settings;
        FIELDS.forEach(([id, key, , toDisplay]) => {
            const el = document.getElementById(id);
            if (el) el.value = toDisplay(s[key]);
        });
        const resico = document.getElementById('set-resico');
        if (resico) resico.checked = !!s.resico;
        const isr = document.getElementById('set-isr');
        if (isr) isr.disabled = !!s.resico;
        loadSyncForm();
    }

    function onChange(e) {
        const el = e.currentTarget;
        const [, key, fromDisplay] = FIELDS.find(f => f[0] === el.id) || [];
        if (!key) return;
        const v = parseFloat(el.value);
        if (isNaN(v)) return;
        window.State.settings[key] = fromDisplay(v);
        window.State.saveSettings();
        UI.toast('Ajustes guardados');
    }

    function onResicoChange() {
        const resico = document.getElementById('set-resico');
        const on = !!resico?.checked;
        window.State.settings.resico = on;
        if (on) {
            window.State.settings.retencionISR = 0.01;
            const isr = document.getElementById('set-isr');
            if (isr) { isr.value = '1.00'; isr.disabled = true; }
        } else {
            const isr = document.getElementById('set-isr');
            if (isr) {
                isr.disabled = false;
                if (parseFloat(isr.value) === 1) {
                    isr.value = '2.50';
                    window.State.settings.retencionISR = 0.025;
                }
            }
        }
        window.State.saveSettings();
        UI.toast(on ? 'RESICO ON · ISR 1%' : 'RESICO OFF');
    }

    function syncApi() {
        return window.Sync || (typeof Sync !== 'undefined' ? Sync : null);
    }

    function loadSyncForm() {
        const S = syncApi();
        if (!S) return;
        const cfg = S.loadConfig();
        const url = document.getElementById('sync-url');
        const key = document.getElementById('sync-anon');
        if (url) url.value = cfg.url || '';
        if (key) key.value = cfg.anonKey || '';
        paintSyncStatus(S.getStatus());
    }

    function paintSyncStatus(st) {
        const el = document.getElementById('sync-status');
        if (!el || !st) return;
        const map = {
            off: '⚪ Sin configurar',
            ready: '🟡 Listo — inicia sesión',
            signed_in: '🟡 Sesión activa',
            syncing: '🔵 Sincronizando…',
            synced: '🟢 Sincronizado (realtime)',
            error: '🔴 Error',
        };
        el.innerHTML = `<strong>${map[st.state] || st.state}</strong>`
            + (st.email ? `<br><span class="muted small">${esc(st.email)}</span>` : '')
            + (st.detail ? `<br><span class="muted small">${esc(st.detail)}</span>` : '');
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function initSyncUi() {
        const S = syncApi();
        if (!S) {
            const el = document.getElementById('sync-status');
            if (el) el.textContent = '🔴 Sync no cargó — recarga con Cmd+Shift+R';
            return;
        }

        S.onStatus(paintSyncStatus);

        document.getElementById('btn-sync-save')?.addEventListener('click', async () => {
            const urlEl = document.getElementById('sync-url');
            const url = urlEl?.value || '';
            const anonKey = document.getElementById('sync-anon')?.value || '';
            try {
                const r = await S.configure({ url, anonKey });
                if (!r.ok) throw new Error(r.error || 'Config inválida');
                if (urlEl && r.url) urlEl.value = r.url;
                UI.toast('Supabase configurado');
                paintSyncStatus(S.getStatus());
            } catch (err) {
                UI.toast(err.message || 'Error', 'error');
                paintSyncStatus(S.getStatus());
            }
        });

        document.getElementById('btn-sync-signup')?.addEventListener('click', async () => {
            const email = document.getElementById('sync-email')?.value?.trim();
            const password = document.getElementById('sync-password')?.value || '';
            if (!email || password.length < 6) {
                UI.toast('Email y contraseña (mín. 6)', 'error');
                return;
            }
            try {
                await S.signUp(email, password);
                UI.toast('Cuenta creada / revisa confirmación');
                paintSyncStatus(S.getStatus());
            } catch (err) {
                UI.toast(err.message || 'Error al registrar', 'error');
            }
        });

        document.getElementById('btn-sync-signin')?.addEventListener('click', async () => {
            const email = document.getElementById('sync-email')?.value?.trim();
            const password = document.getElementById('sync-password')?.value || '';
            if (!email || !password) {
                UI.toast('Email y contraseña', 'error');
                return;
            }
            try {
                await S.signIn(email, password);
                UI.toast('Sesión iniciada — sync activo');
                paintSyncStatus(S.getStatus());
            } catch (err) {
                UI.toast(err.message || 'Error al entrar', 'error');
            }
        });

        document.getElementById('btn-sync-out')?.addEventListener('click', async () => {
            await S.signOut();
            UI.toast('Sesión cerrada');
            paintSyncStatus(S.getStatus());
        });

        document.getElementById('btn-sync-now')?.addEventListener('click', async () => {
            try {
                await S.pushNow();
                UI.toast('Subido a Supabase');
            } catch (err) {
                UI.toast(err.message || 'Error al subir', 'error');
            }
        });
    }

    function init() {
        FIELDS.forEach(([id]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', onChange);
        });
        document.getElementById('set-resico')?.addEventListener('change', onResicoChange);
        document.getElementById('btn-reset-settings')?.addEventListener('click', () => window.App && window.App.resetSettings());
        loadIntoForm();
        initSyncUi();
    }

    return { init, loadIntoForm };
})();
