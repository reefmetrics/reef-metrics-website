// Interactive pieces of the Features page.
//
// [data-tabs]      ARIA tabs: buttons with role="tab" switch the matching
//                  role="tabpanel". Arrow keys, Home and End move between tabs.
// [data-lighting]  Colour swatches that shift the hue of the RGB ring render.
//                  The render is teal; a hue rotation previews other colours.
(function () {
  document.querySelectorAll("[data-tabs]").forEach((group) => {
    const tabs = Array.from(group.querySelectorAll('[role="tab"]'));
    const select = (tab, focus) => {
      for (const other of tabs) {
        const selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        other.tabIndex = selected ? 0 : -1;
        document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
      }
      if (focus) tab.focus();
      // Keep the chosen tab in view when the tab row scrolls sideways on phones.
      tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
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
    const image = block.querySelector("img");
    const swatches = Array.from(block.querySelectorAll("[data-hue]"));
    const choose = (swatch) => {
      for (const other of swatches) {
        const checked = other === swatch;
        other.setAttribute("aria-checked", String(checked));
        other.tabIndex = checked ? 0 : -1;
      }
      image.style.filter = `hue-rotate(${swatch.dataset.hue}deg) saturate(1.15)`;
    };
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
