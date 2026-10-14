// js/evento-detalle.js — Página de detalle de un evento.
//
// URL canónica: evento.html?slug=hackathon-udh-2026
// Se acepta ?id= como compatibilidad con los enlaces anteriores a la migración.

import { obtenerEventoPorSlug } from './data/eventos.js';
import { escapar } from './utils/formato.js';
import { sanitizar } from './utils/sanitizar.js';

document.addEventListener('DOMContentLoaded', () => {
    cargarDetalleEvento();
});


async function cargarDetalleEvento() {

    const contenedor = document.getElementById('event-detail-content');

    if (!contenedor) return;

    const parametros = new URLSearchParams(window.location.search);
    const slug = parametros.get('slug');
    const idResidual = parametros.get('id');

    if (!slug && !idResidual) {
        mostrarError(contenedor, 'Evento no especificado.');
        return;
    }

    try {

        const evento = await obtenerEventoPorSlug(slug ?? `evento-${idResidual}`);

        if (!evento) {
            mostrarError(contenedor, 'Evento no encontrado o no publicado.');
            return;
        }

        document.title = `${evento.titulo} | Nexo Sistémico`;

        renderDetalle(contenedor, evento);

    } catch (error) {

        console.error('[evento] Error al cargar el detalle.', error);

        mostrarError(contenedor, 'Hubo un error al cargar el evento.');

    }

}


function renderDetalle(contenedor, evento) {

    const distintivo = evento.vigencia.etiqueta
        ? `<span class="detail-badge ${escapar(evento.vigencia.clase)}">${escapar(evento.vigencia.etiqueta)}</span>`
        : '';

    const portada = evento.imagenUrl
        ? `<img src="${escapar(evento.imagenUrl)}" alt="" class="event-hero-cover" loading="lazy">`
        : '';

    // El cuerpo puede venir vacío; en ese caso mostramos el resumen.
    const cuerpo = sanitizar(evento.contenido)
        || `<p class="lead">${escapar(evento.resumen)}</p>`;

    const cta = evento.tieneInscripcion
        ? `
            <div class="event-detail-cta">
                <a href="${escapar(evento.urlInscripcion)}" target="_blank" rel="noopener noreferrer" class="detail-cta-btn">
                    ${escapar(evento.textoBoton)} ↗
                </a>
            </div>`
        : '';

    contenedor.innerHTML = `
        <div class="event-detail-hero" style="background-color: ${escapar(evento.color)};">
            ${portada}
            <div class="event-detail-hero-inner">
                ${distintivo}
                <span class="detail-tipo-tag">EVENTO</span>
                <h1 class="event-detail-title">${escapar(evento.titulo)}</h1>
                <p class="event-detail-desc">${escapar(evento.resumen)}</p>
            </div>
        </div>

        <div class="event-detail-meta-bar">
            <div class="meta-item">
                <span class="meta-icon">📅</span>
                <div>
                    <span class="meta-label">FECHA</span>
                    <strong>${escapar(evento.fechaTexto)}</strong>
                </div>
            </div>
            <div class="meta-item">
                <span class="meta-icon">📍</span>
                <div>
                    <span class="meta-label">LUGAR</span>
                    <strong>${escapar(evento.lugar)}</strong>
                </div>
            </div>
        </div>

        <div class="event-detail-body">
            ${cuerpo}
        </div>

        ${cta}
    `;

}


function mostrarError(contenedor, mensaje) {

    contenedor.innerHTML = `
        <div class="detail-error">
            <h2>${escapar(mensaje)}</h2>
            <a href="eventos.html" class="back-link-btn">&larr; Volver a la Agenda</a>
        </div>
    `;

}
