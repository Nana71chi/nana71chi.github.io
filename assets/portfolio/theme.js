(() => {
  const root = document.documentElement;

  function restoreTheme() {
    try {
      root.dataset.theme = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    } catch {
      // The current page can still switch themes without storage.
    }
  }

  restoreTheme();

  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.theme-switch');

    function updateSwitch() {
      toggle.setAttribute('aria-checked', String(root.dataset.theme === 'dark'));
    }

    function restoreSwitch() {
      restoreTheme();
      updateSwitch();
    }

    updateSwitch();
    toggle.hidden = false;

    toggle.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = theme;
      updateSwitch();
      try {
        localStorage.setItem('theme', theme);
      } catch {
        // Keep the selection on this page if storage is unavailable.
      }
    });

    window.addEventListener('storage', (event) => {
      if (event.key === 'theme' || event.key === null) restoreSwitch();
    });
    window.addEventListener('pageshow', restoreSwitch);
  });
})();
