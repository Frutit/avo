# 033 — Migrar Avo de Vercel y Neon a Cloudflare Free

id: 033
updated: 2026-11-27

## Goal

Servir Avo en `https://avo.frutit.app/` con React Router v8, Cloudflare Workers, recursos estáticos, `cf` y D1, dentro del plan gratuito. Preservar el último respaldo verificable de las dos cuentas y restaurarlo en producción con conteos, huellas y referencias consistentes. Confirmar en el dominio existente que ambas cuentas pueden recuperar sus datos guardados.

## Out of scope

Planes de pago, rediseño, cambios de reglas de producto o identidad, limpieza de históricos y rescate entre dispositivos u orígenes. El dueño revisó sus dispositivos y aceptó el respaldo de Neon `production` como fuente suficiente. El dueño eligió pasar directo a producción. Las aceptaciones ampliadas de 003–007 se conservan en sus tareas.

## Next step

Conectar Workers Builds al candidato con `npm run build` y `npm run deploy`. Confirmar las credenciales OAuth y habilitar el dominio en el corte según el [procedimiento](../../docs/cloud/avo-cloudflare-production.md). D1 `avo` ya contiene el respaldo verificado.

## Decisions

- **Runtime elegido.** React Router v8 en Framework Mode, SSR y Vite con el plugin de Cloudflare. La CLI `cf` controla builds, despliegues, tipos y migraciones D1. Se conservan los componentes React, Tailwind v4, Dexie y los catálogos ES/EN. El Worker recibe la base restaurada por el binding `DB`. [Guía de React Router en Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)
- **Presupuesto.** Referencia del 2026-11-24 para Workers Free, 100 000 peticiones dinámicas diarias y 10 ms de CPU por petición HTTP. Para D1 Free, 500 MB por base, 5 GB por cuenta, 5 millones de filas leídas y 100 000 escritas al día, con hasta 50 consultas por invocación. El margen real depende de los demás proyectos de la cuenta. [Workers](https://developers.cloudflare.com/workers/platform/limits/) · [Precios de D1](https://developers.cloudflare.com/d1/platform/pricing/) · [Límites de D1](https://developers.cloudflare.com/d1/platform/limits/)

## Checklist

### 1. Probar una ruta completa en local

- [x] En una copia aislada, registrar las versiones compatibles y arrancar el Worker de React Router con `DB` local y datos sintéticos. Tomar del código y de sus pruebas la referencia de rutas y respuestas. Usar credenciales de prueba y una carpeta sin `.env*` reales ni respaldo.
- [x] Abrir `/` en el navegador, crear un pendiente como invitado, recargar y comprobar que sigue en Dexie. Abrir `/privacy` y probar los dos idiomas. En `/api/account/me`, obtener `401` sin sesión y `200` con una sesión de prueba de Better Auth. Reiniciar Wrangler y recuperar esa misma cuenta sintética de D1.
- [x] Registrar las versiones, los comandos y los resultados del build y de las peticiones. Con esa evidencia, delimitar los cambios de dependencias, autenticación y build que el dueño debe autorizar en el proyecto principal.

El prototipo aislado está en `/tmp/avo-rr8-spike`. Usa React Router 8.5.2, Vite 8.3.8, Wrangler 4.168.0 y Better Auth 1.7.28. Para iniciarlo, ejecutar `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort` desde esa carpeta. El esquema sintético se inicializó con `npx wrangler d1 execute avo-synthetic --local --file=schema.sql`. La cuenta de prueba usa correo y contraseña para ejercitar Better Auth.

### 2. Portar la aplicación pública y actualizar la PWA

El port completo ya está en el worktree. El build de producción genera los recursos de Vite y el service worker con `node scripts/create-service-worker.mjs`; el preview usa `vite preview`. Tipos, metadatos, seguridad y los viajes públicos se validaron localmente. La actualización PWA local cubre el pendiente invitado, timer pausado y outbox sintética.

- [x] Portar `/`, `/privacy`, `/data-deletion`, errores y 404. Conservar el arranque de `RunoHome`, ES/EN, temas, navegación, imágenes y fuente. Trasladar URL canónica, metadatos sociales, robots, sitemap, manifest, iconos y cabeceras de seguridad a Workers y sus recursos estáticos. Generar el HTML público sin sesión, D1 ni acceso a IndexedDB.
- [x] Mantener el origen HTTPS, `/sw.js`, su alcance y los nombres de Dexie `runo` y `runo-user-…`. Construir el precaché con los recursos del build de Vite, incluidos módulos diferidos, estilos y fuentes. Excluir de caché las APIs, callbacks y cualquier respuesta de datos privada de React Router.
- [x] En un proxy local del mismo origen, actualizar del build Next al build React Router y recuperar sin red un pendiente invitado creado antes del cambio.
- [x] En el Worker compilado, con cuenta sintética, pausar el timer y crear un pendiente offline; tras recargar sin red, Dexie conserva la sesión pausada y una mutación queued. Las pruebas de repositorio confirman que al vencer el timer pasa a `awaiting_confirmation` y no termina sola.
- [x] Repetir el cambio de build con una pestaña anterior abierta y validar juntas la sesión pausada y la outbox de una cuenta sintética en IndexedDB; recargar offline después de activar el service worker de React Router. La cobertura de Safari y teléfono físico queda en la tarea 006.

### 3. Definir el esquema D1 y el contrato de importación

- [x] Mapear PostgreSQL a SQLite/Drizzle por tabla y campo. Preservar IDs, claves compuestas por propietario, unicidad, referencias, orden, revisiones, fechas UTC con su precisión, horas locales y marcas de borrado. Definir conversiones verificables de arrays, JSONB, enums y booleanos.

| Grupo | Tratamiento acordado |
|---|---|
| Identidad | Preservar usuarios de Better Auth, vínculos Google/Facebook y su relación con `runo_users`. Verificar unicidad de `(providerId, accountId)` y normalización del correo. Un propietario histórico con `auth_user_id` nulo conserva su aislamiento ante el primer login. |
| Datos duraderos | Migrar definiciones de tareas y rutinas con sus referencias ordenadas, preferencias con idioma y orden, pendientes de una vez y su finalización, marcas de archivado y borrado, y recibos de sincronización por propietario, versión y operación. |
| Datos del dispositivo e históricos | El invitado, timer, sesiones de actividad, eventos, saldo y resultados recurrentes siguen en Dexie. Inventariar por separado cualquier fila histórica equivalente que aparezca en el respaldo y conservarla en él. |
| Datos transitorios de autenticación | Acordar expiración o nuevo inicio de sesión para sesiones web, verificaciones y contadores. Excluir por defecto los tokens OAuth históricos de la importación y documentar el tratamiento de los respaldos con 007. |

- [x] Crear una carpeta y un historial propios para migraciones D1. Conservar el historial PostgreSQL aplicado. Antes de integrar cambios en `main`, revisar con el dueño el workflow que puede migrar Neon al subir `drizzle/*.sql` si `ENABLE_PRODUCTION_MIGRATIONS` está activo. Acordar su desactivación y la promoción explícita de D1 por entorno.

### 4. Portar identidad y sincronización sin romper clientes instalados

- [x] Servir `/api/auth/*` con el handler estándar de Better Auth, su adaptador D1 y la compatibilidad de Node que necesita el Worker. Sustituir `nextCookies()`, el pool de `pg`, la integración Vercel y el manejo de errores de Next. Probar `Set-Cookie`, cierre, expiración de sesión y origen en local con credenciales sintéticas. Mantener secretos en el Worker y límites atómicos con HMAC y caducidad, usando la IP de Cloudflare. Google/Facebook y callbacks HTTPS reales siguen abiertos en el paso 6.
- [x] Mantener `/api/account/me` y `/api/account/data` para clientes instalados v1 y v2. Las rutinas se sincronizan desde v2. Probar `X-Avo-Account`, `X-Avo-Sync-Version`, origen y tipo de contenido, hasta 40 mutaciones y 512 KiB, instantánea y ETag coherentes por cuenta y versión, `304`, `409 account_changed`, `429` con `Retry-After` y `503`. Mantener `Vary` y `private, no-store` incluso en errores y `304`.
- [x] Reemplazar los bloqueos y transacciones PostgreSQL por escrituras condicionadas a propietario y revisión, con cambios y recibos atómicos. En D1 local, probar dos clientes concurrentes, fallo intermedio, respuesta perdida, operación repetida con distinto contenido y el lote máximo. Verificar que un conflicto no genera recibo de éxito, el reintento no duplica cambios y la cola de A nunca se aplica a B tras cambiar de cuenta. [Semántica de lotes D1](https://developers.cloudflare.com/d1/worker-api/d1-database/)

### 5. Ensayar la transferencia y demostrar recuperación

El exportador PostgreSQL y el importador D1 pasaron con fixtures PGlite sintéticos y D1 local. El respaldo de producción se restauró y verificó localmente en OrbStack y Wrangler.

- [x] Ensayar un origen sintético PostgreSQL compatible en PGlite y el importador en D1 local con dos propietarios, vínculos de proveedor, rutinas ordenadas, un pendiente terminado y recibos. Las pruebas cubren reintento idéntico sin duplicados y reversión de un lote con conflicto.
- [x] Con el respaldo real autorizado, restaurar `production` en un contenedor PostgreSQL 19 efímero de OrbStack, sin red ni puertos y con el archivo montado read-only. Ejecutar el exportador/importador sobre una base Wrangler D1 local separada. CI y el entorno de prueba publicado usan registros sintéticos.
- [x] Comparar por propietario y entidad conteos y huellas de campos canónicos, IDs, vínculos, revisiones, finalizaciones y borrados. Resultado: cero diferencias, cero filas en `PRAGMA foreign_key_check`; una copia SQLite restaurada conserva las mismas huellas. Registrar solo resultados agregados.

### 6. Dejar preparado el corte

- [x] Conservar el dump original privado. Preparar SQL de importación y manifiesto de conteos y huellas. Ensayar el SQL con la CLI de D1.
- [x] Preparar un build del Worker `avo`, binding D1 para producción y procedimiento de DNS y secretos. Comprobar el empaquetado con `wrangler deploy --dry-run`.
- [x] Actualizar en el candidato el aviso de privacidad para Cloudflare Workers, D1 y copias históricas de migración.

### 7. Publicar y recuperar las cuentas

- [ ] Confirmar la cuenta Cloudflare Free y el respaldo a importar. Si se recupera acceso a Neon y hay escrituras posteriores al dump, exportar una copia final tras pausar el uso del sitio anterior.
- [x] Aplicar el esquema en una D1 nueva e importar y reconciliar el respaldo antes de habilitar el dominio.
- [ ] Publicar `avo` en `avo.frutit.app` con los secretos y callbacks vigentes. Confirmar inicio de sesión y recuperación de datos en las dos cuentas.

## Files

- `app/routes/home.tsx`, `app/routes/privacy.tsx`, `app/routes/data-deletion.tsx`, `app/root.tsx` — páginas públicas, errores, metadata y recursos.
- `lib/db/d1-schema.ts`, `drizzle-d1/0000_friendly_bullseye.sql`, `lib/db/d1-import.ts`, `lib/db/postgres-d1-export.ts` — modelo y transferencia por allowlist.
- `lib/auth-d1.ts`, `lib/security/d1-rate-limit-store.ts`, `lib/sync/d1-repository.ts`, `lib/sync/d1-routes.ts` — auth, límites y sync D1.
- `workers/app.ts`, `cloudflare.config.ts`, `scripts/create-service-worker.mjs` — Worker, binding y PWA.
- `scripts/d1-recovery.mjs`, `scripts/migrate-local-d1.mjs` y `docs/cloud/avo-cloudflare-production.md` — recuperación y corte.
- `.github/workflows/app-ci.yml` — CI local con D1 sintética; se eliminó el workflow anterior que podía ejecutar migraciones PostgreSQL de producción.

## Validation

| Fecha | Evidencia | Resultado y alcance |
|---|---|---|
| 2026-11-24 | Origen y fuente | El dueño confirmó el dominio y acceso a Neon. Ese día Vercel respondió `402 DEPLOYMENT_DISABLED`. Neon mostraba `production` predeterminada (33.51 MB) y `development` separada. |
| 2026-11-24 | Respaldo de `production` | `pg_dump` 19.0 produjo `~/Documents/Avo-migration-backup/avo-production-2026-11-24.dump` (75 421 bytes, permisos 0600). `pg_restore --list` y la lectura completa a `/dev/null` pasaron. La restauración en una base y la comparación de registros quedan en el paso 5. |
| 2026-11-24 | Compatibilidad histórica de vinext | `npx --yes vinext@latest check` en una copia aislada reportó 95 %, 18 comprobaciones compatibles y 2 parciales. El diagnóstico identificó limitaciones de `cacheComponents` y reglas de Turbopack. Fue una comprobación estática. |
| 2026-11-24 | Revisión del plan | Se cotejaron rutas, Dexie/PWA, esquema, identidad, sync, CI y aviso de privacidad con el repositorio. Las mediciones, pruebas del nuevo runtime y aceptaciones del dueño siguen abiertas. |
| 2026-11-24 | `npm run check:tasks` | 30 tareas comprobadas, cero errores y cero advertencias. |
| 2026-11-24 | Prototipo local React Router + D1 | Build y typecheck pasaron. `/privacy` respondió 200. Cuenta sintética con Better Auth y D1 local respondió 401 sin cookie y 200 con cookie, incluso tras reiniciar el servidor. Chromium guardó un pendiente en Dexie y lo recuperó al recargar tras esperar la hidratación. No se probaron OAuth real, PWA, datos de Avo ni producción. |
| 2026-11-24 | Port aislado de Avo | El build pasó con aviso de un chunk de cliente superior a 500 kB. Chromium mostró la interfaz real con datos locales y abrió el formulario de pendientes. En preview, el service worker se instaló y la página abrió sin red. La comprobación de tipos falló por configuración de archivos y diferencias de API entre `next-intl` y `use-intl`. |
| 2026-11-24 | Pendiente real en preview | La prueba automatizada creó un pendiente, pero quedó esperando el botón de navegación después de recargar y no verificó la recuperación. La prueba completa sigue pendiente. |
| 2026-11-24 | Port de Avo tras correcciones | Typecheck pasó en la copia aislada. Un pendiente creado en Chromium se recuperó tras recargar con conexión y sin ella. El service worker requirió ignorar `Vary` para los recursos estáticos propios. |
| 2026-11-24 | Esquema D1 inicial | En el worktree se generó una migración para 11 tablas y se ejecutó en D1 local sintética. Tres pruebas SQLite pasaron para claves, propietario histórico, unicidad ASCII y restricciones. Typecheck y ESLint de los archivos nuevos pasaron. Falta equivalencia de normalización Unicode, importador y adaptación de sincronización. |
| 2026-11-24 | Actualización de PWA | En Chromium, un proxy local mantuvo el mismo origen al cambiar del build Next al prototipo React Router. Un pendiente creado antes del cambio se recuperó después de actualizar y sin conexión. Quedan timer pausado, pestaña anterior abierta, cola de cuenta y dispositivo físico. |
| 2026-11-24 | Importador parcial | El worktree incluye importación por lotes idempotente y seis pruebas SQLite de esquema e importación. Los reintentos idénticos pasaron y un conflicto revirtió todo el lote. Falta conectar el origen PostgreSQL y ensayar los lotes contra D1 real local. |
| 2026-11-24 | PostgreSQL sintético a D1 local | Se exportó una instantánea PGlite con dos cuentas hacia un Worker con D1 local y se repitió sin duplicados. Una prueba adicional verificó tareas, orden de rutina, cierre de pendiente, exclusión de tokens y conteos. Se detectan filas adicionales en el destino. Falta restaurar y reconciliar una exportación real autorizada. |
| 2026-11-24 | Límites de acceso D1 | En D1 local, diez peticiones simultáneas para un límite de dos produjeron dos aceptaciones y ocho rechazos. Una prueba SQLite verificó caducidad y claves HMAC. La adaptación aún no está conectada a auth ni a la API. |
| 2026-11-24 | Checks del worktree | 649 pruebas, typecheck, lint, formato y `db:check` pasaron. `drizzle-kit check` también pasó para el historial D1 nuevo. El primer format check detectó JSON generados sin formato y se corrigió con Prettier. |
| 2026-11-24 | Build y auditoría de Next | El primer build mostró un aviso de seguridad y terminó con código 1. La repetición compiló y terminó. `npm audit` reportó 12 hallazgos moderados y ninguno alto o crítico, incluidos avisos para Next 16.4.3. Su aplicabilidad al despliegue requiere revisión. |
| 2026-11-24 | Suite final del port | `npm ci --ignore-scripts`, `npm test` (572 pruebas, 57 archivos), typecheck, lint, Prettier y `db:check` pasaron. Vitest omite siete suites antiguas que dependen del runtime Next/PostgreSQL eliminado; los contratos D1 y las pruebas PGlite sintéticas siguen corriendo. `npm audit --package-lock-only --audit-level=high` pasó con cuatro advisories moderados transitivos de Drizzle Kit/esbuild. |
| 2026-11-24 | Build Workers + navegador | `npm run build`, Wrangler `deploy --dry-run` y `npm run test:e2e` pasaron (31/31 Chromium). Bundle Worker: 4,449 KiB upload (998 KiB gzip), dentro del límite actual del runtime. Sigue el aviso Vite de un chunk cliente de 775 KiB (243 KiB gzip). No existe `.dev.vars` ni credencial local en el build. |
| 2026-11-24 | D1/auth/sync local | D1 migrada localmente. En Worker local: alta Better Auth sintética, `/api/account/me` 401 sin cookie y 200 autenticado, aislamiento entre cuentas, rechazo de cuenta cambiada, 40 escrituras atómicas, replay/conflicto concurrente, ETag/304 y persistencia de sesión tras reiniciar Wrangler. No se probaron proveedores OAuth reales. |
| 2026-11-24 | PWA sin conexión | Chromium instaló `sw.js`; el espacio invitado persistió después de recarga y modo offline. La actualización desde el build Next anterior recuperó el pendiente invitado. Quedan timer pausado, cola de cuenta, pestaña anterior abierta y aceptación en Safari/teléfono físico. |
| 2026-11-24 | Prerrequisito de restauración | El respaldo privado existe (75 421 bytes, permisos 0600); no se mostró ni copió su contenido. En ese momento `pg_restore`, `initdb` y `pg_ctl` no estaban instalados y Docker Engine no respondía. La restauración se completó en OrbStack el 2026-11-25. No se accedió a Neon. |
| 2026-11-25 | Ciclo local de autenticación y recuperación | Con Better Auth y D1 locales sintéticos, signup/login emitieron cookie, `/api/account/me` respondió 200 autenticado, sign-out expiró la cookie y el siguiente probe devolvió 401. Una expiración de sesión forzada en la D1 local también devolvió 401. Dos perfiles Chromium independientes: el primero escribió un pendiente y el segundo inició sesión y lo recuperó por `/api/account/data`. Sin OAuth real ni datos del dueño. |
| 2026-11-25 | Restauración real local | El respaldo se restauró con PostgreSQL 19 en OrbStack (contenedor efímero, `--network none`, sin puertos, archivo read-only). El importador por allowlist llenó el SQLite local de Wrangler separado; Wrangler volvió a leerlo. Conteos agregados: 2 usuarios y propietarios, 3 vínculos auth, 59 tareas, 18 pendientes, 2 ajustes y 113 recibos; cero rutinas. Huellas SHA-256 por propietario/entidad: cero diferencias; `foreign_key_check`: cero filas. Una copia restaurada con `VACUUM INTO` conservó los mismos conteos y hashes. No se imprimieron filas ni secretos. |
| 2026-11-25 | PWA offline con cuenta sintética | En Wrangler sobre el build de producción y D1 local, Chromium instaló el service worker. Después de iniciar sesión, pausó un timer, creó un pendiente sin red y recargó offline. Dexie conservó 1 sesión pausada, 1 pendiente y 1 cambio queued antes y después. La expiración manual del timer sigue validada por `repository.test.ts`; la transición visual de la cuenta durante el update de build anterior aún queda abierta. |
| 2026-11-25 | Recreación del build Next anterior | Un archivo temporal de `f5154cc` con `node_modules` enlazado desde el checkout no pudo compilar: Turbopack no resuelve `next/package.json` fuera de su raíz. El primer intento mostró el aviso de seguridad de Next 16.4.3; el segundo continuó y volvió a fallar por la raíz. No instalé dependencias ni toqué el checkout principal. El smoke anterior de actualización mismo-origen/pendiente huésped se conserva; falta combinarlo con timer/outbox.
| 2026-11-25 | Actualización PWA con pestaña abierta | En Chromium local, serví el build Next y después el Worker de React Router en el mismo origen `127.0.0.1:5191`, manteniendo abierta la pestaña anterior. El service worker nuevo cambió y tomó control; una recarga offline respondió. En una base Dexie `runo-user-migration-smoke` sintética se conservaron 1 sesión `paused`, 1 pendiente y 1 elemento de outbox `queued`. Los registros se sembraron directamente con el esquema local para aislar la persistencia; no es una prueba de login, sincronización de cuenta, Safari ni teléfono físico. Servidores, perfil Chromium y `.dev.vars` temporales se limpiaron.

| 2026-11-25 | Paquete de recuperación y despliegue | Neon rechazó la credencial guardada de producción. Del dump verificable del 24 de noviembre se generaron un SQL y un manifiesto privados fuera de Git. En D1 local vacía, el SQL importó 2 usuarios, 3 vínculos, 59 tareas, 18 pendientes, 2 ajustes y 113 recibos, y coincidieron conteos y hashes sin violaciones FK. Build de producción y dry run para `avo` pasaron con IDs sintéticos. |

| 2026-11-25 | Restauración en Cloudflare | `cf` creó D1 `avo`, aplicó el esquema e importó el respaldo del 24 de noviembre. Coincidieron conteos y huellas por tabla, sin referencias rotas. El build del commit fusionado pasó el dry run con el binding real. |
| 2026-11-25 | Migración de CLI | `cf build` y `cf deploy --dry-run` empaquetaron la PWA y el binding de la D1 restaurada. La recuperación mediante `cf` pasó en una D1 local aislada y la verificación de solo lectura en producción volvió a coincidir. Pasaron 572 pruebas unitarias, 31 recorridos Chromium y los checks de tipos, formato y esquema. |

## Log

- 2026-11-24 — El dueño confirmó el origen, revisó sus dispositivos y aceptó la exportación de `production` como fuente de la migración. El primer intento de exportación falló por el formato de autenticación y se repitió con éxito. Tras la prueba estática de vinext, el dueño eligió React Router v8 con Wrangler.
- 2026-11-24 — Revisión final de la tarea. El primer entregable es el prototipo aislado del paso 1. La restauración real, el cambio de dominio y la reapertura de escrituras tienen criterios separados.
- 2026-11-24 — Creado prototipo local en `/tmp/avo-rr8-spike`. React Router 8 exige `RouterContextProvider` para pasar D1 al handler. Una primera prueba recibió 500 por usar el contexto anterior y se corrigió. El primer intento de navegador hizo clic antes de la hidratación y no guardó el pendiente. La repetición tras hidratar pasó. Falta delimitar el port real y revisar la interacción previa a la hidratación.
- 2026-11-24 — El dueño autorizó continuar. Se portaron pantallas reales y un primer service worker a la copia aislada. El build pasa y la apertura sin red responde, con límites de tipos y de recuperación de pendientes registrados en Validation. Se conserva la tarea abierta.
- 2026-11-24 — Comprobados tipos y recuperación del pendiente con y sin red. Se creó el worktree `../runo-cloudflare-migration` en la rama `migration/cloudflare-d1` para continuar la implementación.
- 2026-11-24 — Creado el esquema inicial de datos duraderos y auth en el worktree, con una migración D1 nueva generada mediante Drizzle. Se ensayó únicamente con datos sintéticos. El backend actual todavía usa PostgreSQL.
- 2026-11-24 — Ensayada la actualización entre builds en el mismo origen y añadido un importador parcial con detección de conflictos por lote. Las comprobaciones de aplicación y de ambos historiales pasan en el worktree. La migración continúa abierta.
- 2026-11-24 — Conectada la lectura de PostgreSQL en una instantánea consistente al importador. Un ensayo con PGlite y Worker/D1 local pasó y se añadió comparación de conteos. También se probó el contador de límites D1 con peticiones concurrentes. Ninguna de estas piezas está conectada al backend de producción.
- 2026-11-24 — Cerrados los puertos locales de rutas, autenticación Better Auth/D1 y sync, junto con CI sin migración automática de Neon. Repetidos tests, typecheck, lint, formato, historial D1, build, dry-run Wrangler y 31 viajes Chromium. Queda pendiente la restauración del respaldo real: faltan herramientas PostgreSQL locales y Docker Engine; no se consultó ni modificó ningún servicio remoto.
- 2026-11-25 — Tras reiniciar Orca, confirmé el worktree `migration/cloudflare-d1`, no había proceso Avo activo y las comprobaciones previas siguen registradas. El smoke de auth incluyó un primer intento 403 al omitir `Origin`; corregido el cliente sintético, pasaron signup, login, logout, cookie, expiración y recuperación entre dos perfiles. `.dev.vars` de prueba se eliminó al terminar.
- 2026-11-25 — OrbStack está activo; `pg_restore 19` reconoció y restauró el respaldo en un PostgreSQL 19 efímero sin red ni puertos. La importación real a una D1 Wrangler separada, comparación canónica por propietario/entidad, verificación FK y restauración de copia pasaron. El contenedor usa tmpfs y se eliminará al cerrar la comprobación; el respaldo original no se modificó. Falta completar la PWA con timer/outbox y las aceptaciones externas.
- 2026-11-25 — Probada PWA compilada con Better Auth/D1 sintéticos: timer pausado y outbox siguieron en Dexie tras crear un pendiente sin red y recargar offline. Vite preview no cargó `.dev.vars`; Wrangler con config de `build/server` necesitó `--persist-to .wrangler/state` para usar la D1 ya migrada. Las credenciales sintéticas se quitaron de la raíz y del build al terminar.
- 2026-11-25 — Intenté recuperar el build Next anterior desde el commit base para probar el update con pestaña abierta. Next 16.4.3 mostró un advisory y Turbopack rechazó `node_modules/next` por estar fuera de la raíz aislada; no instalé dependencias. El objetivo queda pendiente de un workspace hermético o un dispositivo con la PWA anterior.
- 2026-11-25 — Reconstruido Next en `/tmp` con dependencias locales y ejecutado el cambio de build en Chromium al mismo origen, con pestaña anterior abierta. La PWA nueva activó su service worker; recarga offline conservó la sesión pausada y la outbox sintética de cuenta en Dexie. Se completaron las comprobaciones que dependen solo del entorno local. El siguiente paso requiere configurar el entorno remoto de aceptación, autorizado por separado.
- 2026-11-25 — El dueño priorizó conservar el estado guardado de sus dos cuentas y preparar el corte directo desde GitHub. Se difirió staging. La producción queda como siguiente operación en el procedimiento enlazado.
- 2026-11-27 — Movida temporalmente a backlog para atender la tarea 034 (orden de hábitos en Hoy, mano de dos tarjetas y rutinas con días flexibles). El respaldo en D1 `avo` y el procedimiento de corte quedan listos para retomarse al cerrar 034.
