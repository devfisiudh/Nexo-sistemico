================================================================================
NEXO SISTÉMICO — PAISI / UDH
Facultad de Ingeniería de Sistemas e Informática
================================================================================

VERSIÓN: 4.0 · Contenido 100 % en Supabase · Panel administrativo completo
FECHA: Octubre 2026
DESARROLLADORES: Notch & K. Clemente

--------------------------------------------------------------------------------
1. DESCRIPCIÓN
--------------------------------------------------------------------------------
Portal informativo para la comunidad de la PAISI - Universidad de Huánuco.
Sitio estático (sin framework, sin build) con panel administrativo respaldado por
Supabase: Auth para los administradores, Postgres para el contenido, Storage para
las imágenes y RLS para decidir qué ve cada visitante.

La v3 movió la interfaz a una arquitectura de carga por demanda, pero seguía
sirviendo contenido desde archivos JSON y el panel escribía en una base que el
sitio público nunca leía. La v4 elimina esa separación: hay una sola fuente de
verdad y todo el contenido se publica desde el panel.

--------------------------------------------------------------------------------
2. CÓMO FUNCIONA
--------------------------------------------------------------------------------

  VISITANTE (sin cuenta)
      │
      └─> js/data/*.js ──> Supabase (PostgREST, clave publishable)
                              │
                              └─ RLS solo deja pasar estado = PUBLICADO
                                 dentro de la ventana de vigencia
                              │
      ◄─ tarjetas renderizadas

  ADMINISTRADOR (con cuenta)
      │
      └─> admin/js/app.js ──> Supabase Auth ──> perfiles_admin (rol + estado)
                              │
                              ├─ autenticación  ── RLS por es_admin_activo()
                              └─ imágenes       ── Storage, bucket portal-publico

Claves del diseño:

  · El visitante NO tiene cuenta ni necesita una. Usa la clave publishable,
    que junto con las políticas RLS limita qué puede leer. Nunca se usa la
    service_role en el navegador.

  · El panel no protege los datos, lo hace RLS. Ocultar botones en la interfaz
    es solo cortesía: la barrera real está en la base.

  · El panel es una SPA: las rutas viven en el hash (#/noticias/editar/<id>)
    y la sesión se verifica una sola vez al entrar (caché de 5 minutos en
    sessionStorage). Cambiar de sección no vuelve a pasar por el login ni por
    pantallas de "Verificando sesión...".

  · El contenido tiene dos ejes independientes:
      - `estado`      → editorial: BORRADOR | PUBLICADO | ARCHIVADO
      - `fecha_*`     → temporal: cuándo se publica y hasta cuándo
    Estar PUBLICADO no significa verse en el portal. El panel calcula el estado
    derivado (Publicado / Por publicar / Vencido) para que nunca haya dudas.

--------------------------------------------------------------------------------
3. ESTRUCTURA DE CARPETAS
--------------------------------------------------------------------------------

/
├── admin                       Panel de administración (SPA, sin recargas)
│   ├── index.html              Shell único: login + sidebar + header
│   ├── js/
│   │   ├── app.js              router por hash, vistas y editores
│   │   └── utils.js            helpers compartidos (slug, fechas, visibilidad)
│   └── css/
│       ├── admin.css           estilos base del panel
│       └── spa.css             transiciones entre vistas
│
├── assets                      img · icons · docs (PDF de descarga)
├── components/Layout           navbar.html y footer.html (cargados por fetch)
├── css                         global · layout · y una hoja por sección
│
├── js
│   ├── main.js                 carga navbar y footer
│   ├── config/supabase.js      cliente único de Supabase
│   ├── data/                   CAPA DE DATOS del portal
│   │   ├── noticias.js
│   │   ├── eventos.js
│   │   └── anuncios.js
│   ├── utils/
│   │   ├── formato.js          fechas, colores por categoría, escapado
│   │   └── sanitizar.js        allowlist de HTML para el contenido del CMS
│   └── <vista>.js              una vista por página (noticias, articulo, ...)
│
├── pages                       HTML de las secciones internas
│   └── proyectos/              rastrear bus (en desarrollo)
│
├── sql/                        Scripts de base de datos (ver sección 6)
│
├── index.html
├── vercel.json                 despliegue y cabeceras de seguridad
└── README.txt

--------------------------------------------------------------------------------
4. PUBLICAR CONTENIDO
--------------------------------------------------------------------------------
Ya no se edita ningún archivo a mano. Todo se hace desde /admin:

  Noticias   →  título, resumen, contenido, categoría, portada, fecha
  Eventos    →  título, lugar, fecha de inicio, fecha de fin, portada,
                enlace de inscripción (opcional)
  Anuncios   →  texto, atribución, tipo, composición, imagen, botón de destino,
                vigencia

Detalles que conviene conocer:

  SLUG        Se genera solo a partir del título. Edita a mano solo si lo
              necesitas; es la URL pública y no conviene cambiarlo después
              de compartido.

  EVENTOS     El enlace de inscripción decide el botón, sin campos extra:
                · con enlace  →  "Inscribirse", abre en otra pestaña
                · sin enlace  →  "Ver detalles", lleva a la página interna

  ANUNCIOS    "Composición" controla la tarjeta:
                · Solo texto          → no necesita imagen
                · Solo imagen         → la imagen es obligatoria
                · Imagen + texto      → imagen arriba, texto debajo

  VIGENCIA    Las casillas "indefinido" equivalen a NULL en la base:
                · Eventos:  solo la fecha de fin puede quedar indefinida
                · Anuncios: ambas fechas pueden quedar indefinidas

  PORTADA     Solo JPG, PNG o WEBP, hasta 5 MB. Las imágenes van a Storage en
              noticias/{id}/, eventos/{id}/ y anuncios/{id}/.

  VISIBILIDAD Un evento o anuncio "Vencido" sigue en el panel pero ya no
              aparece en el portal. Para recuperarlo, amplía la fecha de fin.

--------------------------------------------------------------------------------
5. ESTRUCTURA DE LA BASE
--------------------------------------------------------------------------------

  perfiles_admin   id · nombre · rol (ADMINISTRADOR|EDITOR) · estado (ACTIVO|
                   INACTIVO). Define quién entra al panel.

  noticias         id · titulo · slug · resumen · contenido · categoria ·
                   imagen_url · estado · fecha_publicacion · autor_id

  eventos          id · titulo · slug · resumen · contenido · lugar ·
                   fecha_inicio · fecha_fin · url_inscripcion · imagen_url ·
                   estado · autor_id

  anuncios         id · titulo · tipo · texto · modo · destino_tipo ·
                   destino_url · destino_label · autor_texto · imagen_url ·
                   fecha_inicio · fecha_fin · estado · autor_id

Funciones de autorización:

  es_admin_activo()   El usuario tiene un perfil ACTIVO (cualquier rol).
  es_administrador()  Lo anterior, y además rol = ADMINISTRADOR.

Ambas son SECURITY DEFINER con search_path vacío.

Bucket: portal-publico, público, 5 MB, solo image/jpeg, image/png, image/webp.

Reglas de lectura pública (las tres tablas):

  noticias  estado = PUBLICADO AND fecha_publicacion <= now()
  eventos   estado = PUBLICADO AND (fecha_fin IS NULL OR fecha_fin >= now())
  anuncios  estado = PUBLICADO AND fecha_inicio <= now()
                               AND fecha_fin   >= now()

Ojo: la regla de vigencia es INVERSA entre módulos, y es a propósito.
  · Noticias y anuncios: no muestres lo que todavía no toca.
  · Eventos: una agenda muestra lo que viene y oculta lo que ya terminó.
Aplicar el patrón equivocado en eventos escondería justamente los próximos.

--------------------------------------------------------------------------------
6. MANTENIMIENTO DE LA BASE
--------------------------------------------------------------------------------
Los scripts de sql/ se aplican desde Supabase → SQL Editor. Son idempotentes:
se pueden volver a ejecutar sin romper nada.

  00_auditoria.sql              Consultas de solo lectura para inspeccionar el
                                esquema real, las políticas RLS, los ENUM y las
                                claves foráneas.
  01_rls_eventos_vigencia.sql   Corrige la política de lectura de eventos para
                                que respete la vigencia.
  02_anuncios_modos.sql         Añade modo, destino_tipo y sus CHECK.
  03_anuncios_autor_texto.sql   Añade autor_texto (ver sección 7).

Cada archivo lleva en los comentarios por qué existe y qué pasaba antes.

--------------------------------------------------------------------------------
7. DECISIONES QUE MERECEN CONOCERSE
--------------------------------------------------------------------------------

AUTOR DE LOS ANUNCIOS — por qué hay dos columnas
  La atribución visible ("Prof. Ramírez · Redes") no puede salir de autor_id:
  perfiles_admin no es legible por el anónimo, así que el portal no podría
  resolver el nombre. Por eso existen autor_id (auditoría: qué cuenta publicó)
  y autor_texto (lo que ve el visitante). La alternativa —una vista que
  expusiera perfiles_admin— abriría la tabla a enumerar cuentas de
  administración.

SANITIZADO DE CONTENIDO
  El contenido de noticias, eventos y anuncios se guarda como HTML y se inyecta
  en la página. Pasa por js/utils/sanitizar.js, una allowlist que usa el
  parser del navegador (no expresiones regulares) y descarta <script>,
  <iframe>, <svg>, los atributos on* y las URL javascript:.
  La cabecera Content-Security-Policy en vercel.json es la segunda barrera.

VIGILANCIA CONTRA CAÍDAS
  Los tres DAO intentan Supabase con un tiempo límite de 5 s y, si falla,
  recurren a los JSON de data/. Es una red de seguridad, no un plan: si vas a
  borrar esos archivos, quita también cargarLegado() en cada DAO.

DESARROLLO LOCAL
  python -m http.server 5501   (configurado en .vscode/settings.json)
  No funciona con file:// porque el proyecto usa módulos ES.

--------------------------------------------------------------------------------
8. PENDIENTES CONOCIDOS
--------------------------------------------------------------------------------
  · Menú "Documentos": sin implementar.
  · Borrado de registros: el panel solo crea y edita; para eliminar contenido
    se hace desde Supabase (Dashboard o SQL).
  · "Rastreo Bus" es una maqueta: js/rastreo.js simula una consola.
  · Categorías de noticias: la tabla guarda texto libre. Las de ejemplo están
    fijadas en js/utils/formato.js; si crece la lista, conviene una tabla.

--------------------------------------------------------------------------------
© 2026 Coded by Notch & K. Clemente.
Soporte: dev.fisi.udh@gmail.com
================================================================================
