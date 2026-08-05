# Ventas Meli — Gestor de lotes y rentabilidad

Aplicación web local (PWA instalable) para gestionar operaciones de venta en Mercado Libre y Amazon.

Espeja y automatiza tu Excel `Negocio.xlsx` (pestañas `Lotes_Operaciones` + `Resumen_General`) y le añade capacidades que Excel no tiene:

- **Captura de lotes** con SKU, costo, precio, unidades, envío, tipo de publicación, **categoría**.
- **Cálculo automático** de comisión Meli, cargo fijo, retenciones IVA/ISR SAT, utilidad neta, margen y ROI.
- **Semáforo automático** de decisión (🟢 Escalar / 🟡 Mantener / 🔴 Liquidar / 🔵 Agotado) según utilidad neta y stock.
- **Tope máximo de CPA** (Ads) calculado como % de la utilidad para productos "Escalar".
- **Registro de ventas individuales** con precio real por evento (no solo un contador).
- **Historial (audit log)** de cambios y ventas por lote.
- **Insights**: Matriz (margen×rotación), Comprar / no comprar, Estancados y Precios vs competencia. Badge de alertas en campana.
- **Command palette** (⌘K / Ctrl+K) para navegar y ejecutar acciones al vuelo.
- **Productos** tipo Inbox + Split con detalle en tabs (Rentabilidad · Inventario · Recomendación · Historial).
- **Split redimensionable** con drag persistente en localStorage.
- **Edición inline** de precio y stock (click en el número).
- **Dashboard**: Progreso mensual/anual, P&G, Caja, Portafolio y Ranking + consola **General** (Meli + Amazon).
- **Import / Export a Excel** (respeta formato original, exporta ventas también).
- **Respaldo JSON** local + sync opcional con Supabase (Mac ↔ iPhone).
- **Modales propios** en vez de `confirm()` nativos.

## Cómo usar

1. Abre la app con el servidor local (recomendado, necesario para Keepa):

```bash
python3 serve.py
# → http://127.0.0.1:8877/
```

   Sin Keepa también sirve `python3 -m http.server 8080` o abrir `index.html` directo.
2. La primera vez viene precargada con los 9 productos de tu Excel.
3. Para importar tu Excel: botón **Importar Excel** → selecciona `Negocio.xlsx` (wizard).
4. Para llevártelo al Excel de siempre: botón **Exportar Excel**.

### Keepa (Amazon MX)

La extensión Premium de Keepa **no incluye** la Data API. Necesitas la key en [keepa.com/#!api](https://keepa.com/#!api).

1. Corre `python3 serve.py` (proxy CORS en `/api/keepa/*`).
2. En la app: modo **Amazon** → **Ajustes** → pega la API key → **Probar conexión**.
3. Abre **Keepa Lab** para investigar un ASIN con gráfica, precio, BSR, ventas/mes, Buy Box y ofertas.
4. La misma pestaña incluye Product Finder, búsqueda de Deals y consulta de vendedores con avisos de consumo antes de las operaciones costosas.

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
| Cargo fijo | Aplica si Precio < $299 (default ≈ $35; ajustable) |
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
├── index.html              layout + tabs + modal
├── manifest.json           PWA manifest
├── sw.js                   Service worker (network-first + cache offline)
├── css/styles.css          Temas Meli / Amazon / General
├── js/
│   ├── calc.js             Motor de cálculo
│   ├── data.js             Modelo + persistencia + historial
│   ├── excel.js            Import/Export SheetJS
│   ├── ui.js               Modales, dialogs, prompt, toast
│   ├── palette.js          Command palette ⌘K
│   ├── insights.js         Reglas de negocio + alertas
│   ├── envios.js           Prep. envíos Amazon
│   ├── lotes.js            Vista productos
│   ├── dashboard.js        Inicio + consola General
│   ├── sync.js             Sync Supabase
│   ├── settings.js         Ajustes de cálculo + Sync
│   └── app.js              Bootstrap + navegación + PWA
├── supabase/
│   └── schema.sql          Tabla Sync (`ventas_meli_state`)
└── README.md
```

## Datos y respaldo

Todo se guarda en `localStorage`. Para llevártelo a otro equipo:

- **Respaldo JSON** — botón Respaldo → elige exportar / importar.
- **Excel** — botón Exportar Excel (compatible con `Negocio.xlsx` + hoja Ventas).
- **Sync Supabase** — Ajustes → pega URL + anon key → ejecuta `supabase/schema.sql` → mismo login en Mac e iPhone.

## Roadmap

- Import local de pedidos ML (CSV/Excel) con match por SKU.
- Amazon SP-API.
- Alertas de recompra por velocidad de venta.
- Exportación PDF de fichas por SKU para proveedores.
- Punto de reorden calculado según lead time.
