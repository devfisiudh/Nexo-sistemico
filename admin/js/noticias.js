import { supabase }
from '../../js/config/supabase.js';

import {
    protegerPaginaAdmin,
    cerrarSesion
}
from './admin-guard.js';

import {
    formatearFecha,
    formatearRol,
    formatearEstado
}
from './utils.js';


const loading =
    document.getElementById('admin-loading');

const app =
    document.getElementById('admin-app');

const nombreElement =
    document.getElementById('admin-nombre');

const rolElement =
    document.getElementById('admin-rol');

const logoutButton =
    document.getElementById('logout-button');

const menuAdministradores =
    document.getElementById('menu-administradores');

const tbody =
    document.getElementById('noticias-body');

const buscador =
    document.getElementById('buscar-noticia');

const botonesFiltro =
    document.querySelectorAll('.filter-button');


let noticias = [];
let estadoActual = 'TODOS';


async function iniciar() {

    try {

        const administrador =
            await protegerPaginaAdmin();

        if (!administrador) {
            return;
        }


        const { perfil } = administrador;


        nombreElement.textContent =
            perfil.nombre;

        rolElement.textContent =
            formatearRol(perfil.rol);


        if (perfil.rol === 'ADMINISTRADOR') {
            menuAdministradores.hidden = false;
        }


        loading.hidden = true;
        app.hidden = false;


        await cargarNoticias();


    } catch (error) {

        console.error(
            'Error iniciando Noticias:',
            error
        );

        loading.textContent =
            'No se pudo cargar el panel.';
    }

}


async function cargarNoticias() {

    mostrarMensaje(
        'Cargando noticias...'
    );


    const {
        data,
        error
    } = await supabase
        .from('noticias')
        .select(`
            id,
            titulo,
            categoria,
            estado,
            fecha_publicacion,
            created_at,
            updated_at
        `)
        .order(
            'created_at',
            { ascending: false }
        );


    if (error) {

        console.error(
            'Error cargando noticias:',
            error
        );

        mostrarMensaje(
            'No se pudieron cargar las noticias.'
        );

        return;
    }


    noticias = data ?? [];

    aplicarFiltros();
}


function aplicarFiltros() {

    const texto =
        buscador.value
            .trim()
            .toLocaleLowerCase('es');


    const resultado =
        noticias.filter((noticia) => {

            const coincideEstado =
                estadoActual === 'TODOS'
                || noticia.estado === estadoActual;


            const titulo =
                (noticia.titulo ?? '')
                    .toLocaleLowerCase('es');


            const coincideBusqueda =
                titulo.includes(texto);


            return (
                coincideEstado
                && coincideBusqueda
            );
        });


    renderizarNoticias(resultado);
}


function renderizarNoticias(lista) {

    tbody.replaceChildren();


    if (lista.length === 0) {

        mostrarMensaje(
            'No se encontraron noticias.'
        );

        return;
    }


    const fragment =
        document.createDocumentFragment();


    lista.forEach((noticia) => {

        const fila =
            document.createElement('tr');


        // NOTICIA

        const celdaNoticia =
            document.createElement('td');

        const noticiaInfo =
            document.createElement('div');

        noticiaInfo.className =
            'table-title';


        const titulo =
            document.createElement('strong');

        titulo.textContent =
            noticia.titulo;


        const id =
            document.createElement('small');

        id.textContent =
            `ID: ${noticia.id.slice(0, 8)}…`;


        noticiaInfo.append(
            titulo,
            id
        );

        celdaNoticia.appendChild(
            noticiaInfo
        );


        // CATEGORÍA

        const celdaCategoria =
            document.createElement('td');

        celdaCategoria.textContent =
            noticia.categoria || '—';


        // ESTADO

        const celdaEstado =
            document.createElement('td');

        const estado =
            document.createElement('span');

        estado.className =
            `status-badge status-${noticia.estado.toLowerCase()}`;

        estado.textContent =
            formatearEstado(
                noticia.estado
            );

        celdaEstado.appendChild(
            estado
        );


        // FECHA

        const celdaFecha =
            document.createElement('td');

        celdaFecha.textContent =
            formatearFecha(
                noticia.fecha_publicacion
                ?? noticia.created_at
            );


        // ACCIONES

        const celdaAcciones =
            document.createElement('td');

        celdaAcciones.className =
            'table-actions';


        const editar =
            document.createElement('a');

        editar.className =
            'table-action-link';

        editar.textContent =
            'Editar';

        editar.href =
            `./noticia-editor.html?id=${encodeURIComponent(noticia.id)}`;


        celdaAcciones.appendChild(
            editar
        );


        fila.append(
            celdaNoticia,
            celdaCategoria,
            celdaEstado,
            celdaFecha,
            celdaAcciones
        );


        fragment.appendChild(fila);
    });


    tbody.appendChild(fragment);
}


function mostrarMensaje(mensaje) {

    tbody.replaceChildren();


    const fila =
        document.createElement('tr');

    const celda =
        document.createElement('td');


    celda.colSpan = 5;

    celda.className =
        'table-message';

    celda.textContent =
        mensaje;


    fila.appendChild(celda);

    tbody.appendChild(fila);
}


buscador.addEventListener(
    'input',
    aplicarFiltros
);


botonesFiltro.forEach((boton) => {

    boton.addEventListener(
        'click',
        () => {

            estadoActual =
                boton.dataset.estado;


            botonesFiltro.forEach(
                (item) => {
                    item.classList.remove(
                        'active'
                    );
                }
            );


            boton.classList.add(
                'active'
            );


            aplicarFiltros();
        }
    );

});


logoutButton.addEventListener(
    'click',
    cerrarSesion
);


iniciar();