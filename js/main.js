document.addEventListener("DOMContentLoaded", () => {
    let pathPrefix = '.';
    if (window.location.pathname.includes('/pages/') && !window.location.pathname.includes('/proyectos/')) {
        pathPrefix = '..';
    } else if (window.location.pathname.includes('/proyectos/')) {
        pathPrefix = '../..';
    }

    loadComponent('navbar-container', `${pathPrefix}/components/Layout/navbar.html`, () => {
        initMobileMenu();
        highlightCurrentPage();
    });

    loadComponent('footer-container', `${pathPrefix}/components/Layout/footer.html`, () => {
        // El año del pie siempre queda actualizado sin tocar el HTML.
        document.querySelectorAll('[data-anio]').forEach((el) => {
            el.textContent = String(new Date().getFullYear());
        });
    });
});

function loadComponent(containerId, filePath, callback) {
    const container = document.getElementById(containerId);
    if (!container) return;
    fetch(filePath)
        .then(r => { if (!r.ok) throw new Error(); return r.text(); })
        .then(html => { container.innerHTML = html; if (callback) callback(); })
        .catch(e => console.error('Error cargando componente:', e));
}

function initMobileMenu() {
    const hamburger = document.querySelector(".hamburger");
    const navMenu = document.querySelector(".nav-menu");
    if (hamburger && navMenu) {

        // El estado del menú se refleja en aria-expanded para que un lector
        // de pantalla sepa si está abierto o cerrado.
        const ponerEstado = (abierto) => {
            hamburger.classList.toggle("active", abierto);
            navMenu.classList.toggle("active", abierto);
            hamburger.setAttribute("aria-expanded", String(abierto));
            hamburger.setAttribute("aria-label", abierto ? "Cerrar menú" : "Abrir menú");
        };

        hamburger.addEventListener("click", () => {
            ponerEstado(!navMenu.classList.contains("active"));
        });

        // Escape cierra el menú y devuelve el foco al botón.
        document.addEventListener("keydown", (evento) => {
            if (evento.key === "Escape" && navMenu.classList.contains("active")) {
                ponerEstado(false);
                hamburger.focus();
            }
        });

        document.querySelectorAll(".nav-link, .nav-btn-special").forEach(n => n.addEventListener("click", () => {
            ponerEstado(false);
        }));
    }
}

function highlightCurrentPage() {

    // Ruta normalizada: sin /index.html y con la raíz como "/".
    let actual = window.location.pathname.replace(/\/index\.html$/, "");
    if (!actual) actual = "/";
    if (!actual.startsWith("/")) actual = `/${actual}`;
    if (!actual.endsWith("/") && actual.split("/").length === 3) actual += "/";

    document.querySelectorAll('.nav-link, .nav-btn-special').forEach(link => {

        let destino = link.getAttribute("href") || "";
        if (destino.startsWith("/proyectos/")) destino += "/";

        const coincide = destino === actual;

        // aria-current marca la página activa para navegadores y lectores;
        // el color lo pone el CSS a partir de ese atributo.
        if (coincide) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });
}
