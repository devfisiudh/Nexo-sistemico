-- =============================================================================
-- 07_crear_usuario_admin.sql
-- Crear y eliminar cuentas del panel SIN entrar a Supabase
--
-- Problema que resuelve:
--   «+ Nuevo perfil» del panel solo servía para pegar un UID copiado de
--   Authentication → Users. Para dar de alta a alguien había que abrir
--   Supabase, crear el usuario, copiar el UID y volver al panel.
--
-- Solución: dos funciones que el panel llama con supabase.rpc():
--
--   crear_usuario_admin(email, contraseña, nombre, rol, es_maestro)
--       Crea la cuenta en Authentication (correo confirmado, entra al
--       panel nada más) y deja su fila en perfiles_admin ya con el rol
--       y el estado que haya elegido el administrador.
--
--   eliminar_usuario_admin(id)
--       Borra la fila del perfil y la cuenta de Authentication asociada.
--       Solo la cuenta principal (maestra) puede usarla.
--
-- Quién puede qué (se comprueba dentro de la función, no solo en la interfaz):
--
--   MAESTRO      crea ADMINISTRADOR o EDITOR, marca cuentas principales,
--                edita y borra perfiles.
--   ADMINISTRADOR solo crea EDITOR y solo edita/desactiva editores.
--   EDITOR       no entra a la sección de Administración.
--
-- Requisito: sql/06_auth_perfiles.sql aplicado (el trigger que crea la fila
-- en perfiles_admin cuando nace un usuario en Authentication).
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- =============================================================================

-- pgcrypto aporta crypt()/gen_salt() para guardar la contraseña igual que
-- Supabase (hash de 12 rondas de Blowfish).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1) CREAR CUENTA (Authentication + perfiles_admin) en un solo paso
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_usuario_admin(
    p_email text,
    p_password text,
    p_nombre text,
    p_rol text DEFAULT 'EDITOR',
    p_es_maestro boolean DEFAULT false,
    p_estado text DEFAULT 'ACTIVO'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
    v_yo        public.perfiles_admin%ROWTYPE;
    v_uid       uuid;
    v_email     text := lower(trim(p_email));
    v_nombre    text := btrim(p_nombre);
    v_rol       text := upper(btrim(p_rol));
    v_estado    text := upper(btrim(p_estado));
BEGIN
    -- ── ¿Quién llama? Debe ser un perfil ACTIVO con acceso a Administración ──
    SELECT * INTO v_yo
    FROM public.perfiles_admin
    WHERE id = auth.uid();

    IF v_yo.id IS NULL OR v_yo.estado <> 'ACTIVO' THEN
        RAISE EXCEPTION 'Tu perfil no tiene permisos para crear cuentas.';
    END IF;

    IF NOT COALESCE(v_yo.es_maestro, false) AND v_yo.rol <> 'ADMINISTRADOR' THEN
        RAISE EXCEPTION 'Solo la cuenta principal o un administrador pueden crear cuentas.';
    END IF;

    -- ── Datos básicos ───────────────────────────────────────────────────────
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'El correo no tiene un formato válido.';
    END IF;

    IF length(coalesce(p_password, '')) < 8 THEN
        RAISE EXCEPTION 'La contraseña debe tener al menos 8 caracteres.';
    END IF;

    IF length(v_nombre) < 3 THEN
        RAISE EXCEPTION 'El nombre debe tener al menos 3 caracteres.';
    END IF;

    IF v_rol NOT IN ('ADMINISTRADOR', 'EDITOR') THEN
        RAISE EXCEPTION 'Rol no permitido: %.', v_rol;
    END IF;

    IF v_estado NOT IN ('ACTIVO', 'INACTIVO') THEN
        RAISE EXCEPTION 'Estado no permitido: %.', v_estado;
    END IF;

    -- ── Reglas de jerarquía ────────────────────────────────────────────────
    -- Un administrador solo puede dar de alta editores: nunca administradores
    -- ni cuentas principales.
    IF NOT COALESCE(v_yo.es_maestro, false) THEN
        IF v_rol <> 'EDITOR' OR COALESCE(p_es_maestro, false) THEN
            RAISE EXCEPTION 'Un administrador solo puede crear cuentas de editor.';
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
        RAISE EXCEPTION 'Ya existe una cuenta de Authentication con ese correo.';
    END IF;

    -- ── Cuenta en Authentication ───────────────────────────────────────────
    -- email_confirmed_at = now(): quien crea la cuenta es un administrador
    -- que ya conoce la contraseña, no hace falta un correo de confirmación.
    v_uid := gen_random_uuid();

    BEGIN
        INSERT INTO auth.users (
            instance_id, id, aud, role,
            email, encrypted_password,
            email_confirmed_at,
            -- Estas cuatro columnas DEBEN ir con cadena vacía, nunca NULL:
            -- es lo que escribe GoTrue al crear una cuenta y es como las lee
            -- al hacer login. Con NULL la fila ni siquiera se puede consultar:
            -- GoTrue responde 500 «Database error finding user» para cualquier
            -- intento (incluso con la contraseña equivocada) y la cuenta queda
            -- inutilizable. (Verificado en producción 26/10/2026.)
            confirmation_token, recovery_token,
            email_change, email_change_token_new,
            raw_app_meta_data, raw_user_meta_data,
            created_at, updated_at
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            v_uid, 'authenticated', 'authenticated',
            v_email, crypt(p_password, gen_salt('bf')),
            now(),
            '', '', '', '',
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('full_name', v_nombre),
            now(), now()
        );
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'Ya existe una cuenta de Authentication con ese correo.';
    END;

    -- ── Identidad «email» (la usa GoTrue para entrar con contraseña) ───────
    -- El esquema de auth.identities cambió entre versiones de Supabase
    -- (apareció provider_id), así que se adapta a lo que haya instalado.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth'
          AND table_name   = 'identities'
          AND column_name  = 'provider_id'
    ) THEN
        EXECUTE $q$
            INSERT INTO auth.identities (
                id, user_id, provider, provider_id,
                identity_data, last_sign_in_at, created_at, updated_at
            ) VALUES (
                $1, $1, 'email', $1::text,
                jsonb_build_object(
                    'sub', $1::text,
                    'email', $2,
                    'email_verified', true,
                    'phone_verified', false
                ),
                now(), now(), now()
            )
        $q$
        USING v_uid, v_email;
    ELSE
        EXECUTE $q$
            INSERT INTO auth.identities (
                id, user_id, provider,
                identity_data, last_sign_in_at, created_at, updated_at
            ) VALUES (
                $1, $1, 'email',
                jsonb_build_object(
                    'sub', $1::text,
                    'email', $2,
                    'email_verified', true,
                    'phone_verified', false
                ),
                now(), now(), now()
            )
        $q$
        USING v_uid, v_email;
    END IF;

    -- ── Perfil en el panel ─────────────────────────────────────────────────
    -- El trigger de sql/06 crea la fila como EDITOR + INACTIVO; aquí se
    -- sube a lo que el administrador acaba de elegir.
    --
    -- Los casts explícitos son obligatorios: `rol` (enum rol_admin) y
    -- `estado` (enum estado_usuario) NO aceptan una variable de tipo text.
    -- Sin ellos Postgres responde:
    --     42804: column "rol" is of type rol_admin but expression is
    --            of type text
    -- (los literales del trigger de sql/06 sí valen, porque un literal sin
    -- tipo se convierte solo; una variable text, no). Los valores ya están
    -- validados arriba, así que el cast nunca puede fallar.
    INSERT INTO public.perfiles_admin (id, nombre, rol, estado, es_maestro)
    VALUES (
        v_uid,
        v_nombre,
        v_rol::public.rol_admin,
        v_estado::public.estado_usuario,
        COALESCE(p_es_maestro, false)
    )
    ON CONFLICT (id) DO UPDATE
        SET nombre     = EXCLUDED.nombre,
            rol        = EXCLUDED.rol,
            estado     = EXCLUDED.estado,
            es_maestro = EXCLUDED.es_maestro;

    RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.crear_usuario_admin(text, text, text, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crear_usuario_admin(text, text, text, text, boolean, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.crear_usuario_admin(text, text, text, text, boolean, text) TO authenticated;


-- ---------------------------------------------------------------------------
-- 2) ELIMINAR CUENTA (perfil + Authentication) — solo cuenta principal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.eliminar_usuario_admin(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_yo      public.perfiles_admin%ROWTYPE;
    v_objetivo public.perfiles_admin%ROWTYPE;
BEGIN
    SELECT * INTO v_yo
    FROM public.perfiles_admin
    WHERE id = auth.uid();

    IF v_yo.id IS NULL OR v_yo.estado <> 'ACTIVO' OR NOT COALESCE(v_yo.es_maestro, false) THEN
        RAISE EXCEPTION 'Solo la cuenta principal puede eliminar cuentas.';
    END IF;

    IF p_id IS NULL OR p_id = auth.uid() THEN
        RAISE EXCEPTION 'No puedes eliminar tu propia cuenta.';
    END IF;

    SELECT * INTO v_objetivo
    FROM public.perfiles_admin
    WHERE id = p_id;

    IF v_objetivo.id IS NULL THEN
        RAISE EXCEPTION 'Ese perfil no existe.';
    END IF;

    -- Nunca puede quedar el panel sin una cuenta principal activa.
    IF v_objetivo.es_maestro AND v_objetivo.estado = 'ACTIVO'
       AND NOT EXISTS (
            SELECT 1 FROM public.perfiles_admin
            WHERE id <> v_objetivo.id
              AND es_maestro
              AND estado = 'ACTIVO'
       ) THEN
        RAISE EXCEPTION 'No se puede eliminar la última cuenta principal activa.';
    END IF;

    DELETE FROM public.perfiles_admin WHERE id = p_id;
    DELETE FROM auth.users             WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_usuario_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eliminar_usuario_admin(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.eliminar_usuario_admin(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- 3) VERIFICACIÓN
-- ---------------------------------------------------------------------------
SELECT u.email, p.nombre, p.rol, p.estado, COALESCE(p.es_maestro, FALSE) AS es_maestro
FROM auth.users u
LEFT JOIN public.perfiles_admin p ON p.id = u.id
ORDER BY COALESCE(p.es_maestro, FALSE) DESC, p.rol, u.email;

-- Para probar la creación desde el SQL Editor no sirve (auth.uid() es NULL
-- sin sesión): hazlo desde el panel → Administración → + Nuevo perfil.
