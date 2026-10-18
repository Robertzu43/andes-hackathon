# App funcional en teléfonos reales: diseño

Fecha: 2026-10-18. Estado: aprobado por Robert, sección por sección, en brainstorming. Base: `main` 817fbac.

## Objetivo y criterio de éxito

Tener una app de Tándem (ANDES) que funcione de punta a punta en dos teléfonos físicos, con alertas reales. La `DEMO_URL` del deck abre **la app del conductor**.

Hay éxito cuando, sobre una URL HTTPS:

1. Un conductor nuevo se registra, registra su camión, agrega a su contacto de emergencia y empieza un viaje. Todo pasa por un recorrido guiado.
2. El contacto, en otro teléfono, verifica su número con un código SMS y acepta.
3. El teléfono del conductor comparte la ubicación en vivo.
4. Un SOS hace llegar SMS, WhatsApp y llamada reales al teléfono del contacto.
5. Un silencio abre un check y, sin respuesta, escala.
6. «Llegué» corta la ubicación.
7. La corrida queda registrada como evidencia con horas y capturas.

## Alcance

**Dentro:**
- servir la app web desde el backend;
- arranque de la app en producción y pantallas del conductor;
- recorrido guiado con spotlight;
- link del contacto y aceptación;
- números propios verificados por SMS en modo demo;
- túnel HTTPS y prueba con dos teléfonos;
- deploy en AWS con `infra/demo/deploy.sh`;
- `DEMO_URL` en el deck.

**Fuera:**
- viaje por voz (el backend responde 422 `unsupported_audio`);
- aviso a grupos de WhatsApp (sigue `group_support_unverified`);
- matriz completa del issue #9 y Android como plataforma soportada;
- login OIDC de producción, que no cambia;
- detección automática de sueño o robo.

## 1. Arquitectura y cómo corre

**Un solo origen.**
- `src/server.ts` sirve la API `/v1/*` (sin cambios), `/mapa` (ya existe) y la app web compilada `web/dist`.
- Las rutas que no son API ni archivos devuelven `index.html`, así `/trips/:tripId` carga la app.
- No hay CORS.
- El `Dockerfile` compila la web y copia `web/dist` a la imagen. La misma imagen sirve para el túnel y para AWS.

**Procesos.** Siguen el modelo de `deploy.sh`:
- la API con el control loop (sweeper de checks, outbox y relay);
- los consumidores de entrega `emergency` y `ordinary`.

Todos usan **SQS real**. Las colas se crean con `deploy.sh prepare`, que no cuesta nada. `src/worker.ts` exige `AWS_REGION`, `SQS_EMERGENCY_URL` y `SQS_ORDINARY_URL`.

**Etapa 1, túnel:**
1. `docker compose` levanta Postgres.
2. La API y los workers corren locales con `DEMO_MODE=true` y Zavu real.
3. `cloudflared tunnel --url http://127.0.0.1:3000` da una URL `https://…trycloudflare.com`. HTTPS es obligatorio para la geolocalización.

**Etapa 2, AWS:** `deploy.sh` (ECS Express, RDS y SQS) con la misma imagen. Es una "demo reducida": una tarea, una zona de disponibilidad.

## 2. App web

### Arranque en producción (`web/src/main.tsx`)

`FoundationRoot` recibe:
- `session`: la sesión de demo de #81, con un solo mundo compartido entre personas;
- `routes`: las pantallas del conductor, las del contacto (#62) y la de privacidad, contra el cliente tipado de #59 con el mismo origen.

La ganchera de tests (`__ANDES_TEST_HOOKS__`) queda solo para builds de prueba. El idioma por defecto es español, con `pt-BR` disponible.

### Pantallas del conductor (nuevas)

Usan las rutas que ya define `web/src/foundation/routes.ts` y el controlador probado de #63 (`web/src/features/driver/controller.mjs`).

| Ruta | Pantalla |
|---|---|
| `/` | Bienvenida: qué es Tándem («tu gente, contigo en ruta; sin central») y botón **Empezar**, que crea el mundo de demo. Si ya hay sesión, va al viaje activo o al botón **Nuevo viaje**. |
| `/trucks` | Registrar el camión (placa o apodo) con `POST /v1/trucks`. |
| `/contacts` | Agregar al contacto de emergencia (sección 3). |
| `/trips/new` | Viaje por texto: descripción, origen y destino, y hora de llegada futura. Revisar el borrador y confirmar. |
| `/trips/:tripId` | **Viaje activo** (ver abajo). |
| `/trips/:tripId/check-in` | Banner de check a pantalla completa con **Estoy bien** y el tiempo restante (`askUntil`). |
| `/trips/:tripId/alerts` | Estado de cada envío por destinatario y canal, sin teléfonos. |
| `/trips/:tripId/summary` | Resumen al llegar. |
| `/privacy` | La página de privacidad que ya existe. |

**Viaje activo:**
- **Ubicación:** botón **Compartir ubicación**, que requiere un gesto por el permiso del navegador. Muestra el estado *compartiendo / vieja / sin datos* y la hora de la última lectura, que vienen de `/v1/trips/:id/status`. Pide un *wake lock* de pantalla si el navegador lo permite.
- **Botones grandes:** **SOS** (rojo y dominante, un toque, como `requestHelp()`), **Estoy bien**, **Hacer una pausa / Continuar** y **Llegué**.
- **Polling** de `/status` cada 5 s. Si hay un check abierto, abre el banner.
- **«Abrir como contacto en otro teléfono»:** muestra el link del contacto con botón de copiar (sección 3).

**GPS:**
- El adaptador de #52 alimenta la cola de #66, que sube a `/v1/trips/:id/locations`.
- `ownerSubject` es igual al `sub` del token del conductor.
- Si se niega el permiso o se detiene el envío, se ve en la pantalla y se notifica a `POST /v1/trips/:id/sharing`.
- En iOS, con la pantalla bloqueada la ubicación se detiene. La app lo muestra como *sin datos* y el check del servidor sigue corriendo.

### Recorrido guiado con spotlight

Es un componente propio, sin librerías. Oscurece la pantalla con una sombra (`box-shadow` alrededor del rectángulo del elemento) y explica una parte a la vez, con **Siguiente**, **Atrás** y **Saltar**.

- Se maneja con teclado, tiene foco visible y respeta `prefers-reduced-motion`.
- Se puede volver a ver desde **¿Cómo funciona?**.
- Recuerda que ya se vio en `localStorage`, con `try/catch`; si falla, simplemente se muestra.

**Pasos para el conductor:**
1. Bienvenida.
2. Camión.
3. Contacto de emergencia: por qué tiene que aceptar.
4. Primer viaje.
5. Compartir ubicación: quién la ve, y qué significan *vieja* y *sin datos*.
6. Estoy bien: el silencio no es una alarma inmediata.
7. Pausa: suspende los checks, pero el SOS sigue activo.
8. SOS: un toque avisa al instante a la familia (SMS, WhatsApp y llamada) y a los colegas (SMS y WhatsApp).
9. El check automático: si no hay señales pregunta; si no respondes, avisa.
10. Alertas: qué se envió y por qué canal.
11. Llegué: termina el viaje y deja de compartir.

**Pasos para el contacto** (recorrido corto): qué ve, qué significa cada estado, y qué hacer ante una alerta: llamar y, si no responde, llamar al número de emergencia.

## 3. Contacto de emergencia, link y número verificado

**El conductor agrega al contacto** en `/contacts`:
- Ingresa el número del contacto, un nombre visible que solo vive en el cliente («Mamá») y el rol.
- La app llama al endpoint real `POST /v1/contacts` con `{contactId: <persona family del mundo>, phone, map: true, incident: true, role}`.
- El grant queda **pendiente**.

**Link del contacto:**
- La forma es `/contact/invitations/:grantId#t=<token de la persona family>`.
- La app lee el token del fragmento, lo borra de la URL con `history.replaceState`, y nunca lo guarda en storage.
- El token vale 2 horas y solo sirve en ese mundo de demo.

**En el teléfono del contacto:**
1. Verifica su número con un código SMS (endpoints de la sección 4).
2. Acepta con `POST /v1/contacts/:id/accept`. Desde #91, la aceptación exige que la identidad tenga el teléfono verificado e igual al de la invitación.
3. Pasa a `/contact/trips/:tripId`, que es la pantalla de #62.

Si hay un solo teléfono, el mismo usuario abre el link en otra pestaña e ingresa su propio número.

## 4. Backend: modo demo con números verificados

**Cambios en `src/demo.ts`:**
- La sesión de demo **ya no pre-crea el grant de la persona family**, porque se crea en el recorrido.
- La identidad family nace **sin teléfono verificado**.
- El grant del colega con número ficticio se mantiene, y su envío aparece como *no permitido*.

**Endpoints nuevos (solo con `DEMO_MODE=true`):**

`POST /v1/demo/phone/start` con `{phone}`:
- El actor es la persona del token.
- Valida E.164 y que el país esté en `DEMO_ALLOWED_COUNTRIES` (por ejemplo `PE,BR,CL,CO,MX,AR`).
- Envía por Zavu SMS un código de 6 dígitos con el texto «Demo de Tándem: tu código es …».
- Guarda el **hash** del código, el HMAC del número y un vencimiento de 10 minutos.

`POST /v1/demo/phone/verify` con `{code}`:
- Compara en tiempo constante.
- Si coincide, actualiza `identities.phone` y `phone_verified=true` de **esa** identidad.

**Límites del código:**
- 3 por número por hora;
- 5 por IP por hora;
- 5 intentos por código;
- `DEMO_SMS_DAILY_CAP` global: al alcanzarlo, `start` responde 429 `demo_budget_exhausted`.

**Allowlist dinámico.** Cambia el guard de #74, por decisión explícita de Robert:
- En modo demo con envíos reales, un destino es válido si es `DEMO_LIVE_PHONE` **o** el teléfono **verificado** de una identidad del **mismo mundo** que el viaje.
- `src/worker.ts:16` deja de exigir `allowedDestinations` exactamente igual a `[DEMO_LIVE_PHONE]`. Exige `demoLimits` y `DEMO_SMS_DAILY_CAP`.
- `src/notifications/dispatch.ts` hace la comprobación dinámica dentro de `authorizeJob`, la última puerta SQL antes del envío.
- Se agrega un tope de alertas por número verificado por día (`DEMO_ALERTS_PER_NUMBER_DAILY`).

**Textos:** todos los mensajes del modo demo empiezan con «Demo de Tándem».

**Retención:** los retos y teléfonos verificados de un mundo se borran cuando el mundo vence (2 h) o, a más tardar, a las 24 h. Los logs no guardan números: solo HMAC con pepper secreto.

**Producción no cambia:** sin `DEMO_MODE=true`, las rutas de demo no existen y el allowlist sigue igual.

## 5. Envíos reales y configuración

| Variable | Valor de la demo |
|---|---|
| `DEMO_MODE` | `true` |
| `ZAVU_LIVE_SEND` | `true` |
| `DEMO_LIVE_PHONE` | el número de Robert, solo en el entorno o en Secrets Manager |
| `demoLimits` | por incidente y por sesión |
| `DEMO_SMS_DAILY_CAP` | lo fija Robert |
| `DEMO_ALERTS_PER_NUMBER_DAILY` | lo fija Robert |
| `DEMO_ALLOWED_COUNTRIES` | la lista de países habilitados |
| `SILENCE_MS` | 120000 (valor de demo, no un umbral de seguridad) |
| `ASK_GRACE_MS` | 60000 |
| `ARRIVAL_GRACE_MS` | 120000 |
| `CHECK_SWEEP_MS` | 5000 |
| `EMERGENCY_NUMBERS` | por ejemplo `{"PE":"105","BR":"190"}` |

La API key de Zavu y el secreto de callbacks van en el entorno, o en Secrets Manager en AWS. Los callbacks entran por la misma URL. Si WhatsApp no tiene plantillas aprobadas en Zavu, el canal aparece como *no disponible*: no se simula.

En la URL de los jueces (AWS), los envíos reales quedan **activados con tope**. Se apagan con `ZAVU_LIVE_SEND=false`.

## 6. Privacidad y abuso

- Ningún teléfono en pantallas, respuestas ni logs (#65, #91).
- Solo se envía a números verificados del mundo o a `DEMO_LIVE_PHONE`.
- Topes en tres capas: código, alertas por número, y por sesión e incidente.
- El presupuesto diario global se apaga solo al alcanzarlo.
- El link del contacto es una credencial: va en el fragmento, se borra al abrirlo y vence en 2 h.
- Se mantiene el límite de 30 sesiones demo por minuto.

## 7. Pruebas automáticas

La misma puerta de siempre: el agente arregla, el revisor verifica con mutaciones y Robert mergea.

**Backend:**
- `/` y `/trips/<uuid>` devuelven la app, y `/v1/*` sigue siendo JSON.
- Pruebas de abuso del código: número no verificado, código vencido o equivocado, más de 5 intentos, topes por número e IP, país no permitido, otro mundo y presupuesto global agotado.
- Producción sin `DEMO_MODE`: las rutas de demo no existen.
- El dispatch envía solo a números verificados del mismo mundo o a `DEMO_LIVE_PHONE`.
- El grant family ya no viene pre-creado.

**Web:**
- Pantallas del conductor sobre el controlador: registro, camión, contacto, viaje, Estoy bien, Pausa, SOS y Llegué.
- Recorrido guiado: teclado, saltar, volver a verlo, reducir movimiento y que falle `localStorage`.
- Link del contacto: el token se lee del fragmento, se borra y no se guarda.

**De punta a punta en CI** (seam de #73, navegador contra el backend real): demo → camión → invitación → verificación con un código de prueba (proveedor falso) → aceptación → viaje → SOS → el status muestra las alertas.

## 8. Prueba en teléfonos reales

Con dos teléfonos físicos, sobre la URL del túnel y después sobre la de AWS. Para cada paso se anotan hora y captura:

1. Llega el código SMS al contacto.
2. El contacto acepta.
3. La ubicación se actualiza; se anota la frecuencia y qué pasa con la pantalla bloqueada.
4. Funcionan Estoy bien y Pausa.
5. SOS → llegan SMS, WhatsApp y llamada al teléfono del contacto, con el tiempo desde el toque hasta cada recepción.
6. Silencio → check → escalamiento.
7. Llegué corta la ubicación.

Se registra en `docs/evidence/phone-run-2026-10-18.md` con modelos, sistema operativo, navegador y red. Una corrida no completa la matriz del #9, y se dice así.

## 9. Orden de entrega

1. Backend: servir `web/dist` y ajustar el `Dockerfile`.
2. Backend: código SMS, allowlist dinámico, grant family no pre-creado y textos «Demo de Tándem».
3. Web: arranque de producción y pantallas del conductor.
4. Web: recorrido guiado.
5. Web: link del contacto, verificación y aceptación.
6. Túnel y prueba en dos teléfonos, con evidencia.
7. AWS con `deploy.sh` y la prueba corta otra vez.
8. `DEMO_URL` en el deck.

Los pasos 1 y 2 avanzan en paralelo con el 3. Cada paso es un PR: el revisor verifica y Robert mergea.

## Riesgos y pendientes

- **Zavu:** API key, canales habilitados y plantillas de WhatsApp. Sin plantillas, WhatsApp aparece como no disponible.
- **AWS:** perfil, cuenta y presupuesto de Robert. La etapa del túnel también los necesita por SQS.
- **iOS:** la ubicación se detiene con la pantalla bloqueada. Se muestra honestamente y el check del servidor cubre el hueco.
- **Recarga:** recargar la página crea un mundo nuevo, porque los tokens viven en memoria por diseño (#81).
- **Costo:** los SMS de código y las alertas gastan saldo; los topes lo limitan.
