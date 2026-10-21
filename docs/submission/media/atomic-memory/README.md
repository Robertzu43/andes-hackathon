# Nota posviaje: capturas con el fixture local

**Proveedor: fixture local (`tests/helpers/atomic-memory-fixture.mjs`), no el servicio Atomic Memory en vivo.** La app es la real (`npm start` con `DEMO_MODE=true`, web compilada), en `127.0.0.1:4714`, con la persona sintética de conductor de la demo. El sujeto de la nota es la identidad autenticada por el servidor.

| Archivo | Qué muestra |
|---|---|
| `01-summary-note-saved-local-fixture.png` | Resumen del viaje: nota guardada con consentimiento y leída de vuelta |
| `02-next-trip-recall-local-fixture.png` | Registrar el viaje: la nota del viaje anterior, con Corregir y Borrar |
| `post-trip-note-local-fixture.webm` | 10 s: escribir, marcar consentimiento, guardar y ver la nota al registrar |

La app no tiene hoy un botón para cerrar el viaje, y la sesión de demo vive solo en memoria. Por eso, el paso a `/trips/new` se hizo con navegación del historial dentro de la misma sesión (la ruta real), mientras el viaje 1 seguía activo.
