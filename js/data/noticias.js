// js/data/noticias.js — Capa de acceso a datos de Noticias.
//
// El portal lee de Postgres vía PostgREST con la clave publishable.
// La lectura anónima está acotada por RLS: PUBLICADO, o PROGRAMADO cuando la
// fecha de publicación ya llegó; el filtro `.in()` de abajo es defensa en
// profundidad, no la única barrera.
//
// Si Supabase falla o tarda demasiado, el error sube hasta la vista, que es
// la que muestra su mensaje. Antes había un respaldo a data/noticias.json:
// se retiró con la migración completa, porque ante un fallo era preferible
// ver el error que contenido antiguo desactualizado.

import { supabase } from '../config/supabase.js';
import { formatearFecha, colorDePortada, claseCategoria } from '../utils/formato.js';

const CAMPOS = `
    id,
    slug,
    titulo,
    resumen,
    categoria,
    imagen_url,
    estado,
    fecha_publicacion,
    created_at
`;

// El listado no arrastra el cuerpo completo: son kilobytes por article que
// el Home y la grilla no necesitan.
const CAMPOS_DETALLE = `${CAMPOS},
    contenido
`;

// Estados que el portal acepta mostrar. RLS aplica además la ventana de
// fechas (sql/04_estado_programado.sql): un PROGRAMADO sin fecha llegada no
// vuelve por mucho que lo pidamos aquí.
const ESTADOS_VISIBLES = ['PUBLICADO', 'PROGRAMADO'];

// Sin límite, una conexión colgada dejaría al visitante mirando el spinner
// para siempre: el rechazo llega a la vista y ella decide qué pintar.
const TIMEOUT_MS = 5000;


// ── Consultas ─────────────────────────────────────────────────────────────────

/**
 * Noticias publicadas, de la más reciente a la más antigua.
 * @param {{limite?: number}} opciones
 * @returns {Promise<Noticia[]>}
 */
export async function listarNoticias({ limite = 6 } = {}) {

    const { data, error } = await conTimeout(
        supabase
            .from('noticias')
            .select(CAMPOS)
            .in('estado', ESTADOS_VISIBLES)
            .order('fecha_publicacion', {
                ascending: false,
                nullsfirst: false
            })
            .limit(limite)
    );

    if (error) throw error;

    return (data ?? []).map(normalizar);

}


/**
 * La noticia más reciente publicada. Alimenta la portada del Home.
 * @returns {Promise<Noticia|null>}
 */
export async function obtenerUltimaNoticia() {

    const noticias = await listarNoticias({ limite: 1 });

    return noticias[0] ?? null;

}


/**
 * Busca una noticia por su slug legible.
 * @param {string} slug
 * @returns {Promise<Noticia|null>} null si no existe o no está publicada.
 */
export async function obtenerNoticiaPorSlug(slug) {

    if (!slug) return null;

    const { data, error } = await conTimeout(
        supabase
            .from('noticias')
            .select(CAMPOS_DETALLE)
            .eq('slug', slug)
            .in('estado', ESTADOS_VISIBLES)
            .maybeSingle()
    );

    if (error) throw error;

    return data ? normalizar(data) : null;

}


// ── Normalización ─────────────────────────────────────────────────────────────

/**
 * Limita la espera de la red y propaga el error a la vista.
 */
function conTimeout(promesa, ms = TIMEOUT_MS) {

    let temporizador;

    const limite = new Promise((_, rechazar) => {
        temporizador = setTimeout(
            () => rechazar(new Error(`Supabase no respondió en ${ms} ms`)),
            ms
        );
    });

    return Promise.race([promesa, limite])
        .finally(() => clearTimeout(temporizador));

}

/**
 * Convierte una fila de Postgres a la forma que las vistas ya consumen.
 * Así el render no sabe de dónde salió el dato.
 */
function normalizar(fila) {

    const fecha = fila.fecha_publicacion ?? fila.created_at;

    return {
        id: fila.id,
        slug: fila.slug,
        titulo: fila.titulo ?? '',
        resumen: fila.resumen ?? '',
        categoria: fila.categoria ?? 'Sin categoría',
        claseCategoria: claseCategoria(fila.categoria),
        fecha: formatearFecha(fecha),
        imagenUrl: fila.imagen_url ?? null,
        color: colorDePortada(fila.categoria),
        contenido: fila.contenido ?? '',
        fechaOrdenable: fecha ?? null
    };

}
