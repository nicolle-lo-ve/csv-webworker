/**
 * worker.js — Web Worker
 * ---------------------------------------------------------------
 * Se encarga de:
 *   1. Leer el contenido del archivo (File.text())
 *   2. Parsear el CSV (soporta comillas, comas y saltos de línea
 *      dentro de campos entrecomillados)
 *   3. Devolver el resultado al hilo principal mediante postMessage
 *
 * Al ejecutarse en un hilo aparte, la interfaz NO se congela
 * aunque el archivo sea grande.
 * ---------------------------------------------------------------
 */

'use strict';

/** Envía un mensaje tipado al hilo principal. */
const post = (type, payload) => self.postMessage({ type, payload });

self.addEventListener('message', async (event) => {
  const { file, delimiter = ',', header = true } = event.data || {};

  try {
    if (!file) {
      throw new Error('No se recibió ningún archivo.');
    }

    /* ------------------------------------------------------------
       1. Lectura del archivo (API disponible dentro del worker)
       ------------------------------------------------------------ */
    post('progress', { percent: 5, message: 'Leyendo archivo…' });

    const text = await file.text();

    /* ------------------------------------------------------------
       2. Parseo del CSV
       ------------------------------------------------------------ */
    post('progress', { percent: 15, message: 'Parseando CSV…' });

    const rows = parseCSV(text, delimiter, (p) => {
      post('progress', {
        percent: 15 + Math.round(p * 0.8), // 15 % → 95 %
        message: `Parseando CSV… ${p}%`,
      });
    });

    // Eliminar filas completamente vacías al final del archivo
    while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) {
      rows.pop();
    }

    if (rows.length === 0) {
      throw new Error('El archivo CSV está vacío o no tiene un formato válido.');
    }

    /* ------------------------------------------------------------
       3. Cabeceras y normalización de filas
       ------------------------------------------------------------ */
    post('progress', { percent: 96, message: 'Preparando tabla…' });

    const headers = header
      ? rows[0].map((h, i) => (h.trim() === '' ? `Columna ${i + 1}` : h.trim()))
      : rows[0].map((_, i) => `Columna ${i + 1}`);

    const dataRows = header ? rows.slice(1) : rows;
    const columnCount = headers.length;

    // Todas las filas deben tener exactamente el mismo nº de columnas
    const normalized = dataRows.map((row) => {
      if (row.length === columnCount) return row;
      const copy = row.slice(0, columnCount);
      while (copy.length < columnCount) copy.push('');
      return copy;
    });

    /* ------------------------------------------------------------
       4. Resultado final
       ------------------------------------------------------------ */
    post('done', {
      headers,
      rows: normalized,
      totalRows: normalized.length,
      fileName: file.name,
      fileSize: file.size,
    });
  } catch (error) {
    post('error', { message: error.message || 'Error desconocido al procesar el CSV.' });
  }
});

/**
 * Parser de CSV.
 *
 * Reglas soportadas:
 *  - Separador configurable (por defecto ",")
 *  - Campos entrecomillados:  "Hola, mundo"
 *  - Comillas escapadas:      "Dijo ""hola"""
 *  - Saltos de línea dentro de un campo entrecomillado
 *  - Finales de línea \n y \r\n
 *
 * @param {string}   text       Contenido completo del archivo
 * @param {string}   delimiter  Carácter separador
 * @param {Function} onProgress Callback opcional de progreso (0-100)
 * @returns {string[][]}        Matriz de filas y columnas
 */
function parseCSV(text, delimiter, onProgress) {
  // Eliminar BOM (UTF-8 con BOM)
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let lastPercent = -1;

  const length = text.length;

  for (let i = 0; i < length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          // Comilla escapada -> ""
          field += '"';
          i++;
        } else {
          // Fin del campo entrecomillado
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (char === '\r') {
      // Se ignora: \r\n se trata con el \n
    } else {
      field += char;
    }

    // Notificar progreso cada ~65 536 caracteres
    if (onProgress && (i & 0xffff) === 0) {
      const percent = Math.floor((i / length) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
    }
  }

  // Último campo / fila (si el archivo no termina en salto de línea)
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
