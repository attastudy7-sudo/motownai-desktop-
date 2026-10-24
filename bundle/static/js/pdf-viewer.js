(async function initPdfViewer() {
  const shell = document.getElementById('pdfViewerShell');
  if (!shell) return;

  const pdfUrl = shell.dataset.pdfUrl;
  if (!pdfUrl) return;

  const { pdfjsLib } = globalThis;
  if (!pdfjsLib) {
    console.error('[PDF.js] Library not loaded');
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/js/pdfjs/pdf.worker.mjs';

  const loading = document.getElementById('pdfLoading');
  const canvas = document.getElementById('pdfCanvas');
  const ctx = canvas.getContext('2d');
  const pageNum = document.getElementById('pdfPageNum');
  const pageCnt = document.getElementById('pdfPageCount');
  const zoomLbl = document.getElementById('pdfZoomLabel');

  let pdfDoc = null,
    currentPage = 1,
    scale = 1.2;

  async function renderPage(num) {
    currentPage = num;
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale });

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const wrapper = document.getElementById('pdfCanvasWrapper');
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Text layer — PDF.js v4 API (use renderTextLayer task)
    var textLayerDiv = document.getElementById('pdfTextLayer');
    textLayerDiv.innerHTML = '';
    textLayerDiv.style.width = viewport.width + 'px';
    textLayerDiv.style.height = viewport.height + 'px';

    const textContent = await page.getTextContent();
    const renderTask = pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: viewport,
    });
    await renderTask.promise;

    // Selection-based text highlighter after every render.
    if (window.TextHighlighter && typeof window.TextHighlighter.init === 'function') {
      try {
        window.TextHighlighter.init({ containerEl: textLayerDiv, viewport: viewport, page: page });
      } catch (e) {}
    }

    pageNum.textContent = num;
    zoomLbl.textContent = Math.round(scale * 100) + '%';
    document.getElementById('pdfPrevPage').disabled = num <= 1;
    document.getElementById('pdfNextPage').disabled = num >= pdfDoc.numPages;
  }

  try {
    pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
    pageCnt.textContent = pdfDoc.numPages;
    loading.classList.add('hidden');
    await renderPage(1);
  } catch (e) {
    loading.innerHTML = '<span style="color:var(--danger)">Failed to load PDF</span>';
    console.error('[PDF.js]', e);
  }

  document.getElementById('pdfPrevPage').onclick = async () => {
    if (currentPage > 1) {
      currentPage--;
      await renderPage(currentPage);
    }
  };

  document.getElementById('pdfNextPage').onclick = async () => {
    if (currentPage < pdfDoc.numPages) {
      currentPage++;
      await renderPage(currentPage);
    }
  };

  document.getElementById('pdfZoomIn').onclick = async () => {
    scale = Math.min(scale + 0.2, 3.0);
    await renderPage(currentPage);
  };

  document.getElementById('pdfZoomOut').onclick = async () => {
    scale = Math.max(scale - 0.2, 0.5);
    await renderPage(currentPage);
  };

  // Document-only theme toggle.
  // Uses a data attribute on the pdf viewer shell so it doesn't affect the entire app.
  const toggleBtn = document.getElementById('pdfToggleTheme');
  const icon = document.getElementById('pdfThemeIcon');

  if (toggleBtn) {
    function applyIcon(docTheme) {
      if (!icon) return;
      icon.className = docTheme === 'dark' ? 'ti ti-moon' : 'ti ti-sun';
    }

    function getCurrentTheme() {
      return shell.getAttribute('data-doc-theme') || 'dark';
    }

    function getStoredTheme() {
      const stored = localStorage.getItem('motown-pdf-doc-theme');
      return stored === 'light' || stored === 'dark' ? stored : null;
    }

    const stored = getStoredTheme();
    if (stored) {
      shell.setAttribute('data-doc-theme', stored);
      applyIcon(stored);
    } else {
      applyIcon(getCurrentTheme());
    }

    toggleBtn.addEventListener('click', () => {
      const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
      shell.setAttribute('data-doc-theme', next);
      localStorage.setItem('motown-pdf-doc-theme', next);
      applyIcon(next);
    });
  }

  // Basic sanity log for debugging (safe; harmless)
  // eslint-disable-next-line no-console
  console.debug('[PDF] viewer script loaded. Toggle present:', !!toggleBtn);
})();


