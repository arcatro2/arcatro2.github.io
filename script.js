// script.js (전체 복사해서 붙여넣기)
const pickDirBtn = document.getElementById('pickDirBtn');
const folderInput = document.getElementById('folderInput');
const generateBtn = document.getElementById('generateBtn');
const refreshBtn = document.getElementById('refreshBtn');
const resultEl = document.getElementById('result');
const templateInput = document.getElementById('templateInput');
const fileListEl = document.getElementById('fileList');
const fileEditor = document.getElementById('fileEditor');
const currentFileNameEl = document.getElementById('currentFileName');
const saveFileBtn = document.getElementById('saveFileBtn');
const downloadFileBtn = document.getElementById('downloadFileBtn');
const copyResultBtn = document.getElementById('copyResultBtn');
const templateSelect = document.getElementById('templateSelect');

let dataMap = {}; // { filenameKey: [{value, weight, raw, handle?}], ... }
let fileHandles = {}; // filenameKey -> FileSystemFileHandle (if available)
let currentFileKey = null; // selected file key

// Utility: parse lines into {value, weight, raw}
function parseLinesToItems(lines) {
  const DEFAULT_WEIGHT = 100;
  return lines.map(line => {
    const s = String(line || '').trim();
    const m = s.match(/^(\d+)\s*:(.*)$/);
    if (m) {
      const w = parseInt(m[1], 10);
      return { value: (m[2] || '').trim(), weight: isNaN(w) ? DEFAULT_WEIGHT : w, raw: s };
    } else {
      return { value: s, weight: DEFAULT_WEIGHT, raw: s };
    }
  }).filter(it => it.value.length > 0);
}

// FileSystem Access API path: ask user to pick a directory
pickDirBtn.addEventListener('click', async () => {
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      await loadAllTxtFromDirectoryHandle(dirHandle);
      renderFileList();
      updateTemplateSelect();
      autoSelectFirst();
      resultEl.textContent = `Loaded: ${Object.keys(dataMap).join(', ')}`;
      window.lastDirHandle = dirHandle; // 폴더 핸들을 전역에 저장
    } catch (err) {
      console.error(err);
      resultEl.textContent = 'Directory pick cancelled or failed.';
    }
  } else {
    resultEl.textContent = 'Directory picker not supported. Use folder upload input below.';
  }
});

// Fallback: user uploads folder via input (webkitdirectory)
folderInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  window.lastUploadedFiles = files;
  await loadFilesFromFileList(files);
  renderFileList();
  updateTemplateSelect();
  autoSelectFirst();
  resultEl.textContent = `Loaded: ${Object.keys(dataMap).join(', ')}`;
});

refreshBtn.addEventListener('click', async () => {
  if (window.lastDirHandle) {
    //폴더 선택 방식으로 불러온 경우
    try {
      await loadAllTxtFromDirectoryHandle(window.lastDirHandle);
      renderFileList();
      updateTemplateSelect();
      autoSelectFirst();
      resultEl.textContent = '폴더에서 파일을 다시 불러왔습니다.';
      return;
    } catch (err) {
      console.error('폴더 새로고침 실패:', err);
      resultEl.textContent = '폴더 새로고침 실패';
      return;
    }
  }

  if (window.lastUploadedFiles && window.lastUploadedFiles.length > 0) {
    //업로드 방식으로 불러온 경우
    try {
      await loadFilesFromFileList(window.lastUploadedFiles);
      renderFileList();
      updateTemplateSelect();
      autoSelectFirst();
      resultEl.textContent = '업로드된 파일을 다시 불러왔습니다.';
      return;
    } catch (err) {
      console.error('업로드 새로고침 실패:', err);
      resultEl.textContent = '업로드 새로고침 실패';
      return;
    }
  }

  resultEl.textContent = '불러온 폴더나 파일이 없습니다.';
});

// Generate button
generateBtn.addEventListener('click', () => {
  const template = templateInput.value || '';
  if (!template) {
    resultEl.textContent = 'Enter a template first.';
    return;
  }
  if (Object.keys(dataMap).length === 0) {
    resultEl.textContent = 'No text arrays loaded. Select folder or upload files.';
    return;
  }
  const out = fillTemplateWithRecursion(template, 30); // 최대 30회 반복 치환
  resultEl.textContent = out;
});

// Save edited file (uses File System Access API if handle present)
saveFileBtn.addEventListener('click', async () => {
  if (!currentFileKey) {
    resultEl.textContent = 'Select a file to save.';
    return;
  }
  const entry = (dataMap[currentFileKey] && dataMap[currentFileKey][0]) || null;
  const handle = fileHandles[currentFileKey] || (entry && entry.handle);
  const text = fileEditor.value;
  if (handle && handle.createWritable) {
    try {
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
      dataMap[currentFileKey] = parseLinesToItems(lines).map(it => ({...it, handle}));
      resultEl.textContent = `Saved ${currentFileKey}`;
    } catch (err) {
      console.error(err);
      resultEl.textContent = 'Save failed: ' + err.message;
    }
  } else {
    resultEl.textContent = 'File System Access API not available for saving. Use "Download Edited" button to get edited file.';
  }
});

// Download edited file as fallback
downloadFileBtn.addEventListener('click', () => {
  if (!currentFileKey) {
    resultEl.textContent = 'Select a file to download.';
    return;
  }
  const text = fileEditor.value || '';
  const blob = new Blob([text], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = currentFileKey + '.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  resultEl.textContent = `Downloaded ${currentFileKey}.txt`;
});

// Render file list UI
function renderFileList() {
  fileListEl.innerHTML = '';
  const keys = Object.keys(dataMap).sort();
  if (keys.length === 0) {
    fileListEl.textContent = 'No .txt files loaded.';
    return;
  }
  for (const key of keys) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = key + ` (${dataMap[key].length})`;
    btn.addEventListener('click', () => selectFileKey(key));
    fileListEl.appendChild(btn);
  }
}

// Select a file to edit
function selectFileKey(key) {
  currentFileKey = key;
  currentFileNameEl.textContent = key + '.txt';
  const items = dataMap[key] || [];
  const rawText = items.map(it => (it.raw ? it.raw : (it.weight && it.weight !== 100 ? `${it.weight}:${it.value}` : it.value))).join('\n');
  fileEditor.value = rawText;
}

// Replaces <...> patterns, supports:
// - <filename> -> use dataMap[filename] (items are {value,weight})
// - <opt1|opt2|4:opt3> -> inline options where plain tokens have weight 1, "N:token" gives weight N
// Repeats replacement up to maxIterations to resolve nested placeholders
function fillTemplateWithRecursion(template, maxIterations = 30) {
  function parseInlineOptions(inner) {
    const DEFAULT_INLINE_WEIGHT = 1;
    return inner.split('|').map(tok => {
      const s = tok.trim();
      if (!s) return null;
      const m = s.match(/^(\d+)\s*:(.*)$/);
      if (m) {
        const w = parseInt(m[1], 10);
        const val = (m[2] || '').trim();
        return val ? { value: val, weight: isNaN(w) ? DEFAULT_INLINE_WEIGHT : w } : null;
      } else {
        return { value: s, weight: DEFAULT_INLINE_WEIGHT };
      }
    }).filter(Boolean);
  }

  function pickFromInline(inner) {
    const items = parseInlineOptions(inner);
    if (!items || items.length === 0) return '';
    const total = items.reduce((s, it) => s + (it.weight > 0 ? it.weight : 0), 0);
    if (total <= 0) return items[items.length - 1].value || '';
    let r = Math.random() * total;
    for (const it of items) {
      const w = it.weight > 0 ? it.weight : 0;
      if (r < w) return it.value;
      r -= w;
    }
    return items[items.length - 1].value || '';
  }

  let current = template;
  let iteration = 0;

  while (iteration < maxIterations) {
    let replacedInThisPass = false;

    current = current.replace(/<([^<>]+)>/g, (match, inner) => {
      const key = inner.trim();
      // Inline options if contains '|' (user-specified format)
      if (key.includes('|')) {
        const chosen = pickFromInline(key);
        replacedInThisPass = true;
        return chosen;
      }

      // Otherwise treat as filename key referencing dataMap
      const items = dataMap[key];
      if (!items || items.length === 0) {
        // leave empty if no such key
        replacedInThisPass = true; // we did attempt replacement (to empty)
        return '';
      }

      // items expected as [{value, weight}, ...]
      const chosen = pickRandomFromItems(items);
      replacedInThisPass = true;
      return chosen;
    });

    iteration += 1;
    if (!replacedInThisPass) break;
  }

  return current;
}


// Weighted random pick: items = [{value, weight}, ...]
function pickRandomFromItems(items) {
  const total = items.reduce((s, it) => s + (it.weight > 0 ? it.weight : 0), 0);
  if (total <= 0) return items[items.length - 1].value || '';
  let r = Math.random() * total;
  for (const it of items) {
    const w = it.weight > 0 ? it.weight : 0;
    if (r < w) return it.value;
    r -= w;
  }
  return items[items.length - 1].value || '';
}

// Load files from a FileList (upload fallback)
async function loadFilesFromFileList(fileList) {
  dataMap = {};
  fileHandles = {};
  for (const f of fileList) {
    if (!f.name.toLowerCase().endsWith('.txt')) continue;
    try {
      const text = await f.text();
      const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
      const key = f.name.replace(/\.[^/.]+$/, '');
      dataMap[key] = parseLinesToItems(lines);
    } catch (err) {
      console.warn('Failed to read', f.name, err);
    }
  }
}

// Load all .txt files from a directory handle (non-recursive)
async function loadAllTxtFromDirectoryHandle(dirHandle) {
  dataMap = {};
  fileHandles = {};
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && name.toLowerCase().endsWith('.txt')) {
      try {
        const file = await handle.getFile();
        const text = await file.text();
        const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
        const key = name.replace(/\.[^/.]+$/, '');
        const items = parseLinesToItems(lines).map(it => ({...it, handle}));
        dataMap[key] = items;
        fileHandles[key] = handle;
      } catch (err) {
        console.warn('Failed to read file in dir', name, err);
      }
    }
  }
}

// Optional: auto-select first file when data loaded
function autoSelectFirst() {
  const keys = Object.keys(dataMap);
  if (keys.length > 0) selectFileKey(keys[0]);
}

//Copy button
copyResultBtn.addEventListener('click', async () => {
  const text = resultEl.innerText || resultEl.textContent || '';
  if (!text) {
    // 결과가 비어있으면 시각적 피드백
    copyResultBtn.textContent = 'Empty';
    setTimeout(() => copyResultBtn.textContent = 'Copy', 1000);
    return;
  }

  // 우선 navigator.clipboard 사용 (HTTPS/로컬에서 동작)
  try {
    await navigator.clipboard.writeText(text);
    copyResultBtn.textContent = 'Copied';
    setTimeout(() => copyResultBtn.textContent = 'Copy', 1200);
    return;
  } catch (err) {
    // 실패 시 fallback
  }

  // Fallback: 임시 textarea 만들어 선택 후 복사
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    copyResultBtn.textContent = ok ? 'Copied' : 'Failed';
    setTimeout(() => copyResultBtn.textContent = 'Copy', 1200);
  } catch (err) {
    copyResultBtn.textContent = 'Failed';
    setTimeout(() => copyResultBtn.textContent = 'Copy', 1200);
  }
});

// 호출용: dataMap을 기준으로 templateSelect를 갱신
function updateTemplateSelect() {
  // 초기화
  if (!templateSelect) return;
  templateSelect.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '— load template.txt —';
  templateSelect.appendChild(defaultOpt);

  // template.txt (확장자 없이 key가 'template' 혹은 'template.txt'를 사용 중이라면 'template') 찾기
  // 여기서는 파일명 키가 'template'인 경우를 기본으로 처리
  const key = 'template'; // 만약 다른 키명 사용 시 변경 가능
  const items = dataMap[key];

  if (!items || items.length === 0) {
    // 비활성화 상태로 두기
    templateSelect.disabled = true;
    return;
  }

  templateSelect.disabled = false;
  // 각 항목을 option으로 추가 (항목의 원문(raw)이나 value를 사용)
  items.forEach((it, idx) => {
    const opt = document.createElement('option');
    opt.value = idx; // index로 참조
    // 표시용 텍스트: raw가 있으면 raw, 없으면 value
    opt.textContent = idx; //it.raw ? it.raw : it.value;
    templateSelect.appendChild(opt);
  });
}

// 드롭다운에서 선택되면 templateInput에 즉시 반영
if (templateSelect) {
  templateSelect.addEventListener('change', () => {
    const val = templateSelect.value;
    if (!val) return;
    const key = 'template';
    const items = dataMap[key];
    const idx = parseInt(val, 10);
    if (!items || isNaN(idx) || idx < 0 || idx >= items.length) return;
    // 선택된 항목의 원문(raw) 또는 value를 템플릿으로 설정
    const chosenText = items[idx].raw ? items[idx].raw : items[idx].value;
    templateInput.value = chosenText;
  });
}