// js/comunidad.js — Tablón de anuncios.
//
// La tarjeta se arma desde el DAO (js/data/anuncios.js), que ya normalizó los
// campos. Aquí solo se dibuja y se escapa.

import { listarAnuncios } from './data/anuncios.js';
import { escapar, urlSegura } from './utils/formato.js';
import { prepararContenido } from './utils/sanitizar.js';

document.addEventListener('DOMContentLoaded', () => {
    cargarAnuncios();
});


async function cargarAnuncios() {

    const grilla = document.getElementById('tablon-grid');

    if (!grilla) return;

    try {

        const anuncios = await listarAnuncios();

        if (!anuncios.length) {
            grilla.innerHTML = `
                <p class="tablon-vacio">
                    No hay anuncios publicados por ahora.
                </p>`;
            return;
        }

        grilla.innerHTML = anuncios.map(buildTarjeta).join('');

    } catch (error) {

        console.error('[comunidad] No se pudieron cargar los anuncios.', error);

        grilla.innerHTML = `
            <p class="tablon-vacio">
                No pudimos cargar los anuncios. Intenta más tarde.
            </p>`;

    }

}


/** Los cuatro tipos que el diseño original distingue con color y cinta. */
const TIPOS = {
    urgente: { clase: 'anuncio-urgente', cinta: '📢 URGENTE' },
    info:    { clase: 'anuncio-info',    cinta: '📚 ACADÉMICO' },
    social:  { clase: 'anuncio-social',  cinta: '🎮 SOCIAL' },
    venta:   { clase: 'anuncio-venta',   cinta: '💼 EMPLEO' },
    general: { clase: 'anuncio-info',    cinta: '📌 GENERAL' }
};

const ICONOS = {
    form:     '📋',
    whatsapp: '💬',
    email:    '📧',
    url:      '🔗',
    pagina:   '🔗'
};


function buildTarjeta(anuncio) {

    const tipo = TIPOS[anuncio.tipo] ?? TIPOS.general;

    return `
        <article class="anuncio-card ${tipo.clase}">
            <div class="anuncio-ribbon">${tipo.cinta}</div>
            ${cuerpoAnuncio(anuncio)}
            ${botonDestino(anuncio)}
        </article>
    `;

}


function cuerpoAnuncio(anuncio) {

    const imagen = anuncio.imagenUrl
        ? `<div class="anuncio-img-wrap">
               <img src="${escapar(anuncio.imagenUrl)}" alt="" class="anuncio-img-full" loading="lazy" decoding="async">
           </div>`
        : '';

    const texto = anuncio.modo === 'imagen'
        ? ''
        : `<div class="anuncio-body">
               ${anuncio.titulo ? `<h2 class="anuncio-titulo">${escapar(anuncio.titulo)}</h2>` : ''}
               <div class="anuncio-texto">${prepararContenido(anuncio.texto)}</div>
               ${anuncio.autor ? `<span class="anuncio-autor">${escapar(anuncio.autor)}</span>` : ''}
           </div>`;

    if (anuncio.modo === 'imagen') return `${imagen}${texto}`;

    return `${imagen}${texto}`;

}


function botonDestino(anuncio) {

    // Enlace vuelto a validar al mostrar (ver urlSegura en formato.js).
    const destino = urlSegura(anuncio.destinoUrl);

    if (anuncio.destinoTipo === 'ninguno' || !destino) return '';

    const icono = ICONOS[anuncio.destinoTipo] ?? '🔗';

    // mailto: no debe abrirse en pestaña nueva: el navegador lo gestiona
    // como protocolo externo y target="_blank" lo deja en blanco.
    const esEmail = anuncio.destinoTipo === 'email';

    const atributos = esEmail
        ? `href="${escapar(destino)}"`
        : `href="${escapar(destino)}" target="_blank" rel="noopener noreferrer"`;

    return `
        <div class="anuncio-footer">
            <a ${atributos} class="anuncio-dest-btn anuncio-btn-${escapar(anuncio.destinoTipo)}">
                ${icono} ${escapar(anuncio.destinoLabel)}
            </a>
        </div>
    `;

}
