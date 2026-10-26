// js/data/eventos.js — Capa de acceso a datos de Eventos.
//
// DECISIÓN: `accion` se deriva de `url_inscripcion` en vez de agregar una
// columna. Un evento o acepta inscripción por un formulario/enlace externo o
// no la acepta; no hay un tercer caso que el diseño no sepa pintar. Así el
// panel no tiene un campo más que llenar y no puede quedar inconsistente
// (acción interna apuntando a una URL vacía, o al revés).
//
// Mismo patrón que js/data/noticias.js: una sola fuente (Supabase) y un
// timeout que convierte una conexión colgada en un error visible en la vista.
// El respaldo a data/eventos.json se retiró con la migración completa.

import { supabase } from '../config/supabase.js';
import {
    formatearFecha,
    formatearRangoFechas,
    colorPorClave,
    vigenciaEvento,
    aFechaOrdenable
} from '../utils/formato.js';

const CAMPOS = `
    id,
    slug,
    titulo,
    resumen,
    contenido,
    imagen_url,
    lugar,
    fecha_inicio,
    fecha_fin,
    url_inscripcion,
    estado,
    created_at
`;

const CAMPOS_DETALLE = `${CAMPOS}`;

// Estados que el portal acepta mostrar. RLS aplica además la ventana de
// fechas (sql/04_estado_programado.sql): un PROGRAMADO sin fecha llegada no
// vuelve por mucho que lo pidamos aquí.
const ESTADOS_VISIBLES = ['PUBLICADO', 'PROGRAMADO'];

const TIMEOUT_MS = 5000;


// ── Consultas ─────────────────────────────────────────────────────────────────

/**
 * Agenda upcoming, de lo más próximo a lo más lejano.
 * @param {{limite?: number}} opciones
 * @returns {Promise<Evento[]>}
 */
export async function listarEventos({ limite = 6 } = {}) {

    const { data, error } = await conTimeout(
        supabase
            .from('eventos')
            .select(CAMPOS)
            .in('estado', ESTADOS_VISIBLES)
            .order('fecha_inicio', {
                ascending: true,
                nullsfirst: false
            })
            .limit(limite)
    );

    if (error) throw error;

    return (data ?? []).map(normalizar);

}


/**
 * El próximo evento de la agenda. Alimenta la portada del Home.
 * @returns {Promise<Evento|null>}
 */
export async function obtenerProximoEvento() {

    const eventos = await listarEventos({ limite: 1 });

    return eventos[0] ?? null;

}


/**
 * Detalle de un evento por slug legible.
 * @param {string} slug
 * @returns {Promise<Evento|null>}
 */
export async function obtenerEventoPorSlug(slug) {

    if (!slug) return null;

    const { data, error } = await conTimeout(
        supabase
            .from('eventos')
            .select(CAMPOS_DETALLE)
            .eq('slug', slug)
            .in('estado', ESTADOS_VISIBLES)
            .maybeSingle()
    );

    if (error) throw error;

    return data ? normalizar(data) : null;

}


// ── Normalización ─────────────────────────────────────────────────────────────

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


function normalizar(fila) {

    const urlInscripcion = (fila.url_inscripcion ?? '').trim();
    const tieneInscripcion = urlInscripcion.length > 0;

    return {
        id: fila.id,
        slug: fila.slug,
        titulo: fila.titulo ?? '',
        resumen: fila.resumen ?? '',
        contenido: fila.contenido ?? '',
        lugar: fila.lugar ?? 'Campus UDH',

        fechaInicio: fila.fecha_inicio ?? null,
        fechaFin: fila.fecha_fin ?? null,
        fechaTexto: formatearRangoFechas(fila.fecha_inicio, fila.fecha_fin),
        ordenable: aFechaOrdenable(fila.fecha_inicio),

        imagenUrl: fila.imagen_url ?? null,
        color: colorPorClave(fila.slug ?? fila.titulo),

        // Derivado: sin columna propia, ver cabecera del archivo.
        tieneInscripcion,
        urlInscripcion,
        textoBoton: tieneInscripcion ? 'Inscribirse' : 'Ver detalles',
        icono: tieneInscripcion ? '↗' : '→',

        vigencia: vigenciaEvento(fila.fecha_inicio, fila.fecha_fin)
    };

}
