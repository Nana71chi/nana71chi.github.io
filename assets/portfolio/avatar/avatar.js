(() => {
  const avatar = document.querySelector('[data-adaptive-avatar]');
  if (!avatar) return;

  const picture = avatar.querySelector('.avatar-picture');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sampleSize = 36;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = sampleSize;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const fallback = [115, 121, 166];
  const minimumContrast = 3.8;
  let mediaEvents;
  let frames = [];

  function luminance(rgb) {
    const [r, g, b] = rgb.map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * r + .7152 * g + .0722 * b;
  }

  function contrast(a, b) {
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  }

  function pageBackground() {
    for (let element = avatar.parentElement; element; element = element.parentElement) {
      const color = getComputedStyle(element).backgroundColor;
      const channels = color.match(/[\d.]+/g)?.map(Number);
      if (color.startsWith('rgb') && channels?.length >= 3 && (channels[3] ?? 1) >= 1) {
        return channels.slice(0, 3);
      }
    }
    return [255, 255, 255];
  }

  function adjustContrast(rgb) {
    const background = luminance(pageBackground());
    if (contrast(background, luminance(rgb)) >= minimumContrast) return rgb;

    // Blend toward black or white by the smallest amount that meets the contrast target.
    const options = [];
    for (const end of [0, 255]) {
      if (contrast(background, luminance([end, end, end])) < minimumContrast) continue;
      let low = 0;
      let high = 1;
      const blend = amount => rgb.map(channel => Math.round(channel + (end - channel) * amount));
      for (let step = 0; step < 12; step++) {
        const mid = (low + high) / 2;
        if (contrast(background, luminance(blend(mid))) >= minimumContrast) high = mid;
        else low = mid;
      }
      options.push({ amount: high, color: blend(high) });
    }
    options.sort((a, b) => a.amount - b.amount);
    return options[0]?.color ?? rgb;
  }

  function colorBucket(r, g, b) {
    const high = Math.max(r, g, b);
    const low = Math.min(r, g, b);
    const chroma = high - low;
    const lightnessBand = Math.floor((high + low) / 128);
    if (chroma < 22) return 'neutral-' + lightnessBand;
    const sector = high === r ? (g - b) / chroma : high === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
    const hueBand = (Math.round(sector * 2) + 12) % 12;
    return hueBand + '-' + lightnessBand;
  }

  function readFrame(source) {
    const width = source.videoWidth ?? source.naturalWidth;
    const height = source.videoHeight ?? source.naturalHeight;
    if (!context || !width || !height) return null;
    const side = Math.min(width, height);
    let pixels;
    try {
      context.clearRect(0, 0, sampleSize, sampleSize);
      context.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, sampleSize, sampleSize);
      pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    } catch {
      // Reset an unreadable canvas so future same-origin or local media can still be sampled.
      canvas.width = sampleSize;
      return null;
    }

    const histogram = new Map();
    const radius = sampleSize / 2;
    for (let y = 0; y < sampleSize; y++) {
      for (let x = 0; x < sampleSize; x++) {
        const distance = ((x + .5 - radius) / radius) ** 2 + ((y + .5 - radius) / radius) ** 2;
        if (distance > 1) continue;
        const offset = (y * sampleSize + x) * 4;
        const alpha = pixels[offset + 3] / 255;
        if (alpha < .18) continue;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];
        const key = colorBucket(r, g, b);
        const values = histogram.get(key) ?? [0, 0, 0, 0];
        const weight = alpha * (1 - .28 * distance);
        values[0] += weight;
        values[1] += r * weight;
        values[2] += g * weight;
        values[3] += b * weight;
        histogram.set(key, values);
      }
    }
    return histogram.size ? histogram : null;
  }

  function dominantColor() {
    const aggregate = new Map();
    for (const frame of frames) {
      for (const [key, values] of frame) {
        const total = aggregate.get(key) ?? [0, 0, 0, 0];
        values.forEach((value, index) => { total[index] += value; });
        aggregate.set(key, total);
      }
    }
    let winner;
    for (const group of aggregate.values()) {
      if (!winner || group[0] > winner[0]) winner = group;
    }
    return winner ? winner.slice(1).map(channel => Math.round(channel / winner[0])) : fallback;
  }

  function updateColor() {
    const original = dominantColor();
    const adjusted = adjustContrast(original);
    avatar.style.setProperty('--avatar-source-color', 'rgb(' + original.join(' ') + ')');
    avatar.style.setProperty('--avatar-ripple-color', 'rgb(' + adjusted.join(' ') + ')');
  }

  function attach() {
    mediaEvents?.abort();
    mediaEvents = new AbortController();
    const { signal } = mediaEvents;
    const media = picture.querySelector('img, video');
    frames = [];
    delete avatar.dataset.colorSampled;
    updateColor();
    if (!media) return;

    let lastSample = -Infinity;
    function capture(source) {
      const frame = readFrame(source);
      if (!frame) return;
      frames.push(frame);
      if (frames.length > 5) frames.shift();
      lastSample = performance.now();
      avatar.dataset.colorSampled = 'true';
      updateColor();
    }

    if (media instanceof HTMLVideoElement) {
      function applyMotionPreference() {
        if (reduceMotion.matches) {
          media.autoplay = false;
          media.pause();
        } else {
          media.autoplay = true;
          media.play().catch(() => {});
        }
      }

      reduceMotion.addEventListener('change', applyMotionPreference, { signal });
      applyMotionPreference();
      media.addEventListener('loadeddata', () => capture(media), { signal });
      media.addEventListener('timeupdate', () => {
        if (performance.now() - lastSample >= 650) capture(media);
      }, { signal });
      if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) capture(media);
      if (media.poster) {
        const poster = new Image();
        poster.addEventListener('load', () => {
          if (!frames.length) capture(poster);
        }, { once: true, signal });
        poster.src = media.poster;
      }
    } else if (media.complete) {
      capture(media);
    } else {
      media.addEventListener('load', () => capture(media), { once: true, signal });
    }
  }

  new MutationObserver(attach).observe(picture, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'poster', 'srcset'],
  });
  new MutationObserver(updateColor).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme', 'class'],
  });
  attach();
})();
