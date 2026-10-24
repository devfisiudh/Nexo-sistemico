// js/data/noticias.js — Capa de acceso a datos de Noticias.
//
// El portal lee de Postgres vía PostgREST con la clave publishable.
// La lectura anónima está acotada por RLS: PUBLICADO, o PROGRAMADO cuando la
// fecha de publicación ya llegó; el filtro `.in()` de abajo es defensa en
// profundidad, no la única barrera.
//
// Mientras la tabla no esté migrada, hay respaldo a `data/noticias.json`.
// Ese respaldo es transitorio: cuando verifiquemos la migración se borran
// `cargarLegado`, `normalizarLegado` y los `catch` que los invocan.

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

const RUTA_LEGACY = '../data/noticias.json';

// Estados que el portal acepta mostrar. RLS aplica además la ventana de
// fechas (sql/04_estado_programado.sql): un PROGRAMADO sin fecha llegada no
// vuelve por mucho que lo pidamos aquí.
const ESTADOS_VISIBLES = ['PUBLICADO', 'PROGRAMADO'];

// Si Postgres no responde a tiempo no dejamos al visitante mirando el spinner:
// caemos al respaldo local en su lugar.
const TIMEOUT_MS = 5000;


// ── Consultas ─────────────────────────────────────────────────────────────────

/**
 * Noticias publicadas, de la más reciente a la más antigua.
 * @param {{limite?: number}} opciones
 * @returns {Promise<Noticia[]>}
 */
export async function listarNoticias({ limite = 6 } = {}) {

    try {

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

    } catch (error) {

        console.warn(
            '[datos] Supabase no respondió para noticias; se usa el respaldo local.',
            error
        );

        return await cargarLegado({ limite });

    }

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

    try {

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

    } catch (error) {

        console.warn(
            '[datos] Supabase no respondió para el artículo; se usa el respaldo local.',
            error
        );

        const todas = await cargarLegado({ limite: 200, conContenido: true });
        const encontrada = todas.find(n => n.slug === slug);

        return encontrada ?? null;

    }

}


// ── Normalización ─────────────────────────────────────────────────────────────

/**
 * Limita la espera de la red. Rechaza con un mensaje propio para que el
 * respaldo local se active por igual que ante un error de Supabase.
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


// ── Respaldo transitorio ──────────────────────────────────────────────────────

async function cargarLegado({ limite = 6, conContenido = false } = {}) {

    try {

        const respuesta = await fetch(RUTA_LEGACY);

        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

        const datos = await respuesta.json();

        let noticias = datos.map(normalizarLegado);

        if (conContenido) {
            noticias = await adjuntarContenedores(noticias);
        }

        return noticias.slice(0, limite);

    } catch (error) {

        console.error('[datos] No se pudo cargar el respaldo de noticias.', error);

        return [];

    }

}

/** Los artículos del JSON histórico viven en data/posts/{id}.json aparte. */
async function adjuntarContenedores(noticias) {

    return await Promise.all(noticias.map(async noticia => {

        try {

            const respuesta = await fetch(`../data/posts/${noticia.id}.json`);

            if (!respuesta.ok) return noticia;

            const cuerpo = await respuesta.json();

            return { ...noticia, contenido: cuerpo.contenido_html ?? '' };

        } catch {

            return noticia;

        }

    }));

}

/** El JSON histórico ya traía `fecha` y `color_placeholder` resueltos. */
function normalizarLegado(fila) {

    return {
        id: fila.id,
        slug: `noticia-${fila.id}`,
        titulo: fila.titulo ?? '',
        resumen: fila.resumen ?? '',
        categoria: fila.categoria ?? 'Sin categoría',
        claseCategoria: claseCategoria(fila.categoria),
        fecha: fila.fecha ?? 'Sin fecha',
        imagenUrl: null,
        color: fila.color_placeholder ?? colorDePortada(fila.categoria),
        contenido: fila.contenido_html ?? '',
        fechaOrdenable: null
    };

}
