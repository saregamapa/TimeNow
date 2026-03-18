/**
 * Global city search: reads from /api/search?q= and shows cities + time-difference links.
 * Used on city, country, and time-difference pages (element #global-search).
 */
(function () {
  const input = document.getElementById('global-search');
  const resultsEl = document.getElementById('global-search-results');
  if (!input || !resultsEl) return;

  let debounceTimer;
  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    const q = (input.value || '').trim();
    if (q.length < 2) {
      resultsEl.innerHTML = '';
      resultsEl.classList.remove('open');
      return;
    }
    debounceTimer = setTimeout(function () {
      fetch('/api/search?q=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          let html = '';
          if (data.cities && data.cities.length) {
            html += '<div class="search-result-group"><strong>City · Country · Timezone</strong><ul>';
            data.cities.forEach(function (c) {
              var line = (c.city || '') + ', ' + (c.country || '') + (c.timezone ? ' (' + c.timezone + ')' : '');
              html += '<li><a href="/time/' + (c.slug || '') + '">' + escapeHtml(line) + '</a></li>';
            });
            html += '</ul></div>';
          }
          if (data.countries && data.countries.length) {
            html += '<div class="search-result-group"><strong>Countries</strong><ul>';
            data.countries.forEach(function (c) {
              html += '<li><a href="/country/' + escapeHtml(c.slug || '') + '">' + escapeHtml(c.country || '') + '</a></li>';
            });
            html += '</ul></div>';
          }
          if (data.timeDiff && data.timeDiff.length) {
            html += '<div class="search-result-group"><strong>Time difference</strong><ul>';
            data.timeDiff.forEach(function (t) {
              var slugA = t.slugA || '';
              var slugB = t.slugB || '';
              if (slugA && slugB) html += '<li><a href="/time-difference/' + escapeHtml(slugA) + '/' + escapeHtml(slugB) + '">' + escapeHtml((t.cityA || '') + ' vs ' + (t.cityB || '')) + '</a></li>';
            });
            html += '</ul></div>';
          }
          resultsEl.innerHTML = html || '<p class="muted">No results.</p>';
          resultsEl.classList.add('open');
        })
        .catch(function () {
          resultsEl.innerHTML = '';
          resultsEl.classList.remove('open');
        });
    }, 200);
  });

  input.addEventListener('blur', function () {
    setTimeout(function () { resultsEl.classList.remove('open'); }, 150);
  });
  input.addEventListener('focus', function () {
    if (resultsEl.innerHTML) resultsEl.classList.add('open');
  });

  function escapeHtml(s) {
    if (typeof s !== 'string') return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
})();
