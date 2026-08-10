/* ==========================================================================
   Flete inbound a FBA — ledger de cargos/pagos (cuenta por pagar).
   No toca P&G salvo allocateChargeToLoteCost (opcional → costo/ud).
   ========================================================================== */

const Freight = (() => {

    function round2(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) return NaN;
        return Math.round(x * 100) / 100;
    }

    function parseMoney(raw) {
        if (typeof raw === 'number') return raw;
        let s = String(raw ?? '').trim().replace(/\$/g, '').replace(/\s/g, '');
        if (!s) return NaN;
        if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
        else if (s.includes(',')) s = s.replace(',', '.');
        return Number(s);
    }

    function newFreightId() {
        return `fif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    function normalizeEntry(e) {
        if (!e || (e.type !== 'charge' && e.type !== 'payment')) return null;
        const amount = round2(Math.max(0, Number(e.amount) || 0));
        if (!Number.isFinite(amount) || amount <= 0) return null;
        return {
            id: String(e.id || newFreightId()),
            type: e.type,
            amount,
            at: Number(e.at) || Date.now(),
            note: String(e.note || '').trim(),
            loteId: e.loteId ? String(e.loteId) : null,
            allocatedCost: !!e.allocatedCost,
            meta: e.meta && typeof e.meta === 'object' ? { ...e.meta } : undefined,
        };
    }

    function cleanLedger(ledger) {
        return (Array.isArray(ledger) ? ledger : [])
            .map(normalizeEntry)
            .filter(Boolean);
    }

    function readFreight() {
        const raw = window.State.ui?.fbaInboundFreight;
        const ledger = Array.isArray(raw?.ledger) ? raw.ledger : [];
        let dirty = false;
        const cleaned = ledger
            .map(e => {
                const hadId = !!e?.id;
                const next = normalizeEntry(e);
                if (!hadId && next) dirty = true;
                if (!next && e) dirty = true;
                return next;
            })
            .filter(Boolean);
        if (dirty || cleaned.length !== ledger.length) writeFreight(cleaned);
        return { ledger: cleaned };
    }

    function writeFreight(ledger) {
        window.State.ui = {
            ...(window.State.ui || {}),
            fbaInboundFreight: { ledger: cleanLedger(ledger) },
        };
        window.State.saveUI();
    }

    function freightTotals(state = readFreight()) {
        let charges = 0;
        let payments = 0;
        state.ledger.forEach(e => {
            if (e.type === 'charge') charges += e.amount;
            else if (e.type === 'payment') payments += e.amount;
        });
        charges = round2(charges);
        payments = round2(payments);
        return {
            charges,
            payments,
            balance: round2(charges - payments),
            balanceDisplay: Math.max(0, round2(charges - payments)),
        };
    }

    function balance() {
        return freightTotals().balance;
    }

    function addCharge({ amount, note = '', loteId = null, allocateCost = false } = {}) {
        const amt = round2(parseMoney(amount));
        if (!Number.isFinite(amt) || amt <= 0) throw new Error('Monto inválido');
        const entry = {
            id: newFreightId(),
            type: 'charge',
            amount: amt,
            at: Date.now(),
            note: String(note || '').trim(),
            loteId: loteId ? String(loteId) : null,
            allocatedCost: false,
        };
        const { ledger } = readFreight();
        writeFreight([entry, ...ledger]);
        if (allocateCost && entry.loteId) {
            try {
                allocateChargeToLoteCost(entry.id);
            } catch (err) {
                // Cargo ya quedó; el costo es opcional
                console.warn('[Freight] allocateCost', err);
            }
        }
        return entry;
    }

    function addPayment({ amount, note = '' } = {}) {
        const amt = round2(parseMoney(amount));
        if (!Number.isFinite(amt) || amt <= 0) throw new Error('Monto inválido');
        const due = freightTotals().balanceDisplay;
        if (amt > due + 0.001) {
            throw new Error(due > 0
                ? `Solo debes ${Calc.fmtMXN(due)}. Ajusta el pago.`
                : 'No hay saldo pendiente por pagar');
        }
        const entry = {
            id: newFreightId(),
            type: 'payment',
            amount: amt,
            at: Date.now(),
            note: String(note || '').trim(),
            loteId: null,
            allocatedCost: false,
        };
        const { ledger } = readFreight();
        writeFreight([entry, ...ledger]);
        return entry;
    }

    function removeEntry(id) {
        const { ledger } = readFreight();
        const next = ledger.filter(e => String(e.id) !== String(id));
        if (next.length === ledger.length) return false;
        writeFreight(next);
        return true;
    }

    /**
     * Reparte un cargo al costo unitario del lote vinculado.
     * perUnit = amount / unidades del lote (mín. 1).
     */
    function allocateChargeToLoteCost(entryId) {
        const { ledger } = readFreight();
        const idx = ledger.findIndex(e => String(e.id) === String(entryId));
        if (idx < 0) throw new Error('Cargo no encontrado');
        const entry = ledger[idx];
        if (entry.type !== 'charge') throw new Error('Solo se reparte un cargo');
        if (entry.allocatedCost) throw new Error('Este cargo ya se repartió al costo');
        if (!entry.loteId) throw new Error('Vincula el cargo a un lote FBA primero');

        const mp = 'amazon';
        const active = window.State.marketplace === 'amazon';
        const lotes = active ? (window.State.lotes || []) : Data.loadLotes(mp);
        const lote = lotes.find(l => String(l.id) === String(entry.loteId));
        if (!lote) throw new Error('Lote no encontrado');

        const uds = Math.max(1, Number(lote.unidades) || 1);
        const perUnit = round2(entry.amount / uds);
        if (!(perUnit > 0)) throw new Error('Monto demasiado pequeño');

        const prevCosto = round2(Number(lote.costo) || 0);
        const nextCosto = round2(prevCosto + perUnit);
        lote.costo = nextCosto;
        lote.historial = [...(lote.historial || []), {
            ts: Date.now(),
            tipo: 'flete-inbound',
            meta: {
                freightId: entry.id,
                amount: entry.amount,
                perUnit,
                prevCosto,
                nextCosto,
                unidades: uds,
            },
        }];

        if (active) {
            window.State.lotes = Data.upsertLote(window.State.lotes, lote);
            window.State.save();
        } else {
            const all = Data.upsertLote(lotes, lote);
            Data.saveLotes(all, mp);
        }

        const nextLedger = ledger.slice();
        nextLedger[idx] = {
            ...entry,
            allocatedCost: true,
            meta: {
                ...(entry.meta || {}),
                perUnit,
                prevCosto,
                nextCosto,
                unidades: uds,
            },
        };
        writeFreight(nextLedger);
        return { perUnit, nextCosto, unidades: uds, lote };
    }

    /** Merge por id: une ledgers local/remoto sin perder movimientos. */
    function mergeLedgers(localLedger, remoteLedger) {
        const map = new Map();
        cleanLedger(localLedger).forEach(e => map.set(e.id, e));
        cleanLedger(remoteLedger).forEach(e => {
            const prev = map.get(e.id);
            if (!prev) {
                map.set(e.id, e);
                return;
            }
            // Preferir la versión más reciente; allocatedCost es sticky (OR)
            const newer = (e.at || 0) >= (prev.at || 0) ? e : prev;
            map.set(e.id, {
                ...newer,
                allocatedCost: !!(prev.allocatedCost || e.allocatedCost),
            });
        });
        return [...map.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
    }

    function mergeFreightState(localUi, remoteUi) {
        const localL = localUi?.fbaInboundFreight?.ledger;
        const remoteL = remoteUi?.fbaInboundFreight?.ledger;
        if (!remoteL && !localL) return localUi;
        const merged = mergeLedgers(localL, remoteL);
        return {
            ...(localUi || {}),
            ...(remoteUi || {}),
            fbaInboundFreight: { ledger: merged },
        };
    }

    return {
        round2,
        parseMoney,
        readFreight,
        writeFreight,
        freightTotals,
        balance,
        addCharge,
        addPayment,
        removeEntry,
        allocateChargeToLoteCost,
        mergeLedgers,
        mergeFreightState,
        cleanLedger,
    };
})();
window.Freight = Freight;
