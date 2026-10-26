// js/utils/formato.js — Helpers de presentación compartidos por las vistas.
// Sin dependencias. Todo lo que las tarjetas necesitan derivar de la base de datos.

// ── Fechas ────────────────────────────────────────────────────────────────────

/**
 * Convierte un TIMESTAMPTZ de Postgres a texto "29 Dic, 2025".
 * Es el formato que ya usa el sitio.
 */
export function formatearFecha(iso) {
    if (!iso) return 'Sin fecha';

    const valor = new Date(iso);

    if (Number.isNaN(valor.getTime())) return 'Sin fecha';

    const dia = String(valor.getUTCDate()).padStart(2, '0');
    const mes = NOMBRES_MES[valor.getUTCMonth()] ?? '???';
    const anio = valor.getUTCFullYear();

    return `${dia} ${mes}, ${anio}`;
}

const NOMBRES_MES = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];

/** Marca de tiempo ordenable, para "lo más reciente". */
export function aFechaOrdenable(iso) {
    if (!iso) return 0;
    const valor = new Date(iso).getTime();
    return Number.isNaN(valor) ? 0 : valor;
}

/**
 * Rango legible de un evento.
 *   una fecha  → "20 Abr, 2026"
 *   dos fechas → "20 Abr, 2026 → 23 Abr, 2026"
 */
export function formatearRangoFechas(inicio, fin) {
    if (!inicio) return 'Fecha por definir';

    const desde = formatearFecha(inicio);

    if (!fin) return desde;

    return `${desde} → ${formatearFecha(fin)}`;
}

/** ¿ Hoy cae dentro del rango? Compara a día, no a instante. */
export function ocurreHoy(iso) {
    return aDia(iso) === aDia(new Date());
}

function aDia(iso) {
    const valor = new Date(iso);

    if (Number.isNaN(valor.getTime())) return null;

    return Date.UTC(valor.getUTCFullYear(), valor.getUTCMonth(), valor.getUTCDate());
}

/** Días calendario desde hoy. Negativo = ya pasó. */
export function diasDesdeHoy(iso) {
    const objetivo = aDia(iso);
    const hoy = aDia(new Date());

    if (objetivo === null || hoy === null) return null;

    return Math.round((objetivo - hoy) / 86400000);
}

/**
 * Distintivo de vigencia para la tarjeta de un evento.
 * Reemplaza el parseo de texto que hacía el código anterior.
 *
 * Con la política RLS applied (sql/01), un evento ya vencido no llega hasta
 * aquí, pero el caso se cubre igual para no confiar solo en la base.
 */
export function vigenciaEvento(fechaInicio, fechaFin) {

    const inicio = diasDesdeHoy(fechaInicio);

    if (inicio === null) return { etiqueta: '', clase: '' };

    const fin = fechaFin ? diasDesdeHoy(fechaFin) : inicio;

    // Multidía en curso: empezó antes y todavía no termina.
    if (inicio <= 0 && (fin === null || fin >= 0)) {
        return { etiqueta: '🔴 EN CURSO', clase: 'event-live' };
    }

    if (inicio === 0) {
        return { etiqueta: '🔴 HOY', clase: 'event-live' };
    }

    if (inicio > 0 && inicio <= 7) {
        return { etiqueta: '📅 ESTA SEMANA', clase: 'event-soon' };
    }

    return { etiqueta: '', clase: '' };

}

// ── Color de portada ──────────────────────────────────────────────────────────

/**
 * La tabla `noticias` no tiene columna de color (el JSON sí la tenía en
 * `color_placeholder`). Se deriva de la categoría con un hash estable, de modo
 * que la misma categoría siempre pinte igual en todo el portal.
 */
export function colorPorCategoria(categoria) {
    return colorPorClave(categoria);
}

/** Hash estable de cualquier texto → tono de la paleta. */
export function colorPorClave(texto) {
    const clave = (texto ?? '').toString().trim();

    if (!clave) return '#222222';

    let hash = 0;

    for (let i = 0; i < clave.length; i++) {
        hash = (hash * 31 + clave.charCodeAt(i)) >>> 0;
    }

    return PALETA[hash % PALETA.length];
}

// Tonos ya presentes en el diseño original del portal.
const PALETA = [
    '#a4161a', '#0077b6', '#7f5539',
    '#6a040f', '#161616', '#333333'
];

/** Categorías que ya tienen un color asignado en el diseño original. */
const COLORES_FIJOS = {
    'INFRAESTRUCTURA': '#161616',
    'COMPETENCIA':     '#a4161a',
    'COMUNIDAD':       '#7f5539',
    'AVISO':           '#333333',
    'INNOVACIÓN':      '#0077b6',
    'E-SPORTS':        '#6a040f'
};

/**
 * Prioriza el color fijo de la categoría y cae al hash si no hay uno asignado.
 */
export function colorDePortada(categoria) {
    const texto = (categoria ?? '').toString().trim().toUpperCase();
    return COLORES_FIJOS[texto] ?? colorPorCategoria(categoria);
}

/**
 * La columna `tipo` del JSON histórico (academico/evento/social) no existe en
 * Postgres. Reconstruimos la clase visual a partir de la categoría para no
 * perder el color del badge. Si algún día se agrega `tipo` a la tabla, esto
 * debe desaparecer en favor del valor real.
 */
export function claseCategoria(categoria) {
    const texto = (categoria ?? '').toString().trim().toUpperCase();

    if (CLASES_EVENTO.has(texto)) return 'cat-evento';
    if (CLASES_SOCIAL.has(texto)) return 'cat-social';

    return '';
}

const CLASES_EVENTO = new Set([
    'COMPETENCIA', 'EVENTO', 'CONGRESO', 'TALLER', 'CEREMONIA', 'AGENDA'
]);

const CLASES_SOCIAL = new Set([
    'COMUNIDAD', 'SOCIAL', 'E-SPORTS', 'DEPORTE', 'CULTURA'
]);

// ── Texto ─────────────────────────────────────────────────────────────────────

/**
 * Escapa texto antes de inyectarlo en una plantilla HTML.
 * La búsqueda en el frontend la armamos con template literals, así que
 * este es el único punto donde nos apoyamos en innerHTML.
 */
export function escapar(texto) {
    if (texto === null || texto === undefined) return '';

    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Devuelve la URL solo si es segura para meterla en un href.
 *
 * El panel valida los enlaces al guardar, pero el portal vuelve a comprobarlo
 * aquí: quien tenga acceso a la API podría guardar a mano algo como
 * `javascript:alert(1)` o una ruta protocol-relativa (`//evil.com`) y el
 * botón lo llevaría a otro sitio. Aquí se admiten http(s), mailto y tel, más
 * rutas internas de una sola barra; cualquier otra cosa devuelve ''.
 */
const ESQUEMAS_DE_ENLACE = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function urlSegura(url) {
    const valor = String(url ?? '').trim();

    if (!valor) return '';

    // Ruta interna: una sola barra inicial ("//host" y "/\host" son externas).
    if (valor.startsWith('/') && !/^\/[\\/]/.test(valor)) return valor;

    try {
        const enlace = new URL(valor);
        return ESQUEMAS_DE_ENLACE.has(enlace.protocol) ? valor : '';
    } catch {
        return '';
    }
}

/** Normaliza para comparar en búsquedas: minúsculas, sin acentos. */
export function normalizarTexto(texto) {
    return (texto ?? '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/** Construye la URL de detalle por slug. */
export function urlNoticia(slug, base = '.') {
    return `${base}/pages/articulo.html?slug=${encodeURIComponent(slug)}`;
}
