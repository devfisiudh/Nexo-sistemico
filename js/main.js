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
        hamburger.addEventListener("click", () => {
            hamburger.classList.toggle("active");
            navMenu.classList.toggle("active");
        });
        document.querySelectorAll(".nav-link").forEach(n => n.addEventListener("click", () => {
            hamburger.classList.remove("active");
            navMenu.classList.remove("active");
        }));
    }
}

function highlightCurrentPage() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        if (link.getAttribute('href').includes(currentPath) && currentPath !== '/' && currentPath !== '/index.html') {
            link.style.color = 'var(--scarlet)';
        }
    });
}
