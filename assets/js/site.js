// Site-wide behaviour: nav background and the Beta Kit pre-order button.
// PREORDER_URL is the one place the Stripe checkout link lives. While it is
// empty the button says pre-orders are not open yet and goes nowhere.
// This is the LIVE link: real $1,999.99 charges.
const PREORDER_URL = "https://buy.stripe.com/6oUcN62Meef9c60gAZ7Re02";

(function () {
  const nav = document.getElementById("nav");
  if (nav) {
    const setNav = () => nav.classList.toggle("is-solid", window.scrollY > 24);
    setNav();
    window.addEventListener("scroll", setNav, { passive: true });
  }

  // Menus: dropdowns on desktop (hover or the arrow button), and a menu panel
  // on phones opened by the Menu button.
  const menuToggle = document.querySelector(".menu-toggle");
  const closeSubmenus = (except) => document.querySelectorAll(".has-menu.is-open").forEach((item) => {
    if (item === except) return;
    item.classList.remove("is-open");
    item.querySelector(".sub-toggle").setAttribute("aria-expanded", "false");
  });
  const setMenu = (open) => {
    if (!nav || !menuToggle) return;
    nav.classList.toggle("is-menu-open", open);
    window.dispatchEvent(new Event("site:ui-change"));
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.textContent = open ? "Close" : "Menu";
    document.body.style.overflow = open ? "hidden" : "";
  };
  if (menuToggle) menuToggle.addEventListener("click", () => setMenu(!nav.classList.contains("is-menu-open")));
  document.querySelectorAll(".sub-toggle").forEach((toggle) => {
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const item = toggle.closest(".has-menu");
      const open = !item.classList.contains("is-open");
      closeSubmenus(item);
      item.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".has-menu")) closeSubmenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeSubmenus();
    setMenu(false);
  });
  // Choosing any link in the menu closes it.
  document.querySelectorAll(".site-menu a").forEach((link) => link.addEventListener("click", () => {
    closeSubmenus();
    setMenu(false);
  }));

  // In-page links: bring the target section's content to the middle of the
  // space below the nav, or to the top of it when the content is taller.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  function centreOn(hash, smooth) {
    const target = hash && hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
    if (!target) return false;
    const content = target.querySelector(":scope > .wrap") || target;
    const navHeight = nav ? nav.offsetHeight : 0;
    const room = window.innerHeight - navHeight;
    const box = content.getBoundingClientRect();
    const spare = room - box.height;
    const top = window.scrollY + box.top - navHeight - (spare > 0 ? spare / 2 : 24);
    window.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduceMotion.matches ? "smooth" : "auto" });
    settle(hash, content);
    return true;
  }
  // The section can still change size just after landing (tabs setting
  // themselves up, images arriving over a slow connection), so re-centre on
  // each change for a few seconds, unless the visitor starts scrolling.
  let settling = null;
  function settle(hash, content) {
    if (settling) settling();
    if (!("ResizeObserver" in window)) return;
    let last = content.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const height = content.getBoundingClientRect().height;
      if (Math.abs(height - last) < 2) return;
      last = height;
      centreOn(hash, false);
    });
    const userScroll = ["wheel", "touchstart", "keydown", "mousedown"];
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      userScroll.forEach((type) => window.removeEventListener(type, stop));
      settling = null;
    };
    const timer = setTimeout(stop, 4000);
    userScroll.forEach((type) => window.addEventListener(type, stop, { passive: true }));
    observer.observe(content);
    settling = stop;
  }
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href*="#"]');
    if (!link || link.origin !== window.location.origin) return;
    const here = window.location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
    const there = link.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
    if (here !== there) return;
    if (link.id === "preorder") return;
    if (centreOn(link.hash, true)) {
      event.preventDefault();
      history.pushState(null, "", link.hash);
    }
  });
  // Arriving with a hash (e.g. /#beta-kit from another page): wait until the
  // scroll tour has sized itself, since it changes where everything below sits.
  const arrive = () => centreOn(window.location.hash, false);
  window.addEventListener("tour:ready", arrive);
  window.addEventListener("hashchange", arrive);
  if (!document.getElementById("unveil")) window.addEventListener("load", arrive);

  // Connector labels on still renders: <figure data-labels="rear-ports">.
  // Positions come from /assets/img/labels.json (0-1 of the image).
  const labelled = Array.from(document.querySelectorAll("figure[data-labels]"));
  if (labelled.length) {
    fetch("/assets/img/labels.json")
      .then((response) => (response.ok ? response.json() : {}))
      .then((all) => {
        const draw = () => labelled.forEach((figure) => labelFigure(figure, all[figure.dataset.labels] || []));
        draw();
        window.addEventListener("resize", draw);
        labelled.forEach((figure) => figure.querySelector("img").addEventListener("load", draw));
      })
      .catch(() => {});
  }

  function labelFigure(figure, labels) {
    const img = figure.querySelector("img");
    let layer = figure.querySelector(".figure-labels");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "figure-labels";
      layer.setAttribute("aria-hidden", "true");
      img.after(layer);
    }
    layer.replaceChildren();
    if (!labels.length || !img.clientWidth) return;
    const width = img.clientWidth;
    const height = img.clientHeight;
    const short = window.matchMedia("(max-width: 700px)").matches;
    const SHORT_NAMES = { "24v": "24 V", can: "CAN", temp: "Temp", orp: "ORP", ph: "pH", salinity: "Salinity", do: "DO" };
    const points = labels.map((label) => ({
      name: short ? SHORT_NAMES[label.id] || label.name : label.name,
      x: label.at[0] * width,
      y: label.at[1] * height,
    }));
    const centre = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const spacing = width < 420 ? 20 : 24;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    layer.append(svg);
    for (const side of ["left", "right"]) {
      const group = points.filter((p) => (side === "left" ? p.x < centre : p.x >= centre)).sort((a, b) => a.y - b.y);
      if (!group.length) continue;
      const texts = group.map((point) => {
        const text = document.createElement("span");
        text.className = `tour-label is-${side}`;
        text.textContent = point.name;
        layer.append(text);
        return text;
      });
      const widest = Math.max(...texts.map((text) => text.offsetWidth));
      // Keep the column inside the figure, and the page, at any width.
      const rect = figure.getBoundingClientRect();
      const minX = Math.max(0, 8 - rect.left) + widest;
      const maxX = Math.min(width, document.documentElement.clientWidth - 8 - rect.left) - widest;
      const reach = width * 0.14;
      const edge = side === "left"
        ? Math.max(minX, Math.min(...group.map((p) => p.x)) - reach)
        : Math.min(maxX, Math.max(...group.map((p) => p.x)) + reach);
      // Spread the labels into a column centred on the group.
      const middle = group.reduce((sum, p) => sum + p.y, 0) / group.length;
      group.forEach((point, index) => {
        const textY = middle + (index - (group.length - 1) / 2) * spacing;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        line.setAttribute("points", `${point.x},${point.y} ${edge},${textY}`);
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", point.x);
        dot.setAttribute("cy", point.y);
        dot.setAttribute("r", 2);
        svg.append(line, dot);
        texts[index].style.top = `${textY}px`;
        texts[index].style.left = `${edge}px`;
      });
    }
  }

  // Phone homepage: size the hero render so the headline, buttons and the
  // "Scroll to see what it tests" cue end exactly at the bottom of the screen.
  const heroCopy = document.querySelector(".hero-copy");
  const cue = document.querySelector(".tests-cue");
  if (heroCopy && cue) {
    const fit = () => {
      if (!window.matchMedia("(max-width: 860px)").matches) return;
      // The visible height with the browser's address bar showing, measured
      // once; scrolling hides the bar but must not resize the hero.
      document.documentElement.style.setProperty("--screen-h", `${window.innerHeight}px`);
      const h1 = heroCopy.querySelector("h1").getBoundingClientRect();
      const height = cue.getBoundingClientRect().bottom - h1.top;
      document.documentElement.style.setProperty("--hero-copy", `${Math.round(height)}px`);
    };
    fit();
    document.fonts && document.fonts.ready.then(fit);
    let lastWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; fit(); }
    });
  }

  // Phones: a slim pre-order bar slides up once the first screen has been
  // scrolled past, and steps aside while the Beta Kit section or the footer
  // is on screen, while a menu is open, or while the tour is loading.
  const sticky = document.querySelector(".sticky-cta");
  if (sticky) {
    const phone = window.matchMedia("(max-width: 860px)");
    const avoid = Array.from(document.querySelectorAll("#beta-kit, .footer > .wrap"));
    const inView = new Set();
    const update = () => {
      const show = phone.matches
        && window.scrollY > window.innerHeight * 0.8
        && inView.size === 0
        && !document.documentElement.classList.contains("tour-gate")
        && !(nav && nav.classList.contains("is-menu-open"))
        && !document.body.classList.contains("has-consent-banner");
      sticky.classList.toggle("is-visible", show);
      sticky.setAttribute("aria-hidden", String(!show));
      sticky.querySelector("a").tabIndex = show ? 0 : -1;
    };
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inView.add(entry.target); else inView.delete(entry.target);
        }
        update();
      });
      avoid.forEach((el) => observer.observe(el));
    }
    window.addEventListener("scroll", update, { passive: true });
    phone.addEventListener("change", update);
    window.addEventListener("site:ui-change", update);
    update();
  }

  // The pre-order button goes straight to Stripe checkout. The text next to
  // it says that clicking it means the visitor understands what a Beta Kit
  // pre-order is. While checkout opens, the button shows a loading state.
  const button = document.getElementById("preorder");
  if (!button) return;

  if (!PREORDER_URL) {
    button.textContent = "Pre-orders open soon";
    button.removeAttribute("href");
    return;
  }

  button.setAttribute("href", PREORDER_URL);
  button.addEventListener("click", () => {
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    button.textContent = "Opening secure checkout…";
    // If the visitor comes back (e.g. with the Back button), reset the button.
    window.addEventListener("pageshow", () => {
      button.classList.remove("is-loading");
      button.removeAttribute("aria-busy");
      button.textContent = button.dataset.label;
    }, { once: true });
  });
})();
