// js/data/anuncios.js — Capa de acceso a datos del tablón de Comunidad.
//
// Mismo patrón que noticias.js y eventos.js: una sola fuente (Supabase), un
// timeout que convierte una conexión colgada en un error visible en la vista,
// y una capa de normalización para que la vista no sepa de dónde salió el
// dato. El respaldo a data/anuncios.json se retiró con la migración completa.
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
