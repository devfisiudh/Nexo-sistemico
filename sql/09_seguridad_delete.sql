-- =============================================================================
-- 09_seguridad_delete.sql
-- Ejecutar en: Supabase -> SQL Editor
--
-- Por qué hace falta.
--
-- El panel borra publicaciones con `supabase.from(tabla).delete()` desde el
-- navegador (admin/js/app.js, eliminarPublicacion). Ese DELETE viaja con la
-- clave publicable del cliente, así que el único que decide quién borra es la
-- política RLS de DELETE. La interfaz ya exige nivel ADMINISTRADOR
-- (puedeBorrarContenido), pero una interfaz no es seguridad: sin política
-- estricta, cualquier sesión autenticada con la clave pública podría borrar
-- filas a mano con la consola.
--
-- Regla aplicada (misma jerarquía que el panel):
--
--   noticias / eventos / anuncios  -> solo administrador (maestro incluido)
--   perfiles_admin                 -> solo la cuenta maestra
--   storage (portadas)             -> NO se restringe: ver bloque E
--
-- Las políticas de SELECT/INSERT/UPDATE existentes no se tocan: siguen
-- mandando las de siempre (anon solo lee PUBLICADO vigente, editores solo
-- editan, etc.).
--
-- La eliminación de cuentas no usa DELETE directo: va por la función
-- eliminar_usuario_admin (SECURITY DEFINER, sql/07), que exige maestro y
-- prohíbe borrarse a sí mismo. Esta política no la estorba.
--
-- Seguro de reejecutar: borra y recrea solo las políticas de DELETE.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) RLS activo en las cuatro tablas que maneja el panel (idempotente).
--    Si ya está activo, no cambia nada.
-- -----------------------------------------------------------------------------
ALTER TABLE public.noticias       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anuncios       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfiles_admin ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- B) es_administrador().
--    Solo se crea si NO existe: si ya está definida en la base, se conserva
--    tal cual (aquí manda la definición original de producción).
-- -----------------------------------------------------------------------------
DO $do$
BEGIN
    IF to_regprocedure('public.es_administrador()') IS NULL THEN

        EXECUTE $f$
            CREATE FUNCTION public.es_administrador() RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER
            SET search_path = public, pg_catalog
            AS $fn$
                SELECT EXISTS (
                    SELECT 1
                    FROM public.perfiles_admin
                    WHERE id = auth.uid()
                      AND rol = 'ADMINISTRADOR'
                      AND estado = 'ACTIVO'
                )
            $fn$
        $f$;

        RAISE NOTICE 'es_administrador() no existía: creada.';
    ELSE
        RAISE NOTICE 'es_administrador() ya existía: se conserva.';
    END IF;
END
$do$;

-- -----------------------------------------------------------------------------
-- C) Retirar las políticas de DELETE que hoy tengan esas tablas.
--    Si no hay ninguna (o ya eran correctas), no hace falta: se recrean igual.
--    Solo se tocan políticas con cmd = DELETE; las de SELECT/INSERT/UPDATE
--    quedan intactas.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE
    politica record;
BEGIN
    FOR politica IN
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('noticias', 'eventos', 'anuncios', 'perfiles_admin')
          AND cmd = 'DELETE'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                       politica.policyname, politica.tablename);
        RAISE NOTICE 'Retirada política de DELETE: %.%',
                     politica.tablename, politica.policyname;
    END LOOP;
END
$do$;

-- -----------------------------------------------------------------------------
-- D) Las políticas nuevas.
-- -----------------------------------------------------------------------------

-- Contenido: borra solo quien puede administrar (ADMINISTRADOR, maestro
-- incluido). Los editores no borran ni siquiera lo que ellos crearon: es el
-- mismo nivel que exige la interfaz (puedeBorrarContenido).
CREATE POLICY contenido_borrar_solo_administradores
    ON public.noticias
    FOR DELETE TO authenticated
    USING (public.es_administrador());

CREATE POLICY contenido_borrar_solo_administradores
    ON public.eventos
    FOR DELETE TO authenticated
    USING (public.es_administrador());

CREATE POLICY contenido_borrar_solo_administradores
    ON public.anuncios
    FOR DELETE TO authenticated
    USING (public.es_administrador());

-- Cuentas: la única fila que puede borrar directamente es una cuenta
-- autenticada y maestra. El borrado real de cuentas pasa por la función
-- eliminar_usuario_admin (SECURITY DEFINER), a la que esta política no afecta.
CREATE POLICY perfiles_borrar_solo_maestro
    ON public.perfiles_admin
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.perfiles_admin p
            WHERE p.id = auth.uid()
              AND p.es_maestro
        )
    );

COMMIT;

-- -----------------------------------------------------------------------------
-- E) Storage: POR QUÉ NO SE TOCA (decisión, no es un olvido).
--
--    La política que trae Supabase (admin_storage_delete) permite borrar
--    archivos del bucket a cualquier cuenta ACTIVA del panel, editores
--    incluidos. Parece un hueco, pero es exactamente lo que la propia
--    interfaz necesita: al cambiar o quitar una portada, el panel borra el
--    archivo anterior (admin/js/app.js, guardarContenido) y eso lo hacen
--    también los editores. Exigir administrador en storage no aporta
--    seguridad real —los editores ya tienen UPDATE sobre todas las filas de
--    contenido— y en cambio rompería la sustitución de portadas: el DELETE
--    fallaría, el panel solo avisa por consola y el archivo viejo quedaría
--    huérfano en el bucket para siempre.
--
--    Si algún día se quiere cerrar igualmente, el bloque sería (con su
--    propia transacción, para no arriesgar lo de arriba):
--
--        BEGIN;
--        DROP POLICY IF EXISTS admin_storage_delete ON storage.objects;
--        CREATE POLICY admin_storage_delete ON storage.objects
--            FOR DELETE TO authenticated
--            USING (bucket_id = 'portal-publico' AND public.es_administrador());
--        COMMIT;
--
--    Lo que sí queda cubierto: el anónimo no tiene ninguna política de
--    DELETE sobre storage (verificación 4), así que un visitante no puede
--    borrar nada con la clave pública.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- VERIFICACIÓN (solo lectura) - copiar y ejecutar al final.
--
-- 1) Todas las políticas de las cuatro tablas. Debe aparecer exactamente
--    una fila con cmd = DELETE por tabla de contenido, todas con
--    "solo_administradores" (y "solo_maestro" en perfiles_admin).
-- =============================================================================
SELECT
    tablename,
    policyname,
    cmd,
    roles,
    qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('noticias', 'eventos', 'anuncios', 'perfiles_admin')
ORDER BY tablename, cmd, policyname;

-- =============================================================================
-- 2) El rol que usa el navegador (anon) no tiene NINGUNA política de DELETE:
--    esta consulta debe devolver 0 filas.
-- =============================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('noticias', 'eventos', 'anuncios', 'perfiles_admin')
  AND cmd = 'DELETE'
  AND 'anon' = ANY (roles);

-- =============================================================================
-- 3) Storage, solo informativo (ver bloque E): la de DELETE debe seguir
--    pidiendo cuenta ACTIVA (los editores cambian portadas) y las de
--    INSERT/UPDATE idem.
-- =============================================================================
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (qual LIKE '%portal-publico%' OR with_check LIKE '%portal-publico%')
ORDER BY cmd, policyname;

-- =============================================================================
-- 4) Tampoco el visitante anónimo puede borrar archivos (debe dar 0 filas).
-- =============================================================================
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND cmd = 'DELETE'
  AND 'anon' = ANY (roles);
