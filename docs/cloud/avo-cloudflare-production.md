# Publicar Avo en Cloudflare Free

El Worker se llama `avo` y sirve `https://avo.frutit.app`. Los comandos se ejecutan desde la raíz de la rama de migración, con Node 26 y npm 11.20.0. GitHub ejecuta las comprobaciones de la app.

## Preparar la copia privada

Usa el último respaldo de producción que puedas confirmar. Si hubo escrituras posteriores a la copia y vuelve a haber acceso a Neon, pausa el uso de ambas cuentas en el sitio anterior y toma un `pg_dump --format=custom` nuevo antes de convertirlo. Los cambios que todavía estén en IndexedDB se conservan en el navegador original mientras siga usando el mismo dominio.

```sh
npm ci --ignore-scripts
node scripts/d1-recovery.mjs prepare /ruta/privada/avo-production.dump
```

La conversión usa Docker/OrbStack con la imagen `postgres:19`. Restaura el respaldo en un contenedor sin red y genera `restore.sql` y `manifest.json` junto al archivo original, en una carpeta privada. Conserva el dump original y la carpeta de recuperación fuera del repositorio. El SQL tiene datos de cuenta. El manifiesto registra conteos y huellas de las tablas admitidas, incluidos los vínculos de identidad y los recibos de sincronización. Las sesiones y tokens de proveedores quedan fuera de la importación y ambos usuarios deberán iniciar sesión de nuevo.

## Restaurar en D1 antes del corte

En la cuenta de Cloudflare que administra `frutit.app`, confirma el plan gratuito, crea una D1 nueva llamada `avo` y copia el ID de la cuenta y el ID de la base. Autentica Wrangler en esa cuenta. Sustituye los valores de ejemplo y la carpeta privada por los reales.

```sh
node scripts/prepare-cloudflare-production.mjs "$ACCOUNT_ID" "$D1_ID"
CFG=wrangler.production.jsonc
RECOVERY=/ruta/privada/avo-d1-recovery-xxxxxx
WRANGLER=./node_modules/.bin/wrangler

"$WRANGLER" d1 migrations apply DB --config "$CFG" --remote &&
node scripts/d1-recovery.mjs empty "$RECOVERY/manifest.json" DB "$CFG" --remote &&
"$WRANGLER" d1 execute DB --config "$CFG" --remote --file "$RECOVERY/restore.sql" &&
node scripts/d1-recovery.mjs verify "$RECOVERY/manifest.json" DB "$CFG" --remote
```

Continúa cuando la verificación confirme que las huellas, los conteos y las referencias coinciden. Si falla una importación, verifica antes de reintentar. Si el destino quedó parcial, aparta esa base y usa otra nueva con su propio ID. Conserva ambas hasta identificar el problema.

## Publicar en el dominio existente

Prepara un JSON privado fuera del repositorio con `BETTER_AUTH_SECRET` y `AVO_HMAC_SECRET` con valores aleatorios distintos de al menos 32 caracteres. Incluye `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` y/o `FACEBOOK_CLIENT_ID` y `FACEBOOK_CLIENT_SECRET`, según cómo iniciaron sesión las dos cuentas. Conserva los clientes OAuth existentes para mantener los vínculos. Confirma sus callbacks en `https://avo.frutit.app/api/auth/callback/google` y `https://avo.frutit.app/api/auth/callback/facebook`.

Compila con la configuración generada y empaqueta sin publicar:

```sh
VITE_SITE_URL=https://avo.frutit.app CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH="$CFG" npm run build &&
"$WRANGLER" deploy --config build/server/wrangler.json --dry-run
```

En Cloudflare guarda el valor del registro DNS anterior de `avo.frutit.app` para poder restablecerlo. Si hay un CNAME de Vercel, quítalo al momento del corte para que Workers pueda crear el dominio personalizado. Ejecuta el despliegue con el mismo build:

```sh
SECRETS=/ruta/privada/avo-worker-secrets.json
"$WRANGLER" deploy --config build/server/wrangler.json --secrets-file "$SECRETS"
```

Abre `https://avo.frutit.app`, inicia sesión con las cuentas existentes y revisa un dato conocido en cada cuenta. Si hay un fallo antes de la primera escritura en D1, recupera el DNS anterior si el servicio viejo sigue operativo. Si D1 ya recibió escrituras, conserva esa base y corrige el Worker para no perderlas. El respaldo original sigue disponible para recuperación.
