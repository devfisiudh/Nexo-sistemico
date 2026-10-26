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
      - `estado`      → editorial: BORRADOR | PROGRAMADO | PUBLICADO | ARCHIVADO
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
│   │   ├── editor-rico.js      editor enriquecido tipo Word (barra de formato)
│   │   └── utils.js            helpers compartidos (slug, fechas, visibilidad)
│   └── css/
│       ├── admin.css           estilos base del panel (+ editor enriquecido)
│       └── spa.css             transiciones entre vistas
│
├── assets                      img · icons (docs/ aparece si subes un PDF)
├── components/Layout           navbar.html y footer.html (cargados por fetch)
├── css                         global · layout · y una hoja por sección
│
├── js
│   ├── main.js                 carga navbar y footer
│   ├── historico.js            página del histórico público (dos pestañas)
│   ├── config/supabase.js      cliente único de Supabase
│   ├── data/                   CAPA DE DATOS del portal
│   │   ├── noticias.js
│   │   ├── eventos.js
│   │   ├── anuncios.js
│   │   └── historial.js        RPC de histórico (sql/08) — archivados y vencidos
│   ├── utils/
│   │   ├── formato.js          fechas, colores por categoría, escapado
│   │   ├── sanitizar.js        allowlist de HTML + prepararContenido()
│   │   └── seo.js              metadatos dinámicos (título, canónica, OG)
│   └── <vista>.js              una vista por página (noticias, articulo, ...)
│
├── pages                       HTML de las secciones internas
│   └── proyectos/              rastrear bus (en desarrollo)
│
├── sql/                        Scripts de base de datos (ver sección 6)
│
├── index.html
├── vercel.json                 despliegue, rutas ocultas y cabeceras
├── robots.txt                  qué puede rastrear cada buscador
├── sitemap.xml                 mapa del sitio (páginas posicionables)
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

  CONTENIDO   El campo "Contenido" es un editor enriquecido tipo Word: escribes
              o pegas texto (también desde Word o un blog) y el formato se
              reconoce solo — negrita, cursiva, listas, enlaces, encabezados.
              Lo que no es formato básico se limpia: sin <script>, sin estilos
              inline. La alineación se guarda como clase CSS
              (.txt-centro / .txt-der / .txt-justificado), nunca como style.
              El textarea oculto es la fuente de verdad; lo que se mide
              (contadores, validaciones) es texto plano, no HTML.

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

  ESTADOS     Cada registro tiene un estado editorial. El panel muestra debajo
              del selector qué pasará exactamente al guardar:
                · BORRADOR    oculto siempre
                · PROGRAMADO  el portal lo publica solo cuando la fecha llega;
                              si la fecha está vacía o ya pasó, se publica al
                              guardar
                · PUBLICADO   visible YA, aunque la fecha de inicio sea futura
                              (publicar "antes de la fecha de validez")
                · ARCHIVADO   oculto; se conserva por si hay que recuperarlo

              En los listados de noticias, eventos y anuncios el estado se
              puede cambiar sin abrir el editor, con el select de la columna
              "Acciones".

  VISIBILIDAD Un evento o anuncio "Vencido" (fecha_fin pasada) sigue en el
              panel pero ya no aparece en el portal. Para recuperarlo, amplía
              la fecha de fin o cámbialo a BORRADOR.

  HISTÓRICO   /historico muestra lo archivado y lo vencido al visitante, con
              una pestaña por sección (Noticias · Eventos), sin tocar el RLS
              público: usa las RPC SECURITY DEFINER de sql/08. Desde los
              listados de Noticias y Eventos hay un botón "Historia" por
              sección (las anuncios no tienen historia; su archivo es la
              sección Archivo del panel).

  ELIMINAR    Noticias, eventos y anuncios se borran desde la tabla o desde
              el editor (Zona de peligro), solo por encima del rol Editor y
              con confirmación que cita el título. También borra la imagen de
              portada. La política de DELETE está en RLS: el anónimo no puede.

  CUENTAS     Administración → "+ Nuevo perfil" crea la cuenta completa en un
              solo paso (correo + contraseña): la RPC crear_usuario_admin
              inserta en auth.users y perfiles_admin de forma atómica, sin
              copiar UIDs ni abrir Supabase. eliminar_usuario_admin borra la
              cuenta. Solo la cuenta maestra crea administradores; nadie puede
              borrarse a sí mismo ni eliminar la última cuenta principal.
              Al insertar en auth.users, confirmation_token, recovery_token,
              email_change y email_change_token_new van con cadena vacía (como
              hace GoTrue) y NO con NULL: con NULL, GoTrue no puede leer la
              fila y la cuenta no puede iniciar sesión (500 «Database error
              finding user»).

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

Reglas de lectura pública (tras sql/04_estado_programado.sql):

  noticias  estado = PUBLICADO
            OR (estado = PROGRAMADO AND fecha_publicacion <= now())
  eventos   (estado = PUBLICADO
             OR (estado = PROGRAMADO AND fecha_inicio <= now()))
            AND (fecha_fin IS NULL OR fecha_fin >= now())
  anuncios  (estado = PUBLICADO
             OR (estado = PROGRAMADO AND fecha_inicio <= now()))
            AND (fecha_fin IS NULL OR fecha_fin >= now())

PUBLICADO ya no lo bloquea la fecha de inicio: es la forma de publicar algo
antes de que su ventana toque. PROGRAMADO es el "programar" explícito. La
fecha de fin sigue venciendo por su cuenta (eventos y anuncios).
Aplicar el patrón de noticias a eventos escondería los próximos: los eventos
solo se ocultan cuando ya terminaron.

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
  04_estado_programado.sql      Añade el estado PROGRAMADO al ENUM y redefine
                                las lecturas públicas: PUBLICADO se ve ya
                                aunque la fecha sea futura; PROGRAMADO espera
                                su fecha (ver sección 4).
  05_rol_maestro.sql            Añade perfiles_admin.es_maestro: una cuenta
                                principal con control total (crea
                                administradores, gestiona cuentas).
  06_auth_perfiles.sql          Integración Authentication ↔ perfiles_admin:
                                trigger que da de alta a cada usuario nuevo
                                como EDITOR + INACTIVO, y migración de las
                                cuentas existentes.
  07_crear_usuario_admin.sql    RPC crear_usuario_admin y
                                eliminar_usuario_admin: altas y bajas de
                                cuentas desde el panel, sin tocar Supabase.
  08_historial_publico.sql      RPC de histórico para el visitante:
                                historial_noticias/eventos (listado) y
                                historial_noticia/evento (detalle), solo
                                archivados y vencidos, nunca borradores.

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

SEO Y COMPARTIR EN REDES
  Cada página lleva en <head> su descripción, su URL canónica y el bloque
  Open Graph (og:*) con la imagen assets/img/compartir.png (1200×630, la
  única que se genera: el favicon y el logo eran el mismo archivo de 487 KB).
  Los rastreadores que NO ejecutan JavaScript (Facebook, X, WhatsApp) leen
  esos metadatos tal cual; los que sí lo ejecutan reciben además lo que
  actualiza js/utils/seo.js al cargar una noticia o un evento (título,
  resumen, canónica y portada reales).
  Límite conocido: como el detalle se pinta en el cliente, compartir un
  artículo en Facebook mostrará los metadatos genéricos de la plantilla.
  Para que cada noticia lleve su propia tarjeta haría falta generarla en el
  servidor (Vercel Function) o renderizar las páginas antes del despliegue.
  robots.txt deja fuera /admin, /sql, /components/ y /data/; el histórico
  es noindex en su propia plantilla y por eso no aparece en sitemap.xml.

RUTAS OCULTAS EN PRODUCCIÓN
  /sql/*, /README.txt, /.github/* y /.vscode/* son scripts y documentación de
  desarrollo, no contenido del portal. Vercel sirve como archivo estático todo
  lo que esté en el repo, así que vercel.json los redirige a / (307) con
  `redirects`, que se evalúan ANTES de leer el disco. Si alguna de esas rutas
  volviera a responder 200, el siguiente escalón es excluirlas del build
  (buildCommand + outputDirectory). Comprobación tras cada despliegue:
      curl -I https://nexo-sistemico.vercel.app/sql/07_crear_usuario_admin.sql
  `.freebuff/` (identificador de una herramienta interna) está en .gitignore
  y por eso no viaja al repo.

DESARROLLO LOCAL
  python -m http.server 5501   (configurado en .vscode/settings.json)
  No funciona con file:// porque el proyecto usa módulos ES.

--------------------------------------------------------------------------------
8. PENDIENTES CONOCIDOS
--------------------------------------------------------------------------------
  · Menú "Documentos": sin implementar.
  · "Rastreo Bus" es una maqueta: js/rastreo.js simula una consola.
  · Categorías de noticias: la tabla guarda texto libre. Las de ejemplo están
    fijadas en js/utils/formato.js; si crece la lista, conviene una tabla.

--------------------------------------------------------------------------------
© 2026 Coded by Notch & K. Clemente.
Soporte: dev.fisi.udh@gmail.com
================================================================================
