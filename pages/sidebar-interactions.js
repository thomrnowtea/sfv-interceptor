(function () {

  // ── Desktop: sidebar resize ───────────────────────────────────────────────
  var sidebar = document.getElementById('sidebar');
  var handle  = document.getElementById('sidebar-resize-handle');

  if (sidebar && handle) {
    var KEY   = 'sfvi_sidebar_w';
    var MIN_W = 180;
    var MAX_W = function () { return Math.floor(window.innerWidth * 0.25); };

    var saved = parseInt(localStorage.getItem(KEY), 10);
    if (saved >= MIN_W) {
      sidebar.style.width = Math.min(saved, MAX_W()) + 'px';
    }

    var dragging = false, startX = 0, startW = 0;

    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dragging = true;
      startX   = e.clientX;
      startW   = sidebar.getBoundingClientRect().width;
      handle.classList.add('is-dragging');
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var w = startW + (e.clientX - startX);
      w = Math.min(Math.max(w, MIN_W), MAX_W());
      sidebar.style.width = w + 'px';
    });

    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      var w = parseInt(sidebar.style.width, 10);
      if (w >= MIN_W) localStorage.setItem(KEY, w);
    });
  }

  // ── Mobile: collapse button ───────────────────────────────────────────────
  var colBtn = document.getElementById('sidebar-collapse-btn');

  if (colBtn && sidebar) {
    colBtn.addEventListener('click', function () {
      var isNowCollapsed = sidebar.classList.toggle('collapsed');
      colBtn.textContent = isNowCollapsed ? '▼ Show Rules' : '▲ Hide Rules';
    });
  }

})();
