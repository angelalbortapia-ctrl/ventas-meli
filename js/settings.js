/* ==========================================================================
   Vista Ajustes: umbrales, retenciones, comisiones, tope CPA.
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

    function init() {
        FIELDS.forEach(([id]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', onChange);
        });
        document.getElementById('btn-reset-settings').addEventListener('click', () => window.App && window.App.resetSettings());
        loadIntoForm();
    }

    return { init, loadIntoForm };
})();
