// js/articulo.js — Detalle de noticia.
//
// URL canónica: /noticias?slug=hackathon-udh-2026
// (mantiene compatibilidad con articulo.html?slug= si llega por enlaces antiguos)
//
// Se acepta ?id= como compatibilidad con los enlaces anteriores a la migración.

import { obtenerNoticiaPorSlug } from './data/noticias.js';
import { obtenerNoticiaArchivada } from './data/historial.js';
import { escapar } from './utils/formato.js';
import { prepararContenido } from './utils/sanitizar.js';
import { formatearFecha } from './utils/formato.js';
import { actualizarMetadatos } from './utils/seo.js';

document.addEventListener('DOMContentLoaded', () => {
    cargarArticulo();
});


async function cargarArticulo() {

    const contenedor = document.getElementById('article-content');

    if (!contenedor) return;

    const parametros = new URLSearchParams(window.location.search);
    const slug = parametros.get('slug');
    const idResidual = parametros.get('id');

    if (!slug && !idResidual) {
        mostrarError(contenedor, 'No se especificó ninguna noticia.');
        return;
    }

    try {

        const buscado = slug ?? `noticia-${idResidual}`;

        let noticia = await obtenerNoticiaPorSlug(buscado);

        // RLS no devuelve lo archivado en la consulta normal (y debe seguir
        // sin hacerlo: así la portada no se ensucia). Si no aparece, puede
        // ser una noticia del histórico y se abre en versión compacta.
        if (!noticia) {
            noticia = await obtenerNoticiaArchivada(buscado).catch(() => null);
        }

        if (!noticia) {
            mostrarError(contenedor, 'Noticia no encontrada o no publicada.');
            return;
        }

        if (noticia.historico) {
            renderCompacta(contenedor, noticia);
            actualizarMetadatos({
                titulo: noticia.titulo,
                resumen: noticia.resumen || noticia.contenido,
                tipo: 'article'
            });
            return;
        }

        renderizarCabecera(contenedor, noticia);

        // El cuerpo puede llegar como HTML del editor enriquecido (allowlist)
        // o como texto plano antiguo: prepararContenido resuelve ambos.
        const cuerpo = prepararContenido(noticia.contenido)
            || '<p class="lead"><em>(Artículo completo no disponible)</em></p>';

        document.getElementById('cuerpo-texto').innerHTML = cuerpo;

        actualizarMetadatos({
            titulo: noticia.titulo,
            resumen: noticia.resumen || noticia.contenido,
            imagen: noticia.imagenUrl,
            tipo: 'article'
        });

    } catch (error) {

        console.error('[articulo] Error al cargar la noticia.', error);

        mostrarError(contenedor, 'Hubo un error al cargar la noticia.');

    }
}


function renderizarCabecera(contenedor, noticia) {

    // El visor de datos ya normaliza la fecha: `fecha` viene formateada y
    // `fechaOrdenable` en ISO. Se mantienen los campos crudos por compatibilidad.
    const fechaISO = noticia.fechaOrdenable || noticia.fecha_publicacion || noticia.created_at || '';
    const fechaTexto = noticia.fecha || (fechaISO ? formatearFecha(fechaISO) : 'Sin fecha');

    const portada = noticia.imagenUrl
        ? `<img src="${escapar(noticia.imagenUrl)}" alt="" loading="lazy" decoding="async">`
        : '<span class="post-hero-placeholder" aria-hidden="true">IMAGEN</span>';

    const kicker = noticia.categoria
        ? `<span class="post-kicker dot" style="--kicker:${escapar(noticia.color || 'var(--scarlet)')}">${escapar(noticia.categoria)}</span>`
        : '';

    contenedor.innerHTML = `
        <a href="/noticias" class="post-back">&larr; Volver a Noticias</a>

        <header class="post-hero" style="background-color: ${escapar(noticia.color || 'var(--surface-2)')};">
            ${portada}
            <div class="post-hero-inner">
                ${kicker}
                <span class="post-type-badge">NOTICIA</span>
                <h1 class="post-title">${escapar(noticia.titulo)}</h1>
                <p class="post-lead">${escapar(noticia.resumen || '')}</p>
            </div>
        </header>

        <div class="post-meta">
            <div class="post-meta-item">
                <span class="post-meta-icon">📅</span>
                <div>
                    <span class="post-meta-label">Fecha</span>
                    <span class="post-meta-value">${escapar(fechaTexto)}</span>
                </div>
            </div>
            ${noticia.autor_nombre
                ? `
                <div class="post-meta-item">
                    <span class="post-meta-icon">✍️</span>
                    <div>
                        <span class="post-meta-label">Autor</span>
                        <span class="post-meta-value">${escapar(noticia.autor_nombre)}</span>
                    </div>
                </div>`
                : ''
            }
            <div class="post-meta-item">
                <span class="post-meta-icon">🏷️</span>
                <div>
                    <span class="post-meta-label">Categoría</span>
                    <span class="post-meta-value">${escapar(noticia.categoria || 'General')}</span>
                </div>
            </div>
        </div>

        <div class="post-body" id="cuerpo-texto">
            <div class="loader-simple">Cargando texto completo…</div>
        </div>
    `;
}


/**
 * Detalle de una noticia del histórico: versión compacta y simplificada.
 * Sin hero grande ni rejilla de metadatos: aviso, título, resumen y texto.
 */
function renderCompacta(contenedor, noticia) {

    const fechaISO = noticia.fechaOrdenable || '';
    const fechaTexto = noticia.fecha || (fechaISO ? formatearFecha(fechaISO) : 'Sin fecha');

    const cuerpo = prepararContenido(noticia.contenido)
        || '<p class="lead"><em>(Texto completo no disponible)</em></p>';

    contenedor.innerHTML = `
        <a href="/historico?seccion=noticias" class="post-back">← Volver al histórico</a>

        <div class="post-aviso-historico">
            <strong>${escapar(noticia.historico || 'Archivado')}</strong>
            <span>
                Esta noticia ya no aparece en la portada. Se publicó el
                ${escapar(fechaTexto)} y puedes leerla completa aquí.
            </span>
        </div>

        <header class="post-historico-cabecera">
            ${noticia.categoria
                ? `<span class="post-kicker dot" style="--kicker:${escapar(noticia.color || 'var(--scarlet)')}">${escapar(noticia.categoria)}</span>`
                : ''
            }
            <h1 class="post-title">${escapar(noticia.titulo)}</h1>
            ${noticia.resumen ? `<p class="post-lead">${escapar(noticia.resumen)}</p>` : ''}
        </header>

        <div class="post-body" id="cuerpo-texto">
            ${cuerpo}
        </div>
    `;
}


function mostrarError(contenedor, mensaje) {

    contenedor.innerHTML = `
        <a href="/noticias" class="post-back">&larr; Volver a Noticias</a>

        <div class="post-error">
            <h2>${escapar(mensaje)}</h2>
            <p><a href="/noticias">&larr; Volver a Noticias</a></p>
        </div>
    `;
}
