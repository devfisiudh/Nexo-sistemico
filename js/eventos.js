// js/eventos.js — Agenda de eventos + búsqueda local.

import { listarEventos } from './data/eventos.js';
import { escapar, normalizarTexto } from './utils/formato.js';

let todosLosEventos = [];

document.addEventListener('DOMContentLoaded', () => {
    cargarEventos();
    initBuscador();
});


async function cargarEventos() {

    const contenedor = document.querySelector('.events-grid');

    if (!contenedor) return;

    try {

        todosLosEventos = await listarEventos({ limite: 6 });

        renderEventos(todosLosEventos);

    } catch (error) {

        console.error('[eventos] No se pudo cargar la agenda.', error);

        contenedor.innerHTML =
            '<p class="search-no-results">No pudimos cargar la agenda. Intenta más tarde.</p>';

    }

}


function renderEventos(eventos) {

    const contenedor = document.querySelector('.events-grid');

    if (!contenedor) return;

    if (!eventos.length) {

        contenedor.innerHTML =
            '<p class="search-no-results">No hay eventos programados por ahora.</p>';

        return;

    }

    contenedor.innerHTML = eventos.map(buildTarjeta).join('');

}


function buildTarjeta(evento) {

    const portada = evento.imagenUrl
        ? `<img src="${escapar(evento.imagenUrl)}" alt="" class="card-cover" loading="lazy">`
        : '';

    const distintivo = evento.vigencia.etiqueta
        ? `<span class="event-badge ${escapar(evento.vigencia.clase)}">${escapar(evento.vigencia.etiqueta)}</span>`
        : '';

    // El botón externo va a la inscripción; el interno, a la página de detalle.
    const enlace = evento.tieneInscripcion
        ? `href="${escapar(evento.urlInscripcion)}" target="_blank" rel="noopener noreferrer"`
        : `href="evento.html?slug=${encodeURIComponent(evento.slug)}"`;

    return `
        <article class="event-card ${escapar(evento.vigencia.clase)}">
            <div class="card-image" style="background-color: ${escapar(evento.color)};">
                ${portada}
                ${distintivo}
            </div>
            <div class="card-content">
                <span class="card-category cat-evento">Evento</span>
                <div class="card-meta">
                    📅 ${escapar(evento.fechaTexto)}<br>
                    📍 ${escapar(evento.lugar)}
                </div>
                <h3 class="card-title">${escapar(evento.titulo)}</h3>
                <p class="card-excerpt">${escapar(evento.resumen)}</p>
                <a ${enlace} class="card-cta">
                    ${escapar(evento.textoBoton)} ${evento.icono}
                </a>
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
                renderEventos(todosLosEventos);
                return;
            }

            const filtrados = todosLosEventos.filter(e =>
                normalizarTexto(e.titulo).includes(termino) ||
                normalizarTexto(e.resumen).includes(termino) ||
                normalizarTexto(e.lugar).includes(termino)
            );

            renderEventos(filtrados);

        }, 200);

    });

    clearBtn.addEventListener('click', () => {

        input.value = '';
        clearBtn.style.display = 'none';
        renderEventos(todosLosEventos);
        input.focus();

    });

}
