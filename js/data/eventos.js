// js/data/eventos.js — Capa de acceso a datos de Eventos.
//
// Reemplaza la lectura de data/eventos.json y el concepto `accion`
// ("interno" | "externo") del JSON antiguo.
//
// DECISIÓN: `accion` se deriva de `url_inscripcion` en vez de agregar una
// columna. Un evento o acepta inscripción por un formulario/enlace externo o
// no la acepta; no hay un tercer caso que el diseño no sepa pintar. Así el
// panel no tiene un campo más que llenar y no puede quedar inconsistente
// (acción interna apuntando a una URL vacía, o al revés).
//
// Mismo patrón que js/data/noticias.js: Supabase con respaldo local y timeout.

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

const RUTA_LEGACY = '../data/eventos.json';

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

    try {

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

    } catch (error) {

        console.warn(
            '[datos] Supabase no respondió para eventos; se usa el respaldo local.',
            error
        );

        return await cargarLegado({ limite });

    }

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

    try {

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

    } catch (error) {

        console.warn(
            '[datos] Supabase no respondió para el evento; se usa el respaldo local.',
            error
        );

        const todos = await cargarLegado({ limite: 200 });
        const encontrado = todos.find(e => e.slug === slug);

        return encontrado ?? null;

    }

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


// ── Respaldo transitorio ──────────────────────────────────────────────────────

async function cargarLegado({ limite = 6 } = {}) {

    try {

        const respuesta = await fetch(RUTA_LEGACY);

        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

        const datos = await respuesta.json();

        return datos.map(normalizarLegado).slice(0, limite);

    } catch (error) {

        console.error('[datos] No se pudo cargar el respaldo de eventos.', error);

        return [];

    }

}

/** Traduce el JSON antiguo al mismo formato que produce Postgres. */
function normalizarLegado(evento) {

    const esInterno = (evento.accion ?? 'externo') === 'interno';
    const url = esInterno ? '' : (evento.url_destino ?? '').trim();
    const tieneInscripcion = url.length > 0;

    const iso = aIsoDesdeTexto(evento.fecha);

    return {
        id: evento.id,
        slug: `evento-${evento.id}`,
        titulo: evento.titulo ?? '',
        resumen: evento.descripcion ?? '',
        contenido: `<p>${evento.descripcion ?? ''}</p>`,
        lugar: evento.lugar ?? 'Campus UDH',

        fechaInicio: iso,
        fechaFin: null,
        fechaTexto: evento.fecha ?? 'Fecha por definir',
        ordenable: aFechaOrdenable(iso),

        imagenUrl: null,
        color: evento.imagen ?? '#a4161a',

        tieneInscripcion,
        urlInscripcion: url,
        textoBoton: evento.texto_boton ?? (tieneInscripcion ? 'Inscribirse' : 'Ver detalles'),
        icono: tieneInscripcion ? '↗' : '→',

        vigencia: vigenciaEvento(iso, null)
    };

}

/** "20 Abr, 2026" → ISO. Solo para el respaldo; ya no se usa con Postgres. */
function aIsoDesdeTexto(texto) {

    if (!texto) return null;

    const meses = {
        Ene: 0, Feb: 1, Mar: 2, Abr: 3, May: 4, Jun: 5,
        Jul: 6, Ago: 7, Sep: 8, Oct: 9, Nov: 10, Dic: 11
    };

    const partes = texto.replace(',', '').split(' ');
    const dia = parseInt(partes[0], 10);
    const mes = meses[partes[1]];
    const anio = parseInt(partes[2], 10);

    if (Number.isNaN(dia) || mes === undefined || Number.isNaN(anio)) return null;

    return new Date(Date.UTC(anio, mes, dia)).toISOString();

}
