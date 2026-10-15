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
  const TUNING = {
    desktop: { pxPerFrame: 7, holdVh: 0.3, ease: 0.12 },
    mobile: { pxPerFrame: 14, holdVh: 0.4, ease: 0.08 },
  };
  const FIRST_HOLD_VH = 0.25;
  // A beat that starts moving straight away (no glide to a new subject first)
  // gets a short lead-in: its caption arrives while the picture is still, and
  // only then does the motion begin, so the words come before the action.
  const LEAD_IN_VH = 0.25;
  // Some moves read better slower than the rest of the tour.
  const BEAT_SPEED = { lift: 1.4 };
  const HOLD_DRIFT = 0.025; // the picture scales by this much across a hold
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
  let drawn = -1;
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
        const holdLength = viewport * (index === 0 ? FIRST_HOLD_VH : HOLD_VH);
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

  const frameUrl = (index) =>
    `/assets/seq/${variant}/${String(index + 1).padStart(4, "0")}.webp`;

  const isLoaded = (image) => image && image.complete && image.naturalWidth > 0;

  // The nearest already-loaded frame, so fast scrolling never shows a blank.
  function nearestLoaded(index) {
    for (let offset = 0; offset < frameCount; offset++) {
      if (isLoaded(frames[index - offset])) return frames[index - offset];
      if (isLoaded(frames[index + offset])) return frames[index + offset];
    }
    return null;
  }

  function sizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    drawn = -1;
  }

  // Equivalent of object-fit: contain. The renders fade to pure black at their
  // edges and so does the page, so letterboxing is invisible and no part of
  // the product is ever cropped on screens that are not exactly 16:9 or 9:16.
  function draw(index) {
    const image = nearestLoaded(index);
    if (!image) return;
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, x, y, width, height);
    const ratio = canvas.width / canvas.clientWidth;
    imageRect = { x: x / ratio, y: y / ratio, width: width / ratio, height: height / ratio };
    drawn = isLoaded(frames[index]) ? index : -1;
    root.dataset.frame = String(index + 1); // read by the end-to-end site check
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
  function tick() {
    const offset = scrollOffset();
    const target = positionAt(offset);
    const delta = target.frame - current;
    current = Math.abs(delta) < 0.05 ? target.frame : current + delta * tuning.ease;
    const driftDelta = target.drift - currentDrift;
    currentDrift = Math.abs(driftDelta) < 0.002 ? target.drift : currentDrift + driftDelta * tuning.ease;

    const index = Math.min(frameCount - 1, Math.max(0, Math.round(current)));
    if (index !== drawn) draw(index);
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
    }
  }

  function wake() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  // Load a coarse pass over the whole sequence first so any position is
  // scrubbable early, then fill in outward from where the viewer is.
  function load() {
    variant = mobileQuery.matches ? "mobile" : "desktop";
    frames = new Array(frameCount);
    labelledRect = "";
    const pending = new Set(Array.from({ length: frameCount }, (_, i) => i));
    const coarse = [];
    for (let i = 0; i < frameCount; i += 12) coarse.push(i);

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
        if (Math.abs(index - current) < 12) drawn = -1;
        wake();
        next();
      };
      image.src = frameUrl(index);
      frames[index] = image;
    };
    for (let lane = 0; lane < LOAD_LANES; lane++) next();
  }

  function fallBack() {
    root.classList.add("is-static");
    root.style.height = "";
    window.dispatchEvent(new Event("tour:ready"));
  }

  fetch("/assets/seq/tour.json")
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
