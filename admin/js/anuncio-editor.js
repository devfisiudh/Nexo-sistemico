// admin/js/anuncio-editor.js — Crear y editar anuncios del tablón.
//
// Las reglas de este formulario están en buena parte determinadas por los
// CHECK de Postgres (sql/02_anuncios_modos.sql). Validarlas aquí permite
// avisar al usuario en el momento, en vez de devolverle un error 23514:
//
//   anuncios_modo_valido             modo ∈ {texto, imagen, mixto}
//   anuncios_destino_tipo_valido     destino_tipo ∈ {form, whatsapp, email, url, pagina, ninguno}
//   anuncios_destino_requerido       destino_tipo ≠ ninguno → destino_url no vacío
//   anuncios_modo_imagen_requerida   modo = imagen → imagen_url no vacía
//   anuncios_texto_check             modo ≠ imagen → texto no vacío
//   anuncios_fechas_check            fecha_fin ≥ fecha_inicio

import { supabase }
from '../../js/config/supabase.js';

import {
    conectarIndefinido,
    subirPortada,
    obtenerPathDesdeUrl,
    validarImagen,
    STORAGE_BUCKET,
    formatearRol
}
from './utils.js';

import {
    protegerPaginaAdmin,
    cerrarSesion
}
from './admin-guard.js';


const loading = document.getElementById('admin-loading');
const app = document.getElementById('admin-app');
const form = document.getElementById('anuncio-form');
const nombreElement = document.getElementById('admin-nombre');
const rolElement = document.getElementById('admin-rol');
const menuAdministradores = document.getElementById('menu-administradores');
const logoutButton = document.getElementById('logout-button');

const headerTitle = document.getElementById('header-title');
const editorTitle = document.getElementById('editor-title');
const saveButton = document.getElementById('save-button');
const messageElement = document.getElementById('editor-message');

const tituloInput = document.getElementById('titulo');
const textoInput = document.getElementById('texto');
const textoCounter = document.getElementById('texto-counter');
const autorTextoInput = document.getElementById('autor-texto');
const tipoInput = document.getElementById('tipo');
const modoInput = document.getElementById('modo');
const modoHelp = document.getElementById('modo-help');

const fechaInicioInput = document.getElementById('fecha-inicio');
const fechaInicioIndefinido = document.getElementById('fecha-inicio-indefinido');
const fechaFinInput = document.getElementById('fecha-fin');
const fechaFinIndefinido = document.getElementById('fecha-fin-indefinido');

const estadoInput = document.getElementById('estado');
const destinoTipoInput = document.getElementById('destino-tipo');
const destinoUrlInput = document.getElementById('destino-url');
const destinoLabelInput = document.getElementById('destino-label');
const grupoDestinoUrl = document.getElementById('grupo-destino-url');
const grupoDestinoLabel = document.getElementById('grupo-destino-label');
const destinoHelp = document.getElementById('destino-help');

const coverInput = document.getElementById('imagen-portada');
const coverImage = document.getElementById('cover-image');
const coverPlaceholder = document.getElementById('cover-placeholder');
const removeCoverButton = document.getElementById('remove-cover-button');

const CAMPOS = `
    id,
    titulo,
    tipo,
    texto,
    imagen_url,
    destino_url,
    destino_label,
    destino_tipo,
    modo,
    autor_texto,
    fecha_inicio,
    fecha_fin,
    estado
`;

const params = new URLSearchParams(window.location.search);
const anuncioId = params.get('id');

let administradorActual = null;
let editando = Boolean(anuncioId);

let imagenSeleccionada = null;
let imagenUrlActual = null;
let imagenPathActual = null;
let eliminarImagenActual = false;

const vigenciaInicio = conectarIndefinido(fechaInicioInput, fechaInicioIndefinido);
const vigenciaFin = conectarIndefinido(fechaFinInput, fechaFinIndefinido);


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

            headerTitle.textContent = 'Editar anuncio';
            editorTitle.textContent = 'Editar anuncio';
            saveButton.textContent = 'Guardar cambios';

            await cargarAnuncio(anuncioId);

        }

        loading.hidden = true;
        app.hidden = false;

    } catch (error) {

        console.error('Error iniciando editor de anuncio:', error);
        loading.textContent = 'No se pudo cargar el editor.';

    }

}


async function cargarAnuncio(id) {

    const { data, error } = await supabase
        .from('anuncios')
        .select(CAMPOS)
        .eq('id', id)
        .single();

    if (error || !data) {

        console.error('Error cargando anuncio:', error);

        throw new Error('No se pudo encontrar el anuncio.');

    }

    tituloInput.value = data.titulo ?? '';
    textoInput.value = data.texto ?? '';
    autorTextoInput.value = data.autor_texto ?? '';
    tipoInput.value = (data.tipo ?? 'GENERAL').toUpperCase();
    modoInput.value = data.modo ?? 'texto';
    estadoInput.value = data.estado ?? 'BORRADOR';
    destinoTipoInput.value = data.destino_tipo ?? 'ninguno';
    destinoUrlInput.value = data.destino_url ?? '';
    destinoLabelInput.value = data.destino_label ?? '';

    vigenciaInicio.aplicar(data.fecha_inicio);
    vigenciaFin.aplicar(data.fecha_fin);

    imagenUrlActual = data.imagen_url ?? null;
    imagenPathActual = obtenerPathDesdeUrl(imagenUrlActual);

    if (imagenUrlActual) {
        mostrarPortada(imagenUrlActual);
    }

    actualizarContador();
    sincronizarModo();
    sincronizarDestino();

}


// ── Campos dependientes ──────────────────────────────────────────────────────

/** El modo decide si el texto y la imagen son obligatorios. */
function sincronizarModo() {

    const modo = modoInput.value;

    const ayuda = {
        texto: 'Solo se muestra el texto. No necesitas imagen.',
        imagen: 'Solo se muestra la imagen: el texto se oculta y deja de ser obligatorio.',
        mixto: 'La imagen aparece arriba y el texto debajo.'
    };

    modoHelp.textContent = ayuda[modo] ?? '';

    textoInput.required = modo !== 'imagen';
    textoInput.disabled = modo === 'imagen';

    if (modo === 'imagen' && !imagenSeleccionada && !imagenUrlActual) {
        mostrarMensaje('Falta la imagen: el modo «Solo imagen» no puede guardarse sin ella.', 'error');
    }

}


/** El destino decide si hace falta URL y etiqueta. */
function sincronizarDestino() {

    const tipo = destinoTipoInput.value;
    const conBoton = tipo !== 'ninguno';

    grupoDestinoUrl.hidden = !conBoton;
    grupoDestinoLabel.hidden = !conBoton;

    destinoUrlInput.required = conBoton;
    destinoLabelInput.required = conBoton;

    destinoHelp.textContent = tipo === 'email'
        ? 'Usa el formato mailto:correo@ejemplo.pe'
        : 'Incluye https:// — el tablón lo abre en otra pestaña.';

}

modoInput.addEventListener('change', sincronizarModo);
destinoTipoInput.addEventListener('change', sincronizarDestino);


// ── Validación ────────────────────────────────────────────────────────────────

function recopilarDatos() {

    const modo = modoInput.value;
    const destinoTipo = destinoTipoInput.value;

    const titulo = tituloInput.value.trim();
    const texto = textoInput.value.trim();
    const destinoUrl = destinoUrlInput.value.trim();

    const fechaInicio = vigenciaInicio.leer();
    const fechaFin = vigenciaFin.leer();

    // anuncios_texto_check: solo el modo imagen puede quedarse sin texto
    if (modo !== 'imagen' && texto.length < 3) {
        return { error: 'El texto es obligatorio (mínimo 3 caracteres).' };
    }

    if (texto.length > 600) {
        return { error: 'El texto supera los 600 caracteres.' };
    }

    // anuncia_modo_imagen_requerida
    if (modo === 'imagen' && !imagenSeleccionada && !imagenUrlActual && !eliminarImagenActual) {
        return { error: 'El modo «Solo imagen» necesita una imagen.' };
    }

    // anuncios_destino_requerido
    if (destinoTipo !== 'ninguno' && !destinoUrl) {
        return { error: 'Seleccionaste un botón de destino, pero falta el enlace.' };
    }

    if (destinoUrl) {

        const esMailto = /^mailto:[^\s@]+@[^\s@]+$/i.test(destinoUrl);

        if (!esMailto) {
            try {
                const url = new URL(destinoUrl);
                if (!['http:', 'https:'].includes(url.protocol)) {
                    return { error: 'El enlace debe empezar por https:// o ser un mailto:.' };
                }
            } catch {
                return { error: 'El enlace no es una URL válida.' };
            }
        }

    }

    // anuncios_fechas_check
    if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
        return { error: 'La fecha de fin no puede ser anterior a la de inicio.' };
    }

    return {
        datos: {
            titulo: titulo || null,
            tipo: tipoInput.value,
            texto,
            modo,
            autor_texto: autorTextoInput.value.trim() || null,
            destino_url: destinoUrl || null,
            destino_label: destinoLabelInput.value.trim() || null,
            destino_tipo: destinoTipo,
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
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
            await actualizarAnuncio(datos);
        } else {
            await crearAnuncio(datos);
        }

    } catch (error) {

        console.error(error);
        mostrarMensaje('No se pudo guardar el anuncio.', 'error');

    } finally {

        saveButton.disabled = false;
        saveButton.textContent = editando ? 'Guardar cambios' : 'Guardar anuncio';

    }

});


async function crearAnuncio(datos) {

    // La política admin_anuncios_insert exige autor_id = auth.uid().
    const { data, error } = await supabase
        .from('anuncios')
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
                'anuncios',
                nuevoId,
                imagenSeleccionada
            );

            const { error: updateError } = await supabase
                .from('anuncios')
                .update({ imagen_url: portada.url })
                .eq('id', nuevoId);

            if (updateError) throw updateError;

        }

        window.location.replace(
            `./anuncio-editor.html?id=${encodeURIComponent(nuevoId)}`
        );

    } catch (error) {

        console.error('El anuncio se creó, pero falló la imagen:', error);
        mostrarMensaje('El anuncio se creó, pero no se pudo subir la imagen.', 'error');

    }

}


async function actualizarAnuncio(datos) {

    const pathAnterior = imagenPathActual;
    let nuevaImagenUrl = imagenUrlActual;
    let nuevoPath = null;

    try {

        if (imagenSeleccionada) {

            const portada = await subirPortada(
                supabase,
                'anuncios',
                anuncioId,
                imagenSeleccionada
            );

            nuevaImagenUrl = portada.url;
            nuevoPath = portada.path;

        }

        if (eliminarImagenActual && !imagenSeleccionada) {
            nuevaImagenUrl = null;
        }

        // Si el modo es 'imagen' no podemos dejar la tabla sin imagen.
        if (datos.modo === 'imagen' && !nuevaImagenUrl) {
            mostrarMensaje('El modo «Solo imagen» necesita una imagen.', 'error');
            return;
        }

        const { error } = await supabase
            .from('anuncios')
            .update({ ...datos, imagen_url: nuevaImagenUrl })
            .eq('id', anuncioId);

        if (error) {

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
                console.warn('Se guardó el anuncio, pero no se pudo borrar la imagen anterior:', deleteError);
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

        console.error('Error actualizando anuncio:', error);

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

    const detalle = error.message ? `: ${error.message}` : '.';

    switch (error.code) {
        case '23514':
            mostrarMensaje('La base rechazó los datos. Revisa fechas, enlace e imagen.' + detalle, 'error');
            return;
        case '23502':
            mostrarMensaje(`Falta un campo obligatorio${detalle}`, 'error');
            return;
        case '42501':
            mostrarMensaje('Tu sesión no tiene permiso para escribir anuncios.', 'error');
            return;
        default:
            mostrarMensaje('No se pudo guardar el anuncio' + detalle, 'error');
    }

}


// ── Contador ──────────────────────────────────────────────────────────────────

function actualizarContador() {
    textoCounter.textContent = `${textoInput.value.length} / 600`;
}

textoInput.addEventListener('input', actualizarContador);


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


// ── Imagen ────────────────────────────────────────────────────────────────────

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
    sincronizarModo();

});

removeCoverButton.addEventListener('click', () => {
    imagenSeleccionada = null;
    coverInput.value = '';
    eliminarImagenActual = true;
    ocultarPortada();
    sincronizarModo();
});


logoutButton.addEventListener('click', cerrarSesion);

actualizarContador();
sincronizarModo();
sincronizarDestino();
iniciar();
