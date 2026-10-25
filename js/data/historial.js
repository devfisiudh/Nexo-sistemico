// js/data/historial.js — Capa de datos del HISTÓRICO público.
//
// El visitante no puede leer archivados ni vencidos por RLS (y debe seguir
// sin poder: es lo que mantiene la portada limpia). Estas funciones llaman a
// las RPC de sql/08_historial_publico.sql, que abren una ventana concreta:
//
//   historial_noticias   → solo estado ARCHIVADO
//   historial_eventos    → ARCHIVADO, o PUBLICADO con fecha_fin pasada
//   historial_noticia    → detalle por slug de una noticia archivada
//   historial_evento     → detalle por slug de un evento archivado/vencido
//
// Si sql/08 todavía no está aplicada, PostgREST responde «function not
// found» (PGRST202): se lanza el error y la vista lo dice con claridad, en
// vez de fingir que el histórico está vacío.

import { supabase } from '../config/supabase.js';
import {
    formatearFecha,
    formatearRangoFechas,
    colorDePortada,
    colorPorClave,
    claseCategoria
} from '../utils/formato.js';

const TIMEOUT_MS = 5000;


// ── Consultas ─────────────────────────────────────────────────────────────────

/**
 * Noticias archivadas, de la más reciente a la más antigua.
 * @param {{limite?: number}} opciones
 * @returns {Promise<NoticiaHistorica[]>}
 */
export async function listarHistoricoNoticias({ limite = 100 } = {}) {

    const filas = await llamar('historial_noticias', { p_limite: limite });

    return (filas ?? []).map(normalizarNoticia);

}


/**
 * Eventos archivados y vencidos, del más reciente al más antiguo.
 * @param {{limite?: number}} opciones
 * @returns {Promise<EventoHistorico[]>}
 */
export async function listarHistoricoEventos({ limite = 100 } = {}) {

    const filas = await llamar('historial_eventos', { p_limite: limite });

    return (filas ?? []).map(normalizarEvento);

}


/**
 * Cuerpo completo de una noticia archivada.
 * @param {string} slug
 * @returns {Promise<NoticiaHistorica|null>}
 */
export async function obtenerNoticiaArchivada(slug) {

    if (!slug) return null;

    const fila = await llamar('historial_noticia', { p_slug: slug }, true);

    return fila ? normalizarNoticia(fila) : null;

}


/**
 * Cuerpo completo de un evento archivado o vencido.
 * @param {string} slug
 * @returns {Promise<EventoHistorico|null>}
 */
export async function obtenerEventoArchivado(slug) {

    if (!slug) return null;

    const fila = await llamar('historial_evento', { p_slug: slug }, true);

    return fila ? normalizarEvento(fila) : null;

}


// ── Internos ──────────────────────────────────────────────────────────────────

/**
 * Llama a una RPC del histórico con el mismo tope de espera que el resto
 * del portal. Lanza el error (sin respaldo local: el histórico no vive en
 * el JSON legado) para que la vista pueda distinguir «vacío» de «no se pudo
 * cargar».
 */
async function llamar(nombre, parametros = {}, esDetalle = false) {

    let temporizador;

    const limite = new Promise((_, rechazar) => {
        temporizador = setTimeout(
            () => rechazar(new Error(`Supabase no respondió en ${TIMEOUT_MS} ms`)),
            TIMEOUT_MS
        );
    });

    try {

        const { data, error } = await Promise.race([
            supabase.rpc(nombre, parametros),
            limite
        ]);

        if (error) throw error;

        if (esDetalle) return data ?? null;

        return Array.isArray(data) ? data : [];

    } finally {
        clearTimeout(temporizador);
    }

}


function normalizarNoticia(fila) {

    const fecha = fila.fecha_publicacion ?? fila.created_at ?? null;

    return {
        slug: fila.slug ?? '',
        titulo: fila.titulo ?? '',
        resumen: fila.resumen ?? '',
        contenido: fila.contenido ?? '',
        categoria: fila.categoria ?? 'Sin categoría',
        claseCategoria: claseCategoria(fila.categoria),
        imagenUrl: fila.imagen_url ?? null,
        color: colorDePortada(fila.categoria),
        historico: fila.historico ?? 'Archivado',
        fecha: fecha ? formatearFecha(fecha) : 'Sin fecha',
        fechaOrdenable: fecha
    };

}


function normalizarEvento(fila) {

    return {
        slug: fila.slug ?? '',
        titulo: fila.titulo ?? '',
        resumen: fila.resumen ?? '',
        contenido: fila.contenido ?? '',
        imagenUrl: fila.imagen_url ?? null,
        lugar: fila.lugar ?? 'Campus UDH',
        historico: fila.historico ?? 'Archivado',

        fechaInicio: fila.fecha_inicio ?? null,
        fechaFin: fila.fecha_fin ?? null,
        fechaTexto: formatearRangoFechas(fila.fecha_inicio, fila.fecha_fin),

        color: colorPorClave(fila.slug ?? fila.titulo),

        // Un evento del histórico nunca admite inscripción: si trae enlace
        // es porque estaba publicado cuando venció, y ya no procede.
        tieneInscripcion: false,
        urlInscripcion: ''
    };

}
