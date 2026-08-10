/* ==========================================================================
   Capital allocation (bolsitas) — motor de ledger / splits / reconcile.
   UI vive en dashboard.js; callers: caja, data, lotes, app.
   ========================================================================== */

const Alloc = (() => {

    const ALLOC_BUCKETS = [
        { key: 'reinversion', label: 'Reinversión', hint: 'Reponer stock' },
        { key: 'reserva', label: 'Reserva', hint: 'Colchón / imprevistos' },
        { key: 'ads', label: 'Ads', hint: 'Presupuesto publicidad' },
        { key: 'insumos', label: 'Insumos', hint: 'Empaque, etiquetas, consumibles' },
        { key: 'utilidad', label: 'Utilidad', hint: 'Tu ganancia / sacar a cuenta' },
    ];

    function allocMpKey() {
        return window.State.marketplace === 'amazon' ? 'amazon' : 'meli';
    }

    function emptyAllocBuckets() {
        return { reinversion: 0, reserva: 0, ads: 0, insumos: 0, utilidad: 0 };
    }

    function defaultAllocPercents() {
        return { reinversion: 35, reserva: 20, ads: 15, insumos: 15, utilidad: 15 };
    }

    /** Migra claves viejas: retiro→utilidad, fondo→reserva. */
    function migrateLegacyAllocMaps(obj) {
        if (!obj || typeof obj !== 'object') return {};
        const out = { ...obj };
        if (out.retiro != null && out.utilidad == null) out.utilidad = out.retiro;
        delete out.retiro;
        if (out.fondo != null && out.reserva == null) out.reserva = out.fondo;
        delete out.fondo;
        return out;
    }

    function migrateLedgerEntry(entry) {
        if (!entry || typeof entry !== 'object') return entry;
        const splits = migrateLegacyAllocMaps(entry.splits || {});
        let meta = entry.meta && typeof entry.meta === 'object' ? { ...entry.meta } : entry.meta;
        if (meta?.bucket === 'retiro') meta = { ...meta, bucket: 'utilidad' };
        if (meta?.bucket === 'fondo') meta = { ...meta, bucket: 'reserva' };
        return { ...entry, splits, meta };
    }

    function round2(n) {
        return Math.round((Number(n) || 0) * 100) / 100;
    }

    function normalizePercents(raw) {
        const src = migrateLegacyAllocMaps(raw);
        const out = emptyAllocBuckets();
        let any = false;
        ALLOC_BUCKETS.forEach(({ key }) => {
            const n = Number(src[key]);
            if (Number.isFinite(n) && n >= 0) {
                out[key] = n;
                any = true;
            }
        });
        if (!any) return defaultAllocPercents();
        const sum = ALLOC_BUCKETS.reduce((s, b) => s + (out[b.key] || 0), 0);
        if (sum <= 0) return defaultAllocPercents();
        if (Math.abs(sum - 100) > 0.05) {
            ALLOC_BUCKETS.forEach(({ key }, i) => {
                if (i === ALLOC_BUCKETS.length - 1) {
                    const others = ALLOC_BUCKETS.slice(0, -1).reduce((s, b) => s + out[b.key], 0);
                    out[key] = round2(100 - others);
                } else {
                    out[key] = round2((out[key] / sum) * 100);
                }
            });
        }
        return out;
    }

    /** Calcula % nuevos fijando una bolsita y repartiendo el resto proporcionalmente. */
    function previewPercentsForKey(key, pct, basePercents) {
        const clamped = Math.max(0, Math.min(100, round2(pct)));
        const base = basePercents && typeof basePercents === 'object' ? basePercents : defaultAllocPercents();
        const next = { ...base, [key]: clamped };
        const others = ALLOC_BUCKETS.filter(b => b.key !== key);
        const rest = round2(100 - clamped);
        const othersSum = others.reduce((s, b) => s + (Number(base[b.key]) || 0), 0);

        if (rest <= 0) {
            others.forEach(b => { next[b.key] = 0; });
        } else if (othersSum <= 0) {
            const each = round2(rest / others.length);
            let used = 0;
            others.forEach((b, i) => {
                if (i === others.length - 1) next[b.key] = round2(rest - used);
                else {
                    next[b.key] = each;
                    used = round2(used + each);
                }
            });
        } else {
            let used = 0;
            others.forEach((b, i) => {
                if (i === others.length - 1) {
                    next[b.key] = round2(rest - used);
                } else {
                    const share = round2(rest * ((Number(base[b.key]) || 0) / othersSum));
                    next[b.key] = share;
                    used = round2(used + share);
                }
            });
        }
        return next;
    }

    /** Fija el % de una bolsita, reparte el resto entre las otras y rebalancea montos actuales. */
    function setBucketPercent(key, pct) {
        const state = readAllocState();
        const next = previewPercentsForKey(key, pct, state.percents);
        const total = round2(ALLOC_BUCKETS.reduce((s, b) => s + (state.buckets[b.key] || 0), 0));
        const buckets = total > 0 ? splitByPercents(total, next) : { ...state.buckets };
        writeAllocState({ percents: next, buckets });
        return { percents: next, buckets, total };
    }


    function splitByPercents(amount, percents) {
        const amt = round2(amount);
        const pct = normalizePercents(percents);
        const splits = emptyAllocBuckets();
        if (amt <= 0) return splits;
        let used = 0;
        ALLOC_BUCKETS.forEach(({ key }, i) => {
            if (i === ALLOC_BUCKETS.length - 1) {
                splits[key] = round2(amt - used);
            } else {
                splits[key] = round2(amt * (pct[key] / 100));
                used = round2(used + splits[key]);
            }
        });
        return splits;
    }

    function addSplits(buckets, splits, sign = 1) {
        const next = { ...emptyAllocBuckets(), ...buckets };
        ALLOC_BUCKETS.forEach(({ key }) => {
            next[key] = Math.max(0, round2((next[key] || 0) + sign * (splits[key] || 0)));
        });
        return next;
    }

    function readAllocState() {
        const mp = allocMpKey();
        const store = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        const raw = store[mp] && typeof store[mp] === 'object' ? store[mp] : {};
        const buckets = emptyAllocBuckets();
        const src = migrateLegacyAllocMaps(raw.buckets && typeof raw.buckets === 'object' ? raw.buckets : {});
        ALLOC_BUCKETS.forEach(({ key }) => {
            const n = Number(src[key]);
            buckets[key] = Number.isFinite(n) && n > 0 ? round2(n) : 0;
        });
        const injections = Array.isArray(raw.injections) ? raw.injections : [];
        const ledger = (Array.isArray(raw.ledger) ? raw.ledger : []).map(migrateLedgerEntry);
        const injected = Number.isFinite(Number(raw.injected))
            ? round2(raw.injected)
            : round2(injections.reduce((s, x) => s + (Number(x.amount) || 0), 0));
        const liberated = Number.isFinite(Number(raw.liberated))
            ? round2(raw.liberated)
            : round2(ledger.filter(x => x.type === 'sale').reduce((s, x) => s + (Number(x.amount) || 0), 0));
        return {
            mp,
            percents: normalizePercents(raw.percents),
            buckets,
            injected,
            liberated,
            injections,
            ledger,
        };
    }

    function allocHasLegacyKeys(raw) {
        if (!raw || typeof raw !== 'object') return false;
        const maps = [raw.buckets, raw.percents];
        if (maps.some(m => m && (m.fondo != null || m.retiro != null))) return true;
        return (Array.isArray(raw.ledger) ? raw.ledger : []).some(e =>
            e?.splits?.fondo != null || e?.splits?.retiro != null
            || e?.meta?.bucket === 'fondo' || e?.meta?.bucket === 'retiro'
        );
    }

    /** Persiste migración de claves viejas en meli y amazon. */
    function persistAllocMigrations() {
        const prev = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        let changed = false;
        const nextStore = { ...prev };
        ['meli', 'amazon'].forEach(mp => {
            const raw = prev[mp];
            if (!allocHasLegacyKeys(raw)) return;
            // Lee estado migrado sin pisar el marketplace activo del State
            const buckets = emptyAllocBuckets();
            const src = migrateLegacyAllocMaps(raw.buckets && typeof raw.buckets === 'object' ? raw.buckets : {});
            ALLOC_BUCKETS.forEach(({ key }) => {
                const n = Number(src[key]);
                buckets[key] = Number.isFinite(n) && n > 0 ? round2(n) : 0;
            });
            nextStore[mp] = {
                ...raw,
                percents: normalizePercents(raw.percents),
                buckets,
                injected: round2(Number(raw.injected) || 0),
                liberated: round2(Number(raw.liberated) || 0),
                // Injections/ledger reconstruyen bolsitas: no truncar (borra dinero)
                injections: Array.isArray(raw.injections) ? raw.injections : [],
                ledger: (Array.isArray(raw.ledger) ? raw.ledger : []).map(migrateLedgerEntry),
            };
            changed = true;
        });
        if (!changed) return;
        window.State.ui = { ...window.State.ui, capitalAlloc: nextStore };
        window.State.saveUI();
    }

    function writeAllocState(next) {
        const mp = allocMpKey();
        const prev = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        const cur = { ...readAllocState(), ...next };
        window.State.ui = {
            ...window.State.ui,
            capitalAlloc: {
                ...prev,
                [mp]: {
                    percents: normalizePercents(cur.percents),
                    buckets: { ...emptyAllocBuckets(), ...migrateLegacyAllocMaps(cur.buckets) },
                    injected: round2(cur.injected),
                    liberated: round2(cur.liberated),
                    injections: Array.isArray(cur.injections) ? cur.injections : [],
                    ledger: Array.isArray(cur.ledger) ? cur.ledger.map(migrateLedgerEntry) : [],
                },
            },
        };
        window.State.saveUI();
    }

    /** Libera a bolsitas con splits explícitos (flujo Caja). */
    function applySaleLiberationWithSplits(amount, splits, meta = {}) {
        const amt = round2(amount);
        if (amt <= 0) return null;
        const state = readAllocState();
        if (meta?.ventaId && state.ledger.some(x => x.type === 'sale' && x.meta?.ventaId === meta.ventaId)) {
            return null;
        }
        const cleaned = emptyAllocBuckets();
        ALLOC_BUCKETS.forEach(({ key }) => {
            const n = Number(splits?.[key]);
            cleaned[key] = Number.isFinite(n) && n > 0 ? round2(n) : 0;
        });
        const entry = {
            id: `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'sale',
            amount: amt,
            at: Date.now(),
            splits: cleaned,
            meta,
        };
        writeAllocState({
            buckets: addSplits(state.buckets, cleaned, 1),
            liberated: round2(state.liberated + amt),
            ledger: [...state.ledger, entry],
        });
        return entry;
    }

    /** Cobrado sin bolsitas (rescate). Pendientes de cobro no entran aquí. */
    function listUnassignedVentas() {
        const state = readAllocState();
        const assigned = new Set(
            state.ledger.filter(x => x.type === 'sale' && x.meta?.ventaId).map(x => x.meta.ventaId),
        );
        const lists = Data.listVentasCobro?.(window.State.lotes, window.State.settings);
        const rows = lists?.porAsignar || [];
        return rows
            .filter(r => r.ventaId && !assigned.has(r.ventaId) && (r.amount || 0) > 0)
            .map(r => ({
                ventaId: r.ventaId,
                loteId: r.loteId,
                fecha: r.fecha,
                producto: r.producto,
                unidades: r.unidades,
                precio: r.precio,
                amount: r.amount,
            }));
    }

    function readRawAlloc(mp) {
        const store = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        const raw = store[mp] && typeof store[mp] === 'object' ? store[mp] : null;
        return raw || null;
    }

    function writeRawAlloc(mp, nextRaw) {
        const prev = window.State.ui?.capitalAlloc && typeof window.State.ui.capitalAlloc === 'object'
            ? window.State.ui.capitalAlloc
            : {};
        window.State.ui = {
            ...window.State.ui,
            capitalAlloc: {
                ...prev,
                [mp]: nextRaw,
            },
        };
        window.State.saveUI();
    }

    function bucketsFromRaw(raw) {
        const buckets = emptyAllocBuckets();
        const src = migrateLegacyAllocMaps(raw?.buckets && typeof raw.buckets === 'object' ? raw.buckets : {});
        ALLOC_BUCKETS.forEach(({ key }) => {
            const n = Number(src[key]);
            buckets[key] = Number.isFinite(n) && n > 0 ? round2(n) : 0;
        });
        return buckets;
    }

    function sumSplits(splits) {
        const s = migrateLegacyAllocMaps(splits || {});
        return round2(ALLOC_BUCKETS.reduce((acc, b) => acc + (Number(s[b.key]) || 0), 0));
    }

    /** Si splits vienen vacíos pero hay monto, reparte con % (evita fantasmas en bolsitas). */
    function resolveSplits(amount, splits, percents) {
        const cleaned = migrateLegacyAllocMaps(splits || {});
        const sum = sumSplits(cleaned);
        const amt = round2(amount);
        if (sum > 0.009) {
            // Si el desglose no cuadra con el monto, escala al monto
            if (amt > 0 && Math.abs(sum - amt) > 0.05) {
                const scale = amt / sum;
                const out = emptyAllocBuckets();
                let used = 0;
                ALLOC_BUCKETS.forEach(({ key }, i) => {
                    if (i === ALLOC_BUCKETS.length - 1) out[key] = round2(amt - used);
                    else {
                        out[key] = round2((Number(cleaned[key]) || 0) * scale);
                        used = round2(used + out[key]);
                    }
                });
                return out;
            }
            return { ...emptyAllocBuckets(), ...cleaned };
        }
        if (amt > 0) return splitByPercents(amt, percents || defaultAllocPercents());
        return emptyAllocBuckets();
    }

    /**
     * Reconstruye buckets + liberated desde el ledger (fuente de verdad).
     * Mata fantasmas: buckets con dinero y liberated $0 sin ventas en ledger.
     */
    function reconcileAllocFromLedger(mp = allocMpKey()) {
        const raw = readRawAlloc(mp);
        if (!raw) return { changed: false, total: 0 };
        const percents = normalizePercents(raw.percents);
        const ledger = Array.isArray(raw.ledger) ? raw.ledger.map(migrateLedgerEntry) : [];
        let buckets = emptyAllocBuckets();
        let liberated = 0;
        ledger.forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            const amt = round2(entry.amount);
            const splits = resolveSplits(amt, entry.splits, percents);
            if (entry.type === 'sale') {
                buckets = addSplits(buckets, splits, 1);
                liberated = round2(liberated + (amt > 0 ? amt : sumSplits(splits)));
            } else if (entry.type === 'manual') {
                buckets = addSplits(buckets, splits, 1);
            } else if (entry.type === 'spend') {
                buckets = addSplits(buckets, splits, -1);
            }
        });
        // Inyecciones históricas (si existían fuera del ledger)
        const injections = Array.isArray(raw.injections) ? raw.injections : [];
        injections.forEach(inj => {
            const amt = round2(inj?.amount);
            if (!(amt > 0)) return;
            const splits = resolveSplits(amt, inj.splits, percents);
            buckets = addSplits(buckets, splits, 1);
        });

        const prevBuckets = bucketsFromRaw(raw);
        const prevLib = round2(Number(raw.liberated) || 0);
        const sameBuckets = ALLOC_BUCKETS.every(({ key }) =>
            round2(prevBuckets[key] || 0) === round2(buckets[key] || 0)
        );
        if (sameBuckets && prevLib === liberated) {
            return {
                changed: false,
                total: round2(ALLOC_BUCKETS.reduce((s, b) => s + (buckets[b.key] || 0), 0)),
            };
        }
        writeRawAlloc(mp, {
            ...raw,
            percents,
            buckets,
            liberated,
            ledger,
            injections,
            injected: round2(Number(raw.injected) || injections.reduce((s, x) => s + (Number(x.amount) || 0), 0)),
        });
        return {
            changed: true,
            total: round2(ALLOC_BUCKETS.reduce((s, b) => s + (buckets[b.key] || 0), 0)),
            liberated,
        };
    }

    /**
     * Quita de bolsitas el dinero de una venta.
     * 1) Busca en ledger por ventaId (string-safe)
     * 2) Si no hay entry, usa fallbackSplits (p.ej. venta.asignacion)
     * 3) Reconcilia buckets desde ledger para no dejar fantasmas
     */
    function reverseSaleLiberation(ventaId, fallbackSplits = null) {
        if (!ventaId && !fallbackSplits) return false;
        const vid = ventaId != null ? String(ventaId) : '';

        const tryMp = (mp) => {
            const raw = readRawAlloc(mp);
            if (!raw || !Array.isArray(raw.ledger)) return null;
            const idx = raw.ledger.findIndex(x =>
                x.type === 'sale' && x.meta?.ventaId != null && String(x.meta.ventaId) === vid
            );
            if (idx < 0) return null;
            return { mp, raw, idx, entry: raw.ledger[idx] };
        };

        const hit = vid
            ? (tryMp(allocMpKey()) || tryMp(allocMpKey() === 'amazon' ? 'meli' : 'amazon'))
            : null;

        if (hit) {
            const { mp, raw, idx } = hit;
            const ledger = raw.ledger.slice();
            ledger.splice(idx, 1);
            writeRawAlloc(mp, { ...raw, ledger });
            reconcileAllocFromLedger(mp);
            return true;
        }

        // Fallback: sin entry en ledger → reconstruir bolsitas (mata fantasmas)
        const mp = allocMpKey();
        const raw = readRawAlloc(mp);
        if (raw && Array.isArray(raw.ledger) && vid) {
            const filtered = raw.ledger.filter(x =>
                !(x.type === 'sale' && x.meta?.ventaId != null && String(x.meta.ventaId) === vid)
            );
            if (filtered.length !== raw.ledger.length) {
                writeRawAlloc(mp, { ...raw, ledger: filtered });
            }
        }
        const before = bucketsFromRaw(raw || {});
        const beforeTotal = round2(ALLOC_BUCKETS.reduce((s, b) => s + (before[b.key] || 0), 0));
        const rec = reconcileAllocFromLedger(mp);
        const afterTotal = rec.total || 0;
        // Si había asignacion de respaldo y el fantasma sigue (ledger vacío no bastó), resta splits
        const fallbackAmt = sumSplits(fallbackSplits);
        if (fallbackAmt > 0 && afterTotal >= beforeTotal - 0.02) {
            const cur = readRawAlloc(mp) || raw;
            const splits = resolveSplits(fallbackAmt, fallbackSplits, normalizePercents(cur?.percents));
            writeRawAlloc(mp, {
                ...cur,
                buckets: addSplits(bucketsFromRaw(cur), splits, -1),
                liberated: Math.max(0, round2((Number(cur?.liberated) || 0) - fallbackAmt)),
            });
            return true;
        }
        return !!(rec.changed || fallbackAmt > 0 || beforeTotal > afterTotal);
    }

    /**
     * Limpia entradas de ledger cuya venta ya no existe y reconcilia bolsitas.
     * mpLotes: { meli: lote[], amazon: lote[] } — si omites, solo limpia el MP activo.
     */
    function purgeOrphanSaleLiberations(mpLotes = null) {
        const targets = mpLotes && typeof mpLotes === 'object'
            ? mpLotes
            : { [allocMpKey()]: window.State.lotes };
        let n = 0;
        let total = 0;
        Object.keys(targets).forEach(mp => {
            const lotes = targets[mp];
            const alive = new Set();
            (lotes || []).forEach(l => (l.ventas || []).forEach(v => {
                if (v?.id) alive.add(String(v.id));
            }));
            const raw = readRawAlloc(mp);
            if (!raw) {
                return;
            }
            const ledger = Array.isArray(raw.ledger) ? raw.ledger : [];
            const keep = [];
            let localN = 0;
            ledger.forEach(entry => {
                if (entry?.type !== 'sale' || entry.meta?.ventaId == null) {
                    keep.push(entry);
                    return;
                }
                if (alive.has(String(entry.meta.ventaId))) {
                    keep.push(entry);
                    return;
                }
                localN += 1;
                total = round2(total + (Number(entry.amount) || sumSplits(entry.splits)));
            });
            if (localN > 0) {
                writeRawAlloc(mp, { ...raw, ledger: keep });
                n += localN;
            }
            // Siempre reconcilia: arregla fantasmas (buckets>0, liberated 0, sin sales)
            reconcileAllocFromLedger(mp);
        });
        return { n, total };
    }

    function spendFromBucket(key, amount, note = '') {
        if (!ALLOC_BUCKETS.some(b => b.key === key)) return null;
        const amt = round2(amount);
        if (!(amt > 0)) return null;
        const state = readAllocState();
        const available = round2(state.buckets[key] || 0);
        if (available <= 0) return null;
        const spent = Math.min(amt, available);
        const nextBuckets = { ...state.buckets, [key]: round2(available - spent) };
        const splits = emptyAllocBuckets();
        splits[key] = spent;
        const entry = {
            id: `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'spend',
            amount: spent,
            at: Date.now(),
            splits,
            meta: {
                bucket: key,
                note: String(note || '').trim(),
                remaining: nextBuckets[key],
            },
        };
        writeAllocState({
            buckets: nextBuckets,
            ledger: [...state.ledger, entry],
        });
        return { entry, remaining: nextBuckets[key], spent, available };
    }

    /** Deshace un uso (spend): lo saca del ledger y reconstruye bolsitas. */
    function reverseSpend(entryId) {
        if (!entryId) return false;
        const mp = allocMpKey();
        const raw = readRawAlloc(mp);
        if (!raw || !Array.isArray(raw.ledger)) return false;
        const idx = raw.ledger.findIndex(x => x.type === 'spend' && String(x.id) === String(entryId));
        if (idx < 0) return false;
        const ledger = raw.ledger.slice();
        ledger.splice(idx, 1);
        writeRawAlloc(mp, { ...raw, ledger });
        reconcileAllocFromLedger(mp);
        return true;
    }


    return {
        ALLOC_BUCKETS,
        round2,
        allocMpKey,
        emptyAllocBuckets,
        defaultAllocPercents,
        normalizePercents,
        previewPercentsForKey,
        setBucketPercent,
        splitByPercents,
        addSplits,
        readAllocState,
        writeAllocState,
        persistAllocMigrations,
        applySaleLiberationWithSplits,
        reverseSaleLiberation,
        purgeOrphanSaleLiberations,
        reconcileAllocFromLedger,
        spendFromBucket,
        reverseSpend,
        listUnassignedVentas,
        readRawAlloc,
        writeRawAlloc,
        migrateLegacyAllocMaps,
        migrateLedgerEntry,
    };
})();
window.Alloc = Alloc;
