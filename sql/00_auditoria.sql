-- =============================================================================
-- 00_auditoria.sql — CONSULTAS DE SOLO LECTURA
-- Ejecutar en: Supabase → SQL Editor
-- No modifica nada. Copiar y ejecutar los 4 bloques por separado.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A) COLUMNAS, TIPOS, NULABILIDAD Y DEFAULTS
-- -----------------------------------------------------------------------------
SELECT
    table_name,
    ordinal_position,
    column_name,
    data_type,
    udt_name,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('perfiles_admin', 'noticias', 'eventos', 'anuncios')
ORDER BY table_name, ordinal_position;


-- -----------------------------------------------------------------------------
-- B) POLÍTICAS RLS DE LAS TABLAS PÚBLICAS
--    ⚠️ ESTE ES EL BLOQUE MÁS IMPORTANTE.
--    Si `news` no aparece, la tabla NO tiene políticas → anon no puede leer.
-- -----------------------------------------------------------------------------
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('perfiles_admin', 'noticias', 'eventos', 'anuncios')
ORDER BY tablename, policyname;


-- -----------------------------------------------------------------------------
-- C) VALORES EXACTOS DE LOS ENUM
--    ⚠️ Necesario para saber si es 'PUBLICADO' o 'PUBLICADO' en minúscula, etc.
-- -----------------------------------------------------------------------------
SELECT
    n.nspname        AS esquema,
    t.typname        AS tipo_enum,
    e.enumlabel      AS valor,
    e.enumsortorder  AS orden
FROM pg_type t
JOIN pg_enum e       ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY t.typname, e.enumsortorder;


-- -----------------------------------------------------------------------------
-- D) RESTRICCIONES Y CLAVES FORÁNEAS
-- -----------------------------------------------------------------------------
SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema    = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema    = ccu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('perfiles_admin', 'noticias', 'eventos', 'anuncios')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;


-- -----------------------------------------------------------------------------
-- E) EXTRA — ¿QUÉ HAY REALMENTE DENTRO?
--    Solo lectura. Requiere que la tabla tenga alguna fila publicable.
--    Reemplaza 'noticias' por 'eventos' o 'anuncios' si hace falta.
-- -----------------------------------------------------------------------------
-- EXPECTATIVA: 0 filas  → la tabla está vacía (no migrated todavía)
-- EXPECTATIVA: filas pero todas con estado='BORRADOR' → nada es público aún
SELECT * FROM public.noticias LIMIT 5;


-- -----------------------------------------------------------------------------
-- F) EXTRA — RLS ACTIVO EN CADA TABLA
--    rls_enabled = FALSE significa que la tabla está ABIERTA a anon.
-- -----------------------------------------------------------------------------
SELECT
    c.relname AS tabla,
    c.relrowsecurity     AS rls_habilitado,
    c.relforcerowsecurity AS rls_forzado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('perfiles_admin', 'noticias', 'eventos', 'anuncios')
ORDER BY c.relname;
