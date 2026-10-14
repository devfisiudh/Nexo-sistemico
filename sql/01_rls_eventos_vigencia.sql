-- =============================================================================
-- 01_rls_eventos_vigencia.sql
--
-- Corrige una inconsistencia detectada en la auditoría del 14/10/2026.
--
-- Las tres tablas de contenido tienen política de lectura pública, pero solo
-- dos filtran por vigencia. La de `eventos` era `estado='PUBLICADO'` a secas:
-- un evento ya pasado quedaba visible para siempre y uno futuro aparecía antes
-- de tiempo.
--
-- OJO CON LA SEMÁNTICA: la regla de vigencia es INVERSA a la de noticias.
--
--   noticias  →  fecha_publicacion <= now()
--                "no muestres una noticia fechada hacia adelante"
--
--   anuncios  →  fecha_inicio <= now() AND fecha_fin >= now()
--                "muéstrala solo mientras está vigente"
--
--   eventos   →  fecha_fin >= now()
--                "una agenda muestra lo que viene y lo que está en curso;
--                 oculta lo que ya terminó"
--
-- Aplicar aquí el patrón de noticias (fecha_inicio <= now()) sería un error:
-- escondería justamente los eventos futuros, que son el contenido principal de
-- una agenda. Se comprobó en la instancia: con ese filtro, 3 eventos
-- publicados devolvían 0 filas al público.
--
-- Seguro de reejecutar.
-- =============================================================================

BEGIN;


-- Definición previa (14/10/2026):
--   USING (estado = 'PUBLICADO'::public.estado_contenido)
--
-- Definición intermedia, también incorrecta:
--   USING (estado = 'PUBLICADO'::public.estado_contenido
--          AND (fecha_inicio IS NULL OR fecha_inicio <= now())
--          AND (fecha_fin   IS NULL OR fecha_fin   >= now()))


DROP POLICY IF EXISTS publico_eventos_publicados ON public.eventos;

CREATE POLICY publico_eventos_publicados
    ON public.eventos
    FOR SELECT
    TO anon, authenticated
    USING (
        estado = 'PUBLICADO'::public.estado_contenido
        AND (fecha_fin IS NULL OR fecha_fin >= now())
    );


COMMIT;

-- -----------------------------------------------------------------------------
-- VERIFICACIÓN
-- Debe devolver exactamente 1 fila.
-- -----------------------------------------------------------------------------
-- SELECT policyname, cmd, roles::text, qual
-- FROM pg_policies
-- WHERE tablename = 'eventos' AND policyname = 'publico_eventos_publicados';


-- -----------------------------------------------------------------------------
-- PRUEBA FUNCIONAL
--
-- 1) Evento FUTURO, publicado → debe salir 1 objeto para anónimo.
--
-- INSERT INTO public.eventos (titulo, slug, resumen, contenido,
--                              fecha_inicio, fecha_fin, estado)
-- VALUES ('Futuro', 'prueba-futuro', 'x', 'x',
--         now() + interval '10 days', now() + interval '12 days', 'PUBLICADO');
--
-- 2) Evento TERMINADO, publicado → debe salir [] para anónimo.
--
-- INSERT INTO public.eventos (titulo, slug, resumen, contenido,
--                              fecha_inicio, fecha_fin, estado)
-- VALUES ('Pasado', 'prueba-pasado', 'x', 'x',
--         now() - interval '10 days', now() - interval '2 days', 'PUBLICADO');
--
-- 3) Consultar como anónimo:
--
--    curl "https://gkunrwknbuoevylyuftl.supabase.co/rest/v1/eventos?slug=eq.prueba-futuro" \
--         -H "apikey: <TU_CLAVE_PUBLISHABLE>"      # → 1 objeto
--    curl "https://gkunrwknbuoevylyuftl.supabase.co/rest/v1/eventos?slug=eq.prueba-pasado" \
--         -H "apikey: <TU_CLAVE_PUBLISHABLE>"      # → []
--
-- 4) Limpiar:
--
-- DELETE FROM public.eventos WHERE slug IN ('prueba-futuro', 'prueba-pasado');
-- =============================================================================
