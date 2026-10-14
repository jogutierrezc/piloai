/* =============================================================================
   Pilo en otros portales · el cargador.

   Se pega una línea en la página anfitriona:

     <script src="https://<portal de Planeación>/pilo.js"
             data-tema="blanco" data-esquina="derecha" defer></script>

   Crea un marco (iframe) hacia /pilo-embed de este mismo portal: ahí viven el
   botón, el saludo y el chat. Aquí solo se le da al marco el tamaño que pide.
   Los estilos de la página anfitriona no entran al marco, ni los suyos salen.

   Mr. Pilo en Enseñanza, la Inteligencia Artificial de la Universidad de
   Santander, se pide con data-pilo="ensenanza": su marco va a
   /pilo-ensenanza-embed. Los dos Pilos pueden vivir en la misma página, una
   línea por cada uno; conviene ponerlos en esquinas distintas.

   Leer la página (0127): con data-leer="si", Pilo lee el texto visible de la
   página que lo aloja cuando alguien le pregunta, para responder sobre lo que
   esa persona está viendo. El marco no puede leer la página (es de otro sitio):
   la lee este cargador y se la pasa. Nunca lee campos de formulario, ni lo
   oculto, ni lo que lleve data-pilo-ignorar. Para decirle qué parte leer,
   márquela con data-pilo-leer; sin eso lee <main>, <article> o el cuerpo.

   Leer todo: con data-leer="todo" lee además lo que está en la página pero
   plegado (pestañas, acordeones, <details> cerrados, bloques ocultos que son
   contenido). Solo lee: no pulsa nada ni cambia la página. Qué cuenta como
   contenido plegado y qué no, abajo, en «Las reglas de lectura».
   ========================================================================== */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || !script.src) return;

  // Qué Pilo: el de siempre, o el de otro espacio. Lo que no se conoce cae en el de siempre.
  var SPACES = {
    planeacion: { route: "/pilo-embed", title: "Chat con Pilo, de Planeación UDES", guard: "__piloEmbed" },
    ensenanza: {
      route: "/pilo-ensenanza-embed",
      title: "Chat con Pilo, la Inteligencia Artificial de la Universidad de Santander",
      guard: "__piloEmbed_ensenanza",
    },
  };
  var asked = (script.getAttribute("data-pilo") || "").toLowerCase();
  var space = Object.prototype.hasOwnProperty.call(SPACES, asked) ? SPACES[asked] : SPACES.planeacion;

  // Un marco por espacio: la misma línea pegada dos veces no duplica a Pilo.
  if (window[space.guard]) return;
  window[space.guard] = true;

  var origin = new URL(script.src).origin;
  var tema = (script.getAttribute("data-tema") || "blanco").toLowerCase();
  // El idioma del chat: con data-lang="en" o "pt" arranca en inglés o portugués; sin él, español (la persona puede cambiarlo dentro).
  var lang = (script.getAttribute("data-lang") || "").toLowerCase().slice(0, 2);
  lang = lang === "en" || lang === "pt" ? lang : "";
  var left = /^izq/i.test(script.getAttribute("data-esquina") || script.getAttribute("data-lado") || "");
  // Solo si la línea lo pide: quien administra la página decide si Pilo la lee, y cuánto.
  var mode = leerModo(script.getAttribute("data-leer"));
  var canRead = mode !== "no";

  var SIZE = { cerrado: [96, 104], saludo: [336, 120], abierto: [412, 680] };
  var state = "cerrado";
  var frame = null;

  function isSmall() {
    return window.innerWidth <= 520;
  }

  function apply() {
    if (!frame) return;
    var s = frame.style;
    if (state === "oculto") {
      s.display = "none";
      return;
    }
    s.display = "block";
    s.visibility = "visible";
    var full = state === "abierto" && isSmall();
    var size = SIZE[state] || SIZE.cerrado;
    s.width = full ? "100%" : size[0] + "px";
    s.height = full ? "100%" : size[1] + "px";
    // Abierto queda por encima del otro Pilo, si lo hay en la página.
    s.zIndex = state === "abierto" ? "2147483001" : "2147483000";
  }

  function tellFrame() {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ source: "pilo-host", full: isSmall(), read: canRead }, origin);
  }

  /* --- Leer la página ------------------------------------------------------------ */

  var PAGE_CHARS = 60000;
  var BLOCK_CHARS = 4000;
  var MAX_NODES = 6000;
  // Lo que no es contenido, lo que la persona escribe y lo que la página pide no leer.
  var SKIP = "script,style,noscript,template,svg,canvas,iframe,object,embed,video,audio,nav,footer,form,input,textarea,select,option,button,[contenteditable],[aria-hidden='true'],[hidden],[data-pilo-ignorar]";
  // Leyendo todo, lo oculto no se descarta de entrada (lo deciden las reglas) y el botón que abre un
  // acordeón se lee como su título. Las pestañas no se leen sueltas: cada panel entra con el nombre de la
  // suya. A cambio se suman los diálogos, los menús y las copias de los carruseles.
  var NEVER =
    "script,style,noscript,template,svg,canvas,iframe,object,embed,video,audio,nav,footer,form,input,textarea,select,option,datalist,button:not([aria-controls]),[role='tab'],[contenteditable],[data-pilo-ignorar]," +
    "dialog,[role='dialog'],[role='alertdialog'],[aria-modal='true'],menu,[role='menu'],[role='menubar'],[role='listbox'],[role='tooltip'],.slick-cloned,.swiper-slide-duplicate,.owl-item.cloned";

  /* --- Las reglas de lectura (sin DOM; se prueban en src/modules/pilo-embed/pilo-leer.test.ts) --- */

  /** Qué pide la línea: "no", "si" (lo visible) o "todo" (también lo plegado). */
  function leerModo(raw) {
    var v = String(raw || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    if (/^todo/.test(v)) return "todo";
    return /^s[ií]/.test(v) ? "si" : "no";
  }

  var FOLD_CHARS = 80;
  // Nombres (clase o id) de lo que se oculta y NO es contenido de la página.
  var NOT_CONTENT =
    /cookie|consent|gdpr|banner|modal|popup|pop-up|overlay|lightbox|offcanvas|drawer|dropdown|menu|navbar|tooltip|popover|toast|snackbar|login|signin|sign-in|newsletter|suscri|subscri|captcha|honeypot|sr-only|visually-hidden|screen-reader|skip-|clone|clonad|duplicate|template|plantilla|preload|loader|loading|spinner|skeleton|publicidad|advert|(^|[^a-z])ads?([^a-z]|$)|buscador|carrito/;
  // Nombres de lo que se pliega y SÍ es contenido: pestañas, acordeones, «ver más».
  var FOLD = /tab-?pane|tab-?panel|tab-?content|tabs?__|pesta|accordion|acorde|collaps|colaps|panel|toggle|expand|desplegable|faq|answer|respuesta|read-?more|ver-?mas|more/;

  /**
   * ¿Este elemento OCULTO es contenido plegado? Se le pregunta al primero que
   * está oculto en cada rama (por `hidden`, `aria-hidden`, display:none o
   * visibility:hidden), con su descripción:
   *   { role, marks: su clase y su id, fixed: va fijo a la ventana,
   *     controlled: algún control de la página lo abre (aria-controls),
   *     chars: cuánto texto lleva }
   *
   * NO es contenido (no se lee):
   *   - lo que va fijo a la ventana: capas, modales, avisos, cajones;
   *   - lo que por su nombre es aviso de cookies, modal, menú, ingreso,
   *     publicidad, copia de un carrusel, plantilla o texto solo para
   *     lectores de pantalla.
   * SÍ es contenido plegado (se lee):
   *   - un panel de pestaña (role=tabpanel);
   *   - lo que un control de la página abre (aria-controls);
   *   - lo que por su nombre es pestaña, acordeón, panel o «ver más»;
   *   - cualquier otro bloque oculto con texto de verdad (80 caracteres o
   *     más): un ícono o una etiqueta suelta no lo son.
   * Los diálogos, los menús, los formularios y lo demás de NEVER ni siquiera
   * llegan aquí: leyendo todo no se leen nunca, se vean o no.
   */
  function plegado(d) {
    var marks = String(d.marks || "").toLowerCase();
    if (d.fixed) return false;
    if (NOT_CONTENT.test(marks)) return false;
    if (d.role === "tabpanel" || d.controlled) return true;
    if (FOLD.test(marks)) return true;
    return Number(d.chars) >= FOLD_CHARS;
  }

  /* --- fin de las reglas --- */

  function hiddenByStyle(el) {
    var cs = window.getComputedStyle(el);
    return cs.display === "none" || cs.visibility === "hidden";
  }

  /** Los ids que algún control de la página dice abrir (aria-controls). */
  function controlledIds() {
    var ids = {};
    var list = document.querySelectorAll("[aria-controls]");
    for (var i = 0; i < list.length; i++) {
      var names = (list[i].getAttribute("aria-controls") || "").split(/\s+/);
      for (var j = 0; j < names.length; j++) if (names[j]) ids["#" + names[j]] = true;
    }
    return ids;
  }

  /** Cómo se llama un panel de pestaña: lo que dice su pestaña (aria-labelledby) o su aria-label. */
  function panelLabel(panel) {
    var by = panel.getAttribute("aria-labelledby");
    var tab = by ? document.getElementById(by.split(/\s+/)[0]) : null;
    var text = tab ? tab.textContent : panel.getAttribute("aria-label");
    return (text || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").slice(0, 200);
  }

  /** El bloque al que pertenece un texto: el ancestro más cercano que no va en línea. */
  function blockOf(node, root) {
    var el = node.parentElement;
    while (el && el !== root) {
      var d = window.getComputedStyle(el).display;
      if (d.indexOf("inline") !== 0 && d !== "contents") return el;
      el = el.parentElement;
    }
    return root;
  }

  /**
   * El texto de la página, en orden: una lista de bloques, cada uno un título
   * (h) o un párrafo. Con data-leer="si", solo lo visible. Con "todo", también
   * lo plegado (ver «Las reglas de lectura»): esos bloques van marcados (o),
   * para que el marco quite los que repiten algo que ya se ve. La dirección va
   * sin fragmento; el marco y el servidor le quitan además los parámetros que
   * puedan llevar datos de la persona.
   */
  function readPage() {
    var root = document.querySelector("[data-pilo-leer]") || document.querySelector("main") || document.querySelector("article") || document.querySelector("[role='main']") || document.body;
    var blocks = [];
    if (!root) return null;
    var all = mode === "todo";
    var controlled = all ? controlledIds() : {};
    // Las ramas ocultas que se aceptaron como contenido plegado.
    var folds = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType === 1) {
          if (!all) {
            if (node === frame || node.matches(SKIP) || hiddenByStyle(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_SKIP;
          }
          if (node === frame || node.matches(NEVER)) return NodeFilter.FILTER_REJECT;
          var cs = window.getComputedStyle(node);
          if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true" || cs.display === "none" || cs.visibility === "hidden") {
            var d = {
              role: (node.getAttribute("role") || "").toLowerCase(),
              marks: (typeof node.className === "string" ? node.className : "") + " " + (node.id || ""),
              fixed: cs.position === "fixed" || cs.position === "sticky",
              controlled: !!(node.id && controlled["#" + node.id]),
              chars: (node.textContent || "").replace(/\s+/g, " ").length,
            };
            if (!plegado(d)) return NodeFilter.FILTER_REJECT;
            if (folds.indexOf(node) < 0) folds.push(node);
          }
          return NodeFilter.FILTER_SKIP;
        }
        return /\S/.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    /** ¿Este texto está plegado? Dentro de una rama oculta aceptada o de un <details> cerrado (fuera de su <summary>). */
    function folded(textNode) {
      for (var i = folds.length - 1; i >= 0; i--) if (folds[i].contains(textNode)) return 1;
      var el = textNode.parentElement;
      var closed = el && el.closest ? el.closest("details:not([open])") : null;
      if (!closed || !root.contains(closed)) return 0;
      var summary = el.closest("summary");
      return summary && summary.parentNode === closed ? 0 : 1;
    }
    var last = null;
    var lastPanel = null;
    var current = null;
    var total = 0;
    var seen = 0;
    var node;
    while ((node = walker.nextNode()) && seen < MAX_NODES && total < PAGE_CHARS) {
      seen += 1;
      var owner = blockOf(node, root);
      var text = (node.nodeValue || "").replace(/\s+/g, " ");
      if (owner !== last) {
        last = owner;
        var hidden = all ? folded(node) : 0;
        // Un panel de pestaña entra con el nombre de su pestaña por título: sin él no se sabe de qué habla.
        var panel = all && owner.closest ? owner.closest("[role='tabpanel']") : null;
        if (panel && panel !== lastPanel && root.contains(panel)) {
          lastPanel = panel;
          var label = panelLabel(panel);
          if (label.length > 1) blocks.push(hidden ? { h: 1, t: label, o: 1 } : { h: 1, t: label });
        }
        // Leyendo todo, el <summary> y el botón que abre un acordeón son el título de lo que despliegan.
        var heading = owner.closest ? owner.closest(all ? "h1,h2,h3,h4,h5,h6,[role='heading'],summary,button[aria-controls]" : "h1,h2,h3,h4,h5,h6,[role='heading']") : null;
        if (all && !heading && node.parentElement && node.parentElement.closest) heading = node.parentElement.closest("button[aria-controls]");
        current = { h: heading && root.contains(heading) ? 1 : 0, t: "" };
        if (hidden) current.o = 1;
        blocks.push(current);
      }
      if (current.t.length < BLOCK_CHARS) {
        current.t += text;
        total += text.length;
      }
    }
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var t = blocks[i].t.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").slice(0, BLOCK_CHARS);
      if (t.length <= 1) continue;
      if (blocks[i].o) out.push({ h: blocks[i].h, t: t, o: 1 });
      else out.push({ h: blocks[i].h, t: t });
    }
    if (!out.length) return null;
    return { url: location.origin + location.pathname + location.search, title: (document.title || "").slice(0, 200), blocks: out };
  }

  /** El marco pide la página: se lee en ese momento, así vale también para páginas que cambian sin recargar. */
  function sendPage(id) {
    if (!frame || !frame.contentWindow) return;
    var page = null;
    if (canRead) {
      try {
        page = readPage();
      } catch (e) {
        page = null;
      }
    }
    frame.contentWindow.postMessage({ source: "pilo-host", type: "pagina", id: id, page: page }, origin);
  }

  function mount() {
    frame = document.createElement("iframe");
    frame.src = origin + space.route + "?tema=" + encodeURIComponent(tema) + "&lado=" + (left ? "izq" : "der") + (lang ? "&lang=" + lang : "");
    frame.title = space.title;
    frame.setAttribute("allow", "autoplay");
    frame.setAttribute("allowtransparency", "true");
    // color-scheme igual al del marco: si difieren, el navegador le pinta un fondo opaco.
    frame.style.cssText =
      "position:fixed;bottom:0;" +
      (left ? "left:0;" : "right:0;") +
      "width:96px;height:104px;max-width:100%;max-height:100%;border:0;margin:0;padding:0;" +
      "background:transparent;color-scheme:light;z-index:2147483000;visibility:hidden;display:block;";
    document.body.appendChild(frame);
  }

  // Cada cargador solo atiende a su propio marco: los mensajes del otro Pilo no lo mueven.
  window.addEventListener("message", function (e) {
    if (!frame || e.source !== frame.contentWindow || e.origin !== origin) return;
    var m = e.data;
    if (!m || m.source !== "pilo-embed") return;
    if (m.type === "leer") return sendPage(m.id);
    if (m.type !== "estado") return;
    if (m.state !== "oculto" && !SIZE[m.state]) return;
    state = m.state;
    apply();
    tellFrame();
  });

  window.addEventListener("resize", function () {
    apply();
    tellFrame();
  });

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
