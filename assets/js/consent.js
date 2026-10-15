// Analytics and the privacy notice.
//
// The site uses Cloudflare Web Analytics, which counts visits without cookies
// and without tracking anyone across sites. It still only loads after the
// visitor agrees in the notice below; the choice is remembered in this browser
// (localStorage, not a cookie) and can be changed from the Privacy page.
//
// CF_ANALYTICS_TOKEN is the site token from the Cloudflare dashboard
// (Analytics & Logs > Web Analytics). While it is empty nothing is loaded.
const CF_ANALYTICS_TOKEN = "bcbcd6ac3bff4215a87b61a7826391eb";

(function () {
  const KEY = "rm-analytics-choice"; // "yes" or "no"
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const write = (value) => { try { localStorage.setItem(KEY, value); } catch { /* private mode: ask again next time */ } };

  function loadAnalytics() {
    if (!CF_ANALYTICS_TOKEN || document.querySelector("script[data-cf-beacon]")) return;
    const script = document.createElement("script");
    script.defer = true;
    script.src = "https://static.cloudflareinsights.com/beacon.min.js";
    script.setAttribute("data-cf-beacon", JSON.stringify({ token: CF_ANALYTICS_TOKEN }));
    document.head.append(script);
  }

  function showNotice() {
    const notice = document.createElement("div");
    notice.className = "consent";
    notice.setAttribute("role", "region");
    notice.setAttribute("aria-label", "Privacy choice");
    notice.innerHTML = `
      <p>We'd like to count visits with Cloudflare Web Analytics. It uses no cookies and doesn't track you across sites. <a href="/privacy#analytics">Privacy</a></p>
      <div class="consent-actions">
        <button type="button" class="btn btn-quiet btn-small" data-choice="no">No thanks</button>
        <button type="button" class="btn btn-primary btn-small" data-choice="yes">OK</button>
      </div>`;
    document.body.append(notice);
    document.body.classList.add("has-consent-banner");
    window.dispatchEvent(new Event("site:ui-change"));
    notice.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-choice]");
      if (!choice) return;
      write(choice.dataset.choice);
      if (choice.dataset.choice === "yes") loadAnalytics();
      notice.remove();
      document.body.classList.remove("has-consent-banner");
      window.dispatchEvent(new Event("site:ui-change"));
    });
  }

  // The Privacy page has a button to change the choice.
  document.querySelectorAll("[data-analytics-reset]").forEach((button) => {
    button.addEventListener("click", () => {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      if (!document.querySelector(".consent")) showNotice();
    });
  });

  const choice = read();
  if (choice === "yes") loadAnalytics();
  else if (choice !== "no") showNotice();
})();
