// Site-wide behaviour: nav background and the Beta Kit pre-order button.
// PREORDER_URL is the one place the Stripe checkout link lives. While it is
// empty the button says pre-orders are not open yet and goes nowhere.
// This is the LIVE link: real $1,999.99 charges.
const PREORDER_URL = "https://buy.stripe.com/dRmaEY72u8UP8TOdoN7Re01";

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
    return true;
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

  const button = document.getElementById("preorder");
  const ack = document.getElementById("ack");
  if (!button || !ack) return;

  if (!PREORDER_URL) {
    button.textContent = "Pre-orders open soon";
    ack.closest("label").hidden = true;
    return;
  }

  const sync = () => {
    button.setAttribute("aria-disabled", String(!ack.checked));
    button.setAttribute("href", ack.checked ? PREORDER_URL : "#beta-kit");
  };
  ack.addEventListener("change", sync);
  button.addEventListener("click", (event) => {
    if (ack.checked) return;
    event.preventDefault();
    ack.focus();
  });
  sync();
})();
