# Stocki

Marketplace estilo MercadoLibre Colombia: cualquiera puede comprar —con cuenta o **como invitado, sin registrarse**— y, si lo desea, activar su perfil de **vendedor** para publicar productos propios o importados desde **Dropi** (dropshipping). Pagos con **Bold** y **MercadoPago**.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS3 (BEM, variables), JavaScript vanilla ES6+ (módulos, sin build) |
| Backend / BD | Supabase: PostgreSQL + RLS, Auth, Storage, Edge Functions (Deno/TypeScript) |
| Pagos | Bold y MercadoPago (Checkout Pro), vía Edge Functions + webhooks |
| Dropshipping | Adaptador Dropi (mock hasta conectar la API real) |
| Hosting | GitHub Pages (estático) + dominio propio en Hostinger |

**Principio de seguridad:** el repositorio es público y GitHub Pages solo sirve estáticos. La `publishable key` de Supabase es pública por diseño; **todos los secretos** (Bold, MercadoPago, Dropi, secret key) viven exclusivamente como variables de entorno de las Edge Functions. El frontend jamás decide si un pago fue aprobado: eso lo hacen los webhooks en el servidor.

## Estructura

```
├── index.html            Home (banner + grid de productos)
├── search.html           Búsqueda y filtros
├── product.html          Detalle de producto
├── cart.html             Carrito (localStorage + sync Supabase)
├── checkout.html         Dirección + selección de pasarela (con cuenta o invitado)
├── order-confirmation.html  Estado del pago (fuente de verdad: webhook)
├── auth.html             Login / registro
├── account.html          Perfil, mis compras, activar vendedor
├── seller.html           Panel vendedor (CRUD, Dropi, ventas)
├── admin.html            Panel admin (usuarios, categorías, productos, órdenes)
├── css/
│   ├── variables.css     Paleta e identidad (única fuente de colores)
│   ├── base.css          Reset y tipografía
│   ├── components.css    Componentes compartidos (BEM)
│   └── pages/            Estilos por página
├── js/
│   ├── supabaseClient.js Configuración única de Supabase
│   ├── api/              Acceso a datos (Supabase + Edge Functions)
│   ├── ui/               Renderizado del DOM (layout, toasts, modales…)
│   ├── pages/            Controlador de cada página (orquesta api + ui)
│   └── utils/            Helpers (formato COP, DOM)
└── supabase/
    ├── schema.sql        Esquema completo: tablas, RLS, Storage, seed
    ├── config.toml       Config CLI (funciones públicas: webhooks y payments-create)
    ├── .env.example      Plantilla de secretos de Edge Functions
    └── functions/
        ├── _shared/      cors, cliente admin, adaptadores (pagos, dropi)
        ├── payments-create/        Inicia pago (firma Bold / preferencia MP)
        ├── payments-webhook-bold/  Confirma/rechaza pagos Bold
        ├── payments-webhook-mp/    Confirma/rechaza pagos MercadoPago
        ├── dropi-products/         Catálogo Dropi para importar
        ├── dropi-import/           Importa producto con margen del vendedor
        └── dropi-sync/             Sincroniza stock/costos desde Dropi
```

## Desarrollo local

Los módulos ES no funcionan abriendo el archivo con doble clic (`file://`): sirve la carpeta por HTTP.

```bash
# Opción 1 (Python)
python -m http.server 5500

# Opción 2 (Node)
npx serve .
```

Abre `http://localhost:5500`. Necesitas haber ejecutado `supabase/schema.sql` en el editor SQL de tu proyecto Supabase para ver datos.

## Puesta en marcha completa

Los pasos detallados (SQL, secretos, deploy de funciones, GitHub Pages, DNS de Hostinger y registro de webhooks en Bold/MercadoPago) están en la **Lista de requisitos** entregada junto con este proyecto. Resumen:

1. Ejecutar `supabase/schema.sql` en el editor SQL de Supabase.
2. Registrarte en la web y auto-promoverte a admin (bloque final del schema.sql).
3. `supabase secrets set --env-file supabase/.env` (a partir de `.env.example`).
4. `supabase functions deploy` (los webhooks y `payments-create` ya van con `verify_jwt=false`).
5. Activar GitHub Pages sobre la rama `main` y configurar el dominio.
6. Registrar las URLs de los webhooks en los paneles de Bold y MercadoPago.

## Compra sin cuenta (invitado)

El checkout no exige sesión. Sin cuenta, el flujo es:

1. `create_guest_order()` (función SQL `SECURITY DEFINER`) crea la orden con `buyer_id = NULL`. Valida en el servidor productos, stock y datos de envío, y calcula precios y total desde `products`: del navegador solo acepta qué producto y cuántas unidades.
2. Devuelve un **token secreto** que solo conoce el comprador: en la base queda únicamente su hash SHA-256 (`orders.guest_token_hash`), así que ni un vendedor ni un admin que lea la fila pueden usarlo.
3. Con ese token el invitado consulta su orden (`get_guest_order()`) y la paga (`payments-create` lo acepta en lugar de la sesión). El enlace de su orden es `order-confirmation.html?order=…&token=…`; como no hay cuenta ni «Mis compras», ese enlace es su único acceso y la página le pide guardarlo.

Las órdenes con cuenta no cambian: siguen protegidas por RLS y por la sesión de su dueño, y el token de invitado nunca las abre.

Si la base aún no tiene estas funciones (schema.sql sin re-ejecutar), el checkout lo detecta y pide iniciar sesión como antes: publicar el frontend primero no rompe nada.

## Estado de integraciones

- **Bold / MercadoPago:** implementados con placeholders de credenciales; cobro a cuenta receptora única. La arquitectura (patrón adaptador + tabla `seller_payment_accounts`) ya está prevista para el cobro independiente por vendedor.
- **Dropi:** adaptador con implementación simulada (`// TODO: conectar API real de Dropi`); se reemplaza en un solo punto (`supabase/functions/_shared/dropi/`) al recibir token y documentación.
