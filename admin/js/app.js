// admin/js/app.js — Panel de administración como SPA.
//
// Un único documento de entrada (admin/index.html) con enrutamiento por hash:
//
//   #/dashboard                 Resumen
//   #/noticias                  Listado
//   #/noticias/nuevo            Editor (crear)
//   #/noticias/editar/<id>      Editor (editar)
//   ... idéntico para eventos, anuncios y administradores
//   #/login                     Acceso
//
// La sesión se verifica UNA sola vez al entrar y se conserva 5 minutos en
// sessionStorage: navegar entre secciones ya no vuelve a mostrar pantallas
// intermedias de "Verificando sesión...".
//
// Reemplaza a dashboard.html, pages/*.html y a todos los js del panel menos
// utils.js, del que siguen importándose las utilidades puras.

import { supabase } from '../../js/config/supabase.js';

import {
    normalizarSlug,
    convertirFechaParaInput,
    convertirInputAFecha,
    conectarIndefinido,
    formatearFecha,
    formatearRango,
    derivarVisibilidad,
    explicarVisibilidad,
    formatearRol,
    formatearEstado,
    subirPortada,
    obtenerPathDesdeUrl,
    validarImagen,
    STORAGE_BUCKET
} from './utils.js';


/* ══════════════════════════════════════════════════════════════════════════
   STORE — sesión del administrador (una sola verificación, caché de 5 min)
   ══════════════════════════════════════════════════════════════════════════ */

const CACHE_KEY = 'nexo_admin_session';
const CACHE_TTL = 5 * 60 * 1000;

const store = {

    admin: null,

    leerCache() {
        try {
            const bruto = sessionStorage.getItem(CACHE_KEY);
            if (!bruto) return null;

            const dato = JSON.parse(bruto);

            if (Date.now() - dato.ts > CACHE_TTL) {
                sessionStorage.removeItem(CACHE_KEY);
                return null;
            }

            return dato.valor;
        } catch {
            return null;
        }
    },

    escribirCache() {
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                ts: Date.now(),
                valor: this.admin
            }));
        } catch {
            // sessionStorage no disponible: se degrada a verificar por red.
        }
    },

    async init() {
        const cacheado = this.leerCache();
        if (cacheado) {
            this.admin = cacheado;
            return cacheado;
        }

        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session) return null;

        return this.cargarPerfil(session);
    },

    async cargarPerfil(session) {
        const { data: perfil, error } = await supabase
            .from('perfiles_admin')
            .select('id, nombre, rol, estado, es_maestro')
            .eq('id', session.user.id)
            .eq('estado', 'ACTIVO')
            .single();

        // Sin perfil activo no hay panel: se cierra la sesión de Auth.
        if (error || !perfil) {
            await supabase.auth.signOut();
            return null;
        }

        this.admin = { session, usuario: session.user, perfil };
        this.escribirCache();
        return this.admin;
    },

    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const admin = await this.cargarPerfil(data.session);
        if (!admin) {
            throw new Error('Tu cuenta no tiene un perfil activo en el panel.');
        }

        return admin;
    },

    async logout() {
        this.admin = null;
        sessionStorage.removeItem(CACHE_KEY);
        await supabase.auth.signOut();
    }

};


/* ══════════════════════════════════════════════════════════════════════════
   UTILIDADES
   ══════════════════════════════════════════════════════════════════════════ */

const $ = (selector, raiz = document) => raiz.querySelector(selector);

// Todo dato que provenga de la base o del formulario pasa por aquí antes de
// reintroducirse en el HTML.
const esc = (texto) => String(texto ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
);

const CLASE_ESTADO = {
    BORRADOR: 'status-borrador',
    PUBLICADO: 'status-publicado',
    ARCHIVADO: 'status-archivado'
};

// Jerarquía de acceso al panel (mayor número = más poder).
const NIVEL_ACCESO = {
    MAESTRO: 3,      // cuenta principal: gestiona administradores y editores
    ADMINISTRADOR: 2, // gestiona solo editores
    EDITOR: 1         // no gestiona a nadie
};

const rolANivel = (rol) => {
    if (rol === 'ADMINISTRADOR') return NIVEL_ACCESO.ADMINISTRADOR;
    if (rol === 'EDITOR') return NIVEL_ACCESO.EDITOR;
    return NIVEL_ACCESO.EDITOR;
};

/**
 * ¿Puede el rol `origen` gestionar (crear/editar/desactivar) al rol `destino`?
 *   MAESTRO → ADMINISTRADOR y EDITOR
 *   ADMINISTRADOR → solo EDITOR
 *   EDITOR → nadie
 */
const puedeGestionarRol = (origen, destino) => {
    const o = rolANivel(origen);
    const d = rolANivel(destino);
    if (o === NIVEL_ACCESO.MAESTRO) return d <= NIVEL_ACCESO.ADMINISTRADOR;
    if (o === NIVEL_ACCESO.ADMINISTRADOR) return d === NIVEL_ACCESO.EDITOR;
    return false;
};

const insigniaEstado = (estado) => (
    `<span class="status-badge ${CLASE_ESTADO[estado] ?? 'status-neutro'}">${esc(formatearEstado(estado))}</span>`
);

// Estado derivado (Publicado / Programado / Vencido): el ENUM crudo miente
// porque no tiene en cuenta la ventana de vigencia.
const insigniaVisibilidad = (fila) => {
    const visibilidad = derivarVisibilidad({
        estado: fila.estado,
        fechaInicio: fila.fecha_inicio,
        fechaFin: fila.fecha_fin
    });

    const ayuda = explicarVisibilidad(visibilidad, {
        estado: fila.estado,
        fechaInicio: fila.fecha_inicio,
        fechaFin: fila.fecha_fin
    });

    return `<span class="status-badge ${visibilidad.clase}" title="${esc(ayuda)}">${esc(visibilidad.etiqueta)}</span>`;
};

function mensajeSupabase(error, porDefecto) {
    if (!error) return porDefecto;

    if (error.code === '23505') return 'Ya existe un registro con esos datos (slug duplicado).';
    if (error.code === '23514') return 'Alguno de los campos no cumple las reglas de la base de datos.';
    if (error.code === '23503') return 'La operación no es posible: el usuario referenciado no existe en Supabase Auth.';
    if (error.code === 'PGRST301' || /row-level security/i.test(error.message ?? '')) {
        return 'Tu sesión no tiene permisos para esta operación.';
    }

    return error.message || porDefecto;
}


/* ══════════════════════════════════════════════════════════════════════════
   METADATOS DE SECCIONES
   ══════════════════════════════════════════════════════════════════════════ */

const SECCIONES = {
    dashboard: {
        titulo: 'Dashboard',
        subtitulo: 'Resumen del portal'
    },
    noticias: {
        titulo: 'Noticias',
        subtitulo: 'Gestión de publicaciones del portal',
        nuevo: 'Nueva noticia',
        editar: 'Editar noticia'
    },
    eventos: {
        titulo: 'Eventos',
        subtitulo: 'Agenda académica de la facultad',
        nuevo: 'Nuevo evento',
        editar: 'Editar evento'
    },
    anuncios: {
        titulo: 'Anuncios',
        subtitulo: 'Tablón de avisos del portal',
        nuevo: 'Nuevo anuncio',
        editar: 'Editar anuncio'
    },
    administradores: {
        titulo: 'Administración',
        subtitulo: 'Gestión de perfiles de acceso al panel',
        nuevo: 'Nuevo perfil',
        editar: 'Editar perfil',
        // Nivel mínimo requerido para entrar a esta sección:
        //   3 = MAESTRO (cuenta principal), 2 = ADMINISTRADOR, 1 = EDITOR
        nivelMinimo: 2
    },
    archivo: {
        titulo: 'Archivo',
        subtitulo: 'Publicaciones archivadas (historial)',
        nivelMinimo: 1
    }
};


/* ══════════════════════════════════════════════════════════════════════════
   PANTALLAS (acceso, aplicación)
   ══════════════════════════════════════════════════════════════════════════ */

const pantallaCarga = $('#admin-loading');
const pantallaAuth = $('#auth-screen');
const aplicacion = $('#admin-app');
const contenedor = $('#admin-content');

function mostrarAplicacion() {
    pantallaCarga.hidden = true;
    pantallaAuth.hidden = true;
    aplicacion.hidden = false;

    const perfil = store.admin?.perfil;
    if (perfil) {
        $('#admin-nombre').textContent = perfil.nombre;
        $('#admin-rol').textContent = formatearRol(perfil.rol);
        // EDITOR no ve la sección Administración.
        $('#menu-administradores').hidden = rolANivel(perfil.rol) < NIVEL_ACCESO.ADMINISTRADOR;
        // Señal visual para la cuenta maestra.
        if (perfil.es_maestro) {
            $('#admin-rol').textContent = `${formatearRol(perfil.rol)} · Cuenta principal`;
        }
    }
}

function mostrarPantallaAuth() {
    pantallaCarga.hidden = true;
    aplicacion.hidden = true;
    pantallaAuth.hidden = false;
}


/* ══════════════════════════════════════════════════════════════════════════
   HELPERS DE VISTAS
   ══════════════════════════════════════════════════════════════════════════ */

function crearCargando() {
    const el = document.createElement('div');
    el.className = 'view-loading';
    el.textContent = 'Cargando...';
    return el;
}

function crearMensajes(raiz) {
    const contenedorMsj = $('#editor-message', raiz);

    return {
        mostrar(texto, tipo) {
            contenedorMsj.textContent = texto;
            contenedorMsj.className = `editor-message editor-message-${tipo}`;
            contenedorMsj.hidden = false;
        },
        limpiar() {
            contenedorMsj.textContent = '';
            contenedorMsj.hidden = true;
        }
    };
}

/** Bloque estándar de imagen (portada) para los editores de contenido. */
function portadaHTML(titulo = 'Imagen') {
    return `
        <div class="editor-card cover-card">
            <h3>${esc(titulo)}</h3>

            <div class="cover-preview">
                <span id="cover-placeholder">Sin imagen</span>
                <img id="cover-image" alt="Vista previa de la imagen" hidden>
            </div>

            <label for="imagen-portada" class="file-button">
                Seleccionar imagen
            </label>

            <input
                id="imagen-portada"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
            >

            <small class="form-help">
                JPG, PNG o WEBP. Máximo 5 MB.
            </small>

            <button
                id="remove-cover-button"
                type="button"
                class="remove-cover-button"
                hidden
            >
                Quitar imagen
            </button>
        </div>`;
}

/** Estado + comportamiento del widget de imagen. */
function prepararPortada(raiz, avisar) {
    const input = $('#imagen-portada', raiz);
    const imagen = $('#cover-image', raiz);
    const vacio = $('#cover-placeholder', raiz);
    const botonQuitar = $('#remove-cover-button', raiz);

    const estado = {
        urlActual: null,
        pathActual: null,
        seleccionada: null,
        eliminar: false
    };

    const mostrar = (url) => {
        imagen.src = url;
        imagen.hidden = false;
        vacio.hidden = true;
        botonQuitar.hidden = false;
    };

    const ocultar = () => {
        imagen.removeAttribute('src');
        imagen.hidden = true;
        vacio.hidden = false;
        botonQuitar.hidden = true;
    };

    input.addEventListener('change', () => {
        const archivo = input.files?.[0];
        if (!archivo) return;

        const error = validarImagen(archivo);
        if (error) {
            input.value = '';
            avisar(error, 'error');
            return;
        }

        estado.seleccionada = archivo;
        estado.eliminar = false;
        mostrar(URL.createObjectURL(archivo));
    });

    botonQuitar.addEventListener('click', () => {
        estado.seleccionada = null;
        estado.eliminar = true;
        input.value = '';
        ocultar();
    });

    return {
        estado,

        aplicarUrl(url) {
            estado.urlActual = url ?? null;
            estado.pathActual = obtenerPathDesdeUrl(url);

            if (url) mostrar(url);
            else ocultar();
        },

        // Tras subir una imagen nueva, el estado de "pendiente" se limpia.
        confirmarSubida(url) {
            estado.urlActual = url;
            estado.pathActual = obtenerPathDesdeUrl(url);
            estado.seleccionada = null;
            estado.eliminar = false;
            input.value = '';
            mostrar(url);
        },

        limpiarTrasQuitar() {
            estado.urlActual = null;
            estado.pathActual = null;
            estado.seleccionada = null;
            estado.eliminar = false;
            input.value = '';
            ocultar();
        }
    };
}

/** El slug se genera del título salvo que se haya editado a mano. */
function prepararSlug(raiz) {
    const titulo = $('#titulo', raiz);
    const slug = $('#slug', raiz);

    if (!titulo || !slug) {
        return { fijarManual() {}, normalizar: () => '' };
    }

    let manual = false;

    titulo.addEventListener('input', () => {
        if (!manual || !slug.value.trim()) {
            slug.value = normalizarSlug(titulo.value);
        }
    });

    slug.addEventListener('input', () => {
        manual = true;
        const posicion = slug.selectionStart;
        slug.value = normalizarSlug(slug.value);
        try {
            slug.setSelectionRange(posicion, posicion);
        } catch {
            // Algunos tipos de input no admiten selección.
        }
    });

    return {
        fijarManual() { manual = true; },
        normalizar: () => normalizarSlug(slug.value)
    };
}

/** Contador "n / 600" junto a un textarea. */
function prepararContador(raiz, selectorCampo, selectorContador, maximo) {
    const campo = $(selectorCampo, raiz);
    const contador = $(selectorContador, raiz);

    if (!campo || !contador) return () => {};

    const actualizar = () => {
        contador.textContent = `${campo.value.length} / ${maximo}`;
    };

    campo.addEventListener('input', actualizar);
    actualizar();

    return actualizar;
}

/** Rellena el formulario con un registro de la base. */
function rellenar(raiz, datos) {
    for (const [campo, valor] of Object.entries(datos)) {
        const control = raiz.querySelector(`[name="${campo}"]`);
        if (!control) continue;
        if (control.type === 'checkbox') continue;

        if (control.type === 'datetime-local') {
            control.value = convertirFechaParaInput(valor);
            continue;
        }

        if (control.tagName === 'SELECT') {
            control.value = valor ?? '';

            // La base guarda valores libres en distinta caja (tipo: "urgente"
            // frente a la opción "URGENTE"). Se empareja sin importar mayúsculas.
            if (control.value === '' && valor) {
                const parecido = Array.from(control.options).find(
                    (opcion) => opcion.value.toLowerCase() === String(valor).toLowerCase()
                );
                if (parecido) control.value = parecido.value;
            }

            // Sin valor reconocible se queda en la primera opción, como el
            // panel anterior (tipo nulo → "General").
            if (control.value === '' && control.options.length > 0 && control.options[0].value !== '') {
                control.value = control.options[0].value;
            }

            continue;
        }

        control.value = valor ?? '';
    }
}

async function cargarRegistro(tabla, campos, id) {
    const { data, error } = await supabase
        .from(tabla)
        .select(campos)
        .eq('id', id)
        .single();

    if (error || !data) {
        throw new Error('No se pudo encontrar el registro.');
    }

    return data;
}


/* ══════════════════════════════════════════════════════════════════════════
   GUARDAR — contenido (noticias, eventos, anuncios)
   ══════════════════════════════════════════════════════════════════════════ */

async function guardarContenido({ tabla, id, datos, carpeta, portada }) {

    const estado = portada.estado;

    /* ── Crear ──────────────────────────────────────────────────────────── */

    if (!id) {

        // Las políticas de insert exigen autor_id = auth.uid().
        const { data, error } = await supabase
            .from(tabla)
            .insert({ ...datos, autor_id: store.admin.usuario.id })
            .select('id')
            .single();

        if (error) throw error;

        if (estado.seleccionada) {
            try {
                const subida = await subirPortada(supabase, carpeta, data.id, estado.seleccionada);

                const { error: errorImagen } = await supabase
                    .from(tabla)
                    .update({ imagen_url: subida.url })
                    .eq('id', data.id);

                if (errorImagen) throw errorImagen;

                portada.confirmarSubida(subida.url);
            } catch (error) {
                console.error('El registro se creó, pero falló la imagen:', error);
                throw new Error('El registro se creó, pero no se pudo subir la imagen.');
            }
        }

        return { id: data.id, creado: true };
    }

    /* ── Actualizar ─────────────────────────────────────────────────────── */

    let nuevaUrl = estado.urlActual;
    let nuevoPath = null;

    if (estado.seleccionada) {
        const subida = await subirPortada(supabase, carpeta, id, estado.seleccionada);
        nuevaUrl = subida.url;
        nuevoPath = subida.path;
    } else if (estado.eliminar) {
        nuevaUrl = null;
    }

    const { error } = await supabase
        .from(tabla)
        .update({ ...datos, imagen_url: nuevaUrl })
        .eq('id', id);

    if (error) {
        // No dejar archivos huérfanos si Postgres rechazó el cambio.
        if (nuevoPath) {
            await supabase.storage.from(STORAGE_BUCKET).remove([nuevoPath]).catch(() => {});
        }
        throw error;
    }

    const pathAnterior = estado.pathActual;

    if (pathAnterior && (nuevoPath || estado.eliminar)) {
        const { error: errorBorrar } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([pathAnterior]);

        if (errorBorrar) {
            console.warn('No se pudo eliminar la imagen anterior:', errorBorrar);
        }
    }

    if (estado.seleccionada) {
        portada.confirmarSubida(nuevaUrl);
    } else if (estado.eliminar) {
        portada.limpiarTrasQuitar();
    }

    return { id, creado: false };
}


/* ══════════════════════════════════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════════════════════════════════ */

async function vistaDashboard() {

    const el = document.createElement('div');
    el.className = 'view-enter';

    el.innerHTML = `
        <section class="welcome-section">
            <span class="section-label">PANEL DE CONTROL</span>
            <h2>Hola, ${esc(store.admin.perfil.nombre)}</h2>
            <p>Gestiona el contenido de Nexo Sistémico desde un solo lugar.</p>
        </section>

        <section class="stats-grid">
            <article class="stat-card">
                <span>Noticias</span>
                <strong id="stat-noticias">—</strong>
                <small id="stat-noticias-detalle">Cargando...</small>
            </article>

            <article class="stat-card">
                <span>Eventos</span>
                <strong id="stat-eventos">—</strong>
                <small id="stat-eventos-detalle">Cargando...</small>
            </article>

            <article class="stat-card">
                <span>Anuncios</span>
                <strong id="stat-anuncios">—</strong>
                <small id="stat-anuncios-detalle">Cargando...</small>
            </article>
        </section>

        <section class="quick-actions">
            <a class="action-card" href="#/noticias/nuevo">
                <strong>Nueva noticia</strong>
                <span>Publica una novedad del portal.</span>
            </a>

            <a class="action-card" href="#/eventos/nuevo">
                <strong>Nuevo evento</strong>
                <span>Agrega una actividad a la agenda.</span>
            </a>

            <a class="action-card" href="#/anuncios/nuevo">
                <strong>Nuevo anuncio</strong>
                <span>Publica un aviso en el tablón.</span>
            </a>
        </section>

        <section class="dashboard-section">
            <div class="section-heading">
                <h2>Últimas noticias</h2>
            </div>

            <div class="content-list" id="ultimas-noticias">
                <p class="empty-message">Cargando...</p>
            </div>
        </section>`;

    cargarEstadisticas(el).catch((error) => console.error('Estadísticas:', error));
    cargarUltimasNoticias(el).catch((error) => console.error('Últimas noticias:', error));

    return el;
}


async function cargarEstadisticas(raiz) {
    const tablas = ['noticias', 'eventos', 'anuncios'];
    const resultados = await Promise.all(
        tablas.map((tabla) => supabase.from(tabla).select('id, estado'))
    );

    tablas.forEach((tabla, posicion) => {
        const { data, error } = resultados[posicion];
        const numero = $(`#stat-${tabla}`, raiz);
        const detalle = $(`#stat-${tabla}-detalle`, raiz);

        if (error) {
            numero.textContent = '—';
            detalle.textContent = 'No se pudo cargar';
            return;
        }

        const filas = data ?? [];
        const publicados = filas.filter((fila) => fila.estado === 'PUBLICADO').length;

        numero.textContent = String(filas.length);
        detalle.textContent = `${publicados} de ${filas.length} publicados`;
    });
}


async function cargarUltimasNoticias(raiz) {
    const { data, error } = await supabase
        .from('noticias')
        .select('id, titulo, estado, fecha_publicacion, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    const lista = $('#ultimas-noticias', raiz);

    if (error) {
        lista.innerHTML = '<p class="empty-message">No se pudieron cargar las noticias.</p>';
        return;
    }

    if (!data?.length) {
        lista.innerHTML = '<p class="empty-message">Todavía no hay noticias.</p>';
        return;
    }

    lista.innerHTML = data.map((noticia) => `
        <article class="content-list-item">
            <div>
                <strong>${esc(noticia.titulo)}</strong>
                <small>${esc(formatearFecha(noticia.created_at))}</small>
            </div>

            <div class="content-item-actions">
                ${insigniaVisibilidad({ estado: noticia.estado, fecha_inicio: noticia.fecha_publicacion })}
                <a
                    class="table-action-link"
                    href="#/noticias/editar/${esc(noticia.id)}"
                >Editar</a>
            </div>
        </article>`).join('');
}


/* ══════════════════════════════════════════════════════════════════════════
   LISTADOS
   ══════════════════════════════════════════════════════════════════════════ */

async function vistaListado(config) {

    const el = document.createElement('div');
    el.className = 'view-enter';

    const abarca = config.columnas.length + 1;

    el.innerHTML = `
        <section class="page-toolbar">
            <div>
                <span class="section-label">${esc(config.etiqueta)}</span>
                <h2>${esc(config.titulo)}</h2>
                <p>${esc(config.descripcion)}</p>
            </div>

            <a href="#/${config.seccion}/nuevo" class="primary-action">
                ${esc(config.accionNuevo)}
            </a>
        </section>

        <section class="content-filters">
            <div class="search-control">
                <label
                    class="sr-only"
                    for="buscador-${config.seccion}"
                >${esc(config.placeholderBusqueda)}</label>

                <input
                    id="buscador-${config.seccion}"
                    type="search"
                    placeholder="${esc(config.placeholderBusqueda)}"
                    autocomplete="off"
                >
            </div>

            <div class="filter-buttons">
                ${config.filtros.map((filtro, i) => `
                    <button
                        type="button"
                        class="filter-button${i === 0 ? ' active' : ''}"
                        data-clave="${filtro.clave}"
                    >${esc(filtro.etiqueta)}</button>`).join('')}
            </div>
        </section>

        <div
            id="listado-mensaje"
            class="editor-message"
            role="status"
            hidden
        ></div>

        <section class="admin-table-card">
            <div class="admin-table-wrapper">
                <table class="admin-table">
                    <thead>
                        <tr>
                            ${config.columnas.map((columna) => `<th>${esc(columna.titulo)}</th>`).join('')}
                            <th class="table-actions-heading">Acciones</th>
                        </tr>
                    </thead>

                    <tbody></tbody>
                </table>
            </div>
        </section>`;

    const tbody = el.querySelector('tbody');
    const buscador = el.querySelector('input[type="search"]');
    const mensajeEl = $('#listado-mensaje', el);

    let datos = [];
    let filtro = config.filtros[0].clave;
    let cargado = false;

    const mostrarMensaje = (texto, tipo) => {
        mensajeEl.textContent = texto;
        mensajeEl.className = `editor-message editor-message-${tipo}`;
        mensajeEl.hidden = false;
    };

    function render() {
        if (!cargado) return;

        const termino = buscador.value.trim().toLowerCase();

        const filas = datos.filter((fila) => {
            const coincideFiltro = filtro === 'TODOS' || config.claveFiltro(fila) === filtro;
            const coincideTexto = !termino || Object.values(fila).some(
                (valor) => valor != null && String(valor).toLowerCase().includes(termino)
            );
            return coincideFiltro && coincideTexto;
        });

        if (!filas.length) {
            tbody.innerHTML = `<tr><td colspan="${abarca}" class="table-message">No se encontraron resultados.</td></tr>`;
            return;
        }

        const fragmento = document.createDocumentFragment();

        filas.forEach((fila) => {
            const tr = document.createElement('tr');

            // Cambio de estado sin entrar al editor. El derivado (Publicado /
            // Programado / Vencido) se recalcula al refrescar la tabla.
            const selectorEstado = config.edicionRapida
                ? `<select
                        class="estado-rapido"
                        data-id="${esc(fila.id)}"
                        aria-label="Cambiar estado de la publicación"
                    >${opcionesEstado()}</select>`
                : '';

            tr.innerHTML = config.columnas.map((columna) => columna.celda(fila)).join('')
                + `<td class="table-actions">${selectorEstado}<a class="table-action-link" href="#/${config.seccion}/editar/${esc(fila.id)}">Editar</a></td>`;

            const rapido = tr.querySelector('.estado-rapido');
            if (rapido) rapido.value = fila.estado ?? 'BORRADOR';

            fragmento.appendChild(tr);
        });

        tbody.innerHTML = '';
        tbody.appendChild(fragmento);
    }

    // Guardar el cambio directo desde la tabla.
    tbody.addEventListener('change', async (evento) => {
        const rapido = evento.target.closest?.('.estado-rapido');
        if (!rapido) return;

        const id = rapido.dataset.id;
        const fila = datos.find((d) => String(d.id) === String(id));
        if (!fila) return;

        const nuevo = rapido.value;
        const anterior = fila.estado;
        if (nuevo === anterior) return;

        rapido.disabled = true;

        const { error } = await supabase
            .from(config.tabla)
            .update({ estado: nuevo })
            .eq('id', id);

        rapido.disabled = false;

        if (error) {
            console.error('Cambio rápido de estado:', error);

            if (error.code === '22P02') {
                mostrarMensaje('El estado «Programado» todavía no existe en la base: aplica antes sql/04_estado_programado.sql en Supabase.', 'error');
            } else if (error.code === '23514') {
                mostrarMensaje('La base rechazó el cambio: revisa las fechas y la composición del registro.', 'error');
            } else {
                mostrarMensaje('No se pudo cambiar el estado. Vuelve a intentarlo.', 'error');
            }

            rapido.value = anterior;
            return;
        }

        fila.estado = nuevo;
        mostrarMensaje(`Estado cambiado a «${formatearEstado(nuevo)}».`, 'success');
        render();
    });

    buscador.addEventListener('input', render);

    el.querySelectorAll('.filter-button').forEach((boton) => {
        boton.addEventListener('click', () => {
            el.querySelectorAll('.filter-button').forEach((otro) => otro.classList.remove('active'));
            boton.classList.add('active');
            filtro = boton.dataset.clave;
            render();
        });
    });

    tbody.innerHTML = `<tr><td colspan="${abarca}" class="table-message">Cargando...</td></tr>`;

    try {
        const { data, error } = await supabase
            .from(config.tabla)
            .select(config.campos)
            .order('created_at', { ascending: false });

        if (error) throw error;

        datos = data ?? [];
        cargado = true;
        render();
    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="${abarca}" class="table-message">No se pudo cargar la información.</td></tr>`;
    }

    return el;
}


const FILTROS_NOTICIAS = [
    { clave: 'TODOS', etiqueta: 'Todas' },
    { clave: 'PUBLICADO', etiqueta: 'Publicadas' },
    { clave: 'PROGRAMADO', etiqueta: 'Programadas' },
    { clave: 'BORRADOR', etiqueta: 'Borradores' },
    { clave: 'ARCHIVADO', etiqueta: 'Archivadas' }
];

const FILTROS_MASCULINO = [
    { clave: 'TODOS', etiqueta: 'Todos' },
    { clave: 'PUBLICADO', etiqueta: 'Publicados' },
    { clave: 'PROGRAMADO', etiqueta: 'Programados' },
    { clave: 'BORRADOR', etiqueta: 'Borradores' },
    { clave: 'ARCHIVADO', etiqueta: 'Archivados' }
];

const DESTINOS = {
    ninguno: 'Sin botón',
    form: 'Formulario',
    whatsapp: 'WhatsApp',
    email: 'Correo',
    url: 'URL externa',
    pagina: 'Página interna'
};


/* ═══════════════════════════════════════════════════════════════════════════
   VISTA ARCHIVO — publicaciones archivadas de todas las tablas
   ═══════════════════════════════════════════════════════════════════════════ */

async function vistaArchivo() {

    const el = document.createElement('div');
    el.className = 'view-enter';

    el.innerHTML = `
        <section class="page-toolbar">
            <div>
                <span class="section-label">HISTORIAL</span>
                <h2>Archivo</h2>
                <p>Publicaciones que han sido archivadas y ya no aparecen en el portal.</p>
            </div>
        </section>

        <div id="editor-message" class="editor-message" role="status" hidden></div>

        <section class="admin-table-card">
            <div class="admin-table-wrapper">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Tipo</th>
                            <th>Título</th>
                            <th>Fecha</th>
                            <th>Estado original</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </section>`;

    const tbody = el.querySelector('tbody');
    const mensajeEl = $('#editor-message', el);

    const mostrarMensaje = (texto, tipo) => {
        mensajeEl.textContent = texto;
        mensajeEl.className = `editor-message editor-message-${tipo}`;
        mensajeEl.hidden = false;
    };

    tbody.innerHTML = `<tr><td colspan="4" class="table-message">Cargando historial...</td></tr>`;

    try {
        const [noticiasRes, eventosRes, anunciosRes] = await Promise.all([
            supabase.from('noticias').select('id, titulo, estado, fecha_publicacion, created_at').eq('estado', 'ARCHIVADO'),
            supabase.from('eventos').select('id, titulo, estado, fecha_inicio, created_at').eq('estado', 'ARCHIVADO'),
            supabase.from('anuncios').select('id, titulo, estado, fecha_inicio, created_at').eq('estado', 'ARCHIVADO')
        ]);

        const filas = [];

        (noticiasRes.data ?? []).forEach((n) => filas.push({
            id: n.id,
            tipo: 'Noticia',
            titulo: n.titulo,
            fecha: n.fecha_publicacion || n.created_at,
            estado: n.estado
        }));

        (eventosRes.data ?? []).forEach((e) => filas.push({
            id: e.id,
            tipo: 'Evento',
            titulo: e.titulo,
            fecha: e.fecha_inicio || e.created_at,
            estado: e.estado
        }));

        (anunciosRes.data ?? []).forEach((a) => filas.push({
            id: a.id,
            tipo: 'Anuncio',
            titulo: a.titulo,
            fecha: a.fecha_inicio || a.created_at,
            estado: a.estado
        }));

        filas.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

        if (!filas.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="table-message">No hay publicaciones archivadas.</td></tr>`;
            return el;
        }

        const fragmento = document.createDocumentFragment();

        filas.forEach((fila) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="status-badge status-neutro">${esc(fila.tipo)}</span></td>
                <td class="table-cell-strong">${esc(fila.titulo)}</td>
                <td>${esc(formatearFecha(fila.fecha))}</td>
                <td><span class="status-badge status-archivado">${esc(formatearEstado(fila.estado))}</span></td>
            `;
            fragmento.appendChild(tr);
        });

        tbody.innerHTML = '';
        tbody.appendChild(fragmento);
    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="4" class="table-message">No se pudo cargar el historial.</td></tr>`;
        mostrarMensaje(mensajeSupabase(error, 'No se pudo cargar el archivo.'), 'error');
    }

    return el;
}


const LISTADOS = {

    noticias: () => vistaListado({
        seccion: 'noticias',
        etiqueta: 'CONTENIDO',
        titulo: 'Noticias',
        descripcion: 'Crea, edita y administra las publicaciones de Nexo Sistémico.',
        accionNuevo: '+ Nueva noticia',
        placeholderBusqueda: 'Buscar por título...',
        tabla: 'noticias',
        campos: 'id, titulo, slug, categoria, estado, fecha_publicacion, created_at',
        edicionRapida: true,
        claveFiltro: (fila) => fila.estado,
        filtros: FILTROS_NOTICIAS,
        columnas: [
            {
                titulo: 'Noticia',
                celda: (fila) => `<td><div class="table-title"><strong>${esc(fila.titulo)}</strong><small>${esc(fila.slug ?? '')}</small></div></td>`
            },
            {
                titulo: 'Categoría',
                celda: (fila) => `<td>${esc(fila.categoria ?? '—')}</td>`
            },
            {
                titulo: 'Estado',
                celda: (fila) => `<td>${insigniaVisibilidad({ estado: fila.estado, fecha_inicio: fila.fecha_publicacion })}</td>`
            },
            {
                titulo: 'Fecha',
                celda: (fila) => `<td>${esc(formatearFecha(fila.fecha_publicacion))}</td>`
            }
        ]
    }),

    eventos: () => vistaListado({
        seccion: 'eventos',
        etiqueta: 'AGENDA',
        titulo: 'Eventos',
        descripcion: 'Administra las actividades y fechas de la agenda académica.',
        accionNuevo: '+ Nuevo evento',
        placeholderBusqueda: 'Buscar por título o lugar...',
        tabla: 'eventos',
        campos: 'id, titulo, slug, resumen, lugar, fecha_inicio, fecha_fin, estado, url_inscripcion, created_at',
        edicionRapida: true,
        claveFiltro: (fila) => fila.estado,
        filtros: FILTROS_MASCULINO,
        columnas: [
            {
                titulo: 'Evento',
                celda: (fila) => `<td><div class="table-title"><strong>${esc(fila.titulo)}</strong><small>${esc(fila.slug ?? '')}</small></div></td>`
            },
            {
                titulo: 'Vigencia',
                celda: (fila) => `<td>${esc(formatearRango(fila.fecha_inicio, fila.fecha_fin))}</td>`
            },
            {
                titulo: 'Lugar',
                celda: (fila) => `<td>${esc(fila.lugar ?? '—')}</td>`
            },
            {
                titulo: 'Estado',
                celda: (fila) => `<td>${insigniaVisibilidad(fila)}</td>`
            },
            {
                titulo: 'Inscripción',
                celda: (fila) => `<td><span class="status-badge ${fila.url_inscripcion ? 'status-neutro' : 'status-archivado'}">${fila.url_inscripcion ? 'Enlace externo' : 'Solo detalle'}</span></td>`
            }
        ]
    }),

    anuncios: () => vistaListado({
        seccion: 'anuncios',
        etiqueta: 'TABLÓN',
        titulo: 'Anuncios',
        descripcion: 'Publica avisos en el tablón de la comunidad.',
        accionNuevo: '+ Nuevo anuncio',
        placeholderBusqueda: 'Buscar por título o texto...',
        tabla: 'anuncios',
        campos: 'id, titulo, tipo, texto, modo, fecha_inicio, fecha_fin, estado, destino_tipo, created_at',
        edicionRapida: true,
        claveFiltro: (fila) => fila.estado,
        filtros: FILTROS_MASCULINO,
        columnas: [
            {
                titulo: 'Anuncio',
                celda: (fila) => `<td><div class="table-title"><strong>${esc(fila.titulo || 'Sin título')}</strong><small>${esc(formatearFecha(fila.created_at))}</small></div></td>`
            },
            {
                titulo: 'Tipo',
                celda: (fila) => {
                    const tipo = fila.tipo
                        ? fila.tipo.charAt(0).toUpperCase() + fila.tipo.slice(1)
                        : '—';
                    return `<td><span class="status-badge status-neutro">${esc(tipo)}</span></td>`;
                }
            },
            {
                titulo: 'Composición',
                celda: (fila) => `<td>${esc(fila.modo ?? 'texto')}</td>`
            },
            {
                titulo: 'Vigencia',
                celda: (fila) => `<td>${esc(formatearRango(fila.fecha_inicio, fila.fecha_fin))}</td>`
            },
            {
                titulo: 'Estado',
                celda: (fila) => `<td>${insigniaVisibilidad(fila)}</td>`
            },
            {
                titulo: 'Destino',
                celda: (fila) => `<td>${esc(DESTINOS[fila.destino_tipo] ?? fila.destino_tipo ?? '—')}</td>`
            }
        ]
    }),

    administradores: () => vistaListado({
        seccion: 'administradores',
        etiqueta: 'ACCESO',
        titulo: 'Administradores',
        descripcion: 'Perfiles con acceso al panel de administración.',
        accionNuevo: '+ Nuevo administrador',
        placeholderBusqueda: 'Buscar por nombre...',
        tabla: 'perfiles_admin',
        campos: 'id, nombre, rol, estado, created_at',
        claveFiltro: (fila) => fila.estado,
        filtros: [
            { clave: 'TODOS', etiqueta: 'Todos' },
            { clave: 'ACTIVO', etiqueta: 'Activos' },
            { clave: 'INACTIVO', etiqueta: 'Inactivos' }
        ],
        columnas: [
            {
                titulo: 'Administrador',
                celda: (fila) => `<td><div class="table-title"><strong>${esc(fila.nombre)}</strong><small>${esc(String(fila.id).slice(0, 8))}...</small></div></td>`
            },
            {
                titulo: 'Rol',
                celda: (fila) => `<td><span class="status-badge ${fila.rol === 'ADMINISTRADOR' ? 'status-publicado' : 'status-neutro'}">${esc(formatearRol(fila.rol))}</span></td>`
            },
            {
                titulo: 'Estado',
                celda: (fila) => `<td><span class="status-badge ${fila.estado === 'ACTIVO' ? 'status-publicado' : 'status-archivado'}">${fila.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}</span></td>`
            },
            {
                titulo: 'Creado',
                celda: (fila) => `<td>${esc(formatearFecha(fila.created_at))}</td>`
            }
        ]
    }),

    archivo: vistaArchivo

};


/* ══════════════════════════════════════════════════════════════════════════
   EDITORES — estructura común
   ══════════════════════════════════════════════════════════════════════════ */

function crearEsqueleto({ seccion, plural, etiqueta, singular, editando, ayuda, principal, lateral }) {
    const el = document.createElement('div');
    el.className = 'view-enter';

    el.innerHTML = `
        <div class="editor-back">
            <a href="#/${seccion}">← Volver a ${esc(plural)}</a>
        </div>

        <section class="page-toolbar">
            <div>
                <span class="section-label">${esc(etiqueta)}</span>
                <h2>${editando ? 'Editar' : 'Crear'} ${esc(singular)}</h2>
                <p>${esc(ayuda)}</p>
            </div>
        </section>

        <div
            id="editor-message"
            class="editor-message"
            role="alert"
            hidden
        ></div>

        <form id="editor-form">
            <div class="editor-layout">
                <section class="editor-main-column">${principal}</section>
                <aside class="editor-side-column">${lateral}</aside>
            </div>
        </form>`;

    return el;
}


function opcionesEstado() {
    return `
        <option value="BORRADOR">Borrador</option>
        <option value="PROGRAMADO">Programado</option>
        <option value="PUBLICADO">Publicado</option>
        <option value="ARCHIVADO">Archivado</option>`;
}


/**
 * La frase de ayuda cita el campo de fecha por su etiqueta visible, que no
 * siempre empieza por "Fecha" (en anuncios es "Visible desde"). Si no la
 * trae, se cita entrecomillada como "la fecha «Visible desde»" para que la
 * frase siga leyéndose bien.
 */
function comoFecha(etiqueta) {
    const minusculas = etiqueta.toLowerCase();
    return minusculas.includes('fecha')
        ? `la ${minusculas}`
        : `la fecha «${etiqueta}»`;
}


/**
 * Texto bajo el selector de estado: dice exactamente qué pasará al guardar,
 * cruzando estado + fechas.
 *
 *   PUBLICADO  + fecha futura → se ve YA (publicar antes de la fecha de
 *                               validez es una decisión válida)
 *   PROGRAMADO + fecha futura → el portal lo espera; se publica solo
 *
 * `selectoresFechas` apunta a los inputs datetime del editor. Un campo
 * deshabilitado es una casilla "indefinido" marcada y cuenta como sin fecha.
 *
 * Devuelve la función de refresco por si los datos cargan después del cableado.
 */
function conectarAyudaEstado(raiz, selectoresFechas) {

    const select = $('#estado', raiz);
    const ayuda = $('#estado-ayuda', raiz);

    if (!select || !ayuda) return () => {};

    const campos = selectoresFechas
        .map((selector) => $(selector, raiz))
        .filter(Boolean);

    function describir() {

        const estado = select.value;

        const fechas = campos
            .map((campo) => ({
                valor: campo.disabled ? null : campo.value,
                // Se guarda con su mayúscula original: comoFecha() decide cómo
                // bajarla a minúsculas según la frase.
                etiqueta: (campo.closest('.form-group')?.querySelector('label')?.textContent ?? '').trim()
            }))
            .filter((entrada) => entrada.valor);

        const futuras = fechas.filter(
            (entrada) => new Date(entrada.valor).getTime() > Date.now()
        );

        if (estado === 'BORRADOR') {
            ayuda.textContent = 'Oculto en el portal hasta que lo publiques.';
            return;
        }

        if (estado === 'ARCHIVADO') {
            ayuda.textContent = 'Oculto en el portal. Puedes volver a publicarlo más adelante.';
            return;
        }

        if (estado === 'PUBLICADO') {
            ayuda.textContent = futuras.length
                ? `Se mostrará desde que guardes, aunque ${futuras.map((f) => `${comoFecha(f.etiqueta)} sea futura`).join(' y ')}.`
                : 'Se mostrará en el portal desde que guardes.';
            return;
        }

        if (estado === 'PROGRAMADO') {
            if (futuras.length) {
                ayuda.textContent = `El portal lo publicará solo el ${formatearFecha(futuras[0].valor)}.`;
            } else {
                ayuda.textContent = 'Sin fecha futura: se publicará en cuanto guardes.';
            }
        }
    }

    select.addEventListener('change', describir);
    campos.forEach((campo) => {
        campo.addEventListener('input', describir);
        campo.addEventListener('change', describir);
    });

    describir();

    return describir;
}


/** Flujo de guardado compartido por los tres editores de contenido. */
function conectarGuardado({ el, mensajes, editando, botonTextoCrear, construirDatos, portada, tabla, id, carpeta }) {

    const formulario = $('#editor-form', el);
    const boton = $('#save-button', el);

    formulario.addEventListener('submit', async (evento) => {
        evento.preventDefault();
        mensajes.limpiar();

        if (!formulario.reportValidity()) return;

        const validacion = construirDatos();
        if (validacion.error) {
            mensajes.mostrar(validacion.error, 'error');
            return;
        }

        boton.disabled = true;
        boton.textContent = 'Guardando...';

        try {
            const resultado = await guardarContenido({
                tabla,
                id,
                datos: validacion.datos,
                carpeta,
                portada
            });

            if (resultado.creado) {
                // Como al crear, se pasa al modo edición del registro nuevo.
                irA(`#/${tabla === 'perfiles_admin' ? 'administradores' : carpeta}/editar/${resultado.id}`);
            } else {
                mensajes.mostrar('Cambios guardados correctamente.', 'success');
            }
        } catch (error) {
            console.error(error);
            mensajes.mostrar(mensajeSupabase(error, 'No se pudo guardar.'), 'error');
        } finally {
            boton.disabled = false;
            boton.textContent = editando ? 'Guardar cambios' : botonTextoCrear;
        }
    });
}


/* ══════════════════════════════════════════════════════════════════════════
   EDITOR DE NOTICIAS
   ══════════════════════════════════════════════════════════════════════════ */

async function vistaNoticia(id) {

    const editando = Boolean(id);

    const el = crearEsqueleto({
        seccion: 'noticias',
        plural: 'noticias',
        etiqueta: 'NOTICIAS',
        singular: 'noticia',
        editando,
        ayuda: 'Completa la información que aparecerá en el portal.',

        principal: `
            <div class="editor-card">
                <div class="form-group">
                    <label for="titulo">Título *</label>
                    <input
                        id="titulo"
                        name="titulo"
                        type="text"
                        maxlength="200"
                        required
                        placeholder="Título de la noticia"
                    >
                </div>

                <div class="form-group">
                    <label for="slug">Slug *</label>
                    <input
                        id="slug"
                        name="slug"
                        type="text"
                        maxlength="200"
                        required
                        placeholder="titulo-de-la-noticia"
                    >
                    <small class="form-help">
                        Se utilizará para construir la URL pública.
                    </small>
                </div>

                <div class="form-group">
                    <label for="resumen">Resumen *</label>
                    <textarea
                        id="resumen"
                        name="resumen"
                        rows="4"
                        minlength="10"
                        maxlength="600"
                        required
                        placeholder="Resumen breve de la noticia..."
                    ></textarea>

                    <div class="field-meta">
                        <small>Entre 10 y 600 caracteres.</small>
                        <small id="resumen-counter">0 / 600</small>
                    </div>
                </div>

                <div class="form-group">
                    <label for="contenido">Contenido *</label>
                    <textarea
                        id="contenido"
                        name="contenido"
                        rows="16"
                        required
                        placeholder="Escribe aquí el contenido completo de la noticia..."
                    ></textarea>

                    <small class="form-help">
                        Por ahora utilizamos texto plano.
                    </small>
                </div>
            </div>`,

        lateral: `
            ${portadaHTML('Portada')}

            <div class="editor-card">
                <h3>Publicación</h3>

                <div class="form-group">
                    <label for="estado">Estado</label>
                    <select id="estado" name="estado">
                        ${opcionesEstado()}
                    </select>
                    <small class="form-help" id="estado-ayuda"></small>
                </div>

                <div class="form-group">
                    <label for="categoria">Categoría</label>
                    <input
                        id="categoria"
                        name="categoria"
                        type="text"
                        maxlength="80"
                        placeholder="Ej. Académico"
                    >
                </div>

                <div class="form-group">
                    <label for="fecha-publicacion">Fecha de publicación</label>
                    <input
                        id="fecha-publicacion"
                        name="fecha_publicacion"
                        type="datetime-local"
                    >
                    <small class="form-help">
                        Si la dejas vacía y guardas como Publicada, se usará la
                        fecha actual. Con estado Programado, es la fecha en la
                        que se publicará sola.
                    </small>
                </div>

                <div class="editor-divider"></div>

                <button
                    id="save-button"
                    type="submit"
                    class="editor-save-button"
                >${editando ? 'Guardar cambios' : 'Guardar noticia'}</button>
            </div>`
    });

    const mensajes = crearMensajes(el);
    const portada = prepararPortada(el, mensajes.mostrar);
    const slug = prepararSlug(el);
    const actualizarContador = prepararContador(el, '#resumen', '#resumen-counter', 600);
    const describirEstado = conectarAyudaEstado(el, ['#fecha-publicacion']);

    if (editando) {
        const registro = await cargarRegistro(
            'noticias',
            'id, titulo, slug, resumen, contenido, categoria, imagen_url, estado, fecha_publicacion',
            id
        );

        rellenar(el, registro);
        portada.aplicarUrl(registro.imagen_url);
        slug.fijarManual();
        actualizarContador();
        describirEstado();
    }

    conectarGuardado({
        el,
        mensajes,
        editando,
        botonTextoCrear: 'Guardar noticia',
        tabla: 'noticias',
        id,
        carpeta: 'noticias',
        portada,
        construirDatos: () => {
            const titulo = $('#titulo', el).value.trim();
            const slugFinal = slug.normalizar();
            const resumen = $('#resumen', el).value.trim();
            const contenido = $('#contenido', el).value.trim();

            if (!slugFinal) {
                return { error: 'El título debe generar un slug válido (solo letras y números).' };
            }

            if (resumen.length < 10) {
                return { error: 'El resumen debe tener al menos 10 caracteres.' };
            }

            if (contenido.length < 20) {
                return { error: 'El contenido debe tener al menos 20 caracteres.' };
            }

            const estado = $('#estado', el).value;
            const valorFecha = $('#fecha-publicacion', el).value;

            let fechaPublicacion = null;

            if (valorFecha) {
                const fecha = new Date(valorFecha);

                if (Number.isNaN(fecha.getTime())) {
                    return { error: 'La fecha de publicación no es válida.' };
                }

                fechaPublicacion = fecha.toISOString();
            } else if (estado === 'PUBLICADO') {
                fechaPublicacion = new Date().toISOString();
            }

            return {
                datos: {
                    titulo,
                    slug: slugFinal,
                    resumen,
                    contenido,
                    categoria: $('#categoria', el).value.trim() || null,
                    estado,
                    fecha_publicacion: fechaPublicacion
                }
            };
        }
    });

    return el;
}


/* ══════════════════════════════════════════════════════════════════════════
   EDITOR DE EVENTOS
   ══════════════════════════════════════════════════════════════════════════ */

async function vistaEvento(id) {

    const editando = Boolean(id);

    const el = crearEsqueleto({
        seccion: 'eventos',
        plural: 'eventos',
        etiqueta: 'EVENTOS',
        singular: 'evento',
        editando,
        ayuda: 'Define cuándo y dónde ocurrirá la actividad.',

        principal: `
            <div class="editor-card">
                <div class="form-group">
                    <label for="titulo">Título *</label>
                    <input
                        id="titulo"
                        name="titulo"
                        type="text"
                        maxlength="200"
                        required
                        placeholder="Título del evento"
                    >
                </div>

                <div class="form-group">
                    <label for="slug">Slug *</label>
                    <input
                        id="slug"
                        name="slug"
                        type="text"
                        maxlength="200"
                        required
                        placeholder="titulo-del-evento"
                    >
                    <small class="form-help">
                        Se utilizará para construir la URL pública.
                    </small>
                </div>

                <div class="form-group">
                    <label for="resumen">Resumen *</label>
                    <textarea
                        id="resumen"
                        name="resumen"
                        rows="3"
                        minlength="10"
                        maxlength="600"
                        required
                        placeholder="Resumen breve del evento..."
                    ></textarea>

                    <div class="field-meta">
                        <small>Entre 10 y 600 caracteres.</small>
                        <small id="resumen-counter">0 / 600</small>
                    </div>
                </div>

                <div class="form-group">
                    <label for="contenido">Contenido *</label>
                    <textarea
                        id="contenido"
                        name="contenido"
                        rows="14"
                        required
                        placeholder="Descripción completa del evento..."
                    ></textarea>
                </div>

                <div class="form-group">
                    <label for="lugar">Lugar</label>
                    <input
                        id="lugar"
                        name="lugar"
                        type="text"
                        maxlength="150"
                        placeholder="Ej. Auditorio Central"
                    >
                </div>
            </div>`,

        lateral: `
            ${portadaHTML('Imagen del evento')}

            <div class="editor-card">
                <h3>Vigencia</h3>

                <div class="form-group">
                    <label for="fecha-inicio">Fecha y hora de inicio *</label>
                    <input
                        id="fecha-inicio"
                        name="fecha_inicio"
                        type="datetime-local"
                        required
                    >
                    <small class="form-help">
                        Obligatoria: el evento no puede existir sin fecha de inicio.
                    </small>
                </div>

                <div class="form-group">
                    <label for="fecha-fin">Fecha y hora de fin</label>
                    <input
                        id="fecha-fin"
                        name="fecha_fin"
                        type="datetime-local"
                    >

                    <label class="indefinido-row">
                        <input type="checkbox" id="fecha-fin-indefinido">
                        <span>Sin fecha de fin (indefinido)</span>
                    </label>
                </div>
            </div>

            <div class="editor-card">
                <h3>Publicación</h3>

                <div class="form-group">
                    <label for="estado">Estado</label>
                    <select id="estado" name="estado">
                        ${opcionesEstado()}
                    </select>
                    <small class="form-help" id="estado-ayuda"></small>
                </div>

                <div class="form-group">
                    <label for="url-inscripcion">Enlace de inscripción</label>
                    <input
                        id="url-inscripcion"
                        name="url_inscripcion"
                        type="text"
                        maxlength="500"
                        placeholder="https://forms.google.com/..."
                    >
                    <small class="form-help">
                        Opcional. El portal lo abrirá en otra pestaña.
                    </small>
                </div>

                <div class="editor-divider"></div>

                <button
                    id="save-button"
                    type="submit"
                    class="editor-save-button"
                >${editando ? 'Guardar cambios' : 'Guardar evento'}</button>
            </div>`
    });

    const mensajes = crearMensajes(el);
    const portada = prepararPortada(el, mensajes.mostrar);
    const slug = prepararSlug(el);
    const actualizarContador = prepararContador(el, '#resumen', '#resumen-counter', 600);

    // eventos.fecha_inicio es NOT NULL: solo fecha_fin admite "indefinido".
    const vigenciaFin = conectarIndefinido(
        $('#fecha-fin', el),
        $('#fecha-fin-indefinido', el)
    );

    const describirEstado = conectarAyudaEstado(el, ['#fecha-inicio', '#fecha-fin']);

    if (editando) {
        const registro = await cargarRegistro(
            'eventos',
            'id, titulo, slug, resumen, contenido, lugar, fecha_inicio, fecha_fin, url_inscripcion, imagen_url, estado',
            id
        );

        rellenar(el, registro);
        vigenciaFin.aplicar(registro.fecha_fin);
        portada.aplicarUrl(registro.imagen_url);
        slug.fijarManual();
        actualizarContador();
        describirEstado();
    }

    conectarGuardado({
        el,
        mensajes,
        editando,
        botonTextoCrear: 'Guardar evento',
        tabla: 'eventos',
        id,
        carpeta: 'eventos',
        portada,
        construirDatos: () => {
            const titulo = $('#titulo', el).value.trim();
            const slugFinal = slug.normalizar();
            const resumen = $('#resumen', el).value.trim();
            const contenido = $('#contenido', el).value.trim();
            const fechaInicio = convertirInputAFecha($('#fecha-inicio', el).value);
            const fechaFin = vigenciaFin.leer();

            if (!titulo) return { error: 'El título es obligatorio.' };
            if (!slugFinal) return { error: 'El título debe generar un slug válido (solo letras y números).' };
            if (resumen.length < 10) return { error: 'El resumen debe tener al menos 10 caracteres.' };
            if (contenido.length < 20) return { error: 'El contenido debe tener al menos 20 caracteres.' };
            if (!fechaInicio) return { error: 'La fecha de inicio es obligatoria.' };

            if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
                return { error: 'La fecha de fin no puede ser anterior a la de inicio.' };
            }

            const urlInscripcion = $('#url-inscripcion', el).value.trim();

            if (urlInscripcion) {
                try {
                    const url = new URL(urlInscripcion);
                    if (!['http:', 'https:'].includes(url.protocol)) {
                        return { error: 'El enlace de inscripción debe empezar por http:// o https://.' };
                    }
                } catch {
                    return { error: 'El enlace de inscripción no es una URL válida.' };
                }
            }

            return {
                datos: {
                    titulo,
                    slug: slugFinal,
                    resumen,
                    contenido,
                    lugar: $('#lugar', el).value.trim() || null,
                    fecha_inicio: fechaInicio,
                    fecha_fin: fechaFin,
                    url_inscripcion: urlInscripcion || null,
                    estado: $('#estado', el).value
                }
            };
        }
    });

    return el;
}


/* ══════════════════════════════════════════════════════════════════════════
   EDITOR DE ANUNCIOS
   ══════════════════════════════════════════════════════════════════════════ */

async function vistaAnuncio(id) {

    const editando = Boolean(id);

    const el = crearEsqueleto({
        seccion: 'anuncios',
        plural: 'anuncios',
        etiqueta: 'ANUNCIOS',
        singular: 'anuncio',
        editando,
        ayuda: 'Publica avisos en el tablón de la comunidad.',

        principal: `
            <div class="editor-card">
                <div class="form-group">
                    <label for="titulo">Título</label>
                    <input
                        id="titulo"
                        name="titulo"
                        type="text"
                        maxlength="200"
                        placeholder="Opcional: asunto del aviso"
                    >
                </div>

                <div class="form-group">
                    <label for="texto">Texto *</label>
                    <textarea
                        id="texto"
                        name="texto"
                        rows="7"
                        maxlength="600"
                        required
                        placeholder="Texto del aviso..."
                    ></textarea>

                    <div class="field-meta">
                        <small>Hasta 600 caracteres.</small>
                        <small id="texto-counter">0 / 600</small>
                    </div>
                </div>

                <div class="form-group">
                    <label for="autor-texto">Atribución</label>
                    <input
                        id="autor-texto"
                        name="autor_texto"
                        type="text"
                        maxlength="120"
                        placeholder="Ej. Prof. Ramírez · Redes"
                    >
                    <small class="form-help">
                        Aparece debajo del texto como firma del aviso.
                    </small>
                </div>
            </div>`,

        lateral: `
            ${portadaHTML('Imagen del anuncio')}

            <div class="editor-card">
                <h3>Composición</h3>

                <div class="form-group">
                    <label for="modo">Presentación</label>
                    <select id="modo" name="modo">
                        <option value="texto">Solo texto</option>
                        <option value="imagen">Solo imagen</option>
                        <option value="mixto">Imagen + texto</option>
                    </select>

                    <small class="form-help" id="modo-help"></small>
                </div>

                <div class="form-group">
                    <label for="tipo">Tipo</label>
                    <select id="tipo" name="tipo">
                        <option value="general">General</option>
                        <option value="urgente">Urgente</option>
                        <option value="info">Académico</option>
                        <option value="social">Social</option>
                        <option value="venta">Empleo</option>
                    </select>
                </div>
            </div>

            <div class="editor-card">
                <h3>Destino del botón</h3>

                <div class="form-group">
                    <label for="destino-tipo">Tipo de destino</label>
                    <select id="destino-tipo" name="destino_tipo">
                        <option value="ninguno">Sin botón</option>
                        <option value="form">Formulario</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="email">Correo</option>
                        <option value="url">URL externa</option>
                        <option value="pagina">Página interna</option>
                    </select>
                </div>

                <div class="form-group" id="grupo-destino-url">
                    <label for="destino-url">Enlace</label>
                    <input
                        id="destino-url"
                        name="destino_url"
                        type="text"
                        maxlength="500"
                        placeholder="https://forms.google.com/..."
                    >
                </div>

                <div class="form-group" id="grupo-destino-label">
                    <label for="destino-label">Texto del botón</label>
                    <input
                        id="destino-label"
                        name="destino_label"
                        type="text"
                        maxlength="60"
                        placeholder="Ej. Inscribirme ahora"
                    >
                </div>

                <small class="form-help" id="destino-help"></small>
            </div>

            <div class="editor-card">
                <h3>Vigencia</h3>

                <div class="form-group">
                    <label for="fecha-inicio">Visible desde</label>
                    <input
                        id="fecha-inicio"
                        name="fecha_inicio"
                        type="datetime-local"
                    >

                    <label class="indefinido-row">
                        <input type="checkbox" id="fecha-inicio-indefinido">
                        <span>Sin fecha de inicio</span>
                    </label>
                </div>

                <div class="form-group">
                    <label for="fecha-fin">Visible hasta</label>
                    <input
                        id="fecha-fin"
                        name="fecha_fin"
                        type="datetime-local"
                    >

                    <label class="indefinido-row">
                        <input type="checkbox" id="fecha-fin-indefinido">
                        <span>Sin fecha de fin (indefinido)</span>
                    </label>
                </div>
            </div>

            <div class="editor-card">
                <h3>Publicación</h3>

                <div class="form-group">
                    <label for="estado">Estado</label>
                    <select id="estado" name="estado">
                        ${opcionesEstado()}
                    </select>
                    <small class="form-help" id="estado-ayuda"></small>
                </div>

                <div class="editor-divider"></div>

                <button
                    id="save-button"
                    type="submit"
                    class="editor-save-button"
                >${editando ? 'Guardar cambios' : 'Guardar anuncio'}</button>
            </div>`
    });

    const mensajes = crearMensajes(el);
    const portada = prepararPortada(el, mensajes.mostrar);
    const actualizarContador = prepararContador(el, '#texto', '#texto-counter', 600);

    const vigenciaInicio = conectarIndefinido(
        $('#fecha-inicio', el),
        $('#fecha-inicio-indefinido', el)
    );
    const vigenciaFin = conectarIndefinido(
        $('#fecha-fin', el),
        $('#fecha-fin-indefinido', el)
    );

    /* Campos dependientes: el modo decide si el texto es obligatorio, y el
       destino decide si hace falta enlace y etiqueta. */

    const sincronizarModo = () => {
        const modo = $('#modo', el).value;

        const ayuda = {
            texto: 'Solo se muestra el texto. No necesitas imagen.',
            imagen: 'Solo se muestra la imagen: el texto se oculta y deja de ser obligatorio.',
            mixto: 'La imagen aparece arriba y el texto debajo.'
        };

        $('#modo-help', el).textContent = ayuda[modo] ?? '';

        const texto = $('#texto', el);
        texto.required = modo !== 'imagen';
        texto.disabled = modo === 'imagen';
    };

    const sincronizarDestino = () => {
        const tipo = $('#destino-tipo', el).value;
        const conBoton = tipo !== 'ninguno';

        $('#grupo-destino-url', el).hidden = !conBoton;
        $('#grupo-destino-label', el).hidden = !conBoton;

        $('#destino-url', el).required = conBoton;
        $('#destino-label', el).required = conBoton;

        $('#destino-help', el).textContent = tipo === 'email'
            ? 'Usa el formato mailto:correo@ejemplo.pe'
            : tipo === 'pagina'
                ? 'Ruta interna del portal, por ejemplo /pages/noticias.html'
                : 'Incluye https:// — el tablón lo abre en otra pestaña.';
    };

    $('#modo', el).addEventListener('change', sincronizarModo);
    $('#destino-tipo', el).addEventListener('change', sincronizarDestino);

    const describirEstado = conectarAyudaEstado(el, ['#fecha-inicio', '#fecha-fin']);

    if (editando) {
        const registro = await cargarRegistro(
            'anuncios',
            'id, titulo, tipo, texto, imagen_url, destino_url, destino_label, destino_tipo, modo, autor_texto, fecha_inicio, fecha_fin, estado',
            id
        );

        rellenar(el, registro);
        vigenciaInicio.aplicar(registro.fecha_inicio);
        vigenciaFin.aplicar(registro.fecha_fin);
        portada.aplicarUrl(registro.imagen_url);
        actualizarContador();
    }

    sincronizarModo();
    sincronizarDestino();
    describirEstado();

    conectarGuardado({
        el,
        mensajes,
        editando,
        botonTextoCrear: 'Guardar anuncio',
        tabla: 'anuncios',
        id,
        carpeta: 'anuncios',
        portada,
        construirDatos: () => {
            const modo = $('#modo', el).value;
            const destinoTipo = $('#destino-tipo', el).value;

            const titulo = $('#titulo', el).value.trim();
            const texto = $('#texto', el).value.trim();
            const destinoUrl = $('#destino-url', el).value.trim();

            const fechaInicio = vigenciaInicio.leer();
            const fechaFin = vigenciaFin.leer();

            // Solo el modo "imagen" puede quedarse sin texto.
            if (modo !== 'imagen' && texto.length < 3) {
                return { error: 'El texto es obligatorio (mínimo 3 caracteres).' };
            }

            if (texto.length > 600) {
                return { error: 'El texto supera los 600 caracteres.' };
            }

            // El modo "solo imagen" necesita una imagen al guardar.
            const habraImagen = Boolean(portada.estado.seleccionada)
                || (Boolean(portada.estado.urlActual) && !portada.estado.eliminar);

            if (modo === 'imagen' && !habraImagen) {
                return { error: 'El modo «Solo imagen» necesita una imagen.' };
            }

            if (destinoTipo !== 'ninguno' && !destinoUrl) {
                return { error: 'Seleccionaste un botón de destino, pero falta el enlace.' };
            }

            if (destinoUrl) {

                // Las páginas internas se referencian con ruta absoluta
                // ("/pages/noticias.html"): no son URLs completas.
                const esRutaInterna = destinoTipo === 'pagina' && destinoUrl.startsWith('/');

                if (esRutaInterna) {
                    // Válido: se deja pasar tal cual.
                } else {
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
            }

            if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
                return { error: 'La fecha de fin no puede ser anterior a la de inicio.' };
            }

            return {
                datos: {
                    titulo: titulo || null,
                    tipo: $('#tipo', el).value,
                    texto,
                    modo,
                    autor_texto: $('#autor-texto', el).value.trim() || null,
                    destino_url: destinoUrl || null,
                    destino_label: $('#destino-label', el).value.trim() || null,
                    destino_tipo: destinoTipo,
                    fecha_inicio: fechaInicio,
                    fecha_fin: fechaFin,
                    estado: $('#estado', el).value
                }
            };
        }
    });

    return el;
}


/* ══════════════════════════════════════════════════════════════════════════
   EDITOR DE ADMINISTRADORES
   ══════════════════════════════════════════════════════════════════════════ */

async function vistaPerfil(id) {

    const editando = Boolean(id);
    const yo = store.admin.perfil;
    const miNivel = rolANivel(yo.rol);

    const el = crearEsqueleto({
        seccion: 'administradores',
        plural: 'administradores',
        etiqueta: 'ACCESO',
        singular: 'perfil',
        editando,
        ayuda: 'Define quién puede entrar al panel y qué puede hacer.',

        principal: `
            <div class="editor-card">
                <div class="form-group">
                    <label for="nombre">Nombre *</label>
                    <input
                        id="nombre"
                        name="nombre"
                        type="text"
                        maxlength="120"
                        required
                        placeholder="Nombre completo"
                    >
                    <small class="form-help">
                        El usuario debe existir en Supabase Auth
                        (Authentication → Users) para poder iniciar sesión.
                    </small>
                </div>
            </div>`,

        lateral: `
            <div class="editor-card">
                <h3>Acceso</h3>

                <div class="form-group">
                    <label for="rol">Rol *</label>
                    <select id="rol" name="rol" required>
                        ${opcionesRolDisponibles(miNivel, editando ? null : undefined)}
                    </select>

                    <small class="form-help">
                        ${miNivel === NIVEL_ACCESO.MAESTRO
                            ? 'Cuenta principal: puede crear administradores y editores.'
                            : miNivel === NIVEL_ACCESO.ADMINISTRADOR
                                ? 'Administrador: solo puede crear editores.'
                                : 'Editor: no gestiona otros perfiles.'}
                    </small>
                </div>

                ${miNivel === NIVEL_ACCESO.MAESTRO
                    ? `
                <div class="form-group" id="grupo-es-maestro">
                    <label for="es-maestro">Cuenta principal *</label>
                    <select id="es-maestro" name="es_maestro" required>
                        <option value="false">No</option>
                        <option value="true">Sí (maestra)</option>
                    </select>
                    <small class="form-help">
                        Solo una cuenta debe ser la maestra. Tiene control total del panel.
                    </small>
                </div>
                `
                    : ''
                }

                <div class="form-group">
                    <label for="estado-perfil">Estado *</label>
                    <select id="estado-perfil" name="estado" required>
                        <option value="ACTIVO">Activo</option>
                        <option value="INACTIVO">Inactivo</option>
                    </select>

                    <small class="form-help">
                        Un perfil inactivo no puede iniciar sesión en el panel.
                    </small>
                </div>

                <div class="editor-divider"></div>

                <button
                    id="save-button"
                    type="submit"
                    class="editor-save-button"
                >${editando ? 'Guardar cambios' : 'Guardar perfil'}</button>
            </div>`
    });

    const mensajes = crearMensajes(el);
    const formulario = $('#editor-form', el);
    const boton = $('#save-button', el);

    let perfilOriginal = null;

    if (editando) {
        perfilOriginal = await cargarRegistro(
            'perfiles_admin',
            'id, nombre, rol, estado, es_maestro',
            id
        );

        // Jerarquía: no se puede editar a alguien de nivel igual o superior.
        if (perfilOriginal) {
            const nivelOriginal = rolANivel(perfilOriginal.rol);
            if (nivelOriginal >= miNivel && perfilOriginal.id !== yo.id) {
                mensajes.mostrar('No tienes permiso para editar este perfil.', 'error');
                $('#rol', el).disabled = true;
                $('#estado-perfil', el).disabled = true;
                const esMaestroEl = $('#es-maestro', el);
                if (esMaestroEl) esMaestroEl.disabled = true;
                boton.disabled = true;
            }
        }

        rellenarPerfil(el, perfilOriginal);
    }

    /**
     * Reglas de seguridad por jerarquía:
     *   1. Nadie se desactiva a sí mismo.
     *   2. Un perfil de nivel >= al tuyo no se puede editar (excepto tú mismo).
     *   3. Nunca puede quedar cero perfiles MAESTRO activos.
     *   4. Si no hay MAESTRO, nunca puede quedar cero ADMINISTRADOR activos.
     */
    async function validarSeguro(datos) {

        if (editando && id === yo.id && datos.estado !== 'ACTIVO') {
            return 'No puedes desactivar tu propia cuenta: perderías el acceso al panel.';
        }

        const { data: perfiles, error } = await supabase
            .from('perfiles_admin')
            .select('id, nombre, rol, estado, es_maestro');

        if (error) {
            console.warn('No se pudo verificar perfiles:', error);
            return null;
        }

        // No se puede editar a alguien de nivel superior o igual (salvo uno mismo).
        if (editando && perfilOriginal) {
            const nivelOriginal = rolANivel(perfilOriginal.rol);
            if (nivelOriginal >= miNivel && perfilOriginal.id !== yo.id) {
                return 'No tienes permiso para modificar este perfil.';
            }
            // Si intentas subir el rol de alguien por encima del tuyo.
            const nivelDestino = rolANivel(datos.rol);
            if (nivelDestino > miNivel) {
                return 'No puedes asignar un rol superior al tuyo.';
            }
            // Es_maestro solo puede tocarlo un MAESTRO.
            if (datos.es_maestro !== undefined && datos.es_maestro !== perfilOriginal.es_maestro && miNivel !== NIVEL_ACCESO.MAESTRO) {
                return 'Solo la cuenta principal puede asignar la casilla de cuenta principal.';
            }
        }

        const maestrosActivos = (perfiles ?? []).filter(
            (p) => p.es_maestro && p.estado === 'ACTIVO'
        );
        const adminsActivos = (perfiles ?? []).filter(
            (p) => !p.es_maestro && p.rol === 'ADMINISTRADOR' && p.estado === 'ACTIVO'
        );

        let restanteMaestros = maestrosActivos.length;
        let restanteAdmins = adminsActivos.length;

        if (perfilOriginal) {
            const eraMaestroActivo = perfilOriginal.es_maestro && perfilOriginal.estado === 'ACTIVO';
            const seguiraMaestroActivo = datos.es_maestro && datos.estado === 'ACTIVO';
            if (eraMaestroActivo && !seguiraMaestroActivo) restanteMaestros -= 1;

            const eraAdminActivo = !perfilOriginal.es_maestro && perfilOriginal.rol === 'ADMINISTRADOR' && perfilOriginal.estado === 'ACTIVO';
            const seguiraAdminActivo = !datos.es_maestro && datos.rol === 'ADMINISTRADOR' && datos.estado === 'ACTIVO';
            if (eraAdminActivo && !seguiraAdminActivo) restanteAdmins -= 1;
        }

        if (restanteMaestros <= 0) {
            return 'No se puede dejar el panel sin una cuenta principal (maestra) activa.';
        }

        if (restanteMaestros === 0 && restanteAdmins <= 0) {
            return 'No se puede dejar el panel sin administradores activos.';
        }

        return null;
    }

    formulario.addEventListener('submit', async (evento) => {
        evento.preventDefault();
        mensajes.limpiar();

        if (!formulario.reportValidity()) return;

        const nombre = $('#nombre', el).value.trim();
        const rol = $('#rol', el).value;
        const estado = $('#estado-perfil', el).value;
        const esMaestroEl = $('#es-maestro', el);
        const esMaestro = esMaestroEl ? esMaestroEl.value === 'true' : false;

        if (nombre.length < 3) {
            mensajes.mostrar('El nombre debe tener al menos 3 caracteres.', 'error');
            return;
        }

        const datos = { nombre, rol, estado, es_maestro: esMaestro };

        const motivo = await validarSeguro(datos);
        if (motivo) {
            mensajes.mostrar(motivo, 'error');
            return;
        }

        boton.disabled = true;
        boton.textContent = 'Guardando...';

        try {
            if (editando) {
                const { error } = await supabase
                    .from('perfiles_admin')
                    .update(datos)
                    .eq('id', id);

                if (error) throw error;

                if (store.admin.perfil.id === id) {
                    Object.assign(store.admin.perfil, datos);
                    store.escribirCache();
                    mostrarAplicacion();
                }

                mensajes.mostrar('Cambios guardados correctamente.', 'success');
            } else {
                const { error } = await supabase
                    .from('perfiles_admin')
                    .insert(datos)
                    .select('id')
                    .single();

                if (error) throw error;

                mensajes.mostrar('Perfil creado. Recuerda que el usuario debe existir en Supabase Auth para poder iniciar sesión.', 'success');
            }
        } catch (error) {
            console.error(error);

            if (error.code === '23503') {
                mensajes.mostrar('No se puede crear el perfil: el usuario no existe en Supabase Auth (Authentication → Users).', 'error');
            } else {
                mensajes.mostrar(mensajeSupabase(error, 'No se pudo guardar el perfil.'), 'error');
            }
        } finally {
            boton.disabled = false;
            boton.textContent = editando ? 'Guardar cambios' : 'Guardar perfil';
        }
    });

    return el;
}

/**
 * Devuelve las opciones de `<select>` de rol que el usuario actual puede asignar.
 * `rolPreseleccionado` solo se usa al crear (nuevo): el primer valor válido.
 */
function opcionesRolDisponibles(miNivel, rolPreseleccionado) {

    let opciones = [];

    if (miNivel === NIVEL_ACCESO.MAESTRO) {
        opciones = [
            { valor: 'ADMINISTRADOR', etiqueta: 'Administrador' },
            { valor: 'EDITOR', etiqueta: 'Editor' }
        ];
    } else if (miNivel === NIVEL_ACCESO.ADMINISTRADOR) {
        opciones = [
            { valor: 'EDITOR', etiqueta: 'Editor' }
        ];
    }

    return opciones.map((o) => {
        const seleccionado = rolPreseleccionado === o.valor ? ' selected' : '';
        return `<option value="${o.valor}"${seleccionado}>${esc(o.etiqueta)}</option>`;
    }).join('');
}

/**
 * Rellena el formulario de perfil con los datos de la base, incluyendo es_maestro.
 */
function rellenarPerfil(el, datos) {
    $('#nombre', el).value = datos.nombre ?? '';
    $('#rol', el).value = datos.rol ?? '';
    $('#estado-perfil', el).value = datos.estado ?? '';
    const esMaestroEl = $('#es-maestro', el);
    if (esMaestroEl) esMaestroEl.value = String(datos.es_maestro ?? false);
}



const EDITORES = {
    noticias: vistaNoticia,
    eventos: vistaEvento,
    anuncios: vistaAnuncio,
    administradores: vistaPerfil
};


/* ══════════════════════════════════════════════════════════════════════════
   ROUTER
   ══════════════════════════════════════════════════════════════════════════ */

function parsearHash(texto = location.hash) {
    const bruto = String(texto ?? '').replace(/^#\/?/, '');
    const partes = bruto.split('/').filter(Boolean);

    return {
        seccion: partes[0] || 'dashboard',
        accion: partes[1] || null,
        id: partes[2] || null
    };
}

/**
 * Devuelve la URL canónica si la actual no es válida, o null si ya lo es.
 * Centraliza todas las redirecciones para que enrutar() tenga un solo camino.
 */
function hashCanonico(ruta) {

    if (!store.admin) return '#/login';

    const meta = SECCIONES[ruta.seccion];

    if (ruta.seccion === 'login' || !meta) return '#/dashboard';
    const nivelUsuario = store.admin.perfil ? rolANivel(store.admin.perfil.rol) : 0;
    if (meta.nivelMinimo && nivelUsuario < meta.nivelMinimo) return '#/dashboard';
    if (ruta.accion && ruta.accion !== 'nuevo' && ruta.accion !== 'editar') return `#/${ruta.seccion}`;
    if (ruta.accion === 'editar' && !ruta.id) return `#/${ruta.seccion}`;

    return null;
}

let secuenciaRuta = 0;

async function enrutar() {

    let ruta = parsearHash();
    const canonico = hashCanonico(ruta);

    if (canonico) {
        if (location.hash !== canonico) {
            location.hash = canonico;
            return;
        }
        ruta = parsearHash(canonico);
    }

    const miPase = ++secuenciaRuta;

    if (!store.admin) {
        mostrarPantallaAuth();
        return;
    }

    mostrarAplicacion();

    const meta = SECCIONES[ruta.seccion];
    const encabezado = ruta.accion === 'nuevo' ? meta.nuevo
        : ruta.accion === 'editar' ? meta.editar
            : meta.titulo;

    $('#header-title').textContent = encabezado ?? meta.titulo;
    $('#header-subtitle').textContent = meta.subtitulo;

    document.querySelectorAll('.sidebar-link').forEach((enlace) => {
        enlace.classList.toggle('active', enlace.getAttribute('href') === `#/${ruta.seccion}`);
    });

    const construir = () => {
        if (ruta.seccion === 'dashboard') return vistaDashboard();
        if (ruta.accion === 'nuevo') return EDITORES[ruta.seccion](null);
        if (ruta.accion === 'editar') return EDITORES[ruta.seccion](ruta.id);
        return LISTADOS[ruta.seccion]();
    };

    contenedor.innerHTML = '';
    contenedor.appendChild(crearCargando());

    try {
        const vista = await construir();

        if (miPase !== secuenciaRuta) return; // otra navegación ya ganó

        contenedor.innerHTML = '';
        contenedor.appendChild(vista);
    } catch (error) {
        if (miPase !== secuenciaRuta) return;

        console.error('Error cargando la vista:', error);
        contenedor.innerHTML = `<div class="view-loading">No se pudo cargar la vista: ${esc(error.message)}</div>`;
    }
}


function irA(destino) {
    if (location.hash === destino) enrutar();
    else location.hash = destino;
}


/* ══════════════════════════════════════════════════════════════════════════
   ARRANQUE
   ══════════════════════════════════════════════════════════════════════════ */

function conectarAcceso() {

    const formulario = $('#login-form');
    const errorEl = $('#login-error');
    const boton = $('#login-button');

    formulario.addEventListener('submit', async (evento) => {
        evento.preventDefault();
        errorEl.hidden = true;

        if (!formulario.reportValidity()) return;

        boton.disabled = true;
        boton.textContent = 'Ingresando...';

        try {
            await store.login($('#email').value.trim(), $('#password').value);
            mostrarAplicacion();
            irA('#/dashboard');
        } catch (error) {
            console.error(error);
            errorEl.textContent = error.message || 'No se pudo iniciar sesión.';
            errorEl.hidden = false;
        } finally {
            boton.disabled = false;
            boton.textContent = 'Iniciar sesión';
        }
    });

    $('#logout-button').addEventListener('click', async () => {
        await store.logout();
        mostrarPantallaAuth();

        if (location.hash !== '#/login') location.hash = '#/login';
        else enrutar();
    });
}


async function iniciar() {

    conectarAcceso();

    window.addEventListener('hashchange', () => { enrutar(); });

    try {
        await store.init();
    } catch (error) {
        console.error('Error verificando la sesión:', error);
        store.admin = null;
    }

    pantallaCarga.hidden = true;

    await enrutar();
}


iniciar();
