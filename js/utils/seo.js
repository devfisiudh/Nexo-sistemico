// js/utils/seo.js — Metadatos de las páginas que se pintan con JavaScript
// (detalle de noticia y detalle de evento).
//
// Los rastreadores que NO ejecutan JavaScript (Facebook, X, WhatsApp) se quedan
// con los metadatos estáticos del HTML, por eso cada página trae su propio
// bloque en <head>. Los que sí lo ejecutan (Google) reciben aquí el título, la
// descripción, la URL canónica y la portada reales del contenido cargado.

const SITIO = 'Nexo Sistémico';
const IMAGEN_COMPARTIR = 'https://nexo-sistemico.vercel.app/assets/img/compartir.png';

// ── Escritura de etiquetas ───────────────────────────────────────────────────

/** Crea o actualiza un <meta> por name= o property=. `null` lo elimina. */
function fijarMeta(atributo, clave, contenido) {

    const selector = `meta[${atributo}="${clave}"]`;
    let meta = document.head.querySelector(selector);

    if (contenido === null) {
        if (meta) meta.remove();
        return;
    }

    if (!contenido) return;

    if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(atributo, clave);
        document.head.appendChild(meta);
    }

    meta.setAttribute('content', contenido);
}

/** Crea o actualiza el <link rel="canonical">. */
function fijarCanonical(href) {

    let enlace = document.head.querySelector('link[rel="canonical"]');

    if (!enlace) {
        enlace = document.createElement('link');
        enlace.setAttribute('rel', 'canonical');
        document.head.appendChild(enlace);
    }

    enlace.setAttribute('href', href);
}

// ── Texto de las etiquetas ───────────────────────────────────────────────────

/**
 * El resumen puede llegar como HTML del editor antiguo: se convierte a texto
 * plano con el parser del navegador (no ejecuta nada) y se colapsan espacios.
 */
function textoPlano(html) {

    if (!html) return '';

    const documento = new DOMParser().parseFromString(String(html), 'text/html');

    return (documento.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Recorta sin cortar a mitad de palabra. */
function recortar(texto, maximo = 160) {

    if (texto.length <= maximo) return texto;

    const cortado = texto.slice(0, maximo - 1);
    const espacio = cortado.lastIndexOf(' ');
    const parte = espacio > 40 ? cortado.slice(0, espacio) : cortado;

    return `${parte.trimEnd()}…`;
}

/** URL de portada utilizable; descarta colores y pseudo-URL del diseño. */
function urlDePortada(valor) {

    if (!valor || typeof valor !== 'string') return null;

    const limpio = valor.trim();

    if (!limpio || limpio.startsWith('#') || limpio.startsWith('data:') || limpio.startsWith('javascript:')) {
        return null;
    }

    try {
        return new URL(limpio, window.location.href).href;
    } catch {
        return null;
    }
}

// ── API ──────────────────────────────────────────────────────────────────────

/**
 * Actualiza título, descripción, canónica y Open Graph tras cargar el
 * contenido. Los que no vengan conservan los valores del HTML estático.
 *
 * @param {Object}  opciones
 * @param {string}  opciones.titulo  Título de la publicación, sin el nombre del sitio.
 * @param {string} [opciones.resumen] Entradilla o, en su defecto, el contenido.
 * @param {string} [opciones.imagen]  Portada (absoluta o relativa).
 * @param {string} [opciones.tipo]    og:type: 'article' para noticias.
 */
export function actualizarMetadatos({ titulo, resumen, imagen, tipo = 'website' } = {}) {

    const url = window.location.origin + window.location.pathname + window.location.search;
    const portada = urlDePortada(imagen);
    const tituloCompleto = titulo ? `${titulo} | ${SITIO}` : document.title;
    const descripcion = recortar(textoPlano(resumen));

    if (titulo) document.title = tituloCompleto;

    fijarMeta('name', 'description', descripcion);
    fijarMeta('property', 'og:title', tituloCompleto);
    fijarMeta('property', 'og:description', descripcion);
    fijarMeta('property', 'og:url', url);
    fijarMeta('property', 'og:type', tipo);

    if (portada) {
        fijarMeta('property', 'og:image', portada);
        // Las medidas 1200×630 del HTML ya no aplican a una portada propia.
        fijarMeta('property', 'og:image:width', null);
        fijarMeta('property', 'og:image:height', null);
        fijarMeta('property', 'og:image:alt', tituloCompleto);
    } else {
        fijarMeta('property', 'og:image', IMAGEN_COMPARTIR);
    }

    // twitter:card (estático) toma og:image, og:title y og:description como
    // respaldo, así que no hace falta repetirlos aquí.

    fijarCanonical(url);
}
