// Scroll tour: one pinned stage that scrubs a rendered image sequence while
// the page scrolls, with an HTML caption for each beat of the animation.
//
// The sequence is described by /assets/seq/tour.json:
//   { "frames": N,
//     "beats": [{ "id": "optics", "from": 222, "to": 341 }, ...],
//     "labels": { "mainboard": [{ "id": "power", "name": "24 V power",
//                                 "desktop": [x, y], "mobile": [x, y] }] } }
// Each beat is a camera move from `from` to `to`. A caption (data-beat="<id>")
// takes over when its subject appears: at the start of the beat, or for a beat
// that glides to a new subject before its action (`action_from`), halfway
// through that glide, which is where the renders swap one subject for the
// next. So the words always describe what is on screen. Captioned beats end
// with a short hold on `to`, during which the picture drifts in very slowly so
// scrolling never feels dead. Label positions are normalised frame coordinates
// of the beat's last frame.
//
// The page starts in the pinned layout when the inline script in <head> has
// added .js to <html>. If reduced motion is on that class is never added, and
// if the sequence fails to load this script adds .is-static, so the section
// falls back to ordinary blocks with still images.
(function () {
  const root = document.getElementById("unveil");
  if (!root) return;
  if (!document.documentElement.classList.contains("js")) {
    window.addEventListener("load", () => window.dispatchEvent(new Event("tour:ready")));
    return;
  }

  // Touch scrolling moves in long flicks with momentum, so phones get more
  // scroll distance per frame, longer holds and a softer follow than mice.
  // `follow` is the time constant (seconds) of the picture easing toward the
  // scroll position: about 63% of the way in that time, whatever the screen's
  // refresh rate.
  const TUNING = {
    desktop: { pxPerFrame: 7, holdVh: 0.3, follow: 0.14 },
    mobile: { pxPerFrame: 14, holdVh: 0.4, follow: 0.16 },
  };
  // Frames decoded ahead of and behind the current position, so drawing never
  // waits on a decode.
  const DECODE_AHEAD = 10;
  const DECODE_BEHIND = 4;
  const FIRST_HOLD_VH = 0.25;
  // A beat that starts moving straight away (no glide to a new subject first)
  // gets a short lead-in: its caption arrives while the picture is still, and
  // only then does the motion begin, so the words come before the action.
  const LEAD_IN_VH = 0.25;
  // Some moves read better slower than the rest of the tour.
  const BEAT_SPEED = { lift: 1.4 };
  const HOLD_DRIFT = 0.015; // the picture scales by this much across a hold
  const LOAD_LANES = 6;

  // Beats whose labels the page draws. Empty: the mainboard's labels are part
  // of the render, in the same style as the product films.
  const LABELLED = [];
  const SHORT_NAMES = { "24v": "24 V", can: "CAN", temp: "Temp", orp: "ORP", ph: "pH", salinity: "Salinity", do: "DO" };

  const canvas = root.querySelector(".unveil-canvas");
  const context = canvas.getContext("2d");
  const labelLayer = root.querySelector(".tour-labels");
  const mobileQuery = window.matchMedia("(max-width: 860px)");
  const captionById = new Map(
    Array.from(root.querySelectorAll("[data-beat]")).map((el) => [el.dataset.beat, el]),
  );

  let tour = null;
  let frameCount = 0;
  let segments = []; // { start, end, fromFrame, toFrame, hold } in scroll pixels
  let captions = []; // { id, el, start, end } in scroll pixels
  let travel = 0;
  let frames = [];
  let variant = "";
  let current = 0; // smoothed position: frame index plus hold progress
  let currentDrift = 0;
  let drawn = ""; // what is on the canvas: "<index>:<next>:<blend>"
  let lastTime = 0;
  const decoded = new Set(); // frame indexes known to be decoded and ready to draw
  let imageRect = { x: 0, y: 0, width: 0, height: 0 }; // where the frame sits, in CSS px
  let running = false;

  let tuning = TUNING.desktop;

  function buildTimeline() {
    tuning = mobileQuery.matches ? TUNING.mobile : TUNING.desktop;
    const PX_PER_FRAME = tuning.pxPerFrame;
    const HOLD_VH = tuning.holdVh;
    const viewport = window.innerHeight;
    segments = [];
    captions = [];
    let cursor = 0;
    tour.beats.forEach((beat, index) => {
      const fromFrame = beat.from - 1;
      const toFrame = beat.to - 1;
      const el = captionById.get(beat.id);
      const pxPerFrame = PX_PER_FRAME * (BEAT_SPEED[beat.id] || 1);
      if (el) {
        const glide = beat.action_from ? (beat.action_from - beat.from) / 2 : 0;
        const handover = cursor + glide * pxPerFrame;
        const previous = captions[captions.length - 1];
        if (previous) previous.end = handover;
        captions.push({ id: beat.id, el, start: index === 0 ? -1 : handover, end: Infinity });
        if (index > 0 && !beat.action_from) {
          const leadIn = viewport * LEAD_IN_VH;
          const still = Math.max(0, fromFrame - 1);
          segments.push({ start: cursor, end: cursor + leadIn, fromFrame: still, toFrame: still, hold: false });
          cursor += leadIn;
        }
      }
      const moveLength = Math.max(0, toFrame - fromFrame) * pxPerFrame;
      if (moveLength > 0) {
        segments.push({ start: cursor, end: cursor + moveLength, fromFrame, toFrame, hold: false });
        cursor += moveLength;
      }
      if (el) {
        const last = index === tour.beats.length - 1;
        const holdLength = viewport * (index === 0 ? FIRST_HOLD_VH : last ? HOLD_VH * 2 : HOLD_VH);
        segments.push({ start: cursor, end: cursor + holdLength, fromFrame: toFrame, toFrame, hold: true });
        cursor += holdLength;
      }
    });
    travel = cursor;
    root.style.height = `${travel + viewport}px`;
    // Read by the end-to-end site check to visit each beat's hold.
    root.dataset.holds = JSON.stringify(
      segments.filter((segment) => segment.hold).map((segment) => [segment.start, segment.end]),
    );
  }

  function scrollOffset() {
    return Math.min(travel, Math.max(0, -root.getBoundingClientRect().top));
  }

  // The frame for a scroll offset, and how far through a hold it is (0-1).
  function positionAt(offset) {
    for (const segment of segments) {
      if (offset <= segment.end) {
        const span = segment.end - segment.start;
        const t = span > 0 ? Math.max(0, (offset - segment.start) / span) : 1;
        if (segment.hold) return { frame: segment.toFrame, drift: t };
        return { frame: segment.fromFrame + (segment.toFrame - segment.fromFrame) * t, drift: 0 };
      }
    }
    return { frame: frameCount - 1, drift: 1 };
  }

  // Frames and tour.json carry the render's version (data-tour-version on the
  // section, filled in by sync-head.py), so a new render never mixes with
  // frames still held in a browser or CDN cache.
  const tourVersion = root.dataset.tourVersion || "";
  const versioned = (url) => (tourVersion ? `${url}?v=${tourVersion}` : url);
  const frameUrl = (index) =>
    versioned(`/assets/seq/${variant}/${String(index + 1).padStart(4, "0")}.webp`);

  const isLoaded = (image) => image && image.complete && image.naturalWidth > 0;
  const isReady = (index) => decoded.has(index) && isLoaded(frames[index]);

  // The nearest frame that is ready to draw, so fast scrolling never shows a blank.
  function nearestReady(index) {
    for (let offset = 0; offset < frameCount; offset++) {
      if (isReady(index - offset)) return index - offset;
      if (isReady(index + offset)) return index + offset;
    }
    return -1;
  }

  // Decode the frames around the viewer before they are needed.
  function decodeAround(index) {
    for (let i = index - DECODE_BEHIND; i <= index + DECODE_AHEAD; i++) {
      const image = frames[i];
      if (!image || decoded.has(i) || image.decodePending || !isLoaded(image)) continue;
      image.decodePending = true;
      const done = () => { image.decodePending = false; decoded.add(i); drawn = ""; wake(); };
      (image.decode ? image.decode() : Promise.resolve()).then(done, done);
    }
  }

  function sizeCanvas() {
    // No sharper than the source frames: a larger canvas only costs time.
    const source = frames.find(isLoaded);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    let width = Math.round(canvas.clientWidth * ratio);
    let height = Math.round(canvas.clientHeight * ratio);
    if (source) {
      const fit = Math.min(width / source.naturalWidth, height / source.naturalHeight);
      if (fit > 1) { width = Math.round(width / fit); height = Math.round(height / fit); }
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    drawn = "";
  }

  // Equivalent of object-fit: contain. The renders fade to pure black at their
  // edges and so does the page, so letterboxing is invisible and no part of
  // the product is ever cropped on screens that are not exactly 16:9 or 9:16.
  // Between two frames the picture is a blend of both, so slow scrolling moves
  // continuously instead of stepping frame to frame.
  function draw(position) {
    const base = Math.floor(position);
    const blend = position - base;
    const first = isReady(base) ? base : nearestReady(Math.round(position));
    if (first < 0) return;
    const second = first === base && blend > 0.02 && isReady(base + 1) ? base + 1 : -1;
    const key = `${first}:${second}:${second < 0 ? 0 : Math.round(blend * 32)}`;
    if (key === drawn) return;
    const image = frames[first];
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    context.globalAlpha = 1;
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, x, y, width, height);
    if (second >= 0) {
      context.globalAlpha = Math.round(blend * 32) / 32;
      context.drawImage(frames[second], x, y, width, height);
      context.globalAlpha = 1;
    }
    const ratio = canvas.width / canvas.clientWidth;
    imageRect = { x: x / ratio, y: y / ratio, width: width / ratio, height: height / ratio };
    drawn = key;
    root.dataset.frame = String(Math.round(position) + 1); // read by the end-to-end site check
    root.dataset.position = position.toFixed(2);
    root.classList.add("is-ready");
  }

  // Leader-line labels for a beat's connectors, placed on either side of the
  // subject and spread vertically so they never overlap.
  function placeLabels(beatId) {
    if (!labelLayer) return;
    labelLayer.replaceChildren();
    let labels = tour.labels && tour.labels[beatId];
    if (!Array.isArray(labels) || !labels.length) return;
    // Where the render marks a selected item (the valve's ports), label only
    // that one: the port numbering in the model is not the firmware's.
    if (labels.some((label) => "selected" in label)) {
      labels = labels.filter((label) => label.selected).map((label) => ({ ...label, name: "Selected port" }));
    }
    // Phones get the short names so the columns fit beside the subject.
    const points = labels.map((label) => {
      const [nx, ny] = label[variant] || label.desktop;
      const name = mobileQuery.matches ? SHORT_NAMES[label.id] || label.name : label.name;
      return { name, x: imageRect.x + nx * imageRect.width, y: imageRect.y + ny * imageRect.height };
    });
    const centre = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const gap = Math.max(28, imageRect.width * 0.05);
    const spacing = mobileQuery.matches ? 22 : 28;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    labelLayer.append(svg);
    for (const side of ["left", "right"]) {
      const group = points
        .filter((point) => (side === "left" ? point.x < centre : point.x >= centre))
        .sort((a, b) => a.y - b.y);
      if (!group.length) continue;
      const edge = side === "left"
        ? Math.min(...group.map((point) => point.x)) - gap
        : Math.max(...group.map((point) => point.x)) + gap;
      // Text first, so the column can be pulled inside the screen edge.
      const texts = group.map((point) => {
        const text = document.createElement("span");
        text.className = `tour-label is-${side}`;
        text.textContent = point.name;
        labelLayer.append(text);
        return text;
      });
      const widest = Math.max(...texts.map((text) => text.offsetWidth));
      // Keep clear of the screen edge even at the end of a hold's slow drift.
      const margin = 12 + (labelLayer.clientWidth * HOLD_DRIFT) / 2;
      const column = side === "left"
        ? Math.max(edge, margin + widest)
        : Math.min(edge, labelLayer.clientWidth - margin - widest);
      const top = (mobileQuery.matches ? 64 : 80);
      const bottom = labelLayer.clientHeight - margin - spacing / 2;
      let textY = Math.max(top, Math.min(group[0].y, bottom - spacing * (group.length - 1)));
      group.forEach((point, i) => {
        if (i > 0) textY = Math.max(point.y, textY + spacing);
        textY = Math.min(textY, bottom - spacing * (group.length - 1 - i));
        const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        line.setAttribute("points", `${point.x},${point.y} ${column},${textY}`);
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", point.x);
        dot.setAttribute("cy", point.y);
        dot.setAttribute("r", 2.5);
        svg.append(line, dot);
        texts[i].style.top = `${textY}px`;
        texts[i].style.left = `${column}px`;
      });
    }
  }

  let labelledBeat = "";
  let labelledRect = "";

  function updateLabels(offset) {
    if (!labelLayer) return;
    // Labels show during the hold of a labelled beat.
    const segment = segments.find((s) => offset <= s.end);
    const beat = segment && segment.hold
      ? tour.beats.find((b) => b.to - 1 === segment.toFrame)
      : null;
    const id = beat && tour.labels && LABELLED.includes(beat.id) && Array.isArray(tour.labels[beat.id]) ? beat.id : "";
    const rectKey = `${variant}:${Math.round(imageRect.width)}:${Math.round(imageRect.x)}`;
    if (id && (id !== labelledBeat || rectKey !== labelledRect)) placeLabels(id);
    if (id) {
      labelledBeat = id;
      labelledRect = rectKey;
    }
    labelLayer.classList.toggle("is-on", Boolean(id));
  }

  // Ease toward the position the scroll asks for, so wheel steps and touch
  // flicks turn into continuous motion instead of jumps.
  function tick(time) {
    const dt = Math.min(0.1, lastTime ? (time - lastTime) / 1000 : 1 / 60);
    lastTime = time;
    const offset = scrollOffset();
    const target = positionAt(offset);
    const delta = target.frame - current;
    // Follow gently, but catch up quickly when far behind (a fast scroll or a
    // jump), so the animation never trails the page and is not skipped.
    // (Catch-up only starts when the picture is a long way behind.)
    const follow = tuning.follow / (1 + Math.max(0, Math.abs(delta) - 30) / 40);
    const step = 1 - Math.exp(-dt / follow);
    current = Math.abs(delta) < 0.01 ? target.frame : current + delta * step;
    const driftDelta = target.drift - currentDrift;
    currentDrift = Math.abs(driftDelta) < 0.001 ? target.drift : currentDrift + driftDelta * step;

    const position = Math.min(frameCount - 1, Math.max(0, current));
    decodeAround(Math.round(position));
    if (Math.round(target.frame) !== Math.round(position)) decodeAround(Math.round(target.frame));
    draw(position);
    const drift = currentDrift ? `scale(${1 + HOLD_DRIFT * currentDrift})` : "";
    canvas.style.transform = drift;
    if (labelLayer) labelLayer.style.transform = drift;

    for (const caption of captions) {
      caption.el.classList.toggle("is-on", offset > caption.start && offset <= caption.end);
    }
    updateLabels(offset);
    root.classList.toggle("is-scrolled", offset > 4);

    if (current !== target.frame || currentDrift !== target.drift) {
      requestAnimationFrame(tick);
    } else {
      running = false;
      lastTime = 0;
    }
  }

  function wake() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  const progress = document.createElement("div");
  progress.className = "tour-progress";
  progress.setAttribute("role", "status");
  progress.innerHTML = '<span class="tour-progress-label">Loading the animation</span><span class="tour-progress-bar"><i></i></span><button type="button" class="tour-skip">Skip the animation</button>';
  root.querySelector(".unveil-stage").append(progress);
  const progressFill = progress.querySelector("i");
  // Skip: end the wait and go straight to the content after the tour.
  progress.querySelector(".tour-skip").addEventListener("click", () => {
    releaseScroll();
    const after = root.nextElementSibling;
    if (after) window.scrollTo({ top: after.getBoundingClientRect().top + window.scrollY - (document.getElementById("nav")?.offsetHeight || 0), behavior: "auto" });
  });

  // The hold itself is started by the inline script in <head> (class
  // "tour-gate" on <html>); this only ends it.
  function releaseScroll() {
    document.documentElement.classList.remove("tour-gate");
  }

  // Load a coarse pass over the whole sequence first so any position is
  // scrubbable early, then fill in outward from where the viewer is.
  function load() {
    variant = mobileQuery.matches ? "mobile" : "desktop";
    root.dataset.frames = variant;
    frames = new Array(frameCount);
    decoded.clear();
    labelledRect = "";
    const pending = new Set(Array.from({ length: frameCount }, (_, i) => i));
    const coarse = [];
    for (let i = 0; i < frameCount; i += 12) coarse.push(i);
    let coarseLeft = coarse.length;
    let loaded = 0;
    root.classList.add("is-loading");
    progressFill.style.transform = "scaleX(0)";

    const pick = () => {
      while (coarse.length) {
        const index = coarse.shift();
        if (pending.has(index)) return index;
      }
      const centre = Math.round(current);
      for (let offset = 0; offset < frameCount; offset++) {
        if (pending.has(centre + offset)) return centre + offset;
        if (pending.has(centre - offset)) return centre - offset;
      }
      return -1;
    };

    const next = () => {
      const index = pick();
      if (index < 0) return;
      pending.delete(index);
      const image = new Image();
      image.decoding = "async";
      image.onload = image.onerror = () => {
        if (index % 12 === 0 && --coarseLeft === 0) root.classList.remove("is-loading");
        loaded += 1;
        progressFill.style.transform = `scaleX(${loaded / frameCount})`;
        if (loaded === frameCount) {
          root.classList.add("is-loaded");
          releaseScroll();
        }
        if (index === 0) sizeCanvas();
        if (Math.abs(index - current) <= DECODE_AHEAD) decodeAround(Math.round(current));
        wake();
        next();
      };
      image.src = frameUrl(index);
      frames[index] = image;
    };
    for (let lane = 0; lane < LOAD_LANES; lane++) next();
  }

  function fallBack() {
    releaseScroll();
    root.classList.add("is-static");
    root.style.height = "";
    window.dispatchEvent(new Event("tour:ready"));
  }

  fetch(versioned("/assets/seq/tour.json"))
    .then((response) => {
      if (!response.ok) throw new Error(`tour.json ${response.status}`);
      return response.json();
    })
    .then((data) => {
      tour = data;
      frameCount = tour.frames;
      buildTimeline();
      sizeCanvas();
      current = positionAt(scrollOffset()).frame;
      load();
      wake();
      window.dispatchEvent(new Event("tour:ready"));

      window.addEventListener("scroll", wake, { passive: true });
      // Mobile browsers resize the viewport as the address bar shows and hides
      // during a swipe. Rebuilding the scroll track then would make the
      // picture jump, so only a change of width rebuilds it.
      let lastWidth = window.innerWidth;
      window.addEventListener("resize", () => {
        if (window.innerWidth !== lastWidth || !mobileQuery.matches) {
          lastWidth = window.innerWidth;
          buildTimeline();
        }
        sizeCanvas();
        labelledRect = "";
        wake();
      });
      mobileQuery.addEventListener("change", () => {
        buildTimeline();
        load();
        wake();
      });
    })
    .catch(fallBack);
})();
