# Ventas Meli — Gestor de lotes y rentabilidad

Aplicación web local (PWA instalable) para gestionar tus operaciones de venta en Mercado Libre.

Espeja y automatiza tu Excel `Negocio.xlsx` (pestañas `Lotes_Operaciones` + `Resumen_General`) y le añade capacidades que Excel no tiene:

- **Captura de lotes** con SKU, costo, precio, unidades, envío, tipo de publicación, **categoría**.
- **Cálculo automático** de comisión Meli, cargo fijo, retenciones IVA/ISR SAT, utilidad neta, margen y ROI.
- **Semáforo automático** de decisión (🟢 Escalar / 🟡 Mantener / 🔴 Liquidar / 🔵 Agotado) según utilidad neta y stock.
- **Tope máximo de CPA** (Ads) calculado como % de la utilidad para productos "Escalar".
- **Registro de ventas individuales** con precio real por evento (no solo un contador).
- **Historial (audit log)** de cambios y ventas por lote.
- **Insights automáticos**: reglas de negocio que detectan stock crítico, precios altos vs competencia, productos estancados, oportunidades premium.
- **Command palette** (⌘K / Ctrl+K) para navegar y ejecutar acciones al vuelo.
- **Vista principal** tipo Inbox + Split con **detalle organizado en tabs** (Rentabilidad · Inventario · Recomendación · Historial).
- **Split redimensionable** con drag persistente en localStorage.
- **Edición inline** de precio y stock (click en el número).
- **Dashboard consolidado**: Capital Desplegado, Cash In, Ganancia Realizada, Valor Inventario, rotación por SKU con barras.
- **Import / Export a Excel** (respeta formato original, exporta ventas también).
- **Respaldo JSON** local.
- **Dark mode** con toggle.
- **Modales propios** en vez de `confirm()` nativos.

## Cómo usar

1. Abre `index.html` en Chrome, Safari o Firefox — no requiere servidor.
2. La primera vez viene precargada con los 9 productos de tu Excel.
3. Para importar tu Excel: botón **Importar Excel** → selecciona `Negocio.xlsx` (wizard).
4. Para llevártelo al Excel de siempre: botón **Exportar Excel**.

Si algún navegador bloquea archivos locales:

```bash
python3 -m http.server 8080
# abre http://localhost:8080
```

También puedes **instalarla como PWA** (Chrome: menú → Instalar Ventas Meli).

## Atajos de teclado

### Globales
| Tecla | Acción |
|-------|--------|
| `⌘K` / `Ctrl+K` | Abrir command palette |
| `Esc` | Cerrar modal / palette |

### Vista Productos
| Tecla | Acción |
|-------|--------|
| `↑` / `↓` o `j` / `k` | Navegar entre productos |
| `E` | Editar producto seleccionado |
| `D` | Duplicar variante |
| `N` | Crear nuevo lote |
| `S` | Registrar venta del producto seleccionado |

## Reglas de cálculo (configurables en Ajustes)

| Concepto | Fórmula |
|---|---|
| Comisión Meli | Precio × % (Clásica 15%, Premium 20%) |
| Cargo fijo | Aplica si Precio < $299 (default $0) |
| Retención IVA | (Precio ÷ 1.16) × 8% |
| Retención ISR | (Precio ÷ 1.16) × 2.5% (sin RFC) o 1% (RESICO con RFC) |
| Utilidad neta | Precio − Costo − Comisión − Cargo fijo − Envío − IVA − ISR |
| Margen | Utilidad ÷ Precio |
| ROI | Utilidad ÷ Costo |

### Semáforo de viabilidad

| Estado | Condición |
|---|---|
| 🔵 Agotado | `inventarioRestante === 0 && vendidas > 0` |
| 🔴 Liquidar | Utilidad neta < $50 MXN |
| 🟡 Mantener | $50 ≤ Utilidad neta < $80 |
| 🟢 Escalar | Utilidad neta ≥ $80 |

**Tope CPA (Ads)** = Utilidad × 40% (solo si Escalar).

### Reglas de Insights (automáticas)

- **Alta**: Escalar con stock ≤ 2 · Liquidar con stock ≥ 3
- **Media**: Producto sin ventas por 30+ días · Precio > +15% vs competencia
- **Baja**: Escalar con margen > 30% · Producto Agotado

## Estructura

```
ventas-meli/
├── index.html              layout + tabs + modal + palette host
├── manifest.json           PWA manifest
├── sw.js                   Service worker (cache-first)
├── css/styles.css          Estilos (light + dark)
├── js/
│   ├── calc.js             Motor de cálculo + recomendaciones dinámicas
│   ├── data.js             Modelo + persistencia + historial
│   ├── excel.js            Import/Export SheetJS
│   ├── ui.js               Modales, dialogs, prompt, toast
│   ├── palette.js          Command palette ⌘K
│   ├── insights.js         Reglas de negocio + alertas
│   ├── lotes.js            Vista Productos (Inbox Split)
│   ├── dashboard.js        KPIs + rotación + top + alertas
│   ├── settings.js         Ajustes de cálculo
│   └── app.js              Bootstrap + navegación + dark mode + PWA
└── README.md
```

## Datos y respaldo

Todo se guarda en `localStorage`. Para llevártelo a otro equipo:

- **Respaldo JSON** — botón Respaldo → elige exportar / importar.
- **Excel** — botón Exportar Excel (compatible con `Negocio.xlsx` + hoja Ventas).

## Roadmap

- Integración API Mercado Libre (traer pedidos y comisiones reales).
- Multi-canal (Amazon, Shopify).
- Alertas de recompra por velocidad de venta.
- Exportación PDF de fichas por SKU para proveedores.
- Punto de reorden calculado según lead time.
