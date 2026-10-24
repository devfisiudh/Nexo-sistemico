-- =============================================================================
-- 06_auth_perfiles.sql
-- Integración Authentication -> perfiles_admin
--
-- Problema que resuelve:
--   Un usuario creado en Supabase Authentication NO aparecía en perfiles_admin,
--   y sin fila en esa tabla no puede entrar al panel (store.cerrarSesion()).
--
-- Solución:
--   1) Trigger: cada usuario nuevo en auth.users crea automáticamente su fila
--      en perfiles_admin como EDITOR + INACTIVO (sin acceso hasta que un
--      administrador lo active desde el panel: Administración → Activar).
--   2) Migración: los usuarios que ya existen en auth.users pero no tienen
--      fila en perfiles_admin reciben su perfil (también INACTIVO).
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) FUNCIÓN: se dispara al crear un usuario en Authentication
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_perfil_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.perfiles_admin (id, nombre, rol, estado, es_maestro)
    VALUES (
        NEW.id,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
            NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
            split_part(NEW.email, '@', 1)
        ),
        'EDITOR',
        'INACTIVO',
        FALSE
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- El rol que inserta usuarios en auth.users necesita ejecutar la función.
GRANT EXECUTE ON FUNCTION public.crear_perfil_admin() TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 2) TRIGGER sobre auth.users
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.crear_perfil_admin();

-- ---------------------------------------------------------------------------
-- 3) MIGRACIÓN: perfiles que faltan para usuarios ya existentes
-- ---------------------------------------------------------------------------
INSERT INTO public.perfiles_admin (id, nombre, rol, estado, es_maestro)
SELECT
    u.id,
    COALESCE(
        NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
        NULLIF(u.raw_user_meta_data ->> 'name', ''),
        split_part(u.email, '@', 1)
    ),
    'EDITOR',
    'INACTIVO',
    FALSE
FROM auth.users u
LEFT JOIN public.perfiles_admin p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) VERIFICACIÓN
--    Debe listar todos los usuarios de Authentication con su perfil y estado.
-- ---------------------------------------------------------------------------
SELECT
    u.email,
    p.nombre,
    p.rol,
    p.estado,
    COALESCE(p.es_maestro, FALSE) AS es_maestro
FROM auth.users u
LEFT JOIN public.perfiles_admin p ON p.id = u.id
ORDER BY COALESCE(p.es_maestro, FALSE) DESC, p.rol, u.email;
