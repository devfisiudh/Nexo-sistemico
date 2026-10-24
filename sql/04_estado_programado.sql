-- =============================================================================
-- 04_estado_programado.sql
--
-- Nuevo estado PROGRAMADO y reglas de visibilidad que permiten publicar
-- "antes de la fecha de validez".
--
-- ANTES (semántica heredada):
--   `PUBLICADO` + fecha futura = OCULTO hasta que la fecha llegue. El estado
--   y la fecha se pisaban: no había forma de mostrar algo de inmediato si la
--   fecha decía lo contrario, ni de agendar algo sin editar la fecha a mano.
--
-- DESPUÉS (dos estados editoriales explícitos):
--
--   BORRADOR    Oculto siempre. Para lo que aún se está redactando.
--   PROGRAMADO  Se publica SOLO cuando la fecha llega. Si la fecha es NULL o
--               ya pasó, se publica en cuanto se guarda.
--   PUBLICADO   Visible YA en el portal, aunque la fecha de inicio/publicación
--               sea futura. Esto es "publicar antes de la fecha de validez".
--   ARCHIVADO   Oculto; se conserva por si hay que recuperarlo.
--
-- La ventana de vigencia sigue mandando al final: un PUBLICADO cuya fecha_fin
-- ya pasó sigue quedando "Vencido" y fuera del portal (eventos y anuncios).
-- Solo se elimina el bloqueo por fecha de INICIO sobre un PUBLICADO.
--
-- Afecta a:
--   · el ENUM estado_contenido      → + 'PROGRAMADO'
--   · las 3 políticas público_*     → leen PUBLICADO o PROGRAMADO en fecha
--
-- NO toca: políticas de escritura, es_admin_activo(), es_administrador(),
-- ni las políticas de lectura de administración (el panel sigue viendo todo).
--
-- Seguro de reejecutar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ LAS COMPARACIONES SON EN TEXTO (estado::text = 'PROGRAMADO')
--
-- El SQL Editor de Supabase ejecuta todo el texto en UNA sola transacción.
-- PostgreSQL (12+) permite añadir el valor al ENUM dentro de la transacción,
-- pero PROHÍBE usarlo como enum hasta el COMMIT:
--
--     ERROR: 55P04: unsafe use of new value "PROGRAMADO" of enum type
--     HINT:  New enum values must be committed before they can be used.
--
-- Comparar `estado::text = 'PROGRAMADO'` nunca resuelve la etiqueta como
-- valor de enum, así que no dispara esa comprobación y el script entero
-- corre de corrido. Una vez aplicado, la regla se comporta exactamente igual
-- que con la comparación nativa del enum (es texto a texto, mismo resultado
-- por fila).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) NUEVO VALOR DEL ENUM
--
-- En autocommit o dentro de la transacción del editor vale (PG12+). El valor
-- queda disponible para esta misma ejecución solo vía comparación en texto.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE public.estado_contenido
    ADD VALUE IF NOT EXISTS 'PROGRAMADO';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) POLÍTICAS DE LECTURA PÚBLICA
--
-- Se reescriben las políticas cuyo nombre empieza con "publico_" en cada
-- tabla (mismo nombre que ya tenían, descubierto en pg_policies para no
-- romper si algún día se renombraron). Las políticas de administración
-- (es_admin_activo) no se tocan: el panel sigue viendo borradores y vencidos.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;


DO $$
DECLARE
    politica record;
    regla    text;
BEGIN

    FOR politica IN
        SELECT policyname, tablename
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('noticias', 'eventos', 'anuncios')
          AND cmd = 'SELECT'
          AND policyname LIKE 'publico\_%'
        ORDER BY tablename
    LOOP

        CASE politica.tablename

            -- Noticias: PUBLICADO se ve ya; PROGRAMADO espera su fecha.
            -- No hay fecha_fin: una noticia no vence.
            WHEN 'noticias' THEN
                regla := $r$(
                    estado::text = 'PUBLICADO'
                    OR (
                        estado::text = 'PROGRAMADO'
                        AND (fecha_publicacion IS NULL OR fecha_publicacion <= now())
                    )
                )$r$;

            -- Eventos: PROGRAMADO espera el inicio; la agenda sigue ocultando
            -- lo que ya terminó (fecha_fin), sea PUBLICADO o PROGRAMADO.
            WHEN 'eventos' THEN
                regla := $r$(
                    (
                        estado::text = 'PUBLICADO'
                        OR (
                            estado::text = 'PROGRAMADO'
                            AND (fecha_inicio IS NULL OR fecha_inicio <= now())
                        )
                    )
                    AND (fecha_fin IS NULL OR fecha_fin >= now())
                )$r$;

            -- Anuncios: misma lógica que eventos. Se añade el guardas NULL de
            -- fecha_inicio que la política anterior no tenía: un anuncio con
            -- inicio indefinido quedaba invisible para siempre.
            WHEN 'anuncios' THEN
                regla := $r$(
                    (
                        estado::text = 'PUBLICADO'
                        OR (
                            estado::text = 'PROGRAMADO'
                            AND (fecha_inicio IS NULL OR fecha_inicio <= now())
                        )
                    )
                    AND (fecha_fin IS NULL OR fecha_fin >= now())
                )$r$;

        END CASE;

        EXECUTE format(
            'DROP POLICY %I ON public.%I',
            politica.policyname,
            politica.tablename
        );

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING %s',
            politica.policyname,
            politica.tablename,
            regla
        );

    END LOOP;

END $$;


-- Si el patrón "publico_" no coincidiera con ninguna política (nombre
-- cambiado a mano), el DO de arriba no habría hecho nada: se avisa.
DO $$
DECLARE
    cantidad integer;
BEGIN

    SELECT count(*) INTO cantidad
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('noticias', 'eventos', 'anuncios')
      AND cmd = 'SELECT'
      AND policyname LIKE 'publico\_%';

    IF cantidad = 0 THEN
        RAISE WARNING 'No se encontró ninguna política publico_*: revisa pg_policies antes de dar por aplicado el script.';
    END IF;

END $$;


COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
--
-- 1) El ENUM debe listar 4 valores:
--        SELECT enumlabel
--        FROM pg_enum
--        WHERE enumtypid = 'public.estado_contenido'::regtype
--        ORDER BY enumsortorder;
--
-- 2) Las 3 políticas públicas deben mencionar PROGRAMADO:
--        SELECT tablename, policyname, qual
--        FROM pg_policies
--        WHERE schemaname = 'public'
--          AND tablename IN ('noticias', 'eventos', 'anuncios')
--          AND policyname LIKE 'publico\_%';
--
--    Debe haber exactamente 3 filas (una por tabla), y las políticas de
--    administración (es_admin_activo) deben seguir intactas.
--
-- 3) PRUEBA FUNCIONAL desde el panel o con SQL:
--
--    a) Anuncio PUBLICADO con fecha_inicio futura → el público YA lo ve:
--         curl "https://gkunrwknbuoevylyuftl.supabase.co/rest/v1/anuncios?slug=eq.prueba-adelantado" \
--              -H "apikey: <TU_CLAVE_PUBLISHABLE>"   → 1 objeto
--
--    b) El mismo, en PROGRAMADO → el público NO lo ve hasta la fecha:
--         UPDATE public.anuncios SET estado = 'PROGRAMADO' WHERE slug = 'prueba-adelantado';
--         ...curl de arriba...                       → []
--
--    c) PROGRAMADO con fecha pasada → se publica solo:
--         UPDATE public.anuncios
--            SET estado = 'PROGRAMADO', fecha_inicio = now() - interval '1 hour'
--          WHERE slug = 'prueba-adelantado';
--         ...curl de arriba...                       → 1 objeto
--
--    d) Limpiar:
--         DELETE FROM public.anuncios WHERE slug = 'prueba-adelantado';
--
-- NOTA PARA EL PORTAL: la capa de datos (js/data/*.js) pide
-- estado IN ('PUBLICADO', 'PROGRAMADO') y RLS aplica las fechas. Si añades
-- este script a una base desplegada, recién ahí PROGRAMADO empieza a verse.
-- =============================================================================
