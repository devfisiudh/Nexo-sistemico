// js/data/anuncios.js — Capa de acceso a datos del tablón de Comunidad.
//
// Mismo patrón que noticias.js y eventos.js: Supabase con respaldo local y
// timeout, y una capa de normalización para que la vista no sepa de dónde
// salió el dato.
//
// NOTA SOBRE EL AUTOR: la tabla tiene `autor_id` (rastro de auditoría) y
// `autor_texto` (lo que ve el visitante). No se puede resolver el nombre desde
// perfiles_admin porque esa tabla no es legible por anónimos: ver
// sql/03_anuncios_autor_texto.sql.

import { supabase } from '../config/supabase.js';
import { formatearRangoFechas } from '../utils/formato.js';

const CAMPOS = `
    id,
    titulo,
    tipo,
    texto,
    imagen_url,
    destino_url,
    destino_label,
    destino_tipo,
    modo,
    autor_texto,
    fecha_inicio,
    fecha_fin,
    created_at
`;

const RUTA_LEGACY = '../data/anuncios.json';

// Estados que el portal acepta mostrar. RLS aplica además la ventana de
// fechas (sql/04_estado_programado.sql): un PROGRAMADO sin fecha llegada no
// vuelve por mucho que lo pidamos aquí.
const ESTADOS_VISIBLES = ['PUBLICADO', 'PROGRAMADO'];

const TIMEOUT_MS = 5000;


// ── Consultas ─────────────────────────────────────────────────────────────────

/**
 * Anuncios vigentes, del más reciente al más antiguo.
 * @param {{limite?: number}} opciones
 * @returns {Promise<Anuncio[]>}
 */
export async function listarAnuncios({ limite = 12 } = {}) {

    try {

        const { data, error } = await conTimeout(
            supabase
                .from('anuncios')
                .select(CAMPOS)
                .in('estado', ESTADOS_VISIBLES)
                // El orden va por created_at, NO por fecha_inicio: esa columna
                // controla la visibilidad, no la recencia. Ordenar por ella
                // mezcla un aviso vigente desde ayer con uno sin fecha, y deja
                // el orden a merced de empates cuando varios comparten día.
                .order('created_at', { ascending: false })
                .limit(limite)
        );

        if (error) throw error;

        return (data ?? []).map(normalizar);

    } catch (error) {

        console.warn(
            '[datos] Supabase no respondió para anuncios; se usa el respaldo local.',
            error
        );

        return await cargarLegado({ limite });

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

    const destinoTipo = fila.destino_tipo ?? 'ninguno';
    const tieneDestino = destinoTipo !== 'ninguno'
        && Boolean((fila.destino_url ?? '').trim());

    return {
        id: fila.id,
        titulo: fila.titulo ?? '',
        tipo: (fila.tipo ?? 'GENERAL').toLowerCase(),
        modo: fila.modo ?? 'texto',
        texto: fila.texto ?? '',
        autor: fila.autor_texto ?? '',
        imagenUrl: (fila.imagen_url ?? '').trim() || null,

        destinoUrl: (fila.destino_url ?? '').trim(),
        destinoTipo: tieneDestino ? destinoTipo : 'ninguno',
        destinoLabel: fila.destino_label ?? 'Ver más',

        fechaInicio: fila.fecha_inicio ?? null,
        fechaFin: fila.fecha_fin ?? null,
        fechaTexto: formatearRangoFechas(fila.fecha_inicio, fila.fecha_fin)
    };

}


// ── Respaldo transitorio ──────────────────────────────────────────────────────

async function cargarLegado({ limite = 12 } = {}) {

    try {

        const respuesta = await fetch(RUTA_LEGACY);

        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

        const datos = await respuesta.json();

        return datos.slice(0, limite).map(fila => ({
            id: fila.id,
            titulo: fila.titulo ?? '',
            tipo: (fila.tipo_anuncio ?? 'info').toLowerCase(),
            modo: fila.modo ?? 'texto',
            texto: fila.texto ?? '',
            autor: fila.autor ?? '',
            imagenUrl: (fila.imagen_url ?? '').trim() || null,

            destinoUrl: fila.destino_url ?? '',
            destinoTipo: fila.destino_tipo ?? 'ninguno',
            destinoLabel: fila.destino_label ?? 'Ver más',

            fechaInicio: null,
            fechaFin: null,
            fechaTexto: ''
        }));

    } catch (error) {

        console.error('[datos] No se pudo cargar el respaldo de anuncios.', error);

        return [];

    }

}
