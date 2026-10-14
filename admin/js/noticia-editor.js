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
    subirPortada,
    obtenerPathDesdeUrl,
    validarImagen,
    STORAGE_BUCKET,
    formatearRol
}
from './utils.js';


const loading =
    document.getElementById('admin-loading');

const app =
    document.getElementById('admin-app');

const form =
    document.getElementById('noticia-form');

const nombreElement =
    document.getElementById('admin-nombre');

const rolElement =
    document.getElementById('admin-rol');

const menuAdministradores =
    document.getElementById('menu-administradores');

const logoutButton =
    document.getElementById('logout-button');

const headerTitle =
    document.getElementById('header-title');

const editorTitle =
    document.getElementById('editor-title');

const tituloInput =
    document.getElementById('titulo');

const slugInput =
    document.getElementById('slug');

const resumenInput =
    document.getElementById('resumen');

const contenidoInput =
    document.getElementById('contenido');

const categoriaInput =
    document.getElementById('categoria');

const estadoInput =
    document.getElementById('estado');

const fechaInput =
    document.getElementById('fecha-publicacion');

const resumenCounter =
    document.getElementById('resumen-counter');

const saveButton =
    document.getElementById('save-button');

const messageElement =
    document.getElementById('editor-message');

const coverInput =
    document.getElementById('imagen-portada');

const coverImage =
    document.getElementById('cover-image');

const coverPlaceholder =
    document.getElementById('cover-placeholder');

const removeCoverButton =
    document.getElementById('remove-cover-button');











let imagenSeleccionada = null;

let imagenUrlActual = null;

let imagenPathActual = null;

let eliminarImagenActual = false;


const params =
    new URLSearchParams(
        window.location.search
    );

const noticiaId =
    params.get('id');


let administradorActual = null;

let editando = false;

let slugModificadoManualmente = false;


/* ========================================
   INICIALIZACIÓN
======================================== */

async function iniciar() {

    try {

        administradorActual =
            await protegerPaginaAdmin();


        if (!administradorActual) {
            return;
        }


        const { perfil } =
            administradorActual;


        nombreElement.textContent =
            perfil.nombre;

        rolElement.textContent =
            formatearRol(perfil.rol);


        if (perfil.rol === 'ADMINISTRADOR') {
            menuAdministradores.hidden = false;
        }


        if (noticiaId) {

            editando = true;

            headerTitle.textContent =
                'Editar noticia';

            editorTitle.textContent =
                'Editar noticia';

            saveButton.textContent =
                'Guardar cambios';


            await cargarNoticia(
                noticiaId
            );
        }


        loading.hidden = true;
        app.hidden = false;


    } catch (error) {

        console.error(
            'Error iniciando editor:',
            error
        );

        loading.textContent =
            'No se pudo cargar el editor.';
    }
}


/* ========================================
   CARGAR NOTICIA
======================================== */

async function cargarNoticia(id) {

    const {
        data,
        error
    } = await supabase
        .from('noticias')
        .select(`
            id,
            titulo,
            slug,
            resumen,
            contenido,
            categoria,
            imagen_url,
            estado,
            fecha_publicacion
        `)
        .eq('id', id)
        .single();


    if (error || !data) {

        console.error(
            'Error cargando noticia:',
            error
        );

        throw new Error(
            'No se pudo encontrar la noticia.'
        );
    }


    tituloInput.value =
        data.titulo ?? '';

    slugInput.value =
        data.slug ?? '';

    resumenInput.value =
        data.resumen ?? '';

    contenidoInput.value =
        data.contenido ?? '';

    categoriaInput.value =
        data.categoria ?? '';

    estadoInput.value =
        data.estado ?? 'BORRADOR';

    imagenUrlActual =
        data.imagen_url ?? null;

    imagenPathActual =
    obtenerPathDesdeUrl(
        imagenUrlActual
    );


    if (imagenUrlActual) {

        mostrarPortada(
            imagenUrlActual
        );
    }


    if (data.fecha_publicacion) {

        fechaInput.value =
            convertirFechaParaInput(
                data.fecha_publicacion
            );
    }


    slugModificadoManualmente = true;

    actualizarContador();
}


/* ========================================
   GUARDAR
======================================== */

form.addEventListener(
    'submit',
    async (event) => {

        event.preventDefault();

        limpiarMensaje();


        if (!form.reportValidity()) {
            return;
        }


        const titulo =
            tituloInput.value.trim();

        const slug =
            normalizarSlug(
                slugInput.value
            );

        const resumen =
            resumenInput.value.trim();

        const contenido =
            contenidoInput.value.trim();

        const categoria =
            categoriaInput.value.trim();

        const estado =
            estadoInput.value;


        if (!slug) {

            mostrarMensaje(
                'El slug no es válido.',
                'error'
            );

            return;
        }


        let fechaPublicacion = null;


        if (fechaInput.value) {

            const fecha =
                new Date(
                    fechaInput.value
                );


            if (
                Number.isNaN(
                    fecha.getTime()
                )
            ) {

                mostrarMensaje(
                    'La fecha de publicación no es válida.',
                    'error'
                );

                return;
            }


            fechaPublicacion =
                fecha.toISOString();

        } else if (estado === 'PUBLICADO') {

            fechaPublicacion =
                new Date().toISOString();
        }


        const datos = {

            titulo,
            slug,
            resumen,
            contenido,

            categoria:
                categoria || null,

            estado,

            fecha_publicacion:
                fechaPublicacion
        };


        saveButton.disabled = true;

        saveButton.textContent =
            editando
                ? 'Guardando...'
                : 'Creando...';


        try {

            if (editando) {

                await actualizarNoticia(
                    datos
                );

            } else {

                await crearNoticia(
                    datos
                );
            }


        } catch (error) {

            console.error(error);

            mostrarMensaje(
                'No se pudo guardar la noticia.',
                'error'
            );


        } finally {

            saveButton.disabled = false;

            saveButton.textContent =
                editando
                    ? 'Guardar cambios'
                    : 'Guardar noticia';
        }

    }
);


/* ========================================
   CREAR
======================================== */

async function crearNoticia(datos) {

    const {
        data,
        error
    } = await supabase
        .from('noticias')
        .insert({
            ...datos,

            autor_id:
                administradorActual.usuario.id
        })
        .select('id')
        .single();


    if (error) {

        manejarErrorSupabase(error);

        return;
    }


    const nuevoId =
        data.id;


    try {

        if (imagenSeleccionada) {

            const portada =
                await subirPortada(
                    supabase,
                    'noticias',
                    nuevoId,
                    imagenSeleccionada
                );


            const {
                error: updateError
            } = await supabase
                .from('noticias')
                .update({
                    imagen_url:
                        portada.url
                })
                .eq(
                    'id',
                    nuevoId
                );


            if (updateError) {
                throw updateError;
            }
        }


        window.location.replace(
            `./noticia-editor.html?id=${encodeURIComponent(nuevoId)}`
        );


    } catch (error) {

        console.error(
            'La noticia fue creada, pero ocurrió un error con la portada:',
            error
        );


        mostrarMensaje(
            'La noticia se creó, pero no se pudo guardar la portada.',
            'error'
        );
    }
}


/* ========================================
   ACTUALIZAR
======================================== */

async function actualizarNoticia(datos) {

    const pathAnterior =
        imagenPathActual;

    let nuevaImagenUrl =
        imagenUrlActual;

    let nuevoPath = null;


    try {

        /* ==============================
           1. SUBIR NUEVA PORTADA
        ============================== */

        if (imagenSeleccionada) {

            const portada =
                await subirPortada(
                    supabase,
                    'noticias',
                    noticiaId,
                    imagenSeleccionada
                );

            nuevaImagenUrl =
                portada.url;

            nuevoPath =
                portada.path;
        }


        /* ==============================
           2. QUITAR PORTADA
        ============================== */

        if (
            eliminarImagenActual
            && !imagenSeleccionada
        ) {
            nuevaImagenUrl = null;
        }


        /* ==============================
           3. ACTUALIZAR POSTGRESQL
        ============================== */

        const {
            error
        } = await supabase
            .from('noticias')
            .update({
                ...datos,

                imagen_url:
                    nuevaImagenUrl
            })
            .eq(
                'id',
                noticiaId
            );


        if (error) {

            /*
             * Si acabamos de subir una imagen
             * pero PostgreSQL falla, eliminamos
             * esa imagen nueva para no dejar
             * archivos huérfanos.
             */

            if (nuevoPath) {

                await supabase.storage
                    .from(STORAGE_BUCKET)
                    .remove([
                        nuevoPath
                    ]);
            }


            manejarErrorSupabase(error);

            return;
        }


        /* ==============================
           4. ELIMINAR PORTADA ANTERIOR
        ============================== */

        const debemosEliminarAnterior =
            pathAnterior
            && (
                nuevoPath
                || eliminarImagenActual
            );


        if (debemosEliminarAnterior) {

            const {
                error: deleteError
            } = await supabase.storage
                .from(STORAGE_BUCKET)
                .remove([
                    pathAnterior
                ]);


            if (deleteError) {

                console.warn(
                    'La noticia se guardó, pero no se pudo eliminar la portada anterior:',
                    deleteError
                );
            }
        }


        /* ==============================
           5. ACTUALIZAR ESTADO LOCAL
        ============================== */

        imagenUrlActual =
            nuevaImagenUrl;

        imagenPathActual =
            nuevoPath
            ?? (
                nuevaImagenUrl
                    ? obtenerPathDesdeUrl(
                        nuevaImagenUrl
                    )
                    : null
            );


        imagenSeleccionada = null;

        eliminarImagenActual = false;

        coverInput.value = '';


        if (imagenUrlActual) {

            mostrarPortada(
                imagenUrlActual
            );

        } else {

            ocultarPortada();
        }


        mostrarMensaje(
            'Cambios guardados correctamente.',
            'success'
        );


    } catch (error) {

        console.error(
            'Error actualizando noticia:',
            error
        );


        /*
         * Si se alcanzó a subir una nueva
         * portada pero luego ocurrió una
         * excepción, intentamos limpiarla.
         */

        if (nuevoPath) {

            try {

                await supabase.storage
                    .from(STORAGE_BUCKET)
                    .remove([
                        nuevoPath
                    ]);

            } catch (cleanupError) {

                console.warn(
                    'No se pudo limpiar el archivo nuevo:',
                    cleanupError
                );
            }
        }


        mostrarMensaje(
            'No se pudieron guardar todos los cambios.',
            'error'
        );
    }
}


/* ========================================
   ERRORES SUPABASE
======================================== */

function manejarErrorSupabase(error) {

    console.error(
        'Supabase:',
        error
    );


    if (error.code === '23505') {

        mostrarMensaje(
            'Ya existe una noticia con ese slug.',
            'error'
        );

        return;
    }


    if (error.code === '23514') {

        mostrarMensaje(
            'Alguno de los campos no cumple las reglas establecidas.',
            'error'
        );

        return;
    }


    mostrarMensaje(
        'No se pudo guardar la noticia.',
        'error'
    );
}


/* ========================================
   SLUG
======================================== */

tituloInput.addEventListener(
    'input',
    () => {

        if (
            !slugModificadoManualmente
            || !slugInput.value.trim()
        ) {

            slugInput.value =
                normalizarSlug(
                    tituloInput.value
                );
        }

    }
);


slugInput.addEventListener(
    'input',
    () => {

        slugModificadoManualmente = true;

        const posicion =
            slugInput.selectionStart;

        slugInput.value =
            normalizarSlug(
                slugInput.value
            );

        try {

            slugInput.setSelectionRange(
                posicion,
                posicion
            );

        } catch {
            // No requiere acción.
        }

    }
);


/* ========================================
   CONTADOR
======================================== */

resumenInput.addEventListener(
    'input',
    actualizarContador
);


function actualizarContador() {

    resumenCounter.textContent =
        `${resumenInput.value.length} / 600`;
}


/* ========================================
   FECHAS
======================================== */

/* ========================================
   MENSAJES
======================================== */

function mostrarMensaje(
    mensaje,
    tipo
) {

    messageElement.textContent =
        mensaje;

    messageElement.className =
        `editor-message editor-message-${tipo}`;

    messageElement.hidden = false;
}


function limpiarMensaje() {

    messageElement.textContent = '';

    messageElement.hidden = true;
}


/* ========================================
   UTILIDADES
======================================== */

logoutButton.addEventListener(
    'click',
    cerrarSesion
);


actualizarContador();

iniciar();

coverInput.addEventListener(
    'change',
    () => {

        limpiarMensaje();


        const archivo =
            coverInput.files?.[0];


        if (!archivo) {
            return;
        }


        const error = validarImagen(archivo);

        if (error) {

            coverInput.value = '';

            mostrarMensaje(
                error,
                'error'
            );

            return;
        }


        imagenSeleccionada =
            archivo;

        eliminarImagenActual =
            false;


        const previewUrl =
            URL.createObjectURL(
                archivo
            );


        mostrarPortada(
            previewUrl
        );
    }
);


function mostrarPortada(url) {

    coverImage.src = url;

    coverImage.hidden = false;

    coverPlaceholder.hidden = true;

    removeCoverButton.hidden = false;
}


function ocultarPortada() {

    coverImage.removeAttribute(
        'src'
    );

    coverImage.hidden = true;

    coverPlaceholder.hidden = false;

    removeCoverButton.hidden = true;
}


removeCoverButton.addEventListener(
    'click',
    () => {

        imagenSeleccionada = null;

        coverInput.value = '';

        eliminarImagenActual = true;

        ocultarPortada();
    }
);


