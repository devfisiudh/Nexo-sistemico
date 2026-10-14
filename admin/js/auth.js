import { supabase } from '../../js/config/supabase.js';

const form = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

const errorElement =
    document.getElementById('login-error');

const loginButton =
    document.getElementById('login-button');


async function verificarSesionExistente() {

    const {
        data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
        return;
    }

    const autorizado =
        await verificarAdministrador(session.user.id);

    if (autorizado) {
        window.location.replace('./dashboard.html');
    }
}


async function verificarAdministrador(userId) {

    const {
        data,
        error
    } = await supabase
        .from('perfiles_admin')
        .select('id, nombre, rol, estado')
        .eq('id', userId)
        .eq('estado', 'ACTIVO')
        .single();


    if (error || !data) {
        return false;
    }

    return true;
}


function mostrarError(mensaje) {

    errorElement.textContent = mensaje;
    errorElement.hidden = false;
}


function limpiarError() {

    errorElement.textContent = '';
    errorElement.hidden = true;
}


form.addEventListener('submit', async (event) => {

    event.preventDefault();

    limpiarError();

    loginButton.disabled = true;
    loginButton.textContent = 'Ingresando...';


    try {

        const email =
            emailInput.value.trim();

        const password =
            passwordInput.value;


        const {
            data,
            error
        } = await supabase.auth.signInWithPassword({
            email,
            password
        });


        if (error) {
            mostrarError(
                'Correo o contraseña incorrectos.'
            );

            return;
        }


        const autorizado =
            await verificarAdministrador(
                data.user.id
            );


        if (!autorizado) {

            await supabase.auth.signOut();

            mostrarError(
                'Esta cuenta no tiene acceso al panel administrativo.'
            );

            return;
        }


        window.location.replace(
            './dashboard.html'
        );


    } catch (error) {

        console.error(error);

        mostrarError(
            'No se pudo conectar con el servidor. Inténtalo nuevamente.'
        );


    } finally {

        loginButton.disabled = false;
        loginButton.textContent =
            'Iniciar sesión';
    }

});


verificarSesionExistente();