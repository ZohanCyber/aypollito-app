# Ay Pollito — App de pedidos (PWA)

App para el personal: tomar pedidos, ver pedidos en curso, historial de ventas con exportación a PDF/Excel, y edición de precios. Funciona en Android como app instalada (sin Play Store), sigue funcionando sin internet y sincroniza con Supabase cuando hay conexión.

Sin paso de compilación: son archivos estáticos. Costo: $0 (Supabase free tier + Cloudflare Pages free).

## Estructura

```
index.html            pantalla única
app.js                lógica (PIN, pedidos, historial, precios, sincronización, exportación)
styles.css            estilos (colores del logo: azul #0B3A6E, rojo #D7262C, amarillo #FFB000)
config.js             URL y anon key de Supabase  ← lo único que debes editar
sw.js                 service worker (modo sin conexión)
manifest.webmanifest  datos de instalación en Android
icons/                íconos (reemplázalos por el logo real, mismos nombres y tamaños)
supabase/schema.sql   tablas, seguridad y menú inicial
```

## Puesta en marcha (unos 20 minutos)

### 1. Base de datos — Supabase (gratis)
1. Crea una cuenta en https://supabase.com y un proyecto nuevo (región: la más cercana, p. ej. *East US*). Guarda la contraseña de la base de datos.
2. En el menú **SQL Editor → New query**, pega el contenido de `supabase/schema.sql` y pulsa **Run**. Crea las tablas, las reglas de seguridad y el menú inicial.
3. En **Authentication → Users → Add user → Create new user**: crea la cuenta del negocio (p. ej. `pedidos@aypollito.mx` y una contraseña larga). Marca *Auto Confirm User*. Esta cuenta es la que se usa una sola vez al configurar cada teléfono; el personal no la ve.
4. En **Authentication → Providers → Email** desactiva *Allow new users to sign up* (nadie más puede crear cuentas).
5. En **Project Settings → API** copia **Project URL** y **anon public key** y pégalos en `config.js`.

### 2. Publicar la app — Cloudflare Pages (gratis)
1. Sube la carpeta a un repositorio de GitHub (puede ser privado).
2. En https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**, elige el repositorio.
   Build command: *(vacío)* · Build output directory: `/` · Guarda y despliega.
3. Obtienes una URL `https://<nombre>.pages.dev` con HTTPS. Cada `git push` vuelve a publicar en un minuto.
   (Netlify, Vercel o GitHub Pages funcionan igual: sitio estático, sin build.)

### 3. Instalar en el teléfono Android
1. Abre la URL en **Chrome**. Menú ⋮ → **Instalar aplicación** / **Agregar a pantalla de inicio**.
2. Abre la app desde el ícono. La primera vez pide el **correo y contraseña de la cuenta del negocio** (paso 1.3). Se hace una sola vez por teléfono.
3. Después pide **crear el PIN de 4 números** del personal. Listo.

A partir de ahí la app abre con el PIN. "Cerrar sesión" vuelve a pedirlo. El PIN se cambia en la pestaña **Precios** (abajo).

## Cómo funciona por dentro
- **Seguridad**: la barrera real es la sesión de Supabase (cuenta del negocio) + reglas RLS: sólo usuarios autenticados leen o escriben. El PIN es un bloqueo de pantalla para el personal; se guarda hasheado (SHA-256 con sal) y nunca en texto plano. La *anon key* es pública por diseño y no da acceso sin sesión.
- **Sin conexión**: la app guarda una copia local (productos, pedidos abiertos, 90 días de historial). Los cambios hechos sin internet quedan en cola y se envían solos al volver la señal (pastilla "Sin conexión" en la cabecera). Dos teléfonos pueden usarse a la vez; los números de pedido se reasignan si chocan.
- **Historial**: filtros Hoy / 7 días / Mes / Todo; totales, pedidos, para llevar vs domicilio.
- **Exportar**: PDF (tabla con totales) y Excel con tres hojas: *Pedidos*, *Por día* y *Productos* (cuánto se vendió de cada cosa). Se descargan al teléfono y se pueden compartir por WhatsApp.
- **Precios**: −5 / +5 o escribir; Disponible/Agotado; agregar o quitar productos; todo se refleja en los demás teléfonos en menos de un minuto.
- Pedidos cancelados se conservan en la base de datos con estado `cancelado` (no aparecen en ventas).

## Mantenimiento
- Cambiar nombre, dirección o teléfono: `config.js`.
- Cambiar el logo: reemplaza los tres PNG de `icons/` (192×192, 512×512 y 512×512 "maskable" con margen).
- Reportes más completos: en Supabase → **Table Editor** puedes ver y exportar `orders` y `order_items` en CSV en cualquier momento.
- Respaldo: Supabase hace copias diarias en el plan gratuito (7 días). Además, exporta el Excel "Todo" de vez en cuando.
- Supabase pausa proyectos gratuitos tras 7 días sin actividad; con uso diario no pasa. Si pasa, se reactiva con un clic en el panel.

## Probar en la computadora
Cualquier servidor estático sirve, por ejemplo `python3 -m http.server 8080` dentro de la carpeta y abrir http://localhost:8080.
