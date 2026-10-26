// js/utils/sanitizar.js — Allowlist de HTML para el contenido del CMS.
//
// El editor guarda HTML en texto plano (noticias.contenido, eventos.contenido).
// Antes existed innerHTML directo: un admin —o cualquiera que ganara acceso al
// panel— podía inyectar <script> y ejecutarlo en el navegador de cada visitante.
//
// Usa DOMParser en vez de expresiones regulares: el parser real del navegador
// normaliza el documento, así que no nos fiamos de heurísticas de texto.// Nota: `strike` (equivalente obsoleto de <s>) lo escribe Chrome al tachar
// desde el editor enriquecido del panel: sin él, el tachado se perdería aquí.
const ETIETAS_PERMITIDAS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col',
    'colgroup', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1',
    'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p',
    'pre', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
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
    normalizarJerarquia(documento.body);

    return documento.body.innerHTML;

}


/**
 * Quita los encabezados vacíos y evita saltos de nivel en el contenido.
 *
 * El HTML pegado desde Word o desde el editor deja `<h4></h4>` sin texto:
 * para un lector de pantalla son títulos fantasma, y un h4 inmediatamente
 * después de un h2 rompe la jerarquía (WCAG 1.3.1). Como el contenido lo
 * escribe cualquiera, aquí se garantiza la regla: nunca se salta más de un
 * nivel respecto al título anterior.
 */
function normalizarJerarquia(raiz) {

    const titulos = Array.from(raiz.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    let anterior = 0;

    for (const titulo of titulos) {

        const actual = Number(titulo.tagName[1]);

        if (!anterior || actual <= anterior + 1) {
            anterior = actual;
            continue;
        }

        const nivel = Math.min(anterior + 1, 6);
        const nuevo = titulo.ownerDocument.createElement(`h${nivel}`);

        for (const atributo of Array.from(titulo.attributes)) {
            nuevo.setAttribute(atributo.name, atributo.value);
        }

        while (titulo.firstChild) nuevo.appendChild(titulo.firstChild);

        titulo.replaceWith(nuevo);
        anterior = nivel;
    }
}


function recorrer(nodo) {

    // Copia estática: walkChildNodes es un NodeList vivo.
    const hijos = Array.from(nodo.childNodes);

    for (const hijo of hijos) {

        // Comentarios (los condicionales que pega Word al pegar HTML) sobran.
        if (hijo.nodeType === Node.COMMENT_NODE) {
            hijo.remove();
            continue;
        }

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

    // Encabezado sin nada dentro (pegado de Word/editor): no aporta título.
    if (/^h[1-6]$/.test(nombre) && !elemento.textContent.trim() && !elemento.querySelector('img, picture, video, br')) {
        elemento.remove();
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


/**
 * Prepara el contenido guardado para mostrarlo en el portal.
 *
 * El editor enriquecido del panel guarda HTML (<p>, <b>, <h2>, listas,
 * alineaciones...): eso pasa por la allowlist de sanitizar().
 *
 * Lo antiguo o escrito a mano llega como texto plano con saltos de línea:
 * se escapa y se convierte en párrafos, sin dejar entrar ninguna etiqueta.
 *
 * @param {string} contenido
 * @returns {string}
 */
export function prepararContenido(contenido) {

    if (!contenido) return '';

    const texto = String(contenido);

    if (/<\/?[a-z][^>]*>/i.test(texto)) {
        return sanitizar(texto);
    }

    const caja = document.createElement('div');
    caja.textContent = texto;

    return caja.innerHTML
        .split(/\n{2,}/)
        .map((bloque) => `<p>${bloque.trim().replace(/\n/g, '<br>')}</p>`)
        .join('');

}
