-- =============================================================================
-- 05_rol_maestro.sql
--
-- Jerarquía de acceso al panel de administración:
--
--   MAESTRO (cuenta principal)  → gestiona administradores y editores
--   ADMINISTRADOR               → gestiona solo editores
--   EDITOR                      → no gestiona a nadie
--
-- Se añade la columna `es_maestro` a `perfiles_admin`. El rol sigue siendo
-- ADMINISTRADOR | EDITOR; `es_maestro = true` identifica a la cuenta
-- principal, que tiene control total del panel.
--
-- AFECTA:
--   · public.perfiles_admin → columna es_maestro (boolean, default false)
--   · Una cuenta se marca como maestra (ajustar el id más abajo si es necesario)
--
-- SEGURO DE REEJECUTAR.
-- =============================================================================

-- 1) NUEVA COLUMNA
ALTER TABLE public.perfiles_admin
    ADD COLUMN IF NOT EXISTS es_maestro BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) MARCAR LA CUENTA PRINCIPAL
--    Sustituir el UUID por el id del perfil de la cuenta principal (la del
--    correo dev.fisi.udh@gmail.com). Se puede obtener con:
--    SELECT id, nombre, rol, estado FROM public.perfiles_admin;
UPDATE public.perfiles_admin
SET es_maestro = TRUE
WHERE id = '58175dbc-8e66-47c7-8b3e-e5fda18b40b8';

-- 3) VERIFICACIÓN
--        SELECT id, nombre, rol, estado, es_maestro
--        FROM public.perfiles_admin
--        ORDER BY es_maestro DESC, rol, nombre;
--
--    Debe haber exactamente una fila con es_maestro = true.
--
-- NOTA: las validaciones de jerarquía (quién puede editar a quién) se hacen
-- desde el panel (admin/js/app.js). Este script solo prepara la columna.
-- =============================================================================
