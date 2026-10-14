// admin/js/evento-editor.js — Crear y editar eventos.
//
// Diferencias con noticia-editor.js que importan:
//   · El bloque INSERT de Postgres exige `autor_id = auth.uid()`, así que hay
//     que mandarlo explícitamente en cada creación.
//   · `slug` es obligatorio porque es la clave de la URL pública del detalle.
//   · Las fechas son TIMESTAMPTZ y se convierten desde <input datetime-local>.

import { supabase }
from '../../js/config/supabase.js';

import {
    protegerPaginaAdmin,
    cerrarSesion
}
from './admin-guard.js';

import {
    normalizarSlug,
    convertirFechaParaInput,
    convertirInputAFecha,
    conectarIndefinido,
    subirPortada,
    obtenerPathDesdeUrl,
    validarImagen,
    STORAGE_BUCKET,
    formatearRol
}
from './utils.js';


const loading = document.getElementById('admin-loading');
const app = document.getElementById('admin-app');
const form = document.getElementById('evento-form');
const nombreElement = document.getElementById('admin-nombre');
const rolElement = document.getElementById('admin-rol');
const menuAdministradores = document.getElementById('menu-administradores');
const logoutButton = document.getElementById('logout-button');

const headerTitle = document.getElementById('header-title');
const editorTitle = document.getElementById('editor-title');
const saveButton = document.getElementById('save-button');
const messageElement = document.getElementById('editor-message');

const tituloInput = document.getElementById('titulo');
const slugInput = document.getElementById('slug');
const resumenInput = document.getElementById('resumen');
const contenidoInput = document.getElementById('contenido');
const lugarInput = document.getElementById('lugar');
const fechaInicioInput = document.getElementById('fecha-inicio');
const fechaFinInput = document.getElementById('fecha-fin');
const fechaFinIndefinido = document.getElementById('fecha-fin-indefinido');
const urlInscripcionInput = document.getElementById('url-inscripcion');
const estadoInput = document.getElementById('estado');
const resumenCounter = document.getElementById('resumen-counter');

const coverInput = document.getElementById('imagen-portada');
const coverImage = document.getElementById('cover-image');
const coverPlaceholder = document.getElementById('cover-placeholder');
const removeCoverButton = document.getElementById('remove-cover-button');

const CAMPOS = `
    id,
    titulo,
    slug,
    resumen,
    contenido,
    lugar,
    fecha_inicio,
    fecha_fin,
    url_inscripcion,
    imagen_url,
    estado
`;

const params = new URLSearchParams(window.location.search);
const eventoId = params.get('id');

let administradorActual = null;
let editando = Boolean(eventoId);
let slugModificadoManualmente = false;

// `eventos.fecha_inicio` es NOT NULL en Postgres: un evento sin fecha de
// inicio no se puede guardar. Solo `fecha_fin` admite el valor indefinido.
const vigenciaFin = conectarIndefinido(fechaFinInput, fechaFinIndefinido);

let imagenSeleccionada = null;
let imagenUrlActual = null;
let imagenPathActual = null;
let eliminarImagenActual = false;


// ── Inicialización ───────────────────────────────────────────────────────────

async function iniciar() {

    try {

        administradorActual = await protegerPaginaAdmin();

        if (!administradorActual) return;

        const { perfil } = administradorActual;

        nombreElement.textContent = perfil.nombre;
        rolElement.textContent = formatearRol(perfil.rol);

        if (perfil.rol === 'ADMINISTRADOR') {
            menuAdministradores.hidden = false;
        }

        if (editando) {

            headerTitle.textContent = 'Editar evento';
            editorTitle.textContent = 'Editar evento';
            saveButton.textContent = 'Guardar cambios';

            await cargarEvento(eventoId);

        }

        loading.hidden = true;
        app.hidden = false;

    } catch (error) {

        console.error('Error iniciando editor de evento:', error);
        loading.textContent = 'No se pudo cargar el editor.';

    }

}


async function cargarEvento(id) {

    const { data, error } = await supabase
        .from('eventos')
        .select(CAMPOS)
        .eq('id', id)
        .single();

    if (error || !data) {

        console.error('Error cargando evento:', error);

        throw new Error('No se pudo encontrar el evento.');

    }

    tituloInput.value = data.titulo ?? '';
    slugInput.value = data.slug ?? '';
    resumenInput.value = data.resumen ?? '';
    contenidoInput.value = data.contenido ?? '';
    lugarInput.value = data.lugar ?? '';
    urlInscripcionInput.value = data.url_inscripcion ?? '';
    estadoInput.value = data.estado ?? 'BORRADOR';

    fechaInicioInput.value = convertirFechaParaInput(data.fecha_inicio);

    // Si `fecha_fin` vino en NULL, la casilla queda marcada.
    vigenciaFin.aplicar(data.fecha_fin);

    imagenUrlActual = data.imagen_url ?? null;
    imagenPathActual = obtenerPathDesdeUrl(imagenUrlActual);

    if (imagenUrlActual) {
        mostrarPortada(imagenUrlActual);
    }

    // El slug ya existe: no lo regeneres mientras se edita el título.
    slugModificadoManualmente = true;

    actualizarContador();

}


// ── Validación del formulario ─────────────────────────────────────────────────

function recopilarDatos() {

    const titulo = tituloInput.value.trim();
    const slug = normalizarSlug(slugInput.value);
    const resumen = resumenInput.value.trim();
    const contenido = contenidoInput.value.trim();
    const fechaInicio = convertirInputAFecha(fechaInicioInput.value);
    const fechaFin = vigenciaFin.leer();

    if (!titulo) {
        return { error: 'El título es obligatorio.' };
    }

    if (!slug) {
        return { error: 'El título debe generar un slug válido (solo letras y números).' };
    }

    if (resumen.length < 10) {
        return { error: 'El resumen debe tener al menos 10 caracteres.' };
    }

    if (contenido.length < 20) {
        return { error: 'El contenido debe tener al menos 20 caracteres.' };
    }

    // Ambas fechas pueden quedar indefinidas, pero no tiene sentido un
    // rango invertido.
    if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
        return { error: 'La fecha de fin no puede ser anterior a la de inicio.' };
    }

    const urlInscripcion = urlInscripcionInput.value.trim();

    if (urlInscripcion) {
        try {
            const url = new URL(urlInscripcion);
            if (!['http:', 'https:'].includes(url.protocol)) {
                return { error: 'El enlace de inscripción debe empezar por http:// o https://' };
            }
        } catch {
            return { error: 'El enlace de inscripción no es una URL válida.' };
        }
    }

    return {
        datos: {
            titulo,
            slug,
            resumen,
            contenido,
            lugar: lugarInput.value.trim() || null,
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
            url_inscripcion: urlInscripcion || null,
            estado: estadoInput.value
        }
    };

}


// ── Guardar ───────────────────────────────────────────────────────────────────

form.addEventListener('submit', async (event) => {

    event.preventDefault();

    limpiarMensaje();

    if (!form.reportValidity()) return;

    const { datos, error: errorValidacion } = recopilarDatos();

    if (errorValidacion) {
        mostrarMensaje(errorValidacion, 'error');
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = editando ? 'Guardando...' : 'Creando...';

    try {

        if (editando) {
            await actualizarEvento(datos);
        } else {
            await crearEvento(datos);
        }

    } catch (error) {

        console.error(error);
        mostrarMensaje('No se pudo guardar el evento.', 'error');

    } finally {

        saveButton.disabled = false;
        saveButton.textContent = editando ? 'Guardar cambios' : 'Guardar evento';

    }

});


async function crearEvento(datos) {

    // La política admin_eventos_insert exige autor_id = auth.uid().
    const { data, error } = await supabase
        .from('eventos')
        .insert({
            ...datos,
            autor_id: administradorActual.usuario.id
        })
        .select('id')
        .single();

    if (error) {
        manejarErrorSupabase(error);
        return;
    }

    const nuevoId = data.id;

    try {

        if (imagenSeleccionada) {

            const portada = await subirPortada(
                supabase,
                'eventos',
                nuevoId,
                imagenSeleccionada
            );

            const { error: updateError } = await supabase
                .from('eventos')
                .update({ imagen_url: portada.url })
                .eq('id', nuevoId);

            if (updateError) throw updateError;

        }

        window.location.replace(
            `./evento-editor.html?id=${encodeURIComponent(nuevoId)}`
        );

    } catch (error) {

        console.error('El evento se creó, pero falló la portada:', error);
        mostrarMensaje('El evento se creó, pero no se pudo guardar la portada.', 'error');

    }

}


async function actualizarEvento(datos) {

    const pathAnterior = imagenPathActual;
    let nuevaImagenUrl = imagenUrlActual;
    let nuevoPath = null;

    try {

        if (imagenSeleccionada) {

            const portada = await subirPortada(
                supabase,
                'eventos',
                eventoId,
                imagenSeleccionada
            );

            nuevaImagenUrl = portada.url;
            nuevoPath = portada.path;

        }

        if (eliminarImagenActual && !imagenSeleccionada) {
            nuevaImagenUrl = null;
        }

        const { error } = await supabase
            .from('eventos')
            .update({ ...datos, imagen_url: nuevaImagenUrl })
            .eq('id', eventoId);

        if (error) {

            // Si subimos una imagen nueva pero el UPDATE falló, la retiramos
            // para no dejar archivos huérfanos en el bucket.
            if (nuevoPath) {
                await supabase.storage.from(STORAGE_BUCKET).remove([nuevoPath]);
            }

            manejarErrorSupabase(error);
            return;

        }

        const debemosEliminarAnterior = pathAnterior && (nuevoPath || eliminarImagenActual);

        if (debemosEliminarAnterior) {

            const { error: deleteError } = await supabase.storage
                .from(STORAGE_BUCKET)
                .remove([pathAnterior]);

            if (deleteError) {
                console.warn('Se guardó el evento, pero no se pudo borrar la portada anterior:', deleteError);
            }

        }

        imagenUrlActual = nuevaImagenUrl;
        imagenPathActual = nuevoPath
            ?? (nuevaImagenUrl ? obtenerPathDesdeUrl(nuevaImagenUrl) : null);

        imagenSeleccionada = null;
        eliminarImagenActual = false;
        coverInput.value = '';

        if (imagenUrlActual) {
            mostrarPortada(imagenUrlActual);
        } else {
            ocultarPortada();
        }

        mostrarMensaje('Cambios guardados correctamente.', 'success');

    } catch (error) {

        console.error('Error actualizando evento:', error);

        if (nuevoPath) {
            try {
                await supabase.storage.from(STORAGE_BUCKET).remove([nuevoPath]);
            } catch (cleanupError) {
                console.warn('No se pudo limpiar el archivo nuevo:', cleanupError);
            }
        }

        mostrarMensaje('No se pudieron guardar todos los cambios.', 'error');

    }

}


function manejarErrorSupabase(error) {

    console.error('Supabase:', error);

    if (error.code === '23505') {
        mostrarMensaje('Ya existe un evento con ese slug.', 'error');
        return;
    }

    if (error.code === '23514') {
        mostrarMensaje('La fecha de fin es anterior a la de inicio.', 'error');
        return;
    }

    if (error.code === '42501') {
        mostrarMensaje('Tu sesión no tiene permiso para escribir eventos.', 'error');
        return;
    }

    // 23502: una columna NOT NULL recibió null. Casi siempre significa que
    // se envió un campo obligatorio vacío — el mensaje de Postgres dice
    // cuál, y esconderlo deja al administrador sin saber qué corregir.
    if (error.code === '23502') {
        mostrarMensaje(
            `Falta un campo obligatorio${error.message ? `: ${error.message}` : '.'}`,
            'error'
        );
        return;
    }

    mostrarMensaje(
        `No se pudo guardar el evento${error.message ? `: ${error.message}` : '.'}`,
        'error'
    );

}


// ── Slug ──────────────────────────────────────────────────────────────────────

tituloInput.addEventListener('input', () => {

    if (!slugModificadoManualmente || !slugInput.value.trim()) {
        slugInput.value = normalizarSlug(tituloInput.value);
    }

});

slugInput.addEventListener('input', () => {

    slugModificadoManualmente = true;

    const posicion = slugInput.selectionStart;

    slugInput.value = normalizarSlug(slugInput.value);

    try {
        slugInput.setSelectionRange(posicion, posicion);
    } catch {
        // Algunos navegadores lo rechazan; no es crítico.
    }

});


// ── Contador ──────────────────────────────────────────────────────────────────

resumenInput.addEventListener('input', actualizarContador);

function actualizarContador() {
    resumenCounter.textContent = `${resumenInput.value.length} / 600`;
}


// ── Mensajes ──────────────────────────────────────────────────────────────────

function mostrarMensaje(mensaje, tipo) {
    messageElement.textContent = mensaje;
    messageElement.className = `editor-message editor-message-${tipo}`;
    messageElement.hidden = false;
}

function limpiarMensaje() {
    messageElement.textContent = '';
    messageElement.hidden = true;
}


// ── Portada ───────────────────────────────────────────────────────────────────

function mostrarPortada(url) {
    coverImage.src = url;
    coverImage.hidden = false;
    coverPlaceholder.hidden = true;
    removeCoverButton.hidden = false;
}

function ocultarPortada() {
    coverImage.removeAttribute('src');
    coverImage.hidden = true;
    coverPlaceholder.hidden = false;
    removeCoverButton.hidden = true;
}

coverInput.addEventListener('change', () => {

    limpiarMensaje();

    const archivo = coverInput.files?.[0];

    if (!archivo) return;

    const error = validarImagen(archivo);

    if (error) {
        coverInput.value = '';
        mostrarMensaje(error, 'error');
        return;
    }

    imagenSeleccionada = archivo;
    eliminarImagenActual = false;

    mostrarPortada(URL.createObjectURL(archivo));

});

removeCoverButton.addEventListener('click', () => {
    imagenSeleccionada = null;
    coverInput.value = '';
    eliminarImagenActual = true;
    ocultarPortada();
});


logoutButton.addEventListener('click', cerrarSesion);

actualizarContador();
iniciar();
