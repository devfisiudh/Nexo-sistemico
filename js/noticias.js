// js/noticias.js — Listado de noticias publicadas + búsqueda local.
//
// Los datos llegan por js/data/noticias.js; esta capa solo dibuja.

import { listarNoticias } from './data/noticias.js';
import { escapar, normalizarTexto } from './utils/formato.js';

let todasLasNoticias = [];

document.addEventListener('DOMContentLoaded', () => {
    cargarNoticias();
    initBuscador();
});


async function cargarNoticias() {

    const contenedor = document.querySelector('.news-grid');

    if (!contenedor) return;

    try {

        todasLasNoticias = await listarNoticias({ limite: 6 });

        renderNoticias(todasLasNoticias);

    } catch (error) {

        console.error('[noticias] No se pudo cargar el listado.', error);

        contenedor.innerHTML =
            '<p class="search-no-results">No pudimos cargar las noticias. Intenta más tarde.</p>';

    }

}


function renderNoticias(noticias) {

    const contenedor = document.querySelector('.news-grid');

    if (!contenedor) return;

    if (!noticias.length) {

        contenedor.innerHTML =
            '<p class="search-no-results">Sin resultados para tu búsqueda.</p>';

        return;

    }

    // Un solo innerHTML en vez de uno por tarjeta: el DOM solo se parsea una vez.
    contenedor.innerHTML = noticias.map(buildTarjeta).join('');

}


function buildTarjeta(noticia) {

    const portada = noticia.imagenUrl
        ? `<img src="${escapar(noticia.imagenUrl)}" alt="" class="card-cover" loading="lazy">`
        : '';

    return `
        <article class="news-card">
            <div class="card-image" style="background-color: ${escapar(noticia.color)};">
                ${portada}
            </div>
            <div class="card-content">
                <span class="card-category ${escapar(noticia.claseCategoria)}">${escapar(noticia.categoria)}</span>
                <span class="card-date">${escapar(noticia.fecha)}</span>
                <h2 class="card-title">${escapar(noticia.titulo)}</h2>
                <p class="card-excerpt">${escapar(noticia.resumen)}</p>
                <a href="/articulo?slug=${encodeURIComponent(noticia.slug)}" class="read-more">Leer noticia &rarr;</a>
            </div>
        </article>
    `;

}


function initBuscador() {

    const input = document.getElementById('localSearchInput');
    const clearBtn = document.getElementById('localSearchClear');

    if (!input || !clearBtn) return;

    let temporizador;

    input.addEventListener('input', () => {

        clearTimeout(temporizador);

        const termino = normalizarTexto(input.value);

        clearBtn.style.display = termino ? 'flex' : 'none';

        temporizador = setTimeout(() => {

            if (!termino) {
                renderNoticias(todasLasNoticias);
                return;
            }

            const filtradas = todasLasNoticias.filter(n =>
                normalizarTexto(n.titulo).includes(termino) ||
                normalizarTexto(n.resumen).includes(termino) ||
                normalizarTexto(n.categoria).includes(termino)
            );

            renderNoticias(filtradas);

        }, 200);

    });

    clearBtn.addEventListener('click', () => {

        input.value = '';
        clearBtn.style.display = 'none';
        renderNoticias(todasLasNoticias);
        input.focus();

    });

}
