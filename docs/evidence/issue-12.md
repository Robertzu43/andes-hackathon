# #12 — Registro de preparación y evidencia

Fecha: 2026-10-17. Ingeniería: preparación activa. Evidencia: pendiente. Issue abierta; este registro no constituye aceptación.

## Propósito y rúbrica

- Usuario: conductor de carga y contacto de confianza que necesita saber qué ocurrió y si debe actuar.
- Paso del recorrido: contrato común desde borrador confirmado hasta ubicación, ayuda, acción y cierre.
- Esfuerzo técnico: decisiones justificadas y fallos recuperables; evidencia prevista: contratos y pruebas reproducibles.
- Demo: habilitar el recorrido conductor/contacto y explicar pérdida de señal/reinicio sin estados falsos.
- Coste/alternativa: comparar API + worker + PostgreSQL con flujos administrados; evitar temporizadores no durables. Sin estimación horaria hasta conocer plataforma, cuentas y tiempo disponible del equipo.

## Fuentes locales verificadas

- `docs/plan.json`, `docs/PLAN.md`, `docs/OWNERSHIP.md` y `CONTRIBUTING.md` preservan #11 como blocker de #12 y #9–11 como evidencia necesaria.
- HEAD local `815d0c6`; `git ls-remote origin HEAD` devolvió `470209dabf4d9f6c52e545b8cbf3030b35beedf2`. No se hizo pull/rebase ni se cambiaron issues remotas.
- El repositorio tiene documentación y planes; no contiene runtime de aplicación, suite ejecutable ni trazas de dispositivo/proveedor en los archivos inspeccionados.
- Requisitos recientes de Robert: voz/texto inicial, botones grandes, contexto de sensores, múltiples oportunidades válidas, SOS independiente y Zavu multicanal. Ver [baseline](../superpowers/specs/2026-10-17-robert-backend-contracts.md).

## Entregables de preparación

- [ADR-001](../architecture/ADR-001-backend.md): brief confirmado, alternativas de cliente/backend, responsabilidades, fallos y preguntas pendientes. Propuesta no aprobada.
- La guía del evento se consultó por HTTP; rúbrica 40/30/30 y presentación desde enlaces en ventana privada corroboradas. No se realizó entrega al hackathon.
- Revisión delegada de #9–12: corroboró en GitHub las cuatro issues abiertas, sin comentarios y con checklists sin completar; #9–11 asignadas a `sebasbimbi`, #12 a `Robertzu43`. No encontró evidencia de aceptación en esos cuerpos/comentarios ni en este checkout. El README menciona trabajo en curso de #8/#9; puede existir en otro entorno y no se afirma su inexistencia global.
- [Matriz de soporte inicial](../architecture/support-matrix.json): inventario de condiciones por evaluar, todas `untested`; países/dispositivos concretos aún sin seleccionar. Las filas no constituyen soporte regional ni evidencia de un canal.

## Evidencia pendiente de aceptación

| Dependencia | Responsable | Evidencia necesaria |
|---|---|---|
| #9 | Sebastian | Dispositivos/SO/modos concretos, permisos, bloqueo, segundo plano, desconexión, batería y tiempos observados |
| #10 | Sebastian | Cuenta/canales/países/idiomas, destinatarios de prueba, contratos del proveedor y soporte real de grupo |
| #11 | Sebastian | Límites justificados, riesgos, criterios de detener/revisar y revisión independiente |
| #12 | Robert con Sebastian | Arquitectura revisada, matriz respaldada por evidencia, contratos acordados, infraestructura comprobada y fallos vinculados a pruebas |

La autorización previa de usar Zavu y los créditos aplicables permanece vigente. No se requiere volver a pedir esa elección; acceso y elegibilidad son datos por verificar. No se han canjeado beneficios ni enviado mensajes en esta preparación.

## Disposición

Revisión fresca de arquitectura completada: [informe](../architecture/reviews/2026-10-17-scalability-review.md). El coordinador contrastó las referencias de #17/#21/#30 y corroboró en documentación oficial AWS la repetición posible de Lambda/SQS y el pinning de locks de sesión en RDS Proxy. Hallazgos altos pendientes de resolución: bloqueo entre canales por fence global y ocupación del lock/conexión durante llamadas externas, con impacto en mapa/cierre. El informe distingue revocación específica del mapa de revocación incorporada al cierre. No se ha cambiado todavía ese protocolo; la arquitectura no queda aprobada ni implementable por esta revisión. Las preguntas del informe se priorizan para la demo, según la aclaración de Robert.

Continuar la decisión arquitectónica y recopilación de evidencia. No cerrar #12 ni marcar como soportados modos de teléfono/canales sin observaciones. No presentar documentación, revisión de IA o pruebas sintéticas como evidencia independiente de eficacia.

## Delegated decision and second review

Robert subsequently delegated resolution of the seven questions and selection of the robust design. [ADR-002](../architecture/ADR-002-aws-durable-dispatch.md) selects AWS and replaces the global session lock/fence with short per-attempt authorization transactions. The changed guarantee is explicit: no new affected authorization after closure/revocation, while prior authorized sends can finish later. All three individual SOS channels become immediately eligible; trip closure does not resolve an active SOS.

A fresh reviewer found no design blocker, and requested clearer ambiguous-replay semantics and additional lease/recovery race tests. The coordinator chose read-only reconciliation for ambiguous attempts in v1 (no idempotent send replay without a separate qualified payload/recovery contract), and added the missing stale-claim, paused-emitter, scanner recovery, in-flight read and revoked-contact tests. This is a design review only. Two agents align lifecycle/location/deadline and notification plans; the coordinator reconciles shared signatures and originating SOS integration. Original acceptance evidence is still missing.

Verification of this documentation revision: checked 33 Markdown documents for local link targets, whitespace and balanced code fences; confirmed all 24 numbered issue plans remain present and contain no active `withTripLock`, `selectSupportedChannel`, `trips.dispatch_fence` or retired no-physical-send-after-resolution constraint. All 14 support-matrix entries remain `untested` with no fabricated evidence references. The first validation selected the roadmap as an issue plan (25); corrected the filename filter to numbered issues and reran successfully. No runtime, AWS, phone or provider tests were run.
