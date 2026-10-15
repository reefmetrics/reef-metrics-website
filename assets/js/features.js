// Interactive pieces of the Features page.
//
// [data-tabs]      ARIA tabs: buttons with role="tab" switch the matching
//                  role="tabpanel". Arrow keys, Home and End move between tabs.
// [data-lighting]  Colour swatches that crossfade between renders of the same
//                  shot of Wavie with its ring and logo in each colour.
//
// Both can also be swiped (touch, pen or mouse drag) left and right to step
// through their options.
(function () {
  // Calls back on a horizontal swipe; vertical moves are left to page scrolling.
  function onSwipe(element, next, previous) {
    let start = null;
    element.addEventListener("pointerdown", (event) => {
      if (event.button > 0) return;
      start = { x: event.clientX, y: event.clientY };
    });
    const finish = (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) next(); else previous();
    };
    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", () => { start = null; });
    element.addEventListener("dragstart", (event) => event.preventDefault());
  }

  // On touch screens, a row of dots with arrows under each swipeable area shows
  // how many options there are, which one is showing, and that it can be
  // swiped. The first time an area scrolls into view it nudges sideways once.
  const touch = window.matchMedia("(hover: none) and (pointer: coarse)");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  function swipeIndicator(after, count, label) {
    const indicator = document.createElement("div");
    indicator.className = "swipe-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerHTML = `<span class="swipe-arrow">‹</span><span class="swipe-dots">${"<i></i>".repeat(count)}</span><span class="swipe-arrow">›</span><span class="swipe-label">${label}</span>`;
    after.after(indicator);
    const dots = Array.from(indicator.querySelectorAll("i"));
    return (active) => {
      dots.forEach((dot, index) => dot.classList.toggle("is-on", index === active));
      indicator.classList.toggle("at-start", active === 0);
      indicator.classList.toggle("at-end", active === count - 1);
    };
  }
  function nudgeOnce(element) {
    if (calm.matches || !touch.matches || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      element.classList.add("is-nudging");
      element.addEventListener("animationend", () => element.classList.remove("is-nudging"), { once: true });
    }, { threshold: 0.6 });
    observer.observe(element);
  }

  document.querySelectorAll("[data-tabs]").forEach((group) => {
    const tabs = Array.from(group.querySelectorAll('[role="tab"]'));
    let showDot = null;
    const select = (tab, focus) => {
      for (const other of tabs) {
        const selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        other.tabIndex = selected ? 0 : -1;
        document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
      }
      if (focus) tab.focus();
      if (typeof showDot === "function") showDot(tabs.indexOf(tab));
      // Keep the chosen tab in view when the tab row scrolls sideways on phones.
      tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const panels = Array.from(group.querySelectorAll('[role="tabpanel"]'));
    showDot = swipeIndicator(group.querySelector(".tab-list"), tabs.length, "Swipe to switch");
    showDot(0);
    nudgeOnce(panels[0]);
    const step = (by) => {
      const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
      const target = current + by;
      if (target < 0 || target >= tabs.length) return;
      select(tabs[target], false);
      const panel = document.getElementById(tabs[target].getAttribute("aria-controls"));
      panel.classList.remove("is-from-left", "is-from-right");
      void panel.offsetWidth; // restart the slide-in animation
      panel.classList.add(by > 0 ? "is-from-right" : "is-from-left");
    };
    group.querySelectorAll('[role="tabpanel"]').forEach((panel) => onSwipe(panel, () => step(1), () => step(-1)));
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab, false));
      tab.addEventListener("keydown", (event) => {
        const moves = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: tabs.length - 1 };
        if (!(event.key in moves)) return;
        event.preventDefault();
        select(tabs[(moves[event.key] + tabs.length) % tabs.length], true);
      });
    });
  });

  document.querySelectorAll("[data-lighting]").forEach((block) => {
    let showColourDot = null;
    const shots = Array.from(block.querySelectorAll(".ring-shot"));
    const swatches = Array.from(block.querySelectorAll("[data-colour]")).filter((el) => el.matches("button"));
    const choose = (swatch) => {
      for (const other of swatches) {
        const checked = other === swatch;
        other.setAttribute("aria-checked", String(checked));
        other.tabIndex = checked ? 0 : -1;
      }
      if (typeof showColourDot === "function") showColourDot(swatches.indexOf(swatch));
      for (const shot of shots) {
        const on = shot.dataset.colour === swatch.dataset.colour;
        shot.classList.toggle("is-on", on);
        // Only the visible render is described to screen readers.
        shot.querySelector("img").alt = on ? `Wavie with its base ring and logo glowing ${swatch.getAttribute("aria-label").toLowerCase()}` : "";
      }
    };
    const stage = block.querySelector(".ring-stage");
    showColourDot = stage ? swipeIndicator(stage, swatches.length, "Swipe for colours") : () => {};
    showColourDot(0);
    if (stage) nudgeOnce(stage);
    const stepColour = (by) => {
      const current = swatches.findIndex((swatch) => swatch.getAttribute("aria-checked") === "true");
      const target = current + by;
      if (target >= 0 && target < swatches.length) choose(swatches[target]);
    };
    if (stage) onSwipe(stage, () => stepColour(1), () => stepColour(-1));
    swatches.forEach((swatch, index) => {
      swatch.tabIndex = index === 0 ? 0 : -1;
      swatch.addEventListener("click", () => choose(swatch));
      swatch.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const next = swatches[(index + step + swatches.length) % swatches.length];
        choose(next);
        next.focus();
      });
    });
  });
})();
