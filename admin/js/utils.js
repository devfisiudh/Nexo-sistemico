// admin/js/utils.js — Funciones puras compartidas por el panel.
//
// Estas utilidades estaban repetidas dentro de noticia-editor.js y
// noticias.js. Se extrajeron aquí para que Eventos y Anuncios no añadan una
// tercera copia: cualquier corrección (un slug mal normalizado, un desfase de
// zona horaria) se hace una vez y aplica a todo el panel.
//
// Sin dependencias. Nada aquí toca el DOM ni la red.

/** Convertir texto libre en un slug seguro para URL. */
export function normalizarSlug(texto) {
    return (texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * TIMESTAMPTZ → valor de <input type="datetime-local">.
 *
 * El input entrega una hora local sin zona ("2026-11-20T09:00"). Para que al
 * volver a leerla caiga en el mismo instante que guardamos, se convierte
 * desplazando por el offset del navegador y recortando la Z.
 */
export function convertirFechaParaInput(fecha) {
    if (!fecha) return '';

    const valor = new Date(fecha);

    if (Number.isNaN(valor.getTime())) return '';

    const offset = valor.getTimezoneOffset();
    const local = new Date(valor.getTime() - offset * 60000);

    return local.toISOString().slice(0, 16);
}

/** <input datetime-local> → TIMESTAMPTZ. Devuelve null si está vacío. */
export function convertirInputAFecha(valor) {
    if (!valor) return null;

    const fecha = new Date(valor);

    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

/**
 * Empareja un <input type="datetime-local"> con su casilla de "indefinido".
 *
 * En la base el valor indefinido es NULL, y las políticas RLS ya lo tratan
 * como "sin límite" (`fecha_fin IS NULL OR fecha_fin >= now()`). La casilla
 * existe para que NULL sea una decisión explícita y no un campo que se
 * quedó vacío sin querer.
 *
 * Al marcar la casilla el input se deshabilita pero CONSERVA su valor: si el
 * administrador se equivoca y la desmarca, recupera lo que había escrito.
 *
 * @returns {{leer: () => string|null, aplicar: (iso: string|null) => void}}
 */
export function conectarIndefinido(input, checkbox) {

    const sinPareja = { leer: () => null, aplicar: () => {} };

    if (!input || !checkbox) return sinPareja;

    const sincronizar = () => {
        input.disabled = checkbox.checked;
        input.setAttribute('aria-disabled', String(checkbox.checked));
    };

    checkbox.addEventListener('change', sincronizar);
    sincronizar();

    return {

        leer: () => checkbox.checked
            ? null
            : convertirInputAFecha(input.value),

        aplicar: (iso) => {
            checkbox.checked = !iso;

            if (iso) {
                input.value = convertirFechaParaInput(iso);
            }

            sincronizar();

        }

    };

}

/** Formato corto para las tablas del panel. */
export function formatearFecha(fecha) {
    if (!fecha) return '—';

    const valor = new Date(fecha);

    if (Number.isNaN(valor.getTime())) return '—';

    return new Intl.DateTimeFormat('es-PE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    }).format(valor);
}

/** Rango de un evento: "20 nov 2026" o "20 nov 2026 → 22 nov 2026". */
export function formatearRango(inicio, fin) {
    const desde = formatearFecha(inicio);

    if (!fin) return desde === '—' ? 'Sin fechas' : desde;

    return `${desde} → ${formatearFecha(fin)}`;
}

/**
 * Traduce los dos ENUM independientes (estado editorial + ventana de
 * vigencia) a un único estado derivado que el administrador pueda leer sin
 * consultar la política RLS.
 *
 * El problema que resuelve: `estado = 'PUBLICADO'` NO significa "visible en
 * el portal". Un anuncio con fecha_inicio mañana, o un evento cuya fecha_fin ya
 * pasó, están PUBLICADOS pero la política `publico_*_publicados` los excluye.
 * Sin esta derivación el panel miente.
 *
 * @param {{estado: string, fechaInicio?: string|null, fechaFin?: string|null}} datos
 * @returns {{clave: string, etiqueta: string, clase: string, publicable: boolean}}
 */
export function derivarVisibilidad({ estado, fechaInicio, fechaFin } = {}) {

    // Primero lo editorial: archivar o dejar en borrador outweighs cualquier fecha.
    if (estado === 'ARCHIVADO') return VISIBILIDAD.ARCHIVADO;
    if (estado === 'BORRADOR') return VISIBILIDAD.BORRADOR;

    // Estado inesperado (typo, valor nuevo del ENUM): no inventar visibilidad.
    if (estado !== 'PUBLICADO') {
        return { clave: 'DESCONOCIDO', etiqueta: estado || '—', clase: 'archivado', publicable: false };
    }

    const inicioMs = fechaInicio ? new Date(fechaInicio).getTime() : NaN;
    const finMs = fechaFin ? new Date(fechaFin).getTime() : NaN;

    const tieneInicio = !Number.isNaN(inicioMs);
    const tieneFin = !Number.isNaN(finMs);
    const ahora = Date.now();

    // Programado: aún no empieza. Si no hay fecha de inicio, se asume visible.
    if (tieneInicio && inicioMs > ahora) return VISIBILIDAD.PROGRAMADO;

    // Vencido: la ventana ya se cerró.
    if (tieneFin && finMs < ahora) return VISIBILIDAD.VENCIDO;

    return VISIBILIDAD.VIGENTE;

}

const VISIBILIDAD = {
    VIGENTE:    { clave: 'VIGENTE',    etiqueta: 'Publicado',   clase: 'status-publicado',  publicable: true },
    PROGRAMADO: { clave: 'PROGRAMADO', etiqueta: 'Por publicar', clase: 'status-programado', publicable: false },
    VENCIDO:    { clave: 'VENCIDO',    etiqueta: 'Vencido',     clase: 'status-vencido',    publicable: false },
    BORRADOR:   { clave: 'BORRADOR',   etiqueta: 'Borrador',    clase: 'status-borrador',    publicable: false },
    ARCHIVADO:  { clave: 'ARCHIVADO',  etiqueta: 'Archivado',   clase: 'status-archivado',  publicable: false }
};

/** Texto explicativo del tooltip, según el caso. */
export function explicarVisibilidad(visibilidad, { fechaInicio, fechaFin } = {}) {

    const detalle = [];

    if (fechaInicio) detalle.push(`inicio ${formatearFecha(fechaInicio)}`);
    if (fechaFin) detalle.push(`fin ${formatearFecha(fechaFin)}`);

    const ventana = detalle.length ? ` (${detalle.join(', ')})` : '';

    switch (visibilidad.clave) {
        case 'VIGENTE':
            return `Visible en el portal ahora${ventana}.`;
        case 'PROGRAMADO':
            return `Publicado, pero el portal todavía lo oculta: empieza el ${formatearFecha(fechaInicio)}.`;
        case 'VENCIDO':
            return `Terminó el ${formatearFecha(fechaFin)}: el portal ya no lo muestra.`;
        case 'BORRADOR':
            return 'Borrador: nunca se muestra en el portal.';
        case 'ARCHIVADO':
            return 'Archivado: no se muestra en el portal.';
        default:
            return 'Estado no reconocido.';
    }

}

export function formatearRol(rol) {
    if (rol === 'ADMINISTRADOR') return 'Administrador';
    if (rol === 'EDITOR') return 'Editor';
    return rol ?? '—';
}

export function formatearEstado(estado) {
    const estados = {
        BORRADOR: 'Borrador',
        PUBLICADO: 'Publicado',
        ARCHIVADO: 'Archivado'
    };

    return estados[estado] ?? estado ?? '—';
}

export const STORAGE_BUCKET = 'portal-publico';
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const EXTENSIONES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
};

/**
 * Sube una imagen al bucket y devuelve su URL pública y su ruta interna.
 * El nombre lleva marca de tiempo para que cada reemplazo sea único y no
 * quede sirviendo una versión cacheada.
 */
export async function subirPortada(supabase, carpeta, id, archivo) {

    const extension = EXTENSIONES[archivo.type];

    if (!extension) {
        throw new Error('Formato de imagen no permitido.');
    }

    const path = `${carpeta}/${id}/portada-${Date.now()}.${extension}`;

    const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, archivo, {
            cacheControl: '3600',
            upsert: false,
            contentType: archivo.type
        });

    if (error) throw error;

    const { data } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(path);

    return { url: data.publicUrl, path };

}

/** Extrae la ruta interna de Storage a partir de su URL pública. */
export function obtenerPathDesdeUrl(url) {
    if (!url) return null;

    try {

        const parsed = new URL(url);
        const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
        const posicion = parsed.pathname.indexOf(marker);

        if (posicion === -1) return null;

        return decodeURIComponent(
            parsed.pathname.substring(posicion + marker.length)
        );

    } catch {

        return null;

    }
}

/**
 * Valida el archivo de portada elegido. Devuelve un mensaje de error o null.
 */
export function validarImagen(archivo) {
    if (!archivo) return 'No se seleccionó ningún archivo.';

    if (!ALLOWED_IMAGE_TYPES.includes(archivo.type)) {
        return 'La portada debe ser JPG, PNG o WEBP.';
    }

    if (archivo.size > MAX_IMAGE_SIZE) {
        return 'La imagen supera el límite de 5 MB.';
    }

    return null;
}
