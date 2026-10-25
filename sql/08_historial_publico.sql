-- =============================================================================
-- 08_historial_publico.sql
-- Histórico visible para cualquier visitante del portal
--
-- Problema que resuelve:
--   Las políticas públicas (sql/01, sql/04) solo dejan leer PUBLICADO dentro
--   de su ventana de vigencia. Es correcto: la portada y los listados no
--   deben arrastrar contenido archivado. Pero el visitante sí quiere poder
--   consultar el pasado.
--
-- Solución: cuatro funciones SECURITY DEFINER que abren una ventana
-- concreta. La política del listado NO se toca:
--
--   historial_noticias(límite)  → noticias con estado ARCHIVADO
--   historial_eventos(límite)   → eventos ARCHIVADOS y eventos PUBLICADOS
--                                  cuya fecha_fin ya pasó (vencidos)
--   historial_noticia(slug)     → cuerpo completo de una noticia archivada
--   historial_evento(slug)      → cuerpo completo de un evento archivado o
--                                  vencido
--
-- Lo que NUNCA devuelven: borradores ni programados futuros. Eso queda
-- garantizado en el WHERE de cada función, no en el JavaScript del portal.
--
-- Devuelven jsonb en vez de una tabla tipada para no acoplarse a los tipos
-- de columna (enum de estado, uuid, timestamptz) y seguir siendo estables
-- si el esquema cambia.
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) NOTICIAS ARCHIVADAS (listado del histórico)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.historial_noticias(p_limite integer DEFAULT 100)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', n.id,
                'slug', n.slug,
                'titulo', n.titulo,
                'resumen', n.resumen,
                'categoria', n.categoria,
                'imagen_url', n.imagen_url,
                'estado', n.estado,
                'historico', 'Archivado',
                'fecha_publicacion', n.fecha_publicacion,
                'created_at', n.created_at
            )
            ORDER BY COALESCE(n.fecha_publicacion, n.created_at) DESC
        ),
        '[]'::jsonb
    )
    FROM (
        SELECT *
        FROM public.noticias
        WHERE estado = 'ARCHIVADO'
        ORDER BY COALESCE(fecha_publicacion, created_at) DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limite, 100), 1), 500)
    ) AS n;
$$;

REVOKE ALL ON FUNCTION public.historial_noticias(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.historial_noticias(integer) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2) EVENTOS ARCHIVADOS Y VENCIDOS (listado del histórico)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.historial_eventos(p_limite integer DEFAULT 100)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', n.id,
                'slug', n.slug,
                'titulo', n.titulo,
                'resumen', n.resumen,
                'imagen_url', n.imagen_url,
                'lugar', n.lugar,
                'estado', n.estado,
                'historico',
                    CASE WHEN n.estado = 'ARCHIVADO' THEN 'Archivado' ELSE 'Vencido' END,
                'fecha_inicio', n.fecha_inicio,
                'fecha_fin', n.fecha_fin,
                'created_at', n.created_at
            )
            ORDER BY n.fecha_orden DESC
        ),
        '[]'::jsonb
    )
    FROM (
        SELECT e.*,
               COALESCE(e.fecha_fin, e.fecha_inicio, e.created_at) AS fecha_orden
        FROM public.eventos e
        WHERE e.estado = 'ARCHIVADO'
           OR (e.estado = 'PUBLICADO' AND e.fecha_fin IS NOT NULL AND e.fecha_fin < now())
        ORDER BY COALESCE(e.fecha_fin, e.fecha_inicio, e.created_at) DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limite, 100), 1), 500)
    ) AS n;
$$;

REVOKE ALL ON FUNCTION public.historial_eventos(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.historial_eventos(integer) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3) DETALLE DE UNA NOTICIA ARCHIVADA (por slug)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.historial_noticia(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'id', n.id,
        'slug', n.slug,
        'titulo', n.titulo,
        'resumen', n.resumen,
        'contenido', n.contenido,
        'categoria', n.categoria,
        'imagen_url', n.imagen_url,
        'estado', n.estado,
        'historico', 'Archivado',
        'fecha_publicacion', n.fecha_publicacion,
        'created_at', n.created_at
    )
    FROM public.noticias n
    WHERE n.slug = p_slug
      AND n.estado = 'ARCHIVADO'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.historial_noticia(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.historial_noticia(text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4) DETALLE DE UN EVENTO ARCHIVADO O VENCIDO (por slug)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.historial_evento(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'id', n.id,
        'slug', n.slug,
        'titulo', n.titulo,
        'resumen', n.resumen,
        'contenido', n.contenido,
        'imagen_url', n.imagen_url,
        'lugar', n.lugar,
        'url_inscripcion', n.url_inscripcion,
        'estado', n.estado,
        'historico',
            CASE WHEN n.estado = 'ARCHIVADO' THEN 'Archivado' ELSE 'Vencido' END,
        'fecha_inicio', n.fecha_inicio,
        'fecha_fin', n.fecha_fin,
        'created_at', n.created_at
    )
    FROM public.eventos n
    WHERE n.slug = p_slug
      AND (
            n.estado = 'ARCHIVADO'
         OR (n.estado = 'PUBLICADO' AND n.fecha_fin IS NOT NULL AND n.fecha_fin < now())
      )
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.historial_evento(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.historial_evento(text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5) VERIFICACIÓN (desde el SQL Editor sale como null: auth.uid() no aporta
--    nada aquí, pero las funciones son públicas, así que también sirve
--    probarlas con curl usando solo la clave publishable)
-- ---------------------------------------------------------------------------
-- SELECT public.historial_noticias(5);
-- SELECT public.historial_eventos(5);
--
-- curl 'https://TU-PROYECTO.supabase.co/rest/v1/rpc/historial_noticias' \
--   -H 'apikey: CLAVE_PUBLISHABLE' -H 'content-type: application/json' \
--   -d '{"p_limite": 5}'
--
-- Lo que NO debe salir nunca de estas funciones:
--   SELECT public.historial_noticia('slug-de-un-borrador');   → null
