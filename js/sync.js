/* ==========================================================================
   Sync Supabase: respaldo en la nube + realtime entre dispositivos.
   Misma cuenta (email/password) en Mac e iPhone = misma data.
   ========================================================================== */

const Sync = (() => {
    const CFG_KEY = 'ventas-meli:supabase:v1';
    const TABLE = 'ventas_meli_state';

    let client = null;
    let channel = null;
    let pushTimer = null;
    let pushing = false;
    let applyingRemote = false;
    let lastRemoteAt = null;
    let localDirtyAt = 0;       // Date.now() de último save local pendiente de confirmar en nube
    let conflictBusy = false;   // evita diálogos apilados
    let status = { state: 'off', detail: 'Sin configurar', email: '' };
    const listeners = new Set();

    function markLocalDirty() {
        localDirtyAt = Date.now();
    }

    function loadConfig() {
        try {
            return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {};
        } catch {
            return {};
        }
    }

    function saveConfig(cfg) {
        localStorage.setItem(CFG_KEY, JSON.stringify(cfg || {}));
    }

    function setStatus(partial) {
        status = { ...status, ...partial };
        listeners.forEach(fn => {
            try { fn(status); } catch (_) { /* ignore */ }
        });
        updateSidebarFoot();
    }

    function onStatus(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function getStatus() { return { ...status }; }

    function updateSidebarFoot() {
        const foot = document.querySelector('.sb-foot span:last-child');
        if (!foot) return;
        if (status.state === 'synced') {
            foot.textContent = status.email
                ? `☁️ Sync OK · ${status.email}`
                : '☁️ Sync OK';
            foot.style.color = 'var(--pos-text, var(--primary))';
        } else if (status.state === 'syncing') {
            foot.textContent = '☁️ Sincronizando…';
            foot.style.color = '';
        } else if (status.state === 'error') {
            foot.textContent = '☁️ Sync error';
            foot.style.color = 'var(--neg-text, #c45)';
        } else if (status.state === 'signed_in') {
            foot.textContent = '☁️ Conectado · pendiente sync';
            foot.style.color = '';
        } else if (status.state === 'ready') {
            foot.textContent = '☁️ Supabase listo · inicia sesión';
            foot.style.color = '';
        }
        // si state === 'off', App.refreshBackupHint manda
    }

    function hasSupabase() {
        return typeof window.supabase !== 'undefined' && window.supabase.createClient;
    }

    function ensureClient() {
        if (client) return client;
        if (!hasSupabase()) {
            setStatus({ state: 'error', detail: 'No se cargó la librería Supabase' });
            return null;
        }
        const cfg = loadConfig();
        if (!cfg.url || !cfg.anonKey) {
            setStatus({ state: 'off', detail: 'Configura URL y anon key' });
            return null;
        }
        client = window.supabase.createClient(cfg.url.trim(), cfg.anonKey.trim(), {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storage: localStorage,
            },
        });
        setStatus({ state: 'ready', detail: 'Cliente listo' });
        return client;
    }

    function resetClient() {
        if (channel && client) {
            try { client.removeChannel(channel); } catch (_) { /* ignore */ }
        }
        channel = null;
        client = null;
    }

    /** Normaliza URL del proyecto (sin /rest/v1 ni slash final). */
    function normalizeUrl(raw) {
        let u = String(raw || '').trim();
        if (!u) return '';
        u = u.replace(/\/rest\/v1\/?$/i, '');
        u = u.replace(/\/+$/, '');
        return u;
    }

    async function configure({ url, anonKey }) {
        const cleanUrl = normalizeUrl(url);
        const key = String(anonKey || '').trim();
        if (!cleanUrl || !key) {
            setStatus({ state: 'off', detail: 'Faltan URL o anon key' });
            return { ok: false, error: 'Faltan URL o anon key' };
        }
        if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cleanUrl)) {
            // Permitir custom domains, pero avisar si parece REST path
            if (/\/rest\//i.test(String(url || ''))) {
                return { ok: false, error: 'Quita /rest/v1/ de la URL. Solo: https://xxxx.supabase.co' };
            }
        }
        saveConfig({ url: cleanUrl, anonKey: key });
        resetClient();
        const c = ensureClient();
        if (!c) return { ok: false, error: 'No se pudo crear el cliente Supabase' };
        try {
            // Ping ligero de auth (no requiere login)
            const { error } = await c.auth.getSession();
            if (error) throw error;
        } catch (err) {
            setStatus({ state: 'error', detail: err.message || 'URL o key inválidos' });
            return { ok: false, error: err.message || 'URL o key inválidos' };
        }
        await bootSession();
        return { ok: true, url: cleanUrl };
    }

    async function bootSession() {
        const c = ensureClient();
        if (!c) return null;
        const { data: { session } } = await c.auth.getSession();
        if (session?.user) {
            setStatus({
                state: 'signed_in',
                detail: 'Sesión activa',
                email: session.user.email || '',
            });
            await pullAndSubscribe();
            return session.user;
        }
        setStatus({ state: 'ready', detail: 'Inicia sesión para sincronizar', email: '' });
        return null;
    }

    async function signUp(email, password) {
        const c = ensureClient();
        if (!c) throw new Error('Configura Supabase primero');
        const { data, error } = await c.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session?.user) {
            setStatus({ state: 'signed_in', email: data.session.user.email || email });
            await firstSyncChoice();
            await pullAndSubscribe();
        } else {
            setStatus({
                state: 'ready',
                detail: 'Revisa tu correo para confirmar la cuenta (si el proyecto lo exige)',
                email: '',
            });
        }
        return data;
    }

    async function signIn(email, password) {
        const c = ensureClient();
        if (!c) throw new Error('Configura Supabase primero');
        const { data, error } = await c.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setStatus({ state: 'signed_in', email: data.user?.email || email });
        await firstSyncChoice();
        await pullAndSubscribe();
        return data;
    }

    async function signOut() {
        const c = ensureClient();
        if (channel && c) {
            try { c.removeChannel(channel); } catch (_) { /* ignore */ }
            channel = null;
        }
        if (c) await c.auth.signOut();
        setStatus({ state: 'ready', detail: 'Sesión cerrada', email: '' });
    }

    async function firstSyncChoice() {
        const c = ensureClient();
        if (!c) return;
        const { data: { user } } = await c.auth.getUser();
        if (!user) return;

        const { data: row, error } = await c.from(TABLE).select('lotes, settings, updated_at').eq('user_id', user.id).maybeSingle();
        if (error) {
            console.warn('[sync] pull', error);
            return;
        }

        const localCount = (window.State.lotes || []).length;
        const remoteCount = Array.isArray(row?.lotes) ? row.lotes.length : 0;

        if (!row) {
            // Primera vez: subir local
            await pushNow();
            return;
        }

        if (remoteCount === 0 && localCount > 0) {
            await pushNow();
            return;
        }

        if (localCount === 0 && remoteCount > 0) {
            applyRemote(row, { silent: true });
            return;
        }

        // Ambos tienen data: preguntar
        if (localCount > 0 && remoteCount > 0) {
            const choice = await UI.dialog({
                title: 'Sincronizar con la nube',
                body: `<p class="dlg-msg">Este dispositivo tiene <strong>${localCount}</strong> lote(s). En Supabase hay <strong>${remoteCount}</strong>. ¿Cuál prevalece?</p>`,
                actions: [
                    { label: 'Usar nube → este dispositivo', variant: 'ghost', value: 'pull' },
                    { label: 'Subir este dispositivo → nube', variant: 'primary', value: 'push' },
                ],
            });
            if (choice === 'pull') applyRemote(row, { silent: false });
            else await pushNow();
        }
    }

    function schedulePush() {
        if (applyingRemote) return;
        if (!client) return;
        if (status.state !== 'signed_in' && status.state !== 'synced' && status.state !== 'syncing') return;
        markLocalDirty();
        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => { pushNow().catch(console.warn); }, 600);
    }

    async function resolveConflict(row) {
        if (!window.UI || conflictBusy) return 'remote';
        conflictBusy = true;
        try {
            const choice = await UI.dialog({
                title: 'Conflicto de sincronización',
                body: `<p class="dlg-msg">Hay cambios en <strong>este dispositivo</strong> y también en la <strong>nube</strong> (otro dispositivo). ¿Qué quieres conservar?</p>
                       <p class="dlg-msg muted small">Tip: usa la Mac como fuente principal; evita editar el mismo lote en ambos a la vez.</p>`,
                actions: [
                    { label: 'Quedarme con este dispositivo', variant: 'primary', value: 'local' },
                    { label: 'Usar la nube (descartar local)', variant: 'danger', value: 'remote' },
                ],
            });
            return choice === 'local' ? 'local' : 'remote';
        } finally {
            conflictBusy = false;
        }
    }

    async function handleIncomingRemote(row, { fromRealtime = false } = {}) {
        if (!row || pushing || applyingRemote) return;
        if (row.updated_at && lastRemoteAt && row.updated_at === lastRemoteAt) return;

        const remoteTs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        const knownTs = lastRemoteAt ? new Date(lastRemoteAt).getTime() : 0;
        // Cambios locales sin confirmar en nube (o más recientes que lo último aplicado)
        const hasLocalEdits = localDirtyAt > 0 && localDirtyAt >= knownTs - 500;

        if (hasLocalEdits && remoteTs > knownTs) {
            const choice = await resolveConflict(row);
            if (choice === 'local') {
                await pushNow({ force: true });
                return;
            }
        }
        applyRemote(row, { silent: fromRealtime });
        localDirtyAt = 0;
        if (fromRealtime && window.UI) UI.toast('☁️ Actualizado desde otro dispositivo');
    }

    async function pushNow({ force = false } = {}) {
        const c = ensureClient();
        if (!c || applyingRemote) return;
        const { data: { user } } = await c.auth.getUser();
        if (!user) return;

        // Antes de pisar: si la nube avanzó y nosotros también, preguntar
        if (!force) {
            const { data: remote } = await c.from(TABLE).select('updated_at').eq('user_id', user.id).maybeSingle();
            if (remote?.updated_at && lastRemoteAt && remote.updated_at !== lastRemoteAt) {
                const remoteTs = new Date(remote.updated_at).getTime();
                const knownTs = new Date(lastRemoteAt).getTime();
                if (remoteTs > knownTs && localDirtyAt >= knownTs - 500) {
                    const { data: full } = await c.from(TABLE).select('lotes, settings, updated_at').eq('user_id', user.id).maybeSingle();
                    if (full) {
                        const choice = await resolveConflict(full);
                        if (choice === 'remote') {
                            applyRemote(full, { silent: false });
                            localDirtyAt = 0;
                            return;
                        }
                    }
                }
            }
        }

        pushing = true;
        setStatus({ state: 'syncing', detail: 'Subiendo…' });
        const updated_at = new Date().toISOString();
        const payload = {
            user_id: user.id,
            lotes: window.State.lotes,
            settings: window.State.settings,
            updated_at,
        };
        const { error } = await c.from(TABLE).upsert(payload, { onConflict: 'user_id' });
        pushing = false;
        if (error) {
            console.error('[sync] push', error);
            setStatus({ state: 'error', detail: error.message });
            if (window.UI) UI.toast('Sync: ' + error.message, 'error');
            return;
        }
        lastRemoteAt = updated_at;
        localDirtyAt = 0;
        setStatus({ state: 'synced', detail: 'Guardado en la nube', email: user.email || status.email });
        if (window.App?.markBackupDone) {
            window.__skipBackupDirty = true;
            App.markBackupDone();
            window.__skipBackupDirty = false;
        }
    }

    async function pullAndSubscribe() {
        const c = ensureClient();
        if (!c) return;
        const { data: { user } } = await c.auth.getUser();
        if (!user) return;

        const { data: row, error } = await c.from(TABLE).select('lotes, settings, updated_at').eq('user_id', user.id).maybeSingle();
        if (!error && row) {
            // Solo aplicar si remoto es más nuevo o aún no tenemos marca
            const remoteTs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
            const localTs = lastRemoteAt ? new Date(lastRemoteAt).getTime() : 0;
            if (!lastRemoteAt || remoteTs > localTs) {
                applyRemote(row, { silent: true });
            }
        }

        if (channel) {
            try { c.removeChannel(channel); } catch (_) { /* ignore */ }
            channel = null;
        }

        channel = c.channel('ventas-meli-state')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: TABLE,
                    filter: `user_id=eq.${user.id}`,
                },
                (payload) => {
                    if (pushing) return;
                    const row = payload.new;
                    if (!row) return;
                    handleIncomingRemote(row, { fromRealtime: true }).catch(console.warn);
                }
            )
            .subscribe((s) => {
                if (s === 'SUBSCRIBED') {
                    setStatus({
                        state: 'synced',
                        detail: 'Realtime activo',
                        email: user.email || status.email,
                    });
                }
            });
    }

    function applyRemote(row, { silent } = {}) {
        if (!row || !Array.isArray(row.lotes)) return;
        applyingRemote = true;
        window.__skipBackupDirty = true;
        window.__skipSync = true;
        try {
            window.State.lotes = row.lotes.map(l => Data.normalize(l, []));
            Data.saveLotes(window.State.lotes);
            if (row.settings && typeof row.settings === 'object') {
                window.State.settings = { ...Calc.DEFAULT_SETTINGS, ...row.settings };
                Data.saveSettings(window.State.settings);
                if (window.SettingsView?.loadIntoForm) SettingsView.loadIntoForm();
            }
            lastRemoteAt = row.updated_at || new Date().toISOString();
            window.State.notify();
            if (window.State.view === 'lotes' && window.LotesView?.render) LotesView.render();
            if (window.State.view === 'dashboard' && window.DashboardView?.render) DashboardView.render();
            if (window.State.view === 'insights' && window.InsightsView?.render) InsightsView.render();
            setStatus({
                state: 'synced',
                detail: 'Datos desde la nube',
                email: status.email,
            });
            if (!silent && window.UI) UI.toast('Datos cargados desde Supabase');
        } finally {
            window.__skipSync = false;
            window.__skipBackupDirty = false;
            applyingRemote = false;
        }
    }

    async function init() {
        const cfg = loadConfig();
        if (!cfg.url || !cfg.anonKey) {
            setStatus({ state: 'off', detail: 'Sin configurar' });
            return;
        }
        ensureClient();
        await bootSession();

        // Hook saves
        const wrap = (orig) => function (...args) {
            const r = orig.apply(this, args);
            if (!window.__skipSync) {
                markLocalDirty();
                schedulePush();
            }
            return r;
        };
        if (!window.State.__syncWrapped) {
            window.State.save = wrap(window.State.save.bind(window.State));
            window.State.saveSettings = wrap(window.State.saveSettings.bind(window.State));
            window.State.__syncWrapped = true;
        }
    }

    return {
        init,
        configure,
        loadConfig,
        signUp,
        signIn,
        signOut,
        pushNow,
        schedulePush,
        getStatus,
        onStatus,
        bootSession,
    };
})();

// Exponer en window: settings/app usan window.Sync (const no queda en window).
window.Sync = Sync;
