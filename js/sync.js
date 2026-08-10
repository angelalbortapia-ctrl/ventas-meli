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
    let holdRemoteUntil = 0;    // tras reset local forzado, ignora pull/realtime un rato
    let lastAppliedFingerprint = ''; // contenido real aplicado/pushed (ignora updated_at)
    let status = { state: 'off', detail: 'Sin configurar', email: '' };
    const listeners = new Set();

    function markLocalDirty() {
        localDirtyAt = Date.now();
    }

    /** JSON estable: ordena claves de objetos (arrays conservan orden). */
    function canonicalize(value) {
        if (Array.isArray(value)) return value.map(canonicalize);
        if (value && typeof value === 'object') {
            const out = {};
            Object.keys(value).sort().forEach(k => {
                out[k] = canonicalize(value[k]);
            });
            return out;
        }
        return value;
    }

    /** Hash estable del payload de sync, sin marcas volátiles (packedAt / updated_at). */
    function contentFingerprint(row) {
        if (!row || !Array.isArray(row.lotes)) return '';
        const raw = (row.settings && typeof row.settings === 'object') ? row.settings : {};
        const amazon = raw._amazon && typeof raw._amazon === 'object' ? raw._amazon : null;
        const payload = {
            meli: row.lotes,
            amazonLotes: amazon && Array.isArray(amazon.lotes) ? amazon.lotes : [],
            amazonSettings: amazon ? stripSyncMeta(amazon.settings) : {},
            meliSettings: stripSyncMeta(raw),
            ui: syncableUI(raw._ui),
            marketplace: raw._marketplace || 'meli',
        };
        try {
            return hashString(JSON.stringify(canonicalize(payload)));
        } catch {
            return '';
        }
    }

    function hashString(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
        return (h >>> 0).toString(36);
    }

    // Selectores (no nodos): tras re-render el DOM se recrea y las refs mueren.
    const SCROLL_SELECTORS = [
        '.gx-body',
        '.dash-body',
        '#view-lotes .lotes-list',
        '#view-lotes',
        '.content',
    ];

    function captureScroll() {
        const snap = [];
        const seen = new Set();
        SCROLL_SELECTORS.forEach(sel => {
            const el = document.querySelector(sel);
            if (!el || seen.has(el) || !el.scrollTop) return;
            seen.add(el);
            snap.push({ sel, top: el.scrollTop, left: el.scrollLeft || 0 });
        });
        const root = document.scrollingElement;
        if (root && root.scrollTop) {
            snap.push({ sel: ':root', top: root.scrollTop, left: root.scrollLeft || 0 });
        }
        return snap;
    }

    function restoreScroll(snap) {
        if (!Array.isArray(snap) || !snap.length) return;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                snap.forEach(({ sel, top, left }) => {
                    const el = sel === ':root'
                        ? document.scrollingElement
                        : document.querySelector(sel);
                    if (!el) return;
                    el.scrollTop = top;
                    el.scrollLeft = left;
                });
            });
        });
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

        // Persistir catálogo activo antes de contar
        const active = Data.normalizeMarketplace(window.State.marketplace);
        Data.saveLotes(window.State.lotes, active);
        Data.saveSettings(window.State.settings, active);

        const local = localCatalogCounts();
        const remote = row ? remoteCatalogCounts(row) : { meli: 0, amazon: 0, total: 0, hasAmazonKey: false };

        if (!row) {
            await pushNow();
            return;
        }

        if (remote.total === 0 && local.total > 0) {
            await pushNow();
            return;
        }

        if (local.total === 0 && remote.total > 0) {
            applyRemote(row, { silent: true });
            return;
        }

        // Ambos tienen data: preguntar con desglose Meli / Amazon
        if (local.total > 0 && remote.total > 0) {
            const amzWarn = local.amazon > 0 && remote.amazon === 0
                ? `<p class="dlg-msg"><strong>⚠️ La nube trae Amazon vacío</strong> (${local.amazon} aquí). Aunque elijas nube, se conservan los productos Amazon de este dispositivo y se re-suben.</p>`
                : '';
            const choice = await UI.dialog({
                title: 'Sincronizar con la nube',
                body: `<p class="dlg-msg">Hay datos en este dispositivo y en Supabase. ¿Cuál prevalece?</p>
                       <p class="dlg-msg muted small">${countsHtml(local, remote)}</p>
                       ${amzWarn}
                       <p class="dlg-msg muted small">Meli y Amazon viajan juntos. Un catálogo vacío en la nube <strong>ya no borra</strong> productos locales.</p>`,
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
        // Nunca default a 'remote': eso borraba Amazon local con nube vacía.
        if (!window.UI || conflictBusy) return 'local';
        conflictBusy = true;
        try {
            const active = Data.normalizeMarketplace(window.State.marketplace);
            Data.saveLotes(window.State.lotes, active);
            Data.saveSettings(window.State.settings, active);
            const local = localCatalogCounts();
            const remote = remoteCatalogCounts(row);
            const choice = await UI.dialog({
                title: 'Conflicto de sincronización',
                body: `<p class="dlg-msg">Hay cambios en <strong>este dispositivo</strong> y también en la <strong>nube</strong> (otro dispositivo). ¿Qué quieres conservar?</p>
                       <p class="dlg-msg muted small">${countsHtml(local, remote)}</p>
                       <p class="dlg-msg muted small">Tip: Meli y Amazon se sincronizan juntos. Si la nube trae Amazon en 0 y aquí hay productos, elige este dispositivo.</p>`,
                actions: [
                    { label: 'Quedarme con este dispositivo', variant: 'primary', value: 'local' },
                    { label: 'Usar la nube (descartar local)', variant: 'danger', value: 'remote' },
                ],
            });
            // Cerrar / Esc → conservar local (no wipe)
            return choice === 'remote' ? 'remote' : 'local';
        } finally {
            conflictBusy = false;
        }
    }

    /** Bloquea aplicar nube (p. ej. justo después de restaurar inventario). */
    function holdRemote(ms = 15000) {
        holdRemoteUntil = Date.now() + ms;
    }

    async function handleIncomingRemote(row, { fromRealtime = false } = {}) {
        if (!row || pushing || applyingRemote) return;
        // Eco del propio push / pull idéntico: mismo contenido → silencio, sin re-render.
        const fp = contentFingerprint(row);
        if (fp && fp === lastAppliedFingerprint) {
            lastRemoteAt = row.updated_at || lastRemoteAt;
            return;
        }
        if (Date.now() < holdRemoteUntil) {
            // Preferir local: re-subir en vez de reaplicar ventas viejas
            // (solo si el remoto sí trae un diff real).
            await pushNow({ force: true }).catch(() => {});
            return;
        }
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
        const applied = applyRemote(row, {
            silent: !fromRealtime,
            toastRealtime: fromRealtime,
        });
        if (applied) localDirtyAt = 0;
    }

    async function pushNow({ force = false } = {}) {
        const c = ensureClient();
        if (!c || applyingRemote) return;
        const { data: { user } } = await c.auth.getUser();
        if (!user) return;
        if (force) holdRemote(20000);

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
        const packed = packStateForSync();

        // Nunca pisar en la nube un catálogo con productos usando un paquete vacío
        try {
            const { data: remoteRow } = await c.from(TABLE)
                .select('lotes, settings, updated_at')
                .eq('user_id', user.id)
                .maybeSingle();
            if (remoteRow) mergeNonEmptyRemoteIntoPack(packed, remoteRow);
        } catch (err) {
            console.warn('[sync] merge remoto antes de push', err);
        }

        const payload = {
            user_id: user.id,
            lotes: packed.lotes,
            settings: packed.settings,
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
        lastAppliedFingerprint = contentFingerprint({ lotes: packed.lotes, settings: packed.settings });
        // Evita que el eco realtime del propio upsert re-aplique y resetee el scroll.
        holdRemote(2500);
        const counts = remoteCatalogCounts({ lotes: packed.lotes, settings: packed.settings });
        setStatus({
            state: 'synced',
            detail: `Nube OK · Meli ${counts.meli} · Amazon ${counts.amazon}`,
            email: user.email || status.email,
        });
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
        if (!error && row && Date.now() >= holdRemoteUntil) {
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

    /** Empaca Meli + Amazon en el schema actual (amazon va dentro de settings). */
    function packStateForSync() {
        const active = Data.normalizeMarketplace(window.State.marketplace);
        Data.saveLotes(window.State.lotes, active);
        Data.saveSettings(window.State.settings, active);

        const meliLotes = active === 'meli' ? window.State.lotes : Data.loadLotes('meli');
        const meliSettings = stripSyncMeta(
            active === 'meli' ? window.State.settings : Data.loadSettings('meli')
        );
        const amazonLotes = active === 'amazon' ? window.State.lotes : Data.loadLotes('amazon');
        const amazonSettings = stripSyncMeta(
            active === 'amazon' ? window.State.settings : Data.loadSettings('amazon')
        );

        return {
            lotes: meliLotes,
            settings: {
                ...meliSettings,
                marketplace: 'meli',
                // Bundle dual v2: siempre ambos catálogos
                _amazon: {
                    lotes: amazonLotes,
                    settings: amazonSettings,
                },
                // Wishlist, Mis bolsitas y demás estado operativo compartido.
                // Los metadatos de respaldo son locales a cada dispositivo.
                _ui: syncableUI(window.State.ui),
                _marketplace: active,
                _syncMeta: {
                    version: 3,
                    packedAt: new Date().toISOString(),
                    counts: {
                        meli: meliLotes.length,
                        amazon: amazonLotes.length,
                    },
                    active,
                },
            },
        };
    }

    function syncableUI(ui) {
        const out = { ...(ui || {}) };
        delete out.backupDirty;
        delete out.lastBackupAt;
        // Key de Keepa y caché de tokens: solo en este dispositivo
        delete out.keepaApiKey;
        delete out.keepaCache;
        delete out.keepaLibrary;
        return out;
    }

    function stripSyncMeta(settings) {
        const s = { ...(settings || {}) };
        delete s._amazon;
        delete s._ui;
        delete s._marketplace;
        delete s._syncMeta;
        return s;
    }

    function localCatalogCounts() {
        const active = Data.normalizeMarketplace(window.State.marketplace);
        const meli = active === 'meli' ? (window.State.lotes || []).length : Data.loadLotes('meli').length;
        const amazon = active === 'amazon' ? (window.State.lotes || []).length : Data.loadLotes('amazon').length;
        return { meli, amazon, total: meli + amazon };
    }

    function remoteCatalogCounts(row) {
        const meli = Array.isArray(row?.lotes) ? row.lotes.length : 0;
        const raw = (row?.settings && typeof row.settings === 'object') ? row.settings : {};
        const hasAmazonKey = Object.prototype.hasOwnProperty.call(raw, '_amazon');
        const amazon = hasAmazonKey && raw._amazon && Array.isArray(raw._amazon.lotes)
            ? raw._amazon.lotes.length
            : (raw._syncMeta?.counts?.amazon ?? 0);
        return { meli, amazon: Number(amazon) || 0, total: meli + (Number(amazon) || 0), hasAmazonKey };
    }

    function countsHtml(local, remote) {
        return `Este dispositivo — Meli <strong>${local.meli}</strong> · Amazon <strong>${local.amazon}</strong><br>`
            + `Nube — Meli <strong>${remote.meli}</strong> · Amazon <strong>${remote.amazon}</strong>`;
    }

    /** Si el pack local trae un catálogo vacío y la nube sí tiene productos, conserva los de la nube. */
    function mergeNonEmptyRemoteIntoPack(packed, remoteRow) {
        if (!packed || !remoteRow) return packed;
        const remoteCounts = remoteCatalogCounts(remoteRow);
        const localCounts = remoteCatalogCounts({ lotes: packed.lotes, settings: packed.settings });

        if (localCounts.meli === 0 && remoteCounts.meli > 0 && Array.isArray(remoteRow.lotes)) {
            packed.lotes = remoteRow.lotes;
        }

        const remoteAmz = remoteRow.settings && typeof remoteRow.settings === 'object'
            ? remoteRow.settings._amazon
            : null;
        if (localCounts.amazon === 0 && remoteCounts.amazon > 0
            && remoteAmz && typeof remoteAmz === 'object' && Array.isArray(remoteAmz.lotes)
            && remoteAmz.lotes.length > 0) {
            packed.settings = packed.settings || {};
            packed.settings._amazon = remoteAmz;
        }

        if (packed.settings?._syncMeta?.counts) {
            packed.settings._syncMeta.counts = {
                meli: Array.isArray(packed.lotes) ? packed.lotes.length : 0,
                amazon: Array.isArray(packed.settings._amazon?.lotes)
                    ? packed.settings._amazon.lotes.length
                    : 0,
            };
        }
        return packed;
    }

    /**
     * Nunca reemplazar un catálogo local con productos por uno vacío de la nube.
     * Devuelve { lotes, settings, protected } para Amazon (y análogo para Meli).
     */
    function protectCatalogFromEmptyRemote(remoteLotes, remoteSettings, mp) {
        const remoteArr = Array.isArray(remoteLotes) ? remoteLotes : [];
        const localArr = typeof Data.peekLotes === 'function'
            ? Data.peekLotes(mp)
            : Data.loadLotes(mp);
        if (remoteArr.length === 0 && localArr.length > 0) {
            return {
                lotes: localArr,
                settings: stripSyncMeta(Data.loadSettings(mp)),
                protected: true,
                kept: localArr.length,
            };
        }
        return {
            lotes: remoteArr,
            settings: remoteSettings && typeof remoteSettings === 'object' ? remoteSettings : {},
            protected: false,
            kept: 0,
        };
    }

    function applyRemote(row, { silent = false, toastRealtime = false } = {}) {
        if (!row || !Array.isArray(row.lotes)) return false;

        const fp = contentFingerprint(row);
        if (fp && fp === lastAppliedFingerprint) {
            lastRemoteAt = row.updated_at || lastRemoteAt;
            return false;
        }

        applyingRemote = true;
        window.__skipBackupDirty = true;
        window.__skipSync = true;
        let healNeeded = false;
        const protectedMsg = [];
        const scrollSnap = captureScroll();
        try {
            const rawSettings = (row.settings && typeof row.settings === 'object') ? row.settings : {};
            const marketplace = rawSettings._marketplace === 'amazon' ? 'amazon' : 'meli';
            const remoteUI = rawSettings._ui && typeof rawSettings._ui === 'object'
                ? { ...rawSettings._ui }
                : null;
            // Key/caché Keepa son locales: un row legacy en la nube no debe reinyectarlas.
            if (remoteUI) {
                delete remoteUI.keepaApiKey;
                delete remoteUI.keepaCache;
                delete remoteUI.keepaLibrary;
            }
            const meliSettings = stripSyncMeta(rawSettings);

            // Meli: no borrar productos locales si la nube viene vacía
            const meliGuard = protectCatalogFromEmptyRemote(row.lotes, meliSettings, 'meli');
            if (meliGuard.protected) {
                healNeeded = true;
                protectedMsg.push(`Meli×${meliGuard.kept}`);
            }

            // Amazon: clave ausente O array vacío → conservar local
            const hasAmazonKey = Object.prototype.hasOwnProperty.call(rawSettings, '_amazon');
            let remoteAmazonLotes = [];
            let remoteAmazonSettings = {};
            if (hasAmazonKey && rawSettings._amazon && typeof rawSettings._amazon === 'object') {
                remoteAmazonLotes = Array.isArray(rawSettings._amazon.lotes) ? rawSettings._amazon.lotes : [];
                remoteAmazonSettings = rawSettings._amazon.settings && typeof rawSettings._amazon.settings === 'object'
                    ? rawSettings._amazon.settings
                    : {};
            }
            // Si no hay clave _amazon, protectCatalog también conserva local (remote vacío)
            const amzGuard = protectCatalogFromEmptyRemote(remoteAmazonLotes, remoteAmazonSettings, 'amazon');
            if (amzGuard.protected) {
                healNeeded = true;
                protectedMsg.push(`Amazon×${amzGuard.kept}`);
            }

            Data.saveLotes(meliGuard.lotes.map(l => Data.normalize(l, [], 'meli')), 'meli');
            Data.saveSettings({
                ...Calc.defaultsFor('meli'),
                ...stripSyncMeta(meliGuard.settings),
                marketplace: 'meli',
            }, 'meli');
            Data.saveLotes(
                typeof Data.migrateLotes === 'function'
                    ? Data.migrateLotes(amzGuard.lotes, 'amazon')
                    : amzGuard.lotes.map(l => Data.normalize(l, [], 'amazon')),
                'amazon'
            );
            Data.saveSettings({
                ...Calc.defaultsFor('amazon'),
                ...stripSyncMeta(amzGuard.settings),
                marketplace: 'amazon',
            }, 'amazon');

            window.State.marketplace = marketplace;
            // Conservar vista General si el usuario (o la nube) la tenía abierta
            const keepGeneral = window.State.ui?.mpView === 'general'
                || remoteUI?.mpView === 'general';
            // Merge ledger flete por-id (no last-write-wins ciego)
            const mergedUi = (window.Freight?.mergeFreightState
                ? Freight.mergeFreightState(window.State.ui, remoteUI)
                : { ...(window.State.ui || {}), ...(remoteUI || {}) });
            window.State.ui = {
                ...mergedUi,
                marketplace,
                mpView: keepGeneral ? 'general' : marketplace,
            };
            window.State.saveUI();
            window.State.lotes = Data.loadLotes(marketplace);
            window.State.settings = Data.loadSettings(marketplace);

            lastRemoteAt = row.updated_at || new Date().toISOString();
            lastAppliedFingerprint = fp || contentFingerprint({
                lotes: meliGuard.lotes,
                settings: {
                    ...stripSyncMeta(meliGuard.settings),
                    _amazon: { lotes: amzGuard.lotes, settings: amzGuard.settings },
                    _ui: remoteUI,
                    _marketplace: marketplace,
                },
            });
            window.State.notify();
            if (window.App?.refreshMarketplaceChrome) App.refreshMarketplaceChrome();
            if (window.SettingsView?.loadIntoForm) SettingsView.loadIntoForm();
            if (window.State.view === 'lotes' && window.LotesView?.render) LotesView.render();
            if (window.State.view === 'dashboard' && window.DashboardView?.render) DashboardView.render();
            if (window.State.view === 'insights' && window.InsightsView?.render) InsightsView.render();
            if (window.State.view === 'envios' && window.EnviosView?.render) EnviosView.render();
            if (window.State.view === 'wishlist' && window.WishlistView?.render) WishlistView.render();
            if (window.State.view === 'keepa' && window.KeepaView?.render) KeepaView.render();
            if (window.State.view === 'caja' && window.CajaView?.render) CajaView.render();
            if (window.App?.refreshNavCounts) App.refreshNavCounts();
            restoreScroll(scrollSnap);

            const counts = {
                meli: Data.loadLotes('meli').length,
                amazon: Data.loadLotes('amazon').length,
            };
            setStatus({
                state: 'synced',
                detail: healNeeded
                    ? `Nube + local protegido · Meli ${counts.meli} · Amazon ${counts.amazon}`
                    : `Desde nube · Meli ${counts.meli} · Amazon ${counts.amazon}`,
                email: status.email,
            });
            if (toastRealtime && window.UI) {
                UI.toast('☁️ Actualizado desde otro dispositivo');
            } else if (!silent && window.UI) {
                UI.toast(`☁️ Nube aplicada · Meli ${counts.meli} · Amazon ${counts.amazon}`);
            }
            if (healNeeded && window.UI) {
                UI.toast(`🛡️ Conservé ${protectedMsg.join(' · ')} (la nube venía vacía)`);
            }
        } finally {
            window.__skipSync = false;
            window.__skipBackupDirty = false;
            applyingRemote = false;
        }
        // Subir de nuevo para sanar la nube (fuera de applyingRemote)
        if (healNeeded) {
            holdRemote(25000);
            setTimeout(() => {
                pushNow({ force: true }).catch(err => console.warn('[sync] heal push', err));
            }, 900);
        }
        return true;
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
            window.State.saveUI = wrap(window.State.saveUI.bind(window.State));
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
        holdRemote,
        getStatus,
        onStatus,
        bootSession,
        // expuesto para depuración / tests
        packStateForSync,
    };
})();

// Exponer en window: settings/app usan window.Sync (const no queda en window).
window.Sync = Sync;
