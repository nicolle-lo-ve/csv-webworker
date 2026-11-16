/**
 * main.js — Hilo principal (UI)
 * ---------------------------------------------------------------
 * Se encarga únicamente de la interfaz:
 *   - Capturar el archivo (input o drag & drop)
 *   - Enviarlo al Web Worker
 *   - Mostrar progreso y errores
 *   - Pintar la tabla HTML con el resultado
 * ---------------------------------------------------------------
 */

'use strict';

/* ============================================================
   Referencias al DOM
   ============================================================ */
const els = {
  fileInput: document.getElementById('fileInput'),
  dropZone: document.getElementById('dropZone'),
  exampleBtn: document.getElementById('exampleBtn'),
  status: document.getElementById('status'),
  statusText: document.getElementById('statusText'),
  spinner: document.getElementById('spinner'),
  progressBar: document.getElementById('progressBar'),
  info: document.getElementById('info'),
  tableWrapper: document.getElementById('tableWrapper'),
  thead: document.getElementById('csvHead'),
  tbody: document.getElementById('csvBody'),
};

/* ============================================================
   Configuración
   ============================================================ */
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_RENDER_ROWS = 10000;          // límite de filas pintadas en el DOM
const WORKER_URL = 'js/worker.js';

let worker = null;
let startTime = 0;

/* ============================================================
   Utilidades de UI
   ============================================================ */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function setStatus(percent, message) {
  els.status.hidden = false;
  els.status.classList.remove('error');
  els.spinner.hidden = false;
  els.statusText.textContent = message;
  els.progressBar.style.width = `${percent}%`;
}

function hideStatus() {
  els.status.hidden = true;
}

function showError(message) {
  els.status.hidden = false;
  els.status.classList.add('error');
  els.spinner.hidden = true;
  els.statusText.textContent = `❌ ${message}`;
  els.progressBar.style.width = '0%';
}

function resetUI() {
  els.info.hidden = true;
  els.info.replaceChildren();
  els.tableWrapper.hidden = true;
  els.thead.replaceChildren();
  els.tbody.replaceChildren();
  els.progressBar.style.width = '0%';
}

/* ============================================================
   Gestión del Web Worker
   ============================================================ */
function startWorker() {
  // Si ya había un worker activo, lo terminamos
  if (worker) {
    worker.terminate();
  }

  worker = new Worker(WORKER_URL);

  worker.onmessage = (event) => {
    const { type, payload } = event.data;

    switch (type) {
      case 'progress':
        setStatus(payload.percent, payload.message);
        break;

      case 'done':
        renderTable(payload);
        break;

      case 'error':
        showError(payload.message);
        break;

      default:
        console.warn('Mensaje desconocido del worker:', type);
    }
  };

  worker.onerror = (event) => {
    showError(event.message || 'Error inesperado en el Web Worker.');
  };

  return worker;
}

/* ============================================================
   Flujo principal: procesar un archivo
   ============================================================ */
function handleFile(file) {
  if (!file) return;

  // Validación de extensión / tipo
  const isCSV = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  if (!isCSV) {
    showError('El archivo debe tener extensión .csv');
    return;
  }

  // Validación de tamaño
  if (file.size > MAX_FILE_SIZE) {
    showError(`El archivo supera el límite de ${formatBytes(MAX_FILE_SIZE)}.`);
    return;
  }

  resetUI();
  startTime = performance.now();
  setStatus(0, 'Iniciando Web Worker…');

  const w = startWorker();
  w.postMessage({ file, delimiter: ',', header: true });
}

/* ============================================================
   Render de la tabla
   ============================================================ */
function renderTable({ headers, rows, totalRows, fileName, fileSize }) {
  const elapsed = performance.now() - startTime;

  setStatus(100, '¡Listo!');
  setTimeout(hideStatus, 800);

  /* ---------- Cabecera ---------- */
  const headRow = document.createElement('tr');
  headers.forEach((headerText) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = headerText;
    headRow.appendChild(th);
  });
  els.thead.replaceChildren(headRow);

  /* ---------- Cuerpo ---------- */
  const fragment = document.createDocumentFragment();
  const limit = Math.min(rows.length, MAX_RENDER_ROWS);

  for (let i = 0; i < limit; i++) {
    const tr = document.createElement('tr');
    const row = rows[i];

    for (let j = 0; j < headers.length; j++) {
      const td = document.createElement('td');
      // textContent evita inyección de HTML (XSS)
      td.textContent = row[j] ?? '';
      tr.appendChild(td);
    }

    fragment.appendChild(tr);
  }
  els.tbody.replaceChildren(fragment);

  /* ---------- Panel de información ---------- */
  const infoItems = [
    ['Archivo', fileName],
    ['Tamaño', formatBytes(fileSize)],
    ['Filas', totalRows.toLocaleString('es-ES')],
    ['Columnas', String(headers.length)],
    ['Tiempo de proceso', `${elapsed.toFixed(0)} ms`],
  ];

  els.info.replaceChildren();
  infoItems.forEach(([label, value]) => {
    const div = document.createElement('div');
    div.className = 'info-item';

    const spanLabel = document.createElement('span');
    spanLabel.className = 'info-label';
    spanLabel.textContent = label;

    const spanValue = document.createElement('span');
    spanValue.className = 'info-value';
    spanValue.textContent = value;

    div.append(spanLabel, spanValue);
    els.info.appendChild(div);
  });

  if (totalRows > MAX_RENDER_ROWS) {
    const note = document.createElement('p');
    note.className = 'info-note';
    note.textContent =
      `Se procesaron ${totalRows.toLocaleString('es-ES')} filas, pero solo se muestran las primeras ` +
      `${MAX_RENDER_ROWS.toLocaleString('es-ES')} por rendimiento del navegador.`;
    els.info.appendChild(note);
  }

  els.info.hidden = false;
  els.tableWrapper.hidden = false;
}

/* ============================================================
   Eventos de la interfaz
   ============================================================ */

// Selección mediante el input de archivo
els.fileInput.addEventListener('change', (event) => {
  const [file] = event.target.files;
  handleFile(file);
  event.target.value = ''; // permite volver a elegir el mismo archivo
});

// Drag & drop
['dragenter', 'dragover'].forEach((type) => {
  els.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    event.stopPropagation();
    els.dropZone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((type) => {
  els.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    event.stopPropagation();
    els.dropZone.classList.remove('dragover');
  });
});

els.dropZone.addEventListener('drop', (event) => {
  const [file] = event.dataTransfer.files;
  handleFile(file);
});

// Evitar que el navegador abra el archivo si se suelta fuera de la zona
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// Botón "Cargar ejemplo"
els.exampleBtn.addEventListener('click', async () => {
  try {
    setStatus(0, 'Descargando archivo de ejemplo…');
    const response = await fetch('data/ejemplo.csv');
    if (!response.ok) throw new Error('not found');

    const blob = await response.blob();
    const file = new File([blob], 'ejemplo.csv', { type: 'text/csv' });
    handleFile(file);
  } catch (error) {
    showError(
      'No se pudo cargar el ejemplo. Abre la página con un servidor local (ver README).'
    );
  }
});

// Liberar el worker al cerrar la página
window.addEventListener('beforeunload', () => {
  if (worker) worker.terminate();
});
