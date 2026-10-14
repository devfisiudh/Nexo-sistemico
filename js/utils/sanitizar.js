// js/utils/sanitizar.js — Allowlist de HTML para el contenido del CMS.
//
// El editor guarda HTML en texto plano (noticias.contenido, eventos.contenido).
// Antes existed innerHTML directo: un admin —o cualquiera que ganara acceso al
// panel— podía inyectar <script> y ejecutarlo en el navegador de cada visitante.
//
// Usa DOMParser en vez de expresiones regulares: el parser real del navegador
// normaliza el documento, así que no nos fiamos de heurísticas de texto.

const ETIETAS_PERMITIDAS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col',
    'colgroup', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1',
    'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p',
    'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
    'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
]);

// Se conservan, pero sin texto: nunca queremos su contenido en la página.
const ETIETAS_DESCARTABLES = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta',
    'base', 'form', 'input', 'button', 'textarea', 'select', 'template',
    'noscript', 'svg', 'math'
]);

const ATRIBUTOS_PERMITIDOS = new Set([
    'href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel',
    'width', 'height', 'colspan', 'rowspan', 'download', 'lang', 'dir'
]);

const ESQUEMAS_PERMITIDOS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

// Los SVG dentro de un data: URI pueden ejecutar script. Solo imágenes raster.
const DATA_IMAGEN_PERMITIDO = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i;


/**
 * Devuelve el HTML depurado, listo para asignar a innerHTML.
 * @param {string} html
 * @returns {string}
 */
export function sanitizar(html) {

    if (!html) return '';

    const documento = new DOMParser().parseFromString(
        String(html),
        'text/html'
    );

    recorrer(documento.body);

    return documento.body.innerHTML;

}


function recorrer(nodo) {

    // Copia estática: walkChildNodes es un NodeList vivo.
    const hijos = Array.from(nodo.childNodes);

    for (const hijo of hijos) {

        if (hijo.nodeType === Node.ELEMENT_NODE) {
            limpiarElemento(hijo);
        }

        recorrer(hijo);
    }

}


function limpiarElemento(elemento) {

    const nombre = elemento.tagName.toLowerCase();

    if (ETIETAS_DESCARTABLES.has(nombre)) {

        elemento.remove();

        return;

    }

    if (!ETIETAS_PERMITIDAS.has(nombre)) {

        // Etiqueta desconocida: se desenvuelve para conservar el texto.
        const padre = elemento.parentNode;

        if (padre) {
            while (elemento.firstChild) {
                padre.insertBefore(elemento.firstChild, elemento);
            }
            elemento.remove();
            recorrer(padre);
        }

        return;

    }

    for (const atributo of Array.from(elemento.attributes)) {

        const nombreAtributo = atributo.name.toLowerCase();

        // Todo on* (onclick, onerror, onload...) cae aquí.
        const permitido = ATRIBUTOS_PERMITIDOS.has(nombreAtributo);

        if (!permitido) {
            elemento.removeAttribute(atributo.name);
            continue;
        }

        const esUrl = nombreAtributo === 'href' || nombreAtributo === 'src';

        if (esUrl && !esUrlSegura(atributo.value, nombreAtributo)) {
            elemento.removeAttribute(atributo.name);
        }

    }

    // target="_blank" sin rel="noopener" abre la ventana con acceso a window.opener.
    if (
        elemento.getAttribute('target') === '_blank' &&
        !elemento.getAttribute('rel')?.includes('noopener')
    ) {
        elemento.setAttribute('rel', 'noopener noreferrer');
    }

}


function esUrlSegura(valor, atributo) {

    const bruto = (valor ?? '').trim();

    if (!bruto) return true;

    // "/assets/docs/x.pdf" o "#ancla" no llevan esquema: son relativos, van bien.
    if (bruto.startsWith('/') || bruto.startsWith('#') || bruto.startsWith('.')) {
        return true;
    }

    if (DATA_IMAGEN_PERMITIDO.test(bruto)) {
        return atributo === 'src';
    }

    try {

        const url = new URL(bruto, window.location.origin);

        return ESQUEMAS_PERMITIDOS.has(url.protocol);

    } catch {

        return false;

    }

}
