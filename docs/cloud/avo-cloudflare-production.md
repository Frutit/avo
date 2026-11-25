# Publicar Avo en Cloudflare

El Worker `avo` usa la D1 `avo` a través del binding `DB`. La cuenta y el ID de la base ya están en `cloudflare.config.ts`. La D1 de producción ya contiene el respaldo verificado del 24 de noviembre. Para el despliegue normal basta con compilar el Worker y usar esa conexión.

## Conectar GitHub en Workers Builds

En la cuenta de Cloudflare que administra `frutit.app`, elige el repo `Frutit/avo` y configura lo siguiente:

| Campo | Valor |
| --- | --- |
| Project name | `avo` |
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Preview builds | Desactivado |

El build usa `cf build` y empaqueta el service worker. El deploy usa `cf deploy --prebuilt --mode production --no-provision` para publicar ese mismo paquete. El dominio se conecta cuando se habilita el corte. Para preview builds se necesita otra base y una configuración separada.

## Preparar el corte a avo.frutit.app

1. En el Worker, abre **Settings → Variables & Secrets**. Guarda `BETTER_AUTH_SECRET` y `AVO_HMAC_SECRET` como valores aleatorios distintos de al menos 32 caracteres. Agrega los clientes OAuth existentes con `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` y/o `FACEBOOK_CLIENT_ID` y `FACEBOOK_CLIENT_SECRET` según las cuentas. Conserva los callbacks `https://avo.frutit.app/api/auth/callback/google` y `https://avo.frutit.app/api/auth/callback/facebook`.
2. Guarda el destino, el estado del proxy y el TTL del CNAME anterior. Cuando los secretos estén listos, agrega la variable de build `AVO_ENABLE_CUSTOM_DOMAIN=true`. Elimina el CNAME de Vercel de `avo.frutit.app` al momento del corte y lanza un nuevo build y deploy.
3. Abre `https://avo.frutit.app`, inicia sesión con las dos cuentas y verifica un dato conocido de cada una. Si falla el corte antes de que haya nuevas escrituras, puedes quitar el dominio personalizado y recuperar el DNS anterior si el servicio viejo sigue operativo. Si hubo escrituras en D1, conserva esa base.

Para un despliegue manual desde un checkout limpio, autentica `cf` con `npx cf auth login` y usa Node 26 y npm 11.20.0:

```sh
npm ci --ignore-scripts
npm run build
npm run deploy -- --dry-run
npm run deploy
```

El comando manual omite el dominio por defecto. Para el corte, ejecuta `AVO_ENABLE_CUSTOM_DOMAIN=true npm run build` antes de desplegar. Si necesitas cargar secretos con el mismo deploy, pasa `npm run deploy -- --secrets-file /ruta/privada/avo-worker-secrets.json`.

## Recuperar en una D1 nueva si fuera necesario

Desde la raíz del repo, ejecuta el paso de preparación solo si tienes un dump de PostgreSQL y necesitas convertirlo. Usa el último respaldo de producción confirmado. La conversión usa Docker/OrbStack con `postgres:19` y prepara `restore.sql` y `manifest.json` junto al dump. Conserva los archivos fuera de Git. El SQL contiene datos de cuenta; omite los tokens y sesiones anteriores.

```sh
node scripts/d1-recovery.mjs prepare /ruta/privada/avo-production.dump
```

Confirma que `D1_ID` identifica una base nueva, en la cuenta correcta. Con el Worker fuera de servicio durante la recuperación:

```sh
RECOVERY=/ruta/privada/avo-d1-recovery-xxxxxx
npx cf d1 migrations apply "$D1_ID" --dir drizzle-d1 &&
node scripts/d1-recovery.mjs restore "$RECOVERY" "$D1_ID" --remote
```

La restauración comprueba que la base esté vacía e importa por lotes. También compara las huellas y conteos del destino antes de que reciba tráfico. Si falla a mitad de la importación, conserva el destino para diagnóstico y usa una D1 vacía para repetir el proceso. Actualiza el ID del binding `DB` en `cloudflare.config.ts` solo al cambiar a otro destino verificado.
