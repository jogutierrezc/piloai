# Pilo AI

La inteligencia artificial de la Universidad de Santander, como proyecto propio.
Extraído de Planeación (PDI) el 2026-10-14. **Comparte la misma base de datos y el mismo Supabase.**

## Qué hay aquí
| Ruta | Qué es |
| --- | --- |
| `/pregunta` | Pilo Universidad (público) |
| `/pilo-ensenanza` | Pilo Enseñanza |
| `/app/*` | La app instalable (PWA / Store) |
| `/pilo-embed`, `public/pilo.js` | El chat emergente para otros portales |
| `/admin/mr-pilo`, `/admin/mr-pilo-ensenanza` | Administración de Pilo (sesión de la intranet, rol admin) |
| `supabase/functions/` | `pilo-ia`, `pilo-cuentas`, `pilo-clases`, `pilo-genesis`, `pilo-carnet`, `pilo-alertas` |
| `api/pilo-voz.js` | Voz (Vercel → Fish Audio) |

## Base de datos
Un solo Supabase (el autoalojado de la universidad). Pilo escribe solo en sus tablas `pilo_*` y lee las de la UDES (cifras, sedes, programas).
- `supabase/migrations/` trae **copia de las migraciones `pilo_*` ya aplicadas**, solo como historial y para las pruebas. **No se vuelven a aplicar.**
- Las migraciones nuevas de Pilo se crean aquí con prefijo `pilo_NNNN_nombre.sql` y se aplican a mano. Las de Planeación siguen en PDI.
- Dueño de las funciones: desde ahora, este repositorio. Se despliegan con `supabase functions deploy <nombre> --no-verify-jwt`.

## Cómo correrlo
```
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (la clave anónima; nunca la service_role)
npm run dev
npm test
```

## Estado de la extracción
Fase 1 hecha: copia fiel. Compila, construye y pasa las pruebas de Pilo.
Pendiente: administración propia (hoy usa el `AdminShell` de la intranet), dominio y manifiesto propios,
retirar estos módulos de PDI, y llevar aquí el diseño aprobado (artifact «Pilo AI»).
